import type { ButtonInteraction, CommandInteraction } from "discord.js";
import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionsBitField,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import {
  ButtonBuilder as V2ButtonBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SectionBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import {
  ButtonComponent,
  Discord,
  ModalComponent,
  SelectMenuComponent,
  Slash,
  SlashChoice,
  SlashOption,
} from "discordx";
import {
  AnyRepliable,
  safeDeferReply,
  safeReply,
  safeUpdate,
  sanitizeUserInput,
} from "../functions/InteractionUtils.js";
import { countSuggestions } from "../classes/Suggestion.js";
import {
  addComment,
  closeIssue,
  reopenIssue,
  createIssue,
  getIssue,
  listAllIssues,
  listIssueComments,
  setIssueLabels,
  updateIssue,
  type IGithubIssueComment,
  type IGithubIssue,
} from "../services/GithubIssuesService.js";
import { COMPONENTS_V2_FLAG } from "../config/flags.js";

const TODO_LABELS = [
  "New Feature",
  "Improvement",
  "Bug",
  "Blocked",
  "refactor",
  "documentation",
  "duplicate",
  "invalid",
  "wontfix",
] as const;
const LIST_STATES = ["open", "closed", "all"] as const;
const LIST_SORTS = ["created", "updated"] as const;
const LIST_DIRECTIONS = ["asc", "desc"] as const;

type TodoLabel = (typeof TODO_LABELS)[number];
type ListState = (typeof LIST_STATES)[number];
type ListSort = (typeof LIST_SORTS)[number];
type ListDirection = (typeof LIST_DIRECTIONS)[number];

const MAX_ISSUE_BODY = 4000;
const MAX_COMMENT_PREVIEW_LENGTH = 500;
const MAX_TODO_IMAGES_PER_VIEW = 10;
const MAX_TEXT_DISPLAY_CONTENT = 4000;
const MAX_COMPONENT_DISPLAYABLE_TEXT_SIZE = 4000;
const DEFAULT_PAGE_SIZE = 9;
const MAX_PAGE_SIZE = 9;
const ISSUE_LIST_TITLE = "RPGClub GameDB GitHub Issues";
const TODO_LIST_ID_PREFIX = "todo-list-page";
const TODO_LIST_BACK_ID_PREFIX = "todo-list-back";
const TODO_VIEW_ID_PREFIX = "todo-view";
const TODO_CREATE_BUTTON_PREFIX = "todo-create-button";
const TODO_CREATE_MODAL_PREFIX = "todo-create-modal";
const TODO_CLOSE_BUTTON_PREFIX = "todo-close-button";
const TODO_CLOSE_SELECT_PREFIX = "todo-close-select";
const TODO_CLOSE_CANCEL_PREFIX = "todo-close-cancel";
const TODO_COMMENT_BUTTON_PREFIX = "todo-comment-button";
const TODO_COMMENT_MODAL_PREFIX = "todo-comment-modal";
const TODO_COMMENT_INPUT_ID = "todo-comment-input";
const TODO_EDIT_TITLE_BUTTON_PREFIX = "todo-edit-title-button";
const TODO_EDIT_TITLE_MODAL_PREFIX = "todo-edit-title-modal";
const TODO_EDIT_TITLE_INPUT_ID = "todo-edit-title-input";
const TODO_EDIT_DESC_BUTTON_PREFIX = "todo-edit-desc-button";
const TODO_EDIT_DESC_MODAL_PREFIX = "todo-edit-desc-modal";
const TODO_EDIT_DESC_INPUT_ID = "todo-edit-desc-input";
const TODO_CLOSE_VIEW_PREFIX = "todo-close-view";
const TODO_REOPEN_VIEW_PREFIX = "todo-reopen-view";
const TODO_LABEL_EDIT_BUTTON_PREFIX = "todo-label-edit-button";
const TODO_LABEL_EDIT_SELECT_PREFIX = "todo-label-edit-select";
const TODO_QUERY_BUTTON_PREFIX = "todo-query-button";
const TODO_QUERY_MODAL_PREFIX = "todo-query-modal";
const TODO_QUERY_INPUT_ID = "todo-query-input";
const TODO_CREATE_TITLE_ID = "todo-create-title";
const TODO_CREATE_BODY_ID = "todo-create-body";
const TODO_CREATE_TYPE_ID = "todo-create-type";
const TODO_PAYLOAD_TOKEN_MAX_LENGTH = 30;
const TODO_CREATE_TYPE_LABELS = [
  "New Feature",
  "Improvement",
  "Bug",
  "Blocked",
] as const;

async function getSuggestionReviewCount(): Promise<number> {
  try {
    return await countSuggestions();
  } catch {
    return 0;
  }
}

type TodoListPayload = {
  page: number;
  perPage: number;
  state: ListState;
  stateFilters: ListState[];
  labels: TodoLabel[];
  excludeBlocked: boolean;
  query?: string;
  sort: ListSort;
  direction: ListDirection;
  isPublic: boolean;
};

const TODO_LABEL_CODE_MAP: Record<TodoLabel, string> = {
  "New Feature": "N",
  Improvement: "I",
  Bug: "B",
  Blocked: "K",
  refactor: "R",
  documentation: "D",
  duplicate: "U",
  invalid: "V",
  wontfix: "W",
};
const TODO_LABEL_CODE_TO_LABEL: Record<string, TodoLabel> = {
  N: "New Feature",
  I: "Improvement",
  B: "Bug",
  K: "Blocked",
  R: "refactor",
  D: "documentation",
  U: "duplicate",
  V: "invalid",
  W: "wontfix",
};

function buildComponentsV2Flags(isEphemeral: boolean): number {
  return (isEphemeral ? MessageFlags.Ephemeral : 0) | COMPONENTS_V2_FLAG;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function encodeTodoLabels(labels: TodoLabel[]): string {
  return labels.map((label) => TODO_LABEL_CODE_MAP[label]).sort().join("");
}

function decodeTodoLabels(value: string): TodoLabel[] {
  if (!value) return [];
  return value
    .split("")
    .map((token) => TODO_LABEL_CODE_TO_LABEL[token])
    .filter((label): label is TodoLabel => Boolean(label));
}

function decodeTodoQuery(encoded: string | undefined): string | undefined {
  if (!encoded) return undefined;
  try {
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    return decoded.length ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function encodeTodoQuery(query: string | undefined, maxLength: number): string {
  if (!query) return "";
  let trimmed = query;
  let encoded = Buffer.from(trimmed, "utf8").toString("base64url");
  if (encoded.length <= maxLength) return encoded;
  for (let i = trimmed.length - 1; i >= 0; i -= 1) {
    trimmed = trimmed.slice(0, i + 1);
    encoded = Buffer.from(trimmed, "utf8").toString("base64url");
    if (encoded.length <= maxLength) return encoded;
  }
  return "";
}

function buildTodoPayloadToken(
  payload: Omit<TodoListPayload, "page">,
  maxLength: number,
): string {
  const stateCode = payload.state === "open"
    ? "o"
    : payload.state === "closed"
      ? "c"
      : "a";
  const sortCode = payload.sort === "created" ? "c" : "u";
  const dirCode = payload.direction === "asc" ? "a" : "d";
  const labelToken = encodeTodoLabels(payload.labels);
  const base = [
    `s${stateCode}`,
    `o${sortCode}`,
    `d${dirCode}`,
    `p${payload.perPage}`,
    `l${labelToken}`,
    `b${payload.excludeBlocked ? "1" : "0"}`,
    `u${payload.isPublic ? "1" : "0"}`,
    "q",
  ].join(";");
  const maxQueryLength = Math.max(maxLength - base.length, 0);
  const queryToken = encodeTodoQuery(payload.query, maxQueryLength);
  return `${base}${queryToken}`;
}

function parseTodoPayloadToken(
  token: string,
): Omit<TodoListPayload, "page"> | null {
  if (!token) return null;
  const parts = token.split(";");
  const map = new Map<string, string>();
  parts.forEach((part) => {
    if (!part) return;
    const key = part.slice(0, 1);
    const value = part.slice(1);
    map.set(key, value);
  });

  const stateCode = map.get("s");
  const sortCode = map.get("o");
  const dirCode = map.get("d");
  if (!stateCode || !sortCode || !dirCode) return null;
  const perPage = Number(map.get("p"));
  const labelToken = map.get("l") ?? "";
  const excludeBlocked = map.get("b") === "1";
  const isPublic = map.get("u") === "1";
  const query = decodeTodoQuery(map.get("q"));

  const state = stateCode === "o" ? "open" : stateCode === "c" ? "closed" : "all";
  const sort = sortCode === "c" ? "created" : "updated";
  const direction = dirCode === "a" ? "asc" : "desc";

  if (!Number.isFinite(perPage) || perPage <= 0) return null;

  const labels = decodeTodoLabels(labelToken);
  const stateFilters = normalizeStateFilters(state === "all" ? ["open", "closed"] : [state]);

  return {
    perPage,
    state,
    stateFilters,
    labels,
    excludeBlocked,
    query,
    sort,
    direction,
    isPublic,
  };
}

function parseTodoLabels(rawValue: string | undefined): {
  labels: TodoLabel[];
  invalid: string[];
} {
  if (!rawValue) {
    return { labels: [], invalid: [] };
  }

  const tokens = rawValue
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  const invalid: string[] = [];
  const labels: TodoLabel[] = [];

  tokens.forEach((token) => {
    const match = TODO_LABELS.find((label) => label.toLowerCase() === token.toLowerCase());
    if (match) {
      if (!labels.includes(match)) {
        labels.push(match);
      }
    } else {
      invalid.push(token);
    }
  });

  return { labels, invalid };
}

function normalizeQuery(rawValue: string | undefined): string | undefined {
  if (!rawValue) return undefined;
  const sanitized = sanitizeTodoText(rawValue, false);
  return sanitized.length ? sanitized : undefined;
}

function matchesIssueQuery(issue: IGithubIssue, query: string): boolean {
  const haystackParts = [
    issue.title,
    issue.body ?? "",
    issue.labels.join(" "),
    issue.author ?? "",
    issue.state,
    String(issue.number),
    issue.createdAt,
    issue.updatedAt,
    issue.closedAt ?? "",
  ];

  const haystack = haystackParts.join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function matchesIssueLabels(issue: IGithubIssue, labels: TodoLabel[]): boolean {
  if (!labels.length) return true;
  const issueLabels = issue.labels.map((label) => label.toLowerCase());
  return labels.some((label) => issueLabels.includes(label.toLowerCase()));
}

function isBlockedIssue(issue: IGithubIssue): boolean {
  const issueLabels = issue.labels.map((label) => label.toLowerCase());
  return issueLabels.includes("blocked");
}

function normalizeStateFilters(filters: ListState[]): ListState[] {
  const normalized = filters.filter((state) => state === "open" || state === "closed");
  if (!normalized.length) {
    return ["open"];
  }
  return Array.from(new Set(normalized));
}

function toIssueState(filters: ListState[]): ListState {
  const normalized = normalizeStateFilters(filters);
  if (normalized.length > 1) return "all";
  return normalized[0] ?? "open";
}

function formatDiscordTimestamp(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return "Unknown";
  return `<t:${Math.floor(ms / 1000)}:f>`;
}

function getTodoPermissionFlags(interaction: AnyRepliable): {
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
  const permissions = getTodoPermissionFlags(interaction);
  if (!permissions) {
    await safeReply(interaction, {
      content: "This command can only be used inside a server.",
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  if (permissions.isOwner || permissions.isAdmin || permissions.isModerator) {
    return true;
  }

  await safeReply(interaction, {
    content: "Access denied. Command requires Moderator, Administrator, or server owner.",
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

async function requireOwner(interaction: AnyRepliable): Promise<boolean> {
  const permissions = getTodoPermissionFlags(interaction);
  if (!permissions) {
    await safeReply(interaction, {
      content: "This command can only be used inside a server.",
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  if (permissions.isOwner) {
    return true;
  }

  await safeReply(interaction, {
    content: "Access denied. Command requires server owner.",
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

function getGithubErrorMessage(error: any): string {
  const status = error?.response?.status as number | undefined;
  const message = error?.response?.data?.message as string | undefined;
  const errorMessage = error?.message as string | undefined;

  const outputParts: string[] = [];
  if (status) {
    outputParts.push(`Github status: ${status}`);
  }
  if (message) {
    outputParts.push(`Github error: ${message}`);
  } else if (errorMessage) {
    outputParts.push(`Github error: ${errorMessage}`);
  }

  if (outputParts.length) {
    return outputParts.join("\n");
  }
  return "GitHub request failed. Check the GitHub App configuration.";
}

function formatIssueLink(issue: IGithubIssue): string {
  const labelText = issue.labels.length ? ` [${issue.labels.join(", ")}]` : "";
  const linkText = `#${issue.number}: ${issue.title}`;
  if (issue.htmlUrl) {
    return `[${linkText}](${issue.htmlUrl})${labelText}`;
  }
  return `${linkText}${labelText}`;
}

function formatIssueTitle(issue: IGithubIssue): string {
  const labelText = issue.labels.length ? ` [${issue.labels.join(", ")}]` : "";
  return `#${issue.number}: ${issue.title}${labelText}`;
}

function formatIssueSelectLabel(issue: IGithubIssue): string {
  const labelText = issue.labels.length ? ` [${issue.labels.join(", ")}]` : "";
  const text = `#${issue.number} ${issue.title}${labelText}`;
  if (text.length <= 100) return text;
  return `${text.slice(0, 97)}...`;
}

function sanitizeTodoText(value: string, preserveNewlines: boolean): string {
  return sanitizeUserInput(value, { preserveNewlines, allowUnderscore: true });
}

function sanitizeTodoRichText(value: string): string {
  return (value ?? "").replace(/\r\n/g, "\n");
}

function extractImageUrlsFromHtml(text: string): string[] {
  const urls: string[] = [];
  const imageTagPattern = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  let match: RegExpExecArray | null = imageTagPattern.exec(text);
  while (match) {
    const raw = match[1] ?? match[2] ?? match[3] ?? "";
    const decoded = raw.replace(/&amp;/gi, "&").trim();
    try {
      const parsed = new URL(decoded);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        urls.push(parsed.toString());
      }
    } catch {
      // ignore invalid image URLs
    }
    match = imageTagPattern.exec(text);
  }
  return urls;
}

function extractImageUrlsFromMarkdown(text: string): string[] {
  const urls: string[] = [];
  const markdownPattern = /!\[[^\]]*]\((https?:\/\/[^)\s]+(?:\s+"[^"]*")?)\)/gi;
  let match: RegExpExecArray | null = markdownPattern.exec(text);
  while (match) {
    const value = match[1] ?? "";
    const trimmed = value.split(" ")[0]?.trim() ?? "";
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        urls.push(parsed.toString());
      }
    } catch {
      // ignore invalid image URLs
    }
    match = markdownPattern.exec(text);
  }
  return urls;
}

function extractTodoImageUrls(text: string): string[] {
  const unique = new Set<string>();
  [...extractImageUrlsFromHtml(text), ...extractImageUrlsFromMarkdown(text)]
    .forEach((url) => unique.add(url));
  return Array.from(unique);
}

function stripInlineImagesForText(value: string): string {
  return value
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/!\[[^\]]*]\((https?:\/\/[^)\s]+(?:\s+"[^"]*")?)\)/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderTodoContent(rawValue: string, maxTextLength: number): {
  text: string;
  imageUrls: string[];
} {
  const imageUrls = extractTodoImageUrls(rawValue);
  const plainText = sanitizeTodoRichText(stripInlineImagesForText(rawValue))
    .slice(0, maxTextLength);
  return {
    text: plainText,
    imageUrls,
  };
}

function clampTextDisplayContent(value: string): string {
  if (value.length <= MAX_TEXT_DISPLAY_CONTENT) {
    return value;
  }
  return `${value.slice(0, MAX_TEXT_DISPLAY_CONTENT - 3)}...`;
}

function trimToBudget(value: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  if (value.length <= maxLength) return value;
  if (maxLength <= 3) return value.slice(0, maxLength);
  return `${value.slice(0, maxLength - 3)}...`;
}

function addTextDisplayWithBudget(
  container: ContainerBuilder,
  budget: { remaining: number },
  content: string,
): void {
  if (budget.remaining <= 0) {
    return;
  }
  const normalized = clampTextDisplayContent(content);
  const clipped = trimToBudget(normalized, budget.remaining);
  if (!clipped.length) {
    return;
  }
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(clipped));
  budget.remaining -= clipped.length;
}

function buildIssueCommentsDisplay(comments: IGithubIssueComment[]): {
  text: string;
  imageUrls: string[];
} {
  if (!comments.length) {
    return { text: "", imageUrls: [] };
  }

  const lines: string[] = ["**Comments:**"];
  const imageUrls: string[] = [];
  comments.forEach((comment) => {
    const author = comment.author ?? "Unknown";
    const createdAt = formatDiscordTimestamp(comment.createdAt);
    const rendered = renderTodoContent(comment.body, MAX_COMMENT_PREVIEW_LENGTH);
    imageUrls.push(...rendered.imageUrls);
    lines.push(`**${author}** ${createdAt}`);
    if (rendered.text) {
      lines.push(rendered.text);
    } else if (rendered.imageUrls.length) {
      lines.push("*Image-only comment.*");
    } else {
      lines.push("*No comment content.*");
    }
  });

  return {
    text: lines.join("\n"),
    imageUrls,
  };
}

function addIssueImagesToContainer(
  container: ContainerBuilder,
  imageUrls: string[],
  budget?: { remaining: number },
): void {
  const uniqueImages = Array.from(new Set(imageUrls)).slice(0, MAX_TODO_IMAGES_PER_VIEW);
  if (!uniqueImages.length) return;

  const galleryItems = uniqueImages.map((url, index) =>
    new MediaGalleryItemBuilder()
      .setURL(url)
      .setDescription(`Issue image ${index + 1}`),
  );
  if (budget) {
    addTextDisplayWithBudget(container, budget, "### Images");
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("### Images"),
    );
  }
  container.addMediaGalleryComponents(
    new MediaGalleryBuilder().addItems(galleryItems),
  );
}

function buildTodoListCustomId(payloadToken: string, page: number): string {
  return [TODO_LIST_ID_PREFIX, payloadToken, page].join(":");
}

function buildTodoListBackId(payloadToken: string, page: number): string {
  return [TODO_LIST_BACK_ID_PREFIX, payloadToken, page].join(":");
}

function buildTodoCreateButtonId(payloadToken: string, page: number): string {
  return [TODO_CREATE_BUTTON_PREFIX, payloadToken, page].join(":");
}

function buildTodoCreateModalId(
  payloadToken: string,
  page: number,
  channelId: string,
  messageId: string,
): string {
  return [TODO_CREATE_MODAL_PREFIX, payloadToken, page, channelId, messageId].join(":");
}

function buildTodoCloseButtonId(payloadToken: string, page: number): string {
  return [TODO_CLOSE_BUTTON_PREFIX, payloadToken, page].join(":");
}

function buildTodoCloseSelectId(
  payloadToken: string,
  page: number,
  channelId: string,
  messageId: string,
): string {
  return [TODO_CLOSE_SELECT_PREFIX, payloadToken, page, channelId, messageId].join(":");
}

function buildTodoCloseCancelId(payloadToken: string, page: number): string {
  return [TODO_CLOSE_CANCEL_PREFIX, payloadToken, page].join(":");
}

function buildTodoCommentButtonId(payloadToken: string, page: number, issueNumber: number): string {
  return [TODO_COMMENT_BUTTON_PREFIX, payloadToken, page, issueNumber].join(":");
}

function buildTodoCommentModalId(
  payloadToken: string,
  page: number,
  issueNumber: number,
  channelId: string,
  messageId: string,
): string {
  return [TODO_COMMENT_MODAL_PREFIX, payloadToken, page, issueNumber, channelId, messageId].join(":");
}

function buildTodoEditTitleButtonId(
  payloadToken: string,
  page: number,
  issueNumber: number,
): string {
  return [TODO_EDIT_TITLE_BUTTON_PREFIX, payloadToken, page, issueNumber].join(":");
}

function buildTodoEditTitleModalId(
  payloadToken: string,
  page: number,
  issueNumber: number,
  channelId: string,
  messageId: string,
): string {
  return [TODO_EDIT_TITLE_MODAL_PREFIX, payloadToken, page, issueNumber, channelId, messageId].join(":");
}

function buildTodoEditDescButtonId(
  payloadToken: string,
  page: number,
  issueNumber: number,
): string {
  return [TODO_EDIT_DESC_BUTTON_PREFIX, payloadToken, page, issueNumber].join(":");
}

function buildTodoEditDescModalId(
  payloadToken: string,
  page: number,
  issueNumber: number,
  channelId: string,
  messageId: string,
): string {
  return [TODO_EDIT_DESC_MODAL_PREFIX, payloadToken, page, issueNumber, channelId, messageId].join(":");
}

function buildTodoCloseViewId(payloadToken: string, page: number, issueNumber: number): string {
  return [TODO_CLOSE_VIEW_PREFIX, payloadToken, page, issueNumber].join(":");
}

function buildTodoReopenViewId(payloadToken: string, page: number, issueNumber: number): string {
  return [TODO_REOPEN_VIEW_PREFIX, payloadToken, page, issueNumber].join(":");
}

function buildTodoLabelEditButtonId(
  payloadToken: string,
  page: number,
  issueNumber: number,
): string {
  return [TODO_LABEL_EDIT_BUTTON_PREFIX, payloadToken, page, issueNumber].join(":");
}

function buildTodoLabelEditSelectId(
  payloadToken: string,
  page: number,
  issueNumber: number,
  channelId: string,
  messageId: string,
): string {
  return [TODO_LABEL_EDIT_SELECT_PREFIX, payloadToken, page, issueNumber, channelId, messageId].join(":");
}

function buildTodoQueryButtonId(payloadToken: string, page: number): string {
  return [TODO_QUERY_BUTTON_PREFIX, payloadToken, page].join(":");
}

function buildTodoQueryModalId(
  payloadToken: string,
  page: number,
  channelId: string,
  messageId: string,
): string {
  return [TODO_QUERY_MODAL_PREFIX, payloadToken, page, channelId, messageId].join(":");
}

function buildTodoViewId(payloadToken: string, page: number, issueNumber: number): string {
  return [TODO_VIEW_ID_PREFIX, payloadToken, page, issueNumber].join(":");
}

function parseTodoListCustomId(id: string): { payloadToken: string; page: number } | null {
  const parts = id.split(":");
  if (parts.length !== 3 || parts[0] !== TODO_LIST_ID_PREFIX) {
    return null;
  }

  const payloadToken = parts[1];
  const page = Number(parts[2]);
  if (!payloadToken || !page) {
    return null;
  }

  return { payloadToken, page };
}

function parseTodoListBackId(id: string): { payloadToken: string; page: number } | null {
  const parts = id.split(":");
  if (parts.length !== 3 || parts[0] !== TODO_LIST_BACK_ID_PREFIX) {
    return null;
  }

  const payloadToken = parts[1];
  const page = Number(parts[2]);
  if (!payloadToken || !page) {
    return null;
  }

  return { payloadToken, page };
}

function parseTodoCreateButtonId(
  id: string,
  prefix: string,
): { payloadToken: string; page: number } | null {
  const parts = id.split(":");
  if (parts.length !== 3 || parts[0] !== prefix) {
    return null;
  }

  const payloadToken = parts[1];
  const page = Number(parts[2]);
  if (!payloadToken || !page) {
    return null;
  }

  return { payloadToken, page };
}

function parseTodoCreateModalId(
  id: string,
  prefix: string,
): { payloadToken: string; page: number; channelId: string; messageId: string } | null {
  const parts = id.split(":");
  if (parts.length !== 5 || parts[0] !== prefix) {
    return null;
  }

  const payloadToken = parts[1];
  const page = Number(parts[2]);
  const channelId = parts[3];
  const messageId = parts[4];
  if (!payloadToken || !page || !channelId || !messageId) {
    return null;
  }

  return { payloadToken, page, channelId, messageId };
}

function parseTodoCloseId(
  id: string,
  prefix: string,
): { payloadToken: string; page: number } | null {
  const parts = id.split(":");
  if (parts.length !== 3 || parts[0] !== prefix) {
    return null;
  }

  const payloadToken = parts[1];
  const page = Number(parts[2]);
  if (!payloadToken || !page) {
    return null;
  }

  return { payloadToken, page };
}

function parseTodoCloseSelectId(
  id: string,
  prefix: string,
): { payloadToken: string; page: number; channelId: string; messageId: string } | null {
  const parts = id.split(":");
  if (parts.length !== 5 || parts[0] !== prefix) {
    return null;
  }

  const payloadToken = parts[1];
  const page = Number(parts[2]);
  const channelId = parts[3];
  const messageId = parts[4];
  if (!payloadToken || !page || !channelId || !messageId) {
    return null;
  }

  return { payloadToken, page, channelId, messageId };
}

function parseTodoViewId(
  id: string,
): { payloadToken: string; page: number; issueNumber: number } | null {
  const parts = id.split(":");
  if (parts.length !== 4 || parts[0] !== TODO_VIEW_ID_PREFIX) {
    return null;
  }

  const payloadToken = parts[1];
  const page = Number(parts[2]);
  const issueNumber = Number(parts[3]);
  if (!payloadToken || !page || !issueNumber) {
    return null;
  }

  return { payloadToken, page, issueNumber };
}

function parseTodoIssueActionId(
  id: string,
  prefix: string,
): { payloadToken: string; page: number; issueNumber: number } | null {
  const parts = id.split(":");
  if (parts.length !== 4 || parts[0] !== prefix) {
    return null;
  }

  const payloadToken = parts[1];
  const page = Number(parts[2]);
  const issueNumber = Number(parts[3]);
  if (!payloadToken || !page || !issueNumber) {
    return null;
  }

  return { payloadToken, page, issueNumber };
}

function parseTodoIssueModalId(
  id: string,
  prefix: string,
): { payloadToken: string; page: number; issueNumber: number; channelId: string; messageId: string } | null {
  const parts = id.split(":");
  if (parts.length !== 6 || parts[0] !== prefix) {
    return null;
  }

  const payloadToken = parts[1];
  const page = Number(parts[2]);
  const issueNumber = Number(parts[3]);
  const channelId = parts[4];
  const messageId = parts[5];
  if (!payloadToken || !page || !issueNumber || !channelId || !messageId) {
    return null;
  }

  return { payloadToken, page, issueNumber, channelId, messageId };
}

function parseTodoCloseViewId(
  id: string,
  prefix: string,
): { payloadToken: string; page: number; issueNumber: number } | null {
  return parseTodoIssueActionId(id, prefix);
}

function parseTodoReopenViewId(
  id: string,
  prefix: string,
): { payloadToken: string; page: number; issueNumber: number } | null {
  return parseTodoIssueActionId(id, prefix);
}

function parseTodoLabelEditId(
  id: string,
  prefix: string,
): { payloadToken: string; page: number; issueNumber: number } | null {
  return parseTodoIssueActionId(id, prefix);
}

function parseTodoLabelEditSelectId(
  id: string,
  prefix: string,
): { payloadToken: string; page: number; issueNumber: number; channelId: string; messageId: string } | null {
  return parseTodoIssueModalId(id, prefix);
}

function parseTodoQueryId(
  id: string,
  prefix: string,
): { payloadToken: string; page: number } | null {
  const parts = id.split(":");
  if (parts.length !== 3 || parts[0] !== prefix) {
    return null;
  }

  const payloadToken = parts[1];
  const page = Number(parts[2]);
  if (!payloadToken || !page) {
    return null;
  }

  return { payloadToken, page };
}

function parseTodoQueryModalId(
  id: string,
  prefix: string,
): { payloadToken: string; page: number; channelId: string; messageId: string } | null {
  const parts = id.split(":");
  if (parts.length !== 5 || parts[0] !== prefix) {
    return null;
  }

  const payloadToken = parts[1];
  const page = Number(parts[2]);
  const channelId = parts[3];
  const messageId = parts[4];
  if (!payloadToken || !page || !channelId || !messageId) {
    return null;
  }

  return { payloadToken, page, channelId, messageId };
}

function parseTodoFilterId(
  id: string,
  prefix: string,
): { payloadToken: string; page: number } | null {
  const parts = id.split(":");
  if (parts.length !== 3 || parts[0] !== prefix) {
    return null;
  }

  const payloadToken = parts[1];
  const page = Number(parts[2]);
  if (!payloadToken || !page) {
    return null;
  }

  return { payloadToken, page };
}

function parseTodoCreateTypeLabels(values: readonly string[]): TodoLabel[] {
  const validValues = new Set(TODO_CREATE_TYPE_LABELS);
  return values
    .filter((value): value is (typeof TODO_CREATE_TYPE_LABELS)[number] => validValues.has(
      value as (typeof TODO_CREATE_TYPE_LABELS)[number],
    ))
    .filter((value, index, arr) => arr.indexOf(value) === index);
}

async function replyTodoExpired(interaction: AnyRepliable): Promise<void> {
  await safeReply(interaction, {
    content: "This /todo view expired. Run /todo again to refresh it.",
    flags: MessageFlags.Ephemeral,
  });
}

function buildIssueListComponents(
  issues: IGithubIssue[],
  totalIssues: number,
  payload: TodoListPayload,
  payloadToken: string,
  suggestionCount: number,
): { components: Array<ContainerBuilder | ActionRowBuilder<any>> } {
  const totalPages = Math.max(1, Math.ceil(totalIssues / payload.perPage));
  const labelSummary = payload.excludeBlocked
    ? "Label: Not Blocked"
    : payload.labels.length
      ? `Label: ${payload.labels.join(", ")}`
      : "Label: Any";
  const summaryParts = [
    `-# State: ${payload.state}`,
    labelSummary,
    payload.query ? `Query: ${payload.query}` : "Query: Any",
    `Sort: ${payload.sort} ${payload.direction}`,
    `Page: ${payload.page} of ${totalPages}`,
  ];
  if (suggestionCount > 0) {
    summaryParts.push(`${suggestionCount} suggestions awaiting review`);
  }

  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${ISSUE_LIST_TITLE}`));

  if (issues.length) {
    issues.forEach((issue) => {
      const section = new SectionBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(formatIssueLink(issue)),
      );
      section.setButtonAccessory(
        new V2ButtonBuilder()
          .setCustomId(buildTodoViewId(payloadToken, payload.page, issue.number))
          .setLabel("View")
          .setStyle(ButtonStyle.Primary),
      );
      container.addSectionComponents(section);
    });
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("No issues found for this filter."),
    );
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${summaryParts.join(" | ")} | Total: ${totalIssues}`,
    ),
  );

  const labelSelect = new StringSelectMenuBuilder()
    .setCustomId(`todo-filter-label:${payloadToken}:${payload.page}`)
    .setPlaceholder("Filter by Label...")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      [
        {
          label: "All Issues",
          value: "all",
          default: payload.labels.length === 0 && !payload.excludeBlocked,
        },
        {
          label: "Not Blocked",
          value: "not-blocked",
          default: payload.excludeBlocked,
        },
        ...TODO_LABELS.map((label) => ({
          label,
          value: label,
          default: payload.labels.includes(label),
        })),
      ],
    );
  const labelRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(labelSelect);

  const queryButton = new ButtonBuilder()
    .setCustomId(buildTodoQueryButtonId(payloadToken, payload.page))
    .setLabel(payload.query ? "Edit Query" : "Filter by Query")
    .setStyle(ButtonStyle.Secondary);

  const createButton = new ButtonBuilder()
    .setCustomId(buildTodoCreateButtonId(payloadToken, payload.page))
    .setLabel("Create Issue")
    .setStyle(ButtonStyle.Success);

  const closeButton = new ButtonBuilder()
    .setCustomId(buildTodoCloseButtonId(payloadToken, payload.page))
    .setLabel("Close Issue")
    .setStyle(ButtonStyle.Danger);

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    createButton,
    closeButton,
    queryButton,
  );

  const components: Array<ContainerBuilder | ActionRowBuilder<any>> = [
    container,
    labelRow,
    actionRow,
  ];
  if (totalPages > 1) {
    const prevDisabled = payload.page <= 1;
    const nextDisabled = payload.page >= totalPages;
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId(buildTodoListCustomId(payloadToken, payload.page - 1))
        .setLabel("Prev Page")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(prevDisabled),
      new ButtonBuilder()
        .setCustomId(buildTodoListCustomId(payloadToken, payload.page + 1))
        .setLabel("Next Page")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(nextDisabled),
    );
  }

  return { components };
}

function buildIssueViewComponents(
  issue: IGithubIssue,
  comments: IGithubIssueComment[],
  payload: TodoListPayload,
  payloadToken: string,
): { components: Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>> } {
  const container = new ContainerBuilder();
  const textBudget = { remaining: MAX_COMPONENT_DISPLAYABLE_TEXT_SIZE };
  const titleText = issue.htmlUrl
    ? `## [${formatIssueTitle(issue)}](${issue.htmlUrl})`
    : `## ${formatIssueTitle(issue)}`;
  addTextDisplayWithBudget(container, textBudget, titleText);

  const issueBody = issue.body ?? "";
  const renderedBody = renderTodoContent(issueBody, MAX_ISSUE_BODY);
  if (renderedBody.text) {
    addTextDisplayWithBudget(container, textBudget, renderedBody.text);
  } else {
    addTextDisplayWithBudget(container, textBudget, "*No description provided.*");
  }

  const commentsDisplay = buildIssueCommentsDisplay(comments);
  if (commentsDisplay.text) {
    addTextDisplayWithBudget(container, textBudget, commentsDisplay.text);
  }
  addIssueImagesToContainer(
    container,
    [...renderedBody.imageUrls, ...commentsDisplay.imageUrls],
    textBudget,
  );

  const assignee = issue.assignee ?? "Unassigned";
  const footerLine = [
    `-# **State:** ${issue.state}`,
    `**Author:** ${issue.author ?? "Unknown"}`,
    `**Assignee:** ${assignee}`,
    `**Created:** ${formatDiscordTimestamp(issue.createdAt)}`,
    `**Updated:** ${formatDiscordTimestamp(issue.updatedAt)}`,
  ].join(" | ");
  addTextDisplayWithBudget(container, textBudget, footerLine);

  const isOpen = issue.state === "open";
  const stateButton = isOpen
    ? new ButtonBuilder()
        .setCustomId(buildTodoCloseViewId(payloadToken, payload.page, issue.number))
        .setLabel("Close Issue")
        .setStyle(ButtonStyle.Danger)
    : new ButtonBuilder()
        .setCustomId(buildTodoReopenViewId(payloadToken, payload.page, issue.number))
        .setLabel("Reopen Issue")
        .setStyle(ButtonStyle.Success);

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildTodoCommentButtonId(payloadToken, payload.page, issue.number))
      .setLabel("Add Comment")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(buildTodoEditTitleButtonId(payloadToken, payload.page, issue.number))
      .setLabel("Edit Title")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildTodoEditDescButtonId(payloadToken, payload.page, issue.number))
      .setLabel("Edit Description")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildTodoLabelEditButtonId(payloadToken, payload.page, issue.number))
      .setLabel("Add/Edit Labels")
      .setStyle(ButtonStyle.Secondary),
    stateButton,
  );

  const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildTodoListBackId(payloadToken, payload.page))
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary),
  );

  return { components: [container, actionRow, backRow] };
}

