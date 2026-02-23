import {
  ApplicationCommandOptionType,
  AutocompleteInteraction,
  ButtonStyle,
  CommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  type Attachment,
  ModalBuilder,
  ModalSubmitInteraction,
  MessageFlags,
  StringSelectMenuInteraction,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type GuildMember,
  type User,
  EmbedBuilder,
} from "discord.js";
import {
  Discord,
  Slash,
  SlashChoice,
  SlashGroup,
  SlashOption,
  ButtonComponent,
  ModalComponent,
  SelectMenuComponent,
} from "discordx";
import {
  ContainerBuilder,
  ButtonBuilder as V2ButtonBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "@discordjs/builders";
import UserGameCollection, {
  COLLECTION_OWNERSHIP_TYPES,
  type CollectionOwnershipType,
  type IUserGameCollectionOverviewEntry,
} from "../classes/UserGameCollection.js";
import {
  type SteamCollectionMatchConfidence,
  countSteamCollectionImportResultReasons,
  createSteamCollectionImportSession,
  countSteamCollectionImportItems,
  getSteamAppGameDbMapByAppId,
  getSteamAppHistoricalMappedGameIds,
  getSteamCollectionImportItemById,
  getNextPendingSteamCollectionImportItem,
  getSteamCollectionImportById,
  getActiveSteamCollectionImportForUser,
  insertSteamCollectionImportItems,
  setSteamCollectionImportStatus,
  upsertSteamAppGameDbMap,
  updateSteamCollectionImportIndex,
  updateSteamCollectionImportItem,
} from "../classes/SteamCollectionImport.js";
import {
  type CollectionCsvMatchConfidence,
  type ICollectionCsvImport,
  type ICollectionCsvImportItem,
  countCollectionCsvImportItems,
  countCollectionCsvImportResultReasons,
  createCollectionCsvImportSession,
  getActiveCollectionCsvImportForUser,
  getCollectionCsvImportById,
  getCollectionCsvImportItemById,
  getNextPendingCollectionCsvImportItem,
  insertCollectionCsvImportItems,
  setCollectionCsvImportStatus,
  updateCollectionCsvImportIndex,
  updateCollectionCsvImportItem,
} from "../classes/CollectionCsvImport.js";
import Game from "../classes/Game.js";
import Member from "../classes/Member.js";
import {
  autocompleteGameCompletionPlatformStandardFirst,
  resolveGameCompletionPlatformId,
  resolveGameCompletionPlatformLabel,
} from "./game-completion/completion-autocomplete.utils.js";
import {
  safeDeferReply,
  safeUpdate,
  sanitizeUserInput,
} from "../functions/InteractionUtils.js";
import {
  buildProgressiveTitleVariants,
  normalizeTitleWithSteps,
} from "../functions/ImportTitleNormalization.js";
import {
  COMPLETION_TYPES,
  type CompletionType,
  formatTableDate,
  parseCompletionDateInput,
} from "./profile.command.js";
import { saveCompletion } from "../functions/CompletionHelpers.js";
import { formatGameTitleWithYear } from "../functions/GameTitleAutocompleteUtils.js";
import { formatPlatformDisplayName } from "../functions/PlatformDisplay.js";
import { igdbService, type IGDBGame } from "../services/IGDB/IgdbService.js";
import {
  createIgdbSession,
  type IgdbSelectOption,
} from "../services/IGDB/IgdbSelectService.js";
import { SteamApiError, steamApiService } from "../services/SteamApiService.js";
import { COMPONENTS_V2_FLAG } from "../config/flags.js";
import { COLLECTION_OVERVIEW_EMOJIS } from "../config/emojis.js";
import {
  buildImportActionsContainer,
  buildImportMessageContainer,
  buildImportTextContainer,
  flattenErrorMessages,
  handleImportActionCommand,
  IMPORT_ACTIONS,
  type ImportAction,
  logImportComponentDiagnostics,
  safeV2TextContent,
} from "./imports/import-scaffold.service.js";
import {
  COLLECTION_CSV_TEMPLATE_VERSION,
  COLLECTION_CSV_EXAMPLE_NOTE,
  buildCollectionCsvTemplateAttachment,
  fetchCsvAttachment,
  parseCollectionCsvImportText,
} from "./collection/collection-csv-import.service.js";

const COLLECTION_ENTRY_VALUE_PREFIX = "collection";
const COLLECTION_LIST_PAGE_SIZE = 10;
const COLLECTION_LIST_NAV_PREFIX = "collection-list-nav-v2";
const COLLECTION_LIST_FILTER_PREFIX = "collection-list-filter-v1";
const COLLECTION_LIST_FILTER_PANEL_PREFIX = "clf1";
const COLLECTION_LIST_FILTER_MODAL_PREFIX = "clfm1";
const COLLECTION_FILTER_TITLE_INPUT_ID = "collection-filter-title";
const COLLECTION_FILTER_PLATFORM_INPUT_ID = "collection-filter-platform";
const COLLECTION_STEAM_IMPORT_ACTION_PREFIX = "collection-steam-import-v1";
const COLLECTION_STEAM_CHOOSE_PREFIX = "collection-steam-choose-v1";
const COLLECTION_STEAM_REMAP_MODAL_PREFIX = "collection-steam-remap-v1";
const COLLECTION_STEAM_REMAP_INPUT_ID = "collection-steam-remap-title";
const COLLECTION_STEAM_GAME_ID_MODAL_PREFIX = "collection-steam-game-id-v1";
const COLLECTION_STEAM_GAME_ID_INPUT_ID = "collection-steam-game-id";
const COLLECTION_CSV_IMPORT_ACTION_PREFIX = "collection-csv-import-v1";
const COLLECTION_CSV_CHOOSE_PREFIX = "collection-csv-choose-v1";
const COLLECTION_CSV_REMAP_MODAL_PREFIX = "collection-csv-remap-v1";
const COLLECTION_CSV_REMAP_INPUT_ID = "collection-csv-remap-title";
const COLLECTION_CSV_GAME_ID_MODAL_PREFIX = "collection-csv-game-id-v1";
const COLLECTION_CSV_GAME_ID_INPUT_ID = "collection-csv-game-id";
const COLLECTION_OVERVIEW_SELECT_PREFIX = "collection-overview-select-v1";
const COLLECTION_OVERVIEW_SELECT_OVERVIEW = "overview";
const COLLECTION_OVERVIEW_SELECT_ALL_GAMES = "all-games";
const COLLECTION_OVERVIEW_SELECT_PLATFORM_PREFIX = "platform";
const COLLECTION_OVERVIEW_UNKNOWN_PLATFORM = "Unknown platform";
const COLLECTION_OVERVIEW_MAX_TEXT_COMPONENTS_PER_CONTAINER = 34;
const COLLECTION_OVERVIEW_PLATFORM_EMOJI_KEYS: Record<string, keyof typeof COLLECTION_OVERVIEW_EMOJIS> = {
  "pc (microsoft windows)": "win",
  "pc (steam)": "steam",
  windows: "win",
  "pc (windows)": "win",
  "pc windows": "win",
  win: "win",
  steam: "steam",
  "steam deck": "steam",
  playstation: "ps1",
  "playstation 2": "ps2",
  "playstation 3": "ps3",
  "playstation 4": "ps4",
  "playstation 5": "ps5",
  ps1: "ps1",
  ps2: "ps2",
  ps3: "ps3",
  ps4: "ps4",
  ps5: "ps5",
  xbox: "xbox",
  "xbox 360": "x360",
  "xbox one": "xone",
  "xbox series": "xsx",
  "xbox series x": "xsx",
  "xbox series s": "xsx",
  "xbox series x|s": "xsx",
  nintendo: "nsw",
  "nintendo switch": "nsw",
  "nintendo switch 2": "nsw2",
  nsw: "nsw",
  "switch 2": "nsw2",
  switch: "nsw",
  "pc (epic)": "epic",
  "pc (luna)": "luna",
  ios: "ios",
  iphone: "ios",
  ipad: "ios",
  "mobile (ios)": "ios",
  "mobile ios": "ios",
  browser: "browser",
  "web browser": "browser",
  "web browser:": "browser",
  web: "browser",
  internet: "browser",
  "playstation vita": "vita",
  "ps vita": "vita",
  psvita: "vita",
  psv: "vita",
  vita: "vita",
  wii: "wii",
  "wii u": "wiiu",
  wiiu: "wiiu",
  "new nintendo 3ds": "new3ds",
  "new nintendo 3ds xl": "new3ds",
  "new 3ds": "new3ds",
  n3ds: "new3ds",
  new3ds: "new3ds",
  "nintendo 64": "n64",
  n64: "n64",
  "nintendo 3ds": "3ds",
  "nintendo ds": "ds",
  "game boy": "gb",
  "game boy color": "gbc",
  "game boy advance": "gba",
  "nintendo gamecube": "gc",
  "gamecube (gcn)": "gc",
  gamecube: "gc",
  gcn: "gc",
  gc: "gc",
  gba: "gba",
  gb: "gb",
  gbc: "gbc",
  ds: "ds",
  "3ds": "3ds",
};

type CollectionSteamImportButtonAction = "skip" | "remap" | "game-id" | "pause";
type CollectionCsvImportButtonAction = "skip" | "remap" | "game-id" | "pause";
type ImportCandidate = {
  gameId: number;
  title: string;
};

type ImportMatchConfidence = SteamCollectionMatchConfidence | CollectionCsvMatchConfidence;

function dedupeImportCandidates(candidates: ImportCandidate[]): ImportCandidate[] {
  const seen = new Set<number>();
  const deduped: ImportCandidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.gameId)) continue;
    seen.add(candidate.gameId);
    deduped.push(candidate);
    if (deduped.length >= 5) break;
  }
  return deduped;
}

const STEAM_IMPORT_REASON_LABELS: Record<string, string> = {
  DUPLICATE: "duplicate",
  MANUAL_SKIP: "manual-skip",
  SKIP_MAPPED: "mapped-skip",
  ADD_FAILED: "add-failed",
  PLATFORM_UNRESOLVED: "platform-unresolved",
  NO_CANDIDATE: "no-candidate",
  INVALID_REMAP: "invalid-remap",
};

const CSV_IMPORT_REASON_LABELS: Record<string, string> = {
  DUPLICATE: "duplicate",
  MANUAL_SKIP: "manual-skip",
  ADD_FAILED: "add-failed",
  PLATFORM_UNRESOLVED: "platform-unresolved",
  NO_CANDIDATE: "no-candidate",
  INVALID_REMAP: "invalid-remap",
  INVALID_ROW: "invalid-row",
  CSV_GAMEDB_ID: "csv-gamedb-id",
  CSV_IGDB_ID: "csv-igdb-id",
};

function buildImportReasonSummary(
  reasonCounts: Record<string, number>,
  labels: Record<string, string>,
): string[] {
  return Object.entries(reasonCounts)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([reason, count]) => `${labels[reason] ?? reason.toLowerCase()}: ${count}`);
}

function buildSteamImportReasonSummary(reasonCounts: Record<string, number>): string[] {
  return buildImportReasonSummary(reasonCounts, STEAM_IMPORT_REASON_LABELS);
}

function logSteamImportEvent(message: string, meta: Record<string, string | number>): void {
  const entries = Object.entries(meta).map(([key, value]) => `${key}=${value}`);
  console.info(`[SteamImport] ${message} ${entries.join(" ")}`.trim());
}

function logCsvImportEvent(message: string, meta: Record<string, string | number>): void {
  const entries = Object.entries(meta).map(([key, value]) => `${key}=${value}`);
  console.info(`[CsvImport] ${message} ${entries.join(" ")}`.trim());
}

function buildCollectionSteamImportActionId(params: {
  ownerId: string;
  importId: number;
  itemId: number;
  action: CollectionSteamImportButtonAction;
}): string {
  const actionCode = params.action === "skip"
    ? "s"
    : params.action === "remap"
      ? "r"
      : params.action === "game-id"
        ? "i"
      : "p";
  return [
    COLLECTION_STEAM_IMPORT_ACTION_PREFIX,
    params.ownerId,
    String(params.importId),
    String(params.itemId),
    actionCode,
  ].join(":");
}

function parseCollectionSteamImportActionId(customId: string): {
  ownerId: string;
  importId: number;
  itemId: number;
  action: CollectionSteamImportButtonAction;
} | null {
  const parts = customId.split(":");
  if (parts.length !== 5) return null;
  if (parts[0] !== COLLECTION_STEAM_IMPORT_ACTION_PREFIX) return null;

  const importId = Number(parts[2]);
  const itemId = Number(parts[3]);
  if (!Number.isInteger(importId) || importId <= 0) return null;
  if (!Number.isInteger(itemId) || itemId <= 0) return null;

  const actionCode = parts[4];
  const action = actionCode === "s"
    ? "skip"
    : actionCode === "r"
      ? "remap"
      : actionCode === "i"
        ? "game-id"
      : actionCode === "p"
        ? "pause"
        : null;
  if (!action) return null;

  return {
    ownerId: parts[1],
    importId,
    itemId,
    action,
  };
}

function buildCollectionSteamChooseId(params: {
  ownerId: string;
  importId: number;
  itemId: number;
  gameId: number;
}): string {
  return [
    COLLECTION_STEAM_CHOOSE_PREFIX,
    params.ownerId,
    String(params.importId),
    String(params.itemId),
    String(params.gameId),
  ].join(":");
}

function parseCollectionSteamChooseId(customId: string): {
  ownerId: string;
  importId: number;
  itemId: number;
  gameId: number;
} | null {
  const parts = customId.split(":");
  if (parts.length !== 5) return null;
  if (parts[0] !== COLLECTION_STEAM_CHOOSE_PREFIX) return null;
  const importId = Number(parts[2]);
  const itemId = Number(parts[3]);
  const gameId = Number(parts[4]);
  if (!Number.isInteger(importId) || importId <= 0) return null;
  if (!Number.isInteger(itemId) || itemId <= 0) return null;
  if (!Number.isInteger(gameId) || gameId <= 0) return null;
  return {
    ownerId: parts[1],
    importId,
    itemId,
    gameId,
  };
}

function buildCollectionSteamRemapModalId(params: {
  ownerId: string;
  importId: number;
  itemId: number;
}): string {
  return [
    COLLECTION_STEAM_REMAP_MODAL_PREFIX,
    params.ownerId,
    String(params.importId),
    String(params.itemId),
  ].join(":");
}

function parseCollectionSteamRemapModalId(customId: string): {
  ownerId: string;
  importId: number;
  itemId: number;
} | null {
  const parts = customId.split(":");
  if (parts.length !== 4) return null;
  if (parts[0] !== COLLECTION_STEAM_REMAP_MODAL_PREFIX) return null;

  const importId = Number(parts[2]);
  const itemId = Number(parts[3]);
  if (!Number.isInteger(importId) || importId <= 0) return null;
  if (!Number.isInteger(itemId) || itemId <= 0) return null;

  return {
    ownerId: parts[1],
    importId,
    itemId,
  };
}

function buildCollectionSteamGameIdModalId(params: {
  ownerId: string;
  importId: number;
  itemId: number;
}): string {
  return [
    COLLECTION_STEAM_GAME_ID_MODAL_PREFIX,
    params.ownerId,
    String(params.importId),
    String(params.itemId),
  ].join(":");
}

function parseCollectionSteamGameIdModalId(customId: string): {
  ownerId: string;
  importId: number;
  itemId: number;
} | null {
  const parts = customId.split(":");
  if (parts.length !== 4) return null;
  if (parts[0] !== COLLECTION_STEAM_GAME_ID_MODAL_PREFIX) return null;
  const importId = Number(parts[2]);
  const itemId = Number(parts[3]);
  if (!Number.isInteger(importId) || importId <= 0) return null;
  if (!Number.isInteger(itemId) || itemId <= 0) return null;
  return {
    ownerId: parts[1],
    importId,
    itemId,
  };
}

function buildCollectionCsvImportActionId(params: {
  ownerId: string;
  importId: number;
  itemId: number;
  action: CollectionCsvImportButtonAction;
}): string {
  const actionCode = params.action === "skip"
    ? "s"
    : params.action === "remap"
      ? "r"
      : params.action === "game-id"
        ? "i"
      : "p";
  return [
    COLLECTION_CSV_IMPORT_ACTION_PREFIX,
    params.ownerId,
    String(params.importId),
    String(params.itemId),
    actionCode,
  ].join(":");
}

function parseCollectionCsvImportActionId(customId: string): {
  ownerId: string;
  importId: number;
  itemId: number;
  action: CollectionCsvImportButtonAction;
} | null {
  const parts = customId.split(":");
  if (parts.length !== 5) return null;
  if (parts[0] !== COLLECTION_CSV_IMPORT_ACTION_PREFIX) return null;
  const importId = Number(parts[2]);
  const itemId = Number(parts[3]);
  if (!Number.isInteger(importId) || !Number.isInteger(itemId)) return null;
  if (!parts[1]) return null;
  const action = parts[4] === "s"
    ? "skip"
    : parts[4] === "r"
      ? "remap"
      : parts[4] === "i"
        ? "game-id"
      : parts[4] === "p"
        ? "pause"
        : null;
  if (!action) return null;
  return {
    ownerId: parts[1],
    importId,
    itemId,
    action,
  };
}

function buildCollectionCsvChooseId(params: {
  ownerId: string;
  importId: number;
  itemId: number;
  gameId: number;
}): string {
  return [
    COLLECTION_CSV_CHOOSE_PREFIX,
    params.ownerId,
    String(params.importId),
    String(params.itemId),
    String(params.gameId),
  ].join(":");
}

function parseCollectionCsvChooseId(customId: string): {
  ownerId: string;
  importId: number;
  itemId: number;
  gameId: number;
} | null {
  const parts = customId.split(":");
  if (parts.length !== 5) return null;
  if (parts[0] !== COLLECTION_CSV_CHOOSE_PREFIX) return null;
  const importId = Number(parts[2]);
  const itemId = Number(parts[3]);
  const gameId = Number(parts[4]);
  if (!Number.isInteger(importId) || !Number.isInteger(itemId)) return null;
  if (!Number.isInteger(gameId) || gameId <= 0) return null;
  if (!parts[1]) return null;
  return {
    ownerId: parts[1],
    importId,
    itemId,
    gameId,
  };
}

