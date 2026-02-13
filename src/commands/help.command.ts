import type {
  ButtonInteraction,
  CommandInteraction,
  MessageActionRowComponentBuilder,
} from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  MessageFlags,
} from "discord.js";
import { ButtonComponent, Discord, SelectMenuComponent, Slash } from "discordx";
import { isAdmin } from "./admin.command.js";
import { buildAdminHelpResponse } from "./admin/admin-help.service.js";
import { buildModHelpResponse, isModerator } from "./mod.command.js";
import { buildSuperAdminHelpResponse, isSuperAdmin } from "./superadmin.command.js";
import { safeDeferReply, safeReply, safeUpdate } from "../functions/InteractionUtils.js";

type HelpTopicId =
  | "nominate"
  | "round"
  | "round-history"
  | "nextvote"
  | "hltb"
  | "now-playing"
  | "rss"
  | "mp-info"
  | "profile"
  | "game-completion"
  | "collection"
  | "gamedb"
  | "avatar-history"
  | "publicreminder"
  | "giveaway"
  | "thread"
  | "admin"
  | "mod"
  | "superadmin"
  | "todo"
  | "suggestion";

type HelpMenuView =
  | "main"
  | "category"
  | "profile"
  | "now-playing"
  | "game-completion"
  | "gamedb"
  | "rss"
  | "refresh";

type HelpStatePayload = {
  categoryId?: string;
  activeTopicId?: string;
};

type HelpTopic = {
  id: HelpTopicId;
  label: string;
  summary: string;
  syntax: string;
  parameters?: string;
  notes?: string;
};

type ProfileHelpTopicId =
  | "view"
  | "edit"
  | "search";

type ProfileHelpTopic = {
  id: ProfileHelpTopicId;
  label: string;
  summary: string;
  syntax: string;
  notes?: string;
};

type GameCompletionHelpTopicId =
  | "add"
  | "list"
  | "common"
  | "edit"
  | "delete"
  | "export"
  | "import-completionator";

type GameCompletionHelpTopic = {
  id: GameCompletionHelpTopicId;
  label: string;
  summary: string;
  syntax: string;
  notes?: string;
};

type GameDbHelpTopicId =
  | "add"
  | "search"
  | "view"
  | "audit"
  | "link-versions"
  | "synonym-list"
  | "csv-import";

type GameDbHelpTopic = {
  id: GameDbHelpTopicId;
  label: string;
  summary: string;
  syntax: string;
  notes?: string;
};

