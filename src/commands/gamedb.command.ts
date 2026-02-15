/* eslint-disable no-irregular-whitespace */
import {
  ApplicationCommandOptionType,
  CommandInteraction,
  EmbedBuilder,
  StringSelectMenuBuilder,
  AutocompleteInteraction,
  ActionRowBuilder,
  StringSelectMenuInteraction,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ComponentType,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
  Attachment,
  type ForumChannel,
  type Message,
  type ThreadChannel,
  type TextBasedChannel,
  type MessageCreateOptions,
  type ActionRow,
  type MessageActionRowComponent,
  AttachmentBuilder,
  MessageFlags,
  PermissionsBitField,
  WebhookClient,
} from "discord.js";
import {
  ButtonComponent,
  Discord,
  ModalComponent,
  SelectMenuComponent,
  Slash,
  SlashChoice,
  SlashGroup,
  SlashOption,
} from "discordx";
import {
  ContainerBuilder,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  ButtonBuilder as V2ButtonBuilder,
} from "@discordjs/builders";
import { SeparatorSpacingSize } from "discord-api-types/v10";
import {
  AnyRepliable,
  safeDeferReply,
  safeReply,
  safeUpdate,
  sanitizeUserInput,
  stripModalInput,
} from "../functions/InteractionUtils.js";
import { formatGameTitleWithYear } from "../functions/GameTitleAutocompleteUtils.js";
import {
  normalizeCsvHeader,
  normalizePlatformKey,
  normalizeTitleKey,
  parseCsvDate,
  parseCsvLine,
  stripTitleDateSuffix,
} from "../functions/CsvUtils.js";
import { shouldRenderPrevNextButtons } from "../functions/PaginationUtils.js";
import Game, { type IGame, type IRelease } from "../classes/Game.js";
import { getHltbCacheByGameId, upsertHltbCache } from "../classes/HltbCache.js";
import { getThreadsByGameId, setThreadGameLink, upsertThreadRecord } from "../classes/Thread.js";
import axios from "axios"; // For downloading image attachments
import { igdbService, type IGDBGame, type IGDBGameDetails } from "../services/IGDB/IgdbService.js";
import {
  createIgdbSession,
  type IgdbSelectOption,
} from "../services/IGDB/IgdbSelectService.js";
import Member from "../classes/Member.js";
import { NowPlayingCommand } from "./now-playing.command.js";
import {
  COMPLETION_TYPES,
  type CompletionType,
  formatTableDate,
  parseCompletionDateInput,
} from "./profile.command.js";
import {
  notifyUnknownCompletionPlatform,
  validateCompletionPlaytimeInput,
} from "../functions/CompletionHelpers.js";
import { searchHltb } from "../scripts/SearchHltb.js";
import { formatPlatformDisplayName } from "../functions/PlatformDisplay.js";
import { NOW_PLAYING_FORUM_ID } from "../config/channels.js";
import { NOW_PLAYING_SIDEGAME_TAG_ID } from "../config/tags.js";
import { COMPONENTS_V2_FLAG } from "../config/flags.js";
import { STANDARD_PLATFORM_IDS } from "../config/standardPlatforms.js";
import { padCommandName } from "./help.command.js";
import { openNominationModal } from "./nominate.command.js";
import {
  countGameDbCsvImportItems,
  createGameDbCsvImportSession,
  getActiveGameDbCsvImportForUser,
  getGameDbCsvImportById,
  getGameDbCsvImportItemById,
  getNextGameDbCsvImportItem,
  insertGameDbCsvImportItems,
  setGameDbCsvImportStatus,
  updateGameDbCsvImportIndex,
  updateGameDbCsvImportItem,
  type IGameDbCsvImport,
  type IGameDbCsvImportItem,
} from "../classes/GameDbCsvImport.js";
import {
  getGameDbCsvTitleMapByNorm,
  upsertGameDbCsvTitleMap,
} from "../classes/GameDbCsvImportMapping.js";
import { GAMEDB_CSV_PLATFORM_MAP } from "../config/gamedbCsvPlatformMap.js";

const GAME_SEARCH_PAGE_SIZE = 10;
const MAX_COMPONENT_CUSTOM_ID_LENGTH = 100;
const COMPLETION_WIZARD_SESSIONS = new Map<string, CompletionWizardSession>();
const GAMEDB_CSV_ACTIONS = ["start", "resume", "status", "pause", "cancel"] as const;
const GAMEDB_CSV_RESULT_LIMIT = 15;
const GAMEDB_CSV_SELECT_PREFIX = "gamedb-csv-select";
const GAMEDB_CSV_ACTION_PREFIX = "gamedb-csv-action";
const GAMEDB_CSV_MANUAL_PREFIX = "gamedb-csv-manual";
const GAMEDB_CSV_MANUAL_INPUT_ID = "gamedb-csv-manual-igdb-id";
const GAMEDB_CSV_QUERY_PREFIX = "gamedb-csv-query";
const GAMEDB_CSV_QUERY_INPUT_ID = "gamedb-csv-query-text";
const GAMEDB_CSV_AUTO_ACCEPTED = new Map<number, string[]>();

type GameDbCsvAction = (typeof GAMEDB_CSV_ACTIONS)[number];

type GameDbCsvParsedRow = {
  rowIndex: number;
  gameTitle: string;
  rawGameTitle: string | null;
  platformName: string | null;
  regionName: string | null;
  initialReleaseDate: Date | null;
};

type GameProfileRenderContext = {
  guildId?: string;
  includeInlineButtons?: boolean;
  prefaceText?: string;
};

function decodeSearchQuery(encoded: string): string {
  if (!encoded) return "";
  try {
    return Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function encodeSearchQuery(query: string, maxLength: number): string {
  let trimmed = query.trim();
  let encoded = Buffer.from(trimmed, "utf8").toString("base64url");
  if (encoded.length <= maxLength) return encoded;
  for (let i = trimmed.length - 1; i >= 0; i -= 1) {
    trimmed = trimmed.slice(0, i + 1);
    encoded = Buffer.from(trimmed, "utf8").toString("base64url");
    if (encoded.length <= maxLength) return encoded;
  }
  return "";
}


function buildIgdbSearchLink(title: string): string {
  const encoded = encodeURIComponent(title);
  return `https://www.igdb.com/search?utf8=%E2%9C%93&type=1&q=${encoded}`;
}

function getModeratorPermissionFlags(interaction: AnyRepliable): {
  isOwner: boolean;
  isAdmin: boolean;
  isModerator: boolean;
} | null {
  const guild = interaction.guild;
  if (!guild) return null;

  const member: any = interaction.member;
  const canCheck = member && typeof member.permissionsIn === "function" && interaction.channel;
  const isOwner = guild.ownerId === interaction.user.id;
  const isAdmin = canCheck
    ? member.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.Administrator)
    : false;
  const isModerator = canCheck
    ? member.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.ManageMessages)
    : false;

  return { isOwner, isAdmin, isModerator };
}