function buildCollectionCsvRemapModalId(params: {
  ownerId: string;
  importId: number;
  itemId: number;
}): string {
  return [
    COLLECTION_CSV_REMAP_MODAL_PREFIX,
    params.ownerId,
    String(params.importId),
    String(params.itemId),
  ].join(":");
}

function parseCollectionCsvRemapModalId(customId: string): {
  ownerId: string;
  importId: number;
  itemId: number;
} | null {
  const parts = customId.split(":");
  if (parts.length !== 4) return null;
  if (parts[0] !== COLLECTION_CSV_REMAP_MODAL_PREFIX) return null;
  const importId = Number(parts[2]);
  const itemId = Number(parts[3]);
  if (!Number.isInteger(importId) || !Number.isInteger(itemId)) return null;
  if (!parts[1]) return null;
  return {
    ownerId: parts[1],
    importId,
    itemId,
  };
}

function buildCollectionCsvGameIdModalId(params: {
  ownerId: string;
  importId: number;
  itemId: number;
}): string {
  return [
    COLLECTION_CSV_GAME_ID_MODAL_PREFIX,
    params.ownerId,
    String(params.importId),
    String(params.itemId),
  ].join(":");
}

function parseCollectionCsvGameIdModalId(customId: string): {
  ownerId: string;
  importId: number;
  itemId: number;
} | null {
  const parts = customId.split(":");
  if (parts.length !== 4) return null;
  if (parts[0] !== COLLECTION_CSV_GAME_ID_MODAL_PREFIX) return null;
  const importId = Number(parts[2]);
  const itemId = Number(parts[3]);
  if (!Number.isInteger(importId) || !Number.isInteger(itemId)) return null;
  if (!parts[1]) return null;
  return {
    ownerId: parts[1],
    importId,
    itemId,
  };
}

function parseImportCandidates(raw: unknown): ImportCandidate[] {
  if (typeof raw !== "string") return [];
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as Array<{ gameId?: number; title?: string }>;
    return dedupeImportCandidates(parsed
      .map((value) => ({
        gameId: Number(value.gameId ?? 0),
        title: String(value.title ?? ""),
      }))
      .filter((value) => Number.isInteger(value.gameId) && value.gameId > 0 && value.title.length > 0));
  } catch {
    return [];
  }
}

function buildImportMatchConfidence(
  searchTitle: string,
  candidates: ImportCandidate[],
): ImportMatchConfidence | null {
  if (!candidates.length) return null;
  return candidates[0].title.toLowerCase() === searchTitle.toLowerCase() ? "EXACT" : "FUZZY";
}

function isExactImportTitleMatch(sourceTitle: string, gameDbTitle: string): boolean {
  return normalizeTitleWithSteps(sourceTitle).toLowerCase() ===
    normalizeTitleWithSteps(gameDbTitle).toLowerCase();
}

async function buildImportCandidates(title: string): Promise<ImportCandidate[]> {
  function normalizeCandidate(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function scoreCandidate(search: string, candidate: string): number {
    if (candidate === search) return 100;
    if (candidate.startsWith(search)) return 85;
    if (candidate.includes(search)) return 70;
    const searchWords = search.split(" ").filter(Boolean);
    if (!searchWords.length) return 0;
    const matchedWords = searchWords.filter((word) => candidate.includes(word)).length;
    return Math.floor((matchedWords / searchWords.length) * 60);
  }

  const rawSearch = sanitizeUserInput(title, { preserveNewlines: false });
  const variants = buildProgressiveTitleVariants(rawSearch);
  if (!variants.length) return [];

  for (const variant of variants) {
    const results = await Game.searchGames(variant);
    if (!results.length) {
      continue;
    }

    const normalizedSearch = normalizeCandidate(variant);
    const ranked = results
      .map((game) => ({
        gameId: game.id,
        title: game.title,
        score: scoreCandidate(normalizedSearch, normalizeCandidate(game.title)),
      }))
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      .filter((entry, index) => entry.score > 0 || index < 3)
      .slice(0, 10)
      .map((entry) => ({ gameId: entry.gameId, title: entry.title }));

    return dedupeImportCandidates(ranked);
  }

  return [];
}

async function buildImportCandidatesFromMappedIds(gameIds: number[]): Promise<ImportCandidate[]> {
  if (!gameIds.length) return [];
  const uniqueIds = Array.from(new Set(gameIds.filter((value) => Number.isInteger(value) && value > 0)));
  if (!uniqueIds.length) return [];
  const games = await Game.getGamesByIds(uniqueIds);
  const byId = new Map(games.map((game) => [game.id, game]));
  const ordered = uniqueIds
    .map((id) => byId.get(id))
    .filter((game): game is NonNullable<typeof game> => Boolean(game))
    .map((game) => ({ gameId: game.id, title: game.title }));
  return dedupeImportCandidates(ordered);
}

async function searchIgdbWithProgressiveTitleVariants(
  title: string,
  limit: number,
): Promise<IGDBGame[]> {
  const rawSearch = sanitizeUserInput(title, { preserveNewlines: false });
  const variants = buildProgressiveTitleVariants(rawSearch);
  if (!variants.length) return [];

  for (const variant of variants) {
    const results = await igdbService.searchGames(variant, limit);
    if (results.results.length) {
      return results.results;
    }
  }

  return [];
}

function buildSteamImportItemMessage(params: {
  importId: number;
  rowIndex: number;
  totalCount: number;
  steamAppName: string;
  steamAppId: number;
  steamReleaseYear: number | null;
}): string {
  const releaseText = params.steamReleaseYear ? ` | Release: ${params.steamReleaseYear}` : "";
  const steamStoreUrl = `https://store.steampowered.com/app/${params.steamAppId}/`;
  return (
    `## Steam Import #${params.importId}\n` +
    `Row ${params.rowIndex}/${params.totalCount}\n` +
    `Steam: **${params.steamAppName}**${releaseText}\n` +
    `[Open in Steam Store](${steamStoreUrl})`
  );
}

function buildCsvImportItemMessage(params: {
  importId: number;
  rowIndex: number;
  totalCount: number;
  title: string;
  platformLabel: string;
  ownershipType: string;
  note: string | null;
  sourceGameDbId: number | null;
  sourceIgdbId: number | null;
}): string {
  const details = [
    `Platform: ${params.platformLabel}`,
    `Ownership: ${params.ownershipType}`,
  ];
  if (params.sourceGameDbId) {
    details.push(`CSV GameDB ID: ${params.sourceGameDbId}`);
  }
  if (params.sourceIgdbId) {
    details.push(`CSV IGDB ID: ${params.sourceIgdbId}`);
  }

  const noteText = params.note ? `\nNote: ${params.note}` : "";
  return (
    `## CSV Import #${params.importId}\n` +
    `Row ${params.rowIndex}/${params.totalCount}\n` +
    `Title: **${params.title}**\n` +
    `${details.join(" | ")}${noteText}`
  );
}

async function buildImportCandidatesContainer(params: {
  ownerId: string;
  importId: number;
  itemId: number;
  headerText: string;
  headerHelpText?: string | null;
  candidates: ImportCandidate[];
  buildChooseCustomId: (params: {
    ownerId: string;
    importId: number;
    itemId: number;
    gameId: number;
  }) => string;
  logPrefix: string;
}): Promise<ContainerBuilder> {
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(params.headerText),
    ...(params.headerHelpText ? [new TextDisplayBuilder().setContent(params.headerHelpText)] : []),
  );
  if (!params.candidates.length) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("No GameDB matches found yet."),
    );
    return container;
  }

  const gameIds = params.candidates.map((entry) => entry.gameId);
  const games = await Game.getGamesByIds(gameIds);
  const gamesWithPlatforms = await Game.attachPlatformsToGames(games);
  const gameMeta = new Map<number, { year: string; platforms: string }>();
  for (const game of gamesWithPlatforms) {
    const year = game.initialReleaseDate
      ? String(game.initialReleaseDate.getFullYear())
      : "TBD";
    const platformText = game.platforms.length
      ? game.platforms
        .map((platform) => platform.abbreviation ?? platform.name)
        .slice(0, 3)
        .join(", ")
      : "No platforms";
    gameMeta.set(game.id, { year, platforms: platformText });
  }

  params.candidates.forEach((entry) => {
    const metadata = gameMeta.get(entry.gameId) ?? {
      year: "TBD",
      platforms: "No platforms",
    };
    const sectionText = safeV2TextContent(
      `**${entry.title}**\n` +
      `-# **Release Year:** ${metadata.year} | **Platforms:** ${metadata.platforms} | ` +
      `**GameDB ID:** ${entry.gameId}`,
      900,
    );
    try {
      const section = new SectionBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(sectionText),
      );
      section.setButtonAccessory(
        new V2ButtonBuilder()
          .setCustomId(
            params.buildChooseCustomId({
              ownerId: params.ownerId,
              importId: params.importId,
              itemId: params.itemId,
              gameId: entry.gameId,
            }),
          )
          .setLabel("Choose")
          .setStyle(ButtonStyle.Primary),
      );
      section.toJSON();
      container.addSectionComponents(section);
    } catch (error) {
      const messages = flattenErrorMessages(error);
      console.error(
        `[${params.logPrefix}] candidate section validation failed`,
        JSON.stringify({
          importId: params.importId,
          itemId: params.itemId,
          gameDbGameId: entry.gameId,
          titleLength: entry.title.length,
          sectionTextLength: sectionText.length,
          messages,
        }),
      );
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          safeV2TextContent(`**${entry.title}** | #${entry.gameId}`, 300),
        ),
      );
    }
  });

  return container;
}

function buildImportIgdbContainer(params: {
  searchTitle: string;
  igdbRows: ActionRowBuilder<any>[];
  noResultsText: string | null;
}): ContainerBuilder {
  const igdbSearchUrl = `https://www.igdb.com/search?utf8=%E2%9C%93&type=1&q=${encodeURIComponent(params.searchTitle)}`;
  const igdbLink = `[Search IGDB for ${params.searchTitle}](${igdbSearchUrl})`;
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent("### Import Game From IGDB"),
  );
  for (const row of params.igdbRows) {
    container.addActionRowComponents(row.toJSON());
  }
  if (params.noResultsText) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(params.noResultsText),
    );
  }
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `Not seeing the right title? ${igdbLink}, find the **IGDB ID** and enter it using the button below.`,
    ),
  );
  return container;
}

function parseCollectionSteamChooseButtonId(customId: string): {
  ownerId: string;
  importId: number;
  itemId: number;
  gameId: number;
} | null {
  const parsed = parseCollectionSteamChooseId(customId);
  if (!parsed) return null;
  return {
    ownerId: parsed.ownerId,
    importId: parsed.importId,
    itemId: parsed.itemId,
    gameId: parsed.gameId,
  };
}

function parseCollectionCsvChooseButtonId(customId: string): {
  ownerId: string;
  importId: number;
  itemId: number;
  gameId: number;
} | null {
  const parsed = parseCollectionCsvChooseId(customId);
  if (!parsed) return null;
  return {
    ownerId: parsed.ownerId,
    importId: parsed.importId,
    itemId: parsed.itemId,
    gameId: parsed.gameId,
  };
}

function buildSteamImportItemButtons(params: {
  ownerId: string;
  importId: number;
  itemId: number;
}): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        buildCollectionSteamImportActionId({
          ownerId: params.ownerId,
          importId: params.importId,
          itemId: params.itemId,
          action: "remap",
        }),
      )
      .setLabel("Search a different title")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(
        buildCollectionSteamImportActionId({
          ownerId: params.ownerId,
          importId: params.importId,
          itemId: params.itemId,
          action: "game-id",
        }),
      )
      .setLabel("Enter GameDB or IGDB ID")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(
        buildCollectionSteamImportActionId({
          ownerId: params.ownerId,
          importId: params.importId,
          itemId: params.itemId,
          action: "skip",
        }),
      )
      .setLabel("Skip")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(
        buildCollectionSteamImportActionId({
          ownerId: params.ownerId,
          importId: params.importId,
          itemId: params.itemId,
          action: "pause",
        }),
      )
      .setLabel("Pause")
      .setStyle(ButtonStyle.Danger),
  );
}

function buildCsvImportItemButtons(params: {
  ownerId: string;
  importId: number;
  itemId: number;
}): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        buildCollectionCsvImportActionId({
          ownerId: params.ownerId,
          importId: params.importId,
          itemId: params.itemId,
          action: "remap",
        }),
      )
      .setLabel("Search a different title")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(
        buildCollectionCsvImportActionId({
          ownerId: params.ownerId,
          importId: params.importId,
          itemId: params.itemId,
          action: "game-id",
        }),
      )
      .setLabel("Enter GameDB or IGDB ID")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(
        buildCollectionCsvImportActionId({
          ownerId: params.ownerId,
          importId: params.importId,
          itemId: params.itemId,
          action: "skip",
        }),
      )
      .setLabel("Skip")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(
        buildCollectionCsvImportActionId({
          ownerId: params.ownerId,
          importId: params.importId,
          itemId: params.itemId,
          action: "pause",
        }),
      )
      .setLabel("Pause")
      .setStyle(ButtonStyle.Danger),
  );
}

function buildComponentsV2Flags(isEphemeral: boolean): number {
  return (isEphemeral ? MessageFlags.Ephemeral : 0) | COMPONENTS_V2_FLAG;
}

function buildComponentsV2EditFlags(): number {
  return COMPONENTS_V2_FLAG;
}

function resolveMemberLabel(
  member: User | GuildMember | undefined,
  fallback: User,
): string {
  if (!member) return fallback.username;
  if ("displayName" in member && member.displayName) {
    return member.displayName;
  }
  if ("user" in member && member.user?.username) {
    return member.user.username;
  }
  if ("username" in member) {
    return member.username;
  }
  return fallback.username;
}

function normalizePlatformEmojiKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.toLowerCase().trim();
  return normalized.length ? normalized : null;
}

function resolveCollectionOverviewEmoji(params: {
  platformName: string | null;
  platformAbbreviation: string | null;
}): string | null {
  const nameKey = normalizePlatformEmojiKey(params.platformName);
  const resolvedNameKey = nameKey
    ? COLLECTION_OVERVIEW_PLATFORM_EMOJI_KEYS[nameKey]
    : undefined;
  if (resolvedNameKey) {
    return COLLECTION_OVERVIEW_EMOJIS[resolvedNameKey] ?? null;
  }
  const abbrevKey = normalizePlatformEmojiKey(params.platformAbbreviation);
  const resolvedAbbrevKey = abbrevKey
    ? COLLECTION_OVERVIEW_PLATFORM_EMOJI_KEYS[abbrevKey]
    : undefined;
  if (resolvedAbbrevKey) {
    return COLLECTION_OVERVIEW_EMOJIS[resolvedAbbrevKey] ?? null;
  }
  return ":question:";
}

function formatCollectionOverviewPlatformLabel(
  entry: IUserGameCollectionOverviewEntry,
): string {
  const rawName = entry.platformName ??
    entry.platformAbbreviation ??
    COLLECTION_OVERVIEW_UNKNOWN_PLATFORM;
  const displayName = formatPlatformDisplayName(rawName) ?? rawName;
  if (!entry.platformAbbreviation || entry.platformAbbreviation === displayName) {
    return displayName;
  }
  return `${displayName} (${entry.platformAbbreviation})`;
}

function formatCollectionOverviewFixedLabel(label: string, width: number): string {
  return `\`\` ${label.padEnd(width, " ")} \`\``;
}

function formatCollectionOverviewFixedTotal(total: number, width: number): string {
  const formatted = total.toLocaleString("en-US");
  return `\`\` ${formatted.padStart(width, " ")} \`\``;
}

function buildCollectionOverviewSelectId(params: {
  viewerUserId: string;
  targetUserId: string;
  isEphemeral: boolean;
}): string {
  return [
    COLLECTION_OVERVIEW_SELECT_PREFIX,
    params.viewerUserId,
    params.targetUserId,
    params.isEphemeral ? "e" : "p",
  ].join(":");
}

function parseCollectionOverviewSelectId(customId: string): {
  viewerUserId: string;
  targetUserId: string;
  isEphemeral: boolean;
} | null {
  const parts = customId.split(":");
  if (parts.length !== 4) return null;
  if (parts[0] !== COLLECTION_OVERVIEW_SELECT_PREFIX) return null;
  const visibility = parts[3];
  if (visibility !== "e" && visibility !== "p") return null;

  return {
    viewerUserId: parts[1],
    targetUserId: parts[2],
    isEphemeral: visibility === "e",
  };
}

function buildCollectionOverviewSelectValue(platformId: number): string {
  return `${COLLECTION_OVERVIEW_SELECT_PLATFORM_PREFIX}:${platformId}`;
}

function parseCollectionOverviewSelectValue(
  value: string,
): { platformId: number } | "overview" | "all-games" | null {
  if (value === COLLECTION_OVERVIEW_SELECT_OVERVIEW) return "overview";
  if (value === COLLECTION_OVERVIEW_SELECT_ALL_GAMES) return "all-games";
  const [prefix, idRaw] = value.split(":");
  if (prefix !== COLLECTION_OVERVIEW_SELECT_PLATFORM_PREFIX) return null;
  const platformId = Number(idRaw);
  if (!Number.isInteger(platformId) || platformId <= 0) return null;
  return { platformId };
}