const HELP_TOPICS: HelpTopic[] = [
  {
    id: "nominate",
    label: "/nominate",
    summary:
      "Open a nomination modal for GOTM or NR-GOTM with your current upcoming-round nominations.",
    syntax: "Syntax: /nominate",
    notes:
      "The modal includes your current GOTM and NR-GOTM picks for the next round, plus required reason input.",
  },
  {
    id: "round",
    label: "/round",
    summary: "See the current round details and winners for GOTM and NR-GOTM.",
    syntax: "Syntax: /round [showinchat:<boolean>]",
    notes: "Replies privately by default; set showinchat:true to post in channel.",
  },
  {
    id: "round-history",
    label: "/round-history",
    summary: "Open a modal to filter and browse historical GOTM/NR-GOTM rounds.",
    syntax: "Syntax: /round-history [showinchat:<boolean>]",
    notes:
      "Modal filters: category (GOTM/NR-GOTM/Both), optional title query, year, and sort order. " +
      "Results are paginated at 5 rounds per page.",
  },
  {
    id: "nextvote",
    label: "/nextvote",
    summary: "Check when the next GOTM/NR-GOTM vote happens.",
    syntax: "Syntax: /nextvote [showinchat:<boolean>]",
    notes:
      "Replies privately by default; set showinchat:true to post in channel. " +
      "Nominate with /nominate.",
  },
  {
    id: "hltb",
    label: "/hltb",
    summary: "Look up HowLongToBeat playtimes for a game.",
    syntax: "Syntax: /hltb title:<string> [showinchat:<boolean>]",
    parameters: "title (required) — game name and optional details. showinchat (optional) — set true to share in channel.",
    notes: "Title autocompletes from GameDB and includes the release year.",
  },
  {
    id: "mp-info",
    label: "/mp-info",
    summary:
      "See who’s shared their multiplayer info (Steam/XBL/PSN/Switch) with quick profile buttons.",
    syntax:
      "Syntax: /mp-info [showinchat:<boolean>] [steam:<boolean>] [xbl:<boolean>] [psn:<boolean>] [switch:<boolean>]",
    notes:
      "Filters default to all platforms unless you set any flag true (then others default to false). Replies are private unless showinchat:true. Use the dropdown to jump to a member’s profile.",
  },
  {
    id: "now-playing",
    label: "/now-playing",
    summary: "Manage your Now Playing list and view others'.",
    syntax:
      "Use /now-playing help for subcommands: list, search.",
    notes:
      "Add Game, Edit Note, Edit Platform, Sort, Remove Game, and Add Completion are available from the buttons under your own list.",
  },
  {
    id: "game-completion",
    label: "/game-completion",
    summary: "Log completed games (removes them from Now Playing if present).",
    syntax:
      "Use /game-completion help for subcommands: add, list, common, edit, delete, export, import-completionator.",
  },
  {
    id: "collection",
    label: "/collection",
    summary:
      "Track your owned games with platform and ownership metadata (public by default).",
    syntax:
      "Syntax: /collection add title:<game> platform:<platform> ownership_type:<type> " +
      "[note:<string>] | /collection overview [member:<user>] [all:<bool>] [showinchat:<bool>] | " +
      "/collection list [member:<user>] [filters...] | " +
      "/collection edit entry:<selection> [fields...] | /collection remove entry:<selection> | " +
      "/collection to-now-playing entry:<selection> [note_override:<string>] | " +
      "/collection to-completion entry:<selection> completion_type:<type> [fields...] | " +
      "/collection import-steam action:<start|resume|status|pause|cancel> [steam_profile:<id|url>] | " +
      "/collection import-csv action:<start|resume|status|pause|cancel> [file:<csv>]",
    notes:
      "Duplicate policy: same game on multiple platforms is supported. Exact duplicates " +
      "(same game, platform, ownership type) are blocked. /collection list shows 10 entries per page " +
      "and includes a Filter Results button for title/platform/ownership filters. " +
      "/collection overview summarizes totals by platform and supports showinchat to share the summary. " +
      "Steam import now supports session start/status/pause/resume/cancel, plus per-item " +
      "review with per-candidate Choose buttons plus Import First Match, Search a different title, " +
      "Enter GameDB ID, Skip, and Pause. " +
      "Single exact matches auto-accept. Search a different title re-runs matching using a title you enter. " +
      "Enter GameDB ID accepts an existing GameDB ID or imports by IGDB numeric ID. " +
      "For ambiguous matches, the candidate list can include titles chosen previously by other users. " +
      "CSV import uses the same review flow and provides a template with required columns and an example row.",
  },
  {
    id: "profile",
    label: "/profile",
    summary:
      "View, edit, and search profiles; manage Now Playing; and log completed games (view/search are private by default).",
    syntax:
      "Use /profile help for subcommands (view/edit/search/nowplaying-add/nowplaying-remove/completion-add/completion-list/completion-edit/completion-delete) and parameters.",
  },
  {
    id: "gamedb",
    label: "/gamedb",
    summary:
      "Search, import, and view games from GameDB with IGDB-powered lookups.",
    syntax:
      "Use /gamedb help for subcommands: add, search, view, audit, link-versions, " +
      "synonym-list, csv-import, help.",
    notes:
      "Imports pull titles/covers from IGDB. View shows GOTM/NR-GOTM wins, " +
      "nominations, and related threads for the GameDB id. Game view also includes " +
      "a quick Nominate button that opens the /nominate modal prefilled with that title. " +
      "Audit is admin only.",
  },
  {
    id: "avatar-history",
    label: "/avatar-history",
    summary: "View a member's historical avatars.",
    syntax: "Syntax: /avatar-history [member:<user>] [showinchat:<boolean>]",
    notes: "Defaults to your own avatar history.",
  },
  {
    id: "publicreminder",
    label: "/publicreminder",
    summary: "Schedule public reminders with optional recurrence (admin only).",
    syntax:
      "Syntax: /publicreminder create channel:<channel> date:<string> time:<string> message:<string> [recur:<int>] [recurunit:<minutes|hours|days|weeks|months|years>] | /publicreminder list | /publicreminder delete id:<int>",
    notes:
      "Times parse in America/New_York. Recurring reminders need both recur and recurunit. Replies are private; creation shows the scheduled time.",
  },
  {
    id: "giveaway",
    label: "/gamegiveaway",
    summary: "Jump to the giveaway hub list to claim or donate digital game keys.",
    syntax:
      "Syntax: /gamegiveaway (returns a link to the hub list).",
    notes:
      "The giveaway list is kept in <#1461101188572254351> with claim/donate buttons. " +
      "Claims are handled from the list menu; keys are sent by DM.",
  },
  {
    id: "thread",
    label: "/thread",
    summary:
      "Link or unlink a thread to one or more GameDB games (requires Manage Threads).",
    syntax:
      "Syntax: /thread link thread_id:<string> gamedb_game_id:<int> | /thread unlink thread_id:<string> [gamedb_game_id:<int>]",
    notes:
      "Threads can have multiple linked games. Use unlink without gamedb_game_id to remove all links for the thread. Replies are private.",
  },
  {
    id: "rss",
    label: "/rss",
    summary: "Manage RSS relays with include/exclude keywords per channel (admin only).",
    syntax: "Use /rss help for subcommands: add, remove, edit, list.",
  },
  {
    id: "admin",
    label: "/admin",
    summary: "Admin tools for GOTM/NR-GOTM management.",
    syntax: "Use /admin help to see the subcommands and details.",
  },
  {
    id: "mod",
    label: "/mod",
    summary: "Moderator tools for NR-GOTM management.",
    syntax: "Use /mod help to see the subcommands and details.",
  },
  {
    id: "superadmin",
    label: "/superadmin",
    summary: "Server owner tools for GOTM/NR-GOTM management.",
    syntax: "Use /superadmin help to see the subcommands and details.",
  },
  {
    id: "todo",
    label: "/todo",
    summary:
      "Manage GitHub issues with the bot (list is public; actions are button-driven).",
    syntax:
      "Syntax: /todo [query:<string>] [state:<open|closed|all>] " +
      "[labels:<New Feature,Improvement,Bug,Blocked>] " +
      "[sort:<created|updated>] [direction:<asc|desc>] [page:<int>] [per_page:<int>] " +
      "[showinchat:<boolean>]",
    notes:
      "Issue descriptions and comments support image links, including HTML <img src=\"...\">.",
  },
  {
    id: "suggestion",
    label: "/suggestion",
    summary: "Submit a bot suggestion for review.",
    syntax: "Syntax: /suggestion (opens modal for title, description, and type selection)",
    notes: "Suggestions are approved from the Review Suggestions button in /todo by the server owner or bot dev.",
  },
];

