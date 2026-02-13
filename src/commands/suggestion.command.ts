import type { ButtonInteraction, CommandInteraction } from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
  TextDisplayBuilder,
} from "discord.js";
import {
  ComponentType as ApiComponentType,
  TextInputStyle as ApiTextInputStyle,
  type APIModalInteractionResponseCallbackComponent,
} from "discord-api-types/v10";
import {
  ButtonComponent,
  Discord,
  ModalComponent,
  Slash,
} from "discordx";
import {
  safeDeferReply,
  safeReply,
  safeUpdate,
  sanitizeUserInput,
} from "../functions/InteractionUtils.js";
import {
  createSuggestion,
  deleteSuggestion,
  getSuggestionById,
  listSuggestions,
  countSuggestions,
} from "../classes/Suggestion.js";
import {
  deleteSuggestionReviewSession,
  getSuggestionReviewSession,
  type ISuggestionReviewSession,
} from "../classes/SuggestionReviewSession.js";
import { createIssue } from "../services/GithubIssuesService.js";
import { BOT_DEV_CHANNEL_ID, GAMEDB_UPDATES_CHANNEL_ID } from "../config/channels.js";
import { BOT_DEV_PING_USER_ID } from "../config/users.js";
import { COMPONENTS_V2_FLAG } from "../config/flags.js";
import { RawModalApiService } from "../services/raw-modal/RawModalApiService.js";
import { logRawModal } from "../services/raw-modal/RawModalLogging.js";

const SUGGESTION_APPROVE_PREFIX = "suggestion-approve";
const SUGGESTION_CREATE_MODAL_ID = "suggestion-create-modal";
const SUGGESTION_CREATE_TITLE_ID = "suggestion-create-title";
const SUGGESTION_CREATE_DETAILS_ID = "suggestion-create-details";
const SUGGESTION_CREATE_TYPE_ID = "suggestion-create-type";
const SUGGESTION_LABELS = ["New Feature", "Improvement", "Bug", "Blocked"] as const;
type SuggestionLabel = (typeof SUGGESTION_LABELS)[number];
const SUGGESTION_REVIEW_PREFIX = "suggestion-review";
const SUGGESTION_REVIEW_DECISION_MODAL_PREFIX = "suggestion-review-decision";
const SUGGESTION_REVIEW_SUMMARY_ID = "suggestion-review-summary";
const SUGGESTION_REVIEW_DECISION_ID = "suggestion-review-decision-choice";
const SUGGESTION_REVIEW_REASON_ID = "suggestion-review-decision-reason";
const SUGGESTION_REVIEW_TTL_MS = 15 * 60 * 1000;
type SuggestionReviewSession = ISuggestionReviewSession;
const MAX_MODAL_TEXT_INPUT_VALUE = 4000;

