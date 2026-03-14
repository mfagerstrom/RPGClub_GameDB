import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type RepliableInteraction,
  type StringSelectMenuInteraction,
  type TextBasedChannel,
} from "discord.js";
import {
  GOTM_NOMINATION_CHANNEL_ID,
  NR_GOTM_NOMINATION_CHANNEL_ID,
} from "../config/nominationChannels.js";
import {
  deleteNominationForUser,
  getNominationForUser,
  listNominationsForRound,
  type INominationEntry,
  type NominationKind,
} from "../classes/Nomination.js";
import {
  buildComponentsV2Flags,
  buildNominationListPayload,
  type NominationListPayload,
} from "./NominationListComponents.js";
import {
  getUpcomingNominationWindow,
  type INominationWindow,
} from "./NominationWindow.js";
import {
  buildRawModalSessionExpiry,
  createRawModalSessionRecord,
  getRawModalSessionRecord,
  isRawModalSessionExpired,
  updateRawModalSessionStatus,
} from "../services/raw-modal/RawModalSession.js";
import { safeUpdate, sanitizeUserInput } from "./InteractionUtils.js";

export const ADMIN_NOMINATION_DELETE_SELECT_PREFIX = "admin-nom-del-select";
export const ADMIN_NOMINATION_DELETE_REASON_MODAL_PREFIX = "admin-nom-del-reason";
export const ADMIN_NOMINATION_DELETE_CONFIRM_PREFIX = "admin-nom-del-confirm";
export const ADMIN_NOMINATION_DELETE_REASON_INPUT_ID = "admin-nom-del-reason-input";

type PendingDeleteSelectionState = {
  kind: NominationKind;
  round: number;
  userId: string;
  gameTitle: string;
};

type PendingDeleteConfirmState = PendingDeleteSelectionState & {
  reason: string;
};

export async function buildNominationDeleteView(
  kind: NominationKind,
  commandLabel: string,
): Promise<{ payload: NominationListPayload; controls: ActionRowBuilder<StringSelectMenuBuilder>[] } | null> {
  const window = await getUpcomingNominationWindow();
  const nominations = await listNominationsForRound(kind, window.targetRound);
  if (!nominations.length) return null;

  const payload = await buildNominationListPayload(
    kind === "gotm" ? "GOTM" : "NR-GOTM",
    commandLabel,
    window,
    nominations,
    false,
    { includeDetailSelect: false },
  );
  const controls = buildDeletionSelectControls(kind, window.targetRound, nominations);
  return { payload, controls };
}