const HELP_CATEGORIES: { id: string; name: string; topicIds: HelpTopicId[] }[] = [
  {
    id: "monthly-games",
    name: "Monthly Games",
    topicIds: ["nominate", "round", "round-history", "nextvote"],
  },
  {
    id: "members",
    name: "Members",
    topicIds: ["profile", "mp-info"],
  },
  {
    id: "gamedb",
    name: "GameDB",
    topicIds: ["gamedb", "collection", "now-playing", "game-completion"],
  },
  {
    id: "utilities",
    name: "Utilities",
    topicIds: [
      "hltb",
      "suggestion",
      "giveaway",
      "avatar-history",
    ],
  },
  {
    id: "server-admin",
    name: "Server Administration",
    topicIds: ["mod", "admin", "superadmin", "todo", "publicreminder", "thread", "rss"],
  },
];

const HELP_CUSTOM_ID_PREFIX = "help";

function isHelpView(view: string): view is HelpMenuView {
  return (
    view === "main" ||
    view === "category" ||
    view === "profile" ||
    view === "now-playing" ||
    view === "game-completion" ||
    view === "gamedb" ||
    view === "rss" ||
    view === "refresh"
  );
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function buildHelpCustomId(view: HelpMenuView, state: HelpStatePayload = {}): string {
  const encodedState = toBase64Url(JSON.stringify(state));
  return `${HELP_CUSTOM_ID_PREFIX}:${view}:${encodedState}`;
}

function parseHelpCustomId(
  customId: string,
): { view: HelpMenuView; state: HelpStatePayload } | null {
  const [prefix, view, encodedState] = customId.split(":");
  if (prefix !== HELP_CUSTOM_ID_PREFIX || !view || !encodedState) return null;
  if (!isHelpView(view)) return null;

  try {
    const state = JSON.parse(fromBase64Url(encodedState)) as HelpStatePayload;
    return { view, state };
  } catch {
    return null;
  }
}

function buildHelpRefreshComponents(): ActionRowBuilder<ButtonBuilder>[] {
  const button = new ButtonBuilder()
    .setCustomId(buildHelpCustomId("refresh"))
    .setLabel("Refresh help menu")
    .setStyle(ButtonStyle.Primary);

  return [new ActionRowBuilder<ButtonBuilder>().addComponents(button)];
}

async function sendHelpRefreshPrompt(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  message = "This help menu expired. Tap refresh to regenerate.",
): Promise<void> {
  await safeUpdate(interaction, {
    content: message,
    components: buildHelpRefreshComponents(),
    embeds: [],
  });
}

function getCategoryById(id: string): (typeof HELP_CATEGORIES)[number] | undefined {
  return HELP_CATEGORIES.find((cat) => cat.id === id);
}

export function padCommandName(label: string, width = 15): string {
  const name = label.startsWith("/") ? label.slice(1) : label;
  return name.padEnd(width, " ");
}

function formatCommandLine(label: string, summary: string, width = 15): string {
  return `> **\`\` ${padCommandName(label, width)} \`\`** ${summary}`;
}

function buildHelpDetailsEmbed(topic: HelpTopic): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${topic.label} help`)
    .setDescription(topic.summary)
    .addFields({ name: "Syntax", value: topic.syntax });

  if (topic.parameters) {
    embed.addFields({ name: "Parameters", value: topic.parameters });
  }

  if (topic.notes) {
    embed.addFields({ name: "Notes", value: topic.notes });
  }

  return embed;
}

function buildProfileHelpButtons(
  activeId?: ProfileHelpTopicId,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const select = new StringSelectMenuBuilder()
    .setCustomId(buildHelpCustomId("profile", { activeTopicId: activeId }))
    .setPlaceholder("/profile help")
    .addOptions(
      PROFILE_HELP_TOPICS.map((topic) => ({
        label: topic.label,
        value: topic.id,
        description: topic.summary.slice(0, 95),
        default: topic.id === activeId,
      })),
    )
    .addOptions({ label: "Back to Help Main Menu", value: "help-main" });

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

function buildProfileHelpEmbed(topic: ProfileHelpTopic): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${topic.label} help`)
    .setDescription(topic.summary)
    .addFields({ name: "Syntax", value: topic.syntax });

  if (topic.notes) {
    embed.addFields({ name: "Notes", value: topic.notes });
  }

  return embed;
}

function buildNowPlayingHelpButtons(
  activeId?: NowPlayingHelpTopicId,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const select = new StringSelectMenuBuilder()
    .setCustomId(buildHelpCustomId("now-playing", { activeTopicId: activeId }))
    .setPlaceholder("/now-playing help")
    .addOptions(
      NOW_PLAYING_HELP_TOPICS.map((topic) => ({
        label: topic.label,
        value: topic.id,
        description: topic.summary.slice(0, 95),
        default: topic.id === activeId,
      })),
    )
    .addOptions({ label: "Back to Help Main Menu", value: "help-main" });

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

function buildNowPlayingHelpEmbed(topic: NowPlayingHelpTopic): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${topic.label} help`)
    .setDescription(topic.summary)
    .addFields({ name: "Syntax", value: topic.syntax });

  if (topic.notes) {
    embed.addFields({ name: "Notes", value: topic.notes });
  }

  return embed;
}

export function buildNowPlayingHelpResponse(
  activeTopicId?: NowPlayingHelpTopicId,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<StringSelectMenuBuilder>[] } {
  const embed = new EmbedBuilder()
    .setTitle("/now-playing commands")
    .setDescription("Choose a subcommand from the dropdown to view details.");

  const components = buildNowPlayingHelpButtons(activeTopicId);
  return { embeds: [embed], components };
}

function buildGamedbHelpButtons(
  activeId?: GameDbHelpTopicId,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const select = new StringSelectMenuBuilder()
    .setCustomId(buildHelpCustomId("gamedb", { activeTopicId: activeId }))
    .setPlaceholder("/gamedb help")
    .addOptions(
      GAMEDB_HELP_TOPICS.map((topic) => ({
        label: topic.label,
        value: topic.id,
        description: topic.summary.slice(0, 95),
        default: topic.id === activeId,
      })),
    )
    .addOptions({ label: "Back to Help Main Menu", value: "help-main" });

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

function buildGamedbHelpEmbed(topic: GameDbHelpTopic): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${topic.label} help`)
    .setDescription(topic.summary)
    .addFields({ name: "Syntax", value: topic.syntax });

  if (topic.notes) {
    embed.addFields({ name: "Notes", value: topic.notes });
  }

  return embed;
}