function formatErrorForLog(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isSuggestionReviewSessionExpired(session: SuggestionReviewSession): boolean {
  const lastActivity = session.updatedAt ?? session.createdAt;
  return Date.now() - lastActivity.getTime() > SUGGESTION_REVIEW_TTL_MS;
}

async function loadSuggestionReviewSession(
  sessionId: string,
  reviewerId: string,
): Promise<SuggestionReviewSession | null> {
  const session = await getSuggestionReviewSession(sessionId);
  if (!session) return null;
  if (session.reviewerId !== reviewerId) return null;
  if (isSuggestionReviewSessionExpired(session)) {
    await deleteSuggestionReviewSession(sessionId);
    return null;
  }
  return session;
}

function buildComponentsV2Flags(isEphemeral: boolean): number {
  return (isEphemeral ? MessageFlags.Ephemeral : 0) | COMPONENTS_V2_FLAG;
}

function parseSuggestionReviewActionId(
  customId: string,
): { action: string; sessionId: string; reviewerId: string } | null {
  const parts = customId.split(":");
  if (parts.length !== 4 || parts[0] !== SUGGESTION_REVIEW_PREFIX) {
    return null;
  }
  const [, action, sessionId, reviewerId] = parts;
  return action && sessionId && reviewerId ? { action, sessionId, reviewerId } : null;
}

function buildSuggestionReviewDecisionModalId(
  reviewerId: string,
  suggestionId: number,
): string {
  return `${SUGGESTION_REVIEW_DECISION_MODAL_PREFIX}:${reviewerId}:${suggestionId}`;
}

function parseSuggestionReviewDecisionModalId(
  customId: string,
): { reviewerId: string; suggestionId: number } | null {
  const parts = customId.split(":");
  if (parts.length !== 3 || parts[0] !== SUGGESTION_REVIEW_DECISION_MODAL_PREFIX) {
    return null;
  }
  const suggestionId = Number(parts[2]);
  if (!Number.isInteger(suggestionId) || suggestionId <= 0) {
    return null;
  }
  const reviewerId = parts[1];
  return reviewerId ? { reviewerId, suggestionId } : null;
}

function buildSuggestionReviewDecisionComponents(
  summaryText: string,
): APIModalInteractionResponseCallbackComponent[] {
  const summaryValue = summaryText.length > MAX_MODAL_TEXT_INPUT_VALUE
    ? `${summaryText.slice(0, MAX_MODAL_TEXT_INPUT_VALUE - 3)}...`
    : summaryText;

  return [
    {
      type: ApiComponentType.ActionRow,
      components: [
        {
          type: ApiComponentType.TextInput,
          custom_id: SUGGESTION_REVIEW_SUMMARY_ID,
          label: "Suggestion Review",
          style: ApiTextInputStyle.Paragraph,
          required: false,
          max_length: MAX_MODAL_TEXT_INPUT_VALUE,
          value: summaryValue,
        },
      ],
    },
    {
      type: ApiComponentType.Label,
      label: "Review Decision",
      description: "Choose one action",
      component: {
        type: ApiComponentType.RadioGroup,
        custom_id: SUGGESTION_REVIEW_DECISION_ID,
        required: true,
        options: [
          {
            label: "Accept",
            value: "accept",
            description: "Create GitHub issue from this suggestion",
          },
          {
            label: "Reject",
            value: "reject",
            description: "Reject and notify the suggestion author",
          },
          {
            label: "Skip",
            value: "skip",
            description: "Keep this suggestion pending and move to the next",
          },
        ],
      },
    },
    {
      type: ApiComponentType.ActionRow,
      components: [
        {
          type: ApiComponentType.TextInput,
          custom_id: SUGGESTION_REVIEW_REASON_ID,
          label: "Rejection reason (required when Reject)",
          style: ApiTextInputStyle.Paragraph,
          required: false,
          max_length: 1000,
        },
      ],
    },
  ];
}

async function openSuggestionReviewDecisionModal(
  interaction: ButtonInteraction,
  reviewerId: string,
  suggestionId: number,
  summaryText: string,
): Promise<void> {
  const customId = buildSuggestionReviewDecisionModalId(reviewerId, suggestionId);
  logRawModal("info", "suggestion.review_modal.open_attempt", {
    feature: "suggestion",
    flow: "review-decision",
    userId: interaction.user.id,
    customId,
    reason: `suggestionId=${suggestionId} summaryLen=${summaryText.length}`,
  });

  const modalApi = new RawModalApiService({
    applicationId: interaction.applicationId,
  });
  try {
    await modalApi.openModal({
      interactionId: interaction.id,
      interactionToken: interaction.token,
      feature: "suggestion",
      flow: "review-decision",
      sessionId: `suggestion-${suggestionId}`,
      customId,
      title: "Suggestion Review Decision",
      components: buildSuggestionReviewDecisionComponents(summaryText),
    });
    logRawModal("info", "suggestion.review_modal.open_success", {
      feature: "suggestion",
      flow: "review-decision",
      userId: interaction.user.id,
      customId,
    });
  } catch (error: unknown) {
    logRawModal("error", "suggestion.review_modal.open_failed", {
      feature: "suggestion",
      flow: "review-decision",
      userId: interaction.user.id,
      customId,
      error: formatErrorForLog(error),
    });
    throw error;
  }
}



function formatSuggestionTimestampPlain(date: Date | null | undefined): string {
  if (!date) return "Unknown";
  try {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "long",
      day: "2-digit",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function buildSuggestionReviewSummaryText(
  suggestion: Awaited<ReturnType<typeof getSuggestionById>>,
  index: number,
  total: number,
): string {
  if (!suggestion) {
    return "No pending suggestions found.";
  }

  const labels = suggestion.labels ? suggestion.labels : "None";
  const authorLabel = suggestion.createdByName
    ? `${suggestion.createdByName} (${suggestion.createdBy ?? "Unknown"})`
    : (suggestion.createdBy ?? "Unknown");
  const details = suggestion.details ?? "No details provided.";

  return [
    "Suggestion Review",
    "-----------------",
    `Suggestion: #${suggestion.suggestionId} - ${suggestion.title}`,
    `Labels: ${labels}`,
    `Submitted by: ${authorLabel}`,
    `Submitted: ${formatSuggestionTimestampPlain(suggestion.createdAt)}`,
    `Position: ${index + 1} of ${total}`,
    "",
    "Details:",
    details,
  ].join("\n");
}

function extractReviewDecisionFromInteraction(
  interaction: ModalSubmitInteraction,
): { decision: string | null; reason: string } {
  let decision: string | null = null;

  const components = (interaction.components ?? []) as Array<{
    type?: number;
    components?: Array<{ customId?: string; value?: unknown; values?: unknown }>;
    component?: { customId?: string; value?: unknown; values?: unknown };
  }>;

  const flatFields: Array<{ customId?: string; value?: unknown; values?: unknown }> = [];
  for (const topLevel of components) {
    if (!topLevel || typeof topLevel !== "object") {
      continue;
    }
    if (Array.isArray(topLevel.components)) {
      flatFields.push(...topLevel.components);
      continue;
    }
    if (topLevel.component && typeof topLevel.component === "object") {
      flatFields.push(topLevel.component);
    }
  }

  for (const field of flatFields) {
    if (!field || field.customId !== SUGGESTION_REVIEW_DECISION_ID) {
      continue;
    }
    if (typeof field.value === "string") {
      decision = field.value;
      break;
    }
    if (Array.isArray(field.values) && typeof field.values[0] === "string") {
      decision = field.values[0];
      break;
    }
  }

  let reason = "";
  try {
    const rawReason = interaction.fields.getTextInputValue(SUGGESTION_REVIEW_REASON_ID);
    reason = sanitizeUserInput(rawReason, { preserveNewlines: true });
  } catch {
    reason = "";
  }

  return { decision, reason };
}

function buildSuggestionReviewContainer(
  suggestion: Awaited<ReturnType<typeof getSuggestionById>>,
  index: number,
  total: number,
  totalCount: number,
): ContainerBuilder {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Suggestion Review"),
  );

  if (!suggestion) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("No pending suggestions found."),
    );
    return container;
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      buildSuggestionReviewSummaryText(suggestion, index, total),
    ),
  );

  if (totalCount > total) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `Showing ${total} most recent suggestions out of ${totalCount}.`,
      ),
    );
  }
  return container;
}

