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
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "@discordjs/builders";
import { SeparatorSpacingSize } from "discord-api-types/v10";
import type { INominationEntry } from "../classes/Nomination.js";
import Game from "../classes/Game.js";
import { COMPONENTS_V2_FLAG } from "../config/flags.js";

const MAX_THUMBNAILS = 10;
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
  const { files, thumbnailsByGameId } = await buildNominationAttachments(
    nominations,
    MAX_THUMBNAILS,
  );
  const components = buildNominationContainers(
    kindLabel,
    commandLabel,
    window,
    nominations,
    thumbnailsByGameId,
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
  thumbnailsByGameId: Map<number, string>,
  altLayout: boolean,
  includeDetailSelect: boolean,
): Array<ContainerBuilder | ActionRowBuilder<StringSelectMenuBuilder>> {
  const containers: ContainerBuilder[] = [];
  let container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(buildHeaderContent(kindLabel, window)),
  );
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
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          buildContinuationHeader(kindLabel, window.targetRound),
        ),
      );
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
      thumbnailsByGameId.get(nomination.gamedbGameId),
      altLayout,
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

function buildNominationSection(
  nomination: INominationEntry,
  thumbnailUrl: string | undefined,
): SectionBuilder {
  const lines = [
    `### ${nomination.gameTitle}`,
  ];
  if (nomination.reason) {
    lines.push(`<@${nomination.userId}> ${trimReason(nomination.reason)}`);
  } else {
    lines.push(`<@${nomination.userId}> nominated this title, but did not provide a reason.`);
  }
  const section = new SectionBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(lines.join("\n")),
  );
  if (thumbnailUrl) {
    section.setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailUrl));
  }
  return section;
}

function addNominationContent(
  container: ContainerBuilder,
  nomination: INominationEntry,
  thumbnailUrl: string | undefined,
  altLayout: boolean,
): void {
  if (!altLayout && thumbnailUrl) {
    const section = buildNominationSection(nomination, thumbnailUrl);
    container.addSectionComponents(section);
    return;
  }
  if (altLayout && thumbnailUrl) {
    const galleryItem = new MediaGalleryItemBuilder()
      .setURL(thumbnailUrl)
      .setDescription(nomination.gameTitle);
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(galleryItem),
    );
  }
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

function buildHeaderContent(
  kindLabel: string,
  window: NominationWindow,
): string {
  return `## ${kindLabel} Nominations - Round ${window.targetRound}`;
}

function buildContinuationHeader(kindLabel: string, round: number): string {
  return `## ${kindLabel} Nominations - Round ${round} continued`;
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
  return date.toLocaleDateString("en-US", { timeZone: "America/New_York" });
}

async function buildNominationAttachments(
  nominations: INominationEntry[],
  maxImages: number,
): Promise<{ files: AttachmentBuilder[]; thumbnailsByGameId: Map<number, string> }> {
  const files: AttachmentBuilder[] = [];
  const thumbnailsByGameId = new Map<number, string>();
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
    if (files.length >= maxImages) {
      break;
    }
    const filename = `nomination_${gameId}.png`;
    files.push(new AttachmentBuilder(game.imageData, { name: filename }));
    thumbnailsByGameId.set(gameId, `attachment://${filename}`);
  }

  return { files, thumbnailsByGameId };
}
