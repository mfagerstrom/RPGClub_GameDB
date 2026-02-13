import type {
  ButtonInteraction,
  CommandInteraction,
  ModalSubmitInteraction,
} from "discord.js";
import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from "discord.js";
import {
  ComponentType as ApiComponentType,
  TextInputStyle as ApiTextInputStyle,
  type APIModalInteractionResponseCallbackComponent,
  type APISelectMenuOption,
} from "discord-api-types/v10";
import { ButtonComponent, Discord, ModalComponent, Slash, SlashOption } from "discordx";
import type { IGotmEntry } from "../classes/Gotm.js";
import Gotm from "../classes/Gotm.js";
import type { INrGotmEntry } from "../classes/NrGotm.js";
import NrGotm from "../classes/NrGotm.js";
import { buildGotmCardsFromEntries, buildGotmSearchMessages } from "../functions/GotmSearchComponents.js";
import { safeDeferReply, safeDeferUpdate, safeReply, sanitizeUserInput } from "../functions/InteractionUtils.js";
import { buildComponentsV2Flags } from "../functions/NominationListComponents.js";
import { RawModalApiService } from "../services/raw-modal/RawModalApiService.js";
import { parseRawModalCustomId } from "../services/raw-modal/RawModalCustomId.js";

const ROUND_HISTORY_MODAL_TITLE = "Round History";
const ROUND_HISTORY_HELP_ID = "round-history-help";
const ROUND_HISTORY_KIND_ID = "round-history-kind";
const ROUND_HISTORY_QUERY_ID = "round-history-query";
const ROUND_HISTORY_YEAR_ID = "round-history-year";
const ROUND_HISTORY_SORT_ID = "round-history-sort";
const ROUND_HISTORY_PAGE_SIZE = 5;

type RoundHistoryKind = "gotm" | "nr-gotm" | "both";
type RoundHistorySort = "asc" | "desc";

type IRoundHistoryRecord = {
  round: number;
  gotmEntries: IGotmEntry[];
  nrGotmEntries: INrGotmEntry[];
};

type IRoundHistoryFilterState = {
  ownerUserId: string;
  kind: RoundHistoryKind;
  query: string;
  year: number;
  sort: RoundHistorySort;
  page: number;
};

function buildRoundHistorySessionId(userId: string, showInChat: boolean): string {
  const ts = Date.now().toString(36);
  const visibility = showInChat ? "1" : "0";
  return `u${userId}_c${visibility}_t${ts}`;
}

function parseShowInChatFromSessionId(sessionId: string): boolean | null {
  const match = /^u\d+_c([01])_t[a-z0-9]+$/.exec(sessionId);
  if (!match || !match[1]) {
    return null;
  }
  return match[1] === "1";
}

function parseYearFromMonthYear(value: string): number | null {
  const match = /(\d{4})\s*$/.exec(value);
  if (!match || !match[1]) return null;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) ? parsed : null;
}

function getCurrentYear(): number {
  return new Date().getFullYear();
}

function getModalYearOptions(): APISelectMenuOption[] {
  const years = new Set<number>([getCurrentYear()]);
  for (const entry of Gotm.all()) {
    const parsed = parseYearFromMonthYear(entry.monthYear);
    if (parsed) years.add(parsed);
  }
  for (const entry of NrGotm.all()) {
    const parsed = parseYearFromMonthYear(entry.monthYear);
    if (parsed) years.add(parsed);
  }

  return Array.from(years)
    .sort((a, b) => b - a)
    .slice(0, 25)
    .map((year) => ({
      label: String(year),
      value: String(year),
      default: year === getCurrentYear(),
    }));
}