async function requireModeratorOrAdminOrOwner(
  interaction: AnyRepliable,
): Promise<boolean> {
  const permissions = getModeratorPermissionFlags(interaction);
  if (!permissions) {
    await safeReply(interaction, {
      content: "This action can only be used inside a server.",
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  if (permissions.isOwner || permissions.isAdmin || permissions.isModerator) {
    return true;
  }

  await safeReply(interaction, {
    content: "Access denied. Action requires Moderator, Administrator, or server owner.",
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

function pushAutoAcceptedTitle(importId: number, title: string): void {
  const list = GAMEDB_CSV_AUTO_ACCEPTED.get(importId) ?? [];
  list.push(title);
  GAMEDB_CSV_AUTO_ACCEPTED.set(importId, list);
}

function consumeAutoAcceptedSummary(importId: number): string | null {
  const list = GAMEDB_CSV_AUTO_ACCEPTED.get(importId);
  if (!list || list.length === 0) return null;
  GAMEDB_CSV_AUTO_ACCEPTED.set(importId, []);
  const lines = list.map((title) => `- ${title}`);
  return `Auto-accepted since last prompt:\n${lines.join("\n")}`;
}


function buildSearchCustomId(
  type: "select" | "page",
  ownerId: string,
  page: number,
  query: string,
  direction?: "next" | "prev",
): string {
  const base = `gamedb-search-${type}:${ownerId}:${page}:`;
  const maxQueryLength = MAX_COMPONENT_CUSTOM_ID_LENGTH - base.length - (direction ? `:${direction}`.length : 0);
  const encodedQuery = encodeSearchQuery(query, Math.max(maxQueryLength, 0));
  return direction
    ? `${base}${encodedQuery}:${direction}`
    : `${base}${encodedQuery}`;
}

function buildSearchRefreshCustomId(ownerId: string, encodedQuery: string): string {
  return `gamedb-search-refresh:${ownerId}:${encodedQuery}`;
}

function buildSearchRecoveryComponents(ownerId: string, encodedQuery: string): ActionRowBuilder<ButtonBuilder>[] {
  const button = new ButtonBuilder()
    .setCustomId(buildSearchRefreshCustomId(ownerId, encodedQuery))
    .setLabel("Refresh search")
    .setStyle(ButtonStyle.Primary);

  return [new ActionRowBuilder<ButtonBuilder>().addComponents(button)];
}

function isUniqueConstraintError(err: any): boolean {
  const msg = err?.message ?? "";
  return /ORA-00001/i.test(msg) || /unique constraint/i.test(msg);
}

function isUnknownWebhookError(err: any): boolean {
  const code = err?.code ?? err?.rawError?.code;
  return code === 10015;
}

function buildComponentsV2Flags(isEphemeral: boolean): number {
  return (isEphemeral ? MessageFlags.Ephemeral : 0) | COMPONENTS_V2_FLAG;
}

function isHltbImportEligible(
  game: { initialReleaseDate?: Date | null },
  hasCache: boolean,
): boolean {
  if (hasCache) return false;
  if (!game.initialReleaseDate) return false;
  const releaseDate = game.initialReleaseDate instanceof Date
    ? game.initialReleaseDate
    : new Date(game.initialReleaseDate);
  if (Number.isNaN(releaseDate.getTime())) return false;
  const now = new Date();
  if (releaseDate > now) return false;
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  return releaseDate <= sixMonthsAgo;
}

function getSearchRowsFromComponents(
  components: Array<ActionRow<MessageActionRowComponent> | unknown>,
): ActionRow<MessageActionRowComponent>[] {
  return components.filter((row) => {
    if (!row || typeof row !== "object") return false;
    const rowComponents = "components" in row ? (row as any).components : [];
    return Array.isArray(rowComponents) && rowComponents.some((component) =>
      component.customId?.startsWith("gamedb-search-"),
    );
  }) as ActionRow<MessageActionRowComponent>[];
}

function buildKeepTypingOption(query: string): { name: string; value: string } {
  const label = `Keep typing: "${query}"`;
  return {
    name: label.slice(0, 100),
    value: query,
  };
}

async function autocompleteGameDbViewTitle(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const rawQuery = focused?.value ? String(focused.value) : "";
  const query = sanitizeUserInput(rawQuery, { preserveNewlines: false }).trim();
  if (!query) {
    await interaction.respond([]);
    return;
  }
  const results = await Game.searchGamesAutocomplete(query);
  const resultOptions = results.slice(0, 24).map((game) => {
    const label = formatGameTitleWithYear(game);
    return {
      name: label.slice(0, 100),
      value: String(game.id),
    };
  });
  const options = [buildKeepTypingOption(query), ...resultOptions];
  await interaction.respond(options);
}

const MAX_COMPLETION_NOTE_LEN = 500;
const MAX_NOW_PLAYING_NOTE_LEN = 500;

type PromptChoiceOption = {
  label: string;
  value: string;
  style?: ButtonStyle;
};

type CompletionWizardSession = {
  id: string;
  userId: string;
  gameId: number;
  gameTitle: string;
  createdAt: Date;
  sourceMessageId: string;
  sourceChannelId: string;
  interactionToken: string;
  applicationId: string;
  completionType?: CompletionType;
  dateChoice?: "today" | "unknown" | "date";
  platformChoice?: string;
  removeChoice?: "yes" | "no";
  requiresRemoveChoice: boolean;
  ephemeralMessageId?: string;
};

function buildChoiceRows(
  customIdPrefix: string,
  options: PromptChoiceOption[],
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < options.length; i += 5) {
    const slice = options.slice(i, i + 5);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      slice.map((opt) =>
        new ButtonBuilder()
          .setCustomId(`${customIdPrefix}:${opt.value}`)
          .setLabel(opt.label)
          .setStyle(opt.style ?? ButtonStyle.Secondary),
      ),
    );
    rows.push(row);
  }
  return rows;
}

@Discord()
@SlashGroup({ description: "Game Database Commands", name: "gamedb" })
@SlashGroup("gamedb")
export class GameDb {
  private static csvPlatformLookup: Map<string, number> | null = null;

  @Slash({ description: "Add a new game to the database (searches IGDB)", name: "add" })
  async add(
    @SlashOption({
      description: "Title of the game to search for",
      name: "title",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    title: string | undefined,
    @SlashOption({
      description: "IGDB id (skip search and import directly)",
      name: "igdb_id",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    igdbId: number | undefined,
    @SlashOption({
      description: "Comma-separated list of up to 5 titles to import",
      name: "bulk_titles",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    bulkTitles: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    if (igdbId) {
      await this.addGameToDatabase(interaction, Number(igdbId), { selectionMessage: null });
      return;
    }

    const sanitizedTitle = title
      ? sanitizeUserInput(title, { preserveNewlines: false })
      : "";
    const sanitizedBulk = bulkTitles
      ? sanitizeUserInput(bulkTitles, { preserveNewlines: false })
      : "";
    const parsedBulk = sanitizedBulk
      ? sanitizedBulk.split(",").map((t) => t.trim()).filter(Boolean)
      : [];
    const singleTitle = sanitizedTitle.trim();
    const allTitles =
      (singleTitle ? [singleTitle] : []).concat(parsedBulk).filter(Boolean);

    if (!allTitles.length) {
      await safeReply(interaction, {
        content: "Provide a title or up to 5 comma-separated titles.",
      });
      return;
    }

    if (allTitles.length > 5) {
      await safeReply(interaction, {
        content: "Bulk import supports up to 5 titles at a time.",
      });
      return;
    }

    for (const t of allTitles) {
      await this.processTitle(interaction, t);
    }
  }

  @Slash({ description: "Import games from a Completionator CSV", name: "csv-import" })
  async csvImport(
    @SlashChoice(
      ...GAMEDB_CSV_ACTIONS.map((value) => ({
        name: value,
        value,
      })),
    )
    @SlashOption({
      description: "Action to perform",
      name: "action",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    action: GameDbCsvAction,
    @SlashOption({
      description: "Completionator CSV file (required for start)",
      name: "file",
      required: false,
      type: ApplicationCommandOptionType.Attachment,
    })
    file: Attachment | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const hasAccess = await this.requireGameDbCsvImportAccess(interaction);
    if (!hasAccess) return;

    const userId = interaction.user.id;

    if (action === "start") {
      if (!file?.url) {
        await safeReply(interaction, {
          content: "Please attach the Completionator CSV file.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const csvText = await this.fetchCsvText(file.url);
      if (!csvText) {
        await safeReply(interaction, {
          content: "Failed to download the CSV file.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const parsed = this.parseGameDbCsv(csvText);
      if (!parsed.length) {
        await safeReply(interaction, {
          content: "No rows found in the CSV file.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const session = await createGameDbCsvImportSession({
        userId,
        totalCount: parsed.length,
        sourceFilename: file.name ?? null,
      });
      await insertGameDbCsvImportItems(session.importId, parsed);

      await safeReply(interaction, {
        content:
          `CSV import #${session.importId} created with ${parsed.length} rows.` +
          " Starting review now.",
        flags: MessageFlags.Ephemeral,
      });

      await this.processNextGameDbCsvImportItem(interaction, session);
      return;
    }

    if (action === "status") {
      const session = await getActiveGameDbCsvImportForUser(userId);
      if (!session) {
        await safeReply(interaction, {
          content: "No active CSV import session found.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const stats = await countGameDbCsvImportItems(session.importId);
      const embed = new EmbedBuilder()
        .setTitle(`GameDB CSV Import #${session.importId}`)
        .setDescription(`Status: ${session.status}`)
        .addFields(
          { name: "Pending", value: String(stats.pending), inline: true },
          { name: "Imported", value: String(stats.imported), inline: true },
          { name: "Skipped", value: String(stats.skipped), inline: true },
          { name: "Errors", value: String(stats.error), inline: true },
        );

      await safeReply(interaction, {
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const session = await getActiveGameDbCsvImportForUser(userId);
    if (!session) {
      await safeReply(interaction, {
        content: "No active CSV import session found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === "pause") {
      await setGameDbCsvImportStatus(session.importId, "PAUSED");
      await safeReply(interaction, {
        content: `CSV import #${session.importId} paused.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === "cancel") {
      await setGameDbCsvImportStatus(session.importId, "CANCELED");
      await safeReply(interaction, {
        content: `CSV import #${session.importId} canceled.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await setGameDbCsvImportStatus(session.importId, "ACTIVE");
    await safeReply(interaction, {
      content: `Resuming CSV import #${session.importId}.`,
      flags: MessageFlags.Ephemeral,
    });
    await this.processNextGameDbCsvImportItem(interaction, session);
  }

  private async handleNoResults(
    interaction: CommandInteraction | StringSelectMenuInteraction,
    query: string,
  ): Promise<void> {
    try {
      // If something was added concurrently, surface nearby matches while prompting IGDB import.
      const existing = await Game.searchGames(query);
      const existingList = existing
        .slice(0, 10)
        .map((g) => `• **${g.title}** (GameDB #${g.id})`);
      const existingText = existingList.length
        ? `${existingList.join("\n")}${existing.length > 10 ? "\n(and more...)" : ""}`
        : null;

      const searchRes = await igdbService.searchGames(query);
      const results = searchRes.results;

      if (!results.length) {
        await safeReply(interaction, {
          content: existingText
            ? `No games found on IGDB matching "${query}".\nSimilar GameDB entries:\n${existingText}`
            : `No games found on IGDB matching "${query}".`,
          __forceFollowUp: true,
        });
        return;
      }

      if (results.length === 1) {
        await this.addGameToDatabase(interaction, results[0].id, {
          selectionMessage: null,
          showProfile: true,
        });
        return;
      }

      const opts: IgdbSelectOption[] = await this.buildIgdbSelectOptions(results);

      const { components } = createIgdbSession(
        interaction.user.id,
        opts,
        async (sel, igdbId) => {
          if (!sel.deferred && !sel.replied) {
            await sel.deferUpdate().catch(() => {});
          }
          await this.addGameToDatabase(sel, igdbId, { selectionMessage: sel.message as any });
        },
      );

      const totalLabel =
        typeof searchRes.total === "number" ? searchRes.total : results.length;
      const needsPaging = totalLabel > 22;
      const pagingHint = needsPaging
        ? "\nUse the dropdown's Next page option to see more results."
        : "";

      const baseText =
        `## IGDB Results for "${query}"\n` +
        `Found ${totalLabel} results. Showing first ${Math.min(results.length, 22)}.` +
        `${pagingHint ? ` ${pagingHint}` : ""}`;
      const contentParts = [baseText];
      if (existingText) {
        contentParts.push(`**Existing GameDB matches**\n${existingText}`);
      }
      const content = this.trimTextDisplayContent(contentParts.join("\n\n"));
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(content),
      );

      await safeReply(interaction, {
        components: [container, ...components],
        flags: buildComponentsV2Flags(false),
        __forceFollowUp: true,
      });
    } catch (err: any) {
      await safeReply(interaction, {
        content: `Auto-import failed: ${err?.message ?? err}`,
        __forceFollowUp: true,
      });
    }
  }
  private async processTitle(
    interaction: CommandInteraction,
    title: string,
  ): Promise<void> {
    try {
      // 1. Search IGDB
      const searchRes = await igdbService.searchGames(title);
      const results = searchRes.results;

      if (!results || results.length === 0) {
        await this.handleNoResults(interaction, title);
        return;
      }

      // 1b. Single Result - Auto Add
      if (results.length === 1) {
        await this.addGameToDatabase(interaction, results[0].id, {
          selectionMessage: null,
          showProfile: true,
        });
        return;
      }

      // 2. Build Select Menu
      const opts: IgdbSelectOption[] = await this.buildIgdbSelectOptions(results);

      const { components } = createIgdbSession(
        interaction.user.id,
        opts,
        async (sel, igdbId) => {
          if (!sel.deferred && !sel.replied) {
            await sel.deferUpdate().catch(() => {});
          }
          await this.addGameToDatabase(sel, igdbId, { selectionMessage: sel.message as any });
        },
      );

      const content = this.trimTextDisplayContent(
        `## IGDB Results for "${title}"\nFound ${results.length} results. Please select one:`,
      );
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(content),
      );
      await safeReply(interaction, {
        components: [container, ...components],
        flags: buildComponentsV2Flags(false),
        __forceFollowUp: true,
      });

    } catch (error: any) {
      await safeReply(interaction, {
        content: `Failed to search IGDB. Error: ${error.message}`,
      });
    }
  }

  private async requireGameDbCsvImportAccess(
    interaction: CommandInteraction,
  ): Promise<boolean> {
    const guild = interaction.guild;
    if (!guild) {
      await safeReply(interaction, {
        content: "This command can only be used inside a server.",
        flags: MessageFlags.Ephemeral,
      });
      return false;
    }

    const isOwner = guild.ownerId === interaction.user.id;
    if (isOwner) {
      return true;
    }

    await safeReply(interaction, {
      content: "Access denied. Command requires server owner.",
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  private async fetchCsvText(url: string): Promise<string | null> {
    try {
      const response = await axios.get(url, { responseType: "arraybuffer" });
      return Buffer.from(response.data).toString("utf-8");
    } catch {
      return null;
    }
  }

  private parseGameDbCsv(csvText: string): GameDbCsvParsedRow[] {
    const rows = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (!rows.length) return [];
    const header = parseCsvLine(rows[0]).map(normalizeCsvHeader);
    const nameIndex = header.indexOf("name");
    const platformIndex = header.indexOf("platform");
    const regionIndex = header.indexOf("region");
    const initialReleaseIndex = header.indexOf("initial release date");

    if (nameIndex < 0) return [];

    const dataRows = rows.slice(1);
    const items: GameDbCsvParsedRow[] = [];

    dataRows.forEach((line, idx) => {
      const fields = parseCsvLine(line);
      const titleRaw = fields[nameIndex] ?? "";
      const rawTitle = titleRaw.trim();
      const title = stripTitleDateSuffix(rawTitle).trim();
      if (!title) return;

      const platformName = platformIndex >= 0 ? fields[platformIndex]?.trim() : "";
      const regionName = regionIndex >= 0 ? fields[regionIndex]?.trim() : "";
      const initialRelease = initialReleaseIndex >= 0
        ? parseCsvDate(fields[initialReleaseIndex])
        : null;

      items.push({
        rowIndex: idx + 1,
        gameTitle: title,
        rawGameTitle: rawTitle || null,
        platformName: platformName || null,
        regionName: regionName || null,
        initialReleaseDate: initialRelease,
      });
    });

    return items;
  }

  private async getPlatformLookupMap(): Promise<Map<string, number>> {
    if (GameDb.csvPlatformLookup) return GameDb.csvPlatformLookup;
    const platforms = await Game.getAllPlatforms();
    const map = new Map<string, number>();
    for (const platform of platforms) {
      if (!platform.igdbPlatformId) continue;
      const normalized = normalizePlatformKey(platform.name);
      if (!map.has(normalized)) {
        map.set(normalized, platform.igdbPlatformId);
      }
    }
    GameDb.csvPlatformLookup = map;
    return map;
  }

  private async mapCsvPlatformToIgdbIds(platformName: string | null): Promise<number[]> {
    if (!platformName) return [];
    const normalized = normalizePlatformKey(platformName);
    if (!normalized) return [];

    const platformLookup = await this.getPlatformLookupMap();
    const mappedNames = GAMEDB_CSV_PLATFORM_MAP[normalized];
    const resolved: number[] = [];

    if (mappedNames?.length) {
      for (const name of mappedNames) {
        const mapped = platformLookup.get(normalizePlatformKey(name));
        if (mapped && !resolved.includes(mapped)) {
          resolved.push(mapped);
        }
      }
    }

    if (!resolved.length) {
      const direct = platformLookup.get(normalized);
      if (direct) {
        resolved.push(direct);
      }
    }

    return resolved;
  }

  private buildCsvPromptContent(
    session: IGameDbCsvImport,
    item: IGameDbCsvImportItem,
    hasResults: boolean,
  ): string {
    const releaseText = item.initialReleaseDate
      ? formatTableDate(item.initialReleaseDate)
      : "Unknown";
    const platformText = item.platformName ?? "Unknown";
    const displayTitle = item.rawGameTitle ?? item.gameTitle;
    const base =
      `## CSV Import #${session.importId} - Item ${item.rowIndex}/${session.totalCount}\n` +
      `**Title:** ${displayTitle}\n` +
      `**Platform:** ${platformText}\n` +
      `**Initial Release:** ${releaseText}`;
    if (hasResults) {
      return `${base}\n\nSelect an IGDB match or choose Manual IGDB ID to enter one.`;
    }
    const searchTitle = item.rawGameTitle ?? item.gameTitle;
    const link = buildIgdbSearchLink(searchTitle);
    return `${base}\n\nNo IGDB matches found. Search: ${link}\nChoose Manual IGDB ID or Skip.`;
  }

  private buildCsvPromptContainer(content: string): ContainerBuilder {
    const container = new ContainerBuilder();
    const safeContent = content.length > 4000
      ? `${content.slice(0, 3997)}...`
      : content;
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeContent),
    );
    return container;
  }

  private buildCsvPromptComponents(
    ownerId: string,
    importId: number,
    itemId: number,
    options: IgdbSelectOption[],
  ): ActionRowBuilder<any>[] {
    const rows: ActionRowBuilder<any>[] = [];

    if (options.length) {
      const select = new StringSelectMenuBuilder()
        .setCustomId(`${GAMEDB_CSV_SELECT_PREFIX}:${ownerId}:${importId}:${itemId}`)
        .setPlaceholder("Select a match from IGDB")
        .addOptions(
          options.slice(0, GAMEDB_CSV_RESULT_LIMIT).map((opt, idx) => ({
            label: opt.label.slice(0, 100),
            value: String(opt.id),
            description: opt.description?.slice(0, 100),
            default: idx === 0,
          })),
        );
      rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
    }

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${GAMEDB_CSV_ACTION_PREFIX}:${ownerId}:${importId}:${itemId}:manual`)
        .setLabel("Manual IGDB ID")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${GAMEDB_CSV_ACTION_PREFIX}:${ownerId}:${importId}:${itemId}:query`)
        .setLabel("Manual IGDB Query")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${GAMEDB_CSV_ACTION_PREFIX}:${ownerId}:${importId}:${itemId}:accept`)
        .setLabel("Accept First Option")
        .setStyle(ButtonStyle.Success),
    );
    const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${GAMEDB_CSV_ACTION_PREFIX}:${ownerId}:${importId}:${itemId}:skip`)
        .setLabel("Skip")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${GAMEDB_CSV_ACTION_PREFIX}:${ownerId}:${importId}:${itemId}:pause`)
        .setLabel("Pause")
        .setStyle(ButtonStyle.Secondary),
    );
    rows.push(actionRow, controlRow);
    return rows;
  }

  private async scoreCsvImportResults(
    item: IGameDbCsvImportItem,
    results: IGDBGame[],
  ): Promise<IgdbSelectOption[]> {
    const sortedGames = await this.scoreCsvImportGames(item, results);
    return sortedGames.slice(0, GAMEDB_CSV_RESULT_LIMIT).map((game) => {
      const year = game.first_release_date
        ? new Date(game.first_release_date * 1000).getFullYear()
        : "TBD";
      return {
        id: game.id,
        label: `${game.name} (${year})`,
        description: game.summary ? game.summary.slice(0, 95) : "No summary",
      };
    });
  }

  private async scoreCsvImportGames(
    item: IGameDbCsvImportItem,
    results: IGDBGame[],
  ): Promise<IGDBGame[]> {
    const platformIds = await this.mapCsvPlatformToIgdbIds(item.platformName);
    const platformSet = new Set(platformIds);
    const releaseYear = item.initialReleaseDate?.getFullYear() ?? null;
    const normalizedTitle = normalizeTitleKey(item.gameTitle);

    const scored = results.map((game) => {
      const normalizedName = normalizeTitleKey(game.name);
      const isExact = normalizedTitle && normalizedName === normalizedTitle;
      const hasPlatform = platformSet.size
        ? (game.platforms ?? []).some((p) => platformSet.has(p.id))
        : false;
      const year = game.first_release_date
        ? new Date(game.first_release_date * 1000).getFullYear()
        : null;
      const yearMatch = releaseYear && year ? releaseYear === year : false;

      let score = 0;
      if (isExact) score += 4;
      if (hasPlatform) score += 3;
      if (yearMatch) score += 2;

      return { game, score, year: year ?? 0 };
    });

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.year !== a.year) return b.year - a.year;
      return a.game.name.localeCompare(b.game.name);
    });

    return scored.map((entry) => entry.game);
  }

  private async importGameFromCsv(igdbId: number): Promise<{ gameId: number; title: string }> {
    const details = await igdbService.getGameDetails(igdbId);
    if (!details) {
      throw new Error("Failed to fetch IGDB details for this game.");
    }

    const existing = await Game.getGameByIgdbId(igdbId);
    if (existing) {
      const igdbPlatformIds: number[] = (details.platforms ?? [])
        .map((platform) => platform.id)
        .filter((id) => Number.isInteger(id) && id > 0);
      await Game.addGamePlatformsByIgdbIds(existing.id, igdbPlatformIds);
      await this.processReleaseDates(existing.id, details.release_dates ?? []);
      if (!existing.imageData) {
        const coverData = await this.fetchIgdbCoverImage(details);
        if (coverData) {
          await Game.updateGameImage(existing.id, coverData);
        }
      }
      if (!existing.artData) {
        const artData = await this.fetchIgdbArtImage(details);
        if (artData) {
          await Game.updateGameArt(existing.id, artData);
        }
      }
      return { gameId: existing.id, title: existing.title };
    }

    const imageData = await this.fetchIgdbCoverImage(details);
    const artData = await this.fetchIgdbArtImage(details);
    const igdbUrl = details.url
      || (details.slug ? `https://www.igdb.com/games/${details.slug}` : null);
    let newGame: IGame | null = null;

    try {
      newGame = await Game.createGame(
        details.name,
        details.summary || null,
        imageData,
        details.id,
        details.slug,
        details.total_rating ?? null,
        igdbUrl,
        Game.getFeaturedVideoUrl(details),
        artData,
      );
    } catch (err: any) {
      if (isUniqueConstraintError(err)) {
        const fallback = await Game.getGameByIgdbId(details.id);
        if (fallback) {
          return { gameId: fallback.id, title: fallback.title };
        }
      }
      throw err;
    }

    await Game.saveFullGameMetadata(newGame.id, details);
    const igdbPlatformIds: number[] = (details.platforms ?? [])
      .map((platform) => platform.id)
      .filter((id) => Number.isInteger(id) && id > 0);
    await Game.addGamePlatformsByIgdbIds(newGame.id, igdbPlatformIds);
    await this.processReleaseDates(newGame.id, details.release_dates ?? []);

    return { gameId: newGame.id, title: newGame.title };
  }

  private async fetchIgdbCoverImage(details: IGDBGameDetails): Promise<Buffer | null> {
    if (!details.cover?.image_id) return null;
    try {
      const imageUrl =
        `https://images.igdb.com/igdb/image/upload/t_cover_big/${details.cover.image_id}.jpg`;
      const imageResponse = await axios.get(imageUrl, { responseType: "arraybuffer" });
      return Buffer.from(imageResponse.data);
    } catch (err) {
      console.error("Failed to download cover image:", err);
      return null;
    }
  }

  private async fetchIgdbArtImage(details: IGDBGameDetails): Promise<Buffer | null> {
    const imageId = details.artworks?.[0]?.image_id;
    if (!imageId) return null;
    try {
      const imageUrl =
        `https://images.igdb.com/igdb/image/upload/t_thumb_2x/${imageId}.jpg`;
      const imageResponse = await axios.get(imageUrl, { responseType: "arraybuffer" });
      return Buffer.from(imageResponse.data);
    } catch (err) {
      console.error("Failed to download artwork image:", err);
      return null;
    }
  }

  private async processNextGameDbCsvImportItem(
    interaction: CommandInteraction | ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
    session: IGameDbCsvImport,
  ): Promise<void> {
    const current = await getGameDbCsvImportById(session.importId);
    if (!current || current.status !== "ACTIVE") {
      return;
    }

    const nextItem = await getNextGameDbCsvImportItem(session.importId);
    if (!nextItem) {
      await setGameDbCsvImportStatus(session.importId, "COMPLETED");
      await safeReply(interaction, {
        content: `CSV import #${session.importId} completed.`,
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      return;
    }

    await updateGameDbCsvImportIndex(session.importId, nextItem.rowIndex);

    const searchTitle = stripTitleDateSuffix(
      nextItem.rawGameTitle ?? nextItem.gameTitle,
    ).trim();
    if (!searchTitle) {
      await updateGameDbCsvImportItem(nextItem.itemId, {
        status: "ERROR",
        errorText: "Missing title for IGDB search.",
      });
      await safeReply(interaction, {
        content: "Missing title for IGDB search. Skipping.",
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      await this.processNextGameDbCsvImportItem(interaction, session);
      return;
    }

    const normalizedTitle = normalizeTitleKey(searchTitle);
    if (normalizedTitle) {
      const mapping = await getGameDbCsvTitleMapByNorm(normalizedTitle);
      if (mapping?.status === "SKIPPED") {
        await updateGameDbCsvImportItem(nextItem.itemId, { status: "SKIPPED" });
        await this.processNextGameDbCsvImportItem(interaction, session);
        return;
      }
      if (mapping?.status === "MAPPED" && mapping.gameDbGameId) {
        const mappedGame = await Game.getGameById(mapping.gameDbGameId);
        if (!mappedGame) {
          await updateGameDbCsvImportItem(nextItem.itemId, {
            status: "ERROR",
            errorText: `Mapped GameDB id ${mapping.gameDbGameId} not found.`,
          });
          await safeReply(interaction, {
            content: `Mapped GameDB #${mapping.gameDbGameId} not found. Skipping.`,
            flags: MessageFlags.Ephemeral,
            __forceFollowUp: true,
          });
          await this.processNextGameDbCsvImportItem(interaction, session);
          return;
        }

        await updateGameDbCsvImportItem(nextItem.itemId, {
          status: "IMPORTED",
          gameDbGameId: mappedGame.id,
          errorText: null,
        });
        pushAutoAcceptedTitle(session.importId, mappedGame.title);
        await this.processNextGameDbCsvImportItem(interaction, session);
        return;
      }
    }

    let results: IGDBGame[] = [];
    try {
      const search = await igdbService.searchGames(searchTitle, 50);
      results = search.results ?? [];
    } catch (err: any) {
      await updateGameDbCsvImportItem(nextItem.itemId, {
        status: "ERROR",
        errorText: err?.message ?? "IGDB search failed.",
      });
      await safeReply(interaction, {
        content: `IGDB search failed for "${nextItem.gameTitle}". Skipping.`,
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      await this.processNextGameDbCsvImportItem(interaction, session);
      return;
    }

    const sortedGames = results.length
      ? await this.scoreCsvImportGames(nextItem, results)
      : [];
    const options = sortedGames.length
      ? sortedGames.slice(0, GAMEDB_CSV_RESULT_LIMIT).map((game) => {
        const year = game.first_release_date
          ? new Date(game.first_release_date * 1000).getFullYear()
          : "TBD";
        return {
          id: game.id,
          label: `${game.name} (${year})`,
          description: game.summary ? game.summary.slice(0, 95) : "No summary",
        };
      })
      : [];
    const bestMatch = sortedGames[0];
    const shouldAutoAccept = this.shouldAutoAcceptFirstCsvMatch(
      nextItem,
      bestMatch,
    );
    if (shouldAutoAccept && bestMatch) {
      try {
        const result = await this.importGameFromCsv(bestMatch.id);
        await updateGameDbCsvImportItem(nextItem.itemId, {
          status: "IMPORTED",
          gameDbGameId: result.gameId,
          errorText: null,
        });
        await upsertGameDbCsvTitleMap({
          titleRaw: nextItem.rawGameTitle ?? nextItem.gameTitle,
          titleNorm: normalizeTitleKey(searchTitle),
          gameDbGameId: result.gameId,
          status: "MAPPED",
          createdBy: interaction.user.id,
        });
        pushAutoAcceptedTitle(session.importId, result.title);
      } catch (err: any) {
        await updateGameDbCsvImportItem(nextItem.itemId, {
          status: "ERROR",
          errorText: err?.message ?? "Import failed.",
        });
      }
      await this.processNextGameDbCsvImportItem(interaction, session);
      return;
    }
    const summary = consumeAutoAcceptedSummary(session.importId);
    const contentBase = this.buildCsvPromptContent(session, nextItem, options.length > 0);
    const content = summary ? `${summary}\n\n${contentBase}` : contentBase;
    const container = this.buildCsvPromptContainer(content);
    const components = this.buildCsvPromptComponents(
      interaction.user.id,
      session.importId,
      nextItem.itemId,
      options,
    );

    await safeReply(interaction, {
      components: [container, ...components],
      flags: buildComponentsV2Flags(true),
      __forceFollowUp: true,
    });
  }

  private shouldAutoAcceptFirstCsvMatch(
    item: IGameDbCsvImportItem,
    firstMatch?: IGDBGame | null,
  ): boolean {
    if (!firstMatch) return false;
    const rawTitle = stripTitleDateSuffix(item.rawGameTitle ?? item.gameTitle).trim();
    if (!rawTitle) return false;
    const matchTitle = firstMatch.name ?? "";
    if (!matchTitle) return false;
    const normalizedCsv = normalizeTitleKey(rawTitle);
    const normalizedMatch = normalizeTitleKey(matchTitle);
    if (!normalizedCsv || normalizedCsv !== normalizedMatch) return false;
    const csvYear = item.initialReleaseDate?.getFullYear() ?? null;
    const igdbYear = firstMatch.first_release_date
      ? new Date(firstMatch.first_release_date * 1000).getFullYear()
      : null;
    if (!csvYear) return true;
    return Boolean(igdbYear && csvYear === igdbYear);
  }

  @SelectMenuComponent({ id: /^gamedb-csv-select:\d+:\d+:\d+$/ })
  async handleGameDbCsvSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, ownerId, importIdRaw, itemIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction
        .reply({
          content: "This import prompt is not for you.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    const igdbIdRaw = interaction.values?.[0];
    const igdbId = Number(igdbIdRaw);
    if (!Number.isInteger(igdbId) || igdbId <= 0) {
      await interaction
        .reply({
          content: "Invalid IGDB selection.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    const importId = Number(importIdRaw);
    const itemId = Number(itemIdRaw);
    if (!Number.isInteger(importId) || !Number.isInteger(itemId)) {
      await interaction
        .reply({
          content: "Invalid import selection.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    await interaction.deferUpdate().catch(() => {});

    const session = await getGameDbCsvImportById(importId);
    if (!session || session.userId !== ownerId) {
      await safeReply(interaction, {
        content: "This import session no longer exists.",
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      return;
    }

    if (session.status !== "ACTIVE") {
      await safeReply(interaction, {
        content: "This import session is not active.",
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      return;
    }

    const item = await getGameDbCsvImportItemById(itemId);
    if (!item || item.importId !== session.importId || item.status !== "PENDING") {
      await safeReply(interaction, {
        content: "This import item is no longer pending.",
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      return;
    }

      try {
        const result = await this.importGameFromCsv(igdbId);
        await updateGameDbCsvImportItem(itemId, {
          status: "IMPORTED",
          gameDbGameId: result.gameId,
          errorText: null,
        });
        await upsertGameDbCsvTitleMap({
          titleRaw: item.rawGameTitle ?? item.gameTitle,
          titleNorm: normalizeTitleKey(item.gameTitle),
          gameDbGameId: result.gameId,
          status: "MAPPED",
          createdBy: interaction.user.id,
        });
        await safeReply(interaction, {
          content: `Imported ${result.title} as GameDB #${result.gameId}.`,
          flags: MessageFlags.Ephemeral,
          __forceFollowUp: true,
        });
    } catch (err: any) {
      await updateGameDbCsvImportItem(itemId, {
        status: "ERROR",
        errorText: err?.message ?? "Import failed.",
      });
      await safeReply(interaction, {
        content: `Failed to import "${item.gameTitle}". Skipping.`,
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
    }

    await this.processNextGameDbCsvImportItem(interaction, session);
  }

  @ButtonComponent({ id: /^gamedb-csv-action:\d+:\d+:\d+:(manual|query|accept|skip|pause)$/ })
  async handleGameDbCsvAction(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, importIdRaw, itemIdRaw, action] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction
        .reply({
          content: "This import prompt is not for you.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    const importId = Number(importIdRaw);
    const itemId = Number(itemIdRaw);
    if (!Number.isInteger(importId) || !Number.isInteger(itemId)) {
      await interaction
        .reply({
          content: "Invalid import action.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    const session = await getGameDbCsvImportById(importId);
    if (!session || session.userId !== ownerId) {
      await safeReply(interaction, {
        content: "This import session no longer exists.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === "manual") {
      const modal = new ModalBuilder()
        .setCustomId(`${GAMEDB_CSV_MANUAL_PREFIX}:${ownerId}:${importId}:${itemId}`)
        .setTitle("Manual IGDB Import");
      const input = new TextInputBuilder()
        .setCustomId(GAMEDB_CSV_MANUAL_INPUT_ID)
        .setLabel("IGDB game ID")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      const row = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
      modal.addComponents(row);
      await interaction.showModal(modal);
      return;
    }

    if (action === "query") {
      const modal = new ModalBuilder()
        .setCustomId(`${GAMEDB_CSV_QUERY_PREFIX}:${ownerId}:${importId}:${itemId}`)
        .setTitle("Manual IGDB Search");
      const input = new TextInputBuilder()
        .setCustomId(GAMEDB_CSV_QUERY_INPUT_ID)
        .setLabel("Search query")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      const row = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
      modal.addComponents(row);
      await interaction.showModal(modal);
      return;
    }

    if (action === "accept") {
      const session = await getGameDbCsvImportById(importId);
      if (!session || session.userId !== ownerId) {
        await safeReply(interaction, {
          content: "This import session no longer exists.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (session.status !== "ACTIVE") {
        await safeReply(interaction, {
          content: "This import session is not active.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const item = await getGameDbCsvImportItemById(itemId);
      if (!item || item.importId !== session.importId || item.status !== "PENDING") {
        await safeReply(interaction, {
          content: "This import item is no longer pending.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const searchTitle = stripTitleDateSuffix(
        item.rawGameTitle ?? item.gameTitle,
      ).trim();
      if (!searchTitle) {
        await safeReply(interaction, {
          content: "Missing title for IGDB search.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      let results: IGDBGame[] = [];
      try {
        const search = await igdbService.searchGames(searchTitle, 50);
        results = search.results ?? [];
      } catch (err: any) {
        await safeReply(interaction, {
          content: `IGDB search failed: ${err?.message ?? "Unknown error"}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const sortedGames = results.length
        ? await this.scoreCsvImportGames(item, results)
        : [];
      const first = sortedGames[0];
      if (!first) {
        await safeReply(interaction, {
          content: "No IGDB matches found for this title.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferUpdate().catch(() => {});

      try {
        const result = await this.importGameFromCsv(first.id);
        await updateGameDbCsvImportItem(itemId, {
          status: "IMPORTED",
          gameDbGameId: result.gameId,
          errorText: null,
        });
        await safeReply(interaction, {
          content: `Imported ${result.title} as GameDB #${result.gameId}.`,
          flags: MessageFlags.Ephemeral,
          __forceFollowUp: true,
        });
      } catch (err: any) {
        await updateGameDbCsvImportItem(itemId, {
          status: "ERROR",
          errorText: err?.message ?? "Import failed.",
        });
        await safeReply(interaction, {
          content: `Failed to import "${item.gameTitle}". Skipping.`,
          flags: MessageFlags.Ephemeral,
          __forceFollowUp: true,
        });
      }

      await this.processNextGameDbCsvImportItem(interaction, session);
      return;
    }

    if (action === "pause") {
      await setGameDbCsvImportStatus(importId, "PAUSED");
      await safeUpdate(interaction, {
        content: `CSV import #${importId} paused.`,
        components: [],
      });
      return;
    }

    if (action === "skip") {
      const item = await getGameDbCsvImportItemById(itemId);
      if (!item || item.importId !== session.importId || item.status !== "PENDING") {
        await safeReply(interaction, {
          content: "This import item is no longer pending.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await updateGameDbCsvImportItem(itemId, { status: "SKIPPED" });
      await upsertGameDbCsvTitleMap({
        titleRaw: item.rawGameTitle ?? item.gameTitle,
        titleNorm: normalizeTitleKey(item.gameTitle),
        gameDbGameId: null,
        status: "SKIPPED",
        createdBy: interaction.user.id,
      });
      await safeUpdate(interaction, {
        content: `Skipped "${item.gameTitle}".`,
        components: [],
      });
      await this.processNextGameDbCsvImportItem(interaction, session);
    }
  }

  @ModalComponent({ id: /^gamedb-csv-manual:\d+:\d+:\d+$/ })
  async handleGameDbCsvManualModal(interaction: ModalSubmitInteraction): Promise<void> {
    const [, ownerId, importIdRaw, itemIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction
        .reply({
          content: "This import prompt is not for you.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    const importId = Number(importIdRaw);
    const itemId = Number(itemIdRaw);
    if (!Number.isInteger(importId) || !Number.isInteger(itemId)) {
      await interaction
        .reply({
          content: "Invalid import request.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    const raw = interaction.fields.getTextInputValue(GAMEDB_CSV_MANUAL_INPUT_ID);
    const cleaned = stripModalInput(raw);
    const igdbId = Number(cleaned);
    if (!Number.isInteger(igdbId) || igdbId <= 0) {
      await interaction
        .reply({
          content: "Please provide a valid IGDB id.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    await interaction.deferUpdate().catch(() => {});

    const session = await getGameDbCsvImportById(importId);
    if (!session || session.userId !== ownerId) {
      await safeReply(interaction, {
        content: "This import session no longer exists.",
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      return;
    }

    if (session.status !== "ACTIVE") {
      await safeReply(interaction, {
        content: "This import session is not active.",
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      return;
    }

    const item = await getGameDbCsvImportItemById(itemId);
    if (!item || item.importId !== session.importId || item.status !== "PENDING") {
      await safeReply(interaction, {
        content: "This import item is no longer pending.",
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      return;
    }

      try {
        const result = await this.importGameFromCsv(igdbId);
        await updateGameDbCsvImportItem(itemId, {
          status: "IMPORTED",
          gameDbGameId: result.gameId,
          errorText: null,
        });
        await upsertGameDbCsvTitleMap({
          titleRaw: item.rawGameTitle ?? item.gameTitle,
          titleNorm: normalizeTitleKey(item.gameTitle),
          gameDbGameId: result.gameId,
          status: "MAPPED",
          createdBy: interaction.user.id,
        });
        await safeReply(interaction, {
          content: `Imported ${result.title} as GameDB #${result.gameId}.`,
          flags: MessageFlags.Ephemeral,
          __forceFollowUp: true,
        });
    } catch (err: any) {
      await updateGameDbCsvImportItem(itemId, {
        status: "ERROR",
        errorText: err?.message ?? "Import failed.",
      });
      await safeReply(interaction, {
        content: `Failed to import "${item.gameTitle}". Skipping.`,
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
    }

    await this.processNextGameDbCsvImportItem(interaction, session);
  }

  @ModalComponent({ id: /^gamedb-csv-query:\d+:\d+:\d+$/ })
  async handleGameDbCsvQueryModal(interaction: ModalSubmitInteraction): Promise<void> {
    const [, ownerId, importIdRaw, itemIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction
        .reply({
          content: "This import prompt is not for you.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    const importId = Number(importIdRaw);
    const itemId = Number(itemIdRaw);
    if (!Number.isInteger(importId) || !Number.isInteger(itemId)) {
      await interaction
        .reply({
          content: "Invalid import request.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    const raw = interaction.fields.getTextInputValue(GAMEDB_CSV_QUERY_INPUT_ID);
    const query = stripModalInput(raw).trim();
    if (!query) {
      await interaction
        .reply({
          content: "Please provide a search query.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    await interaction.deferUpdate().catch(() => {});

    const session = await getGameDbCsvImportById(importId);
    if (!session || session.userId !== ownerId) {
      await safeReply(interaction, {
        content: "This import session no longer exists.",
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      return;
    }

    if (session.status !== "ACTIVE") {
      await safeReply(interaction, {
        content: "This import session is not active.",
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      return;
    }

    const item = await getGameDbCsvImportItemById(itemId);
    if (!item || item.importId !== session.importId || item.status !== "PENDING") {
      await safeReply(interaction, {
        content: "This import item is no longer pending.",
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      return;
    }

    let results: IGDBGame[] = [];
    try {
      const search = await igdbService.searchGames(query, 50);
      results = search.results ?? [];
    } catch (err: any) {
      await safeReply(interaction, {
        content: `IGDB search failed: ${err?.message ?? "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      return;
    }

    const sortedGames = results.length
      ? await this.scoreCsvImportGames(item, results)
      : [];
    const options = sortedGames.length
      ? sortedGames.slice(0, GAMEDB_CSV_RESULT_LIMIT).map((game) => {
        const year = game.first_release_date
          ? new Date(game.first_release_date * 1000).getFullYear()
          : "TBD";
        return {
          id: game.id,
          label: `${game.name} (${year})`,
          description: game.summary ? game.summary.slice(0, 95) : "No summary",
        };
      })
      : [];
    const content = this.buildCsvPromptContent(session, item, options.length > 0);
    const container = this.buildCsvPromptContainer(
      `${content}\n\nManual IGDB query: ${query}`,
    );
    const components = this.buildCsvPromptComponents(
      interaction.user.id,
      session.importId,
      item.itemId,
      options,
    );

    await safeReply(interaction, {
      components: [container, ...components],
      flags: buildComponentsV2Flags(true),
      __forceFollowUp: true,
    });
  }

  private async buildIgdbSelectOptions(
    results: IGDBGame[],
  ): Promise<IgdbSelectOption[]> {
    const platformIds: number[] = [];
    for (const game of results) {
      const ids = (game.platforms ?? [])
        .map((platform) => platform.id)
        .filter((id) => Number.isInteger(id) && id > 0);
      platformIds.push(...ids);
    }

    const uniquePlatformIds: number[] = Array.from(new Set(platformIds));
    const platformMap = await Game.getPlatformsByIgdbIds(uniquePlatformIds);
    const missingPlatformIds = uniquePlatformIds.filter((id) => !platformMap.has(id));
    if (missingPlatformIds.length) {
      console.warn(
        `[GameDB] Missing IGDB platform IDs in GAMEDB_PLATFORMS: ${missingPlatformIds.join(", ")}`,
      );
    }

    return results.map((game) => {
      const year = game.first_release_date
        ? new Date(game.first_release_date * 1000).getFullYear()
        : "TBD";
      const ids = (game.platforms ?? [])
        .map((platform) => platform.id)
        .filter((id) => Number.isInteger(id) && id > 0);
      const platformNames = ids
        .map((id) => formatPlatformDisplayName(platformMap.get(id)?.name))
        .filter((name): name is string => Boolean(name));
      const platformLabel = platformNames.length
        ? `Platforms: ${platformNames.join(", ")}`
        : "Platforms: Unknown";
      const summary = game.summary || "No summary";
      const description = `${platformLabel} - ${summary}`.substring(0, 95);

      return {
        id: game.id,
        label: `${game.name} (${year})`,
        description,
      };
    });
  }

  private async addGameToDatabase(
    interaction: CommandInteraction | StringSelectMenuInteraction,
    igdbId: number,
    opts?: { selectionMessage?: Message | null; showProfile?: boolean },
  ): Promise<void> {
    // 4. Fetch Details
    const details = await igdbService.getGameDetails(igdbId);
    if (!details) {
      // followUp for components, editReply for command interactions.
      const msg = "Failed to fetch details from IGDB.";
      const payload = { content: msg };
      try {
        if (interaction.isMessageComponent()) {
          await interaction.followUp(payload);
        } else {
          await interaction.editReply(payload);
        }
      } catch (err) {
        if (isUnknownWebhookError(err)) {
          await safeReply(interaction, { ...payload, __forceFollowUp: true });
        } else {
          throw err;
        }
      }
      return;
    }

    // 5. Download Images
    const imageData = await this.fetchIgdbCoverImage(details);
    const artData = await this.fetchIgdbArtImage(details);

    // 6. Save to DB
    const igdbUrl = details.url
      || (details.slug ? `https://www.igdb.com/games/${details.slug}` : null);
    let newGame;
    try {
      newGame = await Game.createGame(
        details.name,
        details.summary || null,
        imageData,
        details.id,
        details.slug,
        details.total_rating ?? null,
        igdbUrl,
        Game.getFeaturedVideoUrl(details),
        artData,
      );
    } catch (err: any) {
      if (isUniqueConstraintError(err)) {
        const msg = "This game has already been imported.";
        const payload = { content: msg };
        try {
          if (interaction.isMessageComponent()) {
            await interaction.followUp(payload);
          } else {
            await interaction.editReply(payload);
          }
        } catch (e) {
          if (isUnknownWebhookError(e)) {
            await safeReply(interaction, { ...payload, __forceFollowUp: true });
          } else {
            throw e;
          }
        }
        return;
      }
      throw err;
    }

    // 6a. Save Extended Metadata
    await Game.saveFullGameMetadata(newGame.id, details);

    // 6aa. Save platform relationships
    const igdbPlatformIds: number[] = (details.platforms ?? [])
      .map((platform) => platform.id)
      .filter((id) => Number.isInteger(id) && id > 0);
    await Game.addGamePlatformsByIgdbIds(newGame.id, igdbPlatformIds);

    // 6b. Process Releases
    await this.processReleaseDates(
      newGame.id,
      details.release_dates || [],
    );

    // Clean up selection menu if present
    if (opts?.selectionMessage) {
      try {
        await opts.selectionMessage.edit({ components: [] });
      } catch {
        // ignore cleanup failures
      }
    }

    if (opts?.showProfile) {
      await this.showGameProfile(interaction, newGame.id, true);
      return;
    }

    // 7. Show the /gamedb view for the newly added game
    await this.showGameProfile(interaction, newGame.id, true);
  }

  @Slash({ description: "View details of a game", name: "view" })
  async view(
    @SlashOption({
      description: "Search query (falls back to search flow if no ID provided)",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
      autocomplete: autocompleteGameDbViewTitle,
    })
    query: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(false) });

    const searchTerm = sanitizeUserInput(query, { preserveNewlines: false });
    if (/^\d+$/.test(searchTerm)) {
      const gameId = Number(searchTerm);
      if (Number.isInteger(gameId) && gameId > 0) {
        const game = await Game.getGameById(gameId);
        if (game) {
          await this.showGameProfile(interaction, gameId);
          return;
        }
      }
    }
    await this.runSearchFlow(interaction, searchTerm);
  }

  private async showGameProfile(
    interaction: CommandInteraction | StringSelectMenuInteraction,
    gameId: number,
    includeActionsOverride?: boolean,
  ): Promise<void> {
    const profile = await this.buildGameProfile(gameId, interaction);
    if (!profile) {
      await safeReply(interaction, {
        content: `No game found with ID ${gameId}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const includeActions = includeActionsOverride ?? (
      !("isMessageComponent" in interaction) ||
      !interaction.isMessageComponent()
    );
    const components = [...profile.components];
    if (includeActions) {
      components.push(
        ...this.buildGameProfileActionRow(
          gameId,
          profile.hasThread,
          profile.featuredVideoUrl,
          profile.canMarkThumbnailBad,
          profile.isThumbnailBad,
          profile.isThumbnailApproved,
          profile.isReleased,
        ),
      );
    }

    await safeReply(interaction, {
      embeds: [],
      files: profile.files,
      components,
      flags: buildComponentsV2Flags(false),
    });
  }

  public async showGameProfileFromNomination(
    interaction: StringSelectMenuInteraction,
    gameId: number,
  ): Promise<void> {
    const profile = await this.buildGameProfile(gameId, interaction);
    if (!profile) {
      await safeReply(interaction, {
        content: `No game found with ID ${gameId}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const components = [
      ...profile.components,
      ...this.buildGameProfileActionRow(
        gameId,
        profile.hasThread,
        profile.featuredVideoUrl,
        profile.canMarkThumbnailBad,
        profile.isThumbnailBad,
        profile.isThumbnailApproved,
        profile.isReleased,
      ),
    ];
    await safeReply(interaction, {
      embeds: [],
      files: profile.files,
      components,
      flags: buildComponentsV2Flags(true),
    });
  }

  public async buildGameProfileMessagePayload(
    gameId: number,
    options?: {
      includeActions?: boolean;
      guildId?: string;
      prefaceText?: string;
    },
  ): Promise<{
    components: Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>>;
    files: AttachmentBuilder[];
  } | null> {
    const includeActions = options?.includeActions ?? true;
    const profile = await this.buildGameProfile(gameId, {
      guildId: options?.guildId,
      includeInlineButtons: includeActions,
      prefaceText: options?.prefaceText,
    });
    if (!profile) {
      return null;
    }

    const components = [...profile.components];
    if (includeActions) {
      components.push(
        ...this.buildGameProfileActionRow(
          gameId,
          profile.hasThread,
          profile.featuredVideoUrl,
          profile.canMarkThumbnailBad,
          profile.isThumbnailBad,
          profile.isThumbnailApproved,
          profile.isReleased,
        ),
      );
    }

    return {
      components,
      files: profile.files,
    };
  }

  private async buildGameProfile(
    gameId: number,
    interaction?:
      | CommandInteraction
      | StringSelectMenuInteraction
      | ButtonInteraction
      | ModalSubmitInteraction
      | GameProfileRenderContext,
  ): Promise<{
    components: Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>>;
    files: AttachmentBuilder[];
    hasThread: boolean;
    featuredVideoUrl: string | null;
    canMarkThumbnailBad: boolean;
    isThumbnailBad: boolean;
    isThumbnailApproved: boolean;
    isReleased: boolean;
  } | null> {
    try {
      const game = await Game.getGameById(gameId);
      if (!game) {
        return null;
      }

      const releases = await Game.getGameReleases(gameId);
      const platforms = await Game.getAllPlatforms();
      const regions = await Game.getAllRegions();
      const associations = await Game.getGameAssociations(gameId);
      const nowPlayingMembers = await Game.getNowPlayingMembers(gameId);
      const collectionOwners = await Game.getGameCollectionOwners(gameId);
      const completions = await Game.getGameCompletions(gameId);
      const alternateVersions = await Game.getAlternateVersions(gameId);
      const linkedThreads = await getThreadsByGameId(gameId);

      const platformMap = new Map(platforms.map((p) => [p.id, p.name]));
      const regionMap = new Map(regions.map((r) => [r.id, r.name]));

      const description = game.description || "No description available.";
      const container = new ContainerBuilder();
      const includeInlineButtons =
        (interaction as GameProfileRenderContext | undefined)?.includeInlineButtons ?? true;
      const prefaceText = (interaction as GameProfileRenderContext | undefined)?.prefaceText?.trim();

      const files: AttachmentBuilder[] = [];
      const isThumbnailBad = Boolean(game.thumbnailBad);
      const isThumbnailApproved = Boolean(game.thumbnailApproved);
      const isReleased = this.isGameReleased(game, releases);
      const primaryArt = isThumbnailBad ? game.imageData : (game.artData ?? game.imageData);
      if (primaryArt) {
        files.push(new AttachmentBuilder(primaryArt, { name: "game_image.png" }));
      }

      const rpgClubSections: string[] = [];
      const pushRpgClubSection = (title: string, value: string | null): void => {
        if (!value) return;
        rpgClubSections.push(`**${title}**\n> ${value}`);
      };

      const gotmNomineesByRound = new Map<number, string[]>();
      associations.gotmNominations.forEach((nom) => {
        const list = gotmNomineesByRound.get(nom.round) ?? [];
        list.push(nom.username);
        gotmNomineesByRound.set(nom.round, list);
      });
      const nrGotmNomineesByRound = new Map<number, string[]>();
      associations.nrGotmNominations.forEach((nom) => {
        const list = nrGotmNomineesByRound.get(nom.round) ?? [];
        list.push(nom.username);
        nrGotmNomineesByRound.set(nom.round, list);
      });

      if (associations.gotmWins.length) {
        const lines = associations.gotmWins.map((win) => {
          const nominees = gotmNomineesByRound.get(win.round) ?? [];
          if (!nominees.length) {
            return `Round ${win.round}`;
          }
          return `Round ${win.round} (nominated by ${nominees.join(", ")})`;
        });
        pushRpgClubSection("GOTM Round(s)", lines.join("\n"));
      }

      if (associations.nrGotmWins.length) {
        const lines = associations.nrGotmWins.map((win) => {
          const nominees = nrGotmNomineesByRound.get(win.round) ?? [];
          if (!nominees.length) {
            return `Round ${win.round}`;
          }
          return `Round ${win.round} (nominated by ${nominees.join(", ")})`;
        });
        pushRpgClubSection("NR-GOTM Round(s)", lines.join("\n"));
      }

      // Thread / Reddit links as their own sections
      const threadId =
        associations.gotmWins.find((w) => w.threadId)?.threadId ??
        associations.nrGotmWins.find((w) => w.threadId)?.threadId ??
        nowPlayingMembers.find((p) => p.threadId)?.threadId ??
        linkedThreads[0] ??
        null;
      const headerLink = threadId
        ? `https://discord.com/channels/${interaction?.guildId ?? "@me"}/${threadId}`
        : null;
      const headerLines = [
        `## ${headerLink ? `[${game.title}](${headerLink})` : game.title}`,
      ];

      const redditUrlRaw =
        associations.gotmWins.find((w) => w.redditUrl)?.redditUrl ??
        associations.nrGotmWins.find((w) => w.redditUrl)?.redditUrl ??
        null;
      const redditUrl = redditUrlRaw === "__NO_VALUE__" ? null : redditUrlRaw;
      if (redditUrl) {
        pushRpgClubSection("Reddit Discussion Thread", `[Reddit Link](${redditUrl})`);
      }

      if (nowPlayingMembers.length) {
        const MAX_NOW_PLAYING_DISPLAY = 12;
        const lines = nowPlayingMembers.slice(0, MAX_NOW_PLAYING_DISPLAY).map((member) => {
          const name = member.globalName ?? member.username ?? member.userId;
          return name;
        });

        if (nowPlayingMembers.length > MAX_NOW_PLAYING_DISPLAY) {
          const remaining = nowPlayingMembers.length - MAX_NOW_PLAYING_DISPLAY;
          lines.push(`…and ${remaining} more playing now.`);
        }

        pushRpgClubSection("Now Playing", lines.join(", "));
      }

      if (collectionOwners.length) {
        const MAX_OWNERS_DISPLAY = 12;
        const lines = collectionOwners.slice(0, MAX_OWNERS_DISPLAY).map((member) => {
          const name = member.globalName ?? member.username ?? member.userId;
          return name;
        });

        if (collectionOwners.length > MAX_OWNERS_DISPLAY) {
          const remaining = collectionOwners.length - MAX_OWNERS_DISPLAY;
          lines.push(`…and ${remaining} more own this.`);
        }

        pushRpgClubSection("Owned By", lines.join(", "));
      }

      if (completions.length) {
        const MAX_COMPLETIONS_DISPLAY = 12;
        const uniqueCompletions = new Map<string, (typeof completions)[number]>();
        completions.forEach((member) => {
          if (!uniqueCompletions.has(member.userId)) {
            uniqueCompletions.set(member.userId, member);
          }
        });
        const uniqueList = Array.from(uniqueCompletions.values());
        const lines = uniqueList.slice(0, MAX_COMPLETIONS_DISPLAY).map((member) => {
          const name = member.globalName ?? member.username ?? member.userId;
          return name;
        });

        if (uniqueList.length > MAX_COMPLETIONS_DISPLAY) {
          const remaining = uniqueList.length - MAX_COMPLETIONS_DISPLAY;
          lines.push(`…and ${remaining} more completed this.`);
        }

        pushRpgClubSection("Completed By", lines.join(", "));
      }

      const gotmWinRounds = new Set(associations.gotmWins.map((win) => win.round));
      const nrGotmWinRounds = new Set(associations.nrGotmWins.map((win) => win.round));

      const gotmNominations = associations.gotmNominations.filter(
        (nom) => !gotmWinRounds.has(nom.round),
      );
      if (gotmNominations.length) {
        const lines = gotmNominations.map(
          (nom) => `Round ${nom.round} - ${nom.username}`,
        );
        pushRpgClubSection("GOTM Nominations", lines.join(", "));
      }

      const nrGotmNominations = associations.nrGotmNominations.filter(
        (nom) => !nrGotmWinRounds.has(nom.round),
      );
      if (nrGotmNominations.length) {
        const lines = nrGotmNominations.map(
          (nom) => `Round ${nom.round} - ${nom.username}`,
        );
        pushRpgClubSection("NR-GOTM Nominations", lines.join(", "));
      }

      const bodyParts: Array<{ content: string; accessory?: ButtonBuilder }> = [];
      bodyParts.push({ content: `**Description**\n${this.formatQuotedDescription(description)}` });

      const labelCandidates: string[] = [];
      let releasesByDate: Map<string, string[]> | null = null;

      if (releases.length > 0) {
        const sortedReleases = [...releases].sort((a, b) => {
          const aTime = a.releaseDate ? a.releaseDate.getTime() : Number.POSITIVE_INFINITY;
          const bTime = b.releaseDate ? b.releaseDate.getTime() : Number.POSITIVE_INFINITY;
          return aTime - bTime;
        });

        const releaseMap = new Map<string, string[]>();
        sortedReleases.forEach((r) => {
          const platformName = (formatPlatformDisplayName(platformMap.get(r.platformId))
            ?? "Unknown Platform").trim();
          const regionName = (regionMap.get(r.regionId) || "Unknown Region").trim();
          const regionSuffix = regionName === "Worldwide" ? "" : ` (${regionName})`;
          const releaseDate = r.releaseDate ? formatTableDate(r.releaseDate) : "TBD";
          const format = r.format ? `(${r.format}) ` : "";
          const platformLabel = `${platformName} ${regionSuffix}${format}`.trim();
          const list = releaseMap.get(releaseDate) ?? [];
          list.push(platformLabel);
          releaseMap.set(releaseDate, list);
        });
        releasesByDate = releaseMap;
      }

      const hltbCache = await getHltbCacheByGameId(gameId);
      const canImportHltb = isHltbImportEligible(game, Boolean(hltbCache));
      const hltbLabels: string[] = [];

      if (releasesByDate) {
        labelCandidates.push(...releasesByDate.keys());
      }
      
      if (hltbCache) {
        if (hltbCache.main) hltbLabels.push("Main");
        if (hltbCache.mainSides) hltbLabels.push("Main + Sides");
        if (hltbCache.completionist) hltbLabels.push("Completionist");
        if (hltbCache.singlePlayer) hltbLabels.push("Single-Player");
        if (hltbCache.coOp) hltbLabels.push("Co-Op");
        if (hltbCache.vs) hltbLabels.push("Vs.");
      }

      labelCandidates.push(...hltbLabels);
      const padWidth = labelCandidates.reduce((max, label) => Math.max(max, label.length), 0) + 1;

      if (releasesByDate) {
        const releaseField = Array.from(releasesByDate.entries())
          .map(([dateLabel, platformsForDate]) =>
            `\n> **\`\` ${padCommandName(dateLabel, padWidth)}\`\`**  ` +
            platformsForDate.join(", "),
          )
          .join("");
        bodyParts.push({ content: `**Releases** ${releaseField}` });
      }

      if (hltbCache) {
        const hltbLines: string[] = [];
        if (hltbCache.main) 
          hltbLines.push(`> **\`\` ${padCommandName("Main", padWidth)}\`\`**  ${hltbCache.main}`);
        if (hltbCache.mainSides) 
          hltbLines.push(`> **\`\` ${padCommandName("Main + Sides", padWidth)}\`\`**  ${hltbCache.mainSides}`);
        if (hltbCache.completionist) 
          hltbLines.push(`> **\`\` ${padCommandName("Completionist", padWidth)}\`\`**  ${hltbCache.completionist}`);
        if (hltbCache.singlePlayer) 
          hltbLines.push(`> **\`\` ${padCommandName("Single-Player", padWidth)}\`\`**  ${hltbCache.singlePlayer}`);
        if (hltbCache.coOp) 
          hltbLines.push(`> **\`\` ${padCommandName("Co-Op", padWidth)}\`\`**  ${hltbCache.coOp}`);
        if (hltbCache.vs) 
          hltbLines.push(`> **\`\` ${padCommandName("Vs.", padWidth)}\`\`**  ${hltbCache.vs}`);
        if (hltbLines.length) {
          bodyParts.push({ content: `**HowLongToBeat™**\n${hltbLines.join("\n")}` });
        }
      } else if (canImportHltb && includeInlineButtons) {
        const importHltb = new V2ButtonBuilder()
          .setCustomId(`gamedb-action:hltb-import:${gameId}`)
          .setLabel("Import HLTB Data")
          .setStyle(ButtonStyle.Secondary);
        bodyParts.push({
          content: "**HowLongToBeat™**\n> No HLTB data cached.",
          accessory: importHltb,
        });
      }

      const series = await Game.getGameSeries(gameId);
      const detailSections: string[] = [];

      if (series) {
        detailSections.push(`**Series / Collection**\n> ${series}`);
      }

      if (alternateVersions.length) {
        const lines = alternateVersions.map(
          (alt) => `> **${alt.title}**`,
        );
        const value = this.buildListFieldValue(lines, 2000);
        detailSections.push(`**Alternate Versions**\n${value}`);
      }

      if (detailSections.length) {
        bodyParts.push({ content: detailSections.join("\n\n") });
      }

      if (rpgClubSections.length) {
        bodyParts.push({ content: rpgClubSections.join("\n\n") });
      }

      const igdbIdText = game.igdbId ? String(game.igdbId) : "N/A";
      bodyParts.push({ content: `-# GameDB ID: ${game.id} | IGDB ID: ${igdbIdText}` });

      const headerBlock = this.trimTextDisplayContent(headerLines.join("\n"));
      const bodyBlocks = bodyParts
        .map((block) => ({
          content: this.trimTextDisplayContent(block.content),
          accessory: block.accessory,
        }))
        .filter((block) => block.content.length > 0);

      if (prefaceText) {
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(this.trimTextDisplayContent(prefaceText)),
        );
        container.addSeparatorComponents(
          new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true),
        );
      }

      if (primaryArt) {
        if (headerBlock.length > 0) {
          container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerBlock));
        }
        const [descriptionBlock, ...remainingBlocks] = bodyBlocks;
        if (descriptionBlock) {
          const descriptionSection = new SectionBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(descriptionBlock.content))
            .setThumbnailAccessory(
              new ThumbnailBuilder().setURL("attachment://game_image.png"),
            );
          container.addSectionComponents(descriptionSection);
        }
        remainingBlocks.forEach((block) => {
          if (block.accessory) {
            const section = new SectionBuilder()
              .addTextDisplayComponents(new TextDisplayBuilder().setContent(block.content))
              .setButtonAccessory(block.accessory);
            container.addSectionComponents(section);
          } else {
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(block.content));
          }
        });
      } else {
        if (headerBlock.length > 0) {
          container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerBlock));
        }
        bodyBlocks.forEach((block) => {
          if (block.accessory) {
            const section = new SectionBuilder()
              .addTextDisplayComponents(new TextDisplayBuilder().setContent(block.content))
              .setButtonAccessory(block.accessory);
            container.addSectionComponents(section);
          } else {
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(block.content));
          }
        });
      }

      return {
        components: [container],
        files,
        hasThread: Boolean(threadId),
        featuredVideoUrl: game.featuredVideoUrl ?? null,
        canMarkThumbnailBad: Boolean(game.artData) && !isThumbnailApproved,
        isThumbnailBad,
        isThumbnailApproved,
        isReleased,
      };
    } catch (error: any) {
      console.error("Failed to build game profile:", error);
      return null;
    }
  }

  private chunkText(text: string, size: number): string[] {
    if (!text) return ["No description available."];
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += size) {
      chunks.push(text.slice(i, i + size));
    }
    return chunks;
  }

  private formatQuotedDescription(description: string): string {
    if (!description.trim()) {
      return "> No description available.";
    }
    return description
      .split(/\r?\n/)
      .map((line) => (line.trim().length ? `> ${line}` : ""))
      .join("\n");
  }

  private buildListFieldValue(lines: string[], maxLength: number): string {
    if (!lines.length) return "None";
    const output: string[] = [];
    let currentLength = 0;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const nextLength = currentLength + line.length + 1;
      if (nextLength > maxLength) {
        const remaining = lines.length - i;
        output.push(`…and ${remaining} more`);
        break;
      }
      output.push(line);
      currentLength = nextLength;
    }

    return output.join("\n");
  }

  private trimTextDisplayContent(content: string): string {
    if (content.length <= 4000) {
      return content;
    }
    return `${content.slice(0, 3997)}...`;
  }

  private buildGameProfileActionRow(
    gameId: number,
    hasThread: boolean,
    featuredVideoUrl: string | null,
    canMarkThumbnailBad: boolean,
    isThumbnailBad: boolean,
    isThumbnailApproved: boolean,
    isReleased: boolean,
    disableVideo = false,
  ): ActionRowBuilder<ButtonBuilder>[] {
    const nominateGame = new ButtonBuilder()
      .setCustomId(`gamedb-action:nominate:${gameId}`)
      .setLabel("Nominate")
      .setStyle(ButtonStyle.Success)
      .setDisabled(false);
    const addNowPlaying = new ButtonBuilder()
      .setCustomId(`gamedb-action:nowplaying:${gameId}`)
      .setLabel("Add to Now Playing List")
      .setStyle(ButtonStyle.Primary);
    const viewFeaturedVideo = new ButtonBuilder()
      .setCustomId(`gamedb-action:video:${gameId}`)
      .setLabel("View Featured Video")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disableVideo);
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    const primaryRow = new ActionRowBuilder<ButtonBuilder>().addComponents(nominateGame);
    primaryRow.addComponents(addNowPlaying);
    if (isReleased) {
      const addCompletion = new ButtonBuilder()
        .setCustomId(`gamedb-action:completion:${gameId}`)
        .setLabel("Add Completion")
        .setStyle(ButtonStyle.Primary);
      primaryRow.addComponents(addCompletion);
    }
    if (!hasThread) {
      const addThread = new ButtonBuilder()
        .setCustomId(`gamedb-action:thread:${gameId}`)
        .setLabel("Create Now Playing Thread")
        .setStyle(ButtonStyle.Primary);
      primaryRow.addComponents(addThread);
    }
    if (featuredVideoUrl) {
      primaryRow.addComponents(viewFeaturedVideo);
    }
    rows.push(primaryRow);
    if (canMarkThumbnailBad && !isThumbnailBad && !isThumbnailApproved) {
      const badThumbnail = new ButtonBuilder()
        .setCustomId(`gamedb-action:bad-thumb:${gameId}`)
        .setLabel("Bad Thumbnail")
        .setStyle(ButtonStyle.Danger);
      const goodThumbnail = new ButtonBuilder()
        .setCustomId(`gamedb-action:good-thumb:${gameId}`)
        .setLabel("Good Thumbnail")
        .setStyle(ButtonStyle.Secondary);
      const thumbRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        badThumbnail,
        goodThumbnail,
      );
      rows.push(thumbRow);
    }
    return rows;
  }

  private isGameReleased(game: IGame, releases: IRelease[]): boolean {
    const releaseDates: Date[] = [];
    for (const release of releases) {
      if (release.releaseDate instanceof Date && !Number.isNaN(release.releaseDate.getTime())) {
        releaseDates.push(release.releaseDate);
      }
    }
    if (
      game.initialReleaseDate instanceof Date &&
      !Number.isNaN(game.initialReleaseDate.getTime())
    ) {
      releaseDates.push(game.initialReleaseDate);
    }

    if (!releaseDates.length) {
      return true;
    }

    const earliestReleaseTimestamp = releaseDates
      .map((releaseDate) => releaseDate.getTime())
      .reduce((earliest, current) => (current < earliest ? current : earliest));
    return earliestReleaseTimestamp <= Date.now();
  }

  private async refreshGameProfileMessage(
    interaction: ButtonInteraction,
    gameId: number,
  ): Promise<void> {
    const profile = await this.buildGameProfile(gameId, interaction);
    if (!profile) return;
    const actionRows = this.buildGameProfileActionRow(
      gameId,
      profile.hasThread,
      profile.featuredVideoUrl,
      profile.canMarkThumbnailBad,
      profile.isThumbnailBad,
      profile.isThumbnailApproved,
      profile.isReleased,
    );
    const existingComponents = interaction.message?.components ?? [];
    const searchRows = getSearchRowsFromComponents(existingComponents);
    await interaction.editReply({
      embeds: [],
      files: profile.files,
      components: [...profile.components, ...actionRows, ...searchRows],
      flags: buildComponentsV2Flags(false),
    }).catch(() => {});
  }

  @ButtonComponent({ id: /^gamedb-action:(nowplaying|nominate|completion|thread|video|hltb-import|bad-thumb|good-thumb):\d+$/ })
  async handleGameDbAction(interaction: ButtonInteraction): Promise<void> {
    const [, action, gameIdRaw] = interaction.customId.split(":");
    const gameId = Number(gameIdRaw);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      await interaction.reply({
        content: "Invalid GameDB id.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const game = await Game.getGameById(gameId);
    if (!game) {
      await interaction.followUp({
        content: `No game found with ID ${gameId}.`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (action === "video") {
      const videoUrl = game.featuredVideoUrl;
      if (!videoUrl) {
        await safeReply(interaction, {
          content: "No featured video is available for this game.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      let updatedMessage = false;
      const profile = await this.buildGameProfile(gameId, interaction);
      if (profile) {
        const actionRows = this.buildGameProfileActionRow(
          gameId,
          profile.hasThread,
          profile.featuredVideoUrl,
          profile.canMarkThumbnailBad,
          profile.isThumbnailBad,
          profile.isThumbnailApproved,
          profile.isReleased,
          true,
        );
        const existingComponents = interaction.message?.components ?? [];
        const searchRows = getSearchRowsFromComponents(existingComponents);
        try {
          await interaction.update({
            embeds: [],
            files: profile.files,
            components: [...profile.components, ...actionRows, ...searchRows],
            flags: buildComponentsV2Flags(false),
          });
          updatedMessage = true;
        } catch {
          // fall through to deferUpdate
        }
      }
      if (!updatedMessage) {
        await interaction.deferUpdate().catch(() => {});
      }
      await interaction.followUp({
        content: `Warning: videos may contain spoilers. ${videoUrl}`,
      });
      return;
    }

    if (action === "bad-thumb" || action === "good-thumb") {
      const hasAccess = await requireModeratorOrAdminOrOwner(interaction);
      if (!hasAccess) {
        return;
      }
    }

    if (action === "bad-thumb") {
      if (!game.artData) {
        await safeReply(interaction, {
          content: "No artwork thumbnail is available for this game.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (game.thumbnailBad) {
        await safeReply(interaction, {
          content: "This thumbnail is already marked as bad.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.deferUpdate().catch(() => {});
      await Game.updateGameThumbnailBad(gameId, true);
      await Game.updateGameThumbnailApproved(gameId, false);
      await this.refreshGameProfileMessage(interaction, gameId);
      await interaction.followUp({
        content: "Thumbnail flagged. GameDB view will use cover art from now on.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === "good-thumb") {
      if (!game.artData) {
        await safeReply(interaction, {
          content: "No artwork thumbnail is available for this game.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (game.thumbnailApproved) {
        await safeReply(interaction, {
          content: "This thumbnail is already marked as approved.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.deferUpdate().catch(() => {});
      await Game.updateGameThumbnailBad(gameId, false);
      await Game.updateGameThumbnailApproved(gameId, true);
      await this.refreshGameProfileMessage(interaction, gameId);
      await interaction.followUp({
        content: "Thumbnail marked as good. GameDB view will keep using artwork.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === "nowplaying") {
      const modal = new ModalBuilder()
        .setCustomId(`gamedb-nowplaying-modal:${gameId}`)
        .setTitle("Add to Now Playing")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("gamedb-nowplaying-note")
              .setLabel("Note (optional)")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false)
              .setMaxLength(MAX_NOW_PLAYING_NOTE_LEN),
          ),
        );
      await interaction.showModal(modal).catch(() => {});
      return;
    }

    if (action === "hltb-import") {
      try {
        await interaction.deferUpdate();
      } catch {
        // ignore
      }
      const hltbCache = await getHltbCacheByGameId(gameId);
      if (isHltbImportEligible(game, Boolean(hltbCache))) {
        const scraped = await searchHltb(game.title);
        if (scraped) {
          await upsertHltbCache(gameId, {
            name: scraped.name,
            url: scraped.url,
            imageUrl: scraped.imageUrl ?? null,
            main: scraped.main,
            mainSides: scraped.mainSides,
            completionist: scraped.completionist,
            singlePlayer: scraped.singlePlayer,
            coOp: scraped.coOp,
            vs: scraped.vs,
            sourceQuery: game.title,
          });
        }
      }
      await this.refreshGameProfileMessage(interaction, gameId);
      return;
    }

    if (action === "nominate") {
      await openNominationModal(interaction, {
        prefilledTitle: game.title,
      }).catch(async (error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await safeReply(interaction, {
          content: `Unable to open nomination form: ${errorMessage}`,
          flags: MessageFlags.Ephemeral,
        });
      });
      return;
    }

    if (action === "completion") {
      await this.startCompletionWizard(interaction, gameId, game.title);
      return;
    }

    if (action === "thread") {
      try {
        await interaction.deferUpdate();
      } catch {
        // ignore
      }
      await this.runNowPlayingThreadWizard(interaction, gameId, game.title);
      return;
    }
  }

  private buildCompletionWizardContainer(
    session: CompletionWizardSession,
    platformOptions: Array<{ label: string; value: string }>,
    missingSelections: string[] = [],
  ): ContainerBuilder {
    const dateLabel = session.dateChoice
      ? ({
        today: "Today",
        unknown: "Unknown",
        date: "Enter Date",
      } as const)[session.dateChoice]
      : "Select";
    const platformLabel = session.platformChoice
      ? (
        session.platformChoice === "other"
          ? "Other"
          : platformOptions.find((opt) => opt.value === session.platformChoice)?.label
      ) ?? "Select"
      : "Select";
    const removeLabel = session.requiresRemoveChoice
      ? (session.removeChoice === "yes" ? "Yes" : session.removeChoice === "no" ? "No" : "Select")
      : "N/A";

    const labels = [
      "Game",
      "Completion type",
      "Completion date",
      "Platform",
      "Remove from Now Playing",
    ];
    const labelWidth = Math.max(...labels.map((label) => label.length));

    const lines = [
      "## Add Completion",
      `> **\`\` ${padCommandName("Game", labelWidth + 1)}\`\`**  ${session.gameTitle}`,
      `> **\`\` ${padCommandName("Completion type", labelWidth + 1)}\`\`**  ${session.completionType ?? "Select"}`,
      `> **\`\` ${padCommandName("Completion date", labelWidth + 1)}\`\`**  ${dateLabel}`,
      `> **\`\` ${padCommandName("Platform", labelWidth + 1)}\`\`**  ${platformLabel}`,
      `> **\`\` ${padCommandName("Remove from Now Playing", labelWidth + 1)}\`\`**  ${removeLabel}`,
      "",
      "Pick your options and select Next to enter any details.",
    ];
    if (missingSelections.length) {
      lines.push("", `**Missing:** ${missingSelections.join(", ")}`);
    }
    const content = this.trimTextDisplayContent(lines.join("\n"));
    return new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(content),
    );
  }

  private buildCompletionPlatformOptions(
    platforms: Array<{ id: number; name: string }>,
  ): Array<{ label: string; value: string }> {
    const sortedPlatforms = [...platforms].sort((a, b) =>
      a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
    );
    const baseOptions = sortedPlatforms.map((platform) => ({
      label: platform.name.slice(0, 100),
      value: String(platform.id),
    }));
    return [
      ...baseOptions.slice(0, 24),
      { label: "Other", value: "other" },
    ];
  }

  private buildCompletionWizardComponents(
    session: CompletionWizardSession,
    platformOptions: Array<{ label: string; value: string }>,
  ): Array<ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>> {
    const typeSelect = new StringSelectMenuBuilder()
      .setCustomId(`gamedb-completion-select:${session.id}:type`)
      .setPlaceholder("Completion type")
      .addOptions(
        COMPLETION_TYPES.map((value) => ({
          label: value.slice(0, 100),
          value,
          default: session.completionType === value,
        })),
      );

    const dateSelect = new StringSelectMenuBuilder()
      .setCustomId(`gamedb-completion-select:${session.id}:date`)
      .setPlaceholder("Completion date")
      .addOptions(
        {
          label: "Today",
          value: "today",
          default: session.dateChoice === "today",
        },
        {
          label: "Unknown",
          value: "unknown",
          default: session.dateChoice === "unknown",
        },
        {
          label: "Enter Date",
          value: "date",
          default: session.dateChoice === "date",
        },
      );

    const platformSelect = new StringSelectMenuBuilder()
      .setCustomId(`gamedb-completion-select:${session.id}:platform`)
      .setPlaceholder("Platform")
      .addOptions(
        platformOptions.map((option) => ({
          ...option,
          default: session.platformChoice === option.value,
        })),
      );

    const rows: Array<ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>> = [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(typeSelect),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(dateSelect),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(platformSelect),
    ];

    if (session.requiresRemoveChoice) {
      const removeSelect = new StringSelectMenuBuilder()
        .setCustomId(`gamedb-completion-select:${session.id}:remove`)
        .setPlaceholder("Remove from Now Playing?")
        .addOptions(
          {
            label: "Yes",
            value: "yes",
            default: session.removeChoice === "yes",
          },
          {
            label: "No",
            value: "no",
            default: session.removeChoice === "no",
          },
        );
      rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(removeSelect));
    }

    const nextButton = new ButtonBuilder()
      .setCustomId(`gamedb-completion-next:${session.id}`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Primary);
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(nextButton));

    return rows;
  }

  private getCompletionWizardMissingSelections(session: CompletionWizardSession): string[] {
    const missing: string[] = [];
    if (!session.completionType) missing.push("Completion type");
    if (!session.dateChoice) missing.push("Completion date");
    if (!session.platformChoice) missing.push("Platform");
    if (session.requiresRemoveChoice && !session.removeChoice) {
      missing.push("Remove from Now Playing");
    }
    return missing;
  }

  private async startCompletionWizard(
    interaction: ButtonInteraction,
    gameId: number,
    gameTitle: string,
  ): Promise<void> {
    const platforms = await Game.getPlatformsForGameWithStandard(
      gameId,
      STANDARD_PLATFORM_IDS,
    );
    if (!platforms.length) {
      await interaction.followUp({
        content: "No platform release data is available for this game.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const message = interaction.message;
    if (!message) {
      await interaction.followUp({
        content: "Unable to locate the original GameDB view message.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const nowPlayingMeta = await Member.getNowPlayingEntryMeta(interaction.user.id, gameId);
    const sessionId = interaction.id;
    const session: CompletionWizardSession = {
      id: sessionId,
      userId: interaction.user.id,
      gameId,
      gameTitle,
      createdAt: new Date(),
      sourceMessageId: message.id,
      sourceChannelId: message.channelId,
      interactionToken: interaction.token,
      applicationId: interaction.applicationId,
      requiresRemoveChoice: Boolean(nowPlayingMeta),
    };
    COMPLETION_WIZARD_SESSIONS.set(sessionId, session);

    const platformOptions = this.buildCompletionPlatformOptions(platforms);
    const container = this.buildCompletionWizardContainer(session, platformOptions);
    const components = [container, ...this.buildCompletionWizardComponents(session, platformOptions)];
    const response = await safeReply(interaction, {
      components,
      flags: buildComponentsV2Flags(true),
      withResponse: true,
    });
    const replyMessage = response?.resource?.message ?? response;
    if (replyMessage && typeof replyMessage === "object" && "id" in replyMessage) {
      session.ephemeralMessageId = replyMessage.id as string;
    }
  }

  @SelectMenuComponent({ id: /^gamedb-completion-select:\d+:(type|date|platform|remove)$/ })
  async handleCompletionWizardSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const sessionId = parts[1];
    const field = parts[2];
    const session = COMPLETION_WIZARD_SESSIONS.get(sessionId);
    if (!session) {
      await interaction.reply({
        content: "This completion request has expired.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }
    if (interaction.user.id !== session.userId) {
      await interaction.reply({
        content: "This menu isn't for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const value = interaction.values?.[0];
    if (!value) {
      await interaction.reply({
        content: "No selection made.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (field === "type") {
      session.completionType = value as CompletionType;
    } else if (field === "date") {
      session.dateChoice = value as CompletionWizardSession["dateChoice"];
    } else if (field === "platform") {
      session.platformChoice = value;
    } else if (field === "remove") {
      session.removeChoice = value as CompletionWizardSession["removeChoice"];
    }

    const platforms = await Game.getPlatformsForGameWithStandard(
      session.gameId,
      STANDARD_PLATFORM_IDS,
    );
    const platformOptions = this.buildCompletionPlatformOptions(platforms);
    const container = this.buildCompletionWizardContainer(session, platformOptions);
    const components = [container, ...this.buildCompletionWizardComponents(session, platformOptions)];
    await safeUpdate(interaction, { components });
  }

  @ButtonComponent({ id: /^gamedb-completion-next:\d+$/ })
  async handleCompletionWizardNext(interaction: ButtonInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const sessionId = parts[1];
    const session = COMPLETION_WIZARD_SESSIONS.get(sessionId);
    if (!session) {
      await interaction.reply({
        content: "This completion request has expired.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }
    if (interaction.user.id !== session.userId) {
      await interaction.reply({
        content: "This action isn't for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const missing = this.getCompletionWizardMissingSelections(session);
    const platforms = await Game.getPlatformsForGameWithStandard(
      session.gameId,
      STANDARD_PLATFORM_IDS,
    );
    const platformOptions = this.buildCompletionPlatformOptions(platforms);
    if (missing.length) {
      const container = this.buildCompletionWizardContainer(session, platformOptions, missing);
      const components = [container, ...this.buildCompletionWizardComponents(session, platformOptions)];
      await safeUpdate(interaction, { components });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`gamedb-completion-modal:${session.id}`)
      .setTitle("Add Completion Details");

    if (session.dateChoice === "date") {
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("completion-date")
            .setLabel("Completion date (YYYY-MM-DD)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
        ),
      );
    }

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("completion-playtime")
          .setLabel("Playtime hours (optional)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false),
      ),
    );

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("completion-note")
          .setLabel(`Note (optional, ${MAX_COMPLETION_NOTE_LEN} chars max)`)
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(MAX_COMPLETION_NOTE_LEN),
      ),
    );

    await interaction.showModal(modal).catch(() => {});
  }

  @ModalComponent({ id: /^gamedb-completion-modal:\d+$/ })
  async handleCompletionWizardModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const sessionId = parts[1];
    const session = COMPLETION_WIZARD_SESSIONS.get(sessionId);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    if (!session) {
      await interaction.editReply({ content: "This completion request has expired." }).catch(() => {});
      return;
    }
    if (interaction.user.id !== session.userId) {
      await interaction.editReply({ content: "This action isn't for you." }).catch(() => {});
      return;
    }

    let completedAt: Date | null = null;
    if (session.dateChoice === "today") {
      completedAt = new Date();
    } else if (session.dateChoice === "unknown") {
      completedAt = null;
    } else if (session.dateChoice === "date") {
      const dateInput = stripModalInput(interaction.fields.getTextInputValue("completion-date"));
      try {
        completedAt = parseCompletionDateInput(dateInput);
      } catch (err: any) {
        await interaction.editReply({
          content: err?.message ?? "Invalid completion date.",
        }).catch(() => {});
        return;
      }
    }

    const playtimeInput = stripModalInput(
      interaction.fields.getTextInputValue("completion-playtime"),
    );
    const playtimeCheck = validateCompletionPlaytimeInput(playtimeInput);
    if (playtimeCheck.error) {
      await interaction.editReply({
        content: playtimeCheck.error,
      }).catch(() => {});
      return;
    }
    const playtime = playtimeCheck.value;

    const noteInput = stripModalInput(interaction.fields.getTextInputValue("completion-note"));
    const note = noteInput ? noteInput : null;
    if (note && note.length > MAX_COMPLETION_NOTE_LEN) {
      await interaction.editReply({
        content: `Note must be ${MAX_COMPLETION_NOTE_LEN} characters or fewer.`,
      }).catch(() => {});
      return;
    }

    if (!session.platformChoice) {
      await interaction.editReply({ content: "Platform selection missing." }).catch(() => {});
      return;
    }
    const isOtherPlatform = session.platformChoice === "other";
    let platformId: number | null = null;
    if (!isOtherPlatform) {
      const parsedId = Number(session.platformChoice);
      if (!Number.isInteger(parsedId) || parsedId <= 0) {
        await interaction.editReply({ content: "Invalid platform selection." }).catch(() => {});
        return;
      }
      platformId = parsedId;
    } else {
      await notifyUnknownCompletionPlatform(interaction, session.gameTitle, session.gameId);
    }

    const removeFromNowPlaying = session.removeChoice === "yes";

    try {
      await Member.addCompletion({
        userId: interaction.user.id,
        gameId: session.gameId,
        completionType: session.completionType ?? "Main Story",
        platformId,
        completedAt,
        finalPlaytimeHours: playtime,
        note,
      });
      if (removeFromNowPlaying) {
        await Member.removeNowPlaying(interaction.user.id, session.gameId).catch(() => {});
      }

      await this.updateGameProfileMessageById(
        interaction,
        session.sourceChannelId,
        session.sourceMessageId,
        session.gameId,
      );

      await this.deleteCompletionWizardMessage(session);
      COMPLETION_WIZARD_SESSIONS.delete(sessionId);
      await interaction.deleteReply().catch(() => {});
    } catch (err: any) {
      await interaction.editReply({
        content: `Failed to add completion: ${err?.message ?? String(err)}`,
      }).catch(() => {});
    }
  }

  private async updateGameProfileMessageById(
    interaction: ButtonInteraction | ModalSubmitInteraction,
    channelId: string,
    messageId: string,
    gameId: number,
  ): Promise<void> {
    const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !("messages" in channel)) {
      return;
    }
    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message) return;
    const profile = await this.buildGameProfile(gameId, interaction);
    if (!profile) return;
    const actionRows = this.buildGameProfileActionRow(
      gameId,
      profile.hasThread,
      profile.featuredVideoUrl,
      profile.canMarkThumbnailBad,
      profile.isThumbnailBad,
      profile.isThumbnailApproved,
      profile.isReleased,
    );
    const searchRows = getSearchRowsFromComponents(message.components ?? []);
    await message.edit({
      embeds: [],
      files: profile.files,
      components: [...profile.components, ...actionRows, ...searchRows],
    }).catch(() => {});
  }

  private async deleteCompletionWizardMessage(session: CompletionWizardSession): Promise<void> {
    if (!session.ephemeralMessageId) return;
    const webhook = new WebhookClient({
      id: session.applicationId,
      token: session.interactionToken,
    });
    await webhook.deleteMessage(session.ephemeralMessageId).catch(() => {});
  }

  @ModalComponent({ id: /^gamedb-nowplaying-modal:\d+$/ })
  async handleGameDbNowPlayingModal(interaction: ModalSubmitInteraction): Promise<void> {
    const [, gameIdRaw] = interaction.customId.split(":");
    const gameId = Number(gameIdRaw);
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    if (!Number.isInteger(gameId) || gameId <= 0) {
      await interaction.editReply({ content: "Invalid GameDB id." }).catch(() => {});
      return;
    }

    const game = await Game.getGameById(gameId);
    if (!game) {
      await interaction.editReply({ content: "That game was not found in GameDB." }).catch(() => {});
      return;
    }

    const noteRaw = stripModalInput(
      interaction.fields.getTextInputValue("gamedb-nowplaying-note"),
    );
    if (noteRaw.length > MAX_NOW_PLAYING_NOTE_LEN) {
      await interaction.editReply({
        content: `Note must be ${MAX_NOW_PLAYING_NOTE_LEN} characters or fewer.`,
      }).catch(() => {});
      return;
    }

    const note = noteRaw.length ? noteRaw : null;
    try {
      const platforms = await Game.getPlatformsForGame(gameId);
      if (!platforms.length) {
        await interaction.editReply({
          content:
            "This game has no platform data yet. Add to Now Playing from `/now-playing list` after platform data is available.",
        }).catch(() => {});
        return;
      }
      const defaultPlatform = platforms[0];
      await Member.addNowPlaying(interaction.user.id, gameId, defaultPlatform.id, note);
      const nowPlaying = new NowPlayingCommand();
      await nowPlaying.showSingle(interaction, interaction.user, true);
    } catch (err: any) {
      if (isUniqueConstraintError(err)) {
        await interaction.editReply({
          content: `**${game.title}** is already in your Now Playing list.`,
        }).catch(() => {});
        return;
      }
      const msg = err?.message ?? "Failed to add to Now Playing.";
      await interaction.editReply({
        content: `Failed to add: ${msg}`,
      }).catch(() => {});
    }
  }

  private async runNowPlayingThreadWizard(
    interaction: ButtonInteraction,
    gameId: number,
    gameTitle: string,
  ): Promise<void> {
    const existingThreads = await getThreadsByGameId(gameId);
    if (existingThreads.length) {
      await interaction.followUp({
        content: "A thread is already linked to this game.",
      });
      return;
    }

    const forum = (await interaction.guild?.channels.fetch(
      NOW_PLAYING_FORUM_ID,
    )) as ForumChannel | null;
    if (!forum) {
      await interaction.followUp({
        content: "Now Playing forum channel was not found.",
      });
      return;
    }

    const threadTitle = gameTitle;

    const memberDisplayName =
      (interaction.member as any)?.displayName ?? interaction.user.username ?? "User";
    const game = await Game.getGameById(gameId);
    const files = game?.imageData
      ? [new AttachmentBuilder(game.imageData, { name: `gamedb_${gameId}.png` })]
      : [];
    const messagePayload: MessageCreateOptions = {
      content: `Now Playing thread created by ${memberDisplayName}.`,
      allowedMentions: { parse: [] as const },
    };
    if (files.length) {
      messagePayload.files = files;
    }

    try {
      const thread = await forum.threads.create({
        name: threadTitle,
        message: messagePayload,
        appliedTags: [NOW_PLAYING_SIDEGAME_TAG_ID],
      });
      await upsertThreadRecord({
        threadId: thread.id,
        forumChannelId: thread.parentId ?? NOW_PLAYING_FORUM_ID,
        threadName: thread.name ?? threadTitle,
        isArchived: Boolean(thread.archived),
        createdAt: thread.createdAt ?? new Date(),
        lastSeenAt: null,
        skipLinking: "Y",
      });
      await setThreadGameLink(thread.id, gameId);
      await interaction.followUp({
        content: `Created and linked <#${thread.id}>.`,
      });
      const nowPlayingMembers = await Game.getNowPlayingMembers(gameId);
      const completions = await Game.getGameCompletions(gameId);
      const mentionIds = new Set<string>([interaction.user.id]);
      nowPlayingMembers.forEach((member) => mentionIds.add(member.userId));
      completions.forEach((member) => mentionIds.add(member.userId));

      if (mentionIds.size) {
        const mentions = Array.from(mentionIds).map((id) => `<@${id}>`);
        const lines: string[] = [];
        let buffer = "";
        for (const mention of mentions) {
          const next = buffer ? `${buffer} ${mention}` : mention;
          if (next.length > 1900) {
            lines.push(buffer);
            buffer = mention;
          } else {
            buffer = next;
          }
        }
        if (buffer) lines.push(buffer);

        for (const line of lines) {
          await thread.send({ content: line });
        }
      }

      const profile = await this.buildGameProfile(gameId, interaction);
      if (profile) {
        const actionRows = this.buildGameProfileActionRow(
          gameId,
          profile.hasThread,
          profile.featuredVideoUrl,
          profile.canMarkThumbnailBad,
          profile.isThumbnailBad,
          profile.isThumbnailApproved,
          profile.isReleased,
        );
        const existingComponents = interaction.message?.components ?? [];
        const updatedComponents = existingComponents.length
          ? existingComponents.map((row) => {
              if (!("components" in row)) return row;
              const actionRowComponents = (row as ActionRow<MessageActionRowComponent>).components;
              const hasGameDbAction = actionRowComponents.some((component) =>
                component.customId?.startsWith("gamedb-action:"),
              );
              return hasGameDbAction ? actionRows[0] : row;
            })
          : [actionRows[0]];
        if (actionRows.length > 1) {
          updatedComponents.push(...actionRows.slice(1));
        }
        await interaction.editReply({
          embeds: [],
          files: profile.files,
          components: updatedComponents,
          flags: buildComponentsV2Flags(false),
        }).catch(() => {});
      }
    } catch (err: any) {
      await interaction.followUp({
        content: `Failed to create thread: ${err?.message ?? String(err)}`,
      });
    }
  }

  private async runCompletionWizard(
    interaction: ButtonInteraction,
    gameId: number,
    gameTitle: string,
    thread?: TextBasedChannel | ThreadChannel,
    wizardMessage?: Message,
  ): Promise<void> {
    const baseEmbed = this.getWizardBaseEmbed(interaction, "Completion Wizard");
    let logHistory = "";
    let finalMessage: string | null = null;
    const updateEmbed = async (log?: string) => {
      if (log) {
        logHistory += `${log}\n`;
      }
      if (logHistory.length > 3500) {
        logHistory = "..." + logHistory.slice(logHistory.length - 3500);
      }
      const embed = this.buildWizardEmbed(baseEmbed, logHistory || "Processing...");
      if (wizardMessage) {
        await wizardMessage.edit({ embeds: [embed] }).catch(() => {});
      } else {
        await interaction.editReply({ embeds: [embed], components: [] }).catch(() => {});
      }
    };

    const wizardPrompt = async (question: string): Promise<string | null> => {
      await updateEmbed(`\n❓ **${question}**`);
      const channel: any = thread ?? interaction.channel;
      if (!channel || typeof channel.awaitMessages !== "function") {
        await updateEmbed("❌ Cannot prompt for input in this channel.");
        return null;
      }
      const collected = await channel.awaitMessages({
        filter: (m: Message) => m.author.id === interaction.user.id,
        max: 1,
        time: 120_000,
      }).catch(() => null);
      const first = collected?.first();
      if (!first) {
        await updateEmbed("❌ Timed out.");
        return null;
      }
      const content = first.content.trim();
      await first.delete().catch(() => {});
      await updateEmbed(`> *${content}*`);
      if (/^cancel$/i.test(content)) {
        await updateEmbed("❌ Cancelled by user.");
        return null;
      }
      return content;
    };

    const wizardChoice = async (
      question: string,
      options: PromptChoiceOption[],
    ): Promise<string | null> => {
      await updateEmbed(`Prompt: **${question}**`);
      const channel: any = thread ?? interaction.channel;
      if (!channel || typeof channel.send !== "function") {
        await updateEmbed("Cannot prompt for input in this channel.");
        return null;
      }

      const promptId = `gamedb-choice:${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      const rows = buildChoiceRows(promptId, options);
      const promptMessage: Message | null = await channel.send({
        content: `<@${interaction.user.id}> ${question}`,
        components: rows,
        allowedMentions: { users: [interaction.user.id] },
      }).catch(() => null);
      if (!promptMessage) {
        await updateEmbed("Failed to send prompt.");
        return null;
      }

      try {
        const selection = await promptMessage.awaitMessageComponent({
          componentType: ComponentType.Button,
          filter: (i) =>
            i.user.id === interaction.user.id && i.customId.startsWith(`${promptId}:`),
          time: 120_000,
        });
        await selection.deferUpdate().catch(() => {});
        const value = selection.customId.slice(promptId.length + 1);
        const chosenLabel = options.find((opt) => opt.value === value)?.label ?? value;
        await promptMessage.edit({ components: [] }).catch(() => {});
        await updateEmbed(`Selected: *${chosenLabel}*`);
        if (value === "cancel") {
          await updateEmbed("Cancelled by user.");
          return null;
        }
        return value;
      } catch {
        await promptMessage.edit({ components: [] }).catch(() => {});
        await updateEmbed("Timed out waiting for a selection.");
        return null;
      }
    };
    const wizardSelect = async (
      question: string,
      options: Array<{ label: string; value: string }>,
    ): Promise<string | null> => {
      await updateEmbed(`Prompt: **${question}**`);
      const channel: any = thread ?? interaction.channel;
      if (!channel || typeof channel.send !== "function") {
        await updateEmbed("Cannot prompt for input in this channel.");
        return null;
      }

      const promptId = `gamedb-select:${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      const select = new StringSelectMenuBuilder()
        .setCustomId(promptId)
        .setPlaceholder(question)
        .addOptions(options);
      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
      const promptMessage: Message | null = await channel.send({
        content: `<@${interaction.user.id}> ${question}`,
        components: [row],
        allowedMentions: { users: [interaction.user.id] },
      }).catch(() => null);
      if (!promptMessage) {
        await updateEmbed("Failed to send prompt.");
        return null;
      }

      try {
        const selection = await promptMessage.awaitMessageComponent({
          componentType: ComponentType.StringSelect,
          filter: (i) => i.user.id === interaction.user.id && i.customId === promptId,
          time: 120_000,
        });
        await selection.deferUpdate().catch(() => {});
        const value = selection.values?.[0];
        await promptMessage.edit({ components: [] }).catch(() => {});
        if (!value) {
          await updateEmbed("No selection made.");
          return null;
        }
        const chosenLabel = options.find((opt) => opt.value === value)?.label ?? value;
        await updateEmbed(`Selected: *${chosenLabel}*`);
        return value;
      } catch {
        await promptMessage.edit({ components: [] }).catch(() => {});
        await updateEmbed("Timed out waiting for a selection.");
        return null;
      }
    };
    await updateEmbed(`✅ Starting for **${gameTitle}**`);

    let completionType: CompletionType | null = null;
    const completionChoice = await wizardChoice(
      "Completion type?",
      [
        ...COMPLETION_TYPES.map((value) => ({
          label: value.slice(0, 80),
          value,
          style: ButtonStyle.Primary,
        })),
        { label: "Cancel", value: "cancel", style: ButtonStyle.Danger },
      ],
    );
    if (completionChoice === null) return;
    completionType = completionChoice as CompletionType;

    let completedAt: Date | null = null;
    const dateChoice = await wizardChoice(
      "Completion date?",
      [
        { label: "Today", value: "today", style: ButtonStyle.Primary },
        { label: "Unknown", value: "unknown" },
        { label: "Enter Date", value: "date" },
        { label: "Cancel", value: "cancel", style: ButtonStyle.Danger },
      ],
    );
    if (dateChoice === null) return;
    if (dateChoice === "today") {
      completedAt = new Date();
    } else if (dateChoice === "unknown") {
      completedAt = null;
    } else {
      while (true) {
        const response = await wizardPrompt("Enter completion date (YYYY-MM-DD).")
        if (response === null) return;
        try {
          completedAt = parseCompletionDateInput(response);
          break;
        } catch (err: any) {
          await updateEmbed(`Error: ${err?.message ?? "Invalid date."}`);
        }
      }
    }

    let playtime: number | null = null;
    const playtimeChoice = await wizardChoice(
      "Final playtime in hours?",
      [
        { label: "Enter Hours", value: "enter", style: ButtonStyle.Primary },
        { label: "Skip", value: "skip" },
        { label: "Cancel", value: "cancel", style: ButtonStyle.Danger },
      ],
    );
    if (playtimeChoice === null) return;
    if (playtimeChoice === "enter") {
      while (true) {
        const response = await wizardPrompt("Enter the playtime in hours (e.g., 42.5).")
        if (response === null) return;
        const num = Number(response);
        if (Number.isNaN(num) || num < 0) {
          await updateEmbed("Playtime must be a non-negative number.");
          continue;
        }
        playtime = num;
        break;
      }
    }

    let note: string | null = null;
    const noteChoice = await wizardChoice(
      "Add a note?",
      [
        { label: "Enter Note", value: "enter", style: ButtonStyle.Primary },
        { label: "Skip", value: "skip" },
        { label: "Cancel", value: "cancel", style: ButtonStyle.Danger },
      ],
    );
    if (noteChoice === null) return;
    if (noteChoice === "enter") {
      while (true) {
        const response = await wizardPrompt("Enter a completion note.");
        if (response === null) return;
        if (response.length > MAX_COMPLETION_NOTE_LEN) {
          await updateEmbed(`Note must be ${MAX_COMPLETION_NOTE_LEN} characters or fewer.`);
          continue;
        }
        note = response;
        break;
      }
    }

    const platforms = await Game.getPlatformsForGameWithStandard(
      gameId,
      STANDARD_PLATFORM_IDS,
    );
    const sortedPlatforms = [...platforms].sort((a, b) =>
      a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
    );
    const baseOptions = sortedPlatforms.map((platform) => ({
      label: platform.name.slice(0, 100),
      value: String(platform.id),
    }));
    const platformOptions = [
      ...baseOptions.slice(0, 24),
      { label: "Other", value: "other" },
    ];
    const platformChoice = await wizardSelect("Platform?", platformOptions);
    if (!platformChoice) return;
    const isOtherPlatform = platformChoice === "other";
    let platformId: number | null = null;
    if (!isOtherPlatform) {
      const parsedId = Number(platformChoice);
      if (!Number.isInteger(parsedId) || parsedId <= 0) {
        await updateEmbed("❌ Invalid platform selection.");
        return;
      }
      platformId = parsedId;
    } else {
      await notifyUnknownCompletionPlatform(interaction, gameTitle, gameId);
    }

    let removeFromNowPlaying = false;
    const nowPlayingMeta = await Member.getNowPlayingEntryMeta(interaction.user.id, gameId);
    if (nowPlayingMeta) {
      const removeChoice = await wizardChoice(
        "Remove from your Now Playing list?",
        [
          { label: "Yes", value: "yes", style: ButtonStyle.Danger },
          { label: "No", value: "no" },
          { label: "Cancel", value: "cancel", style: ButtonStyle.Secondary },
        ],
      );
      if (removeChoice === null) return;
      if (removeChoice === "cancel") return;
      removeFromNowPlaying = removeChoice === "yes";
    }

    try {
      await Member.addCompletion({
        userId: interaction.user.id,
        gameId,
        completionType: completionType ?? "Main Story",
        platformId,
        completedAt,
        finalPlaytimeHours: playtime,
        note,
      });
      if (removeFromNowPlaying) {
        await Member.removeNowPlaying(interaction.user.id, gameId).catch(() => {});
      }
      await updateEmbed(`✅ Added completion for **${gameTitle}**.`);
      finalMessage = `✅ Added completion for **${gameTitle}**.`;
    } catch (err: any) {
      const msg = `❌ Failed to add completion: ${err?.message ?? String(err)}`;
      await updateEmbed(msg);
      finalMessage = msg;
    } finally {
      if (finalMessage) {
        await interaction.followUp({
          content: finalMessage,
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      }
      if (thread && "delete" in thread) {
        await thread.delete().catch(() => {});
      }
    }
  }

  private getWizardBaseEmbed(
    interaction: ButtonInteraction,
    fallbackTitle: string,
  ): EmbedBuilder {
    return new EmbedBuilder().setTitle(fallbackTitle).setColor(0x0099ff);
  }

  private buildWizardEmbed(base: EmbedBuilder, log: string): EmbedBuilder {
    const embed = EmbedBuilder.from(base);
    const baseDesc = base.data.description ?? "";
    const divider = baseDesc ? "\n\n" : "";
    const combined = `${baseDesc}${divider}${log}`.trim();
    embed.setDescription(combined.slice(0, 4096));
    return embed;
  }

  // Helper to process release dates
  private async processReleaseDates(
    gameId: number,
    releaseDates: any[],
  ): Promise<void> {
    if (!releaseDates || !Array.isArray(releaseDates)) {
      return;
    }

    const platformIds: number[] = [];
    for (const release of releaseDates) {
      const platformId: number | null = typeof release.platform === "number"
        ? release.platform
        : (release.platform?.id ?? null);
      if (platformId) {
        platformIds.push(platformId);
      }
    }
    const uniquePlatformIds: number[] = Array.from(new Set(platformIds));
    const platformMap = await Game.getPlatformsByIgdbIds(uniquePlatformIds);
    const missingPlatformIds = uniquePlatformIds.filter((id) => !platformMap.has(id));
    if (missingPlatformIds.length) {
      console.warn(
        `[GameDB] Missing IGDB platform IDs in GAMEDB_PLATFORMS: ${missingPlatformIds.join(", ")}`,
      );
    }

    for (const release of releaseDates) {
      const platformId: number | null = typeof release.platform === "number"
        ? release.platform
        : (release.platform?.id ?? null);
      if (!platformId || !release.region) {
        continue;
      }

      const platform = platformMap.get(platformId);
      const region = await Game.ensureRegion(release.region);

      if (!platform || !region) {
        continue;
      }

      try {
        await Game.addReleaseInfo(
          gameId,
          platform.id,
          region.id,
          "Physical",
          release.date ? new Date(release.date * 1000) : null,
          null,
        );
      } catch (err) {
        console.error(`Failed to add release for game ${gameId}:`, err);
      }
    }
  }

  @Slash({ description: "Search for a game", name: "search" })
  async search(
    @SlashOption({
      description: "Search query (game title).",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    query: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(false) });

    try {
      const searchTerm = sanitizeUserInput(query, { preserveNewlines: false });
      await this.runSearchFlow(interaction, searchTerm, query);
    } catch (error: any) {
      await safeReply(interaction, {
        content: `Failed to search games. Error: ${error.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async runSearchFlow(
    interaction: CommandInteraction,
    searchTerm: string,
    rawQuery?: string,
  ): Promise<void> {
    const results = await Game.searchGames(searchTerm);

    if (results.length === 0) {
      await this.handleNoResults(interaction, searchTerm || rawQuery || "Unknown");
      return;
    }

    if (results.length === 1) {
      await this.showGameProfile(interaction, results[0].id);
      return;
    }

    const response = this.buildSearchResponse(
      searchTerm,
      results,
      interaction.user.id,
      0,
      true,
    );

    await safeReply(interaction, response);
  }

  @SelectMenuComponent({ id: /^gamedb-search-select:\d+:\d+:[A-Za-z0-9_-]*$/ })
  async handleSearchSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const ownerId = parts[1];
    const page = Number(parts[2]);
    const encodedQuery = parts[3] ?? "";

    if (interaction.user.id !== ownerId) {
      await interaction
        .reply({
          content: "This menu isn't for you.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    const searchTerm = sanitizeUserInput(decodeSearchQuery(encodedQuery), { preserveNewlines: false });
    if (!searchTerm) {
      const components = buildSearchRecoveryComponents(ownerId, encodedQuery);
      await safeReply(interaction, {
        content: "This search request expired. Refresh to run it again.",
        components,
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      return;
    }

    const results = await Game.searchGames(searchTerm);

    const gameId = Number(interaction.values?.[0]);
    if (!Number.isFinite(gameId)) {
      await interaction
        .reply({
          content: "Invalid selection.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    try {
      await interaction.deferUpdate();
    } catch {
      // ignore
    }

    const profile = await this.buildGameProfile(gameId, interaction);
    if (!profile) {
      await interaction
        .followUp({
          content: "Unable to load that game.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    const response = this.buildSearchResponse(searchTerm, results, ownerId, page, false);
    const actionRows = this.buildGameProfileActionRow(
      gameId,
      profile.hasThread,
      profile.featuredVideoUrl,
      profile.canMarkThumbnailBad,
      profile.isThumbnailBad,
      profile.isThumbnailApproved,
      profile.isReleased,
    );

    try {
      await interaction.editReply({
        embeds: [],
        files: profile.files,
        components: [...profile.components, ...actionRows, ...response.components],
        flags: response.flags,
      });
    } catch {
      // ignore update failures
    }
  }

  @ButtonComponent({ id: /^gamedb-search-page:\d+:\d+:[A-Za-z0-9_-]*:(next|prev)$/ })
  async handleSearchPage(interaction: ButtonInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const ownerId = parts[1];
    const page = Number(parts[2]);
    const encodedQuery = parts[3] ?? "";
    const direction = parts[4];

    if (interaction.user.id !== ownerId) {
      await interaction
        .reply({
          content: "This menu isn't for you.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    const searchTerm = sanitizeUserInput(decodeSearchQuery(encodedQuery), { preserveNewlines: false });
    if (!searchTerm) {
      const components = buildSearchRecoveryComponents(ownerId, encodedQuery);
      await safeReply(interaction, {
        content: "This search request expired. Refresh to run it again.",
        components,
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      return;
    }

    const results = await Game.searchGames(searchTerm);
    const totalPages = Math.max(
      1,
      Math.ceil(results.length / GAME_SEARCH_PAGE_SIZE),
    );
    const delta = direction === "next" ? 1 : -1;
    const newPage = Math.min(Math.max(page + delta, 0), totalPages - 1);

    try {
      await interaction.deferUpdate();
    } catch {
      // ignore
    }

    const response = this.buildSearchResponse(searchTerm, results, ownerId, newPage, true);

    try {
      await interaction.editReply(response);
    } catch {
      // ignore
    }
  }

  @ButtonComponent({ id: /^gamedb-search-refresh:\d+:[A-Za-z0-9_-]*$/ })
  async handleSearchRefresh(interaction: ButtonInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const ownerId = parts[1];
    const encodedQuery = parts[2] ?? "";

    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, {
        content: "This refresh button isn't for you.",
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      return;
    }

    const searchTerm = sanitizeUserInput(decodeSearchQuery(encodedQuery), { preserveNewlines: false });
    if (!searchTerm) {
      await safeReply(interaction, {
        content: "Unable to refresh: search details were not found.",
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      return;
    }

    const results = await Game.searchGames(searchTerm);
    if (results.length === 0) {
      await safeReply(interaction, {
        content: `No results found for "${searchTerm}".`,
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
      return;
    }

    const response = this.buildSearchResponse(searchTerm, results, ownerId, 0, true);
    await safeUpdate(interaction, response);
  }

  private buildSearchResponse(
    searchTerm: string,
    results: any[],
    ownerId: string,
    page: number,
    includeList: boolean,
  ): { components: Array<ContainerBuilder | ActionRowBuilder<any>>; flags: number } {
    const totalPages = Math.max(
      1,
      Math.ceil(results.length / GAME_SEARCH_PAGE_SIZE),
    );
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);
    const start = safePage * GAME_SEARCH_PAGE_SIZE;
    const displayedResults = results.slice(
      start,
      start + GAME_SEARCH_PAGE_SIZE,
    );
    const titleCounts = new Map<string, number>();
    results.forEach((game) => {
      const title = String(game.title ?? "");
      titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
    });
    const resultList = displayedResults.map((game) => {
      const title = String(game.title ?? "");
      const isDuplicate = (titleCounts.get(title) ?? 0) > 1;
      if (!isDuplicate) {
        return `• **${title}**`;
      }
      const releaseDate = game.initialReleaseDate as Date | null | undefined;
      const year = releaseDate instanceof Date
        ? releaseDate.getFullYear()
        : releaseDate
          ? new Date(releaseDate).getFullYear()
          : null;
      const yearText = year ? ` (${year})` : " (Unknown Year)";
      return `• **${title}**${yearText}`;
    }).join("\n");

    const title = searchTerm
      ? `Search Results for "${searchTerm}" (Page ${safePage + 1}/${totalPages})`
      : `All Games (Page ${safePage + 1}/${totalPages})`;

    const selectCustomId = buildSearchCustomId("select", ownerId, safePage, searchTerm);
    const options = displayedResults.map((game) => {
      const title = String(game.title ?? "");
      const isDuplicate = (titleCounts.get(title) ?? 0) > 1;
      let label = title;
      if (isDuplicate) {
        const releaseDate = game.initialReleaseDate as Date | null | undefined;
        const year = releaseDate instanceof Date
          ? releaseDate.getFullYear()
          : releaseDate
            ? new Date(releaseDate).getFullYear()
            : null;
        const yearText = year ? ` (${year})` : " (Unknown Year)";
        label = `${title}${yearText}`;
      }
      return {
        label: label.substring(0, 100),
        value: String(game.id),
        description: "View this game",
      };
    });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(selectCustomId)
      .setPlaceholder("Select a game to view details")
      .addOptions(options);

    const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    const prevDisabled = safePage === 0;
    const nextDisabled = safePage >= totalPages - 1;

    const prevButton = new ButtonBuilder()
      .setCustomId(buildSearchCustomId("page", ownerId, safePage, searchTerm, "prev"))
      .setLabel("Previous Page")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(prevDisabled);

    const nextButton = new ButtonBuilder()
      .setCustomId(buildSearchCustomId("page", ownerId, safePage, searchTerm, "next"))
      .setLabel("Next Page")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(nextDisabled);

    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(prevButton, nextButton);
    const components: Array<ContainerBuilder | ActionRowBuilder<any>> = [];
    if (includeList) {
      const listText = resultList || "No results.";
      const content = this.trimTextDisplayContent(
        `## ${title}\n\n${listText}\n\n*${results.length} results total*`,
      );
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(content),
      );
      components.push(container);
    }
    components.push(selectRow);

    if (shouldRenderPrevNextButtons(prevDisabled, nextDisabled)) {
      components.push(buttonRow);
    }

    return {
      components,
      flags: buildComponentsV2Flags(false),
    };
  }
}