function buildCollectionOverviewSelectOptions(
  platformCounts: IUserGameCollectionOverviewEntry[],
): Array<{ label: string; value: string; description: string }> {
  const unique = new Map<number, IUserGameCollectionOverviewEntry>();
  for (const entry of platformCounts) {
    if (!entry.platformId) continue;
    unique.set(entry.platformId, entry);
  }
  const ordered = Array.from(unique.values())
    .map((entry) => ({
      entry,
      label: formatCollectionOverviewPlatformLabel(entry),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const options = [{
    label: "Overview",
    value: COLLECTION_OVERVIEW_SELECT_OVERVIEW,
    description: "Show the summary view",
  }, {
    label: "All games",
    value: COLLECTION_OVERVIEW_SELECT_ALL_GAMES,
    description: "View the full collection list",
  }];

  for (const { entry, label } of ordered) {
    const totalText = entry.total === 1 ? "1 game" : `${entry.total} games`;
    options.push({
      label,
      value: buildCollectionOverviewSelectValue(entry.platformId as number),
      description: totalText,
    });
  }

  return options;
}

async function buildCollectionOverviewResponse(params: {
  viewerUserId: string;
  targetUserId: string;
  memberLabel: string;
  isEphemeral: boolean;
  titleOverride?: string;
}): Promise<Array<ContainerBuilder | ActionRowBuilder<any>>> {
  const isSelf = params.viewerUserId === params.targetUserId;
  const overview = await UserGameCollection.getOverviewForUser(params.targetUserId);
  const title = params.titleOverride ??
    (params.isEphemeral
      ? (isSelf ? "Your collection overview" : `${params.memberLabel} collection overview`)
      : `${params.memberLabel}'s Game Collection`);

  const container = buildCollectionOverviewContainer({
    title,
    totalCount: overview.totalCount,
    platformCounts: overview.platformCounts,
  });

  const options = buildCollectionOverviewSelectOptions(overview.platformCounts);
  if (options.length <= 2) {
    return [container];
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(
      buildCollectionOverviewSelectId({
        viewerUserId: params.viewerUserId,
        targetUserId: params.targetUserId,
        isEphemeral: params.isEphemeral,
      }),
    )
    .setPlaceholder("View collection by platform")
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  return [container, row];
}

function buildCollectionOverviewContainer(params: {
  title: string;
  totalCount: number;
  platformCounts: IUserGameCollectionOverviewEntry[];
}): ContainerBuilder {
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${params.title}`),
  );

  if (params.totalCount <= 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("No collection entries yet."),
    );
    return container;
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `Total games: **${params.totalCount.toLocaleString("en-US")}**`,
    ),
  );

  const platformLabels = params.platformCounts.map((entry) =>
    formatCollectionOverviewPlatformLabel(entry)
  );
  const totals = params.platformCounts.map((entry) => entry.total.toLocaleString("en-US"));
  const labelWidth = platformLabels.length
    ? Math.max(...platformLabels.map((label) => label.length), 8)
    : 8;
  const totalWidth = totals.length
    ? Math.max(...totals.map((value) => value.length), 2)
    : 2;

  for (const entry of params.platformCounts) {
    const emoji = resolveCollectionOverviewEmoji({
      platformName: entry.platformName,
      platformAbbreviation: entry.platformAbbreviation,
    });
    const label = formatCollectionOverviewPlatformLabel(entry);
    const fixedLabel = formatCollectionOverviewFixedLabel(label, labelWidth);
    const fixedTotal = formatCollectionOverviewFixedTotal(entry.total, totalWidth);
    const prefix = emoji ? `${emoji} ` : "";
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${prefix}**${fixedLabel}** ${fixedTotal}`),
    );
  }

  return container;
}

async function buildAllCollectionsOverviewMessages(): Promise<
  Array<{ components: Array<ContainerBuilder> }>
> {
  const overview = await UserGameCollection.getOverviewForAllUsers();
  const containers = buildAllCollectionsSummaryContainers({
    title: "All Game Collections",
    totalCount: overview.totalCount,
    platformCounts: overview.platformCounts,
  });

  const messages: Array<{ components: Array<ContainerBuilder> }> = containers.map((container) => ({
    components: [container],
  }));

  if (!messages.length) {
    messages.push({
      components: [
        buildCollectionOverviewContainer({
          title: "All Game Collections",
          totalCount: 0,
          platformCounts: [],
        }),
      ],
    });
  }

  return messages;
}

function buildAllCollectionsSummaryContainers(params: {
  title: string;
  totalCount: number;
  platformCounts: IUserGameCollectionOverviewEntry[];
}): ContainerBuilder[] {
  const createBaseContainer = (title: string): ContainerBuilder =>
    new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## ${title}`),
    );

  if (params.totalCount <= 0) {
    const empty = createBaseContainer(params.title);
    empty.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("No collection entries yet."),
    );
    return [empty];
  }

  const platformLabels = params.platformCounts.map((entry) =>
    formatCollectionOverviewPlatformLabel(entry)
  );
  const totals = params.platformCounts.map((entry) => entry.total.toLocaleString("en-US"));
  const labelWidth = platformLabels.length
    ? Math.max(...platformLabels.map((label) => label.length), 8)
    : 8;
  const totalWidth = totals.length
    ? Math.max(...totals.map((value) => value.length), 2)
    : 2;

  const lines = params.platformCounts.map((entry) => {
    const emoji = resolveCollectionOverviewEmoji({
      platformName: entry.platformName,
      platformAbbreviation: entry.platformAbbreviation,
    });
    const label = formatCollectionOverviewPlatformLabel(entry);
    const fixedLabel = formatCollectionOverviewFixedLabel(label, labelWidth);
    const fixedTotal = formatCollectionOverviewFixedTotal(entry.total, totalWidth);
    const prefix = emoji ? `${emoji} ` : "";
    return `${prefix}**${fixedLabel}** ${fixedTotal}`;
  });

  const containers: ContainerBuilder[] = [];
  let offset = 0;
  let part = 1;
  while (offset < lines.length) {
    const isFirst = part === 1;
    const title = isFirst ? params.title : `${params.title} (cont. ${part})`;
    const container = createBaseContainer(title);
    if (isFirst) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `Total games: **${params.totalCount.toLocaleString("en-US")}**`,
        ),
      );
    }

    const reserved = isFirst ? 2 : 1;
    const capacity = Math.max(1, COLLECTION_OVERVIEW_MAX_TEXT_COMPONENTS_PER_CONTAINER - reserved);
    const chunk = lines.slice(offset, offset + capacity);
    for (const line of chunk) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(line));
    }

    containers.push(container);
    offset += chunk.length;
    part += 1;
  }

  return containers;
}

type ResolvedCollectionGame =
  | { kind: "resolved"; gameId: number; title: string }
  | { kind: "choose"; titleQuery: string; options: IgdbSelectOption[] };

async function buildCollectionIgdbSelectOptions(results: IGDBGame[]): Promise<IgdbSelectOption[]> {
  const trimmedResults = results.slice(0, 50);
  const platformIds = Array.from(new Set(
    trimmedResults
      .flatMap((game) => game.platforms?.map((platform) => Number(platform.id)) ?? [])
      .filter((id) => Number.isInteger(id) && id > 0),
  ));
  const platformMap = platformIds.length
    ? await Game.getPlatformsByIgdbIds(platformIds)
    : new Map<number, { name: string; abbreviation?: string }>();

  return trimmedResults.map((game) => {
    const year = game.first_release_date
      ? new Date(game.first_release_date * 1000).getFullYear()
      : "TBD";
    const platformText = (game.platforms ?? [])
      .map((platform) => platformMap.get(Number(platform.id)))
      .filter((platform): platform is NonNullable<typeof platform> => Boolean(platform))
      .map((platform) => platform.abbreviation ?? platform.name)
      .slice(0, 3)
      .join(", ");
    const summary = (game.summary ?? "No summary").replace(/\s+/g, " ").trim();
    const description = platformText
      ? `${platformText} | ${summary}`.slice(0, 100)
      : summary.slice(0, 100);
    return {
      id: game.id,
      label: `${game.name} (${year})`.slice(0, 100),
      description,
    };
  });
}

async function resolveCollectionGameForAdd(
  gameIdRaw: string,
): Promise<ResolvedCollectionGame> {
  const numericValue = Number(gameIdRaw);
  if (Number.isInteger(numericValue) && numericValue > 0) {
    const localGame = await Game.getGameById(numericValue);
    if (localGame) {
      return { kind: "resolved", gameId: localGame.id, title: localGame.title };
    }

    // Allow direct IGDB numeric ids when the title is not yet in GameDB.
    const importedById = await Game.importGameFromIgdb(numericValue);
    return { kind: "resolved", gameId: importedById.gameId, title: importedById.title };
  }

  const titleQuery = sanitizeUserInput(gameIdRaw, { preserveNewlines: false }).trim();
  if (!titleQuery) {
    throw new Error("Invalid game selection.");
  }

  const localResults = await Game.searchGames(titleQuery);
  const exactLocal = localResults.find(
    (game) => game.title.toLowerCase() === titleQuery.toLowerCase(),
  );
  if (exactLocal) {
    return { kind: "resolved", gameId: exactLocal.id, title: exactLocal.title };
  }

  const igdbSearch = await igdbService.searchGames(titleQuery, 10);
  if (!igdbSearch.results.length) {
    throw new Error("Could not find that title in GameDB or IGDB.");
  }

  return {
    kind: "choose",
    titleQuery,
    options: await buildCollectionIgdbSelectOptions(igdbSearch.results),
  };
}

function parseCollectionEntryAutocompleteValue(raw: string): number | null {
  const value = raw.trim();
  const match = /^collection:(\d+)$/i.exec(value);
  if (!match) return null;
  const entryId = Number(match[1]);
  if (!Number.isInteger(entryId) || entryId <= 0) return null;
  return entryId;
}

function buildCollectionEntryAutocompleteValue(entryId: number): string {
  return `${COLLECTION_ENTRY_VALUE_PREFIX}:${entryId}`;
}

function formatCollectionEntryAutocompleteName(entry: {
  title: string;
  platformName: string | null;
  ownershipType: CollectionOwnershipType;
}): string {
  const platform = entry.platformName ?? "Unknown platform";
  return `${entry.title} | ${platform} | ${entry.ownershipType}`.slice(0, 100);
}

async function autocompleteCollectionGameTitle(
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
  await interaction.respond(
    results.slice(0, 25).map((game) => ({
      name: formatGameTitleWithYear(game).slice(0, 100),
      value: String(game.id),
    })),
  );
}

async function autocompleteCollectionEntry(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const rawQuery = focused?.value ? String(focused.value) : "";
  const query = sanitizeUserInput(rawQuery, { preserveNewlines: false });

  const results = await UserGameCollection.autocompleteEntries(
    interaction.user.id,
    query,
    25,
  );

  await interaction.respond(
    results.map((entry) => ({
      name: formatCollectionEntryAutocompleteName(entry),
      value: buildCollectionEntryAutocompleteValue(entry.entryId),
    })),
  );
}

function ownershipTypeToCode(value: CollectionOwnershipType | undefined): string {
  if (!value) return "_";
  return value[0]?.toUpperCase() ?? "_";
}

function ownershipCodeToType(code: string): CollectionOwnershipType | undefined {
  if (code === "D") return "Digital";
  if (code === "P") return "Physical";
  if (code === "S") return "Subscription";
  if (code === "O") return "Other";
  return undefined;
}

function nextOwnershipType(
  ownershipType: CollectionOwnershipType | undefined,
): CollectionOwnershipType | undefined {
  if (!ownershipType) return "Digital";
  if (ownershipType === "Digital") return "Physical";
  if (ownershipType === "Physical") return "Subscription";
  if (ownershipType === "Subscription") return "Other";
  return undefined;
}

function buildCollectionListNavId(params: {
  viewerUserId: string;
  targetUserId: string;
  page: number;
  isEphemeral: boolean;
  direction: "prev" | "next";
}): string {
  return [
    COLLECTION_LIST_NAV_PREFIX,
    params.viewerUserId,
    params.targetUserId,
    String(params.page),
    params.isEphemeral ? "e" : "p",
    params.direction,
  ].join(":");
}

function parseCollectionListNavId(customId: string): {
  viewerUserId: string;
  targetUserId: string;
  page: number;
  isEphemeral: boolean;
  direction: "prev" | "next";
} | null {
  const parts = customId.split(":");
  if (parts.length !== 6) return null;
  if (parts[0] !== COLLECTION_LIST_NAV_PREFIX) return null;

  const viewerUserId = parts[1];
  const targetUserId = parts[2];
  const page = Number(parts[3]);
  const visibility = parts[4];
  const direction = parts[5] as "prev" | "next";
  if (!Number.isInteger(page) || page < 0) return null;
  if (visibility !== "e" && visibility !== "p") return null;
  if (direction !== "prev" && direction !== "next") return null;

  return {
    viewerUserId,
    targetUserId,
    page,
    isEphemeral: visibility === "e",
    direction,
  };
}

function buildCollectionFilterActionId(params: {
  viewerUserId: string;
  targetUserId: string;
  isEphemeral: boolean;
  action: "open";
}): string {
  return [
    COLLECTION_LIST_FILTER_PREFIX,
    params.viewerUserId,
    params.targetUserId,
    params.isEphemeral ? "e" : "p",
    params.action,
  ].join(":");
}

function parseCollectionFilterActionId(customId: string): {
  viewerUserId: string;
  targetUserId: string;
  isEphemeral: boolean;
  action: "open";
} | null {
  const parts = customId.split(":");
  if (parts.length !== 5) return null;
  if (parts[0] !== COLLECTION_LIST_FILTER_PREFIX) return null;
  const visibility = parts[3];
  const action = parts[4] as "open";
  if (visibility !== "e" && visibility !== "p") return null;
  if (action !== "open") return null;

  return {
    viewerUserId: parts[1],
    targetUserId: parts[2],
    isEphemeral: visibility === "e",
    action,
  };
}

function encodeFilterPanelAction(action: "text" | "ownership" | "apply" | "clear" | "cancel"): string {
  if (action === "text") return "t";
  if (action === "ownership") return "o";
  if (action === "apply") return "a";
  if (action === "clear") return "c";
  return "x";
}

function decodeFilterPanelAction(code: string): "text" | "ownership" | "apply" | "clear" | "cancel" | null {
  if (code === "t") return "text";
  if (code === "o") return "ownership";
  if (code === "a") return "apply";
  if (code === "c") return "clear";
  if (code === "x") return "cancel";
  return null;
}

function buildCollectionFilterPanelActionId(params: {
  viewerUserId: string;
  targetUserId: string;
  sourceMessageId: string;
  isEphemeral: boolean;
  action: "text" | "ownership" | "apply" | "clear" | "cancel";
}): string {
  return [
    COLLECTION_LIST_FILTER_PANEL_PREFIX,
    params.viewerUserId,
    params.targetUserId,
    params.sourceMessageId,
    params.isEphemeral ? "e" : "p",
    encodeFilterPanelAction(params.action),
  ].join(":");
}

function parseCollectionFilterPanelActionId(customId: string): {
  viewerUserId: string;
  targetUserId: string;
  sourceMessageId: string;
  isEphemeral: boolean;
  action: "text" | "ownership" | "apply" | "clear" | "cancel";
} | null {
  const parts = customId.split(":");
  if (parts.length !== 6) return null;
  if (parts[0] !== COLLECTION_LIST_FILTER_PANEL_PREFIX) return null;
  const visibility = parts[4];
  const action = decodeFilterPanelAction(parts[5]);
  if (visibility !== "e" && visibility !== "p") return null;
  if (!action) return null;

  return {
    viewerUserId: parts[1],
    targetUserId: parts[2],
    sourceMessageId: parts[3],
    isEphemeral: visibility === "e",
    action,
  };
}

function buildCollectionFilterModalId(params: {
  viewerUserId: string;
  targetUserId: string;
  sourceMessageId: string;
  isEphemeral: boolean;
  ownershipCode: string;
}): string {
  return [
    COLLECTION_LIST_FILTER_MODAL_PREFIX,
    params.viewerUserId,
    params.targetUserId,
    params.sourceMessageId,
    params.isEphemeral ? "e" : "p",
    params.ownershipCode,
  ].join(":");
}

function parseCollectionFilterModalId(customId: string): {
  viewerUserId: string;
  targetUserId: string;
  sourceMessageId: string;
  isEphemeral: boolean;
  ownershipType: CollectionOwnershipType | undefined;
} | null {
  const parts = customId.split(":");
  if (parts.length !== 6) return null;
  if (parts[0] !== COLLECTION_LIST_FILTER_MODAL_PREFIX) return null;
  const visibility = parts[4];
  if (visibility !== "e" && visibility !== "p") return null;
  return {
    viewerUserId: parts[1],
    targetUserId: parts[2],
    sourceMessageId: parts[3],
    isEphemeral: visibility === "e",
    ownershipType: ownershipCodeToType(parts[5]),
  };
}

function buildCollectionFilterPanelContent(params: {
  title: string | undefined;
  platform: string | undefined;
  ownershipType: CollectionOwnershipType | undefined;
}): string {
  const titleText = params.title ?? "(any)";
  const platformText = params.platform ?? "(any)";
  const ownershipText = params.ownershipType ?? "(any)";
  return (
    "### Filter collection results\n" +
    `> Title: ${titleText}\n` +
    `> Platform: ${platformText}\n` +
    `> Ownership: ${ownershipText}\n\n` +
    "Use **Edit Text** for title/platform, then **Apply**."
  );
}

function buildCollectionFilterPanelComponents(params: {
  viewerUserId: string;
  targetUserId: string;
  sourceMessageId: string;
  isEphemeral: boolean;
  ownershipType: CollectionOwnershipType | undefined;
}): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          buildCollectionFilterPanelActionId({
            viewerUserId: params.viewerUserId,
            targetUserId: params.targetUserId,
            sourceMessageId: params.sourceMessageId,
            isEphemeral: params.isEphemeral,
            action: "text",
          }),
        )
        .setLabel("Edit Text")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(
          buildCollectionFilterPanelActionId({
            viewerUserId: params.viewerUserId,
            targetUserId: params.targetUserId,
            sourceMessageId: params.sourceMessageId,
            isEphemeral: params.isEphemeral,
            action: "ownership",
          }),
        )
        .setLabel(`Ownership: ${params.ownershipType ?? "Any"}`)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(
          buildCollectionFilterPanelActionId({
            viewerUserId: params.viewerUserId,
            targetUserId: params.targetUserId,
            sourceMessageId: params.sourceMessageId,
            isEphemeral: params.isEphemeral,
            action: "apply",
          }),
        )
        .setLabel("Apply")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(
          buildCollectionFilterPanelActionId({
            viewerUserId: params.viewerUserId,
            targetUserId: params.targetUserId,
            sourceMessageId: params.sourceMessageId,
            isEphemeral: params.isEphemeral,
            action: "clear",
          }),
        )
        .setLabel("Clear")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(
          buildCollectionFilterPanelActionId({
            viewerUserId: params.viewerUserId,
            targetUserId: params.targetUserId,
            sourceMessageId: params.sourceMessageId,
            isEphemeral: params.isEphemeral,
            action: "cancel",
          }),
        )
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