export function buildDeletionSelectControls(
  kind: NominationKind,
  round: number,
  nominations: INominationEntry[],
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const options = nominations.map((nomination, index) => ({
    label: truncateLabel(nomination.gameTitle, 100),
    value: nomination.userId,
    description: `Nomination ${index + 1}`,
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId(buildDeletionSelectCustomId(kind, round))
    .setPlaceholder("Choose a nomination to delete")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

export function buildDeletionSelectCustomId(kind: NominationKind, round: number): string {
  return `${ADMIN_NOMINATION_DELETE_SELECT_PREFIX}:${kind}:${round}`;
}

export function buildDeletionReasonModalCustomId(sessionId: string): string {
  return `${ADMIN_NOMINATION_DELETE_REASON_MODAL_PREFIX}:${sessionId}`;
}

export function buildDeletionConfirmCustomId(sessionId: string): string {
  return `${ADMIN_NOMINATION_DELETE_CONFIRM_PREFIX}:${sessionId}`;
}

export function buildDeletionReasonModal(sessionId: string, gameTitle: string): ModalBuilder {
  const reasonInput = new TextInputBuilder()
    .setCustomId(ADMIN_NOMINATION_DELETE_REASON_INPUT_ID)
    .setLabel("Deletion reason")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(250)
    .setPlaceholder(`Why should "${truncateLabel(gameTitle, 80)}" be removed?`);

  return new ModalBuilder()
    .setCustomId(buildDeletionReasonModalCustomId(sessionId))
    .setTitle("Delete nomination")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput));
}

export async function createDeletionReasonSession(
  interaction: StringSelectMenuInteraction,
  state: PendingDeleteSelectionState,
): Promise<string> {
  const sessionId = buildNominationDeleteSessionId(interaction.user.id, state.round, state.userId);
  await createRawModalSessionRecord({
    sessionId,
    ownerUserId: interaction.user.id,
    feature: "admin",
    flow: "nomination-delete-reason",
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    stateJson: JSON.stringify(state),
    expiresAt: buildRawModalSessionExpiry(),
  });
  return sessionId;
}

export async function readDeletionReasonSession(
  sessionId: string,
  ownerUserId: string,
): Promise<PendingDeleteSelectionState | null> {
  const session = await getRawModalSessionRecord(sessionId);
  if (!session || session.ownerUserId !== ownerUserId || session.status !== "open") {
    return null;
  }
  if (isRawModalSessionExpired(session)) {
    await updateRawModalSessionStatus({ sessionId, status: "expired" });
    return null;
  }

  try {
    return JSON.parse(session.stateJson) as PendingDeleteSelectionState;
  } catch {
    return null;
  }
}

export async function markDeletionReasonSessionSubmitted(sessionId: string): Promise<void> {
  await updateRawModalSessionStatus({ sessionId, status: "submitted" });
}

export async function createDeletionConfirmSession(
  interaction: RepliableInteraction,
  state: PendingDeleteConfirmState,
): Promise<string> {
  const sessionId = buildNominationDeleteConfirmSessionId(
    interaction.user.id,
    state.round,
    state.userId,
  );
  await createRawModalSessionRecord({
    sessionId,
    ownerUserId: interaction.user.id,
    feature: "admin",
    flow: "nomination-delete-confirm",
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    stateJson: JSON.stringify(state),
    expiresAt: buildRawModalSessionExpiry(),
  });
  return sessionId;
}

export async function readDeletionConfirmSession(
  sessionId: string,
  ownerUserId: string,
): Promise<PendingDeleteConfirmState | null> {
  const session = await getRawModalSessionRecord(sessionId);
  if (!session || session.ownerUserId !== ownerUserId || session.status !== "open") {
    return null;
  }
  if (isRawModalSessionExpired(session)) {
    await updateRawModalSessionStatus({ sessionId, status: "expired" });
    return null;
  }

  try {
    return JSON.parse(session.stateJson) as PendingDeleteConfirmState;
  } catch {
    return null;
  }
}

export async function markDeletionConfirmSessionSubmitted(sessionId: string): Promise<void> {
  await updateRawModalSessionStatus({ sessionId, status: "submitted" });
}

export async function buildDeletionConfirmationView(
  kind: NominationKind,
  round: number,
  reason: string,
  confirmSessionId: string,
): Promise<{ payload: NominationListPayload; controls: ActionRowBuilder<ButtonBuilder>[] }> {
  const window = await getUpcomingNominationWindow();
  const windowForRound: INominationWindow & { targetRound: number } = {
    ...window,
    targetRound: round,
  };
  const nominations = await listNominationsForRound(kind, round);
  const payload = await buildNominationListPayload(
    kind === "gotm" ? "GOTM" : "NR-GOTM",
    "/nominate",
    windowForRound,
    nominations,
    false,
    { includeDetailSelect: false },
  );
  const controls = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildDeletionConfirmCustomId(confirmSessionId))
        .setLabel("Delete Nomination")
        .setStyle(ButtonStyle.Danger),
    ),
  ];

  payload.components.unshift(
    buildNominationNoticeContainer(`Deletion reason: ${sanitizeUserInput(reason, { preserveNewlines: true })}`),
  );

  return { payload, controls };
}