function buildRoundHistoryModalComponents(): APIModalInteractionResponseCallbackComponent[] {
  const helpText =
    "Filter by category, optional title text, and year. " +
    "Sort controls round order. Results show up to 5 rounds per page.";

  return [
    {
      type: ApiComponentType.ActionRow,
      components: [
        {
          type: ApiComponentType.TextInput,
          custom_id: ROUND_HISTORY_HELP_ID,
          label: "How this form works",
          style: ApiTextInputStyle.Paragraph,
          required: false,
          max_length: 500,
          value: helpText,
        },
      ],
    },
    {
      type: ApiComponentType.Label,
      label: "Category",
      description: "Required",
      component: {
        type: ApiComponentType.RadioGroup,
        custom_id: ROUND_HISTORY_KIND_ID,
        required: true,
        options: [
          { label: "GOTM", value: "gotm" },
          { label: "NR-GOTM", value: "nr-gotm" },
          { label: "Both", value: "both", default: true },
        ],
      },
    },
    {
      type: ApiComponentType.ActionRow,
      components: [
        {
          type: ApiComponentType.TextInput,
          custom_id: ROUND_HISTORY_QUERY_ID,
          label: "Query (optional title match)",
          style: ApiTextInputStyle.Short,
          required: false,
          max_length: 30,
        },
      ],
    },
    {
      type: ApiComponentType.Label,
      label: "Year",
      description: "Required",
      component: {
        type: ApiComponentType.StringSelect,
        custom_id: ROUND_HISTORY_YEAR_ID,
        min_values: 1,
        max_values: 1,
        options: getModalYearOptions(),
      },
    },
    {
      type: ApiComponentType.Label,
      label: "Sort",
      description: "Round number order",
      component: {
        type: ApiComponentType.RadioGroup,
        custom_id: ROUND_HISTORY_SORT_ID,
        required: true,
        options: [
          { label: "Ascending", value: "asc", default: true },
          { label: "Descending", value: "desc" },
        ],
      },
    },
  ];
}

function parseKind(value: unknown): RoundHistoryKind | null {
  return value === "gotm" || value === "nr-gotm" || value === "both"
    ? value
    : null;
}

function parseSort(value: unknown): RoundHistorySort | null {
  return value === "asc" || value === "desc" ? value : null;
}

function extractSingleValueFromModal(
  interaction: ModalSubmitInteraction,
  fieldId: string,
): string | undefined {
  const topLevelComponents = (
    interaction.components ?? []
  ) as Array<{
    component?: { customId?: string; value?: unknown; values?: unknown };
    components?: Array<{ customId?: string; value?: unknown; values?: unknown }>;
  }>;

  for (const topLevel of topLevelComponents) {
    const children = Array.isArray(topLevel.components)
      ? topLevel.components
      : topLevel.component
        ? [topLevel.component]
        : [];

    for (const child of children) {
      if (!child || child.customId !== fieldId) {
        continue;
      }
      if (typeof child.value === "string") {
        return child.value;
      }
      if (Array.isArray(child.values) && typeof child.values[0] === "string") {
        return child.values[0];
      }
    }
  }
  return undefined;
}

function encodeQueryToken(query: string): string {
  if (!query) return "_";
  return Buffer.from(query, "utf8").toString("base64url");
}

