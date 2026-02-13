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
const RAW_MODAL_HTTP_TIMEOUT_MS = 8000;

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

    const customId = request.customId ?? buildRawModalCustomId({
      feature: request.feature,
      flow: request.flow,
      sessionId: request.sessionId,
    });
    if (!customId || customId.length > 100) {
      throw new Error("Raw modal custom id is missing or exceeds 100 characters.");
    }

    const payload: APIInteractionResponse = {
      type: InteractionResponseType.Modal,
      data: {
        custom_id: customId,
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
      logRawModal("warn", "submit.invalid_payload", {
        reason: "payload is not an object",
      });
      return null;
    }

    try {
      const interaction = interactionPayload as APIInteraction;
      const payloadShape = this.describePayloadShape(interactionPayload);
      if (!Utils.isModalSubmitInteraction(interaction)) {
        logRawModal("info", "submit.ignored_non_modal", {
          reason: payloadShape,
        });
        return null;
      }
      const validation = this.validateSubmitComponents(interaction);
      if (!validation.ok) {
        logRawModal("warn", "submit.invalid_payload", {
          customId: interaction.data?.custom_id,
          userId: interaction.member?.user?.id ?? interaction.user?.id,
          reason: `${validation.reason}; ${payloadShape}`,
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
    } catch (error: unknown) {
      logRawModal("error", "submit.parse_failed", {
        error,
        reason: this.describePayloadShape(interactionPayload),
      });
      return null;
    }
  }

  private describePayloadShape(payload: unknown): string {
    if (!payload || typeof payload !== "object") {
      return `payload_type=${typeof payload}`;
    }

    const root = payload as Record<string, unknown>;
    const rootKeys = Object.keys(root).slice(0, 12).join(",");
    const data = root.data;
    const dataObj = data && typeof data === "object"
      ? data as Record<string, unknown>
      : null;
    const dataKeys = dataObj ? Object.keys(dataObj).slice(0, 12).join(",") : "none";
    const components = dataObj?.components;
    const componentCount = Array.isArray(components) ? components.length : -1;
    const componentTypes = Array.isArray(components)
      ? components
        .slice(0, 6)
        .map((entry) => {
          if (!entry || typeof entry !== "object") return "invalid";
          const typed = entry as { type?: unknown; components?: unknown; component?: unknown };
          const childCount = Array.isArray(typed.components) ? typed.components.length : 0;
          const hasLabelChild = Boolean(typed.component);
          return `type=${String(typed.type ?? "missing")} children=${childCount} hasLabelChild=${hasLabelChild}`;
        })
        .join("|")
      : "none";

    return [
      `interaction_type=${String(root.type ?? "missing")}`,
      `has_data=${dataObj ? "true" : "false"}`,
      `root_keys=${rootKeys || "none"}`,
      `data_keys=${dataKeys}`,
      `component_count=${componentCount}`,
      `component_shapes=${componentTypes}`,
    ].join(" ");
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
    logRawModal("info", "http.post.begin", {
      reason: `url=${url}`,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RAW_MODAL_HTTP_TIMEOUT_MS);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: this.asMethod("POST"),
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error: unknown) {
      const isAbort = error instanceof Error && error.name === "AbortError";
      logRawModal("error", "http.post.failed", {
        reason: isAbort
          ? `timeout_ms=${RAW_MODAL_HTTP_TIMEOUT_MS} url=${url}`
          : `url=${url}`,
        error,
      });
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    logRawModal("info", "http.post.response", {
      reason: `url=${url} status=${response.status}`,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      logRawModal("error", "http.post.non_ok", {
        reason: `url=${url} status=${response.status} statusText=${response.statusText}`,
        error: errorText,
      });
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
    const normalizedBase = this.apiBaseUrl.replace(/\/+$/, "");
    const normalizedPath = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
    return `${normalizedBase}${normalizedPath}`;
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
    const resolvedAttachments = interaction.data?.resolved?.attachments ?? {};
    const rawComponents = Array.isArray(interaction.data?.components)
      ? interaction.data.components as APIModalSubmissionComponent[]
      : [];
    const submittedComponents = this.flattenSubmittedComponents(rawComponents);

    for (const component of submittedComponents) {
      if (!this.isModalSubmitComponent(component)) {
        continue;
      }
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
        for (const child of component.components ?? []) {
          if (child) {
            submitted.push(child);
          }
        }
        continue;
      }

      if (component.type === ComponentType.Label) {
        if (component.component) {
          submitted.push(component.component);
        }
      }
    }

    return submitted;
  }

  private isModalSubmitComponent(value: unknown): value is ModalSubmitComponent {
    if (!value || typeof value !== "object") {
      return false;
    }
    const candidate = value as { type?: unknown; custom_id?: unknown };
    return typeof candidate.type === "number" && typeof candidate.custom_id === "string";
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
    const interactionData = interaction.data;
    if (!interactionData || typeof interactionData !== "object") {
      return { ok: false, reason: "modal interaction data is missing" };
    }

    const customId = typeof interactionData.custom_id === "string" ? interactionData.custom_id : "";
    if (!customId || customId.length > 100) {
      return { ok: false, reason: "modal custom id is missing or too long" };
    }

    const rawComponents = Array.isArray(interactionData.components)
      ? interactionData.components as APIModalSubmissionComponent[]
      : [];
    if (rawComponents.length === 0) {
      return { ok: false, reason: "modal submission has no top-level components" };
    }

    const flatComponents = this.flattenSubmittedComponents(rawComponents);
    if (flatComponents.length === 0) {
      return { ok: false, reason: "modal submission has no components" };
    }

    const seenIds = new Set<string>();
    const resolvedAttachments = interactionData.resolved?.attachments ?? {};

    for (const component of flatComponents) {
      if (!this.isModalSubmitComponent(component)) {
        return { ok: false, reason: "modal submission contains an invalid component entry" };
      }

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
