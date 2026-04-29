import {
  ActionRowBuilder,
  AttachmentBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
} from "discord.js";
import {
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import { SeparatorSpacingSize } from "discord-api-types/v10";
import type { INominationEntry } from "../classes/Nomination.js";
import Game from "../classes/Game.js";
import { COMPONENTS_V2_FLAG } from "../config/flags.js";
import { composeVoteImage, type VoteImageType } from "../services/voteImageComposer.js";

const MAX_SECTIONS_PER_CONTAINER = 10;
const MAX_REASON_LENGTH = 1500;
const MAX_SELECT_OPTIONS = 25;

export type NominationWindow = {
  closesAt: Date;
  nextVoteAt: Date;
  targetRound: number;
};

export type NominationListPayload = {
  components: Array<ContainerBuilder | ActionRowBuilder<StringSelectMenuBuilder>>;
  files: AttachmentBuilder[];
};

export function buildComponentsV2Flags(isEphemeral: boolean): number {
  return (isEphemeral ? MessageFlags.Ephemeral : 0) | COMPONENTS_V2_FLAG;
}

export async function buildNominationListPayload(
  kindLabel: string,
  commandLabel: string,
  window: NominationWindow,
  nominations: INominationEntry[],
  altLayout: boolean,
  options?: { includeDetailSelect?: boolean },
): Promise<NominationListPayload> {
  const { files, voteImageUrl } = await buildNominationAttachments(
    kindLabel,
    window.targetRound,
    nominations,
  );
  const components = buildNominationContainers(
    kindLabel,
    commandLabel,
    window,
    nominations,
    voteImageUrl,
    altLayout,
    options?.includeDetailSelect ?? true,
  );
  return { components, files };
}

function buildNominationContainers(
  kindLabel: string,
  commandLabel: string,
  window: NominationWindow,
  nominations: INominationEntry[],
  voteImageUrl: string | null,
  altLayout: boolean,
  includeDetailSelect: boolean,
): Array<ContainerBuilder | ActionRowBuilder<StringSelectMenuBuilder>> {
  const containers: ContainerBuilder[] = [];
  let container = new ContainerBuilder();
  addVoteImageToContainer(container, voteImageUrl);
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
  );

  if (!nominations.length) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("No nominations yet."),
    );
    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
    );
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(buildFooterContent(commandLabel, window)),
    );
    return [container];
  }

  let sectionCount = 0;
  nominations.forEach((nomination) => {
    if (sectionCount >= MAX_SECTIONS_PER_CONTAINER) {
      containers.push(container);
      container = new ContainerBuilder();
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Continued"));
      container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
      );
      sectionCount = 0;
    }
    if (sectionCount > 0) {
      container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
      );
    }
    addNominationContent(
      container,
      nomination,
    );
    sectionCount += 1;
  });

  containers.push(container);
  const lastContainer = containers[containers.length - 1];
  if (lastContainer) {
    lastContainer.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
    );
    lastContainer.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(buildFooterContent(commandLabel, window)),
    );
  }
  const selectRows = includeDetailSelect ? buildNominationSelectRows(nominations, kindLabel) : [];
  return [...containers, ...selectRows];
}

function addNominationContent(
  container: ContainerBuilder,
  nomination: INominationEntry,
): void {
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(buildNominationText(nomination)),
  );
}

function buildNominationText(nomination: INominationEntry): string {
  if (nomination.reason) {
    return `### ${nomination.gameTitle}\n<@${nomination.userId}> ${trimReason(nomination.reason)}`;
  }
  return `### ${nomination.gameTitle}\n<@${nomination.userId}> nominated this title, but did not provide a reason.`;
}

function buildFooterContent(commandLabel: string, window: NominationWindow): string {
  const voteLabel = formatDate(window.nextVoteAt);
  return `-# Round ${window.targetRound} voting will open on ${voteLabel}. Nominate a game (or edit your existing nomination) with ${commandLabel}.`;
}