function parseCollectionFilterStateFromContent(content: string): {
  title: string | undefined;
  platform: string | undefined;
  ownershipType: CollectionOwnershipType | undefined;
} {
  const getValue = (label: "Title" | "Platform" | "Ownership"): string | undefined => {
    const match = content.match(new RegExp(`> ${label}:\\s*(.+)$`, "mi"));
    const value = match?.[1]?.trim();
    if (!value || value === "(any)") return undefined;
    return value;
  };

  const ownershipRaw = getValue("Ownership");
  const ownershipType = ownershipRaw === "Digital" ||
      ownershipRaw === "Physical" ||
      ownershipRaw === "Subscription" ||
      ownershipRaw === "Other"
    ? ownershipRaw
    : undefined;

  return {
    title: getValue("Title"),
    platform: getValue("Platform"),
    ownershipType,
  };
}

function collectTextDisplayContent(components: any[] | undefined, output: string[]): void {
  if (!components?.length) return;
  for (const component of components) {
    if (component && typeof component.content === "string") {
      output.push(component.content);
    }
    if (Array.isArray(component?.components)) {
      collectTextDisplayContent(component.components, output);
    }
  }
}

function extractOverviewTitleFromMessage(message: any): string | null {
  const textBlocks: string[] = [];
  collectTextDisplayContent(message?.components, textBlocks);
  const headerBlock = textBlocks.find((value) => value.trim().startsWith("## "));
  if (!headerBlock) return null;
  const firstLine = headerBlock.split("\n")[0]?.trim();
  if (!firstLine?.startsWith("## ")) return null;
  return firstLine.replace(/^##\s*/, "").trim() || null;
}

function resolveMemberLabelFromOverviewTitle(title: string, fallback: string): string {
  if (!title) return fallback;
  if (title === "Your collection overview" || title === "Your game collection") {
    return fallback;
  }
  const match = title.match(/^(.*)'s Game Collection$/);
  if (match?.[1]?.trim()) {
    return match[1].trim();
  }
  const overviewMatch = title.match(/^(.*) collection overview$/i);
  if (overviewMatch?.[1]?.trim()) {
    return overviewMatch[1].trim();
  }
  return fallback;
}

function parseCollectionFiltersFromListMessage(message: any): {
  title: string | undefined;
  platform: string | undefined;
  platformId: number | undefined;
  ownershipType: CollectionOwnershipType | undefined;
} {
  const textBlocks: string[] = [];
  collectTextDisplayContent(message?.components, textBlocks);
  const filterBlock = textBlocks.find((value) => value.includes("Filters:") || value.includes("**Filters**"));
  if (!filterBlock) {
    return {
      title: undefined,
      platform: undefined,
      platformId: undefined,
      ownershipType: undefined,
    };
  }

  const titleMatch = filterBlock.match(/title~([^|\n]+)/i);
  const platformMatch = filterBlock.match(/platform~([^|\n]+)/i);
  const platformIdMatch = filterBlock.match(/platform-id=(\d+)/i);
  const platformId = platformIdMatch
    ? Number(platformIdMatch[1])
    : undefined;
  const ownershipMatch = filterBlock.match(/ownership=([A-Za-z]+)/i);
  const ownershipType = ownershipMatch?.[1] === "Digital" ||
      ownershipMatch?.[1] === "Physical" ||
      ownershipMatch?.[1] === "Subscription" ||
      ownershipMatch?.[1] === "Other"
    ? (ownershipMatch[1] as CollectionOwnershipType)
    : undefined;

  return {
    title: titleMatch?.[1]?.trim() || undefined,
    platform: platformMatch?.[1]?.trim() || undefined,
    platformId: Number.isInteger(platformId) && (platformId as number) > 0
      ? platformId
      : undefined,
    ownershipType,
  };
}

async function buildCollectionThumbnails(
  entries: Array<{ gameId: number }>,
): Promise<Map<number, string>> {
  const thumbnailsByGameId = new Map<number, string>();
  for (const entry of entries) {
    if (thumbnailsByGameId.has(entry.gameId)) continue;
    const game = await Game.getGameById(entry.gameId);
    if (!game?.igdbId) continue;
    try {
      const details = await igdbService.getGameDetails(game.igdbId);
      const imageId = details?.cover?.image_id ?? null;
      if (!imageId) continue;
      thumbnailsByGameId.set(
        entry.gameId,
        `https://images.igdb.com/igdb/image/upload/t_cover_big/${imageId}.jpg`,
      );
    } catch {
      // ignore thumbnail failures and continue rendering text rows
    }
  }
  return thumbnailsByGameId;
}

async function buildCollectionListResponse(params: {
  viewerUserId: string;
  targetUserId: string;
  memberLabel: string;
  title: string | undefined;
  platform: string | undefined;
  platformId: number | undefined;
  platformLabel: string | undefined;
  ownershipType: CollectionOwnershipType | undefined;
  page: number;
  isEphemeral: boolean;
}): Promise<{
  components: Array<ContainerBuilder | ActionRowBuilder<any>>;
  content?: string;
}> {
  const entries = await UserGameCollection.searchEntries({
    targetUserId: params.targetUserId,
    title: params.title,
    platform: params.platform,
    platformId: params.platformId,
    ownershipType: params.ownershipType,
  });

  const total = entries.length;
  if (!total) {
    return {
      content: params.targetUserId === params.viewerUserId
        ? "No collection entries matched your filters."
        : "No collection entries matched your filters for that member.",
      components: [],
    };
  }

  const pageCount = Math.max(1, Math.ceil(total / COLLECTION_LIST_PAGE_SIZE));
  const safePage = Math.min(Math.max(params.page, 0), pageCount - 1);
  const start = safePage * COLLECTION_LIST_PAGE_SIZE;
  const pageEntries = entries.slice(start, start + COLLECTION_LIST_PAGE_SIZE);

  const headerTitle = params.targetUserId === params.viewerUserId
    ? (params.isEphemeral ? "Your game collection" : `${params.memberLabel}'s Game Collection`)
    : `${params.memberLabel}'s Game Collection`;
  const filtersText = [
    params.title ? `title~${params.title}` : null,
    params.platformLabel ? `platform~${params.platformLabel}` : null,
    params.platformId ? `platform-id=${params.platformId}` : null,
    params.ownershipType ? `ownership=${params.ownershipType}` : null,
  ].filter(Boolean).join(" | ");
  const thumbnailsByGameId = await buildCollectionThumbnails(pageEntries);
  const components: Array<ContainerBuilder | ActionRowBuilder<any>> = [];

  const contentContainer = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(safeV2TextContent(`## ${headerTitle}`, 250)),
  );
  for (const entry of pageEntries) {
    const platform = entry.platformName ?? "Unknown platform";
    const noteLine = entry.note ? `\n> Note: ${entry.note}` : "";
    const sectionText = safeV2TextContent(
      `### ${entry.title}\n` +
      `> Platform: ${platform}\n` +
      `> Ownership: ${entry.ownershipType}\n` +
      `> Added: ${formatTableDate(entry.createdAt)}${noteLine}`,
      1000,
    );
    const section = new SectionBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(sectionText),
    );
    const thumb = thumbnailsByGameId.get(entry.gameId);
    if (thumb) {
      try {
        section.setThumbnailAccessory(new ThumbnailBuilder().setURL(thumb));
        section.toJSON();
      } catch {
        // Ignore invalid thumbnail payloads and keep text-only section rendering.
      }
    }
    contentContainer.addSectionComponents(section);
  }
  const footerParts = [`Page ${safePage + 1}/${pageCount}`, `${total} total entries`];
  if (filtersText) {
    footerParts.push(`Filters: ${filtersText}`);
  }
  contentContainer.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(safeV2TextContent(`-# ${footerParts.join(" | ")}`, 1000)),
  );
  components.push(contentContainer);

  const row = new ActionRowBuilder<ButtonBuilder>();
  if (pageCount > 1) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(
          buildCollectionListNavId({
            viewerUserId: params.viewerUserId,
            targetUserId: params.targetUserId,
            page: safePage,
            isEphemeral: params.isEphemeral,
            direction: "prev",
          }),
        )
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage <= 0),
      new ButtonBuilder()
        .setCustomId(
          buildCollectionListNavId({
            viewerUserId: params.viewerUserId,
            targetUserId: params.targetUserId,
            page: safePage,
            isEphemeral: params.isEphemeral,
            direction: "next",
          }),
        )
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage >= pageCount - 1),
    );
  }

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(
        buildCollectionFilterActionId({
          viewerUserId: params.viewerUserId,
          targetUserId: params.targetUserId,
          isEphemeral: params.isEphemeral,
          action: "open",
        }),
      )
      .setLabel("Filter Results")
      .setStyle(ButtonStyle.Primary),
  );
  components.push(row);

  return { components };
}

async function applyFiltersToSourceMessage(params: {
  interaction: ButtonInteraction;
  sourceMessageId: string;
  viewerUserId: string;
  targetUserId: string;
  isEphemeral: boolean;
  title: string | undefined;
  platform: string | undefined;
  ownershipType: CollectionOwnershipType | undefined;
}): Promise<boolean> {
  const channel = params.interaction.channel;
  if (!channel || !("messages" in channel)) {
    return false;
  }

  const memberLabel = params.targetUserId === params.viewerUserId
    ? params.interaction.user.username
    : "Member";
  const response = await buildCollectionListResponse({
    viewerUserId: params.viewerUserId,
    targetUserId: params.targetUserId,
    memberLabel,
    title: params.title,
    platform: params.platform,
    platformId: undefined,
    platformLabel: params.platform,
    ownershipType: params.ownershipType,
    page: 0,
    isEphemeral: params.isEphemeral,
  });

  const sourceMessage = await (channel as any).messages.fetch(params.sourceMessageId).catch(() => null);
  if (!sourceMessage) {
    return false;
  }

  if (response.content) {
    await sourceMessage.edit({
      content: response.content,
      components: [],
    });
    return true;
  }

  await sourceMessage.edit({
    content: null,
    components: response.components,
  });
  return true;
}

async function closeFilterPanel(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferUpdate().catch(() => {});
  await (interaction.message as any)?.delete?.().catch(() => {});
}

@Discord()
@SlashGroup({ name: "collection", description: "Manage your owned game collection" })
@SlashGroup("collection")
export class CollectionCommand {
  private async applySteamImportSelection(params: {
    ownerId: string;
    gameId: number;
    itemId: number;
    steamAppId: number;
    reason: "AUTO_MATCH" | "MANUAL_REMAP";
  }): Promise<void> {
    const steamPlatformId = await resolveGameCompletionPlatformId("steam");
    const platformId = steamPlatformId ?? null;
    const platformWarning = steamPlatformId ? null : "Steam platform id not found; imported without platform.";

    try {
      const created = await UserGameCollection.addEntry({
        userId: params.ownerId,
        gameId: params.gameId,
        platformId,
        ownershipType: "Digital",
      });
      await updateSteamCollectionImportItem(params.itemId, {
        status: "ADDED",
        gameDbGameId: params.gameId,
        collectionEntryId: created.entryId,
        matchConfidence: params.reason === "MANUAL_REMAP" ? "MANUAL" : undefined,
        resultReason: steamPlatformId ? params.reason : "PLATFORM_UNRESOLVED",
        errorText: platformWarning,
      });
      await upsertSteamAppGameDbMap({
        steamAppId: params.steamAppId,
        gameDbGameId: params.gameId,
        status: "MAPPED",
        createdBy: params.ownerId,
      });
    } catch (error: any) {
      const message = String(error?.message ?? "");
      const isDuplicate = /already exists/i.test(message);
      await updateSteamCollectionImportItem(params.itemId, {
        status: isDuplicate ? "SKIPPED" : "FAILED",
        gameDbGameId: params.gameId,
        matchConfidence: params.reason === "MANUAL_REMAP" ? "MANUAL" : undefined,
        resultReason: isDuplicate ? "DUPLICATE" : "ADD_FAILED",
        errorText: message || "Failed to add collection entry.",
      });
      if (isDuplicate) {
        await upsertSteamAppGameDbMap({
          steamAppId: params.steamAppId,
          gameDbGameId: params.gameId,
          status: "MAPPED",
          createdBy: params.ownerId,
        });
      }
    }
  }

  private async renderNextSteamImportItem(
    interaction:
      | CommandInteraction
      | ButtonInteraction
      | StringSelectMenuInteraction
      | ModalSubmitInteraction,
    importId: number,
    ownerId: string,
  ): Promise<void> {
    const shouldUseInteractionUpdate = (interaction.isButton() || interaction.isStringSelectMenu()) &&
      !interaction.deferred &&
      !interaction.replied;
    const shouldUseModalUpdate = interaction.isModalSubmit();

    const session = await getSteamCollectionImportById(importId);
    if (!session || session.userId !== ownerId) {
      const payload = {
        content: null,
        components: [buildImportTextContainer("This Steam import session no longer exists.")],
        flags: buildComponentsV2Flags(true),
      };
      if (shouldUseInteractionUpdate || shouldUseModalUpdate) {
        await safeUpdate(interaction, payload);
      } else {
        await interaction.editReply(payload);
      }
      return;
    }

    if (session.status !== "ACTIVE") {
      const payload = {
        content: null,
        components: [buildImportTextContainer(
          `Steam import #${session.importId} is ${session.status.toLowerCase()}.`,
        )],
        flags: buildComponentsV2Flags(true),
      };
      if (shouldUseInteractionUpdate || shouldUseModalUpdate) {
        await safeUpdate(interaction, payload);
      } else {
        await interaction.editReply(payload);
      }
      return;
    }

    const nextItem = await getNextPendingSteamCollectionImportItem(session.importId);
    if (!nextItem) {
      await setSteamCollectionImportStatus(session.importId, "COMPLETED");
      const stats = await countSteamCollectionImportItems(session.importId);
      const reasonCounts = await countSteamCollectionImportResultReasons(session.importId);
      logSteamImportEvent("completed", {
        userId: ownerId,
        importId: session.importId,
        added: stats.added,
        updated: stats.updated,
        skipped: stats.skipped,
        failed: stats.failed,
      });
      const reasonLines = buildSteamImportReasonSummary(reasonCounts);
      const done = [
        `## Steam Import #${session.importId}`,
        "Import completed.",
        `Added: ${stats.added}`,
        `Updated: ${stats.updated}`,
        `Skipped: ${stats.skipped}`,
        `Failed: ${stats.failed}`,
        ...(reasonLines.length ? ["", `Reasons: ${reasonLines.join(" | ")}`] : []),
      ].join("\n");
      const payload = {
        content: null,
        components: [buildImportTextContainer(done)],
        flags: buildComponentsV2Flags(true),
      };
      if (shouldUseInteractionUpdate || shouldUseModalUpdate) {
        await safeUpdate(interaction, payload);
      } else {
        await interaction.editReply(payload);
      }
      return;
    }

    await updateSteamCollectionImportIndex(session.importId, nextItem.rowIndex);
    let candidates = parseImportCandidates(nextItem.matchCandidateJson);
    let igdbComponents: ActionRowBuilder<any>[] | null = null;
    let igdbHasResults = false;
    if (!candidates.length) {
      const mapped = await getSteamAppGameDbMapByAppId(nextItem.steamAppId);
      if (mapped?.status === "MAPPED" && mapped.gameDbGameId) {
        const mappedGame = await Game.getGameById(mapped.gameDbGameId);
        if (mappedGame) {
          candidates = [{ gameId: mappedGame.id, title: mappedGame.title }];
        }
      }
      if (!candidates.length && mapped?.status !== "SKIPPED") {
        candidates = await buildImportCandidates(nextItem.steamAppName);
      }

      if (candidates.length > 1) {
        const historicalGameIds = await getSteamAppHistoricalMappedGameIds({
          steamAppId: nextItem.steamAppId,
          excludeUserId: ownerId,
          limit: 5,
        });
        if (historicalGameIds.length) {
          const historicalCandidates = await buildImportCandidatesFromMappedIds(historicalGameIds);
          candidates = dedupeImportCandidates([...candidates, ...historicalCandidates]);
        }
      }
      const matchConfidence = buildImportMatchConfidence(nextItem.steamAppName, candidates);
      await updateSteamCollectionImportItem(nextItem.itemId, {
        matchCandidateJson: candidates.length ? JSON.stringify(candidates) : null,
        matchConfidence,
        resultReason: !candidates.length && mapped?.status === "SKIPPED" ? "SKIP_MAPPED" : null,
      });
    }

    try {
      const igdbResults = await searchIgdbWithProgressiveTitleVariants(nextItem.steamAppName, 10);
      igdbHasResults = igdbResults.length > 0;
      const options = igdbHasResults
        ? await buildCollectionIgdbSelectOptions(igdbResults)
        : [];
      const igdbSession = createIgdbSession(
        ownerId,
        options,
        async (selectionInteraction, igdbId) => {
          const currentSession = await getSteamCollectionImportById(session.importId);
          if (!currentSession || currentSession.userId !== ownerId || currentSession.status !== "ACTIVE") {
            await selectionInteraction.followUp({
              content: "This Steam import session is no longer active.",
              flags: MessageFlags.Ephemeral,
            }).catch(() => {});
            return;
          }

          const currentItem = await getSteamCollectionImportItemById(nextItem.itemId);
          if (
            !currentItem ||
            currentItem.importId !== session.importId ||
            currentItem.status !== "PENDING"
          ) {
            await selectionInteraction.followUp({
              content: "This import row is no longer pending.",
              flags: MessageFlags.Ephemeral,
            }).catch(() => {});
            return;
          }

          try {
            const imported = await Game.importGameFromIgdb(igdbId);
            await updateSteamCollectionImportItem(currentItem.itemId, {
              matchCandidateJson: JSON.stringify([{
                gameId: imported.gameId,
                title: imported.title,
              } satisfies ImportCandidate]),
              matchConfidence: "MANUAL",
            });

            await this.applySteamImportSelection({
              ownerId,
              gameId: imported.gameId,
              itemId: currentItem.itemId,
              steamAppId: currentItem.steamAppId,
              reason: "MANUAL_REMAP",
            });
            logSteamImportEvent("item_igdb_imported", {
              userId: ownerId,
              importId: session.importId,
              itemId: currentItem.itemId,
              steamAppId: currentItem.steamAppId,
              gameDbGameId: imported.gameId,
            });
          } catch (error: any) {
            await updateSteamCollectionImportItem(currentItem.itemId, {
              resultReason: "ADD_FAILED",
              errorText: error?.message ?? "Failed to import title from IGDB.",
            });
          }

          await this.renderNextSteamImportItem(
            selectionInteraction,
            session.importId,
            ownerId,
          );
        },
        undefined,
        `No IGDB matches found for "${nextItem.steamAppName}". Try Search a different title.`,
      );
      igdbComponents = igdbSession.components;
    } catch {
      // if IGDB lookup fails, continue with regular actions
      const igdbSession = createIgdbSession(
        ownerId,
        [],
        async () => {},
        undefined,
        `No IGDB matches found for "${nextItem.steamAppName}". Try Search a different title.`,
      );
      igdbComponents = igdbSession.components;
    }

    const [steamReleaseYear, steamHeaderImageUrl] = await Promise.all([
      steamApiService.getAppReleaseYear(nextItem.steamAppId),
      steamApiService.getAppHeaderImageUrl(nextItem.steamAppId),
    ]);
    const singleExactCandidate = candidates.length === 1 &&
      isExactImportTitleMatch(nextItem.steamAppName, candidates[0].title)
      ? candidates[0]
      : null;
    if (singleExactCandidate) {
      await this.applySteamImportSelection({
        ownerId,
        gameId: singleExactCandidate.gameId,
        itemId: nextItem.itemId,
        steamAppId: nextItem.steamAppId,
        reason: "AUTO_MATCH",
      });
      logSteamImportEvent("item_auto_accepted_exact", {
        userId: ownerId,
        importId: session.importId,
        itemId: nextItem.itemId,
        steamAppId: nextItem.steamAppId,
        gameDbGameId: singleExactCandidate.gameId,
      });
      await this.renderNextSteamImportItem(interaction, session.importId, ownerId);
      return;
    }
    const content = buildSteamImportItemMessage({
      importId: session.importId,
      rowIndex: nextItem.rowIndex,
      totalCount: session.totalCount,
      steamAppName: nextItem.steamAppName,
      steamAppId: nextItem.steamAppId,
      steamReleaseYear,
    });
    const guidance = candidates.length > 1
      ? "Ambiguous match. Use Choose to select the right GameDB title."
      : candidates.length === 1
        ? "Single match found. Use Choose to confirm import."
        : "No matches yet. Use Search a different title to search again or Skip.";
    const helpText = "Use **Choose**, or choose **Search a different title**, **Enter GameDB or IGDB ID**, " +
      "**Skip**, or **Pause**.";
    const controlsRow = buildSteamImportItemButtons({
      ownerId,
      importId: session.importId,
      itemId: nextItem.itemId,
    });
    const contentContainer = buildImportMessageContainer({
      content,
      thumbnailUrl: steamHeaderImageUrl,
      logPrefix: "SteamImport",
      logMeta: {
        importId: session.importId,
        itemId: nextItem.itemId,
        rowIndex: nextItem.rowIndex,
      },
    });
    const candidatesContainer = await buildImportCandidatesContainer({
      ownerId,
      importId: session.importId,
      itemId: nextItem.itemId,
      headerText: "### GameDB Match Candidates",
      headerHelpText: candidates.length > 1 ? guidance : null,
      candidates,
      buildChooseCustomId: buildCollectionSteamChooseId,
      logPrefix: "SteamImport",
    });
    const igdbContainer = buildImportIgdbContainer({
      searchTitle: nextItem.steamAppName,
      igdbRows: igdbComponents ?? [],
      noResultsText: igdbHasResults
        ? null
        : "No IGDB matches found for this title. Try Search a different title.",
    });
    const actionsContainer = buildImportActionsContainer({
      helpText,
      controlRow: controlsRow,
    });
    const components = [contentContainer, candidatesContainer, igdbContainer, actionsContainer];
    logImportComponentDiagnostics({
      importId: session.importId,
      itemId: nextItem.itemId,
      rowIndex: nextItem.rowIndex,
      components,
      logPrefix: "SteamImport",
      logEvent: logSteamImportEvent,
    });

    try {
      if (shouldUseInteractionUpdate || shouldUseModalUpdate) {
        await safeUpdate(interaction, {
          content: null,
          components,
          flags: buildComponentsV2Flags(true),
        });
        return;
      }
      await interaction.editReply({
        content: null,
        components,
        flags: buildComponentsV2Flags(true),
      });
    } catch (error) {
      const messages = flattenErrorMessages(error);
      logSteamImportEvent("render_failed", {
        importId: session.importId,
        itemId: nextItem.itemId,
        rowIndex: nextItem.rowIndex,
      });
      console.error(
        "[SteamImport] message render failed",
        JSON.stringify({
          importId: session.importId,
          itemId: nextItem.itemId,
          rowIndex: nextItem.rowIndex,
          steamAppId: nextItem.steamAppId,
          steamAppName: nextItem.steamAppName,
          candidateCount: candidates.length,
          messages,
        }),
      );
      throw error;
    }
  }