async function getCurrentSuggestionForReview(
  session: SuggestionReviewSession,
): Promise<{ suggestion: Awaited<ReturnType<typeof getSuggestionById>>; index: number; total: number }> {
  while (session.index < session.suggestionIds.length) {
    const suggestionId = session.suggestionIds[session.index];
    const suggestion = await getSuggestionById(suggestionId);
    if (suggestion) {
      return {
        suggestion,
        index: session.index,
        total: session.suggestionIds.length,
      };
    }
    session.suggestionIds.splice(session.index, 1);
  }

  return {
    suggestion: null,
    index: Math.max(0, session.suggestionIds.length - 1),
    total: session.suggestionIds.length,
  };
}

function getSuggestionAuthorMention(
  suggestion: Awaited<ReturnType<typeof getSuggestionById>>,
): string {
  return suggestion?.createdBy ? `<@${suggestion.createdBy}>` : "Unknown user";
}

async function sendSuggestionUpdateMessage(
  interaction: CommandInteraction | ButtonInteraction | ModalSubmitInteraction,
  content: string,
): Promise<void> {
  try {
    const channel = await interaction.client.channels.fetch(GAMEDB_UPDATES_CHANNEL_ID);
    if (channel && "send" in channel) {
      await (channel as any).send({ content });
    }
  } catch {
    // ignore notification failures
  }
}

function buildSuggestionApproveId(suggestionId: number): string {
  return `${SUGGESTION_APPROVE_PREFIX}:${suggestionId}`;
}

function parseSuggestionApproveId(id: string): number | null {
  const parts = id.split(":");
  if (parts.length !== 2 || parts[0] !== SUGGESTION_APPROVE_PREFIX) {
    return null;
  }
  const suggestionId = Number(parts[1]);
  return Number.isInteger(suggestionId) && suggestionId > 0 ? suggestionId : null;
}

