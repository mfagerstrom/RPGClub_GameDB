import {
  ActionRowBuilder,
  ContainerBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  type RepliableInteraction,
  type TextBasedChannel,
} from "discord.js";
import {
  GOTM_NOMINATION_CHANNEL_ID,
  NR_GOTM_NOMINATION_CHANNEL_ID,
} from "../config/nominationChannels.js";
import {
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
} from "./NominationWindow.js";

export const ADMIN_NOMINATION_DELETE_SELECT_PREFIX = "admin-nom-del-select";
export const ADMIN_NOMINATION_DELETE_REASON_MODAL_PREFIX = "admin-nom-del-reason";
export const ADMIN_NOMINATION_DELETE_REASON_INPUT_ID = "admin-nom-del-reason-input";

type PendingDeleteSelectionState = {
  kind: NominationKind;
  round: number;
  userId: string;
  gameTitle: string;
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

export function buildDeletionReasonModalCustomId(kind: NominationKind, round: number, userId: string): string {
  return buildDeletionReasonStateId(kind, round, userId);
}

export function buildDeletionReasonModal(
  kind: NominationKind,
  round: number,
  userId: string,
  gameTitle: string,
): ModalBuilder {
  const reasonInput = new TextInputBuilder()
    .setCustomId(ADMIN_NOMINATION_DELETE_REASON_INPUT_ID)
    .setLabel("Deletion reason")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(250)
    .setPlaceholder(`Why should "${truncateLabel(gameTitle, 80)}" be removed?`);

  return new ModalBuilder()
    .setCustomId(buildDeletionReasonModalCustomId(kind, round, userId))
    .setTitle("Delete nomination")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput));
}

export function buildDeletionReasonState(
  kind: NominationKind,
  round: number,
  userId: string,
  gameTitle: string,
): PendingDeleteSelectionState {
  return {
    kind,
    round,
    userId,
    gameTitle,
  };
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
  const state = parseDeletionReasonStateId(customId);
  if (!state) {
    return null;
  }
  return { sessionId: customId };
}

export function parseDeletionReasonStateId(
  stateId: string,
): PendingDeleteSelectionState | null {
  const match = stateId.match(/^admin-nom-del-reason:(gotm|nr-gotm):(\d+):(\d+)$/);
  if (!match || !match[1] || !match[2] || !match[3]) {
    return null;
  }

  return {
    kind: match[1] as NominationKind,
    round: Number(match[2]),
    userId: match[3],
    gameTitle: "",
  };
}

function buildDeletionReasonStateId(kind: NominationKind, round: number, userId: string): string {
  return `${ADMIN_NOMINATION_DELETE_REASON_MODAL_PREFIX}:${kind}:${round}:${userId}`;
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