  private async applyCsvImportSelection(params: {
    ownerId: string;
    item: ICollectionCsvImportItem;
    gameId: number;
    reason: "AUTO_MATCH" | "MANUAL_REMAP" | "CSV_GAMEDB_ID" | "CSV_IGDB_ID";
  }): Promise<void> {
    const platformId = params.item.platformId ?? null;
    const platformWarning = !platformId && params.item.rawPlatform
      ? "Platform not recognized; imported without platform."
      : null;
    const ownershipType = params.item.ownershipType ?? "Digital";
    const note = params.item.note ?? null;
    const matchConfidence = params.reason === "AUTO_MATCH" ? "EXACT" : "MANUAL";

    try {
      const created = await UserGameCollection.addEntry({
        userId: params.ownerId,
        gameId: params.gameId,
        platformId,
        ownershipType,
        note,
      });
      await updateCollectionCsvImportItem(params.item.itemId, {
        status: "ADDED",
        gameDbGameId: params.gameId,
        collectionEntryId: created.entryId,
        matchConfidence,
        resultReason: platformWarning ? "PLATFORM_UNRESOLVED" : params.reason,
        errorText: platformWarning,
      });
    } catch (error: any) {
      const message = String(error?.message ?? "");
      const isDuplicate = /already exists/i.test(message);
      await updateCollectionCsvImportItem(params.item.itemId, {
        status: isDuplicate ? "SKIPPED" : "FAILED",
        gameDbGameId: params.gameId,
        matchConfidence,
        resultReason: isDuplicate ? "DUPLICATE" : "ADD_FAILED",
        errorText: message || "Failed to add collection entry.",
      });
    }
  }

  private async renderNextCsvImportItem(
    interaction:
      | CommandInteraction
      | ButtonInteraction
      | StringSelectMenuInteraction
      | ModalSubmitInteraction,
    importId: number,
    ownerId: string,
  ): Promise<void> {
    const shouldUseInteractionUpdate = (interaction.isButton() || interaction.isStringSelectMenu()) &&
      !interaction.deferred &&
      !interaction.replied;
    const shouldUseModalUpdate = interaction.isModalSubmit();

    const session = await getCollectionCsvImportById(importId);
    if (!session || session.userId !== ownerId) {
      const payload = {
        content: null,
        components: [buildImportTextContainer("This CSV import session no longer exists.")],
        flags: buildComponentsV2Flags(true),
      };
      if (shouldUseInteractionUpdate || shouldUseModalUpdate) {
        await safeUpdate(interaction, payload);
      } else {
        await interaction.editReply(payload);
      }
      return;
    }

    if (session.status !== "ACTIVE") {
      const payload = {
        content: null,
        components: [buildImportTextContainer(
          `CSV import #${session.importId} is ${session.status.toLowerCase()}.`,
        )],
        flags: buildComponentsV2Flags(true),
      };
      if (shouldUseInteractionUpdate || shouldUseModalUpdate) {
        await safeUpdate(interaction, payload);
      } else {
        await interaction.editReply(payload);
      }
      return;
    }

    const nextItem = await getNextPendingCollectionCsvImportItem(session.importId);
    if (!nextItem) {
      await setCollectionCsvImportStatus(session.importId, "COMPLETED");
      const stats = await countCollectionCsvImportItems(session.importId);
      const reasonCounts = await countCollectionCsvImportResultReasons(session.importId);
      logCsvImportEvent("completed", {
        userId: ownerId,
        importId: session.importId,
        added: stats.added,
        updated: stats.updated,
        skipped: stats.skipped,
        failed: stats.failed,
      });
      const reasonLines = buildImportReasonSummary(reasonCounts, CSV_IMPORT_REASON_LABELS);
      const done = [
        `## CSV Import #${session.importId}`,
        "Import completed.",
        `Added: ${stats.added}`,
        `Updated: ${stats.updated}`,
        `Skipped: ${stats.skipped}`,
        `Failed: ${stats.failed}`,
        ...(reasonLines.length ? ["", `Reasons: ${reasonLines.join(" | ")}`] : []),
      ].join("\n");
      const payload = {
        content: null,
        components: [buildImportTextContainer(done)],
        flags: buildComponentsV2Flags(true),
      };
      if (shouldUseInteractionUpdate || shouldUseModalUpdate) {
        await safeUpdate(interaction, payload);
      } else {
        await interaction.editReply(payload);
      }
      return;
    }

    await updateCollectionCsvImportIndex(session.importId, nextItem.rowIndex);

    if (nextItem.rawGameDbId) {
      const game = await Game.getGameById(nextItem.rawGameDbId);
      if (!game) {
        await updateCollectionCsvImportItem(nextItem.itemId, {
          status: "FAILED",
          resultReason: "INVALID_ROW",
          errorText: `GameDB id ${nextItem.rawGameDbId} was not found.`,
        });
        await this.renderNextCsvImportItem(interaction, session.importId, ownerId);
        return;
      }
      await this.applyCsvImportSelection({
        ownerId,
        item: nextItem,
        gameId: game.id,
        reason: "CSV_GAMEDB_ID",
      });
      logCsvImportEvent("item_csv_gamedb_id", {
        userId: ownerId,
        importId: session.importId,
        itemId: nextItem.itemId,
        gameDbGameId: game.id,
      });
      await this.renderNextCsvImportItem(interaction, session.importId, ownerId);
      return;
    }

    if (nextItem.rawIgdbId) {
      try {
        const imported = await Game.importGameFromIgdb(nextItem.rawIgdbId);
        await this.applyCsvImportSelection({
          ownerId,
          item: nextItem,
          gameId: imported.gameId,
          reason: "CSV_IGDB_ID",
        });
        logCsvImportEvent("item_csv_igdb_id", {
          userId: ownerId,
          importId: session.importId,
          itemId: nextItem.itemId,
          igdbId: nextItem.rawIgdbId,
          gameDbGameId: imported.gameId,
        });
      } catch (error: any) {
        await updateCollectionCsvImportItem(nextItem.itemId, {
          status: "FAILED",
          resultReason: "INVALID_ROW",
          errorText: error?.message ?? "Failed to import IGDB id.",
        });
      }
      await this.renderNextCsvImportItem(interaction, session.importId, ownerId);
      return;
    }

    let candidates = parseImportCandidates(nextItem.matchCandidateJson);
    let igdbComponents: ActionRowBuilder<any>[] | null = null;
    let igdbHasResults = false;
    if (!candidates.length) {
      candidates = await buildImportCandidates(nextItem.rawTitle);
      const matchConfidence = buildImportMatchConfidence(nextItem.rawTitle, candidates);
      await updateCollectionCsvImportItem(nextItem.itemId, {
        matchCandidateJson: candidates.length ? JSON.stringify(candidates) : null,
        matchConfidence,
      });
    }

    try {
      const igdbResults = await searchIgdbWithProgressiveTitleVariants(nextItem.rawTitle, 10);
      igdbHasResults = igdbResults.length > 0;
      const options = igdbHasResults
        ? await buildCollectionIgdbSelectOptions(igdbResults)
        : [];
      const igdbSession = createIgdbSession(
        ownerId,
        options,
        async (selectionInteraction, igdbId) => {
          const currentSession = await getCollectionCsvImportById(session.importId);
          if (!currentSession || currentSession.userId !== ownerId || currentSession.status !== "ACTIVE") {
            await selectionInteraction.followUp({
              content: "This CSV import session is no longer active.",
              flags: MessageFlags.Ephemeral,
            }).catch(() => {});
            return;
          }

          const currentItem = await getCollectionCsvImportItemById(nextItem.itemId);
          if (
            !currentItem ||
            currentItem.importId !== session.importId ||
            currentItem.status !== "PENDING"
          ) {
            await selectionInteraction.followUp({
              content: "This import row is no longer pending.",
              flags: MessageFlags.Ephemeral,
            }).catch(() => {});
            return;
          }

          try {
            const imported = await Game.importGameFromIgdb(igdbId);
            await updateCollectionCsvImportItem(currentItem.itemId, {
              matchCandidateJson: JSON.stringify([{
                gameId: imported.gameId,
                title: imported.title,
              } satisfies ImportCandidate]),
              matchConfidence: "MANUAL",
            });

            await this.applyCsvImportSelection({
              ownerId,
              item: currentItem,
              gameId: imported.gameId,
              reason: "MANUAL_REMAP",
            });
            logCsvImportEvent("item_igdb_imported", {
              userId: ownerId,
              importId: session.importId,
              itemId: currentItem.itemId,
              gameDbGameId: imported.gameId,
            });
          } catch (error: any) {
            await updateCollectionCsvImportItem(currentItem.itemId, {
              resultReason: "ADD_FAILED",
              errorText: error?.message ?? "Failed to import title from IGDB.",
            });
          }

          await this.renderNextCsvImportItem(
            selectionInteraction,
            session.importId,
            ownerId,
          );
        },
        undefined,
        `No IGDB matches found for "${nextItem.rawTitle}". Try Search a different title.`,
      );
      igdbComponents = igdbSession.components;
    } catch {
      const igdbSession = createIgdbSession(
        ownerId,
        [],
        async () => {},
        undefined,
        `No IGDB matches found for "${nextItem.rawTitle}". Try Search a different title.`,
      );
      igdbComponents = igdbSession.components;
    }

    const singleExactCandidate = candidates.length === 1 &&
      isExactImportTitleMatch(nextItem.rawTitle, candidates[0].title)
      ? candidates[0]
      : null;
    if (singleExactCandidate) {
      await this.applyCsvImportSelection({
        ownerId,
        item: nextItem,
        gameId: singleExactCandidate.gameId,
        reason: "AUTO_MATCH",
      });
      logCsvImportEvent("item_auto_accepted_exact", {
        userId: ownerId,
        importId: session.importId,
        itemId: nextItem.itemId,
        gameDbGameId: singleExactCandidate.gameId,
      });
      await this.renderNextCsvImportItem(interaction, session.importId, ownerId);
      return;
    }

    const platformLabel = nextItem.platformId
      ? await resolveGameCompletionPlatformLabel(nextItem.platformId)
      : nextItem.rawPlatform ?? "No platform";
    const content = buildCsvImportItemMessage({
      importId: session.importId,
      rowIndex: nextItem.rowIndex,
      totalCount: session.totalCount,
      title: nextItem.rawTitle,
      platformLabel,
      ownershipType: nextItem.ownershipType ?? "Digital",
      note: nextItem.note,
      sourceGameDbId: nextItem.rawGameDbId,
      sourceIgdbId: nextItem.rawIgdbId,
    });
    const guidance = candidates.length > 1
      ? "Ambiguous match. Use Choose to select the right GameDB title."
      : candidates.length === 1
        ? "Single match found. Use Choose to confirm import."
        : "No matches yet. Use Search a different title to search again or Skip.";
    const helpText = "Use **Choose**, or choose **Search a different title**, **Enter GameDB or IGDB ID**, " +
      "**Skip**, or **Pause**.";
    const controlsRow = buildCsvImportItemButtons({
      ownerId,
      importId: session.importId,
      itemId: nextItem.itemId,
    });
    const contentContainer = buildImportMessageContainer({
      content,
      thumbnailUrl: null,
      logPrefix: "CsvImport",
      logMeta: {
        importId: session.importId,
        itemId: nextItem.itemId,
        rowIndex: nextItem.rowIndex,
      },
    });
    const candidatesContainer = await buildImportCandidatesContainer({
      ownerId,
      importId: session.importId,
      itemId: nextItem.itemId,
      headerText: "### GameDB Match Candidates",
      headerHelpText: candidates.length > 1 ? guidance : null,
      candidates,
      buildChooseCustomId: buildCollectionCsvChooseId,
      logPrefix: "CsvImport",
    });
    const igdbContainer = buildImportIgdbContainer({
      searchTitle: nextItem.rawTitle,
      igdbRows: igdbComponents ?? [],
      noResultsText: igdbHasResults
        ? null
        : "No IGDB matches found for this title. Try Search a different title.",
    });
    const actionsContainer = buildImportActionsContainer({
      helpText,
      controlRow: controlsRow,
    });
    const components = [contentContainer, candidatesContainer, igdbContainer, actionsContainer];
    logImportComponentDiagnostics({
      importId: session.importId,
      itemId: nextItem.itemId,
      rowIndex: nextItem.rowIndex,
      components,
      logPrefix: "CsvImport",
      logEvent: logCsvImportEvent,
    });

    try {
      if (shouldUseInteractionUpdate || shouldUseModalUpdate) {
        await safeUpdate(interaction, {
          content: null,
          components,
          flags: buildComponentsV2Flags(true),
        });
        return;
      }
      await interaction.editReply({
        content: null,
        components,
        flags: buildComponentsV2Flags(true),
      });
    } catch (error) {
      const messages = flattenErrorMessages(error);
      logCsvImportEvent("render_failed", {
        importId: session.importId,
        itemId: nextItem.itemId,
        rowIndex: nextItem.rowIndex,
      });
      console.error(
        "[CsvImport] message render failed",
        JSON.stringify({
          importId: session.importId,
          itemId: nextItem.itemId,
          rowIndex: nextItem.rowIndex,
          candidateCount: candidates.length,
          messages,
        }),
      );
      throw error;
    }
  }