@Discord()
export class TodoCommand {
  @Slash({ description: "List GitHub issues", name: "todo" })
  async list(
    @SlashOption({
      description: "Search text in any issue field",
      name: "query",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    queryRaw: string | undefined,
    @SlashChoice(...LIST_STATES)
    @SlashOption({
      description: "Issue state",
      name: "state",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    state: ListState | undefined,
    @SlashOption({
      description: "Filter by labels (comma-separated)",
      name: "labels",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    labelsRaw: string | undefined,
    @SlashChoice(...LIST_SORTS)
    @SlashOption({
      description: "Sort order",
      name: "sort",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    sort: ListSort | undefined,
    @SlashChoice(...LIST_DIRECTIONS)
    @SlashOption({
      description: "Sort direction",
      name: "direction",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    direction: ListDirection | undefined,
    @SlashOption({
      description: "Page number",
      name: "page",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    page: number | undefined,
    @SlashOption({
      description: "Results per page",
      name: "per_page",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    perPage: number | undefined,
    @SlashOption({
      description: "Show in chat (public) instead of ephemeral",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const isPublic = showInChat !== false;
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(!isPublic) });

    const resolvedPerPage = clampNumber(perPage ?? DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
    const parsedLabels = parseTodoLabels(labelsRaw);
    const query = normalizeQuery(queryRaw);
    if (parsedLabels.invalid.length) {
      await safeReply(interaction, {
        content:
          "Unknown labels: " +
          parsedLabels.invalid.join(", ") +
          `. Valid labels: ${TODO_LABELS.join(", ")}.`,
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const initialStateFilters = normalizeStateFilters(
      state === "all" ? ["open", "closed"] : [state ?? "open"],
    );
    const effectiveState = toIssueState(initialStateFilters);

    let issues: IGithubIssue[];
    try {
      issues = await listAllIssues({
        state: effectiveState,
        sort: sort ?? "updated",
        direction: direction ?? "desc",
      });
    } catch (err: any) {
      await safeReply(interaction, {
        content: getGithubErrorMessage(err),
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (parsedLabels.labels.length) {
      issues = issues.filter((issue) => matchesIssueLabels(issue, parsedLabels.labels));
    }
    if (query) {
      issues = issues.filter((issue) => matchesIssueQuery(issue, query));
    }

    const totalIssues = issues.length;
    const totalPages = Math.max(1, Math.ceil(totalIssues / resolvedPerPage));
    const resolvedPage = clampNumber(page ?? 1, 1, totalPages);
    const startIndex = (resolvedPage - 1) * resolvedPerPage;
    const pageIssues = issues.slice(startIndex, startIndex + resolvedPerPage);

    const payload: TodoListPayload = {
      page: resolvedPage,
      perPage: resolvedPerPage,
      state: effectiveState,
      stateFilters: initialStateFilters,
      labels: parsedLabels.labels,
      excludeBlocked: parsedLabels.labels.length === 0,
      query,
      sort: sort ?? "updated",
      direction: direction ?? "desc",
      isPublic,
    };
    const suggestionCount = await getSuggestionReviewCount();
    const payloadToken = buildTodoPayloadToken({
      perPage: payload.perPage,
      state: payload.state,
      stateFilters: payload.stateFilters,
      labels: payload.labels,
      excludeBlocked: payload.excludeBlocked,
      query: payload.query,
      sort: payload.sort,
      direction: payload.direction,
      isPublic: payload.isPublic,
    }, TODO_PAYLOAD_TOKEN_MAX_LENGTH);
    const listPayload = buildIssueListComponents(
      pageIssues,
      totalIssues,
      payload,
      payloadToken,
      suggestionCount,
    );

    await safeReply(interaction, {
      components: listPayload.components,
      flags: buildComponentsV2Flags(!isPublic),
      allowedMentions: { parse: [] },
    });

  }

  private async buildTodoListPayload(
    payloadToken: string,
    page: number,
  ): Promise<{
    components: Array<ContainerBuilder | ActionRowBuilder<any>>;
    payload: TodoListPayload;
    pageIssues: IGithubIssue[];
  } | null> {
    const basePayload = parseTodoPayloadToken(payloadToken);
    if (!basePayload) return null;

    const payload: TodoListPayload = {
      ...basePayload,
      page,
    };
    const safePerPage = clampNumber(payload.perPage, 1, MAX_PAGE_SIZE);
    if (safePerPage !== payload.perPage) {
      payload.perPage = safePerPage;
      payload.perPage = safePerPage;
    }

    let issues: IGithubIssue[];
    try {
      issues = await listAllIssues({
        state: payload.state,
        sort: payload.sort,
        direction: payload.direction,
      });
    } catch {
      return null;
    }

    if (payload.excludeBlocked) {
      issues = issues.filter((issue) => !isBlockedIssue(issue));
    }
    if (payload.labels.length) {
      issues = issues.filter((issue) => matchesIssueLabels(issue, payload.labels));
    }
    if (payload.query) {
      issues = issues.filter((issue) => matchesIssueQuery(issue, payload.query as string));
    }

    const totalIssues = issues.length;
    const totalPages = Math.max(1, Math.ceil(totalIssues / payload.perPage));
    const safePage = clampNumber(payload.page, 1, totalPages);
    const startIndex = (safePage - 1) * payload.perPage;
    const pageIssues = issues.slice(startIndex, startIndex + payload.perPage);

    const suggestionCount = await getSuggestionReviewCount();
    const updatedPayload: TodoListPayload = { ...payload, page: safePage };
    const nextToken = buildTodoPayloadToken({
      perPage: updatedPayload.perPage,
      state: updatedPayload.state,
      stateFilters: updatedPayload.stateFilters,
      labels: updatedPayload.labels,
      excludeBlocked: updatedPayload.excludeBlocked,
      query: updatedPayload.query,
      sort: updatedPayload.sort,
      direction: updatedPayload.direction,
      isPublic: updatedPayload.isPublic,
    }, TODO_PAYLOAD_TOKEN_MAX_LENGTH);
    const listPayload = buildIssueListComponents(
      pageIssues,
      totalIssues,
      updatedPayload,
      nextToken,
      suggestionCount,
    );

    return {
      components: listPayload.components,
      payload: updatedPayload,
      pageIssues,
    };
  }

  private async renderTodoListPage(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    payloadToken: string,
    page: number,
  ): Promise<void> {
    const listPayload = await this.buildTodoListPayload(payloadToken, page);
    if (!listPayload) {
      await replyTodoExpired(interaction);
      return;
    }

    await safeUpdate(interaction, {
      components: listPayload.components,
      flags: buildComponentsV2Flags(!listPayload.payload.isPublic),
    });
  }

  @ButtonComponent({ id: /^todo-list-page:[^:]+:\d+$/ })
  async listPage(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoListCustomId(interaction.customId);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }
    await this.renderTodoListPage(interaction, parsed.payloadToken, parsed.page);
  }

  @ButtonComponent({ id: /^todo-list-back:[^:]+:\d+$/ })
  async listBack(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoListBackId(interaction.customId);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }
    await this.renderTodoListPage(interaction, parsed.payloadToken, parsed.page);
  }

  @ButtonComponent({ id: /^todo-create-button:[^:]+:\d+$/ })
  async createFromList(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoCreateButtonId(interaction.customId, TODO_CREATE_BUTTON_PREFIX);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }

    const ok = await requireModeratorOrAdminOrOwner(interaction);
    if (!ok) return;

    const modal = new ModalBuilder()
      .setCustomId(
        buildTodoCreateModalId(
          parsed.payloadToken,
          parsed.page,
          interaction.channelId,
          interaction.message?.id ?? "",
        ),
      )
      .setTitle("Create GitHub Issue");

    const titleInput = new TextInputBuilder()
      .setCustomId(TODO_CREATE_TITLE_ID)
      .setLabel("Title")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(256);

    const bodyInput = new TextInputBuilder()
      .setCustomId(TODO_CREATE_BODY_ID)
      .setLabel("Description")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(MAX_ISSUE_BODY);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(bodyInput),
    );
    modal.addLabelComponents((label) =>
      label
        .setLabel("Issue Type(s)")
        .setDescription("Select one or more issue types")
        .setStringSelectMenuComponent((builder) =>
          builder
            .setCustomId(TODO_CREATE_TYPE_ID)
            .setPlaceholder("Select type(s)")
            .setMinValues(1)
            .setMaxValues(TODO_CREATE_TYPE_LABELS.length)
            .addOptions(
              TODO_CREATE_TYPE_LABELS.map((typeLabel) => ({
                label: typeLabel,
                value: typeLabel,
              })),
            )),
    );

    await interaction.showModal(modal);
  }

  @ButtonComponent({ id: /^todo-close-button:[^:]+:\d+$/ })
  async closeFromList(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoCloseId(interaction.customId, TODO_CLOSE_BUTTON_PREFIX);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    const listPayload = await this.buildTodoListPayload(parsed.payloadToken, parsed.page);
    if (!listPayload) {
      await replyTodoExpired(interaction);
      return;
    }
    if (listPayload.pageIssues.length === 0) {
      await safeReply(interaction, {
        content: "No issues to close on this page.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const channelId = interaction.channelId;
    const messageId = interaction.message?.id ?? "";
    const select = new StringSelectMenuBuilder()
      .setCustomId(buildTodoCloseSelectId(parsed.payloadToken, parsed.page, channelId, messageId))
      .setPlaceholder("Select an issue to close")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        listPayload.pageIssues.map((issue) => ({
          label: formatIssueSelectLabel(issue),
          value: String(issue.number),
        })),
      );
    const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

    const cancelRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildTodoCloseCancelId(parsed.payloadToken, parsed.page))
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    );

    await safeReply(interaction, {
      content: "Choose an issue to close.",
      components: [selectRow, cancelRow],
      flags: MessageFlags.Ephemeral,
    });
  }

  @SelectMenuComponent({ id: /^todo-filter-label:[^:]+:\d+$/ })
  async filterLabel(interaction: StringSelectMenuInteraction): Promise<void> {
    const parsed = parseTodoFilterId(interaction.customId, "todo-filter-label");
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }

    const basePayload = parseTodoPayloadToken(parsed.payloadToken);
    if (!basePayload) {
      await replyTodoExpired(interaction);
      return;
    }

    const selected = interaction.values[0];
    if (selected === "all") {
      basePayload.labels = [];
      basePayload.excludeBlocked = false;
    } else if (selected === "not-blocked") {
      basePayload.labels = [];
      basePayload.excludeBlocked = true;
    } else {
      basePayload.labels = selected && TODO_LABELS.includes(selected as TodoLabel)
        ? [selected as TodoLabel]
        : [];
      basePayload.excludeBlocked = false;
    }

    const nextToken = buildTodoPayloadToken(basePayload, TODO_PAYLOAD_TOKEN_MAX_LENGTH);
    await this.renderTodoListPage(interaction, nextToken, 1);
  }


  @SelectMenuComponent({ id: /^todo-close-select:[^:]+:\d+:\d+:\d+$/ })
  async closeSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const parsed = parseTodoCloseSelectId(interaction.customId, TODO_CLOSE_SELECT_PREFIX);
    if (!parsed) {
      await safeUpdate(interaction, {
        components: [],
        content: "This close menu expired.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await interaction.deferUpdate();
    } catch {
      // ignore
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    const issueNumber = Number(interaction.values[0]);
    if (!issueNumber) {
      await safeUpdate(interaction, {
        content: "Invalid issue selection.",
        components: [],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let closed: IGithubIssue | null;
    try {
      closed = await closeIssue(issueNumber);
    } catch (err: any) {
      await safeUpdate(interaction, {
        content: getGithubErrorMessage(err),
        components: [],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!closed) {
      await safeUpdate(interaction, {
        content: `Issue #${issueNumber} was not found.`,
        components: [],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const listPayload = await this.buildTodoListPayload(parsed.payloadToken, parsed.page);
    if (!listPayload) {
      return;
    }

    const channel = interaction.client.channels.cache.get(parsed.channelId);
    if (!channel || !("messages" in channel)) {
      return;
    }

    try {
      const message = await (channel as any).messages.fetch(parsed.messageId);
      await message.edit({
        components: listPayload.components,
      });
    } catch {
      // ignore refresh failures
    }

    try {
      await interaction.deleteReply();
    } catch {
      // ignore
    }
  }

  @SelectMenuComponent({ id: /^todo-label-edit-select:[^:]+:\d+:\d+:\d+:\d+$/ })
  async labelEditSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const parsed = parseTodoLabelEditSelectId(interaction.customId, TODO_LABEL_EDIT_SELECT_PREFIX);
    if (!parsed) {
      await safeReply(interaction, {
        content: "This label editor expired.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const ok = await requireModeratorOrAdminOrOwner(interaction);
    if (!ok) return;

    try {
      await interaction.deferUpdate();
    } catch {
      // ignore
    }

    const selectedLabels = interaction.values
      .map((value) => TODO_LABELS.find((label) => label === value))
      .filter((label): label is TodoLabel => Boolean(label));

    let updated: IGithubIssue | null;
    try {
      updated = await setIssueLabels(parsed.issueNumber, selectedLabels);
    } catch (err: any) {
      await safeUpdate(interaction, {
        content: getGithubErrorMessage(err),
        components: [],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!updated) {
      await safeUpdate(interaction, {
        content: `Issue #${parsed.issueNumber} was not found.`,
        components: [],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let issue: IGithubIssue | null;
    let comments: IGithubIssueComment[] = [];
    try {
      issue = await getIssue(parsed.issueNumber);
      if (issue) {
        comments = await listIssueComments(parsed.issueNumber);
      }
    } catch {
      issue = null;
    }

    if (issue) {
      const basePayload = parseTodoPayloadToken(parsed.payloadToken);
      if (!basePayload) {
        try {
          await interaction.deleteReply();
        } catch {
          // ignore
        }
        return;
      }
      const payload: TodoListPayload = { ...basePayload, page: parsed.page };

      const viewPayload = buildIssueViewComponents(
        issue,
        comments,
        payload,
        parsed.payloadToken,
      );

      const channel = interaction.client.channels.cache.get(parsed.channelId);
      if (channel && "messages" in channel) {
        try {
          const message = await (channel as any).messages.fetch(parsed.messageId);
          await message.edit({
            components: viewPayload.components,
          });
        } catch {
          // ignore refresh failures
        }
      }
    }

    try {
      await interaction.deleteReply();
    } catch {
      // ignore
    }
  }

  @ButtonComponent({ id: /^todo-close-cancel:[^:]+:\d+$/ })
  async closeCancel(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoCloseId(interaction.customId, TODO_CLOSE_CANCEL_PREFIX);
    if (!parsed) {
      await safeUpdate(interaction, {
        components: [],
        content: "This close menu expired.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await safeUpdate(interaction, {
      content: "Close issue cancelled.",
      components: [],
      flags: MessageFlags.Ephemeral,
    });
  }

  @ModalComponent({ id: /^todo-create-modal:[^:]+:\d+:\d+:\d+$/ })
  async submitCreateModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseTodoCreateModalId(interaction.customId, TODO_CREATE_MODAL_PREFIX);
    if (!parsed) {
      await safeReply(interaction, {
        content: "This create form expired.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const ok = await requireModeratorOrAdminOrOwner(interaction);
    if (!ok) return;

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const rawTitle = interaction.fields.getTextInputValue(TODO_CREATE_TITLE_ID);
    const rawBody = interaction.fields.getTextInputValue(TODO_CREATE_BODY_ID);
    const selectedTypes = parseTodoCreateTypeLabels(
      interaction.fields.getStringSelectValues(TODO_CREATE_TYPE_ID),
    );
    const trimmedTitle = sanitizeTodoRichText(rawTitle).trim();
    if (!trimmedTitle) {
      await safeReply(interaction, {
        content: "Title cannot be empty.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const trimmedBody = rawBody
      ? sanitizeTodoRichText(rawBody)
      : "";
    if (!trimmedBody.trim()) {
      await safeReply(interaction, {
        content: "Description cannot be empty.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (selectedTypes.length === 0) {
      await safeReply(interaction, {
        content: "Select at least one issue type.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const baseBody = trimmedBody;
    const isOwner = interaction.guild?.ownerId === interaction.user.id;
    const prefixedBody = isOwner ? baseBody : `${interaction.user.username}: ${baseBody}`;
    const finalBody = prefixedBody.length ? prefixedBody.slice(0, MAX_ISSUE_BODY) : null;

    try {
      await createIssue({
        title: trimmedTitle,
        body: finalBody,
        labels: selectedTypes,
      });
    } catch (err: any) {
      await safeReply(interaction, {
        content: getGithubErrorMessage(err),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const listPayload = await this.buildTodoListPayload(parsed.payloadToken, parsed.page);
    if (!listPayload) {
      await replyTodoExpired(interaction);
      return;
    }

    const channel = interaction.client.channels.cache.get(parsed.channelId);
    if (channel && "messages" in channel) {
      try {
        const message = await (channel as any).messages.fetch(parsed.messageId);
        await message.edit({
          components: listPayload.components,
        });
      } catch {
        // ignore refresh failures
      }
    }

    try {
      await interaction.deleteReply();
    } catch {
      // ignore
    }
  }

  @ModalComponent({ id: /^todo-comment-modal:[^:]+:\d+:\d+:\d+:\d+$/ })
  async submitCommentModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseTodoIssueModalId(interaction.customId, TODO_COMMENT_MODAL_PREFIX);
    if (!parsed) {
      await safeReply(interaction, {
        content: "This comment form expired.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const rawComment = interaction.fields.getTextInputValue(TODO_COMMENT_INPUT_ID);
    const finalCommentBody = sanitizeTodoRichText(rawComment);
    if (!finalCommentBody.trim()) {
      await safeReply(interaction, {
        content: "Comment cannot be empty.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const prefixedComment = `${interaction.user.username}: ${finalCommentBody}`.slice(
      0,
      MAX_ISSUE_BODY,
    );

    try {
      await addComment(parsed.issueNumber, prefixedComment);
    } catch (err: any) {
      await safeReply(interaction, {
        content: getGithubErrorMessage(err),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let issue: IGithubIssue | null;
    let comments: IGithubIssueComment[] = [];
    try {
      issue = await getIssue(parsed.issueNumber);
      if (issue) {
        comments = await listIssueComments(parsed.issueNumber);
      }
    } catch {
      issue = null;
    }

    if (!issue) {
      try {
        await interaction.deleteReply();
      } catch {
        // ignore
      }
      return;
    }

    const basePayload = parseTodoPayloadToken(parsed.payloadToken);
    if (!basePayload) {
      try {
        await interaction.deleteReply();
      } catch {
        // ignore
      }
      return;
    }
    const payload: TodoListPayload = { ...basePayload, page: parsed.page };

    const viewPayload = buildIssueViewComponents(
      issue,
      comments,
      payload,
      parsed.payloadToken,
    );

    const channel = interaction.client.channels.cache.get(parsed.channelId);
    if (!channel || !("messages" in channel)) {
      try {
        await interaction.deleteReply();
      } catch {
        // ignore
      }
      return;
    }

    try {
      const message = await (channel as any).messages.fetch(parsed.messageId);
      await message.edit({
        components: viewPayload.components,
      });
    } catch {
      // ignore refresh failures
    }

    try {
      await interaction.deleteReply();
    } catch {
      // ignore
    }
  }

  @ModalComponent({ id: /^todo-edit-title-modal:[^:]+:\d+:\d+:\d+:\d+$/ })
  async submitEditTitleModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseTodoIssueModalId(interaction.customId, TODO_EDIT_TITLE_MODAL_PREFIX);
    if (!parsed) {
      await safeReply(interaction, {
        content: "This edit prompt expired.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const rawTitle = interaction.fields.getTextInputValue(TODO_EDIT_TITLE_INPUT_ID);
    const trimmedTitle = sanitizeTodoRichText(rawTitle).trim();
    if (!trimmedTitle) {
      await safeReply(interaction, {
        content: "Title cannot be empty.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await updateIssue(parsed.issueNumber, {
        title: trimmedTitle,
      });
    } catch (err: any) {
      await safeReply(interaction, {
        content: getGithubErrorMessage(err),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let issue: IGithubIssue | null;
    let comments: IGithubIssueComment[] = [];
    try {
      issue = await getIssue(parsed.issueNumber);
      if (issue) {
        comments = await listIssueComments(parsed.issueNumber);
      }
    } catch {
      issue = null;
    }

    if (!issue) {
      try {
        await interaction.deleteReply();
      } catch {
        // ignore
      }
      return;
    }

    const basePayload = parseTodoPayloadToken(parsed.payloadToken);
    if (!basePayload) {
      try {
        await interaction.deleteReply();
      } catch {
        // ignore
      }
      return;
    }
    const payload: TodoListPayload = { ...basePayload, page: parsed.page };

    const viewPayload = buildIssueViewComponents(
      issue,
      comments,
      payload,
      parsed.payloadToken,
    );

    const channel = interaction.client.channels.cache.get(parsed.channelId);
    if (channel && "messages" in channel) {
      try {
        const message = await (channel as any).messages.fetch(parsed.messageId);
        await message.edit({
          components: viewPayload.components,
        });
      } catch {
        // ignore refresh failures
      }
    }

    try {
      await interaction.deleteReply();
    } catch {
      // ignore
    }
  }

  @ModalComponent({ id: /^todo-edit-desc-modal:[^:]+:\d+:\d+:\d+:\d+$/ })
  async submitEditDescriptionModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseTodoIssueModalId(interaction.customId, TODO_EDIT_DESC_MODAL_PREFIX);
    if (!parsed) {
      await safeReply(interaction, {
        content: "This edit prompt expired.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const rawBody = interaction.fields.getTextInputValue(TODO_EDIT_DESC_INPUT_ID);
    const trimmedBody = sanitizeTodoRichText(rawBody);
    if (!trimmedBody.trim()) {
      await safeReply(interaction, {
        content: "Description cannot be empty.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await updateIssue(parsed.issueNumber, {
        body: trimmedBody.slice(0, MAX_ISSUE_BODY),
      });
    } catch (err: any) {
      await safeReply(interaction, {
        content: getGithubErrorMessage(err),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let issue: IGithubIssue | null;
    let comments: IGithubIssueComment[] = [];
    try {
      issue = await getIssue(parsed.issueNumber);
      if (issue) {
        comments = await listIssueComments(parsed.issueNumber);
      }
    } catch {
      issue = null;
    }

    if (!issue) {
      try {
        await interaction.deleteReply();
      } catch {
        // ignore
      }
      return;
    }
    const basePayload = parseTodoPayloadToken(parsed.payloadToken);
    if (!basePayload) {
      try {
        await interaction.deleteReply();
      } catch {
        // ignore
      }
      return;
    }
    const payload: TodoListPayload = { ...basePayload, page: parsed.page };

    const viewPayload = buildIssueViewComponents(
      issue,
      comments,
      payload,
      parsed.payloadToken,
    );

    const channel = interaction.client.channels.cache.get(parsed.channelId);
    if (channel && "messages" in channel) {
      try {
        const message = await (channel as any).messages.fetch(parsed.messageId);
        await message.edit({
          components: viewPayload.components,
        });
      } catch {
        // ignore refresh failures
      }
    }

    try {
      await interaction.deleteReply();
    } catch {
      // ignore
    }
  }

  @ModalComponent({ id: /^todo-query-modal:[^:]+:\d+:\d+:\d+$/ })
  async submitQueryModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseTodoQueryModalId(interaction.customId, TODO_QUERY_MODAL_PREFIX);
    if (!parsed) {
      await safeReply(interaction, {
        content: "This query prompt expired.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const rawQuery = interaction.fields.getTextInputValue(TODO_QUERY_INPUT_ID);
    const query = normalizeQuery(rawQuery);

    const basePayload = parseTodoPayloadToken(parsed.payloadToken);
    if (!basePayload) {
      await replyTodoExpired(interaction);
      return;
    }
    basePayload.query = query;

    const nextToken = buildTodoPayloadToken(basePayload, TODO_PAYLOAD_TOKEN_MAX_LENGTH);
    const listPayload = await this.buildTodoListPayload(nextToken, parsed.page);
    if (!listPayload) {
      await replyTodoExpired(interaction);
      return;
    }

    const channel = interaction.client.channels.cache.get(parsed.channelId);
    if (channel && "messages" in channel) {
      try {
        const message = await (channel as any).messages.fetch(parsed.messageId);
        await message.edit({
          components: listPayload.components,
        });
      } catch {
        // ignore refresh failures
      }
    }

    try {
      await interaction.deleteReply();
    } catch {
      // ignore
    }
  }


  @ButtonComponent({ id: /^todo-view:[^:]+:\d+:\d+$/ })
  async viewFromList(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoViewId(interaction.customId);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }

    let issue: IGithubIssue | null;
    let comments: IGithubIssueComment[] = [];
    try {
      issue = await getIssue(parsed.issueNumber);
      if (issue) {
        comments = await listIssueComments(parsed.issueNumber);
      }
    } catch (err: any) {
      await safeUpdate(interaction, {
        content: getGithubErrorMessage(err),
        components: [],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (!issue) {
      await safeUpdate(interaction, {
        content: `Issue #${parsed.issueNumber} was not found.`,
        components: [],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const basePayload = parseTodoPayloadToken(parsed.payloadToken);
    if (!basePayload) {
      await replyTodoExpired(interaction);
      return;
    }
    const payload: TodoListPayload = { ...basePayload, page: parsed.page };
    const viewPayload = buildIssueViewComponents(
      issue,
      comments,
      payload,
      parsed.payloadToken,
    );

    await safeUpdate(interaction, {
      components: viewPayload.components,
      flags: buildComponentsV2Flags(!payload.isPublic),
    });
  }

  @ButtonComponent({ id: /^todo-close-view:[^:]+:\d+:\d+$/ })
  async closeFromView(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoCloseViewId(interaction.customId, TODO_CLOSE_VIEW_PREFIX);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    try {
      await interaction.deferUpdate();
    } catch {
      // ignore
    }

    let closed: IGithubIssue | null;
    try {
      closed = await closeIssue(parsed.issueNumber);
    } catch (err: any) {
      await safeUpdate(interaction, {
        content: getGithubErrorMessage(err),
        components: [],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!closed) {
      await safeUpdate(interaction, {
        content: `Issue #${parsed.issueNumber} was not found.`,
        components: [],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const listPayload = await this.buildTodoListPayload(parsed.payloadToken, parsed.page);
    if (!listPayload) {
      await replyTodoExpired(interaction);
      return;
    }

    try {
      await interaction.message.edit({
        components: listPayload.components,
      });
    } catch {
      await replyTodoExpired(interaction);
      return;
    }
  }

  @ButtonComponent({ id: /^todo-reopen-view:[^:]+:\d+:\d+$/ })
  async reopenFromView(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoReopenViewId(interaction.customId, TODO_REOPEN_VIEW_PREFIX);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    try {
      await interaction.deferUpdate();
    } catch {
      // ignore
    }

    let reopened: IGithubIssue | null;
    try {
      reopened = await reopenIssue(parsed.issueNumber);
    } catch (err: any) {
      await safeUpdate(interaction, {
        content: getGithubErrorMessage(err),
        components: [],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!reopened) {
      await safeUpdate(interaction, {
        content: `Issue #${parsed.issueNumber} was not found.`,
        components: [],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const listPayload = await this.buildTodoListPayload(parsed.payloadToken, parsed.page);
    if (!listPayload) {
      await replyTodoExpired(interaction);
      return;
    }

    try {
      await interaction.message.edit({
        components: listPayload.components,
      });
    } catch {
      await replyTodoExpired(interaction);
      return;
    }
  }

  @ButtonComponent({ id: /^todo-label-edit-button:[^:]+:\d+:\d+$/ })
  async editLabelsFromView(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoLabelEditId(interaction.customId, TODO_LABEL_EDIT_BUTTON_PREFIX);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }

    const ok = await requireModeratorOrAdminOrOwner(interaction);
    if (!ok) return;

    let issue: IGithubIssue | null;
    try {
      issue = await getIssue(parsed.issueNumber);
    } catch (err: any) {
      await safeReply(interaction, {
        content: getGithubErrorMessage(err),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!issue) {
      await safeReply(interaction, {
        content: `Issue #${parsed.issueNumber} was not found.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId(
        buildTodoLabelEditSelectId(
          parsed.payloadToken,
          parsed.page,
          parsed.issueNumber,
          interaction.channelId,
          interaction.message?.id ?? "",
        ),
      )
      .setPlaceholder("Select Label(s)...")
      .setMinValues(0)
      .setMaxValues(TODO_LABELS.length)
      .addOptions(
        TODO_LABELS.map((label) => ({
          label,
          value: label,
          default: issue.labels.includes(label),
        })),
      );

    await safeReply(interaction, {
      content: "Select labels to apply to this issue.",
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      flags: MessageFlags.Ephemeral,
    });
  }

  @ButtonComponent({ id: /^todo-query-button:[^:]+:\d+$/ })
  async queryFromList(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoQueryId(interaction.customId, TODO_QUERY_BUTTON_PREFIX);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }

    const basePayload = parseTodoPayloadToken(parsed.payloadToken);
    if (!basePayload) {
      await replyTodoExpired(interaction);
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(
        buildTodoQueryModalId(
          parsed.payloadToken,
          parsed.page,
          interaction.channelId,
          interaction.message?.id ?? "",
        ),
      )
      .setTitle(basePayload.query ? "Edit Query" : "Filter by Query");

    const queryInput = new TextInputBuilder()
      .setCustomId(TODO_QUERY_INPUT_ID)
      .setLabel("Query")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(200);

    if (basePayload.query) {
      queryInput.setValue(basePayload.query);
    }

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(queryInput));
    await interaction.showModal(modal);
  }

  @ButtonComponent({ id: /^todo-comment-button:[^:]+:\d+:\d+$/ })
  async addCommentFromView(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoIssueActionId(interaction.customId, TODO_COMMENT_BUTTON_PREFIX);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(
        buildTodoCommentModalId(
          parsed.payloadToken,
          parsed.page,
          parsed.issueNumber,
          interaction.channelId,
          interaction.message?.id ?? "",
        ),
      )
      .setTitle("Add Comment");

    const commentInput = new TextInputBuilder()
      .setCustomId(TODO_COMMENT_INPUT_ID)
      .setLabel("Comment")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(MAX_ISSUE_BODY);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(commentInput));

    await interaction.showModal(modal);
  }

  @ButtonComponent({ id: /^todo-edit-title-button:[^:]+:\d+:\d+$/ })
  async editTitleFromView(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoIssueActionId(interaction.customId, TODO_EDIT_TITLE_BUTTON_PREFIX);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    let issue: IGithubIssue | null;
    try {
      issue = await getIssue(parsed.issueNumber);
    } catch {
      issue = null;
    }

    if (!issue) {
      await safeReply(interaction, {
        content: `Issue #${parsed.issueNumber} was not found.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(
        buildTodoEditTitleModalId(
          parsed.payloadToken,
          parsed.page,
          parsed.issueNumber,
          interaction.channelId,
          interaction.message?.id ?? "",
        ),
      )
      .setTitle("Edit Title");

    const titleInput = new TextInputBuilder()
      .setCustomId(TODO_EDIT_TITLE_INPUT_ID)
      .setLabel("Title")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(256)
      .setValue(issue.title);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput));

    await interaction.showModal(modal);
  }

  @ButtonComponent({ id: /^todo-edit-desc-button:[^:]+:\d+:\d+$/ })
  async editDescriptionFromView(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoIssueActionId(interaction.customId, TODO_EDIT_DESC_BUTTON_PREFIX);
    if (!parsed) {
      await replyTodoExpired(interaction);
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    let issue: IGithubIssue | null;
    try {
      issue = await getIssue(parsed.issueNumber);
    } catch {
      issue = null;
    }

    if (!issue) {
      await safeReply(interaction, {
        content: `Issue #${parsed.issueNumber} was not found.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(
        buildTodoEditDescModalId(
          parsed.payloadToken,
          parsed.page,
          parsed.issueNumber,
          interaction.channelId,
          interaction.message?.id ?? "",
        ),
      )
      .setTitle("Edit Description");

    const descriptionInput = new TextInputBuilder()
      .setCustomId(TODO_EDIT_DESC_INPUT_ID)
      .setLabel("Description")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(MAX_ISSUE_BODY);

    if (issue.body) {
      descriptionInput.setValue(issue.body.slice(0, MAX_ISSUE_BODY));
    }

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput),
    );

    await interaction.showModal(modal);
  }

}
