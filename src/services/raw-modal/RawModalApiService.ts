import {
  ComponentType,
  InteractionResponseType,
  RouteBases,
  Routes,
  Utils,
} from "discord-api-types/v10";
import type {
  APIAttachment,
  APIInteraction,
  APIInteractionResponse,
  APIModalSubmissionComponent,
  APIModalSubmitInteraction,
  ModalSubmitComponent,
} from "discord-api-types/v10";
import type {
  RESTPostAPIInteractionCallbackJSONBody,
  RESTPostAPIInteractionFollowupJSONBody,
  RESTPostAPIInteractionFollowupResult,
} from "discord-api-types/rest/v10/interactions";
import type {
  IRawModalApiService,
  IRawModalFollowUpRequest,
  IRawModalOpenRequest,
  IRawModalSubmitContext,
  RawModalFieldValues,
  RawModalSubmittedValue,
} from "./RawModalContracts.js";
import { buildRawModalCustomId } from "./RawModalCustomId.js";
import { parseRawModalCustomId } from "./RawModalCustomId.js";
import { logRawModal } from "./RawModalLogging.js";

type FetchLike = typeof fetch;
type SupportedMethod = "POST";

export interface IRawModalApiServiceOptions {
  applicationId: string;
  fetchImpl?: FetchLike;
  apiBaseUrl?: string;
}

export class RawModalApiService implements IRawModalApiService {
  private readonly applicationId: string;
  private readonly fetchImpl: FetchLike;
  private readonly apiBaseUrl: string;

  constructor(options: IRawModalApiServiceOptions) {
    if (!options.applicationId) {
      throw new Error("RawModalApiService requires a non-empty applicationId.");
    }

    this.applicationId = options.applicationId;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.apiBaseUrl = options.apiBaseUrl ?? RouteBases.api;
  }

  async openModal(request: IRawModalOpenRequest): Promise<void> {
    logRawModal("info", "open.requested", {
      sessionId: request.sessionId,
      feature: request.feature,
      flow: request.flow,
    });

    const payload: APIInteractionResponse = {
      type: InteractionResponseType.Modal,
      data: {
        custom_id: buildRawModalCustomId({
          feature: request.feature,
          flow: request.flow,
          sessionId: request.sessionId,
        }),
        title: request.title,
        components: request.components,
      },
    };

    try {
      await this.postInteractionCallback(request.interactionId, request.interactionToken, payload);
      logRawModal("info", "open.sent", {
        sessionId: request.sessionId,
        feature: request.feature,
        flow: request.flow,
      });
    } catch (error: unknown) {
      logRawModal("error", "open.failed", {
        sessionId: request.sessionId,
        feature: request.feature,
        flow: request.flow,
        error,
      });
      throw error;
    }
  }

  parseSubmit(interactionPayload: APIInteraction | unknown): IRawModalSubmitContext | null {
    if (!interactionPayload || typeof interactionPayload !== "object") {
      return null;
    }

    const interaction = interactionPayload as APIInteraction;
    if (!Utils.isModalSubmitInteraction(interaction)) {
      return null;
    }
    const validation = this.validateSubmitComponents(interaction);
    if (!validation.ok) {
      logRawModal("warn", "submit.invalid_payload", {
        customId: interaction.data.custom_id,
        userId: interaction.member?.user?.id ?? interaction.user?.id,
        reason: validation.reason,
      });
      return null;
    }

    const submitContext = this.toSubmitContext(interaction);
    const parsedId = parseRawModalCustomId(submitContext.customId);
    if (!parsedId) {
      logRawModal("warn", "submit.invalid_custom_id", {
        customId: submitContext.customId,
        userId: submitContext.userId,
      });
      return null;
    }
    logRawModal("info", "submit.parsed", {
      sessionId: parsedId.sessionId,
      feature: parsedId.feature,
      flow: parsedId.flow,
      customId: submitContext.customId,
      userId: submitContext.userId,
    });
    return submitContext;
  }

  async ackSubmit(interactionId: string, interactionToken: string): Promise<void> {
    const payload: RESTPostAPIInteractionCallbackJSONBody = {
      type: InteractionResponseType.DeferredChannelMessageWithSource,
    };
    try {
      await this.postInteractionCallback(interactionId, interactionToken, payload);
      logRawModal("info", "submit.ack_sent");
    } catch (error: unknown) {
      if (this.isAckRaceError(error)) {
        logRawModal("warn", "submit.ack_race_ignored", { error });
        return;
      }
      logRawModal("warn", "submit.ack_failed", { error });
      throw error;
    }
  }

  async followUp(
    interactionToken: string,
    request: IRawModalFollowUpRequest,
  ): Promise<RESTPostAPIInteractionFollowupResult> {
    const route = Routes.webhook(this.applicationId, interactionToken);
    const endpoint = this.toApiUrl(`${route}?wait=true`);
    const payload: RESTPostAPIInteractionFollowupJSONBody = request.message;

    try {
      return await this.postJson<RESTPostAPIInteractionFollowupResult>(endpoint, payload);
    } catch (error: unknown) {
      logRawModal("error", "submit.followup_failed", { error });
      throw error;
    }
  }

  private async postInteractionCallback(
    interactionId: string,
    interactionToken: string,
    payload: RESTPostAPIInteractionCallbackJSONBody,
  ): Promise<void> {
    const route = Routes.interactionCallback(interactionId, interactionToken);
    const endpoint = this.toApiUrl(route);
    await this.postJson<void>(endpoint, payload);
  }