function buildNominationSelectRows(
  nominations: INominationEntry[],
  kindLabel: string,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const options = buildNominationSelectOptions(nominations);
  if (!options.length) {
    return [];
  }
  const rows: ActionRowBuilder<StringSelectMenuBuilder>[] = [];
  for (let i = 0; i < options.length; i += MAX_SELECT_OPTIONS) {
    const slice = options.slice(i, i + MAX_SELECT_OPTIONS);
    const select = new StringSelectMenuBuilder()
      .setCustomId(buildNominationSelectId(kindLabel, rows.length))
      .setPlaceholder("View a Nomination's details...")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(slice);
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
  }
  return rows;
}

function buildNominationSelectOptions(
  nominations: INominationEntry[],
): { label: string; value: string }[] {
  const seen = new Set<number>();
  const options: { label: string; value: string }[] = [];
  nominations.forEach((nomination) => {
    if (seen.has(nomination.gamedbGameId)) {
      return;
    }
    seen.add(nomination.gamedbGameId);
    options.push({
      label: truncateLabel(nomination.gameTitle, 100),
      value: nomination.gamedbGameId.toString(),
    });
  });
  return options;
}

function buildNominationSelectId(kindLabel: string, index: number): string {
  const prefix = kindLabel.toLowerCase() === "nr-gotm" ? "nr-gotm" : "gotm";
  return `${prefix}-nom-details:${index}`;
}

function truncateLabel(label: string, maxLength: number): string {
  if (label.length <= maxLength) {
    return label;
  }
  return `${label.slice(0, maxLength - 3)}...`;
}

function trimReason(reason: string): string {
  if (reason.length <= MAX_REASON_LENGTH) {
    return reason;
  }
  return `${reason.slice(0, MAX_REASON_LENGTH - 3)}...`;
}

function formatDate(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:D>`;
}

async function buildNominationAttachments(
  kindLabel: string,
  roundNumber: number,
  nominations: INominationEntry[],
): Promise<{
  files: AttachmentBuilder[];
  voteImageUrl: string | null;
}> {
  const files: AttachmentBuilder[] = [];
  const covers: Array<{ gameId: number; title: string; imageData: Buffer }> = [];
  const seen = new Set<number>();

  for (const nomination of nominations) {
    const gameId = nomination.gamedbGameId;
    if (!gameId || seen.has(gameId)) {
      continue;
    }
    seen.add(gameId);
    const game = await Game.getGameById(gameId);
    if (!game?.imageData) {
      continue;
    }
    covers.push({
      gameId,
      title: nomination.gameTitle,
      imageData: game.imageData,
    });
  }

  const voteImageUrl = await appendVoteImageAttachment(files, kindLabel, roundNumber, covers);
  return { files, voteImageUrl };
}

async function appendVoteImageAttachment(
  files: AttachmentBuilder[],
  kindLabel: string,
  roundNumber: number,
  covers: Array<{ gameId: number; title: string; imageData: Buffer }>,
): Promise<string | null> {
  const voteType = toVoteImageType(kindLabel);
  if (!voteType || !covers.length) {
    return null;
  }

  const imageBuffer = await composeVoteImage({
    roundNumber,
    voteType,
    covers,
  });
  const filename = `noms_vote_${voteType.toLowerCase()}_round_${roundNumber}.png`;
  files.push(new AttachmentBuilder(imageBuffer, { name: filename }));
  return `attachment://${filename}`;
}

function toVoteImageType(kindLabel: string): VoteImageType | null {
  if (kindLabel === "GOTM" || kindLabel === "NR-GOTM") {
    return kindLabel;
  }
  return null;
}

function addVoteImageToContainer(container: ContainerBuilder, voteImageUrl: string | null): void {
  if (!voteImageUrl) {
    return;
  }
  const gallery = new MediaGalleryBuilder().addItems(
    new MediaGalleryItemBuilder()
      .setURL(voteImageUrl)
      .setDescription("Vote image"),
  );
  container.addMediaGalleryComponents(gallery);
}
