import {
  ApplicationCommandOptionType,
  type CommandInteraction,
  EmbedBuilder,
  type User,
  AttachmentBuilder,
  MessageFlags,
  ComponentType,
  ModalBuilder,
  ModalSubmitInteraction,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  type ActionRow,
  type MessageActionRowComponent,
  type Client,
  type Message,
} from "discord.js";
import {
  Discord,
  Slash,
  SlashOption,
  SlashGroup,
  SelectMenuComponent,
  ButtonComponent,
  ModalComponent,
} from "discordx";
import {
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ButtonBuilder as V2ButtonBuilder,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "@discordjs/builders";
import { SeparatorSpacingSize } from "discord-api-types/v10";
import Member, { type IMemberNowPlayingEntry } from "../classes/Member.js";
import {
  safeDeferReply,
  safeReply,
  safeUpdate,
  sanitizeUserInput,
  stripModalInput,
  type AnyRepliable,
} from "../functions/InteractionUtils.js";
import Game, { type IGame } from "../classes/Game.js";
import { igdbService } from "../services/IGDB/IgdbService.js";
import {
  createIgdbSession,
  type IgdbSelectOption,
} from "../services/IGDB/IgdbSelectService.js";
import {
  announceCompletion,
  notifyUnknownCompletionPlatform,
} from "../functions/CompletionHelpers.js";
import { formatPlatformDisplayName } from "../functions/PlatformDisplay.js";
import {
  COMPLETION_TYPES,
  type CompletionType,
  formatDiscordTimestamp,
  formatPlaytimeHours,
  formatTableDate,
  parseCompletionDateInput,
} from "../commands/profile.command.js";
import { COMPONENTS_V2_FLAG } from "../config/flags.js";
import { STANDARD_PLATFORM_IDS } from "../config/standardPlatforms.js";

const MAX_NOW_PLAYING = 10;
const MAX_NOW_PLAYING_NOTE_LEN = 500;
const NOW_PLAYING_SEARCH_LIMIT = 10;
const NOW_PLAYING_SORT_MOVE_PREFIX = "nowplaying-sort-move";
const NOW_PLAYING_SORT_DONE_ID = "nowplaying-sort-done";
const NOW_PLAYING_NOTE_MODAL_ID = "nowplaying-note-modal";
const NOW_PLAYING_NOTE_INPUT_ID = "nowplaying-note-input";
const NOW_PLAYING_ADD_MODAL_ID = "nowplaying-add-modal";
const NOW_PLAYING_ADD_TITLE_INPUT_ID = "nowplaying-add-title";
const NOW_PLAYING_ADD_NOTE_INPUT_ID = "nowplaying-add-note";
const NOW_PLAYING_ADD_PLATFORM_SELECT_PREFIX = "nowplaying-add-platform-select";
const NOW_PLAYING_EDIT_PLATFORM_SELECT_PREFIX = "nowplaying-edit-platform-select";
const NOW_PLAYING_EDIT_NOTE_DIRECT_PREFIX = "nowplaying-edit-note-direct";
const NOW_PLAYING_COMPLETE_MODAL_ID = "nowplaying-complete-modal";
const NOW_PLAYING_COMPLETE_DATE_INPUT_ID = "nowplaying-complete-date";
const NOW_PLAYING_COMPLETE_HOURS_INPUT_ID = "nowplaying-complete-hours";
const NOW_PLAYING_COMPLETE_NOTE_INPUT_ID = "nowplaying-complete-note";
const NOW_PLAYING_COMPLETE_PICK_PREFIX = "np-complete-pick";
const NOW_PLAYING_COMPLETE_TYPE_SELECT_PREFIX = "np-complete-type";
const NOW_PLAYING_COMPLETE_REMOVE_SELECT_PREFIX = "np-complete-remove";
const NOW_PLAYING_COMPLETE_ANNOUNCE_SELECT_PREFIX = "np-complete-announce";
const NOW_PLAYING_COMPLETE_NOTE_SELECT_PREFIX = "np-complete-note";
const NOW_PLAYING_COMPLETE_DETAILS_PREFIX = "np-complete-details";
const NOW_PLAYING_COMPLETE_PLATFORM_SELECT_PREFIX = "np-complete-platform";
const NOW_PLAYING_GALLERY_MAX = 5;
const NOW_PLAYING_ALL_SELECT_ID = "nowplaying-all-select:v1";
type NowPlayingAddSession = {
  userId: string;
  query: string;
  note: string | null;
  timeoutId?: ReturnType<typeof setTimeout>;
};
type NowPlayingAddPlatformSession = {
  userId: string;
  gameId: number;
  note: string | null;
  sourceSessionId: string;
};
const nowPlayingAddSessions = new Map<string, NowPlayingAddSession>();
const nowPlayingAddPlatformSessions = new Map<string, NowPlayingAddPlatformSession>();

type NowPlayingCompletionWizardSession = {
  userId: string;
  gameId: number | null;
  completionType: CompletionType;
  removeFromNowPlaying: boolean;
  announce: boolean;
  addCompletionNote: boolean;
  returnToList: boolean;
};
const nowPlayingCompletionWizardSessions = new Map<string, NowPlayingCompletionWizardSession>();
type NowPlayingCompletionPlatformSession = {
  sessionId: string;
  userId: string;
  gameId: number;
  completionType: CompletionType;
  completedAt: Date | null;
  finalPlaytimeHours: number | null;
  note: string | null;
  removeFromNowPlaying: boolean;
  announce: boolean;
  returnToList: boolean;
  platforms: Array<{ id: number; name: string }>;
};
const nowPlayingCompletionPlatformSessions = new Map<
  string,
  NowPlayingCompletionPlatformSession
>();
type NowPlayingListContext = {
  channelId: string;
  messageId: string;
};
const nowPlayingListContexts = new Map<string, NowPlayingListContext>();
type NowPlayingMessageComponents = Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>>;

function buildComponentsV2Flags(isEphemeral: boolean): number {
  return (isEphemeral ? MessageFlags.Ephemeral : 0) | COMPONENTS_V2_FLAG;
}

async function confirmDuplicateCompletion(
  interaction: CommandInteraction | ModalSubmitInteraction | ButtonInteraction,
  gameTitle: string,
  existing: Awaited<ReturnType<typeof Member.getRecentCompletionForGame>>,
): Promise<boolean> {
  if (!existing) return true;

  const promptId = `np-comp-dup:${interaction.user.id}:${Date.now()}`;
  const yesId = `${promptId}:yes`;
  const noId = `${promptId}:no`;
  const dateText = existing.completedAt
    ? formatDiscordTimestamp(existing.completedAt)
    : "No date";
  const playtimeText = formatPlaytimeHours(existing.finalPlaytimeHours);
  const detailParts = [existing.completionType, dateText, playtimeText].filter(Boolean);
  const noteLine = existing.note ? `\n> ${existing.note}` : "";

  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `We found a completion for **${gameTitle}** within the last week:\n` +
        `• ${detailParts.join(" — ")} (Completion #${existing.completionId})${noteLine}\n\n` +
        "Add another completion anyway?",
    ),
  );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(yesId)
      .setLabel("Add Another")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(noId)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary),
  );

  const payload = {
    components: [container, row],
    flags: buildComponentsV2Flags(true),
  };

  let message: Message | null = null;
  try {
    if (interaction.deferred || interaction.replied) {
      const reply = await interaction.followUp(payload as any);
      message = reply as Message;
    } else {
      const reply = await interaction.reply({ ...payload, withResponse: true } as any);
      message = reply.resource?.message ?? null;
    }
  } catch {
    try {
      const reply = await interaction.followUp(payload as any);
      message = reply as Message;
    } catch {
      return false;
    }
  }

  if (!message || typeof message.awaitMessageComponent !== "function") {
    return false;
  }

  try {
    const selection = await message.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) =>
        i.user.id === interaction.user.id && i.customId.startsWith(promptId),
      time: 120_000,
    });
    const confirmed = selection.customId.endsWith(":yes");
    const resultContainer = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        confirmed ? "Adding another completion." : "Cancelled.",
      ),
    );
    await selection.update({
      components: [resultContainer],
      flags: buildComponentsV2Flags(true),
    });
    return confirmed;
  } catch {
    return false;
  }
}

function createNowPlayingCompletionWizardSession(
  userId: string,
  returnToList: boolean = false,
): string {
  const sessionId = `np-comp-ui-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const defaultType = (COMPLETION_TYPES[0] ?? "Main Story") as CompletionType;
  nowPlayingCompletionWizardSessions.set(sessionId, {
    userId,
    gameId: null,
    completionType: defaultType,
    removeFromNowPlaying: true,
    announce: true,
    addCompletionNote: true,
    returnToList,
  });
  return sessionId;
}

function clearNowPlayingAddSession(sessionId: string): void {
  const session = nowPlayingAddSessions.get(sessionId);
  if (session?.timeoutId) {
    clearTimeout(session.timeoutId);
  }
  nowPlayingAddSessions.delete(sessionId);
}

function setNowPlayingListContext(userId: string, message: Message<boolean>): void {
  nowPlayingListContexts.set(userId, {
    channelId: message.channelId,
    messageId: message.id,
  });
}

function resolvePlatformLabel(entry: IMemberNowPlayingEntry): string | null {
  const candidate =
    entry.platformAbbreviation ??
    formatPlatformDisplayName(entry.platformName) ??
    entry.platformName ??
    "Unknown Platform";
  if (candidate === "Unknown Platform") {
    return null;
  }
  return candidate;
}

function formatEntry(
  entry: IMemberNowPlayingEntry,
  guildId: string | null,
): string {
  const platformLabel = resolvePlatformLabel(entry);
  const baseTitle = platformLabel
    ? `${entry.title} (${platformLabel})`
    : entry.title;
  if (entry.threadId && guildId) {
    return `[${baseTitle}](https://discord.com/channels/${guildId}/${entry.threadId})`;
  }
  return baseTitle;
}

function formatEntryTitleWithPlatform(
  entry: { title: string; platformName: string | null },
): string {
  const platformLabel = resolvePlatformLabel(entry as IMemberNowPlayingEntry);
  return platformLabel
    ? `${entry.title} (${platformLabel})`
    : entry.title;
}

function sortNowPlayingEntries(
  entries: IMemberNowPlayingEntry[],
): IMemberNowPlayingEntry[] {
  return [...entries].sort((a, b) => {
    const titleA = a.title.toLowerCase();
    const titleB = b.title.toLowerCase();
    const titleCompare = titleA.localeCompare(titleB);
    if (titleCompare !== 0) return titleCompare;
    const gameIdA = a.gameId ?? 0;
    const gameIdB = b.gameId ?? 0;
    return gameIdA - gameIdB;
  });
}

function getDisplayNowPlayingEntries(
  entries: IMemberNowPlayingEntry[],
): IMemberNowPlayingEntry[] {
  const hasManualOrder = entries.some((entry) => entry.sortOrder != null);
  return hasManualOrder ? entries : sortNowPlayingEntries(entries);
}