function buildSuggestionCreateModal(): ModalBuilder {
  const titleInput = new TextInputBuilder()
    .setCustomId(SUGGESTION_CREATE_TITLE_ID)
    .setLabel("Title")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(256);

  const detailsInput = new TextInputBuilder()
    .setCustomId(SUGGESTION_CREATE_DETAILS_ID)
    .setLabel("Description")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(4000);

  const modal = new ModalBuilder()
    .setCustomId(SUGGESTION_CREATE_MODAL_ID)
    .setTitle("Submit Suggestion")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(detailsInput),
    );

  modal.addLabelComponents((label) =>
    label
      .setLabel("Suggestion Type(s)")
      .setDescription("Select one or more suggestion types")
      .setStringSelectMenuComponent((builder) =>
        builder
          .setCustomId(SUGGESTION_CREATE_TYPE_ID)
          .setPlaceholder("Select type(s)")
          .setMinValues(1)
          .setMaxValues(SUGGESTION_LABELS.length)
          .addOptions(
            SUGGESTION_LABELS.map((typeLabel) => ({
              label: typeLabel,
              value: typeLabel,
            })),
          )),
  );

  return modal;
}

function parseSuggestionLabels(values: readonly string[]): SuggestionLabel[] {
  const validValues = new Set(SUGGESTION_LABELS);
  return values
    .filter((value): value is SuggestionLabel => validValues.has(value as SuggestionLabel))
    .filter((value, index, arr) => arr.indexOf(value) === index);
}

@Discord()
export class SuggestionCommand {
  @Slash({ description: "Submit a bot suggestion", name: "suggestion" })
  async suggestion(interaction: CommandInteraction): Promise<void> {
    await interaction.showModal(buildSuggestionCreateModal()).catch(async () => {
      await safeReply(interaction, {
        content: "Unable to open the suggestion form.",
        flags: MessageFlags.Ephemeral,
      });
    });
  }