type RssHelpTopicId = "add" | "remove" | "edit" | "list";

type RssHelpTopic = {
  id: RssHelpTopicId;
  label: string;
  summary: string;
  syntax: string;
};

const RSS_HELP_TOPICS: RssHelpTopic[] = [
  {
    id: "add",
    label: "/rss add",
    summary: "Add an RSS feed relay with optional include/exclude keywords.",
    syntax:
      "Syntax: /rss add url:<string> channel:<channel> [name:<string>] [include:<csv>] [exclude:<csv>]",
  },
  {
    id: "remove",
    label: "/rss remove",
    summary: "Remove an existing RSS relay by id.",
    syntax: "Syntax: /rss remove id:<integer>",
  },
  {
    id: "edit",
    label: "/rss edit",
    summary: "Update an existing RSS relay (url/channel/name/include/exclude).",
    syntax:
      "Syntax: /rss edit id:<integer> [url:<string>] [channel:<channel>] [name:<string>] [include:<csv>] [exclude:<csv>]",
  },
  {
    id: "list",
    label: "/rss list",
    summary: "List configured RSS relays and their filters.",
    syntax: "Syntax: /rss list",
  },
];

const PROFILE_HELP_TOPICS: ProfileHelpTopic[] = [
  {
    id: "view",
    label: "/profile view",
    summary: "View a member profile (private by default).",
    syntax: "Syntax: /profile view [member:<user>] [showinchat:<boolean>]",
    notes: "Omit member to view your own profile; set showinchat:true to post publicly.",
  },
  {
    id: "edit",
    label: "/profile edit",
    summary: "Edit a profile's platform links/handles (self or admin).",
    syntax:
      "Syntax: /profile edit [member:<user>] [completionator:<url>] [psn:<string>] [xbl:<string>] [nsw:<string>] [steam:<url>]",
    notes: "Users may edit their own fields; admins may edit any user.",
  },
  {
    id: "search",
    label: "/profile search",
    summary: "Search profiles by id/name/platform fields.",
    syntax:
      "Syntax: /profile search [userId:<string>] [username:<string>] [globalname:<string>] [completionator:<string>] [steam:<string>] [psn:<string>] [xbl:<string>] [nsw:<string>] [role flags...] [limit:<int>] [include-departed-members:<boolean>] [showinchat:<boolean>]",
    notes:
      "Filters default to partial matches; date/times use ISO formats; limit max 100; departed members are excluded unless include-departed-members is true.",
  },
];

type NowPlayingHelpTopicId =
  | "list"
  | "search";

type NowPlayingHelpTopic = {
  id: NowPlayingHelpTopicId;
  label: string;
  summary: string;
  syntax: string;
  notes?: string;
};

const NOW_PLAYING_HELP_TOPICS: NowPlayingHelpTopic[] = [
  {
    id: "list",
    label: "/now-playing list",
    summary: "Show Now Playing lists for you, someone else, or everyone.",
    syntax: "Syntax: /now-playing list [member:<user>] [all:<boolean>] [showinchat:<boolean>]",
    notes:
      "Defaults to a private view for one member. Set all:true to list everyone (sent publicly) with thread links when available.",
  },
  {
    id: "search",
    label: "/now-playing search",
    summary: "Find members playing GameDB titles that match a search.",
    syntax: "Syntax: /now-playing search title:<string> [showinchat:<boolean>]",
    notes: "Matches GameDB titles and lists users currently playing those games.",
  },
];