function buildEditNoteModal(
  ownerId: string,
  gameId: number,
  title: string,
  currentNote: string | null,
): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId(NOW_PLAYING_NOTE_INPUT_ID)
    .setLabel(title.slice(0, 45))
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(MAX_NOW_PLAYING_NOTE_LEN)
    .setValue(currentNote ?? "");

  return new ModalBuilder()
    .setCustomId(`${NOW_PLAYING_NOTE_MODAL_ID}:${ownerId}:${gameId}`)
    .setTitle("Edit Now Playing Note")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

@Discord()
@SlashGroup({ description: "Show now playing data", name: "now-playing" })
@SlashGroup("now-playing")
export class NowPlayingCommand {
  @Slash({ description: "Show now playing data", name: "list" })
  async nowPlaying(
    @SlashOption({
      description: "Member to view; defaults to you.",
      name: "member",
      required: false,
      type: ApplicationCommandOptionType.User,
    })
    member: User | undefined,
    @SlashOption({
      description: "Show everyone with Now Playing entries.",
      name: "all",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showAll: boolean | undefined,
    @SlashOption({
      description: "Show in chat (public) instead of ephemeral",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const showAllFlag = showAll === true;
    const target = member ?? interaction.user;
    const ephemeral = !(showAllFlag || showInChat);
    await safeDeferReply(interaction, { flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    if (showAllFlag) {
      await this.showEveryone(interaction, ephemeral);
      return;
    }

    await this.showSingle(interaction, target, ephemeral);
  }

  @Slash({ description: "Search for who is playing a GameDB title", name: "search" })
  async searchNowPlaying(
    @SlashOption({
      description: "Game title to search in GameDB",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    title: string,
    @SlashOption({
      description: "Show in chat (public) instead of ephemeral",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const query = sanitizeUserInput(title, { preserveNewlines: false });
    const ephemeral = !showInChat;
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(ephemeral) });

    if (!query) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Please provide a title to search."),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const nowPlayingRows = await Member.getNowPlayingByTitleSearch(query);
    if (!nowPlayingRows.length) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `No one is currently playing GameDB titles matching "${query}".`,
        ),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const usersByGameId = new Map<number, { title: string; users: string[] }>();
    for (const row of nowPlayingRows) {
      const record = usersByGameId.get(row.gameId) ?? { title: row.title, users: [] };
      record.users.push(`<@${row.userId}>`);
      usersByGameId.set(row.gameId, record);
    }

    const sortedGames = Array.from(usersByGameId.entries())
      .map(([gameId, record]) => ({ gameId, title: record.title, users: record.users }))
      .sort((a, b) => a.title.localeCompare(b.title));
    const totalGames = sortedGames.length;
    const limitedGames = sortedGames.slice(0, NOW_PLAYING_SEARCH_LIMIT);

    const lines: string[] = [];
    for (const game of limitedGames) {
      const uniqueUsers = Array.from(new Set(game.users));
      const displayedUsers = uniqueUsers.slice(0, 30);
      const remaining = uniqueUsers.length - displayedUsers.length;
      const userList = `${displayedUsers.join(", ")}${remaining > 0 ? ` (+${remaining} more)` : ""}`;
      lines.push(`- **${game.title}**: ${userList}`);
    }

    const contentLines = [
      "## Now Playing Search",
      `Query: "**${query}**"`,
      ...lines,
    ];
    if (totalGames > limitedGames.length) {
      contentLines.push(
        "",
        `Showing first ${limitedGames.length} of ${totalGames} titles with active players.`,
      );
    }
    const content = this.trimTextDisplayContent(contentLines.join("\n"));
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(content),
    );

    await safeReply(interaction, {
      components: [container],
      flags: buildComponentsV2Flags(ephemeral),
    });
  }

  @ModalComponent({ id: NOW_PLAYING_ADD_MODAL_ID })
  async handleAddNowPlayingModal(interaction: ModalSubmitInteraction): Promise<void> {
    const query = stripModalInput(
      interaction.fields.getTextInputValue(NOW_PLAYING_ADD_TITLE_INPUT_ID),
    );
    const noteRaw = stripModalInput(
      interaction.fields.getTextInputValue(NOW_PLAYING_ADD_NOTE_INPUT_ID),
    );
    if (!query) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Please provide a title to search."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    if (noteRaw.length > MAX_NOW_PLAYING_NOTE_LEN) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `Note must be ${MAX_NOW_PLAYING_NOTE_LEN} characters or fewer.`,
        ),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    try {
      const results = await Game.searchGames(query);
      if (!results.length) {
        await this.startNowPlayingIgdbImportFromInteraction(
          interaction,
          {
            userId: interaction.user.id,
            query,
            note: noteRaw.length ? noteRaw : null,
          },
          "reply",
        );
        return;
      }
      const sessionId = `np-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      const session: NowPlayingAddSession = {
        userId: interaction.user.id,
        query,
        note: noteRaw.length ? noteRaw : null,
      };
      nowPlayingAddSessions.set(sessionId, session);

      const options: Array<{ label: string; value: string; description?: string }> =
        results.slice(0, 23).map((g) => ({
        label: g.title.substring(0, 100),
        value: String(g.id),
      }));

      options.push({
        label: "Import another game from IGDB",
        value: "import-igdb",
        description: "Search IGDB and import a new GameDB entry",
      });

      const selectId = `nowplaying-add-select:${sessionId}`;
      const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(selectId)
          .setPlaceholder("Select the game to add")
          .addOptions(options),
      );

      const contentLines = [
        "## Now Playing Add",
        "Select a game to add to your Now Playing list:",
      ];
      if (results.length > options.length - 1) {
        contentLines.push(`Showing first ${options.length - 1} results.`);
      }
      const content = this.trimTextDisplayContent(contentLines.join("\n"));
      const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
        .addActionRowComponents(selectRow.toJSON());

      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });

      session.timeoutId = setTimeout(async () => {
        try {
          if (!nowPlayingAddSessions.has(sessionId)) {
            return;
          }
          const reply = await interaction.fetchReply();
          const hasMatchingSelect = reply.components.some((row) => {
            if (!("components" in row)) return false;
            const actionRow = row as ActionRow<MessageActionRowComponent>;
            return actionRow.components.some(
              (component) =>
                "customId" in component && component.customId === selectId,
            );
          });
          if (!hasMatchingSelect) return;

          const timeoutContainer = new ContainerBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              "Timed out waiting for a selection. No changes made.",
            ),
          );
          await interaction.editReply({
            components: [timeoutContainer],
            flags: buildComponentsV2Flags(true),
          });
          clearNowPlayingAddSession(sessionId);
        } catch {
          // ignore
        }
      }, 60_000);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`Could not add to Now Playing: ${msg}`),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
    }
  }

  private buildNowPlayingAddModal(): ModalBuilder {
    return new ModalBuilder()
      .setCustomId(NOW_PLAYING_ADD_MODAL_ID)
      .setTitle("Add Now Playing Game")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(NOW_PLAYING_ADD_TITLE_INPUT_ID)
            .setLabel("Game title")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(NOW_PLAYING_ADD_NOTE_INPUT_ID)
            .setLabel("Note (optional)")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(MAX_NOW_PLAYING_NOTE_LEN),
        ),
      );
  }

  private buildNowPlayingCompletionConfigContainer(
    entry: IMemberNowPlayingEntry,
    sessionId: string,
    session: NowPlayingCompletionWizardSession,
    thumbnailUrl: string | null,
  ): ContainerBuilder {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("## Add Completion"),
    );
    const headerLines = [`### ${formatEntryTitleWithPlatform(entry)}`];
    if (entry.note) {
      headerLines.push(`Current Note: ${entry.note}`);
    }
    const headerSection = new SectionBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        this.trimTextDisplayContent(headerLines.join("\n")),
      ),
    );
    if (thumbnailUrl) {
      headerSection.setThumbnailAccessory(
        new ThumbnailBuilder()
          .setURL(thumbnailUrl)
          .setDescription("Game cover"),
      );
    }
    container.addSectionComponents(headerSection);

    const typeSelect = new StringSelectMenuBuilder()
      .setCustomId(`${NOW_PLAYING_COMPLETE_TYPE_SELECT_PREFIX}:${sessionId}`)
      .setPlaceholder("Completion type")
      .addOptions(
        COMPLETION_TYPES.map((type) => ({
          label: type,
          value: type,
          default: type === session.completionType,
        })),
      );
    const removeSelect = new StringSelectMenuBuilder()
      .setCustomId(`${NOW_PLAYING_COMPLETE_REMOVE_SELECT_PREFIX}:${sessionId}`)
      .setPlaceholder("Remove from Now Playing?")
      .addOptions(
        {
          label: "Yes",
          value: "yes",
          default: session.removeFromNowPlaying,
        },
        {
          label: "No",
          value: "no",
          default: !session.removeFromNowPlaying,
        },
      );
    const announceSelect = new StringSelectMenuBuilder()
      .setCustomId(`${NOW_PLAYING_COMPLETE_ANNOUNCE_SELECT_PREFIX}:${sessionId}`)
      .setPlaceholder("Announce completion?")
      .addOptions(
        {
          label: "Yes",
          value: "yes",
          default: session.announce,
        },
        {
          label: "No",
          value: "no",
          default: !session.announce,
        },
      );
    const noteSelect = new StringSelectMenuBuilder()
      .setCustomId(`${NOW_PLAYING_COMPLETE_NOTE_SELECT_PREFIX}:${sessionId}`)
      .setPlaceholder("Add a Completion Note")
      .addOptions(
        {
          label: "Yes",
          value: "yes",
          default: session.addCompletionNote,
        },
        {
          label: "No",
          value: "no",
          default: !session.addCompletionNote,
        },
      );
    const detailsButton = new ButtonBuilder()
      .setCustomId(`${NOW_PLAYING_COMPLETE_DETAILS_PREFIX}:${sessionId}`)
      .setLabel("Continue")
      .setStyle(ButtonStyle.Primary);
    const cancelButton = new ButtonBuilder()
      .setCustomId(`nowplaying-list-cancel:${session.userId}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary);

    const typeRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(typeSelect);
    const removeRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(removeSelect);
    const announceRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(announceSelect);
    const noteRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(noteSelect);
    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      detailsButton,
      cancelButton,
    );

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("Completion Type"),
    );
    container.addActionRowComponents(typeRow.toJSON());
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("Remove from Now Playing"),
    );
    container.addActionRowComponents(removeRow.toJSON());
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("Announce Completion"),
    );
    container.addActionRowComponents(announceRow.toJSON());
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("Add a Completion Note"),
    );
    container.addActionRowComponents(noteRow.toJSON());
    container.addActionRowComponents(buttonRow.toJSON());
    return container;
  }

  private async renderNowPlayingCompletionConfig(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    sessionId: string,
    session: NowPlayingCompletionWizardSession,
  ): Promise<void> {
    const entries = await Member.getNowPlaying(session.userId);
    const entry = entries.find((item) => item.gameId === session.gameId);
    if (!entry) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("That game is no longer in your Now Playing list."),
      );
      await interaction.update({ components: [container] });
      return;
    }

    let thumbnailUrl: string | null = null;
    const files: AttachmentBuilder[] = [];
    const game = await Game.getGameById(entry.gameId);
    if (game?.imageData) {
      const filename = `now_playing_completion_${entry.gameId}.png`;
      files.push(new AttachmentBuilder(game.imageData, { name: filename }));
      thumbnailUrl = `attachment://${filename}`;
    }

    const container = this.buildNowPlayingCompletionConfigContainer(
      entry,
      sessionId,
      session,
      thumbnailUrl,
    );
    if (files.length) {
      await interaction.update({ components: [container], files });
    } else {
      await interaction.update({ components: [container] });
    }
  }

  private async promptNowPlayingCompletionPick(
    interaction: ButtonInteraction,
    ownerId: string,
    sessionId: string,
  ): Promise<void> {
    const current = await Member.getNowPlaying(ownerId);
    if (!current.length) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Your Now Playing list is empty."),
      );
      await interaction.update({ components: [container] });
      return;
    }

    if (current.length === 1) {
      const session = nowPlayingCompletionWizardSessions.get(sessionId);
      const entry = current[0];
      if (!session || !entry?.gameId) {
        const container = new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent("Unable to start completion flow."),
        );
        await interaction.update({ components: [container] });
        return;
      }
      session.gameId = entry.gameId;
      await this.renderNowPlayingCompletionConfig(interaction, sessionId, session);
      return;
    }

    const entries = getDisplayNowPlayingEntries(current);
    const { files, thumbnailsByGameId } = await this.buildNowPlayingAttachments(
      entries,
      NOW_PLAYING_GALLERY_MAX,
    );
    const components = this.buildNowPlayingCompletionComponents(
      entries,
      ownerId,
      sessionId,
      thumbnailsByGameId,
    );
    await interaction.update(this.buildComponentPayload(components, files));
  }

  @ModalComponent({ id: /^nowplaying-complete-modal:[^:]+$/ })
  async handleNowPlayingCompletionModal(
    interaction: ModalSubmitInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });
    const [, sessionId] = interaction.customId.split(":");
    const session = nowPlayingCompletionWizardSessions.get(sessionId);
    if (!session) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt has expired."),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (interaction.user.id !== session.userId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt isn't for you."),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (!session.gameId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Select a game first before submitting details."),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const completionDateInput = stripModalInput(
      interaction.fields.getTextInputValue(NOW_PLAYING_COMPLETE_DATE_INPUT_ID),
    );
    const finalPlaytimeRaw = stripModalInput(
      interaction.fields.getTextInputValue(NOW_PLAYING_COMPLETE_HOURS_INPUT_ID),
    );
    const noteInput = session.addCompletionNote
      ? stripModalInput(
        interaction.fields.getTextInputValue(NOW_PLAYING_COMPLETE_NOTE_INPUT_ID),
      )
      : "";

    let completedAt: Date | null = null;
    try {
      completedAt = this.parseNowPlayingCompletionDate(completionDateInput);
    } catch (err: any) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(err?.message ?? "Invalid completion date."),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const finalPlaytimeHours = finalPlaytimeRaw
      ? Number(finalPlaytimeRaw)
      : null;
    if (
      finalPlaytimeHours !== null &&
      (Number.isNaN(finalPlaytimeHours) || finalPlaytimeHours < 0)
    ) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          "Final playtime must be a non-negative number of hours.",
        ),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const note = noteInput ? noteInput : null;

    const game = await Game.getGameById(session.gameId);
    if (!game) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("That game could not be found."),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const referenceDate = completedAt ?? new Date();
    const recentCompletion = await Member.getRecentCompletionForGame(
      session.userId,
      session.gameId,
      referenceDate,
    );
    if (recentCompletion) {
      const confirmed = await confirmDuplicateCompletion(
        interaction,
        game.title,
        recentCompletion,
      );
      if (!confirmed) {
        return;
      }
    }

    await this.promptNowPlayingCompletionPlatformSelection(
      interaction,
      sessionId,
      session,
      game,
      completedAt,
      finalPlaytimeHours,
      note,
    );
    return;
  }

  @SelectMenuComponent({ id: /^np-complete-platform:[^:]+$/ })
  async handleNowPlayingCompletionPlatformSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const [, platformSessionId] = interaction.customId.split(":");
    const session = nowPlayingCompletionPlatformSessions.get(platformSessionId);
    if (!session) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt has expired."),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (interaction.user.id !== session.userId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt isn't for you."),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const selected = interaction.values?.[0];
    const isOther = selected === "other";
    let platformId: number | null = null;
    if (!isOther) {
      const parsedId = Number(selected);
      if (Number.isInteger(parsedId)) {
        platformId = parsedId;
      }
    }
    const valid = isOther || (
      platformId !== null &&
      session.platforms.some((platform) => platform.id === platformId)
    );
    if (!valid) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Invalid platform selection."),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    await interaction.deferUpdate().catch(() => {});
    nowPlayingCompletionPlatformSessions.delete(platformSessionId);

    const game = await Game.getGameById(session.gameId);
    if (!game) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("That game could not be found."),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (isOther) {
      await notifyUnknownCompletionPlatform(interaction, game.title, game.id);
    }

    await this.finalizeNowPlayingCompletion(
      interaction,
      session.sessionId,
      session,
      game,
      platformId,
    );
  }

  private async promptNowPlayingCompletionPlatformSelection(
    interaction: ModalSubmitInteraction,
    sessionId: string,
    session: NowPlayingCompletionWizardSession,
    game: IGame,
    completedAt: Date | null,
    finalPlaytimeHours: number | null,
    note: string | null,
  ): Promise<void> {
    const platforms = await Game.getPlatformsForGameWithStandard(game.id, STANDARD_PLATFORM_IDS);
    if (!platforms.length) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("No platform data is available for this game."),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const platformOptions = platforms.map((platform) => ({
      id: platform.id,
      name: platform.name,
    }));
    const platformSessionId = `np-comp-platform-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    nowPlayingCompletionPlatformSessions.set(platformSessionId, {
      sessionId,
      userId: session.userId,
      gameId: game.id,
      completionType: session.completionType,
      completedAt,
      finalPlaytimeHours,
      note,
      removeFromNowPlaying: session.removeFromNowPlaying,
      announce: session.announce,
      returnToList: session.returnToList,
      platforms: platformOptions,
    });

    const baseOptions = platformOptions.map((platform) => ({
      label: platform.name.slice(0, 100),
      value: String(platform.id),
    }));
    const options = [
      ...baseOptions.slice(0, 24),
      { label: "Other", value: "other" },
    ];
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${NOW_PLAYING_COMPLETE_PLATFORM_SELECT_PREFIX}:${platformSessionId}`)
      .setPlaceholder("Select the platform")
      .addOptions(options);
    const content = platformOptions.length > 24
      ? `Select the platform for **${game.title}** (showing first 24).`
      : `Select the platform for **${game.title}**.`;
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(content),
    );
    await safeReply(interaction, {
      components: [
        container,
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      ],
      flags: buildComponentsV2Flags(true),
    });
  }

  private async finalizeNowPlayingCompletion(
    interaction: StringSelectMenuInteraction,
    sessionId: string,
    session: NowPlayingCompletionPlatformSession,
    game: IGame,
    platformId: number | null,
  ): Promise<void> {
    try {
      await Member.addCompletion({
        userId: session.userId,
        gameId: game.id,
        completionType: session.completionType,
        platformId,
        completedAt: session.completedAt,
        finalPlaytimeHours: session.finalPlaytimeHours,
        note: session.note,
      });
    } catch (err: any) {
      const msg = err?.message ?? "Failed to save completion.";
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`Could not save completion: ${msg}`),
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (session.removeFromNowPlaying) {
      await Member.removeNowPlaying(session.userId, game.id).catch(() => {});
    }

    if (session.announce) {
      await announceCompletion(
        interaction,
        session.userId,
        game,
        session.completionType,
        session.completedAt,
        session.finalPlaytimeHours,
      );
    }

    if (session.removeFromNowPlaying) {
      await this.refreshNowPlayingListFromContext(interaction, session.userId).catch(() => {});
    }

    if (session.returnToList) {
      const entries = getDisplayNowPlayingEntries(
        await Member.getNowPlaying(session.userId),
      );
      if (!entries.length) {
        const container = new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent("Your Now Playing list is empty."),
        );
        await safeReply(interaction, {
          components: [container],
          flags: buildComponentsV2Flags(true),
        });
      } else {
        const { files, thumbnailsByGameId } = await this.buildNowPlayingAttachments(
          entries,
          NOW_PLAYING_GALLERY_MAX,
        );
        const components = this.buildNowPlayingCompletionComponents(
          entries,
          session.userId,
          sessionId,
          thumbnailsByGameId,
        );
        await safeReply(interaction, {
          ...this.buildComponentPayload(components, files),
          flags: buildComponentsV2Flags(true),
        });
      }
      return;
    }

    const detailLines = [
      "## Completion Added",
      `**Game:** ${game.title}`,
      `**Type:** ${session.completionType}`,
      `**Date:** ${formatTableDate(session.completedAt)}`,
    ];
    const playtimeText = formatPlaytimeHours(session.finalPlaytimeHours);
    if (playtimeText) {
      detailLines.push(`**Hours:** ${playtimeText}`);
    }
    if (session.note) {
      detailLines.push(`**Note:** ${session.note}`);
    }
    detailLines.push(
      `**Removed from Now Playing:** ${session.removeFromNowPlaying ? "Yes" : "No"}`,
      `**Announced:** ${session.announce ? "Yes" : "No"}`,
    );
    const content = this.trimTextDisplayContent(detailLines.join("\n"));
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(content),
    );
    await safeReply(interaction, {
      components: [container],
      flags: buildComponentsV2Flags(true),
    });
    nowPlayingCompletionWizardSessions.delete(sessionId);
  }

  @ButtonComponent({ id: /^np-complete-pick:[^:]+:\d+$/ })
  async handleNowPlayingCompletionPick(interaction: ButtonInteraction): Promise<void> {
    const [, sessionId, gameIdRaw] = interaction.customId.split(":");
    const session = nowPlayingCompletionWizardSessions.get(sessionId);
    if (!session) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt has expired."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (interaction.user.id !== session.userId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt isn't for you."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const gameId = Number(gameIdRaw);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Invalid selection."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    session.gameId = gameId;
    await this.renderNowPlayingCompletionConfig(interaction, sessionId, session);
  }

  @SelectMenuComponent({ id: /^np-complete-type:[^:]+$/ })
  async handleNowPlayingCompletionTypeSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const [, sessionId] = interaction.customId.split(":");
    const session = nowPlayingCompletionWizardSessions.get(sessionId);
    if (!session) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt has expired."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (interaction.user.id !== session.userId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt isn't for you."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const value = interaction.values?.[0];
    if (!value || !COMPLETION_TYPES.includes(value as CompletionType)) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Invalid completion type."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    session.completionType = value as CompletionType;
    await this.renderNowPlayingCompletionConfig(interaction, sessionId, session);
  }

  @SelectMenuComponent({ id: /^np-complete-remove:[^:]+$/ })
  async handleNowPlayingCompletionRemoveSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const [, sessionId] = interaction.customId.split(":");
    const session = nowPlayingCompletionWizardSessions.get(sessionId);
    if (!session) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt has expired."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (interaction.user.id !== session.userId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt isn't for you."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const value = interaction.values?.[0];
    if (value !== "yes" && value !== "no") {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Invalid selection."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    session.removeFromNowPlaying = value === "yes";
    await this.renderNowPlayingCompletionConfig(interaction, sessionId, session);
  }

  @SelectMenuComponent({ id: /^np-complete-announce:[^:]+$/ })
  async handleNowPlayingCompletionAnnounceSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const [, sessionId] = interaction.customId.split(":");
    const session = nowPlayingCompletionWizardSessions.get(sessionId);
    if (!session) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt has expired."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (interaction.user.id !== session.userId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt isn't for you."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const value = interaction.values?.[0];
    if (value !== "yes" && value !== "no") {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Invalid selection."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    session.announce = value === "yes";
    await this.renderNowPlayingCompletionConfig(interaction, sessionId, session);
  }

  @SelectMenuComponent({ id: /^np-complete-note:[^:]+$/ })
  async handleNowPlayingCompletionNoteSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const [, sessionId] = interaction.customId.split(":");
    const session = nowPlayingCompletionWizardSessions.get(sessionId);
    if (!session) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt has expired."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (interaction.user.id !== session.userId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt isn't for you."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const value = interaction.values?.[0];
    if (value !== "yes" && value !== "no") {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Invalid selection."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    session.addCompletionNote = value === "yes";
    await this.renderNowPlayingCompletionConfig(interaction, sessionId, session);
  }

  @ButtonComponent({ id: /^np-complete-details:[^:]+$/ })
  async handleNowPlayingCompletionDetails(interaction: ButtonInteraction): Promise<void> {
    const [, sessionId] = interaction.customId.split(":");
    const session = nowPlayingCompletionWizardSessions.get(sessionId);
    if (!session) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt has expired."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (interaction.user.id !== session.userId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This completion prompt isn't for you."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (!session.gameId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Select a game first."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const entries = await Member.getNowPlaying(session.userId);
    const currentEntry = entries.find((entry) => entry.gameId === session.gameId);
    const noteValue = currentEntry?.note ?? "";

    const modal = new ModalBuilder()
      .setCustomId(`${NOW_PLAYING_COMPLETE_MODAL_ID}:${sessionId}`)
      .setTitle("Add Completion Details");
    const modalRows: ActionRowBuilder<TextInputBuilder>[] = [
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(NOW_PLAYING_COMPLETE_DATE_INPUT_ID)
          .setLabel("Completion date (blank unknown)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder("today or 03/10/2025"),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(NOW_PLAYING_COMPLETE_HOURS_INPUT_ID)
          .setLabel("Final playtime hours (optional)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false),
      ),
    ];
    if (session.addCompletionNote) {
      const noteInput = new TextInputBuilder()
        .setCustomId(NOW_PLAYING_COMPLETE_NOTE_INPUT_ID)
        .setLabel("Note (optional)")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(MAX_NOW_PLAYING_NOTE_LEN);
      if (noteValue) {
        noteInput.setValue(noteValue.slice(0, MAX_NOW_PLAYING_NOTE_LEN));
      }
      modalRows.push(new ActionRowBuilder<TextInputBuilder>().addComponents(noteInput));
    }
    modal.addComponents(...modalRows);
    await interaction.showModal(modal).catch(() => {});
  }

  @SelectMenuComponent({ id: /^nowplaying-add-select:.+$/ })
  async handleAddNowPlayingSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, sessionId] = interaction.customId.split(":");
    const session = nowPlayingAddSessions.get(sessionId);
    const ownerId = session?.userId;

    if (!session || interaction.user.id !== ownerId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This add prompt isn't for you."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const choice = interaction.values[0];
    if (choice === "import-igdb") {
      await this.startNowPlayingIgdbImport(interaction, session);
      return;
    }
    const gameId = Number(choice);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Invalid selection. Please try again."),
      );
      await interaction.update({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      clearNowPlayingAddSession(sessionId);
      return;
    }

    try {
      await this.promptNowPlayingAddPlatformSelection(
        interaction,
        sessionId,
        ownerId,
        gameId,
        session.note,
        "update",
      );
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`Could not add to Now Playing: ${msg}`),
      );
      await interaction.update({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      clearNowPlayingAddSession(sessionId);
    }
  }

  @SelectMenuComponent({ id: /^nowplaying-add-platform-select:[^:]+$/ })
  async handleAddNowPlayingPlatformSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, platformSessionId] = interaction.customId.split(":");
    const session = nowPlayingAddPlatformSessions.get(platformSessionId);
    if (!session) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This platform prompt has expired."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (interaction.user.id !== session.userId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This platform prompt isn't for you."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const platformId = Number(interaction.values?.[0]);
    if (!Number.isInteger(platformId) || platformId <= 0) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Invalid platform selection."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    try {
      await Member.addNowPlaying(session.userId, session.gameId, platformId, session.note);
      nowPlayingAddPlatformSessions.delete(platformSessionId);
      clearNowPlayingAddSession(session.sourceSessionId);
      const list = await Member.getNowPlaying(session.userId);
      const payload = await this.buildNowPlayingListPayload(
        interaction.user,
        list,
        interaction.guildId,
        "Your Now Playing List",
        true,
        true,
      );
      const refreshed = await this.refreshNowPlayingListFromContext(interaction, session.userId);
      if (refreshed) {
        const container = new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent("Now Playing list updated."),
        );
        await interaction.update({
          components: [container],
          flags: buildComponentsV2Flags(true),
        });
      } else {
        const components = this.withNowPlayingActions(
          "Your Now Playing List",
          session.userId,
          payload.components,
          list.length,
        );
        await interaction.update({
          components,
          files: payload.files,
          flags: buildComponentsV2Flags(true),
        });
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`Could not add to Now Playing: ${msg}`),
      );
      await interaction.update({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      nowPlayingAddPlatformSessions.delete(platformSessionId);
      clearNowPlayingAddSession(session.sourceSessionId);
    }
  }

  private async promptNowPlayingAddPlatformSelection(
    interaction: StringSelectMenuInteraction,
    sourceSessionId: string,
    userId: string,
    gameId: number,
    note: string | null,
    mode: "reply" | "update",
  ): Promise<void> {
    const game = await Game.getGameById(gameId);
    if (!game) {
      throw new Error("Selected game not found. Please try again.");
    }
    const platforms = await Game.getPlatformsForGameWithStandard(game.id, STANDARD_PLATFORM_IDS);
    if (!platforms.length) {
      throw new Error("No platform data is available for this game.");
    }
    const platformSessionId = `np-add-platform-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    nowPlayingAddPlatformSessions.set(platformSessionId, {
      userId,
      gameId,
      note,
      sourceSessionId,
    });
    const options = platforms.slice(0, 25).map((platform) => ({
      label: platform.name.slice(0, 100),
      value: String(platform.id),
    }));
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${NOW_PLAYING_ADD_PLATFORM_SELECT_PREFIX}:${platformSessionId}`)
      .setPlaceholder("Select the platform")
      .addOptions(options);
    const titleWithCap = platforms.length > options.length
      ? `Select the platform for **${game.title}** (showing first ${options.length}).`
      : `Select the platform for **${game.title}**.`;
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(titleWithCap),
    );
    const payload = {
      components: [container, new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      flags: buildComponentsV2Flags(true),
    };
    if (mode === "update") {
      await interaction.update(payload);
    } else {
      await interaction.reply(payload);
    }
  }

  private async promptRemoveNowPlaying(
    interaction: AnyRepliable,
    mode: "reply" | "update" = "reply",
  ): Promise<void> {
    if (mode === "reply") {
      await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });
    }
    const userId = interaction.user.id;
    try {
      const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(userId));
      if (!entries.length) {
        const container = new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent("Your Now Playing list is empty."),
        );
        if (mode === "update" && "update" in interaction) {
          await interaction.update({ components: [container] });
        } else {
          await safeReply(interaction, {
            components: [container],
            flags: buildComponentsV2Flags(true),
          });
        }
        return;
      }

      const { files, thumbnailsByGameId } = await this.buildNowPlayingAttachments(
        entries,
        NOW_PLAYING_GALLERY_MAX,
      );
      const components = this.buildNowPlayingRemoveComponents(
        entries,
        userId,
        thumbnailsByGameId,
      );
      if (mode === "update" && "update" in interaction) {
        await interaction.update(this.buildComponentPayload(components, files));
      } else {
        await safeReply(interaction, {
          ...this.buildComponentPayload(components, files),
          flags: buildComponentsV2Flags(true),
        });
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`Could not remove from Now Playing: ${msg}`),
      );
      if (mode === "update" && "update" in interaction) {
        await interaction.update({ components: [container] });
      } else {
        await safeReply(interaction, {
          components: [container],
          flags: buildComponentsV2Flags(true),
        });
      }
    }
  }

  private async promptSortNowPlayingButtons(
    interaction: ButtonInteraction,
    ownerId: string,
  ): Promise<void> {
    const entries = getDisplayNowPlayingEntries(
      await Member.getNowPlaying(ownerId),
    );
    if (!entries.length) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Your Now Playing list is empty."),
      );
      await interaction.update({ components: [container] });
      return;
    }
    const { files, thumbnailsByGameId } = await this.buildNowPlayingAttachments(
      entries,
      NOW_PLAYING_GALLERY_MAX,
    );
    const components = this.buildNowPlayingSortComponents(
      entries,
      ownerId,
      thumbnailsByGameId,
    );
    await interaction.update(this.buildComponentPayload(components, files));
  }

  private parseNowPlayingCompletionDate(value: string): Date | null {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const normalized = trimmed.toLowerCase();
    if (normalized === "today") {
      return new Date();
    }
    if (normalized === "unknown" || normalized === "skip") {
      return null;
    }
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
    if (match) {
      const month = Number(match[1]);
      const day = Number(match[2]);
      const year = Number(match[3]);
      const parsed = new Date(year, month - 1, day);
      if (
        parsed.getFullYear() !== year ||
        parsed.getMonth() !== month - 1 ||
        parsed.getDate() !== day
      ) {
        throw new Error(
          "Could not parse completion date. Use MM/DD/YYYY, YYYY-MM-DD, 'today', or leave blank.",
        );
      }
      return parsed;
    }
    try {
      return parseCompletionDateInput(trimmed);
    } catch {
      throw new Error(
        "Could not parse completion date. Use MM/DD/YYYY, YYYY-MM-DD, 'today', or leave blank.",
      );
    }
  }

  private async promptEditNowPlayingNote(
    interaction: AnyRepliable,
    mode: "reply" | "update" = "reply",
  ): Promise<void> {
    if (mode === "reply") {
      await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    }

    const current = await Member.getNowPlayingEntries(interaction.user.id);
    if (!current.length) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Your Now Playing list is empty."),
      );
      if (mode === "update" && "update" in interaction) {
        await interaction.update({ components: [container] });
      } else {
        await safeReply(interaction, {
          components: [container],
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (current.length === 1) {
      const entry = current[0];
      if (!entry?.gameId) {
        await safeReply(interaction, {
          content: "Unable to open the note form right now.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (!("showModal" in interaction)) {
        await safeReply(interaction, {
          content: "Unable to open the note form right now.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.showModal(
        buildEditNoteModal(
          interaction.user.id,
          entry.gameId,
          formatEntryTitleWithPlatform(entry),
          entry.note ?? null,
        ),
      ).catch(async () => {
        await safeReply(interaction, {
          content: "Unable to open the note form right now.",
          flags: MessageFlags.Ephemeral,
        });
      });
      return;
    }

    const options = current.map((entry) => ({
      label: formatEntryTitleWithPlatform(entry).slice(0, 100),
      value: String(entry.gameId),
      description: entry.note ? entry.note.slice(0, 95) : "Add a note",
    }));

    const selectId = `nowplaying-edit-note-select:${interaction.user.id}`;
    const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(selectId)
        .setPlaceholder("Select a game to edit its note")
        .addOptions(options),
    );
    const cancelRow = this.buildNowPlayingCancelRow(interaction.user.id);

    const container = new ContainerBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Select a game to add or update its note:"),
      )
      .addActionRowComponents(selectRow.toJSON())
      .addActionRowComponents(cancelRow.toJSON());

    if (mode === "update" && "update" in interaction) {
      await interaction.update({ components: [container] });
      return;
    }

    await safeReply(interaction, {
      components: [container],
      flags: buildComponentsV2Flags(true),
    });
  }

  private async promptEditNowPlayingPlatform(
    interaction: AnyRepliable,
    mode: "reply" | "update" = "reply",
  ): Promise<void> {
    if (mode === "reply") {
      await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    }

    const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(interaction.user.id));
    if (!entries.length) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Your Now Playing list is empty."),
      );
      if (mode === "update" && "update" in interaction) {
        await interaction.update({ components: [container] });
      } else {
        await safeReply(interaction, {
          components: [container],
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    const { files, thumbnailsByGameId } = await this.buildNowPlayingAttachments(
      entries,
      NOW_PLAYING_GALLERY_MAX,
    );
    const components = this.buildNowPlayingEditPlatformComponents(
      entries,
      interaction.user.id,
      thumbnailsByGameId,
    );

    if (mode === "update" && "update" in interaction) {
      await interaction.update(this.buildComponentPayload(components, files));
      return;
    }
    await safeReply(interaction, {
      ...this.buildComponentPayload(components, files),
      flags: buildComponentsV2Flags(true),
    });
  }

  private async promptNowPlayingEditPlatformSelection(
    interaction: AnyRepliable,
    ownerId: string,
    gameId: number,
    mode: "reply" | "update" = "reply",
  ): Promise<void> {
    const game = await Game.getGameById(gameId);
    if (!game) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("That game could not be found."),
      );
      if (mode === "update" && "update" in interaction) {
        await interaction.update({ components: [container] });
      } else {
        await safeReply(interaction, {
          components: [container],
          flags: buildComponentsV2Flags(true),
        });
      }
      return;
    }

    const platforms = await Game.getPlatformsForGameWithStandard(gameId, STANDARD_PLATFORM_IDS);
    if (!platforms.length) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("No platform data is available for this game."),
      );
      if (mode === "update" && "update" in interaction) {
        await interaction.update({ components: [container] });
      } else {
        await safeReply(interaction, {
          components: [container],
          flags: buildComponentsV2Flags(true),
        });
      }
      return;
    }

    const options = platforms.slice(0, 25).map((platform) => ({
      label: platform.name.slice(0, 100),
      value: String(platform.id),
    }));
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${NOW_PLAYING_EDIT_PLATFORM_SELECT_PREFIX}:${ownerId}:${gameId}`)
      .setPlaceholder("Select the platform")
      .addOptions(options);
    const content = platforms.length > options.length
      ? `Select the platform for **${game.title}** (showing first ${options.length}).`
      : `Select the platform for **${game.title}**.`;
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(content),
    );
    const payload = {
      components: [container, new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      flags: buildComponentsV2Flags(true),
    };
    if (mode === "update" && "update" in interaction) {
      await interaction.update(payload);
    } else {
      await safeReply(interaction, payload);
    }
  }

  @SelectMenuComponent({ id: /^nowplaying-edit-platform-select:\d+:\d+$/ })
  async handleEditPlatformSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, ownerId, gameIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This platform prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const gameId = Number(gameIdRaw);
    const platformId = Number(interaction.values?.[0]);
    if (!Number.isInteger(gameId) || gameId <= 0 || !Number.isInteger(platformId) || platformId <= 0) {
      await interaction.reply({
        content: "Invalid selection.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const updated = await Member.updateNowPlayingPlatform(ownerId, gameId, platformId);
    if (!updated) {
      await interaction.reply({
        content: "Could not update that entry.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId));
    if (!entries.length) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Your Now Playing list is empty."),
      );
      await interaction.update({ components: [container] });
      return;
    }

    const { files, thumbnailsByGameId } = await this.buildNowPlayingAttachments(
      entries,
      NOW_PLAYING_GALLERY_MAX,
    );
    const components = this.buildNowPlayingEditPlatformComponents(
      entries,
      ownerId,
      thumbnailsByGameId,
    );
    await interaction.update(this.buildComponentPayload(components, files));
  }

  @SelectMenuComponent({ id: /^nowplaying-edit-note-select:\d+$/ })
  async handleEditNoteSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This note prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const gameId = Number(interaction.values?.[0]);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      await interaction.reply({
        content: "Invalid selection.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const currentEntries = await Member.getNowPlayingEntries(ownerId);
    const currentEntry = currentEntries.find((entry) => entry.gameId === gameId);
    if (!currentEntry) {
      await safeReply(interaction, {
        content: "Entry not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.showModal(
      buildEditNoteModal(
        ownerId,
        gameId,
        formatEntryTitleWithPlatform(currentEntry),
        currentEntry.note ?? null,
      ),
    ).catch(async () => {
      await safeReply(interaction, {
        content: "Unable to open the note form right now.",
        flags: MessageFlags.Ephemeral,
      });
    });
  }

  @ButtonComponent({ id: /^nowplaying-edit-note-direct:\d+:\d+$/ })
  async handleEditNoteDirect(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, gameIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This note prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const gameId = Number(gameIdRaw);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      await interaction.reply({
        content: "Invalid selection.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const currentEntries = await Member.getNowPlayingEntries(ownerId);
    const currentEntry = currentEntries.find((entry) => entry.gameId === gameId);
    if (!currentEntry) {
      await safeReply(interaction, {
        content: "Entry not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    setNowPlayingListContext(ownerId, interaction.message);
    await interaction.showModal(
      buildEditNoteModal(
        ownerId,
        gameId,
        formatEntryTitleWithPlatform(currentEntry),
        currentEntry.note ?? null,
      ),
    ).catch(async () => {
      await safeReply(interaction, {
        content: "Unable to open the note form right now.",
        flags: MessageFlags.Ephemeral,
      });
    });
  }

  @ButtonComponent({ id: /^nowplaying-sort-move:\d+:\d+$/ })
  async handleNowPlayingSortMove(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, gameIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This sort prompt isn't for you."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const gameId = Number(gameIdRaw);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Invalid selection."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const entries = getDisplayNowPlayingEntries(
      await Member.getNowPlaying(ownerId),
    );
    const index = entries.findIndex((entry) => entry.gameId === gameId);
    if (index <= 0) {
      const { files, thumbnailsByGameId } = await this.buildNowPlayingAttachments(
        entries,
        NOW_PLAYING_GALLERY_MAX,
      );
      const components = this.buildNowPlayingSortComponents(
        entries,
        ownerId,
        thumbnailsByGameId,
      );
      await interaction.update(this.buildComponentPayload(components, files));
      return;
    }

    const reordered = [...entries];
    [reordered[index - 1], reordered[index]] = [reordered[index], reordered[index - 1]];
    const orderedIds = reordered.map((entry) => entry.gameId);
    const updated = await Member.updateNowPlayingSort(ownerId, orderedIds);
    if (!updated) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Could not update the sort order."),
      );
      await interaction.update({ components: [container] });
      return;
    }

    const { files, thumbnailsByGameId } = await this.buildNowPlayingAttachments(
      reordered,
      NOW_PLAYING_GALLERY_MAX,
    );
    const components = this.buildNowPlayingSortComponents(
      reordered,
      ownerId,
      thumbnailsByGameId,
    );
    await interaction.update(this.buildComponentPayload(components, files));
  }

  @ButtonComponent({ id: /^nowplaying-sort-done:\d+$/ })
  async handleNowPlayingSortDone(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This sort prompt isn't for you."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const list = await Member.getNowPlaying(ownerId);
    const payload = await this.buildNowPlayingListPayload(
      interaction.user,
      list,
      interaction.guildId,
      "Your Now Playing List",
      true,
      true,
    );
    const components = this.withNowPlayingActions(
      "Your Now Playing List",
      ownerId,
      payload.components,
      list.length,
    );
    await interaction.update({
      components,
      files: payload.files,
    });
  }

  @ModalComponent({ id: /^nowplaying-note-modal:\d+:\d+$/ })
  async handleEditNoteModal(interaction: ModalSubmitInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const [, ownerId, gameIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, {
        content: "This note prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const gameId = Number(gameIdRaw);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      await safeReply(interaction, {
        content: "Invalid selection.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const noteInput = stripModalInput(
      interaction.fields.getTextInputValue(NOW_PLAYING_NOTE_INPUT_ID),
    );
    const note = noteInput.trim();
    const nextNote = note ? note : null;
    if (note && note.length > MAX_NOW_PLAYING_NOTE_LEN) {
      await safeReply(interaction, {
        content: `Note must be ${MAX_NOW_PLAYING_NOTE_LEN} characters or fewer.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const updated = await Member.updateNowPlayingNote(ownerId, gameId, nextNote);
    if (updated) {
      const refreshed = await this.refreshNowPlayingListFromContext(interaction, ownerId);
      if (refreshed) {
        await interaction.deleteReply().catch(() => {});
        return;
      }
      const list = await Member.getNowPlaying(ownerId);
      const payload = await this.buildNowPlayingListPayload(
        interaction.user,
        list,
        interaction.guildId,
        "Your Now Playing List",
        true,
        true,
      );
      const components = this.withNowPlayingActions(
        "Your Now Playing List",
        ownerId,
        payload.components,
        list.length,
      );
      await safeReply(interaction, {
        components,
        files: payload.files,
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    await safeReply(interaction, {
      content: "Could not update that entry.",
      flags: MessageFlags.Ephemeral,
    });
  }

  @SelectMenuComponent({ id: /^nowplaying-delete-note-select:\d+$/ })
  async handleDeleteNoteSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This note prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const gameId = Number(interaction.values?.[0]);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      await interaction.reply({
        content: "Invalid selection.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const currentEntries = await Member.getNowPlayingEntries(ownerId);
    const currentEntry = currentEntries.find((entry) => entry.gameId === gameId);
    const currentNote = currentEntry?.note ? currentEntry.note : "No note set.";
    if (!currentEntry) {
      await safeReply(interaction, {
        content: "Entry not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`Delete Note: ${currentEntry.title}`)
      .setDescription(currentEntry.note ? `> ${currentNote}` : "No note set.");

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`nowplaying-delete-note-confirm:${ownerId}:${gameId}:yes`)
        .setLabel("Delete Note")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`nowplaying-delete-note-confirm:${ownerId}:${gameId}:no`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.update({
      content: "Confirm note deletion:",
      embeds: [embed],
      components: [row],
    });
  }

  @ButtonComponent({ id: /^nowplaying-delete-note-confirm:\d+:\d+:(yes|no)$/ })
  async handleDeleteNoteConfirm(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, gameIdRaw, choice] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This note prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (choice === "no") {
      await interaction.update({
        content: "Cancelled.",
        components: [],
      }).catch(() => {});
      return;
    }

    const gameId = Number(gameIdRaw);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      await interaction.reply({
        content: "Invalid selection.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const updated = await Member.updateNowPlayingNote(ownerId, gameId, null);
    await interaction.update({
      content: updated ? "Note deleted." : "Could not update that entry.",
      components: [],
    }).catch(() => {});
  }

  @ButtonComponent({ id: /^np-remove:[^:]+:\d+$/ })
  async handleRemoveNowPlayingButton(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, gameIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This remove prompt isn't for you."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const gameId = Number(gameIdRaw);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Invalid selection."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    try {
      const removed = await Member.removeNowPlaying(ownerId, gameId);
      if (!removed) {
        const container = new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            "Failed to remove that game (it may have been removed already).",
          ),
        );
        await interaction.reply({
          components: [container],
          flags: buildComponentsV2Flags(true),
        });
        return;
      }

      const entries = getDisplayNowPlayingEntries(await Member.getNowPlaying(ownerId));
      if (!entries.length) {
        const container = new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent("Your Now Playing list is empty."),
        );
        await interaction.update({ components: [container] });
        return;
      }
      const { files, thumbnailsByGameId } = await this.buildNowPlayingAttachments(
        entries,
        NOW_PLAYING_GALLERY_MAX,
      );
      const components = this.buildNowPlayingRemoveComponents(
        entries,
        ownerId,
        thumbnailsByGameId,
      );
      await interaction.update(this.buildComponentPayload(components, files));
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`Could not remove from Now Playing: ${msg}`),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
    }
  }

  @ButtonComponent({ id: /^nowplaying-list-add:\d+$/ })
  async handleNowPlayingListAdd(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This add prompt isn't for you."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    setNowPlayingListContext(ownerId, interaction.message);
    await interaction.showModal(this.buildNowPlayingAddModal()).catch(() => {});
  }

  @ButtonComponent({ id: /^nowplaying-list-edit-note:\d+$/ })
  async handleNowPlayingListEditNote(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This note prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    setNowPlayingListContext(ownerId, interaction.message);
    await this.promptEditNowPlayingNote(interaction, "update");
  }

  @ButtonComponent({ id: /^nowplaying-list-edit-platform:\d+$/ })
  async handleNowPlayingListEditPlatform(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This platform prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    setNowPlayingListContext(ownerId, interaction.message);
    await this.promptEditNowPlayingPlatform(interaction, "update");
  }

  @ButtonComponent({ id: /^np-edit-platform:\d+:\d+$/ })
  async handleNowPlayingEditPlatformPick(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, gameIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This platform prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const gameId = Number(gameIdRaw);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      await interaction.reply({
        content: "Invalid selection.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await this.promptNowPlayingEditPlatformSelection(interaction, ownerId, gameId, "update");
  }

  @ButtonComponent({ id: /^nowplaying-edit-platform-done:\d+$/ })
  async handleNowPlayingEditPlatformDone(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This platform prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const list = await Member.getNowPlaying(ownerId);
    const payload = await this.buildNowPlayingListPayload(
      interaction.user,
      list,
      interaction.guildId,
      "Your Now Playing List",
      true,
      true,
    );
    const components = this.withNowPlayingActions(
      "Your Now Playing List",
      ownerId,
      payload.components,
      list.length,
    );
    await interaction.update({
      components,
      files: payload.files,
      flags: buildComponentsV2Flags(true),
    });
  }

  @ButtonComponent({ id: /^nowplaying-list-sort:\d+$/ })
  async handleNowPlayingListSort(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This sort prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    setNowPlayingListContext(ownerId, interaction.message);
    await this.promptSortNowPlayingButtons(interaction, ownerId);
  }

  @ButtonComponent({ id: /^nowplaying-list-complete:\d+$/ })
  async handleNowPlayingListComplete(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This completion prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    setNowPlayingListContext(ownerId, interaction.message);
    const sessionId = createNowPlayingCompletionWizardSession(ownerId, true);
    await this.promptNowPlayingCompletionPick(interaction, ownerId, sessionId);
  }

  @ButtonComponent({ id: /^nowplaying-complete-done:\d+$/ })
  async handleNowPlayingCompleteDone(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This completion prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const list = await Member.getNowPlaying(ownerId);
    const payload = await this.buildNowPlayingListPayload(
      interaction.user,
      list,
      interaction.guildId,
      "Your Now Playing List",
      true,
      true,
    );
    const components = this.withNowPlayingActions(
      "Your Now Playing List",
      ownerId,
      payload.components,
      list.length,
    );
    await interaction.update({
      components,
      files: payload.files,
      flags: buildComponentsV2Flags(true),
    });
  }


  @ButtonComponent({ id: /^nowplaying-list-remove:\d+$/ })
  async handleNowPlayingListRemove(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("This remove prompt isn't for you."),
      );
      await interaction.reply({
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    setNowPlayingListContext(ownerId, interaction.message);
    await this.promptRemoveNowPlaying(interaction, "update");
  }

  @ButtonComponent({ id: /^nowplaying-remove-done:\d+$/ })
  async handleNowPlayingRemoveDone(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This remove prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const list = await Member.getNowPlaying(ownerId);
    const payload = await this.buildNowPlayingListPayload(
      interaction.user,
      list,
      interaction.guildId,
      "Your Now Playing List",
      true,
      true,
    );
    const components = this.withNowPlayingActions(
      "Your Now Playing List",
      ownerId,
      payload.components,
      list.length,
    );
    await interaction.update({
      components,
      files: payload.files,
      flags: buildComponentsV2Flags(true),
    });
  }

  @ButtonComponent({ id: /^nowplaying-list-cancel:\d+$/ })
  async handleNowPlayingListCancel(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const list = await Member.getNowPlaying(ownerId);
    const payload = await this.buildNowPlayingListPayload(
      interaction.user,
      list,
      interaction.guildId,
      "Your Now Playing List",
      true,
      true,
    );
    const components = this.withNowPlayingActions(
      "Your Now Playing List",
      ownerId,
      payload.components,
      list.length,
    );
    await interaction.update({
      components,
      files: payload.files,
      flags: buildComponentsV2Flags(true),
    });
  }

  async showSingle(
    interaction: AnyRepliable,
    target: User,
    ephemeral: boolean,
  ): Promise<void> {
    const isOwnList = target.id === interaction.user.id;
    const entries = await Member.getNowPlaying(target.id);
    if (!entries.length) {
      if (isOwnList && ephemeral) {
        const container = this.buildNowPlayingMessageContainer(
          "Your Now Playing List",
          [
            "Welcome. Your list is empty, so nothing shows yet.",
            "Click Add Game to put your first game on the list.",
          ].join("\n"),
        );
        const actions = this.buildNowPlayingActionRow(target.id, 0);
        await safeReply(interaction, {
          components: [container, actions],
          flags: buildComponentsV2Flags(ephemeral),
        });
        return;
      }

      const container = this.buildNowPlayingMessageContainer(
        "Now Playing",
        `No Now Playing entries found for <@${target.id}>.`,
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(ephemeral),
      });
      return;
    }

    const sortedEntries = getDisplayNowPlayingEntries(entries);
    const title = isOwnList && ephemeral
      ? "Your Now Playing List"
      : `${target.displayName ?? target.username ?? "User"}'s Now Playing List`;
    const payload = await this.buildNowPlayingListPayload(
      target,
      sortedEntries,
      interaction.guildId,
      title,
      isOwnList,
      ephemeral,
    );
    const components = this.withNowPlayingActions(
      title,
      target.id,
      payload.components,
      sortedEntries.length,
    );
    await safeReply(interaction, {
      components,
      files: payload.files,
      flags: buildComponentsV2Flags(ephemeral),
    });
  }

  @SelectMenuComponent({ id: /^nowplaying-all-select(?::v1)?$/ })
  async handleNowPlayingAllSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const selectedUserId = interaction.values?.[0];
    if (!selectedUserId) return;

    const entries = await Member.getNowPlaying(selectedUserId);
    const target =
      (await interaction.client.users.fetch(selectedUserId).catch(() => null)) ??
      interaction.user;
    const lists = await Member.getAllNowPlaying();
    const selectRow = lists.length
      ? this.buildNowPlayingMemberSelect(lists, selectedUserId)
      : null;

    if (!entries.length) {
      const container = this.buildNowPlayingMessageContainer(
        "Now Playing - Everyone",
        `No Now Playing entries found for <@${selectedUserId}>.`,
      );
      const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;
      await safeUpdate(interaction, {
        components: [container, ...(selectRow ? [selectRow] : [])],
        flags: buildComponentsV2Flags(isEphemeral),
      });
      return;
    }

    const sortedEntries = getDisplayNowPlayingEntries(entries);
    const displayName = target.displayName ?? target.username ?? "User";
    const { files, thumbnailsByGameId } = await this.buildNowPlayingAttachments(
      sortedEntries,
      NOW_PLAYING_GALLERY_MAX,
    );
    const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;
    const containers = this.buildNowPlayingEntryContainers(
      `${displayName}'s Now Playing List`,
      sortedEntries,
      interaction.guildId,
      thumbnailsByGameId,
      selectedUserId,
      false,
      isEphemeral,
    );
    await safeUpdate(interaction, {
      components: [...containers, ...(selectRow ? [selectRow] : [])],
      files,
      flags: buildComponentsV2Flags(isEphemeral),
    });
  }

  private async showEveryone(
    interaction: CommandInteraction,
    ephemeral: boolean,
  ): Promise<void> {
    const lists = await Member.getAllNowPlaying();
    if (!lists.length) {
      const container = this.buildNowPlayingMessageContainer(
        "Now Playing - Everyone",
        "No Now Playing data found for anyone yet.",
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(ephemeral),
      });
      return;
    }

    const sortedLists = [...lists].sort((a, b) => {
      const nameA = (a.globalName ?? a.username ?? a.userId).toLowerCase();
      const nameB = (b.globalName ?? b.username ?? b.userId).toLowerCase();
      return nameA.localeCompare(nameB);
    });

    const lines = sortedLists.map((record) => {
      const displayName = record.globalName ?? record.username ?? record.userId;
      const count = record.entries.length;
      const suffix = count === 1 ? "game" : "games";
      return `**${displayName}**: ${count} ${suffix}`;
    });

    const container = this.buildNowPlayingListContainer("Now Playing - Everyone", lines);

    const selectRow = this.buildNowPlayingMemberSelect(sortedLists);

    await safeReply(interaction, {
      components: [container, selectRow],
      flags: buildComponentsV2Flags(ephemeral),
    });
  }

  private buildNowPlayingListLines(
    entries: IMemberNowPlayingEntry[],
    guildId: string | null,
  ): string[] {
    const lines: string[] = [];
    entries.forEach((entry) => {
      lines.push(`- ${formatEntry(entry, guildId)}`);
      if (entry.note) {
        lines.push(`  - ${entry.note}`);
      }
    });
    return lines;
  }

  private buildNowPlayingListContainer(title: string, lines: string[]): ContainerBuilder {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${title}`));
    if (lines.length) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(lines.join("\n")),
      );
    }
    return container;
  }

  private buildNowPlayingMessageContainer(title: string, message: string): ContainerBuilder {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${title}`));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(message));
    return container;
  }

  private buildComponentPayload(
    components: Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>>,
    files?: AttachmentBuilder[],
  ): { components: Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>>; files?: AttachmentBuilder[] } {
    if (files && files.length) {
      return { components, files };
    }
    return { components };
  }

  private async buildNowPlayingAttachments(
    entries: IMemberNowPlayingEntry[],
    maxImages: number = Number.POSITIVE_INFINITY,
  ): Promise<{ files: AttachmentBuilder[]; thumbnailsByGameId: Map<number, string> }> {
    const files: AttachmentBuilder[] = [];
    const seen = new Set<number>();
    const thumbnailsByGameId = new Map<number, string>();
    let imageCount = 0;
    for (const entry of entries) {
      if (!entry.gameId || seen.has(entry.gameId)) continue;
      seen.add(entry.gameId);
      const game = await Game.getGameById(entry.gameId);
      if (game?.imageData) {
        if (imageCount >= maxImages) {
          break;
        }
        const filename = `now_playing_${entry.gameId}.png`;
        files.push(
          new AttachmentBuilder(game.imageData, { name: filename }),
        );
        thumbnailsByGameId.set(entry.gameId, `attachment://${filename}`);
        imageCount += 1;
      }
    }
    return { files, thumbnailsByGameId };
  }

  private async buildNowPlayingListPayload(
    target: User,
    entries: IMemberNowPlayingEntry[],
    guildId: string | null,
    title: string,
    isOwnList: boolean,
    isEphemeral: boolean,
  ): Promise<{ components: ContainerBuilder[]; files: AttachmentBuilder[] }> {
    const { files, thumbnailsByGameId } = await this.buildNowPlayingAttachments(
      entries,
      NOW_PLAYING_GALLERY_MAX,
    );
    const components = this.buildNowPlayingEntryContainers(
      title,
      entries,
      guildId,
      thumbnailsByGameId,
      target.id,
      isOwnList,
      isEphemeral,
    );
    return { components, files };
  }

  private buildNowPlayingActionRow(
    ownerId: string,
    listCount: number,
  ): ActionRowBuilder<ButtonBuilder> {
    const buttons: ButtonBuilder[] = [];
    const addButton = new ButtonBuilder()
      .setCustomId(`nowplaying-list-add:${ownerId}`)
      .setLabel("Add Game")
      .setStyle(ButtonStyle.Primary);
    if (listCount >= MAX_NOW_PLAYING) {
      addButton.setDisabled(true);
    }
    buttons.push(addButton);
    if (listCount > 1) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`nowplaying-list-sort:${ownerId}`)
          .setLabel("Sort")
          .setStyle(ButtonStyle.Secondary),
      );
    }
    if (listCount > 0) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`nowplaying-list-edit-platform:${ownerId}`)
          .setLabel("Edit Platform")
          .setStyle(ButtonStyle.Secondary),
      );
    }
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`nowplaying-list-complete:${ownerId}`)
        .setLabel("Add Completion")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`nowplaying-list-remove:${ownerId}`)
        .setLabel("Remove Game")
        .setStyle(ButtonStyle.Danger),
    );
    return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
  }

  private buildNowPlayingCancelRow(ownerId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`nowplaying-list-cancel:${ownerId}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    );
  }

  private buildNowPlayingCompletionComponents(
    entries: IMemberNowPlayingEntry[],
    ownerId: string,
    sessionId: string,
    thumbnailsByGameId: Map<number, string>,
  ): Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>> {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## Add Completion\nClick Add Completion to log a game.",
      ),
    );

    const galleryItems: MediaGalleryItemBuilder[] = [];
    for (const entry of entries) {
      if (galleryItems.length >= NOW_PLAYING_GALLERY_MAX) {
        break;
      }
      if (!entry.gameId) {
        continue;
      }
      const imageUrl = thumbnailsByGameId.get(entry.gameId);
      if (!imageUrl) {
        continue;
      }
      const item = new MediaGalleryItemBuilder()
        .setURL(imageUrl)
        .setDescription(formatEntryTitleWithPlatform(entry));
      galleryItems.push(item);
    }

    if (galleryItems.length) {
      container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(galleryItems));
      container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
      );
    }

    entries.forEach((entry, index) => {
      if (index === 0) {
        container.addSeparatorComponents(
          new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
        );
      }
      const lines = [`### ${formatEntryTitleWithPlatform(entry)}`, entry.note ?? ""];
      if (entry.addedAt) {
        const addedLabel = `Added ${formatTableDate(entry.addedAt)}`;
        if (entry.noteUpdatedAt) {
          const updatedLabel = `last updated ${formatTableDate(entry.noteUpdatedAt)}`;
          if (formatTableDate(entry.addedAt) === formatTableDate(entry.noteUpdatedAt)) {
            lines.push(`-# *${addedLabel}.*`);
          } else {
            lines.push(`-# *${addedLabel}, ${updatedLabel}.*`);
          }
        } else {
          lines.push(`-# *${addedLabel}.*`);
        }
      }
      const section = new SectionBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          this.trimTextDisplayContent(lines.join("\n")),
        ),
      );
      section.setButtonAccessory(
        new V2ButtonBuilder()
          .setCustomId(`${NOW_PLAYING_COMPLETE_PICK_PREFIX}:${sessionId}:${entry.gameId}`)
          .setLabel("Add Completion")
          .setStyle(ButtonStyle.Primary),
      );
      container.addSectionComponents(section);
    });

    const doneRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`nowplaying-complete-done:${ownerId}`)
        .setLabel("Done")
        .setStyle(ButtonStyle.Success),
    );
    return [container, doneRow];
  }

  private buildNowPlayingRemoveComponents(
    entries: IMemberNowPlayingEntry[],
    ownerId: string,
    thumbnailsByGameId: Map<number, string>,
  ): Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>> {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## Now Playing Remove\nClick Remove Game to delete an entry.",
      ),
    );

    const galleryItems: MediaGalleryItemBuilder[] = [];
    for (const entry of entries) {
      if (galleryItems.length >= NOW_PLAYING_GALLERY_MAX) {
        break;
      }
      if (!entry.gameId) {
        continue;
      }
      const imageUrl = thumbnailsByGameId.get(entry.gameId);
      if (!imageUrl) {
        continue;
      }
      const item = new MediaGalleryItemBuilder()
        .setURL(imageUrl)
        .setDescription(formatEntryTitleWithPlatform(entry));
      galleryItems.push(item);
    }

    if (galleryItems.length) {
      container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(galleryItems));
      container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
      );
    }

    entries.forEach((entry, index) => {
      if (index === 0) {
        container.addSeparatorComponents(
          new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
        );
      }
      const lines = [`### ${formatEntryTitleWithPlatform(entry)}`, entry.note ?? ""];
      if (entry.addedAt) {
        const addedLabel = `Added ${formatTableDate(entry.addedAt)}`;
        if (entry.noteUpdatedAt) {
          const updatedLabel = `last updated ${formatTableDate(entry.noteUpdatedAt)}`;
          if (formatTableDate(entry.addedAt) === formatTableDate(entry.noteUpdatedAt)) {
            lines.push(`-# *${addedLabel}.*`);
          } else {
            lines.push(`-# *${addedLabel}, ${updatedLabel}.*`);
          }
        } else {
          lines.push(`-# *${addedLabel}.*`);
        }
      }
      const section = new SectionBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          this.trimTextDisplayContent(lines.join("\n")),
        ),
      );
      section.setButtonAccessory(
        new V2ButtonBuilder()
          .setCustomId(`np-remove:${ownerId}:${entry.gameId}`)
          .setLabel("Remove Game")
          .setStyle(ButtonStyle.Danger),
      );
      container.addSectionComponents(section);
    });

    const doneRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`nowplaying-remove-done:${ownerId}`)
        .setLabel("Done")
        .setStyle(ButtonStyle.Success),
    );
    return [container, doneRow];
  }

  private buildNowPlayingEditPlatformComponents(
    entries: IMemberNowPlayingEntry[],
    ownerId: string,
    thumbnailsByGameId: Map<number, string>,
  ): Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>> {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## Now Playing Edit Platform\nClick Edit Platform on a game to change it.",
      ),
    );

    const galleryItems: MediaGalleryItemBuilder[] = [];
    for (const entry of entries) {
      if (galleryItems.length >= NOW_PLAYING_GALLERY_MAX) {
        break;
      }
      if (!entry.gameId) {
        continue;
      }
      const imageUrl = thumbnailsByGameId.get(entry.gameId);
      if (!imageUrl) {
        continue;
      }
      const item = new MediaGalleryItemBuilder()
        .setURL(imageUrl)
        .setDescription(formatEntryTitleWithPlatform(entry));
      galleryItems.push(item);
    }

    if (galleryItems.length) {
      container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(galleryItems));
      container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
      );
    }

    entries.forEach((entry, index) => {
      if (index === 0) {
        container.addSeparatorComponents(
          new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
        );
      }
      const lines = [`### ${formatEntryTitleWithPlatform(entry)}`, entry.note ?? ""];
      if (entry.addedAt) {
        const addedLabel = `Added ${formatTableDate(entry.addedAt)}`;
        if (entry.noteUpdatedAt) {
          const updatedLabel = `last updated ${formatTableDate(entry.noteUpdatedAt)}`;
          if (formatTableDate(entry.addedAt) === formatTableDate(entry.noteUpdatedAt)) {
            lines.push(`-# *${addedLabel}.*`);
          } else {
            lines.push(`-# *${addedLabel}, ${updatedLabel}.*`);
          }
        } else {
          lines.push(`-# *${addedLabel}.*`);
        }
      }
      const section = new SectionBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          this.trimTextDisplayContent(lines.join("\n")),
        ),
      );
      section.setButtonAccessory(
        new V2ButtonBuilder()
          .setCustomId(`np-edit-platform:${ownerId}:${entry.gameId}`)
          .setLabel("Edit Platform")
          .setStyle(ButtonStyle.Secondary),
      );
      container.addSectionComponents(section);
    });

    const doneRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`nowplaying-edit-platform-done:${ownerId}`)
        .setLabel("Done")
        .setStyle(ButtonStyle.Success),
    );
    return [container, doneRow];
  }

  private buildNowPlayingSortComponents(
    entries: IMemberNowPlayingEntry[],
    ownerId: string,
    thumbnailsByGameId: Map<number, string>,
  ): Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>> {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## Sort Your Now Playing List\nClick Move Up to raise a game. Press Done when finished.",
      ),
    );

    const galleryItems: MediaGalleryItemBuilder[] = [];
    for (const entry of entries) {
      if (galleryItems.length >= NOW_PLAYING_GALLERY_MAX) {
        break;
      }
      if (!entry.gameId) {
        continue;
      }
      const imageUrl = thumbnailsByGameId.get(entry.gameId);
      if (!imageUrl) {
        continue;
      }
      const item = new MediaGalleryItemBuilder()
        .setURL(imageUrl)
        .setDescription(formatEntryTitleWithPlatform(entry));
      galleryItems.push(item);
    }

    if (galleryItems.length) {
      container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(galleryItems));
      container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(false),
      );
    }

    entries.forEach((entry, index) => {
      const lines = [`### ${formatEntryTitleWithPlatform(entry)}`];
      if (entry.note) {
        lines.push(entry.note);
        if (entry.noteUpdatedAt) {
          lines.push(`-# *Last updated ${formatTableDate(entry.noteUpdatedAt)}.*`);
        }
      }
      const section = new SectionBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          this.trimTextDisplayContent(lines.join("\n")),
        ),
      );
      const accessory =
        index > 0
          ? new V2ButtonBuilder()
            .setCustomId(`${NOW_PLAYING_SORT_MOVE_PREFIX}:${ownerId}:${entry.gameId}`)
            .setLabel("Move Up")
            .setStyle(ButtonStyle.Secondary)
          : new V2ButtonBuilder()
            .setCustomId(`nowplaying-sort-top:${ownerId}`)
            .setLabel("Top")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true);
      section.setButtonAccessory(accessory);
      container.addSectionComponents(section);
    });

    const doneRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${NOW_PLAYING_SORT_DONE_ID}:${ownerId}`)
        .setLabel("Done")
        .setStyle(ButtonStyle.Success),
    );
    return [container, doneRow];
  }

  private withNowPlayingActions(
    title: string,
    ownerId: string,
    components: ContainerBuilder[],
    listCount: number,
  ): NowPlayingMessageComponents {
    if (title !== "Your Now Playing List") {
      return components;
    }
    return [...components, this.buildNowPlayingActionRow(ownerId, listCount)];
  }

  private async refreshNowPlayingListFromContext(
    interaction: { client: Client; guildId: string | null; user: User },
    userId: string,
  ): Promise<boolean> {
    const context = nowPlayingListContexts.get(userId);
    if (!context) {
      return false;
    }

    const channel = await interaction.client.channels
      .fetch(context.channelId)
      .catch(() => null);
    if (!channel?.isTextBased()) {
      nowPlayingListContexts.delete(userId);
      return false;
    }

    const message = await channel.messages
      .fetch(context.messageId)
      .catch(() => null);
    if (!message) {
      nowPlayingListContexts.delete(userId);
      return false;
    }

    const target =
      interaction.user.id === userId
        ? interaction.user
        : await interaction.client.users.fetch(userId).catch(() => null);
    if (!target) {
      return false;
    }

    const entries = await Member.getNowPlaying(userId);
    const isEphemeral = message.flags?.has(MessageFlags.Ephemeral) ?? true;
    const payload = await this.buildNowPlayingListPayload(
      target,
      entries,
      message.guildId ?? interaction.guildId,
      "Your Now Playing List",
      interaction.user.id === userId,
      isEphemeral,
    );
    const components = this.withNowPlayingActions(
      "Your Now Playing List",
      userId,
      payload.components,
      entries.length,
    );
    try {
      await message.edit({
        components,
        files: payload.files,
        flags: buildComponentsV2Flags(isEphemeral),
      });
    } catch (err: unknown) {
      const error = err as { code?: number; rawError?: { code?: number } };
      const code = error?.code ?? error?.rawError?.code;
      if (code === 10008) {
        nowPlayingListContexts.delete(userId);
        return false;
      }
      throw err;
    }
    return true;
  }


  private buildNowPlayingEntryContainers(
    title: string,
    entries: IMemberNowPlayingEntry[],
    guildId: string | null,
    thumbnailsByGameId: Map<number, string>,
    ownerId: string,
    isOwnList: boolean,
    isEphemeral: boolean,
  ): ContainerBuilder[] {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`));

    const galleryItems: MediaGalleryItemBuilder[] = [];
    for (const entry of entries) {
      if (galleryItems.length >= NOW_PLAYING_GALLERY_MAX) {
        break;
      }
      if (!entry.gameId) {
        continue;
      }
      const imageUrl = thumbnailsByGameId.get(entry.gameId);
      if (!imageUrl) {
        continue;
      }
      const item = new MediaGalleryItemBuilder()
        .setURL(imageUrl)
        .setDescription(formatEntryTitleWithPlatform(entry));
      galleryItems.push(item);
    }

    if (galleryItems.length) {
      container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(galleryItems));
      container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
      );
    }

    const showEditButton = isOwnList && isEphemeral;
    entries.forEach((entry, index) => {
      if (index === 0) {
        container.addSeparatorComponents(
          new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
        );
      }
      const entryTitle = formatEntry(entry, guildId);
      const lines = [`### ${entryTitle}`, entry.note ?? ""];
      if (entry.addedAt) {
        const addedLabel = `Added ${formatTableDate(entry.addedAt)}`;
        if (entry.noteUpdatedAt) {
          const updatedLabel = `last updated ${formatTableDate(entry.noteUpdatedAt)}`;
          if (formatTableDate(entry.addedAt) === formatTableDate(entry.noteUpdatedAt)) {
            lines.push(`-# *${addedLabel}.*`);
          } else {
            lines.push(`-# *${addedLabel}, ${updatedLabel}.*`);
          }
        } else {
          lines.push(`-# *${addedLabel}.*`);
        }
      }
      const content = this.trimTextDisplayContent(lines.join("\n"));
      if (showEditButton && entry.gameId) {
        const section = new SectionBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(content),
        );
        section.setButtonAccessory(
          new V2ButtonBuilder()
            .setCustomId(`${NOW_PLAYING_EDIT_NOTE_DIRECT_PREFIX}:${ownerId}:${entry.gameId}`)
            .setLabel(entry.note ? "Edit Note" : "Add Note")
            .setStyle(ButtonStyle.Secondary),
        );
        container.addSectionComponents(section);
      } else {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
      }
    });
    return [container];
  }

  private trimTextDisplayContent(content: string): string {
    if (content.length <= 4000) {
      return content;
    }
    return `${content.slice(0, 3997)}...`;
  }


  private buildNowPlayingMemberSelect(
    lists: Array<{
      userId: string;
      username: string | null;
      globalName: string | null;
      entries: Array<unknown>;
    }>,
    selectedUserId?: string,
  ): ActionRowBuilder<StringSelectMenuBuilder> {
    const sorted = [...lists].sort((a, b) => {
      const nameA = (a.globalName ?? a.username ?? a.userId).toLowerCase();
      const nameB = (b.globalName ?? b.username ?? b.userId).toLowerCase();
      return nameA.localeCompare(nameB);
    });

    const options = sorted.slice(0, 25).map((record) => {
      const displayName = record.globalName ?? record.username ?? record.userId;
      return {
        label: displayName.slice(0, 100),
        value: record.userId,
        description: `${record.entries.length} ${record.entries.length === 1 ? "game" : "games"}`,
        default: record.userId === selectedUserId,
      };
    });

    const select = new StringSelectMenuBuilder()
      .setCustomId(NOW_PLAYING_ALL_SELECT_ID)
      .setPlaceholder("View a member's Now Playing list")
      .addOptions(options);

    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  }

  private async startNowPlayingIgdbImport(
    interaction: StringSelectMenuInteraction,
    session: { userId: string; query: string; note: string | null },
  ): Promise<void> {
    await this.startNowPlayingIgdbImportFromInteraction(interaction, session, "update");
  }

  private async startNowPlayingIgdbImportFromInteraction(
    interaction: AnyRepliable,
    session: { userId: string; query: string; note: string | null },
    mode: "reply" | "update",
  ): Promise<void> {
    try {
      const searchRes = await igdbService.searchGames(session.query);
      if (!searchRes.results.length) {
        const container = new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `No IGDB results found for "${session.query}".`,
          ),
        );
        if (mode === "update" && "update" in interaction) {
          await interaction.update({ components: [container] });
        } else {
          await interaction.reply({
            components: [container],
            flags: buildComponentsV2Flags(true),
          });
        }
        return;
      }

      const opts: IgdbSelectOption[] = searchRes.results.map((game) => {
        const year = game.first_release_date
          ? new Date(game.first_release_date * 1000).getFullYear()
          : "TBD";
        return {
          id: game.id,
          label: `${game.name} (${year})`,
          description: (game.summary || "No summary").slice(0, 95),
        };
      });

      const { components } = createIgdbSession(session.userId, opts, async (sel, igdbId) => {
        try {
          const imported = await this.importGameFromIgdb(igdbId);
          const sourceSessionId = `np-igdb-add-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
          await this.promptNowPlayingAddPlatformSelection(
            sel,
            sourceSessionId,
            session.userId,
            imported.gameId,
            session.note,
            "update",
          );
        } catch (err: any) {
          const msg = err?.message ?? "Failed to import from IGDB.";
          const container = new ContainerBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent(msg),
          );
          await sel.reply({
            components: [container],
            flags: buildComponentsV2Flags(true),
          }).catch(() => {});
        }
      });

      const container = new ContainerBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            "Select an IGDB result to import and add to Now Playing:",
          ),
        )
        .addActionRowComponents(components.map((row) => row.toJSON()));
      if (mode === "update" && "update" in interaction) {
        await interaction.update({ components: [container] });
      } else {
        await interaction.reply({
          components: [container],
          flags: buildComponentsV2Flags(true),
        });
      }
    } catch (err: any) {
      const msg = err?.message ?? "Failed to search IGDB.";
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(msg),
      );
      if (mode === "update" && "update" in interaction) {
        await interaction.update({ components: [container] });
      } else {
        await interaction.reply({
          components: [container],
          flags: buildComponentsV2Flags(true),
        });
      }
    }
  }

  private async importGameFromIgdb(igdbId: number): Promise<{ gameId: number; title: string }> {
    return Game.importGameFromIgdb(igdbId);
  }
}