  @ModalComponent({ id: /^suggestion-create-modal$/ })
  async submitSuggestionCreateModal(interaction: ModalSubmitInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const rawTitle = interaction.fields.getTextInputValue(SUGGESTION_CREATE_TITLE_ID);
    const rawDetails = interaction.fields.getTextInputValue(SUGGESTION_CREATE_DETAILS_ID);
    const selectedLabels = parseSuggestionLabels(
      interaction.fields.getStringSelectValues(SUGGESTION_CREATE_TYPE_ID),
    );
    const trimmedTitle = sanitizeUserInput(rawTitle, { preserveNewlines: false });
    if (!trimmedTitle) {
      await safeReply(interaction, {
        content: "Title cannot be empty.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const trimmedDetails = sanitizeUserInput(rawDetails, { preserveNewlines: true });
    if (!trimmedDetails) {
      await safeReply(interaction, {
        content: "Details cannot be empty.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (selectedLabels.length === 0) {
      await safeReply(interaction, {
        content: "Select at least one suggestion type.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const suggestion = await createSuggestion(
      trimmedTitle,
      trimmedDetails,
      selectedLabels.join(", "),
      interaction.user.id,
      interaction.user.username,
    );

    await safeReply(interaction, {
      content: `Thanks! Suggestion #${suggestion.suggestionId} submitted.`,
      flags: MessageFlags.Ephemeral,
    });

    try {
      const channel = await interaction.client.channels.fetch(BOT_DEV_CHANNEL_ID);
      if (channel && "send" in channel) {
        await (channel as any).send({
          content:
            `<@${BOT_DEV_PING_USER_ID}> ${interaction.user.username} has submitted a suggestion!`,
        });
      }
    } catch {
      // ignore notification failures
    }
  }

  @ButtonComponent({ id: /^todo-review-suggestions$/ })
  async reviewSuggestionsFromTodo(interaction: ButtonInteraction): Promise<void> {
    logRawModal("info", "suggestion.review_button.clicked", {
      feature: "suggestion",
      flow: "review-decision",
      userId: interaction.user.id,
      customId: interaction.customId,
      reason: `guildId=${interaction.guildId ?? "none"} channelId=${interaction.channelId ?? "none"}`,
    });

    const isOwner = interaction.guild?.ownerId === interaction.user.id;
    const isBotDev = interaction.user.id === BOT_DEV_PING_USER_ID;
    if (!isOwner && !isBotDev) {
      logRawModal("warn", "suggestion.review_button.denied", {
        feature: "suggestion",
        flow: "review-decision",
        userId: interaction.user.id,
        customId: interaction.customId,
        reason: "not_owner_or_bot_dev",
      });
      await safeReply(interaction, {
        content: "Only the server owner or bot dev can review suggestions.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const [suggestions, totalCount] = await Promise.all([
      listSuggestions(1),
      countSuggestions(),
    ]);

    if (!suggestions.length) {
      logRawModal("info", "suggestion.review_button.no_pending", {
        feature: "suggestion",
        flow: "review-decision",
        userId: interaction.user.id,
        customId: interaction.customId,
      });
      await safeReply(interaction, {
        content: "No pending suggestions to review.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const currentSuggestion = suggestions[0];
    if (!currentSuggestion) {
      logRawModal("warn", "suggestion.review_button.missing_first", {
        feature: "suggestion",
        flow: "review-decision",
        userId: interaction.user.id,
        customId: interaction.customId,
        reason: `totalCount=${totalCount}`,
      });
      await safeReply(interaction, {
        content: "No pending suggestions to review.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const summaryText = buildSuggestionReviewSummaryText(
      currentSuggestion,
      0,
      Math.max(totalCount, 1),
    );

    try {
      await openSuggestionReviewDecisionModal(
        interaction,
        interaction.user.id,
        currentSuggestion.suggestionId,
        summaryText,
      );
    } catch (error: unknown) {
      logRawModal("error", "suggestion.review_button.open_failed", {
        feature: "suggestion",
        flow: "review-decision",
        userId: interaction.user.id,
        customId: interaction.customId,
        reason: `suggestionId=${currentSuggestion.suggestionId}`,
        error: formatErrorForLog(error),
      });
      await safeReply(interaction, {
        content: "Unable to open the review decision form.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @ButtonComponent({ id: /^suggestion-approve:\d+$/ })
  async approveSuggestion(interaction: ButtonInteraction): Promise<void> {
    const suggestionId = parseSuggestionApproveId(interaction.customId);
    if (!suggestionId) {
      await safeUpdate(interaction, { components: [] });
      return;
    }

    const isOwner = interaction.guild?.ownerId === interaction.user.id;
    const isBotDev = interaction.user.id === BOT_DEV_PING_USER_ID;
    if (!isOwner && !isBotDev) {
      await safeReply(interaction, {
        content: "Only the server owner or bot dev can approve suggestions.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const suggestion = await getSuggestionById(suggestionId);
    if (!suggestion) {
      await safeReply(interaction, {
        content: "Suggestion not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const authorName = suggestion.createdByName ?? "Unknown";
    const description = suggestion.details ?? "No details provided.";
    const body = `${authorName}: ${description}`;
    const labels = suggestion.labels
      ? suggestion.labels.split(",").map((label) => label.trim()).filter(Boolean)
      : [];

    let issue;
    try {
      issue = await createIssue({
        title: suggestion.title,
        body,
        labels,
      });
      await deleteSuggestion(suggestionId);
    } catch (err: any) {
      await safeReply(interaction, {
        content: err?.message ?? "Failed to create GitHub issue.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const authorMention = getSuggestionAuthorMention(suggestion);
    await sendSuggestionUpdateMessage(
      interaction,
      `${authorMention} Your suggestion was accepted and logged as GitHub issue #${issue.number}: ${issue.htmlUrl}`,
    );

    const approvedRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildSuggestionApproveId(suggestionId))
        .setLabel("Approved")
        .setStyle(ButtonStyle.Success)
        .setDisabled(true),
    );

    await safeUpdate(interaction, {
      components: [approvedRow],
    });
  }

  @ButtonComponent({ id: /^suggestion-review:.+$/ })
  async reviewSuggestionAction(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseSuggestionReviewActionId(interaction.customId);
    if (!parsed) {
      await safeUpdate(interaction, { components: [] });
      return;
    }

    if (parsed.reviewerId !== interaction.user.id) {
      await safeReply(interaction, {
        content: "This review prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const session = await loadSuggestionReviewSession(parsed.sessionId, parsed.reviewerId);
    if (!session) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          "This suggestion review has expired. Start again from /todo.",
        ),
      );
      await safeUpdate(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (parsed.action === "cancel") {
      await deleteSuggestionReviewSession(parsed.sessionId);
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Suggestion review closed."),
      );
      await safeUpdate(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (parsed.action === "decide") {
      const current = await getCurrentSuggestionForReview(session);
      if (!current.suggestion) {
        const container = buildSuggestionReviewContainer(null, 0, 0, session.totalCount);
        await safeUpdate(interaction, {
          components: [container],
          flags: buildComponentsV2Flags(true),
        });
        return;
      }
      try {
        await openSuggestionReviewDecisionModal(
          interaction,
          parsed.reviewerId,
          current.suggestion.suggestionId,
          buildSuggestionReviewSummaryText(
            current.suggestion,
            current.index,
            Math.max(current.total, 1),
          ),
        );
      } catch (error: unknown) {
        logRawModal("error", "suggestion.review_action.open_failed", {
          feature: "suggestion",
          flow: "review-decision",
          userId: interaction.user.id,
          customId: interaction.customId,
          reason: `suggestionId=${current.suggestion.suggestionId}`,
          error: formatErrorForLog(error),
        });
        await safeReply(interaction, {
          content: "Unable to open the review decision form.",
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }
  }

  @ModalComponent({ id: /^suggestion-review-decision:.+:\d+$/ })
  async submitSuggestionReviewDecision(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseSuggestionReviewDecisionModalId(interaction.customId);
    if (!parsed) {
      await safeReply(interaction, {
        content: "This review decision form expired.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (parsed.reviewerId !== interaction.user.id) {
      await safeReply(interaction, {
        content: "This review prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const modalApi = new RawModalApiService({
      applicationId: interaction.applicationId,
    });
    const submit = modalApi.parseSubmit(interaction.toJSON());
    const fallbackExtracted = extractReviewDecisionFromInteraction(interaction);
    if (!submit) {
      logRawModal("warn", "suggestion.review_submit.fallback_parser_used", {
        feature: "suggestion",
        flow: "review-decision",
        userId: interaction.user.id,
        customId: interaction.customId,
        reason: `decision=${fallbackExtracted.decision ?? "null"} reasonLen=${fallbackExtracted.reason.length}`,
      });
    }

    const rawDecision = submit?.values[SUGGESTION_REVIEW_DECISION_ID];
    const decision = typeof rawDecision === "string" ? rawDecision : fallbackExtracted.decision;
    if (decision !== "accept" && decision !== "reject" && decision !== "skip") {
      await safeReply(interaction, {
        content: "Select Accept, Reject, or Skip.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const rawReason = submit?.values[SUGGESTION_REVIEW_REASON_ID];
    const reason = typeof rawReason === "string"
      ? sanitizeUserInput(rawReason, { preserveNewlines: true })
      : fallbackExtracted.reason;

    if (decision === "reject" && !reason) {
      await safeReply(interaction, {
        content: "Rejection reason cannot be empty when Reject is selected.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    if (decision === "accept") {
      const suggestion = await getSuggestionById(parsed.suggestionId);
      if (suggestion) {
        const authorName = suggestion.createdByName ?? "Unknown";
        const description = suggestion.details ?? "No details provided.";
        const body = `${authorName}: ${description}`;
        const labels = suggestion.labels
          ? suggestion.labels.split(",").map((label) => label.trim()).filter(Boolean)
          : [];

        let issue;
        try {
          issue = await createIssue({
            title: suggestion.title,
            body,
            labels,
          });
          await deleteSuggestion(parsed.suggestionId);
        } catch (err: any) {
          await safeReply(interaction, {
            content: err?.message ?? "Failed to create GitHub issue.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const authorMention = getSuggestionAuthorMention(suggestion);
        await sendSuggestionUpdateMessage(
          interaction,
          `${authorMention} Your suggestion was accepted and logged as GitHub issue #${issue.number}: ${issue.htmlUrl}`,
        );
      }

    } else if (decision === "reject") {
      const suggestion = await getSuggestionById(parsed.suggestionId);
      if (suggestion) {
        try {
          await deleteSuggestion(parsed.suggestionId);
        } catch (err: any) {
          await safeReply(interaction, {
            content: err?.message ?? "Failed to reject suggestion.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const authorMention = getSuggestionAuthorMention(suggestion);
        await sendSuggestionUpdateMessage(
          interaction,
          `${authorMention} Your suggestion "${suggestion.title}" was not accepted. Reason: ${reason}`,
        );
      }

    } else {
      // Skip keeps suggestion pending; reviewer can open the next form from /todo.
    }

    const remainingCount = await countSuggestions();
    const outcomeLabel = decision === "accept"
      ? "Accepted."
      : decision === "reject"
        ? "Rejected."
        : "Skipped.";
    await safeReply(interaction, {
      content: remainingCount > 0
        ? `${outcomeLabel} ${remainingCount} suggestion(s) remain. Use Review Suggestions again from /todo.`
        : `${outcomeLabel} No pending suggestions remain.`,
      flags: MessageFlags.Ephemeral,
    });
  }

}