const GAME_COMPLETION_HELP_TOPICS: GameCompletionHelpTopic[] = [
  {
    id: "add",
    label: "/game-completion add",
    summary: "Log that you completed a game (removes it from Now Playing if present).",
    syntax:
      "Syntax: /game-completion add title:<string> completion_type:<choice> platform:<string> [completion_date:<date>] [final_playtime_hours:<number>] [note:<string>] [announce:<boolean>]",
    notes:
      "Completion type choices: Main Story, Main Story + Side Content, Completionist. Completion date defaults to today; playtime is optional (e.g., 42.5). Title autocompletes from GameDB and includes the release year. Platform is required and autocompletes from all GameDB platforms. If no exact title match, you can import from IGDB. Set announce:true to post to the completions channel.",
  },
  {
    id: "list",
    label: "/game-completion list",
    summary: "List recent completions for you, another member, or view the leaderboard.",
    syntax:
      "Syntax: /game-completion list [year:<int|unknown>] [title:<string>] [member:<user>] [all:<boolean>] [showinchat:<bool>]",
    notes:
      "Shows your completions, another member's completions (member), or a leaderboard of all members (all).",
  },
  {
    id: "common",
    label: "/game-completion common",
    summary: "Compare shared completed games between two members.",
    syntax:
      "Syntax: /game-completion common [member_one:<user>] [member_two:<user>] [sort:<choice>] [year:<int|unknown>] [platform:<string>] [title:<string>] [showinchat:<bool>]",
    notes:
      "If only one member is provided, compares you against that member. If both are provided, compares those two members directly. Supports paging and filters for title/year/platform.",
  },
  {
    id: "edit",
    label: "/game-completion edit",
    summary: "Edit one of your completion records.",
    syntax:
      "Syntax: /game-completion edit title:<string> [completion_type:<choice>] [completion_date:<date>] [platform:<string>] [final_playtime_hours:<number>] [note:<string>] [clear_platform:<boolean>] [clear_final_playtime:<boolean>] [clear_note:<boolean>]",
    notes:
      "Title is required and autocompletes from your own completion records. The command updates fields directly without opening an edit menu. Platform autocompletes from all GameDB platforms.",
  },
  {
    id: "delete",
    label: "/game-completion delete",
    summary: "Delete one of your completion records.",
    syntax: "Syntax: /game-completion delete",
    notes: "Interactive menu to pick a completion to delete.",
  },
  {
    id: "export",
    label: "/game-completion export",
    summary: "Export your completions to CSV.",
    syntax: "Syntax: /game-completion export",
    notes: "Returns a CSV file with your completion records.",
  },
  {
    id: "import-completionator",
    label: "/game-completion import-completionator",
    summary: "Import completions from a Completionator CSV export. Server owner only.",
    syntax:
      "Syntax: /game-completion import-completionator action:<start|resume|status|pause|cancel> [file:<csv>]",
    notes:
      "Server owner only. Use action:start with the CSV file to begin. " +
      "Export your CSV from Completionator using its Export or Download CSV option. " +
      "During review, use Import First Match, reply with a GameDB id, skip, or pause, and choose Update Existing " +
      "when you want to sync the CSV data. Entries with a clear GameDB match and a " +
      "platform selection can auto add without confirmation.",
  },
];