  @Slash({ name: "import-steam", description: "Import your collection from Steam" })
  async steamImport(
    @SlashChoice(
      ...IMPORT_ACTIONS.map((value) => ({
        name: value,
        value,
      })),
    )
    @SlashOption({
      name: "action",
      description: "Steam import action",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    action: ImportAction,
    @SlashOption({
      name: "steam_profile",
      description: "Steam profile URL, vanity name, or SteamID64",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    steamProfile: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        content: "This command can only be used inside a server.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    await handleImportActionCommand({
      interaction,
      action,
      onStart: async () => {
        const existing = await getActiveSteamCollectionImportForUser(interaction.user.id);
        if (existing) {
          await interaction.editReply(
            `You already have import #${existing.importId} (${existing.status}). ` +
            "Use action:resume, action:status, action:pause, or action:cancel.",
          );
          return;
        }

        const identifierInput = steamProfile
          ? sanitizeUserInput(steamProfile, { preserveNewlines: false }).trim()
          : "";
        let identifier = identifierInput;
        if (!identifier) {
          const memberRecord = await Member.getByUserId(interaction.user.id);
          identifier = memberRecord?.steamUrl?.trim() ?? "";
        }

        if (!identifier) {
          await interaction.editReply(
            "Add your Steam profile first:\n" +
            "1. Set it once with `/profile edit steam:<url>`\n" +
            "2. Then run `/collection import-steam action:start`\n" +
            "Or include it now with `steam_profile:<url|vanity|steamid64>`.",
          );
          return;
        }

        try {
          const resolved = await steamApiService.resolveProfileIdentifier(identifier);
          const library = await steamApiService.getOwnedGames(resolved.steamId64);

          if (!library.games.length) {
            await interaction.editReply(
              "No Steam games were found. Ensure your profile and game details are public.",
            );
            return;
          }

          const session = await createSteamCollectionImportSession({
            userId: interaction.user.id,
            totalCount: library.games.length,
            steamId64: resolved.steamId64,
            steamProfileRef: identifier,
            sourceProfileName: library.profileName,
          });

          await insertSteamCollectionImportItems(
            session.importId,
            library.games.map((game, index) => ({
              rowIndex: index + 1,
              steamAppId: game.appId,
              steamAppName: game.name,
              playtimeForeverMin: game.playtimeForeverMinutes,
              playtimeWindowsMin: game.playtimeWindowsMinutes,
              playtimeMacMin: game.playtimeMacMinutes,
              playtimeLinuxMin: game.playtimeLinuxMinutes,
              playtimeDeckMin: game.playtimeDeckMinutes,
              lastPlayedAt: game.lastPlayedAt,
            })),
          );
          logSteamImportEvent("started", {
            userId: interaction.user.id,
            importId: session.importId,
            steamId64: resolved.steamId64,
            total: library.gameCount,
          });

          await interaction.editReply(
            `Steam import #${session.importId} created for **${library.gameCount}** games ` +
            `(${library.profileName ?? resolved.steamId64}). Starting review now.`,
          );
          await this.renderNextSteamImportItem(interaction, session.importId, interaction.user.id);
        } catch (error: any) {
          logSteamImportEvent("start_failed", {
            userId: interaction.user.id,
            error: String(error?.message ?? "unknown"),
          });
          if (error instanceof SteamApiError) {
            await interaction.editReply(error.message);
            return;
          }
          await interaction.editReply(
            error?.message ?? "Failed to start Steam import. Verify profile and try again.",
          );
        }
      },
      getActiveSession: (userId: string) => getActiveSteamCollectionImportForUser(userId),
      onMissingSession: async () => {
        await interaction.editReply("No active Steam import session found.");
      },
      onStatus: async (session) => {
        const stats = await countSteamCollectionImportItems(session.importId);
        const reasonCounts = await countSteamCollectionImportResultReasons(session.importId);
        const reasonLines = buildSteamImportReasonSummary(reasonCounts);
        const embed = new EmbedBuilder()
          .setTitle(`Steam Collection Import #${session.importId}`)
          .setDescription(`Status: ${session.status}`)
          .addFields(
            { name: "Pending", value: String(stats.pending), inline: true },
            { name: "Added", value: String(stats.added), inline: true },
            { name: "Updated", value: String(stats.updated), inline: true },
            { name: "Skipped", value: String(stats.skipped), inline: true },
            { name: "Failed", value: String(stats.failed), inline: true },
          );
        if (reasonLines.length) {
          embed.addFields({
            name: "Reason breakdown",
            value: reasonLines.join(" | ").slice(0, 1024),
          });
        }
        await interaction.editReply({ embeds: [embed] });
      },
      onPause: async (session) => {
        await setSteamCollectionImportStatus(session.importId, "PAUSED");
        const stats = await countSteamCollectionImportItems(session.importId);
        logSteamImportEvent("paused", {
          userId: interaction.user.id,
          importId: session.importId,
          pending: stats.pending,
        });
        await interaction.editReply(
          `Steam import #${session.importId} paused. ` +
          `Pending ${stats.pending}, Added ${stats.added}, Updated ${stats.updated}, ` +
          `Skipped ${stats.skipped}, Failed ${stats.failed}.`,
        );
      },
      onCancel: async (session) => {
        await setSteamCollectionImportStatus(session.importId, "CANCELED");
        const stats = await countSteamCollectionImportItems(session.importId);
        logSteamImportEvent("canceled", {
          userId: interaction.user.id,
          importId: session.importId,
          pending: stats.pending,
        });
        await interaction.editReply(
          `Steam import #${session.importId} canceled. ` +
          `Pending ${stats.pending}, Added ${stats.added}, Updated ${stats.updated}, ` +
          `Skipped ${stats.skipped}, Failed ${stats.failed}.`,
        );
      },
      onResume: async (session) => {
        await setSteamCollectionImportStatus(session.importId, "ACTIVE");
        await interaction.editReply(
          `Steam import #${session.importId} resumed.`,
        );
        logSteamImportEvent("resumed", {
          userId: interaction.user.id,
          importId: session.importId,
        });
        await this.renderNextSteamImportItem(interaction, session.importId, interaction.user.id);
      },
    });
  }

  @Slash({ name: "import-csv", description: "Import your collection from a custom CSV template" })
  async csvImport(
    @SlashChoice(
      ...IMPORT_ACTIONS.map((value) => ({
        name: value,
        value,
      })),
    )
    @SlashOption({
      name: "action",
      description: "CSV import action",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    action: ImportAction,
    @SlashOption({
      name: "file",
      description: "CSV file exported from the collection template (required for start)",
      type: ApplicationCommandOptionType.Attachment,
      required: false,
    })
    file: Attachment | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        content: "This command can only be used inside a server.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    await handleImportActionCommand<ICollectionCsvImport>({
      interaction,
      action,
      onStart: async () => {
        const existing = await getActiveCollectionCsvImportForUser(interaction.user.id);
        if (existing) {
          await interaction.editReply(
            `You already have import #${existing.importId} (${existing.status}). ` +
            "Use action:resume, action:status, action:pause, or action:cancel.",
          );
          return;
        }

        if (!file) {
          const template = await buildCollectionCsvTemplateAttachment();
          await interaction.editReply({
            content: [
              "### Custom CSV Collection Import",
              "Download the attached Excel template and fill in your rows.",
              "Required column: `title`.",
              "Optional columns: `platform`, `ownership_type`, `note`, `gamedb_id`, `igdb_id`.",
              `Delete the example row marked "${COLLECTION_CSV_EXAMPLE_NOTE}" before exporting to CSV.`,
              "Then upload the CSV with `/collection import-csv action:start file:<csv>`.",
              "Duplicates are detected by game, platform, and ownership type.",
            ].join("\n"),
            files: [template],
          });
          return;
        }

        const isCsv = file.name?.toLowerCase().endsWith(".csv") ||
          file.contentType?.toLowerCase().includes("csv");
        if (!isCsv) {
          const template = await buildCollectionCsvTemplateAttachment();
          await interaction.editReply({
            content: "The uploaded file is not a CSV. Use the attached template and export to CSV.",
            files: [template],
          });
          return;
        }

        const csvText = await fetchCsvAttachment(file);
        if (!csvText) {
          await interaction.editReply("Failed to download the CSV file. Please try again.");
          return;
        }

        const parsed = await parseCollectionCsvImportText(csvText);
        if (parsed.errors.length) {
          const lines = parsed.errors
            .slice(0, 12)
            .map((error) =>
              `- Row ${error.rowIndex}, ${error.column}: ${error.message}`,
            );
          if (parsed.errors.length > 12) {
            lines.push(`- ...and ${parsed.errors.length - 12} more`);
          }
          const template = await buildCollectionCsvTemplateAttachment();
          await interaction.editReply({
            content: [
              "CSV validation failed. Fix the following issues and try again.",
              "",
              ...lines,
            ].join("\n"),
            files: [template],
          });
          return;
        }

        if (!parsed.rows.length) {
          await interaction.editReply("CSV file contains no importable rows.");
          return;
        }

        const session = await createCollectionCsvImportSession({
          userId: interaction.user.id,
          totalCount: parsed.rows.length,
          sourceFileName: file.name ?? null,
          sourceFileSize: typeof file.size === "number" ? file.size : null,
          templateVersion: COLLECTION_CSV_TEMPLATE_VERSION,
        });
        await insertCollectionCsvImportItems(
          session.importId,
          parsed.rows.map((row) => ({
            rowIndex: row.rowIndex,
            rawTitle: row.title,
            rawPlatform: row.platformRaw,
            rawOwnershipType: row.ownershipRaw,
            rawNote: row.noteRaw,
            rawGameDbId: row.sourceGameDbId,
            rawIgdbId: row.sourceIgdbId,
            platformId: row.platformId,
            ownershipType: row.ownershipType,
            note: row.note,
          })),
        );
        logCsvImportEvent("started", {
          userId: interaction.user.id,
          importId: session.importId,
          total: parsed.rows.length,
        });

        await interaction.editReply(
          `CSV import #${session.importId} created for **${parsed.rows.length}** rows. ` +
          "Starting review now.",
        );
        await this.renderNextCsvImportItem(interaction, session.importId, interaction.user.id);
      },
      getActiveSession: (userId: string) => getActiveCollectionCsvImportForUser(userId),
      onMissingSession: async () => {
        await interaction.editReply("No active CSV import session found.");
      },
      onStatus: async (session) => {
        const stats = await countCollectionCsvImportItems(session.importId);
        const reasonCounts = await countCollectionCsvImportResultReasons(session.importId);
        const reasonLines = buildImportReasonSummary(reasonCounts, CSV_IMPORT_REASON_LABELS);
        const embed = new EmbedBuilder()
          .setTitle(`CSV Collection Import #${session.importId}`)
          .setDescription(`Status: ${session.status}`)
          .addFields(
            { name: "Pending", value: String(stats.pending), inline: true },
            { name: "Added", value: String(stats.added), inline: true },
            { name: "Updated", value: String(stats.updated), inline: true },
            { name: "Skipped", value: String(stats.skipped), inline: true },
            { name: "Failed", value: String(stats.failed), inline: true },
          );
        if (reasonLines.length) {
          embed.addFields({
            name: "Reason breakdown",
            value: reasonLines.join(" | ").slice(0, 1024),
          });
        }
        await interaction.editReply({ embeds: [embed] });
      },
      onPause: async (session) => {
        await setCollectionCsvImportStatus(session.importId, "PAUSED");
        const stats = await countCollectionCsvImportItems(session.importId);
        logCsvImportEvent("paused", {
          userId: interaction.user.id,
          importId: session.importId,
          pending: stats.pending,
        });
        await interaction.editReply(
          `CSV import #${session.importId} paused. ` +
          `Pending ${stats.pending}, Added ${stats.added}, Updated ${stats.updated}, ` +
          `Skipped ${stats.skipped}, Failed ${stats.failed}.`,
        );
      },
      onCancel: async (session) => {
        await setCollectionCsvImportStatus(session.importId, "CANCELED");
        const stats = await countCollectionCsvImportItems(session.importId);
        logCsvImportEvent("canceled", {
          userId: interaction.user.id,
          importId: session.importId,
          pending: stats.pending,
        });
        await interaction.editReply(
          `CSV import #${session.importId} canceled. ` +
          `Pending ${stats.pending}, Added ${stats.added}, Updated ${stats.updated}, ` +
          `Skipped ${stats.skipped}, Failed ${stats.failed}.`,
        );
      },
      onResume: async (session) => {
        await setCollectionCsvImportStatus(session.importId, "ACTIVE");
        await interaction.editReply(
          `CSV import #${session.importId} resumed.`,
        );
        logCsvImportEvent("resumed", {
          userId: interaction.user.id,
          importId: session.importId,
        });
        await this.renderNextCsvImportItem(interaction, session.importId, interaction.user.id);
      },
    });
  }

  @ButtonComponent({
    id: /^collection-steam-import-v1:[^:]+:\d+:\d+:[srpi]$/,
  })
  async onSteamImportAction(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseCollectionSteamImportActionId(interaction.customId);
    if (!parsed) {
      await interaction.reply({
        content: "This Steam import control is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.ownerId) {
      await interaction.reply({
        content: "This Steam import control is not for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const session = await getSteamCollectionImportById(parsed.importId);
    if (!session || session.userId !== parsed.ownerId) {
      await safeUpdate(interaction, {
        content: null,
        components: [buildImportTextContainer("This Steam import session no longer exists.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    if (session.status !== "ACTIVE") {
      await safeUpdate(interaction, {
        content: null,
        components: [buildImportTextContainer(
          `Steam import #${session.importId} is ${session.status.toLowerCase()}.`,
        )],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const item = await getNextPendingSteamCollectionImportItem(session.importId);
    if (!item || item.itemId !== parsed.itemId) {
      await interaction.deferUpdate().catch(() => {});
      await this.renderNextSteamImportItem(interaction, session.importId, parsed.ownerId);
      return;
    }

    if (parsed.action === "pause") {
      await setSteamCollectionImportStatus(session.importId, "PAUSED");
      await safeUpdate(interaction, {
        content: null,
        components: [buildImportTextContainer(
          `Steam import #${session.importId} paused. ` +
          "Use `/collection import-steam action:resume` to continue.",
        )],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (parsed.action === "skip") {
      await interaction.deferUpdate().catch(() => {});
      await updateSteamCollectionImportItem(item.itemId, {
        status: "SKIPPED",
        resultReason: "MANUAL_SKIP",
        errorText: "Skipped by user.",
      });
      logSteamImportEvent("item_skipped", {
        userId: parsed.ownerId,
        importId: session.importId,
        itemId: item.itemId,
        steamAppId: item.steamAppId,
      });
      await upsertSteamAppGameDbMap({
        steamAppId: item.steamAppId,
        gameDbGameId: null,
        status: "SKIPPED",
        createdBy: parsed.ownerId,
      });
      await this.renderNextSteamImportItem(interaction, session.importId, parsed.ownerId);
      return;
    }

    if (parsed.action === "remap") {
      const modal = new ModalBuilder()
        .setCustomId(
          buildCollectionSteamRemapModalId({
            ownerId: parsed.ownerId,
            importId: session.importId,
            itemId: item.itemId,
          }),
        )
        .setTitle("Steam import remap");

      const remapInput = new TextInputBuilder()
        .setCustomId(COLLECTION_STEAM_REMAP_INPUT_ID)
        .setLabel("Search title")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(120)
        .setValue(item.steamAppName.slice(0, 120))
        .setPlaceholder("Call of Duty Classic");

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(remapInput),
      );
      await interaction.showModal(modal).catch(() => {});
      return;
    }

    if (parsed.action === "game-id") {
      const modal = new ModalBuilder()
        .setCustomId(
          buildCollectionSteamGameIdModalId({
            ownerId: parsed.ownerId,
            importId: session.importId,
            itemId: item.itemId,
          }),
        )
        .setTitle("Steam import: Enter GameDB ID");

      const gameIdInput = new TextInputBuilder()
        .setCustomId(COLLECTION_STEAM_GAME_ID_INPUT_ID)
        .setLabel("GameDB ID (or IGDB numeric ID)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(20)
        .setPlaceholder("12345");

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(gameIdInput),
      );
      await interaction.showModal(modal).catch(() => {});
      return;
    }
  }

  @ButtonComponent({
    id: /^collection-steam-choose-v1:[^:]+:\d+:\d+:\d+$/,
  })
  async onSteamImportChoose(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseCollectionSteamChooseButtonId(interaction.customId);
    if (!parsed) {
      await interaction.reply({
        content: "This Steam import choice is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.ownerId) {
      await interaction.reply({
        content: "This Steam import choice is not for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const session = await getSteamCollectionImportById(parsed.importId);
    if (!session || session.userId !== parsed.ownerId || session.status !== "ACTIVE") {
      await safeUpdate(interaction, {
        content: null,
        components: [buildImportTextContainer("This Steam import session is no longer active.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const item = await getNextPendingSteamCollectionImportItem(session.importId);
    if (!item || item.itemId !== parsed.itemId) {
      await interaction.deferUpdate().catch(() => {});
      await this.renderNextSteamImportItem(interaction, session.importId, parsed.ownerId);
      return;
    }

    await interaction.deferUpdate().catch(() => {});
    await this.applySteamImportSelection({
      ownerId: parsed.ownerId,
      gameId: parsed.gameId,
      itemId: item.itemId,
      steamAppId: item.steamAppId,
      reason: "MANUAL_REMAP",
    });
    logSteamImportEvent("item_selected", {
      userId: parsed.ownerId,
      importId: session.importId,
      itemId: item.itemId,
      steamAppId: item.steamAppId,
      gameDbGameId: parsed.gameId,
    });

    await this.renderNextSteamImportItem(interaction, session.importId, parsed.ownerId);
  }

  @ModalComponent({
    id: /^collection-steam-remap-v1:[^:]+:\d+:\d+$/,
  })
  async onSteamImportRemapModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseCollectionSteamRemapModalId(interaction.customId);
    if (!parsed) {
      await interaction.reply({
        content: "This remap form is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.ownerId) {
      await interaction.reply({
        content: "This remap form is not for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const session = await getSteamCollectionImportById(parsed.importId);
    if (!session || session.userId !== parsed.ownerId || session.status !== "ACTIVE") {
      await interaction.reply({
        content: "This Steam import session is no longer active.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const item = await getNextPendingSteamCollectionImportItem(session.importId);
    if (!item || item.itemId !== parsed.itemId) {
      await safeUpdate(interaction, {
        content: "This import row is no longer pending.",
        components: [],
      });
      return;
    }

    const gameIdRaw = sanitizeUserInput(
      interaction.fields.getTextInputValue(COLLECTION_STEAM_REMAP_INPUT_ID) ?? "",
      { preserveNewlines: false, maxLength: 120 },
    );
    const remapTitle = gameIdRaw.trim();
    if (!remapTitle) {
      await updateSteamCollectionImportItem(item.itemId, {
        resultReason: "INVALID_REMAP",
      });
      await safeUpdate(interaction, {
        content: "Enter a title to search for remap.",
        components: [],
      });
      return;
    }

    const remapCandidates = await buildImportCandidates(remapTitle);
    if (!remapCandidates.length) {
      await updateSteamCollectionImportItem(item.itemId, {
        matchCandidateJson: null,
        matchConfidence: null,
        resultReason: "NO_CANDIDATE",
        errorText: `No candidates found for remap search "${remapTitle}".`,
      });
      await safeUpdate(interaction, {
        content:
          `No GameDB matches found for "${remapTitle}". ` +
          "Use Search a different title to try another title or Skip.",
        components: [buildSteamImportItemButtons({
          ownerId: parsed.ownerId,
          importId: session.importId,
          itemId: item.itemId,
        })],
      });
      return;
    }

    const remapMatchConfidence = buildImportMatchConfidence(remapTitle, remapCandidates);
    await updateSteamCollectionImportItem(item.itemId, {
      matchCandidateJson: JSON.stringify(remapCandidates),
      matchConfidence: remapMatchConfidence,
      resultReason: null,
      errorText: null,
    });
    logSteamImportEvent("item_remapped", {
      userId: parsed.ownerId,
      importId: session.importId,
      itemId: item.itemId,
      steamAppId: item.steamAppId,
      candidateCount: remapCandidates.length,
    });

    await this.renderNextSteamImportItem(interaction, session.importId, parsed.ownerId);
  }

  @ModalComponent({
    id: /^collection-steam-game-id-v1:[^:]+:\d+:\d+$/,
  })
  async onSteamImportGameIdModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseCollectionSteamGameIdModalId(interaction.customId);
    if (!parsed) {
      await interaction.reply({
        content: "This GameDB ID form is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.ownerId) {
      await interaction.reply({
        content: "This GameDB ID form is not for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const session = await getSteamCollectionImportById(parsed.importId);
    if (!session || session.userId !== parsed.ownerId || session.status !== "ACTIVE") {
      await interaction.reply({
        content: "This Steam import session is no longer active.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const item = await getNextPendingSteamCollectionImportItem(session.importId);
    if (!item || item.itemId !== parsed.itemId) {
      await safeUpdate(interaction, {
        content: "This import row is no longer pending.",
        components: [],
      });
      return;
    }

    const gameIdRaw = sanitizeUserInput(
      interaction.fields.getTextInputValue(COLLECTION_STEAM_GAME_ID_INPUT_ID) ?? "",
      { preserveNewlines: false, maxLength: 20 },
    ).trim();
    const enteredId = Number(gameIdRaw);
    if (!Number.isInteger(enteredId) || enteredId <= 0) {
      await safeUpdate(interaction, {
        content: "Game ID must be a positive integer.",
        components: [],
      });
      return;
    }

    let resolvedGameId: number | null = null;
    let source: "gamedb" | "igdb" | null = null;

    const game = await Game.getGameById(enteredId);
    if (game) {
      resolvedGameId = game.id;
      source = "gamedb";
    } else {
      try {
        const imported = await Game.importGameFromIgdb(enteredId);
        resolvedGameId = imported.gameId;
        source = "igdb";
      } catch {
        resolvedGameId = null;
      }
    }

    if (!resolvedGameId) {
      await safeUpdate(interaction, {
        content: `Could not find or import game ID ${enteredId}.`,
        components: [],
      });
      return;
    }

    await this.applySteamImportSelection({
      ownerId: parsed.ownerId,
      gameId: resolvedGameId,
      itemId: item.itemId,
      steamAppId: item.steamAppId,
      reason: "MANUAL_REMAP",
    });
    logSteamImportEvent("item_selected_by_game_id", {
      userId: parsed.ownerId,
      importId: session.importId,
      itemId: item.itemId,
      steamAppId: item.steamAppId,
      gameDbGameId: resolvedGameId,
      source: source ?? "unknown",
    });

    await this.renderNextSteamImportItem(interaction, session.importId, parsed.ownerId);
  }

  @ButtonComponent({
    id: /^collection-csv-import-v1:[^:]+:\d+:\d+:[srpi]$/,
  })
  async onCsvImportAction(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseCollectionCsvImportActionId(interaction.customId);
    if (!parsed) {
      await interaction.reply({
        content: "This CSV import control is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.ownerId) {
      await interaction.reply({
        content: "This CSV import control is not for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const session = await getCollectionCsvImportById(parsed.importId);
    if (!session || session.userId !== parsed.ownerId) {
      await safeUpdate(interaction, {
        content: null,
        components: [buildImportTextContainer("This CSV import session no longer exists.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    if (session.status !== "ACTIVE") {
      await safeUpdate(interaction, {
        content: null,
        components: [buildImportTextContainer(
          `CSV import #${session.importId} is ${session.status.toLowerCase()}.`,
        )],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const item = await getNextPendingCollectionCsvImportItem(session.importId);
    if (!item || item.itemId !== parsed.itemId) {
      await interaction.deferUpdate().catch(() => {});
      await this.renderNextCsvImportItem(interaction, session.importId, parsed.ownerId);
      return;
    }

    if (parsed.action === "pause") {
      await setCollectionCsvImportStatus(session.importId, "PAUSED");
      await safeUpdate(interaction, {
        content: null,
        components: [buildImportTextContainer(
          `CSV import #${session.importId} paused. ` +
          "Use `/collection import-csv action:resume` to continue.",
        )],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (parsed.action === "skip") {
      await interaction.deferUpdate().catch(() => {});
      await updateCollectionCsvImportItem(item.itemId, {
        status: "SKIPPED",
        resultReason: "MANUAL_SKIP",
        errorText: "Skipped by user.",
      });
      logCsvImportEvent("item_skipped", {
        userId: parsed.ownerId,
        importId: session.importId,
        itemId: item.itemId,
      });
      await this.renderNextCsvImportItem(interaction, session.importId, parsed.ownerId);
      return;
    }

    if (parsed.action === "remap") {
      const modal = new ModalBuilder()
        .setCustomId(
          buildCollectionCsvRemapModalId({
            ownerId: parsed.ownerId,
            importId: session.importId,
            itemId: item.itemId,
          }),
        )
        .setTitle("CSV import remap");

      const remapInput = new TextInputBuilder()
        .setCustomId(COLLECTION_CSV_REMAP_INPUT_ID)
        .setLabel("Search title")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(120)
        .setValue(item.rawTitle.slice(0, 120))
        .setPlaceholder("Call of Duty Classic");

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(remapInput),
      );
      await interaction.showModal(modal).catch(() => {});
      return;
    }

    if (parsed.action === "game-id") {
      const modal = new ModalBuilder()
        .setCustomId(
          buildCollectionCsvGameIdModalId({
            ownerId: parsed.ownerId,
            importId: session.importId,
            itemId: item.itemId,
          }),
        )
        .setTitle("CSV import: Enter GameDB ID");

      const gameIdInput = new TextInputBuilder()
        .setCustomId(COLLECTION_CSV_GAME_ID_INPUT_ID)
        .setLabel("GameDB ID (or IGDB numeric ID)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(20)
        .setPlaceholder("12345");

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(gameIdInput),
      );
      await interaction.showModal(modal).catch(() => {});
      return;
    }
  }

  @ButtonComponent({
    id: /^collection-csv-choose-v1:[^:]+:\d+:\d+:\d+$/,
  })
  async onCsvImportChoose(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseCollectionCsvChooseButtonId(interaction.customId);
    if (!parsed) {
      await interaction.reply({
        content: "This CSV import choice is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.ownerId) {
      await interaction.reply({
        content: "This CSV import choice is not for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const session = await getCollectionCsvImportById(parsed.importId);
    if (!session || session.userId !== parsed.ownerId || session.status !== "ACTIVE") {
      await safeUpdate(interaction, {
        content: null,
        components: [buildImportTextContainer("This CSV import session is no longer active.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const item = await getNextPendingCollectionCsvImportItem(session.importId);
    if (!item || item.itemId !== parsed.itemId) {
      await interaction.deferUpdate().catch(() => {});
      await this.renderNextCsvImportItem(interaction, session.importId, parsed.ownerId);
      return;
    }

    await interaction.deferUpdate().catch(() => {});
    await this.applyCsvImportSelection({
      ownerId: parsed.ownerId,
      item,
      gameId: parsed.gameId,
      reason: "MANUAL_REMAP",
    });
    logCsvImportEvent("item_selected", {
      userId: parsed.ownerId,
      importId: session.importId,
      itemId: item.itemId,
      gameDbGameId: parsed.gameId,
    });

    await this.renderNextCsvImportItem(interaction, session.importId, parsed.ownerId);
  }

  @ModalComponent({
    id: /^collection-csv-remap-v1:[^:]+:\d+:\d+$/,
  })
  async onCsvImportRemapModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseCollectionCsvRemapModalId(interaction.customId);
    if (!parsed) {
      await interaction.reply({
        content: "This remap form is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.ownerId) {
      await interaction.reply({
        content: "This remap form is not for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const session = await getCollectionCsvImportById(parsed.importId);
    if (!session || session.userId !== parsed.ownerId || session.status !== "ACTIVE") {
      await interaction.reply({
        content: "This CSV import session is no longer active.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const item = await getNextPendingCollectionCsvImportItem(session.importId);
    if (!item || item.itemId !== parsed.itemId) {
      await safeUpdate(interaction, {
        content: "This import row is no longer pending.",
        components: [],
      });
      return;
    }

    const gameIdRaw = sanitizeUserInput(
      interaction.fields.getTextInputValue(COLLECTION_CSV_REMAP_INPUT_ID) ?? "",
      { preserveNewlines: false, maxLength: 120 },
    );
    const remapTitle = gameIdRaw.trim();
    if (!remapTitle) {
      await updateCollectionCsvImportItem(item.itemId, {
        resultReason: "INVALID_REMAP",
      });
      await safeUpdate(interaction, {
        content: "Enter a title to search for remap.",
        components: [],
      });
      return;
    }

    const remapCandidates = await buildImportCandidates(remapTitle);
    if (!remapCandidates.length) {
      await updateCollectionCsvImportItem(item.itemId, {
        matchCandidateJson: null,
        matchConfidence: null,
        resultReason: "NO_CANDIDATE",
        errorText: `No candidates found for remap search "${remapTitle}".`,
      });
      await safeUpdate(interaction, {
        content:
          `No GameDB matches found for "${remapTitle}". ` +
          "Use Search a different title to try another title or Skip.",
        components: [buildCsvImportItemButtons({
          ownerId: parsed.ownerId,
          importId: session.importId,
          itemId: item.itemId,
        })],
      });
      return;
    }

    const remapMatchConfidence = buildImportMatchConfidence(remapTitle, remapCandidates);
    await updateCollectionCsvImportItem(item.itemId, {
      matchCandidateJson: JSON.stringify(remapCandidates),
      matchConfidence: remapMatchConfidence,
      resultReason: null,
      errorText: null,
    });
    logCsvImportEvent("item_remapped", {
      userId: parsed.ownerId,
      importId: session.importId,
      itemId: item.itemId,
      candidateCount: remapCandidates.length,
    });

    await this.renderNextCsvImportItem(interaction, session.importId, parsed.ownerId);
  }

  @ModalComponent({
    id: /^collection-csv-game-id-v1:[^:]+:\d+:\d+$/,
  })
  async onCsvImportGameIdModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseCollectionCsvGameIdModalId(interaction.customId);
    if (!parsed) {
      await interaction.reply({
        content: "This GameDB ID form is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.ownerId) {
      await interaction.reply({
        content: "This GameDB ID form is not for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const session = await getCollectionCsvImportById(parsed.importId);
    if (!session || session.userId !== parsed.ownerId || session.status !== "ACTIVE") {
      await interaction.reply({
        content: "This CSV import session is no longer active.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const item = await getNextPendingCollectionCsvImportItem(session.importId);
    if (!item || item.itemId !== parsed.itemId) {
      await safeUpdate(interaction, {
        content: "This import row is no longer pending.",
        components: [],
      });
      return;
    }

    const gameIdRaw = sanitizeUserInput(
      interaction.fields.getTextInputValue(COLLECTION_CSV_GAME_ID_INPUT_ID) ?? "",
      { preserveNewlines: false, maxLength: 20 },
    ).trim();
    const enteredId = Number(gameIdRaw);
    if (!Number.isInteger(enteredId) || enteredId <= 0) {
      await safeUpdate(interaction, {
        content: "Game ID must be a positive integer.",
        components: [],
      });
      return;
    }

    let resolvedGameId: number | null = null;
    let source: "gamedb" | "igdb" | null = null;

    const game = await Game.getGameById(enteredId);
    if (game) {
      resolvedGameId = game.id;
      source = "gamedb";
    } else {
      try {
        const imported = await Game.importGameFromIgdb(enteredId);
        resolvedGameId = imported.gameId;
        source = "igdb";
      } catch {
        resolvedGameId = null;
      }
    }

    if (!resolvedGameId) {
      await safeUpdate(interaction, {
        content: `Could not find or import game ID ${enteredId}.`,
        components: [],
      });
      return;
    }

    await this.applyCsvImportSelection({
      ownerId: parsed.ownerId,
      item,
      gameId: resolvedGameId,
      reason: "MANUAL_REMAP",
    });
    logCsvImportEvent("item_selected_by_game_id", {
      userId: parsed.ownerId,
      importId: session.importId,
      itemId: item.itemId,
      gameDbGameId: resolvedGameId,
      source: source ?? "unknown",
    });

    await this.renderNextCsvImportItem(interaction, session.importId, parsed.ownerId);
  }

  @Slash({ name: "add", description: "Add a game you own to your collection" })
  async add(
    @SlashOption({
      name: "title",
      description: "Game title from GameDB",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteCollectionGameTitle,
    })
    gameIdRaw: string,
    @SlashOption({
      name: "platform",
      description: "Owned platform",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteGameCompletionPlatformStandardFirst,
    })
    platformRaw: string,
    @SlashChoice(
      ...COLLECTION_OWNERSHIP_TYPES.map((value) => ({
        name: value,
        value,
      })),
    )
    @SlashOption({
      name: "ownership_type",
      description: "Ownership metadata",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    ownershipType: CollectionOwnershipType,
    @SlashOption({
      name: "note",
      description: "Optional note",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    note: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const platformId = await resolveGameCompletionPlatformId(platformRaw);
    if (!platformId) {
      await interaction.editReply("Invalid platform selection.");
      return;
    }

    const sanitizedNote = note
      ? sanitizeUserInput(note, { preserveNewlines: true, maxLength: 500 })
      : null;

    let resolution: ResolvedCollectionGame;
    try {
      resolution = await resolveCollectionGameForAdd(gameIdRaw);
    } catch (err: any) {
      await interaction.editReply(err?.message ?? "Invalid game selection.");
      return;
    }

    if (resolution.kind === "choose") {
      const { components } = createIgdbSession(
        interaction.user.id,
        resolution.options,
        async (selectionInteraction, igdbId) => {
          try {
            const imported = await Game.importGameFromIgdb(igdbId);
            const created = await UserGameCollection.addEntry({
              userId: interaction.user.id,
              gameId: imported.gameId,
              platformId,
              ownershipType,
              note: sanitizedNote,
            });

            const platformLabel = created.platformName ?? `Platform #${platformId}`;
            await selectionInteraction.followUp({
              content:
                `Imported and added **${created.title}** (${platformLabel}, ` +
                `${created.ownershipType}) to your collection.`,
              flags: MessageFlags.Ephemeral,
            }).catch(() => {});
          } catch (err: any) {
            await selectionInteraction.followUp({
              content: err?.message ?? "Failed to import from IGDB and add collection entry.",
              flags: MessageFlags.Ephemeral,
            }).catch(() => {});
          }
        },
      );

      await interaction.editReply({
        content:
          `No exact GameDB match found for "${resolution.titleQuery}". ` +
          "Select the correct IGDB game to import:",
        components,
      });
      return;
    }

    const resolvedGame = resolution;

    try {
      const created = await UserGameCollection.addEntry({
        userId: interaction.user.id,
        gameId: resolvedGame.gameId,
        platformId,
        ownershipType,
        note: sanitizedNote,
      });

      const platformLabel = created.platformName ?? `Platform #${platformId}`;
      await interaction.editReply(
        `Added **${created.title}** (${platformLabel}, ${created.ownershipType}) ` +
        `to your collection.`,
      );
    } catch (err: any) {
      await interaction.editReply(err?.message ?? "Failed to add collection entry.");
    }
  }

  @Slash({ name: "list", description: "List your collection or another member collection" })
  async list(
    @SlashOption({
      name: "member",
      description: "Member whose collection to view",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    member: User | GuildMember | undefined,
    @SlashOption({
      name: "title",
      description: "Filter by title",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    title: string | undefined,
    @SlashOption({
      name: "platform",
      description: "Filter by platform text",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    platform: string | undefined,
    @SlashChoice(
      ...COLLECTION_OWNERSHIP_TYPES.map((value) => ({
        name: value,
        value,
      })),
    )
    @SlashOption({
      name: "ownership_type",
      description: "Filter by ownership type",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    ownershipType: CollectionOwnershipType | undefined,
    @SlashOption({
      name: "showinchat",
      description: "If true, show results in channel instead of private response.",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const isEphemeral = !showInChat;
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(isEphemeral) });

    const targetUserId = member?.id ?? interaction.user.id;
    const titleFilter = title
      ? sanitizeUserInput(title, { preserveNewlines: false })
      : undefined;
    const platformFilter = platform
      ? sanitizeUserInput(platform, { preserveNewlines: false })
      : undefined;

    const memberLabel = resolveMemberLabel(member, interaction.user);
    const response = await buildCollectionListResponse({
      viewerUserId: interaction.user.id,
      targetUserId,
      memberLabel,
      title: titleFilter,
      platform: platformFilter,
      platformId: undefined,
      platformLabel: platformFilter,
      ownershipType,
      page: 0,
      isEphemeral,
    });

    if (response.content) {
      await interaction.editReply(response.content);
      return;
    }
    await interaction.editReply({
      components: response.components,
      flags: buildComponentsV2Flags(isEphemeral),
    });
  }

  @Slash({ name: "overview", description: "Show a summary of your collection by platform" })
  async overview(
    @SlashOption({
      name: "member",
      description: "Member whose collection to view",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    member: User | GuildMember | undefined,
    @SlashOption({
      name: "all",
      description: "Show combined collection stats for all users.",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    showAll: boolean | undefined,
    @SlashOption({
      name: "showinchat",
      description: "If true, show results in channel instead of private response.",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const isEphemeral = !showInChat;
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(isEphemeral) });

    if (showAll) {
      const messages = await buildAllCollectionsOverviewMessages();
      const [first, ...rest] = messages;
      if (!first) {
        await interaction.editReply("No collection entries yet.");
        return;
      }

      await interaction.editReply({
        components: first.components,
        flags: buildComponentsV2Flags(isEphemeral),
      });

      for (const message of rest) {
        await interaction.followUp({
          components: message.components,
          flags: buildComponentsV2Flags(isEphemeral),
        });
      }
      return;
    }

    const targetUserId = member?.id ?? interaction.user.id;
    const memberLabel = resolveMemberLabel(member, interaction.user);
    const components = await buildCollectionOverviewResponse({
      viewerUserId: interaction.user.id,
      targetUserId,
      memberLabel,
      isEphemeral,
      titleOverride: member ? `${memberLabel}'s Game Collection` : undefined,
    });

    await interaction.editReply({
      components,
      flags: buildComponentsV2Flags(isEphemeral),
    });
  }

  @SelectMenuComponent({
    id: /^collection-overview-select-v1:[^:]+:[^:]+:[ep]$/,
  })
  async onCollectionOverviewSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const parsed = parseCollectionOverviewSelectId(interaction.customId);
    if (!parsed) {
      await interaction.reply({
        content: "This collection overview control is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.viewerUserId) {
      await interaction.reply({
        content: "This collection overview is not for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const selection = parseCollectionOverviewSelectValue(interaction.values?.[0] ?? "");
    if (!selection) {
      await interaction.reply({
        content: "That collection selection is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const overviewTitle = extractOverviewTitleFromMessage(interaction.message);
    const memberLabel = resolveMemberLabelFromOverviewTitle(
      overviewTitle ?? "",
      interaction.user.username,
    );

    await interaction.deferUpdate().catch(() => {});

    if (selection === "overview") {
      const components = await buildCollectionOverviewResponse({
        viewerUserId: parsed.viewerUserId,
        targetUserId: parsed.targetUserId,
        memberLabel,
        isEphemeral: parsed.isEphemeral,
        titleOverride: overviewTitle ?? undefined,
      });

      await interaction.editReply({
        components,
        flags: buildComponentsV2EditFlags(),
      }).catch(() => {});
      return;
    }

    if (selection === "all-games") {
      const response = await buildCollectionListResponse({
        viewerUserId: parsed.viewerUserId,
        targetUserId: parsed.targetUserId,
        memberLabel,
        title: undefined,
        platform: undefined,
        platformId: undefined,
        platformLabel: undefined,
        ownershipType: undefined,
        page: 0,
        isEphemeral: parsed.isEphemeral,
      });

      if (response.content) {
        await interaction.editReply({
          content: response.content,
          components: [],
        }).catch(() => {});
        return;
      }

      await interaction.editReply({
        components: response.components,
        flags: buildComponentsV2EditFlags(),
      }).catch(() => {});
      return;
    }

    const overview = await UserGameCollection.getOverviewForUser(parsed.targetUserId);
    const platformEntry = overview.platformCounts
      .find((entry) => entry.platformId === selection.platformId) ?? null;
    const platformLabel = platformEntry
      ? formatCollectionOverviewPlatformLabel(platformEntry)
      : `Platform #${selection.platformId}`;

    const response = await buildCollectionListResponse({
      viewerUserId: parsed.viewerUserId,
      targetUserId: parsed.targetUserId,
      memberLabel,
      title: undefined,
      platform: undefined,
      platformId: selection.platformId,
      platformLabel,
      ownershipType: undefined,
      page: 0,
      isEphemeral: parsed.isEphemeral,
    });

    if (response.content) {
      await interaction.editReply({
        content: response.content,
        components: [],
      }).catch(() => {});
      return;
    }

    await interaction.editReply({
      components: response.components,
      flags: buildComponentsV2EditFlags(),
    }).catch(() => {});
  }

  @ButtonComponent({
    id: /^collection-list-nav-v2:[^:]+:[^:]+:\d+:[ep]:(prev|next)$/,
  })
  async onCollectionListNav(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseCollectionListNavId(interaction.customId);
    if (!parsed) {
      await interaction.reply({
        content: "This collection view control is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.viewerUserId) {
      await interaction.reply({
        content: "This collection view is not for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const nextPage = parsed.direction === "next"
      ? parsed.page + 1
      : Math.max(parsed.page - 1, 0);
    const currentFilters = parseCollectionFiltersFromListMessage(interaction.message);

    const response = await buildCollectionListResponse({
      viewerUserId: parsed.viewerUserId,
      targetUserId: parsed.targetUserId,
      memberLabel: "Member",
      title: currentFilters.title,
      platform: currentFilters.platform,
      platformId: currentFilters.platformId,
      platformLabel: currentFilters.platform,
      ownershipType: currentFilters.ownershipType,
      page: nextPage,
      isEphemeral: parsed.isEphemeral,
    });

    if (response.content) {
      await safeUpdate(interaction, {
        content: response.content,
        components: [],
      });
      return;
    }

    await safeUpdate(interaction, {
      components: response.components,
      flags: buildComponentsV2Flags(parsed.isEphemeral),
    });
  }

  @ButtonComponent({
    id: /^collection-list-filter-v1:[^:]+:[^:]+:[ep]:open$/,
  })
  async onCollectionFilterOpen(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseCollectionFilterActionId(interaction.customId);
    if (!parsed || parsed.action !== "open") {
      await interaction.reply({
        content: "This filter control is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.viewerUserId) {
      await interaction.reply({
        content: "This collection view is not for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const currentFilters = parseCollectionFiltersFromListMessage(interaction.message);

    await interaction.reply({
      content: buildCollectionFilterPanelContent({
        title: currentFilters.title,
        platform: currentFilters.platform,
        ownershipType: currentFilters.ownershipType,
      }),
      components: buildCollectionFilterPanelComponents({
        viewerUserId: parsed.viewerUserId,
        targetUserId: parsed.targetUserId,
        sourceMessageId: interaction.message.id,
        isEphemeral: parsed.isEphemeral,
        ownershipType: currentFilters.ownershipType,
      }),
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }

  @ButtonComponent({
    id: /^clf1:[^:]+:[^:]+:[^:]+:[ep]:[toacx]$/,
  })
  async onCollectionFilterAction(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseCollectionFilterPanelActionId(interaction.customId);
    if (!parsed) {
      await interaction.reply({
        content: "This filter control is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.viewerUserId) {
      await interaction.reply({
        content: "This filter control is not for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (parsed.action === "cancel") {
      await closeFilterPanel(interaction);
      return;
    }

    const currentState = parseCollectionFilterStateFromContent(interaction.message.content ?? "");

    if (parsed.action === "text") {
      const modal = new ModalBuilder()
        .setCustomId(
          buildCollectionFilterModalId({
            viewerUserId: parsed.viewerUserId,
            targetUserId: parsed.targetUserId,
            sourceMessageId: parsed.sourceMessageId,
            isEphemeral: parsed.isEphemeral,
            ownershipCode: ownershipTypeToCode(currentState.ownershipType),
          }),
        )
        .setTitle("Collection filters");

      const titleInput = new TextInputBuilder()
        .setCustomId(COLLECTION_FILTER_TITLE_INPUT_ID)
        .setLabel("Title contains")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(100)
        .setValue(currentState.title ?? "");
      const platformInput = new TextInputBuilder()
        .setCustomId(COLLECTION_FILTER_PLATFORM_INPUT_ID)
        .setLabel("Platform contains")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(100)
        .setValue(currentState.platform ?? "");

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(platformInput),
      );
      await interaction.showModal(modal).catch(() => {});
      return;
    }

    const nextState = parsed.action === "clear"
      ? {
        title: undefined,
        platform: undefined,
        ownershipType: undefined,
      }
      : parsed.action === "ownership"
        ? {
          title: currentState.title,
          platform: currentState.platform,
          ownershipType: nextOwnershipType(currentState.ownershipType),
        }
        : {
          title: currentState.title,
          platform: currentState.platform,
          ownershipType: currentState.ownershipType,
        };

    if (parsed.action === "apply") {
      await interaction.deferUpdate().catch(() => {});
      const applied = await applyFiltersToSourceMessage({
        interaction,
        sourceMessageId: parsed.sourceMessageId,
        viewerUserId: parsed.viewerUserId,
        targetUserId: parsed.targetUserId,
        isEphemeral: parsed.isEphemeral,
        title: nextState.title,
        platform: nextState.platform,
        ownershipType: nextState.ownershipType,
      });
      await (interaction.message as any)?.delete?.().catch(() => {});
      if (!applied) {
        await interaction.followUp({
          content: "Could not update that collection message.",
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return;
      }
      return;
    }

    await safeUpdate(interaction, {
      content: buildCollectionFilterPanelContent(nextState),
      components: buildCollectionFilterPanelComponents({
        viewerUserId: parsed.viewerUserId,
        targetUserId: parsed.targetUserId,
        sourceMessageId: parsed.sourceMessageId,
        isEphemeral: parsed.isEphemeral,
        ownershipType: nextState.ownershipType,
      }),
      flags: MessageFlags.Ephemeral,
    });
  }

  @ModalComponent({
    id: /^clfm1:[^:]+:[^:]+:[^:]+:[ep]:[^:]+$/,
  })
  async onCollectionFilterTextModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseCollectionFilterModalId(interaction.customId);
    if (!parsed) {
      await interaction.reply({
        content: "This filter modal is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.viewerUserId) {
      await interaction.reply({
        content: "This filter modal is not for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const titleInput = sanitizeUserInput(
      interaction.fields.getTextInputValue(COLLECTION_FILTER_TITLE_INPUT_ID) ?? "",
      { preserveNewlines: false, maxLength: 100 },
    );
    const platformInput = sanitizeUserInput(
      interaction.fields.getTextInputValue(COLLECTION_FILTER_PLATFORM_INPUT_ID) ?? "",
      { preserveNewlines: false, maxLength: 100 },
    );

    const nextState = {
      title: titleInput || undefined,
      platform: platformInput || undefined,
      ownershipType: parsed.ownershipType,
    };

    await safeUpdate(interaction, {
      content: buildCollectionFilterPanelContent(nextState),
      components: buildCollectionFilterPanelComponents({
        viewerUserId: parsed.viewerUserId,
        targetUserId: parsed.targetUserId,
        sourceMessageId: parsed.sourceMessageId,
        isEphemeral: parsed.isEphemeral,
        ownershipType: nextState.ownershipType,
      }),
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({ name: "edit", description: "Edit one of your collection entries" })
  async edit(
    @SlashOption({
      name: "entry",
      description: "Collection entry",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteCollectionEntry,
    })
    entryRaw: string,
    @SlashOption({
      name: "platform",
      description: "New platform",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: autocompleteGameCompletionPlatformStandardFirst,
    })
    platformRaw: string | undefined,
    @SlashChoice(
      ...COLLECTION_OWNERSHIP_TYPES.map((value) => ({
        name: value,
        value,
      })),
    )
    @SlashOption({
      name: "ownership_type",
      description: "New ownership type",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    ownershipType: CollectionOwnershipType | undefined,
    @SlashOption({
      name: "note",
      description: "New note",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    note: string | undefined,
    @SlashOption({
      name: "clear_note",
      description: "Clear note",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    clearNote: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const entryId = parseCollectionEntryAutocompleteValue(entryRaw);
    if (!entryId) {
      await interaction.editReply("Invalid collection entry selection.");
      return;
    }

    const updates: {
      platformId?: number | null;
      ownershipType?: CollectionOwnershipType;
      note?: string | null;
    } = {};

    if (platformRaw !== undefined) {
      const platformId = await resolveGameCompletionPlatformId(platformRaw);
      if (!platformId) {
        await interaction.editReply("Invalid platform selection.");
        return;
      }
      updates.platformId = platformId;
    }

    if (ownershipType !== undefined) {
      updates.ownershipType = ownershipType;
    }

    if (clearNote) {
      updates.note = null;
    } else if (note !== undefined) {
      updates.note = sanitizeUserInput(note, { preserveNewlines: true, maxLength: 500 });
    }

    if (!Object.keys(updates).length) {
      await interaction.editReply("Provide at least one field to update.");
      return;
    }

    try {
      const updated = await UserGameCollection.updateEntryForUser(
        entryId,
        interaction.user.id,
        updates,
      );
      if (!updated) {
        await interaction.editReply("Collection entry was not found.");
        return;
      }

      const platformLabel = updated.platformName ?? "Unknown platform";
      await interaction.editReply(
        `Updated **${updated.title}** (${platformLabel}, ${updated.ownershipType}).`,
      );
    } catch (err: any) {
      await interaction.editReply(err?.message ?? "Failed to update collection entry.");
    }
  }

  @Slash({ name: "remove", description: "Remove one of your collection entries" })
  async remove(
    @SlashOption({
      name: "entry",
      description: "Collection entry",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteCollectionEntry,
    })
    entryRaw: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const entryId = parseCollectionEntryAutocompleteValue(entryRaw);
    if (!entryId) {
      await interaction.editReply("Invalid collection entry selection.");
      return;
    }

    const existing = await UserGameCollection.getEntryForUser(entryId, interaction.user.id);
    if (!existing) {
      await interaction.editReply("Collection entry was not found.");
      return;
    }

    const deleted = await UserGameCollection.removeEntryForUser(entryId, interaction.user.id);
    if (!deleted) {
      await interaction.editReply("Failed to remove that collection entry.");
      return;
    }

    await interaction.editReply(`Removed **${existing.title}** from your collection.`);
  }

  @Slash({ name: "to-now-playing", description: "Add a collection entry to your now-playing list" })
  async toNowPlaying(
    @SlashOption({
      name: "entry",
      description: "Collection entry",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteCollectionEntry,
    })
    entryRaw: string,
    @SlashOption({
      name: "note_override",
      description: "Override note for now-playing",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    noteOverride: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const entryId = parseCollectionEntryAutocompleteValue(entryRaw);
    if (!entryId) {
      await interaction.editReply("Invalid collection entry selection.");
      return;
    }

    const entry = await UserGameCollection.getEntryForUser(entryId, interaction.user.id);
    if (!entry) {
      await interaction.editReply("Collection entry was not found.");
      return;
    }

    if (!entry.platformId) {
      await interaction.editReply("This entry does not have a platform. Update it before adding.");
      return;
    }

    const note = noteOverride !== undefined
      ? sanitizeUserInput(noteOverride, { preserveNewlines: true, maxLength: 500 })
      : entry.note;

    try {
      await Member.addNowPlaying(interaction.user.id, entry.gameId, entry.platformId, note);
      await interaction.editReply(
        `Added **${entry.title}** (${entry.platformName ?? "Unknown platform"}) ` +
        "to your now-playing list.",
      );
    } catch (err: any) {
      await interaction.editReply(err?.message ?? "Failed to add entry to now-playing.");
    }
  }

  @Slash({ name: "to-completion", description: "Log a completion from a collection entry" })
  async toCompletion(
    @SlashOption({
      name: "entry",
      description: "Collection entry",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteCollectionEntry,
    })
    entryRaw: string,
    @SlashChoice(
      ...COMPLETION_TYPES.map((value) => ({
        name: value,
        value,
      })),
    )
    @SlashOption({
      name: "completion_type",
      description: "Type of completion",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    completionType: CompletionType,
    @SlashOption({
      name: "completion_date",
      description: "YYYY-MM-DD, today, or unknown",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    completionDateRaw: string | undefined,
    @SlashOption({
      name: "final_playtime_hours",
      description: "Playtime in hours",
      type: ApplicationCommandOptionType.Number,
      required: false,
    })
    finalPlaytimeHours: number | undefined,
    @SlashOption({
      name: "note",
      description: "Optional completion note",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    note: string | undefined,
    @SlashOption({
      name: "announce",
      description: "Announce completion",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    announce: boolean | undefined,
    @SlashOption({
      name: "remove_from_now_playing",
      description: "Remove game from now-playing",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    removeFromNowPlaying: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const entryId = parseCollectionEntryAutocompleteValue(entryRaw);
    if (!entryId) {
      await interaction.editReply("Invalid collection entry selection.");
      return;
    }

    const entry = await UserGameCollection.getEntryForUser(entryId, interaction.user.id);
    if (!entry) {
      await interaction.editReply("Collection entry was not found.");
      return;
    }

    const completionDateInput = completionDateRaw
      ? sanitizeUserInput(completionDateRaw, { preserveNewlines: false })
      : undefined;

    let completedAt: Date | null;
    try {
      completedAt = parseCompletionDateInput(completionDateInput);
    } catch (err: any) {
      await interaction.editReply(err?.message ?? "Invalid completion date.");
      return;
    }

    if (
      finalPlaytimeHours !== undefined &&
      (Number.isNaN(finalPlaytimeHours) || finalPlaytimeHours < 0)
    ) {
      await interaction.editReply("Final playtime must be a non-negative number.");
      return;
    }

    const completionNote = note !== undefined
      ? sanitizeUserInput(note, { preserveNewlines: true, maxLength: 500 }) || null
      : entry.note;

    await saveCompletion(
      interaction,
      interaction.user.id,
      entry.gameId,
      entry.platformId,
      completionType,
      completedAt,
      finalPlaytimeHours ?? null,
      completionNote,
      entry.title,
      announce,
      false,
      removeFromNowPlaying ?? true,
    );
  }
}