export async function handleNominationDeletionButton(
  interaction: ButtonInteraction,
  sessionId: string,
): Promise<void> {
  const state = await readDeletionConfirmSession(sessionId, interaction.user.id);
  if (!state) {
    await safeUpdate(interaction, {
      components: [
        buildNominationNoticeContainer(
          "This nomination deletion confirmation is no longer valid. Run the admin delete command again.",
        ),
      ],
      flags: buildComponentsV2Flags(true),
    });
    return;
  }

  const nomination = await getNominationForUser(state.kind, state.round, state.userId);
  if (!nomination) {
    await markDeletionConfirmSessionSubmitted(sessionId);
    await safeUpdate(interaction, {
      components: [
        buildNominationNoticeContainer(
          `No ${state.kind.toUpperCase()} nomination found for Round ${state.round} and user <@${state.userId}>.`,
        ),
      ],
      flags: buildComponentsV2Flags(true),
    });
    return;
  }

  await deleteNominationForUser(state.kind, state.round, state.userId);
  await markDeletionConfirmSessionSubmitted(sessionId);

  const window = await getUpcomingNominationWindow();
  const windowForRound: INominationWindow & { targetRound: number } = {
    ...window,
    targetRound: state.round,
  };
  const nominations = await listNominationsForRound(state.kind, state.round);
  const payload = await buildNominationListPayload(
    state.kind === "gotm" ? "GOTM" : "NR-GOTM",
    "/nominate",
    windowForRound,
    nominations,
    false,
  );

  const content =
    `<@${interaction.user.id}> deleted <@${state.userId}>'s nomination ` +
    `"${nomination.gameTitle}" for ${state.kind.toUpperCase()} Round ${state.round}. ` +
    `Reason: ${state.reason}`;

  await safeUpdate(interaction, {
    components: [buildNominationNoticeContainer(content), ...payload.components],
    files: payload.files,
    flags: buildComponentsV2Flags(true),
  });

  await announceNominationChange(state.kind, interaction, content, payload);
}

export async function announceNominationChange(
  kind: NominationKind,
  interaction: RepliableInteraction,
  content: string,
  payload: NominationListPayload,
): Promise<void> {
  const channelId =
    kind === "gotm" ? GOTM_NOMINATION_CHANNEL_ID : NR_GOTM_NOMINATION_CHANNEL_ID;

  try {
    const channel = await (interaction.client as any).channels.fetch(channelId);
    const textChannel: TextBasedChannel | null = channel?.isTextBased()
      ? (channel as TextBasedChannel)
      : null;
    if (!textChannel || !isSendableTextChannel(textChannel)) return;
    await textChannel.send({
      components: [buildNominationNoticeContainer(content), ...payload.components],
      files: payload.files,
      flags: buildComponentsV2Flags(false),
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    console.error(`Failed to announce nomination change in channel ${channelId}:`, err);
  }
}

export function parseDeletionSelectCustomId(
  customId: string,
): { kind: NominationKind; round: number } | null {
  const match = customId.match(/^admin-nom-del-select:(gotm|nr-gotm):(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    kind: match[1] as NominationKind,
    round: Number(match[2]),
  };
}

export function parseDeletionReasonModalCustomId(customId: string): { sessionId: string } | null {
  const match = customId.match(/^admin-nom-del-reason:([A-Za-z0-9_-]{1,64})$/);
  if (!match || !match[1]) {
    return null;
  }
  return { sessionId: match[1] };
}

export function parseDeletionConfirmCustomId(customId: string): { sessionId: string } | null {
  const match = customId.match(/^admin-nom-del-confirm:([A-Za-z0-9_-]{1,64})$/);
  if (!match || !match[1]) {
    return null;
  }
  return { sessionId: match[1] };
}

function buildNominationDeleteSessionId(userId: string, round: number, nominationUserId: string): string {
  return `admndr_${userId.slice(-6)}_${round}_${nominationUserId.slice(-6)}_${Date.now().toString(36)}`;
}

function buildNominationDeleteConfirmSessionId(
  userId: string,
  round: number,
  nominationUserId: string,
): string {
  return `admndc_${userId.slice(-6)}_${round}_${nominationUserId.slice(-6)}_${Date.now().toString(36)}`;
}

function buildNominationNoticeContainer(content: string): ContainerBuilder {
  return new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(content),
  );
}

function isSendableTextChannel(channel: TextBasedChannel | null): channel is TextBasedChannel & {
  send: (content: any) => Promise<any>;
} {
  return Boolean(channel && typeof (channel as any).send === "function");
}

function truncateLabel(label: string, maxLength: number): string {
  if (label.length <= maxLength) {
    return label;
  }
  return `${label.slice(0, maxLength - 3)}...`;
}