function buildGameCompletionHelpButtons(
  activeId?: GameCompletionHelpTopicId,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const select = new StringSelectMenuBuilder()
    .setCustomId(buildHelpCustomId("game-completion", { activeTopicId: activeId }))
    .setPlaceholder("/game-completion help")
    .addOptions(
      GAME_COMPLETION_HELP_TOPICS.map((topic) => ({
        label: topic.label,
        value: topic.id,
        description: topic.summary.slice(0, 95),
        default: topic.id === activeId,
      })),
    )
    .addOptions({ label: "Back to Help Main Menu", value: "help-main" });

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

function buildGameCompletionHelpEmbed(topic: GameCompletionHelpTopic): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${topic.label} help`)
    .setDescription(topic.summary)
    .addFields({ name: "Syntax", value: topic.syntax });

  if (topic.notes) {
    embed.addFields({ name: "Notes", value: topic.notes });
  }

  return embed;
}

export function buildGameCompletionHelpResponse(
  activeTopicId?: GameCompletionHelpTopicId,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<StringSelectMenuBuilder>[] } {
  const embed = new EmbedBuilder()
    .setTitle("/game-completion commands")
    .setDescription("Choose a subcommand from the dropdown to view details.");

  const components = buildGameCompletionHelpButtons(activeTopicId);
  return { embeds: [embed], components };
}

const GAMEDB_HELP_TOPICS: GameDbHelpTopic[] = [
  {
    id: "add",
    label: "/gamedb add",
    summary: "Search IGDB and import a game into GameDB (open to all users).",
    syntax: "Syntax: /gamedb add title:<string> [igdb_id:<int>] [bulk_titles:<string>]",
    notes:
      "Returns a dropdown of IGDB matches with the first option preselected plus an Import First Match button. " +
      "If only one result, it imports automatically. " +
      "Use igdb_id to skip search or bulk_titles (comma-separated) to import up to 5 at once. " +
      "Duplicate titles already in GameDB show an 'already imported' message.",
  },
  {
    id: "csv-import",
    label: "/gamedb csv-import",
    summary: "Import games from a Completionator CSV export (server owner only).",
    syntax:
      "Syntax: /gamedb csv-import action:<start|resume|status|pause|cancel> [file:<csv>]",
    notes:
      "Use action:start with the CSV file to begin. Each row prompts for an IGDB match " +
      "with Import First Match, a manual IGDB id, or skip. Resume after restarts with action:resume.",
  },
  {
    id: "search",
    label: "/gamedb search",
    summary: "Search GameDB titles with paged dropdown navigation.",
    syntax: "Syntax: /gamedb search title:<string>",
    notes:
      "Results show a dropdown and Previous/Next buttons; selecting a game shows its profile.",
  },
  {
    id: "view",
    label: "/gamedb view",
    summary: "View a GameDB entry by title.",
    syntax: "Syntax: /gamedb view title:<string>",
    notes:
      "Shows cover art, metadata, releases, plus GOTM/NR-GOTM associations: winning rounds " +
      "(with thread/Reddit links) and nomination rounds with nominator mentions.",
  },
  {
    id: "audit",
    label: "/gamedb audit",
    summary: "Audit GameDB for missing images, videos, descriptions, or release data (admin only).",
    syntax:
      "Syntax: /gamedb audit [missing_images:<boolean>] " +
      "[missing_featured_video:<boolean>] [missing_descriptions:<boolean>] " +
      "[missing_release_data:<boolean>] [auto_accept_images:<boolean>] " +
      "[auto_accept_videos:<boolean>] [auto_accept_release_data:<boolean>] " +
      "[query:<string>] [show_complete_games:<boolean>] [showinchat:<boolean>]",
    notes:
      "Defaults to checking all selected audit flags when any filter is set. " +
      "Auto-accept pulls IGDB data for missing images, videos, or release data.",
  },
  {
    id: "link-versions",
    label: "/gamedb link-versions",
    summary: "Link alternate GameDB versions together (admin only).",
    syntax: "Syntax: /gamedb link-versions game_ids:<string> [showinchat:<boolean>]",
    notes:
      "Provide a comma-separated list of GameDB ids to link (e.g. 12, 34, 56). " +
      "Linked titles appear under Alternate Versions in /gamedb view.",
  },
  {
    id: "synonym-list",
    label: "/gamedb synonym-list",
    summary: "List GameDB search synonyms (admin only).",
    syntax: "Syntax: /gamedb synonym-list [query:<string>] [showinchat:<boolean>]",
    notes:
      "Returns grouped synonym terms with dropdowns to edit or delete a group, " +
      "plus an Add New Group button.",
  },
];

function buildRssHelpButtons(activeId?: RssHelpTopicId): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const select = new StringSelectMenuBuilder()
    .setCustomId(buildHelpCustomId("rss", { activeTopicId: activeId }))
    .setPlaceholder("/rss help")
    .addOptions(
      RSS_HELP_TOPICS.map((topic) => ({
        label: topic.label,
        value: topic.id,
        description: topic.summary.slice(0, 95),
        default: topic.id === activeId,
      })),
    )
    .addOptions({ label: "Back to Help Main Menu", value: "help-main" });

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

function buildRssHelpEmbed(topic: RssHelpTopic): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`${topic.label} help`)
    .setDescription(topic.summary)
    .addFields({ name: "Syntax", value: topic.syntax });
}

export function buildRssHelpResponse(
  activeTopicId?: RssHelpTopicId,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<StringSelectMenuBuilder>[] } {
  const embed = new EmbedBuilder()
    .setTitle("/rss commands")
    .setDescription("Choose an RSS subcommand from the dropdown to view details.");

  const components = buildRssHelpButtons(activeTopicId);
  return { embeds: [embed], components };
}

export function buildMainHelpResponse(): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<StringSelectMenuBuilder>[];
} {
  const embed = new EmbedBuilder()
    .setTitle("RPGClubUtils Commands")
    .setDescription(
      "Use the category dropdowns below to jump straight to a command’s details.\n\n" +
        "**Monthly Games**\n" +
        `${formatCommandLine("nominate", "Open the nomination modal for GOTM or NR-GOTM.")}\n` +
        `${formatCommandLine("round", "See the current round and winners.")}\n` +
        `${formatCommandLine("round-history", "Browse historical rounds with filters.")}\n` +
        `${formatCommandLine("nextvote", "Check when the next vote happens.")}\n\n` +
        "**Members**\n" +
        `${formatCommandLine("profile", "View and edit member profiles.")}\n` +
        `${formatCommandLine("mp-info", "Find who has shared multiplayer info.")}\n\n` +
        "**GameDB**\n" +
        `${formatCommandLine("gamedb", "Search for games and view their details.")}\n` +
        `${formatCommandLine("collection", "Track owned games by platform and ownership.")}\n` +
        `${formatCommandLine("now-playing", "Show Now Playing lists and thread links.")}\n` +
        `${formatCommandLine("game-completion", "Log and manage your completed games.")}\n\n` +
        "**Utilities**\n" +
        `${formatCommandLine("hltb", "Look up HowLongToBeat playtimes.")}\n` +
        `${formatCommandLine("gamegiveaway", "Jump to the giveaway hub list.")}\n` +
        `${formatCommandLine("avatar-history", "View a member's avatar history.")}\n` +
        `${formatCommandLine("suggestion", "Submit a bot suggestion.")}\n\n` +
        "**Server Administration**\n" +
        `${formatCommandLine("mod", "Moderator tools.")}\n` +
        `${formatCommandLine("admin", "Admin tools.")}\n` +
        `${formatCommandLine("superadmin", "Server Owner tools.")}\n` +
        `${formatCommandLine("todo", "Manage GitHub issues using the bot.")}\n` +
        `${formatCommandLine("publicreminder", "Schedule public reminders.")}\n` +
        `${formatCommandLine("thread", "Link threads to GameDB games.")}\n` +
        `${formatCommandLine("rss", "Manage RSS relays with filters.")}`,
    );

  return {
    embeds: [embed],
    components: buildMainHelpComponents(),
  };
}

export function buildProfileHelpResponse(
  activeTopicId?: ProfileHelpTopicId,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<StringSelectMenuBuilder>[] } {
  const embed = new EmbedBuilder()
    .setTitle("/profile commands")
    .setDescription("Choose a profile subcommand from the dropdown to view details.");

  const components = buildProfileHelpButtons(activeTopicId);
  return { embeds: [embed], components };
}

export function buildGamedbHelpResponse(
  activeTopicId?: GameDbHelpTopicId,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<StringSelectMenuBuilder>[] } {
  const embed = new EmbedBuilder()
    .setTitle("/gamedb commands")
    .setDescription("Choose a GameDB subcommand from the dropdown to view details.");

  const components = buildGamedbHelpButtons(activeTopicId);
  return { embeds: [embed], components };
}

@Discord()
export class BotHelp {
  @Slash({ description: "Show help for all bot commands", name: "help" })
  async help(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const response = buildMainHelpResponse();

    await safeReply(interaction, {
      ...response,
      flags: MessageFlags.Ephemeral,
    });
  }

  @SelectMenuComponent({ id: "help-main-select" })
  async handleLegacyHelpCategory(interaction: StringSelectMenuInteraction): Promise<void> {
    await sendHelpRefreshPrompt(interaction);
  }

  @SelectMenuComponent({ id: /^(help:category:|help-category-select:)/ })
  async handleCategoryCommand(interaction: StringSelectMenuInteraction): Promise<void> {
    const parsed = parseHelpCustomId(interaction.customId);
    if (!parsed || parsed.view !== "category" || !parsed.state.categoryId) {
      await sendHelpRefreshPrompt(interaction);
      return;
    }

    const topicId =
      (interaction.values?.[0] as HelpTopicId | "help-main" | undefined) ??
      (parsed.state.activeTopicId as HelpTopicId | "help-main" | undefined);
    const category = getCategoryById(parsed.state.categoryId);

    if (!category || topicId === "help-main") {
      const response = buildMainHelpResponse();
      await safeUpdate(interaction, response);
      return;
    }

    if (!topicId) {
      const response = buildCategoryHelpResponse(category.id, parsed.state.activeTopicId as HelpTopicId | undefined);
      await safeUpdate(interaction, {
        ...response,
        content: "Please pick a command from the list.",
      });
      return;
    }

    const topic = HELP_TOPICS.find((entry) => entry.id === topicId);

    if (topicId === "admin") {
      const ok = await isAdmin(interaction);
      if (!ok) return;
    }

    if (topicId === "mod") {
      const ok = await isModerator(interaction);
      if (!ok) return;
    }

    if (topicId === "superadmin") {
      const ok = await isSuperAdmin(interaction);
      if (!ok) return;
    }

    if (!topic) {
      const response = buildCategoryHelpResponse(category.id);
      await safeUpdate(interaction, {
        ...response,
        content: "Sorry, I don't recognize that help topic. Showing the category menu.",
      });
      return;
    }

    const topicHelpResponse = buildTopicHelpResponse(topicId);
    if (topicHelpResponse) {
      await safeUpdate(interaction, topicHelpResponse);
      return;
    }

    const helpEmbed = buildHelpDetailsEmbed(topic);
    await safeUpdate(interaction, {
      embeds: [helpEmbed],
      components: buildCategoryComponents(category.id, topic.id),
    });
  }

  @SelectMenuComponent({ id: /^(help:rss:|rss-help-select)/ })
  async handleRssHelpButton(interaction: StringSelectMenuInteraction): Promise<void> {
    const parsed = parseHelpCustomId(interaction.customId);
    if (!parsed || parsed.view !== "rss") {
      await sendHelpRefreshPrompt(interaction);
      return;
    }

    const topicId =
      (interaction.values?.[0] as RssHelpTopicId | "help-main" | undefined) ??
      (parsed.state.activeTopicId as RssHelpTopicId | "help-main" | undefined);
    if (topicId === "help-main") {
      const response = buildMainHelpResponse();
      await safeUpdate(interaction, response);
      return;
    }
    const topic = RSS_HELP_TOPICS.find((entry) => entry.id === topicId);

    if (!topic) {
      const response = buildRssHelpResponse(parsed.state.activeTopicId as RssHelpTopicId | undefined);
      await safeUpdate(interaction, {
        ...response,
        content: "Sorry, I don't recognize that RSS help topic. Showing the RSS help menu.",
      });
      return;
    }

    const embed = buildRssHelpEmbed(topic);
    await safeUpdate(interaction, {
      embeds: [embed],
      components: buildRssHelpButtons(topic.id),
    });
  }

  @SelectMenuComponent({ id: /^(help:profile:|profile-help-select)/ })
  async handleProfileHelpButton(interaction: StringSelectMenuInteraction): Promise<void> {
    const parsed = parseHelpCustomId(interaction.customId);
    if (!parsed || parsed.view !== "profile") {
      await sendHelpRefreshPrompt(interaction);
      return;
    }

    const topicId =
      (interaction.values?.[0] as ProfileHelpTopicId | "help-main" | undefined) ??
      (parsed.state.activeTopicId as ProfileHelpTopicId | "help-main" | undefined);
    if (topicId === "help-main") {
      const response = buildMainHelpResponse();
      await safeUpdate(interaction, response);
      return;
    }
    const topic = PROFILE_HELP_TOPICS.find((entry) => entry.id === topicId);

    if (!topic) {
      const response = buildProfileHelpResponse(parsed.state.activeTopicId as ProfileHelpTopicId | undefined);
      await safeUpdate(interaction, {
        ...response,
        content: "Sorry, I don't recognize that profile help topic. Showing the profile help menu.",
      });
      return;
    }

    const embed = buildProfileHelpEmbed(topic);
    await safeUpdate(interaction, {
      embeds: [embed],
      components: buildProfileHelpButtons(topic.id),
    });
  }

  @SelectMenuComponent({ id: /^(help:now-playing:|now-playing-help-select)/ })
  async handleNowPlayingHelpButton(interaction: StringSelectMenuInteraction): Promise<void> {
    const parsed = parseHelpCustomId(interaction.customId);
    if (!parsed || parsed.view !== "now-playing") {
      await sendHelpRefreshPrompt(interaction);
      return;
    }

    const topicId =
      (interaction.values?.[0] as NowPlayingHelpTopicId | "help-main" | undefined) ??
      (parsed.state.activeTopicId as NowPlayingHelpTopicId | "help-main" | undefined);
    if (topicId === "help-main") {
      const response = buildMainHelpResponse();
      await safeUpdate(interaction, response);
      return;
    }
    const topic = NOW_PLAYING_HELP_TOPICS.find((entry) => entry.id === topicId);

    if (!topic) {
      const response = buildNowPlayingHelpResponse(parsed.state.activeTopicId as NowPlayingHelpTopicId | undefined);
      await safeUpdate(interaction, {
        ...response,
        content: "Sorry, I don't recognize that now-playing help topic. Showing the help menu.",
      });
      return;
    }

    const embed = buildNowPlayingHelpEmbed(topic);
    await safeUpdate(interaction, {
      embeds: [embed],
      components: buildNowPlayingHelpButtons(topic.id),
    });
  }

  @SelectMenuComponent({ id: /^(help:gamedb:|gamedb-help-select)/ })
  async handleGamedbHelpButton(interaction: StringSelectMenuInteraction): Promise<void> {
    const parsed = parseHelpCustomId(interaction.customId);
    if (!parsed || parsed.view !== "gamedb") {
      await sendHelpRefreshPrompt(interaction);
      return;
    }

    const topicId =
      (interaction.values?.[0] as GameDbHelpTopicId | "help-main" | undefined) ??
      (parsed.state.activeTopicId as GameDbHelpTopicId | "help-main" | undefined);
    if (topicId === "help-main") {
      const response = buildMainHelpResponse();
      await safeUpdate(interaction, response);
      return;
    }
    const topic = GAMEDB_HELP_TOPICS.find((entry) => entry.id === topicId);

    if (!topic) {
      const response = buildGamedbHelpResponse(parsed.state.activeTopicId as GameDbHelpTopicId | undefined);
      await safeUpdate(interaction, {
        ...response,
        content: "Sorry, I don't recognize that gamedb help topic. Showing the gamedb help menu.",
      });
      return;
    }

    const embed = buildGamedbHelpEmbed(topic);
    await safeUpdate(interaction, {
      embeds: [embed],
      components: buildGamedbHelpButtons(topic.id),
    });
  }

  @SelectMenuComponent({ id: /^(help:game-completion:|game-completion-help-select)/ })
  async handleGameCompletionHelpButton(interaction: StringSelectMenuInteraction): Promise<void> {
    const parsed = parseHelpCustomId(interaction.customId);
    if (!parsed || parsed.view !== "game-completion") {
      await sendHelpRefreshPrompt(interaction);
      return;
    }

    const topicId =
      (interaction.values?.[0] as GameCompletionHelpTopicId | "help-main" | undefined) ??
      (parsed.state.activeTopicId as GameCompletionHelpTopicId | "help-main" | undefined);
    if (topicId === "help-main") {
      const response = buildMainHelpResponse();
      await safeUpdate(interaction, response);
      return;
    }
    const topic = GAME_COMPLETION_HELP_TOPICS.find((entry) => entry.id === topicId);

    if (!topic) {
      const response = buildGameCompletionHelpResponse(
        parsed.state.activeTopicId as GameCompletionHelpTopicId | undefined,
      );
      await safeUpdate(interaction, {
        ...response,
        content: "Sorry, I don't recognize that game-completion help topic. Showing the help menu.",
      });
      return;
    }

    const embed = buildGameCompletionHelpEmbed(topic);
    await safeUpdate(interaction, {
      embeds: [embed],
      components: buildGameCompletionHelpButtons(topic.id),
    });
  }

  @ButtonComponent({ id: /^(help:(refresh|main):|help-main)/ })
  async handleHelpMainButton(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseHelpCustomId(interaction.customId);
    if (!parsed || (parsed.view !== "refresh" && parsed.view !== "main")) {
      await sendHelpRefreshPrompt(interaction);
      return;
    }

    const response = buildMainHelpResponse();
    await safeUpdate(interaction, {
      ...response,
      content: "Help menu refreshed.",
    });
  }
}

function buildTopicHelpResponse(
  topicId: HelpTopicId,
): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
} | null {
  switch (topicId) {
    case "profile":
      return buildProfileHelpResponse();
    case "game-completion":
      return buildGameCompletionHelpResponse();
    case "now-playing":
      return buildNowPlayingHelpResponse();
    case "gamedb":
      return buildGamedbHelpResponse();
    case "rss":
      return buildRssHelpResponse();
    case "admin":
      return buildAdminHelpResponse();
    case "mod":
      return buildModHelpResponse();
    case "superadmin":
      return buildSuperAdminHelpResponse();
    default:
      return null;
  }
}
function buildCategoryComponents(
  categoryId: string,
  activeTopicId?: HelpTopicId,
  includeBackToMain = true,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const category = getCategoryById(categoryId);
  if (!category) return buildMainHelpComponents();

  const topics = category.topicIds
    .map((id) => HELP_TOPICS.find((t) => t.id === id))
    .filter((t): t is HelpTopic => Boolean(t));

  const select = new StringSelectMenuBuilder()
    .setCustomId(buildHelpCustomId("category", { categoryId, activeTopicId }))
    .setPlaceholder(`${category.name} commands`)
    .addOptions(
      topics.map((topic) => ({
        label: topic.label,
        value: topic.id,
        default: topic.id === activeTopicId,
      })),
    );

  if (includeBackToMain) {
    select.addOptions({ label: "Back to Help Main Menu", value: "help-main" });
  }

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

function buildCategoryHelpResponse(
  categoryId: string,
  activeTopicId?: HelpTopicId,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<StringSelectMenuBuilder>[] } {
  const category = getCategoryById(categoryId);
  const topics = category?.topicIds
    .map((id) => HELP_TOPICS.find((t) => t.id === id))
    .filter((t): t is HelpTopic => Boolean(t));

  const embed = new EmbedBuilder()
    .setTitle(`${category?.name ?? "Commands"}`)
    .setDescription(
      topics && topics.length
        ? topics.map((t) => formatCommandLine(t.label, t.summary, 10)).join("\n")
        : "No commands found for this category.",
    );

  return {
    embeds: [embed],
    components: buildCategoryComponents(categoryId, activeTopicId),
  };
}

function buildMainHelpComponents(): ActionRowBuilder<StringSelectMenuBuilder>[] {
  return HELP_CATEGORIES.flatMap((category) =>
    buildCategoryComponents(category.id, undefined, false),
  );
}