  private async postJson<TResult>(url: string, payload: unknown): Promise<TResult> {
    const response = await this.fetchImpl(url, {
      method: this.asMethod("POST"),
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Raw modal API request failed: ${response.status} ${response.statusText} ${errorText}`,
      );
    }

    if (response.status === 204) {
      return undefined as TResult;
    }

    return (await response.json()) as TResult;
  }

  private toApiUrl(pathOrUrl: string): string {
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    return new URL(pathOrUrl, this.apiBaseUrl).toString();
  }

  private asMethod(method: SupportedMethod): SupportedMethod {
    return method;
  }

  private toSubmitContext(interaction: APIModalSubmitInteraction): IRawModalSubmitContext {
    const userId = interaction.member?.user?.id ?? interaction.user?.id;
    if (!userId) {
      throw new Error("Modal submit interaction is missing user identity.");
    }

    const values: RawModalFieldValues = {};
    const attachments: Record<string, APIAttachment> = {};
    const resolvedAttachments = interaction.data.resolved?.attachments ?? {};
    const submittedComponents = this.flattenSubmittedComponents(interaction.data.components);

    for (const component of submittedComponents) {
      values[component.custom_id] = this.readSubmittedValue(component);

      if (component.type !== ComponentType.FileUpload) {
        continue;
      }

      for (const attachmentId of component.values) {
        const attachment = resolvedAttachments[attachmentId];
        if (attachment) {
          attachments[attachmentId] = attachment;
        }
      }
    }

    return {
      interactionId: interaction.id,
      interactionToken: interaction.token,
      customId: interaction.data.custom_id,
      userId,
      guildId: interaction.guild_id,
      channelId: interaction.channel?.id ?? interaction.channel_id,
      values,
      attachments,
    };
  }

  private flattenSubmittedComponents(
    components: APIModalSubmissionComponent[],
  ): ModalSubmitComponent[] {
    const submitted: ModalSubmitComponent[] = [];

    for (const component of components) {
      if (component.type === ComponentType.ActionRow) {
        submitted.push(...component.components);
        continue;
      }

      if (component.type === ComponentType.Label) {
        submitted.push(component.component);
      }
    }

    return submitted;
  }

  private readSubmittedValue(component: ModalSubmitComponent): RawModalSubmittedValue {
    switch (component.type) {
      case ComponentType.TextInput:
        return component.value;
      case ComponentType.StringSelect:
      case ComponentType.UserSelect:
      case ComponentType.RoleSelect:
      case ComponentType.MentionableSelect:
      case ComponentType.ChannelSelect:
      case ComponentType.FileUpload:
      case ComponentType.CheckboxGroup:
        return component.values;
      case ComponentType.RadioGroup:
        return component.value ?? null;
      case ComponentType.Checkbox:
        return component.value;
      default:
        return this.assertNever(component);
    }
  }

  private assertNever(value: never): never {
    throw new Error(`Unsupported modal component type: ${JSON.stringify(value)}`);
  }

  private isAckRaceError(error: unknown): boolean {
    const text = String(error ?? "");
    return text.includes("40060") || text.includes("10062");
  }

  private validateSubmitComponents(
    interaction: APIModalSubmitInteraction,
  ): { ok: true } | { ok: false; reason: string } {
    const customId = interaction.data.custom_id;
    if (!customId || customId.length > 100) {
      return { ok: false, reason: "modal custom id is missing or too long" };
    }

    const flatComponents = this.flattenSubmittedComponents(interaction.data.components);
    if (flatComponents.length === 0) {
      return { ok: false, reason: "modal submission has no components" };
    }

    const seenIds = new Set<string>();
    const resolvedAttachments = interaction.data.resolved?.attachments ?? {};

    for (const component of flatComponents) {
      if (!component.custom_id || component.custom_id.length > 100) {
        return { ok: false, reason: "component custom id is missing or too long" };
      }
      if (seenIds.has(component.custom_id)) {
        return { ok: false, reason: "duplicate component custom id in payload" };
      }
      seenIds.add(component.custom_id);

      switch (component.type) {
        case ComponentType.TextInput:
          if (typeof component.value !== "string" || component.value.length > 4000) {
            return { ok: false, reason: "text input value is invalid" };
          }
          break;
        case ComponentType.StringSelect:
        case ComponentType.UserSelect:
        case ComponentType.RoleSelect:
        case ComponentType.MentionableSelect:
        case ComponentType.ChannelSelect:
        case ComponentType.CheckboxGroup:
          if (!Array.isArray(component.values) || component.values.some((v) => typeof v !== "string")) {
            return { ok: false, reason: "select values are invalid" };
          }
          break;
        case ComponentType.FileUpload:
          if (!Array.isArray(component.values) || component.values.length === 0) {
            return { ok: false, reason: "file upload values are invalid" };
          }
          for (const attachmentId of component.values) {
            if (!resolvedAttachments[attachmentId]) {
              return { ok: false, reason: "file upload attachment id is unresolved" };
            }
          }
          break;
        case ComponentType.RadioGroup:
          if (!(component.value === null || typeof component.value === "string")) {
            return { ok: false, reason: "radio group value is invalid" };
          }
          break;
        case ComponentType.Checkbox:
          if (typeof component.value !== "boolean") {
            return { ok: false, reason: "checkbox value is invalid" };
          }
          break;
        default:
          return { ok: false, reason: "unsupported modal component type" };
      }
    }

    return { ok: true };
  }
}