function decodeQueryToken(token: string): string | null {
  if (token === "_") return "";
  try {
    return Buffer.from(token, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function buildRoundHistoryPageCustomId(state: IRoundHistoryFilterState): string {
  const kindToken = state.kind === "gotm"
    ? "g"
    : state.kind === "nr-gotm"
      ? "n"
      : "b";
  const sortToken = state.sort === "desc" ? "d" : "a";
  return [
    "round-history-page",
    state.ownerUserId,
    kindToken,
    String(state.year),
    sortToken,
    String(state.page),
    encodeQueryToken(state.query),
  ].join(":");
}

function parseRoundHistoryPageCustomId(customId: string): IRoundHistoryFilterState | null {
  const parts = customId.split(":");
  if (parts.length !== 7 || parts[0] !== "round-history-page") {
    return null;
  }

  const ownerUserId = parts[1];
  const kindToken = parts[2];
  const year = Number(parts[3]);
  const sortToken = parts[4];
  const page = Number(parts[5]);
  const query = decodeQueryToken(parts[6] ?? "");
  if (!ownerUserId || !Number.isInteger(year) || !Number.isInteger(page) || page < 0 || query === null) {
    return null;
  }

  const kind: RoundHistoryKind = kindToken === "g"
    ? "gotm"
    : kindToken === "n"
      ? "nr-gotm"
      : kindToken === "b"
        ? "both"
        : null as never;
  if (!kind) {
    return null;
  }

  const sort: RoundHistorySort = sortToken === "d" ? "desc" : sortToken === "a" ? "asc" : null as never;
  if (!sort) {
    return null;
  }

  return {
    ownerUserId,
    kind,
    query,
    year,
    sort,
    page,
  };
}

function getFilteredRoundHistoryRecords(
  kind: RoundHistoryKind,
  query: string,
  year: number,
  sort: RoundHistorySort,
): IRoundHistoryRecord[] {
  const normalizedQuery = query.trim().toLowerCase();
  const includeGotm = kind === "gotm" || kind === "both";
  const includeNrGotm = kind === "nr-gotm" || kind === "both";
  const gotmEntries = includeGotm ? Gotm.getByYear(year) : [];
  const nrGotmEntries = includeNrGotm ? NrGotm.getByYear(year) : [];
  const byRound = new Map<number, IRoundHistoryRecord>();

  for (const entry of gotmEntries) {
    if (
      normalizedQuery &&
      !entry.gameOfTheMonth.some((game) => game.title.toLowerCase().includes(normalizedQuery))
    ) {
      continue;
    }
    const existing = byRound.get(entry.round);
    if (existing) {
      existing.gotmEntries.push(entry);
    } else {
      byRound.set(entry.round, {
        round: entry.round,
        gotmEntries: [entry],
        nrGotmEntries: [],
      });
    }
  }

  for (const entry of nrGotmEntries) {
    if (
      normalizedQuery &&
      !entry.gameOfTheMonth.some((game) => game.title.toLowerCase().includes(normalizedQuery))
    ) {
      continue;
    }
    const existing = byRound.get(entry.round);
    if (existing) {
      existing.nrGotmEntries.push(entry);
    } else {
      byRound.set(entry.round, {
        round: entry.round,
        gotmEntries: [],
        nrGotmEntries: [entry],
      });
    }
  }

  const sorted = Array.from(byRound.values()).sort((a, b) =>
    sort === "asc" ? a.round - b.round : b.round - a.round,
  );
  return sorted;
}

function buildRoundHistoryIntro(
  state: IRoundHistoryFilterState,
  totalRounds: number,
  totalPages: number,
  pageRounds: IRoundHistoryRecord[],
): string {
  const kindLabel = state.kind === "gotm" ? "GOTM" : state.kind === "nr-gotm" ? "NR-GOTM" : "Both";
  const start = totalRounds === 0 ? 0 : state.page * ROUND_HISTORY_PAGE_SIZE + 1;
  const end = totalRounds === 0 ? 0 : start + pageRounds.length - 1;
  const queryLine = state.query ? `"${state.query}"` : "(none)";
  return [
    `Category: ${kindLabel} | Year: ${state.year} | Sort: ${state.sort.toUpperCase()}`,
    `Query: ${queryLine}`,
    `Page ${state.page + 1}/${Math.max(totalPages, 1)} | Rounds ${start}-${end} of ${totalRounds}`,
  ].join("\n");
}

function buildRoundHistoryPaginationRow(
  state: IRoundHistoryFilterState,
  totalPages: number,
): ActionRowBuilder<ButtonBuilder> | null {
  if (totalPages <= 1) {
    return null;
  }

  const prevPage = Math.max(0, state.page - 1);
  const nextPage = Math.min(totalPages - 1, state.page + 1);

  const prevButton = new ButtonBuilder()
    .setCustomId(buildRoundHistoryPageCustomId({ ...state, page: prevPage }))
    .setLabel("Previous")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(state.page <= 0);

  const nextButton = new ButtonBuilder()
    .setCustomId(buildRoundHistoryPageCustomId({ ...state, page: nextPage }))
    .setLabel("Next")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(state.page >= totalPages - 1);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(prevButton, nextButton);
}

async function buildRoundHistoryResponse(
  interaction: CommandInteraction | ButtonInteraction | ModalSubmitInteraction,
  state: IRoundHistoryFilterState,
): Promise<{
    components: Array<any>;
    files: any[];
    totalPages: number;
    safePage: number;
  }> {
  const allRounds = getFilteredRoundHistoryRecords(state.kind, state.query, state.year, state.sort);
  const totalPages = Math.max(1, Math.ceil(allRounds.length / ROUND_HISTORY_PAGE_SIZE));
  const safePage = Math.min(Math.max(state.page, 0), totalPages - 1);
  const pageRounds = allRounds.slice(
    safePage * ROUND_HISTORY_PAGE_SIZE,
    safePage * ROUND_HISTORY_PAGE_SIZE + ROUND_HISTORY_PAGE_SIZE,
  );

  const cards = [
    ...buildGotmCardsFromEntries(
      pageRounds.flatMap((entry) => entry.gotmEntries),
      "GOTM",
    ),
    ...buildGotmCardsFromEntries(
      pageRounds.flatMap((entry) => entry.nrGotmEntries),
      "NR-GOTM",
    ).filter((card) => card.title.trim().toLowerCase() !== "n/a"),
  ].sort((a, b) => {
    if (a.round !== b.round) {
      return state.sort === "asc" ? a.round - b.round : b.round - a.round;
    }
    if (a.kindLabel !== b.kindLabel) {
      return a.kindLabel === "GOTM" ? -1 : 1;
    }
    return a.title.localeCompare(b.title);
  });

  const payloads = await buildGotmSearchMessages(interaction.client, cards, {
    title: `Round History - ${state.year}`,
    continuationTitle: `Round History - ${state.year} (continued)`,
    emptyMessage: "No rounds matched your filters.",
    introText: buildRoundHistoryIntro(
      { ...state, page: safePage },
      allRounds.length,
      totalPages,
      pageRounds,
    ),
    guildId: interaction.guildId ?? undefined,
    maxGamesPerContainer: 50,
    maxContainersPerMessage: 20,
  });

  const payload = payloads[0] ?? { components: [], files: [] };
  const paginationRow = buildRoundHistoryPaginationRow({ ...state, page: safePage }, totalPages);
  const components = paginationRow ? [...payload.components, paginationRow] : payload.components;
  return {
    components,
    files: payload.files,
    totalPages,
    safePage,
  };
}

@Discord()
export class RoundHistoryCommand {
  @Slash({ description: "Query historical GOTM/NR-GOTM rounds", name: "round-history" })
  async roundHistory(
    @SlashOption({
      description: "If true, show results in the channel instead of ephemerally.",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const modalApi = new RawModalApiService({
      applicationId: interaction.applicationId,
    });

    try {
      await modalApi.openModal({
        interactionId: interaction.id,
        interactionToken: interaction.token,
        feature: "round-history",
        flow: "query",
        sessionId: buildRoundHistorySessionId(interaction.user.id, Boolean(showInChat)),
        title: ROUND_HISTORY_MODAL_TITLE,
        components: buildRoundHistoryModalComponents(),
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await safeReply(interaction, {
        content: `Unable to open round history form: ${errorMessage}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @ModalComponent({ id: /^modal:round-history:v1:query:[A-Za-z0-9_-]{1,64}$/ })
  async submitRoundHistoryModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsedCustomId = parseRawModalCustomId(interaction.customId);
    const query = sanitizeUserInput(
      interaction.fields.getTextInputValue(ROUND_HISTORY_QUERY_ID) ?? "",
      { preserveNewlines: false, maxLength: 30 },
    );
    const selectedKind = parseKind(extractSingleValueFromModal(interaction, ROUND_HISTORY_KIND_ID));
    const selectedSort = parseSort(extractSingleValueFromModal(interaction, ROUND_HISTORY_SORT_ID)) ?? "asc";
    const selectedYearRaw = extractSingleValueFromModal(interaction, ROUND_HISTORY_YEAR_ID);
    const selectedYear = Number(selectedYearRaw);

    if (!parsedCustomId || parsedCustomId.feature !== "round-history" || parsedCustomId.flow !== "query") {
      await safeReply(interaction, {
        content: "This round history form is invalid. Please run /round-history again.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!selectedKind) {
      await safeReply(interaction, {
        content: "Please choose GOTM, NR-GOTM, or Both.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const year = Number.isInteger(selectedYear) ? selectedYear : getCurrentYear();
    const showInChat = parseShowInChatFromSessionId(parsedCustomId.sessionId);
    const ephemeral = showInChat === null ? true : !showInChat;
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(ephemeral) });

    const response = await buildRoundHistoryResponse(interaction, {
      ownerUserId: interaction.user.id,
      kind: selectedKind,
      query,
      year,
      sort: selectedSort,
      page: 0,
    });

    await safeReply(interaction, {
      components: response.components,
      files: response.files.length ? response.files : undefined,
      flags: buildComponentsV2Flags(ephemeral),
    });
  }

  @ButtonComponent({ id: /^round-history-page:\d+:[gnb]:\d{4}:[ad]:\d+:[A-Za-z0-9_-]+$/ })
  async handleRoundHistoryPageButton(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseRoundHistoryPageCustomId(interaction.customId);
    if (!parsed) {
      await safeReply(interaction, {
        content: "This round history page control is invalid. Please run /round-history again.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (parsed.ownerUserId !== interaction.user.id) {
      await safeReply(interaction, {
        content: "Only the user who opened this round history view can use these controls.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await safeDeferUpdate(interaction);

    const response = await buildRoundHistoryResponse(interaction, parsed);
    await safeReply(interaction, {
      content: null,
      components: response.components,
      files: response.files.length ? response.files : [],
    });
  }
}
