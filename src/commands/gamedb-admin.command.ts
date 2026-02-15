import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  CommandInteraction,
  EmbedBuilder,
  InteractionReplyOptions,
  MessageFlags,
  ModalSubmitInteraction,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import {
  ButtonComponent,
  Discord,
  ModalComponent,
  SelectMenuComponent,
  Slash,
  SlashGroup,
  SlashOption,
} from "discordx";
import { safeDeferReply, safeReply, safeUpdate, sanitizeUserInput } from "../functions/InteractionUtils.js";
import {
  ContainerBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import {
  performAutoAcceptImages,
  performAutoAcceptReleaseData,
  performAutoAcceptVideos,
} from "../services/GamedbAuditService.js";
import { isAdmin } from "./admin.command.js";
import Game, { IGame } from "../classes/Game.js";
import GameSearchSynonym from "../classes/GameSearchSynonym.js";
import GameSearchSynonymDraft, {
  type ISynonymDraftPair,
} from "../classes/GameSearchSynonymDraft.js";
import axios from "axios";
import { igdbService } from "../services/IGDB/IgdbService.js";
import { shouldRenderPrevNextButtons } from "../functions/PaginationUtils.js";

const AUDIT_PAGE_SIZE = 20;
const AUDIT_VIDEO_MODAL_ID = "audit-video-modal";
const AUDIT_VIDEO_INPUT_ID = "audit-video-url";
const AUDIT_DESCRIPTION_MODAL_ID = "audit-description-modal";
const AUDIT_DESCRIPTION_INPUT_ID = "audit-description";
const AUDIT_AUTO_STOP_PREFIX = "audit-auto-stop";
const SYNONYM_ADD_MODAL_PREFIX = "gamedb-syn-add";
const SYNONYM_ADD_MORE_PREFIX = "gamedb-syn-more";
const SYNONYM_ADD_DONE_PREFIX = "gamedb-syn-done";
const SYNONYM_ADD_BULK_INPUT_ID = "gamedb-syn-bulk";
const SYNONYM_LIST_PAGE_PREFIX = "gamedb-syn-page";
const SYNONYM_EDIT_GROUP_SELECT_PREFIX = "gamedb-syn-edit-group";
const SYNONYM_EDIT_GROUP_MODAL_PREFIX = "gamedb-syn-edit-group-modal";
const SYNONYM_EDIT_GROUP_INPUT_ID = "gamedb-syn-edit-group-input";
const SYNONYM_DELETE_GROUP_SELECT_PREFIX = "gamedb-syn-delete-group";
const SYNONYM_ADD_FROM_LIST_PREFIX = "gamedb-syn-add-from-list";
const COMPONENTS_V2_FLAG = 1 << 15;
const SYNONYM_LIST_PAGE_SIZE = 20;
const MAX_COMPONENT_CUSTOM_ID_LENGTH = 100;

function buildComponentsV2Flags(isEphemeral: boolean): number {
  return (isEphemeral ? MessageFlags.Ephemeral : 0) | COMPONENTS_V2_FLAG;
}

function encodeSynonymQuery(query: string, maxLength: number): string {
  if (!query) return "";
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

function decodeSynonymQuery(encoded: string): string {
  if (!encoded) return "";
  try {
    return Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function clampSynonymOptionText(value: string, maxLength = 100): string {
  if (value.length <= maxLength) return value;
  return value.slice(0, Math.max(0, maxLength - 3)) + "...";
}

function buildSynonymGroupEditModal(ownerId: string, groupId: number, terms: string): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId(SYNONYM_EDIT_GROUP_INPUT_ID)
    .setLabel("Synonym terms, one per line")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(2000)
    .setValue(terms);

  return new ModalBuilder()
    .setCustomId(`${SYNONYM_EDIT_GROUP_MODAL_PREFIX}:${ownerId}:${groupId}`)
    .setTitle("Edit Search Synonym Group")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

function buildSynonymListCustomId(
  ownerId: string,
  page: number,
  query: string,
  direction?: "next" | "prev",
): string {
  const base = `${SYNONYM_LIST_PAGE_PREFIX}:${ownerId}:${page}:`;
  const maxQueryLength = MAX_COMPONENT_CUSTOM_ID_LENGTH - base.length - (direction ? `:${direction}`.length : 0);
  const encodedQuery = encodeSynonymQuery(query, Math.max(maxQueryLength, 0));
  return direction
    ? `${base}${encodedQuery}:${direction}`
    : `${base}${encodedQuery}`;
}

function buildSynonymGroupSelectCustomId(
  prefix: string,
  ownerId: string,
  page: number,
  query: string,
): string {
  const base = `${prefix}:${ownerId}:${page}:`;
  const maxQueryLength = MAX_COMPONENT_CUSTOM_ID_LENGTH - base.length;
  const encodedQuery = encodeSynonymQuery(query, Math.max(maxQueryLength, 0));
  return `${base}${encodedQuery}`;
}
const AUDIT_SESSIONS = new Map<
  string,
  {
    userId: string;
    games: IGame[];
    page: number;
    filter: "all" | "image" | "video" | "description" | "release" | "mixed" | "complete";
  }
>();

function parseSynonymPairs(
  rawInput: string,
  maxPairs: number,
): ISynonymDraftPair[] {
  const lines = rawInput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const pairs: ISynonymDraftPair[] = [];
  const separators = ["<-->", "<->", "=>", "->", "|", ","];
  for (const line of lines) {
    let separator: string | null = null;
    for (const candidate of separators) {
      if (line.includes(candidate)) {
        separator = candidate;
        break;
      }
    }
    if (!separator) continue;
    const [left, right] = line.split(separator).map((part) => part.trim());
    if (!left || !right) continue;
    pairs.push({ term: left, match: right });
    if (pairs.length >= maxPairs) break;
  }
  return pairs;
}

function buildSynonymAddModal(draftId: number): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId(SYNONYM_ADD_BULK_INPUT_ID)
    .setLabel("Synonym pairs, one per line")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("GTA <-> Grand Theft Auto\nKH <-> Kingdom Hearts\n1 <-> one")
    .setRequired(true)
    .setMaxLength(2000);

  return new ModalBuilder()
    .setCustomId(`${SYNONYM_ADD_MODAL_PREFIX}:${draftId}`)
    .setTitle("Add GameDB Search Synonyms")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

function buildSynonymContinueComponents(draftId: number): Array<ActionRowBuilder<ButtonBuilder>> {
  const addMore = new ButtonBuilder()
    .setCustomId(`${SYNONYM_ADD_MORE_PREFIX}:${draftId}`)
    .setLabel("Add More")
    .setStyle(ButtonStyle.Primary);
  const done = new ButtonBuilder()
    .setCustomId(`${SYNONYM_ADD_DONE_PREFIX}:${draftId}`)
    .setLabel("Done")
    .setStyle(ButtonStyle.Secondary);
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(addMore, done)];
}
const AUTO_ACCEPT_RUNS = new Map<
  string,
  {
    canceled: boolean;
    ownerId: string | null;
  }
>();

function parseGameIdList(raw: string): number[] {
  const matches = raw.split(/[^0-9]+/).filter(Boolean);
  const ids = matches.map((part) => Number(part)).filter((id) => Number.isInteger(id) && id > 0);
  return Array.from(new Set(ids));
}

function buildAutoAcceptStopId(runId: string): string {
  return `${AUDIT_AUTO_STOP_PREFIX}:${runId}`;
}

function parseAutoAcceptStopId(id: string): string | null {
  const parts = id.split(":");
  if (parts.length !== 2 || parts[0] !== AUDIT_AUTO_STOP_PREFIX) {
    return null;
  }
  return parts[1] || null;
}

function buildAutoAcceptFollowUpPayload(
  embeds: EmbedBuilder[],
  components: ActionRowBuilder<ButtonBuilder>[],
  isPublic: boolean,
): InteractionReplyOptions {
  return {
    embeds,
    components,
    ...(isPublic ? {} : { flags: MessageFlags.Ephemeral }),
  };
}



@Discord()
@SlashGroup({ description: "Game Database Commands", name: "gamedb" })
@SlashGroup("gamedb")
export class GameDbAdmin {
  private async buildSynonymListPayload(
    ownerId: string,
    query: string,
    page: number,
    isPublic: boolean,
  ): Promise<{
    components: Array<
      ContainerBuilder | ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>
    >;
    flags: number;
  }> {
    const totalCount = await GameSearchSynonym.countSynonymGroups(query || undefined);
    const totalPages = Math.max(1, Math.ceil(totalCount / SYNONYM_LIST_PAGE_SIZE));
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);
    const offset = safePage * SYNONYM_LIST_PAGE_SIZE;

    const terms = await GameSearchSynonym.listSynonymGroups({
      query: query || undefined,
      limit: SYNONYM_LIST_PAGE_SIZE,
      offset,
    });

    const grouped = new Map<number, typeof terms>();
    terms.forEach((term) => {
      const list = grouped.get(term.groupId) ?? [];
      list.push(term);
      grouped.set(term.groupId, list);
    });

    const groupEntries = Array.from(grouped.entries());
    const groupLines = groupEntries.map(([, groupTerms], index) => {
      const termList = groupTerms.map((term) => `"${term.termText}"`);
      const arrowLine = termList.length > 1
        ? termList.join(" ➜ ")
        : termList.join("");
      return `${offset + index + 1}. ${arrowLine}`;
    });

    const titleLine = query
      ? `## Search Synonym Groups (Page ${safePage + 1}/${totalPages})\nQuery: ${query}`
      : `## Search Synonym Groups (Page ${safePage + 1}/${totalPages})`;
    const content = groupLines.length
      ? `${titleLine}\n\n${groupLines.join("\n")}`
      : `${titleLine}\n\nNo search synonyms found.`;

    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(content.slice(0, 4000)),
    );

    const prevDisabled = safePage === 0;
    const nextDisabled = safePage >= totalPages - 1;
    const prevButton = new ButtonBuilder()
      .setCustomId(buildSynonymListCustomId(ownerId, safePage, query, "prev"))
      .setLabel("Previous Page")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(prevDisabled);
    const nextButton = new ButtonBuilder()
      .setCustomId(buildSynonymListCustomId(ownerId, safePage, query, "next"))
      .setLabel("Next Page")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(nextDisabled);
    const addGroupButton = new ButtonBuilder()
      .setCustomId(
        buildSynonymGroupSelectCustomId(
          SYNONYM_ADD_FROM_LIST_PREFIX,
          ownerId,
          safePage,
          query,
        ),
      )
      .setLabel("Add New Group")
      .setStyle(ButtonStyle.Primary);
    const buttonRowItems: ButtonBuilder[] = [addGroupButton];
    if (shouldRenderPrevNextButtons(prevDisabled, nextDisabled)) {
      buttonRowItems.push(prevButton, nextButton);
    }
    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(buttonRowItems);

    const components: Array<
      ContainerBuilder | ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>
    > = [container];

    if (groupEntries.length) {
      const select = new StringSelectMenuBuilder()
        .setCustomId(buildSynonymGroupSelectCustomId(
          SYNONYM_EDIT_GROUP_SELECT_PREFIX,
          ownerId,
          safePage,
          query,
        ))
        .setPlaceholder("Select a group to edit");
      const selectOptions = groupEntries.map(([groupId, groupTerms], index) => {
        const termList = groupTerms.map((term) => `"${term.termText}"`).join(" ↔ ");
        return {
          label: `Group ${offset + index + 1}`,
          value: String(groupId),
          description: clampSynonymOptionText(termList, 100),
        };
      });
      select.addOptions(selectOptions);
      components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));

      const deleteSelect = new StringSelectMenuBuilder()
        .setCustomId(buildSynonymGroupSelectCustomId(
          SYNONYM_DELETE_GROUP_SELECT_PREFIX,
          ownerId,
          safePage,
          query,
        ))
        .setPlaceholder("Select a group to delete");
      deleteSelect.addOptions(selectOptions);
      components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(deleteSelect));
    }
    components.push(buttonRow);

    return {
      components,
      flags: buildComponentsV2Flags(!isPublic),
    };
  }
  @Slash({
    description: "Audit GameDB for missing images, videos, descriptions, or release data (Admin only)",
    name: "audit",
  })
  async audit(
    @SlashOption({
      description: "Filter for missing images",
      name: "missing_images",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    missingImages: boolean | undefined,
    @SlashOption({
      description: "Filter for missing featured videos",
      name: "missing_featured_video",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    missingFeaturedVideo: boolean | undefined,
    @SlashOption({
      description: "Filter for missing descriptions",
      name: "missing_descriptions",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    missingDescriptions: boolean | undefined,
    @SlashOption({
      description: "Filter for missing release data",
      name: "missing_release_data",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    missingReleaseData: boolean | undefined,
    @SlashOption({
      description: "Automatically accept IGDB images for all missing ones",
      name: "auto_accept_images",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    autoAcceptImages: boolean | undefined,
    @SlashOption({
      description: "Automatically accept IGDB featured videos for all missing ones",
      name: "auto_accept_videos",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    autoAcceptVideos: boolean | undefined,
    @SlashOption({
      description: "Automatically accept IGDB release data for all missing ones",
      name: "auto_accept_release_data",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    autoAcceptReleaseData: boolean | undefined,
    @SlashOption({
      description: "Optional title query (matches any word)",
      name: "query",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    queryRaw: string | undefined,
    @SlashOption({
      description: "Show only games with complete audit data",
      name: "show_complete_games",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showCompleteGames: boolean | undefined,
    @SlashOption({
      description: "Show in chat (public) instead of ephemeral",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const isPublic = !!showInChat;
    await safeDeferReply(interaction, { flags: isPublic ? undefined : MessageFlags.Ephemeral });

    if (!(await isAdmin(interaction))) return;

    const query = queryRaw
      ? sanitizeUserInput(queryRaw, { preserveNewlines: false })
      : "";
    const queryWords = query
      .split(/\s+/)
      .map((word) => word.trim())
      .filter(Boolean);

    if (autoAcceptImages || autoAcceptVideos || autoAcceptReleaseData) {
      if (autoAcceptImages) {
        await this.runAutoAcceptImages(
          interaction,
          isPublic,
          Boolean(autoAcceptVideos || autoAcceptReleaseData),
          queryWords,
        );
      }
      if (autoAcceptVideos) {
        await this.runAutoAcceptVideos(
          interaction,
          isPublic,
          Boolean(autoAcceptImages || autoAcceptReleaseData),
          queryWords,
        );
      }
      if (autoAcceptReleaseData) {
        await this.runAutoAcceptReleaseData(
          interaction,
          isPublic,
          Boolean(autoAcceptImages || autoAcceptVideos),
          queryWords,
        );
      }
      return;
    }

    // Default to all if none specified, otherwise follow flags
    let checkImages = true;
    let checkFeaturedVideo = true;
    let checkDescriptions = true;
    let checkReleaseData = true;
    const useCompleteOnly = Boolean(showCompleteGames);

    if (
      missingImages !== undefined ||
      missingFeaturedVideo !== undefined ||
      missingDescriptions !== undefined ||
      missingReleaseData !== undefined
    ) {
      checkImages = !!missingImages;
      checkFeaturedVideo = !!missingFeaturedVideo;
      checkDescriptions = !!missingDescriptions;
      checkReleaseData = !!missingReleaseData;
    }

    if (
      !useCompleteOnly &&
      !checkImages &&
      !checkFeaturedVideo &&
      !checkDescriptions &&
      !checkReleaseData
    ) {
      await safeReply(interaction, {
        content: "You must check for at least one thing (images, videos, descriptions, or release data).",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const games = await Game.getGamesForAudit(
      checkImages,
      checkFeaturedVideo,
      checkDescriptions,
      checkReleaseData,
      queryWords,
      useCompleteOnly,
    );

    if (games.length === 0) {
      await safeReply(interaction, {
        content: "No games found matching the audit criteria! Great job.",
        flags: isPublic ? undefined : MessageFlags.Ephemeral,
      });
      return;
    }

    const sessionId = interaction.id;
    const filterLabel = this.buildAuditFilterLabel(
      checkImages,
      checkFeaturedVideo,
      checkDescriptions,
      checkReleaseData,
      useCompleteOnly,
    );

    AUDIT_SESSIONS.set(sessionId, {
      userId: interaction.user.id,
      games,
      page: 0,
      filter: filterLabel,
    });

    const response = await this.buildAuditListResponse(sessionId);
    await safeReply(interaction, {
      ...response,
      flags: isPublic ? undefined : MessageFlags.Ephemeral,
    });
  }

  @Slash({ description: "Link alternate GameDB versions (Admin only)", name: "link-versions" })
  async linkVersions(
    @SlashOption({
      description: "Comma-separated GameDB ids to link together",
      name: "game_ids",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    gameIdsRaw: string,
    @SlashOption({
      description: "Show in chat (public) instead of ephemeral",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const isPublic = !!showInChat;
    await safeDeferReply(interaction, { flags: isPublic ? undefined : MessageFlags.Ephemeral });

    if (!(await isAdmin(interaction))) return;

    gameIdsRaw = sanitizeUserInput(gameIdsRaw, { preserveNewlines: false });
    const gameIds = parseGameIdList(gameIdsRaw);
    if (gameIds.length < 2) {
      await safeReply(interaction, {
        content: "Provide at least two valid GameDB ids to link.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const games = await Game.getGamesByIds(gameIds);
    const foundIds = new Set(games.map((game) => game.id));
    const missingIds = gameIds.filter((id) => !foundIds.has(id));
    if (missingIds.length) {
      await safeReply(interaction, {
        content: `Missing GameDB id(s): ${missingIds.join(", ")}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await Game.linkAlternateVersions(gameIds, interaction.user.id);
    const lines = games
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((game) => `• **${game.title}** (GameDB #${game.id})`);
    const embed = new EmbedBuilder()
      .setTitle("Linked Alternate Versions")
      .setDescription(lines.join("\n"));

    await safeReply(interaction, {
      embeds: [embed],
      flags: isPublic ? undefined : MessageFlags.Ephemeral,
    });
  }

  @ButtonComponent({ id: /^audit-page:[^:]+:(next|prev)$/ })
  async handleAuditPage(interaction: ButtonInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const sessionId = parts[1];
    const direction = parts[2];

    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session) {
      await safeUpdate(interaction, { content: "Session expired.", components: [] });
      return;
    }

    if (session.userId !== interaction.user.id) return;

    const totalPages = Math.ceil(session.games.length / AUDIT_PAGE_SIZE);
    if (direction === "next" && session.page < totalPages - 1) {
      session.page++;
    } else if (direction === "prev" && session.page > 0) {
      session.page--;
    }

    const response = await this.buildAuditListResponse(sessionId);
    await safeUpdate(interaction, response);
  }

  @SelectMenuComponent({ id: /^audit-select:[^:]+$/ })
  async handleAuditSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const sessionId = parts[1];

    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session) {
      await safeUpdate(interaction, { content: "Session expired.", components: [] });
      return;
    }

    if (session.userId !== interaction.user.id) return;

    const gameId = Number(interaction.values[0]);
    const game = session.games.find((g) => g.id === gameId);

    if (!game) {
      await safeUpdate(interaction, { content: "Game not found in session." });
      return;
    }

    const response = await this.buildAuditDetailResponse(sessionId, game);
    await safeUpdate(interaction, response);
  }

  @ButtonComponent({ id: /^audit-back:[^:]+$/ })
  async handleAuditBack(interaction: ButtonInteraction): Promise<void> {
    const sessionId = interaction.customId.split(":")[1];
    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session) {
      await safeUpdate(interaction, { content: "Session expired.", components: [] });
      return;
    }
    const response = await this.buildAuditListResponse(sessionId);
    await safeUpdate(interaction, response);
  }

  @ButtonComponent({ id: /^audit-next:[^:]+:\d+$/ })
  async handleAuditNext(interaction: ButtonInteraction): Promise<void> {
    const [, sessionId, gameIdStr] = interaction.customId.split(":");
    const gameId = Number(gameIdStr);
    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session || session.userId !== interaction.user.id) return;

    const currentIndex = session.games.findIndex((game) => game.id === gameId);
    const nextIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
    if (nextIndex >= session.games.length) {
      const response = await this.buildAuditListResponse(sessionId);
      await safeUpdate(interaction, response);
      return;
    }

    const nextGame = session.games[nextIndex];
    const response = await this.buildAuditDetailResponse(sessionId, nextGame);
    await safeUpdate(interaction, response);
  }

  @ButtonComponent({ id: /^audit-accept-igdb:[^:]+:\d+$/ })
  async handleAuditAcceptIgdb(interaction: ButtonInteraction): Promise<void> {
    const [, sessionId, gameIdStr] = interaction.customId.split(":");
    const gameId = Number(gameIdStr);

    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session || session.userId !== interaction.user.id) return;

    const game = session.games.find(g => g.id === gameId);
    if (!game || !game.igdbId) {
      await safeReply(interaction, { content: "Invalid game or missing IGDB ID.", flags: MessageFlags.Ephemeral });
      return;
    }

    await safeReply(interaction, { content: "Fetching image from IGDB...", flags: MessageFlags.Ephemeral });

    try {
      const details = await igdbService.getGameDetails(game.igdbId);
      if (!details || !details.cover?.image_id) {
        await safeReply(interaction, { content: "Failed to find cover image on IGDB.", flags: MessageFlags.Ephemeral });
        return;
      }

      const imageUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${details.cover.image_id}.jpg`;
      const resp = await axios.get(imageUrl, { responseType: "arraybuffer" });
      const buffer = Buffer.from(resp.data);

      await Game.updateGameImage(gameId, buffer);
      
      // Update session data
      if (game) {
        game.imageData = buffer;
      }

      await safeReply(interaction, { content: "IGDB Image accepted and saved!", flags: MessageFlags.Ephemeral });

    } catch (err: any) {
      await safeReply(interaction, { content: `Error fetching IGDB image: ${err.message}`, flags: MessageFlags.Ephemeral });
    }
  }

  @ButtonComponent({ id: /^audit-img:[^:]+:\d+$/ })
  async handleAuditImage(interaction: ButtonInteraction): Promise<void> {
    const [, sessionId, gameIdStr] = interaction.customId.split(":");
    const gameId = Number(gameIdStr);
    
    // We need to use a collector in the channel to get the image
    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session || session.userId !== interaction.user.id) return;

    await safeReply(interaction, {
        content: "Please upload an image (or paste a URL) for this game in the chat.",
        flags: MessageFlags.Ephemeral 
    });

    const channel = interaction.channel as any;
    if (!channel) return;

    try {
      const collected = await channel.awaitMessages({
        filter: (m: any) => m.author.id === interaction.user.id && (m.attachments.size > 0 || m.content.length > 0),
        max: 1,
        time: 60000,
        errors: ["time"],
      });

      const msg = collected.first();
      if (!msg) return;

      let imageUrl = "";
      if (msg.attachments.size > 0) {
        imageUrl = msg.attachments.first()?.url ?? "";
      } else {
        imageUrl = msg.content.trim();
      }

      // Validate URL roughly
      if (!imageUrl.startsWith("http")) {
        await safeReply(interaction, { content: "Invalid image URL/attachment.", flags: MessageFlags.Ephemeral });
        return;
      }

      await safeReply(interaction, { content: "Processing image...", flags: MessageFlags.Ephemeral });
      
      try {
        const resp = await axios.get(imageUrl, { responseType: "arraybuffer" });
        const buffer = Buffer.from(resp.data);
        
        await Game.updateGameImage(gameId, buffer);
        await msg.delete().catch(() => {});

        // Update session data locally so UI reflects change if we go back/refresh
        const game = session.games.find(g => g.id === gameId);
        if (game) {
             game.imageData = buffer;
        }

        await safeReply(interaction, { content: "Image updated successfully!", flags: MessageFlags.Ephemeral });
        
        // Refresh detail view
        // We can't easily "edit" the previous interaction message from here without the interaction object flow
        // But the user can click "Back" or re-select to see changes, or we could update the message if we had access.
        // Since this is a new reply, let's just let them know.

      } catch (err: any) {
        await safeReply(interaction, { content: `Failed to update image: ${err.message}`, flags: MessageFlags.Ephemeral });
      }

    } catch {
      await safeReply(interaction, { content: "Timed out waiting for image.", flags: MessageFlags.Ephemeral });
    }
  }



  @ButtonComponent({ id: /^audit-accept-video:[^:]+:\d+$/ })
  async handleAuditAcceptVideo(interaction: ButtonInteraction): Promise<void> {
    const [, sessionId, gameIdStr] = interaction.customId.split(":");
    const gameId = Number(gameIdStr);

    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session || session.userId !== interaction.user.id) return;

    const game = session.games.find(g => g.id === gameId);
    if (!game || !game.igdbId) {
      await safeReply(interaction, { content: "Invalid game or missing IGDB ID.", flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      await interaction.deferUpdate();
    } catch {
      // ignore
    }

    try {
      const details = await igdbService.getGameDetails(game.igdbId);
      const videoUrl = details ? Game.getFeaturedVideoUrl(details) : null;
      if (!videoUrl) {
        await safeReply(interaction, { content: "No featured video found on IGDB.", flags: MessageFlags.Ephemeral });
        return;
      }

      await Game.updateFeaturedVideoUrl(gameId, videoUrl);
      game.featuredVideoUrl = videoUrl;
      if (session.filter === "video") {
        session.games = session.games.filter((entry) => entry.id !== gameId);
      }

      const refreshed = await Game.getGameById(gameId);
      if (refreshed) {
        const response = await this.buildAuditDetailResponse(sessionId, refreshed);
        await safeUpdate(interaction, response);
      }

      // no extra success message
    } catch (err: any) {
      await safeReply(interaction, { content: `Error fetching featured video: ${err.message}`, flags: MessageFlags.Ephemeral });
    }
  }

  @ButtonComponent({ id: /^audit-video:[^:]+:\d+$/ })
  async handleAuditVideo(interaction: ButtonInteraction): Promise<void> {
    const [, sessionId, gameIdStr] = interaction.customId.split(":");
    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session || session.userId !== interaction.user.id) return;

    const modal = new ModalBuilder()
      .setCustomId(`${AUDIT_VIDEO_MODAL_ID}:${sessionId}:${gameIdStr}`)
      .setTitle("Add YouTube Video")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(AUDIT_VIDEO_INPUT_ID)
            .setLabel("YouTube URL")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder("https://www.youtube.com/watch?v=..."),
        ),
      );

    await interaction.showModal(modal).catch(() => {});
  }

  @ButtonComponent({ id: /^audit-description:[^:]+:\d+$/ })
  async handleAuditDescription(interaction: ButtonInteraction): Promise<void> {
    const [, sessionId, gameIdStr] = interaction.customId.split(":");
    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session || session.userId !== interaction.user.id) return;

    const modal = new ModalBuilder()
      .setCustomId(`${AUDIT_DESCRIPTION_MODAL_ID}:${sessionId}:${gameIdStr}`)
      .setTitle("Add Description")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(AUDIT_DESCRIPTION_INPUT_ID)
            .setLabel("Description")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(2000),
        ),
      );

    await interaction.showModal(modal).catch(() => {});
  }

  @ModalComponent({ id: /^audit-video-modal:[^:]+:\d+$/ })
  async handleAuditVideoModal(interaction: ModalSubmitInteraction): Promise<void> {
    const [, sessionId, gameIdStr] = interaction.customId.split(":");
    const gameId = Number(gameIdStr);
    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session || session.userId !== interaction.user.id) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    const rawUrl = interaction.fields.getTextInputValue(AUDIT_VIDEO_INPUT_ID);
    const videoUrl = sanitizeUserInput(rawUrl, { preserveNewlines: false });
    if (!videoUrl || !videoUrl.startsWith("http")) {
      await interaction.editReply({ content: "Please provide a valid YouTube URL." });
      return;
    }

    await Game.updateFeaturedVideoUrl(gameId, videoUrl);

    const sessionGame = session.games.find((game) => game.id === gameId);
    if (sessionGame) {
      sessionGame.featuredVideoUrl = videoUrl;
    }
    if (session.filter === "video") {
      session.games = session.games.filter((entry) => entry.id !== gameId);
    }

    const refreshed = await Game.getGameById(gameId);
    if (refreshed && interaction.message) {
      const response = await this.buildAuditDetailResponse(sessionId, refreshed);
      await interaction.message.edit(response).catch(() => {});
    }

    await interaction.deleteReply().catch(() => {});
  }

  @ModalComponent({ id: /^audit-description-modal:[^:]+:\d+$/ })
  async handleAuditDescriptionModal(interaction: ModalSubmitInteraction): Promise<void> {
    const [, sessionId, gameIdStr] = interaction.customId.split(":");
    const gameId = Number(gameIdStr);
    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session || session.userId !== interaction.user.id) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    const rawDescription = interaction.fields.getTextInputValue(AUDIT_DESCRIPTION_INPUT_ID);
    const description = sanitizeUserInput(rawDescription, { preserveNewlines: true });
    if (!description) {
      await interaction.editReply({ content: "Please provide a valid description." });
      return;
    }

    await Game.updateGameDescription(gameId, description);

    const sessionGame = session.games.find((game) => game.id === gameId);
    if (sessionGame) {
      sessionGame.description = description;
    }
    if (session.filter === "description") {
      session.games = session.games.filter((entry) => entry.id !== gameId);
    }

    const refreshed = await Game.getGameById(gameId);
    if (refreshed && interaction.message) {
      const response = await this.buildAuditDetailResponse(sessionId, refreshed);
      await interaction.message.edit(response).catch(() => {});
    }

    await interaction.deleteReply().catch(() => {});
  }

  @ButtonComponent({ id: /^audit-auto-stop:[^:]+$/ })
  async stopAutoAccept(interaction: ButtonInteraction): Promise<void> {
    const runId = parseAutoAcceptStopId(interaction.customId);
    if (!runId) {
      await safeUpdate(interaction, { components: [] });
      return;
    }

    const run = AUTO_ACCEPT_RUNS.get(runId);
    if (!run) {
      await safeReply(interaction, {
        content: "This audit run has already finished.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.guild?.ownerId !== interaction.user.id) {
      await safeReply(interaction, {
        content: "Only the server owner can stop this audit.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    run.canceled = true;
    AUTO_ACCEPT_RUNS.set(runId, run);

    const stopRow = this.buildAutoAcceptStopRow(runId, true, "Stopping...");
    await safeUpdate(interaction, {
      components: [stopRow],
    });
  }

  private buildAutoAcceptStopRow(
    runId: string,
    disabled: boolean,
    label: string = "Stop",
  ): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildAutoAcceptStopId(runId))
        .setLabel(label)
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled),
    );
  }

  private buildAuditFilterLabel(
    checkImages: boolean,
    checkFeaturedVideo: boolean,
    checkDescriptions: boolean,
    checkReleaseData: boolean,
    showComplete: boolean,
  ): "all" | "image" | "video" | "description" | "release" | "mixed" | "complete" {
    if (showComplete) return "complete";
    const enabled = [
      checkImages,
      checkFeaturedVideo,
      checkDescriptions,
      checkReleaseData,
    ].filter(Boolean).length;
    if (enabled === 4) return "all";
    if (enabled === 1) {
      if (checkImages) return "image";
      if (checkFeaturedVideo) return "video";
      if (checkDescriptions) return "description";
      return "release";
    }
    return "mixed";
  }

  private async buildAuditListResponse(sessionId: string) {
    const session = AUDIT_SESSIONS.get(sessionId)!;
    const { games, page } = session;

    const totalPages = Math.ceil(games.length / AUDIT_PAGE_SIZE);
    const start = page * AUDIT_PAGE_SIZE;
    const end = start + AUDIT_PAGE_SIZE;
    const slice = games.slice(start, end);

    const embed = new EmbedBuilder()
      .setTitle(`GameDB Audit (${session.filter})`)
      .setDescription(
        `Showing items ${start + 1}-${Math.min(end, games.length)} of ${games.length}\n\n` +
        slice.map((g) => {
          const imageStatus = g.imageData ? "✅Img" : "❌Img";
          const videoStatus = g.featuredVideoUrl ? "✅Vid" : "❌Vid";
          const descStatus = g.description ? "✅Desc" : "❌Desc";
          const releaseStatus = g.initialReleaseDate ? "✅Rel" : "❌Rel";
          return `• **${g.title}** (ID: ${g.id}) ` +
            `${imageStatus} ${videoStatus} ${descStatus} ${releaseStatus}`;
        }).join("\n")
      )
      .setFooter({ text: `Page ${page + 1}/${totalPages}` });

    const select = new StringSelectMenuBuilder()
      .setCustomId(`audit-select:${sessionId}`)
      .setPlaceholder("Select a game to audit")
      .addOptions(
        slice.map(g => ({
          label: g.title.substring(0, 100),
          value: String(g.id),
          description: `ID: ${g.id}`,
        }))
      );

    const prevDisabled = page === 0;
    const nextDisabled = page >= totalPages - 1;

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`audit-page:${sessionId}:prev`)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(prevDisabled),
      new ButtonBuilder()
        .setCustomId(`audit-page:${sessionId}:next`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(nextDisabled)
    );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

    const components: ActionRowBuilder<any>[] = [row];
    if (shouldRenderPrevNextButtons(prevDisabled, nextDisabled)) {
      components.push(buttons);
    }

    return {
      embeds: [embed],
      components,
      files: []
    };
  }

  private async buildAuditDetailResponse(sessionId: string, game: IGame) {
    const embed = new EmbedBuilder()
      .setTitle(`Audit: ${game.title}`)
      .setDescription(`Game ID: ${game.id}\nIGDB ID: ${game.igdbId ?? "N/A"}`)
      .setColor(0xFFA500); // Orange for audit

    const files: AttachmentBuilder[] = [];

    let igdbImageAvailable = false;
    let igdbImageUrl = "";
    let igdbVideoUrl: string | null = null;
    let igdbDetailsLoaded = false;

    // Check IGDB for image if missing
    if ((!game.imageData || !game.featuredVideoUrl) && game.igdbId) {
      try {
        const details = await igdbService.getGameDetails(game.igdbId);
        igdbDetailsLoaded = true;
        if (!game.imageData && details?.cover?.image_id) {
          igdbImageAvailable = true;
          igdbImageUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${details.cover.image_id}.jpg`;
          embed.addFields({
            name: "IGDB Suggestion",
            value: "[Link to Image](" + igdbImageUrl + ")",
            inline: true,
          });
        }
        if (details && !game.featuredVideoUrl) {
          igdbVideoUrl = Game.getFeaturedVideoUrl(details);
        }
      } catch {
        // ignore
      }
    }

    if (game.imageData) {
        embed.addFields({ name: "Image", value: "✅ Present", inline: true });
        // Optionally show it
        const attach = new AttachmentBuilder(game.imageData, { name: "cover.jpg" });
        files.push(attach);
        embed.setImage("attachment://cover.jpg");
    } else {
        embed.addFields({ name: "Image", value: "❌ Missing", inline: true });
    }

    if (game.featuredVideoUrl) {
        embed.addFields({ name: "Featured Video", value: "✅ Present", inline: true });
    } else {
        embed.addFields({ name: "Featured Video", value: "❌ Missing", inline: true });
    }

    if (game.description) {
      embed.addFields({ name: "Description", value: "✅ Present", inline: true });
    } else {
      embed.addFields({ name: "Description", value: "❌ Missing", inline: true });
    }

    const releases = await Game.getGameReleases(game.id);
    if (releases.length) {
      embed.addFields({
        name: "Release Data",
        value: `✅ ${releases.length} release${releases.length === 1 ? "" : "s"}`,
        inline: true,
      });
    } else {
      embed.addFields({ name: "Release Data", value: "❌ Missing", inline: true });
    }

    // Check thread link
    const associations = await Game.getGameAssociations(game.id);
    const nowPlaying = await Game.getNowPlayingMembers(game.id); // Also checks for thread links in its query
    
    // Find any thread
    const threadId = 
        associations.gotmWins.find(w => w.threadId)?.threadId ??
        associations.nrGotmWins.find(w => w.threadId)?.threadId ??
        nowPlaying.find(p => p.threadId)?.threadId;

    if (threadId) {
        embed.addFields({ name: "Thread", value: `✅ <#${threadId}>`, inline: true });
    } else {
        embed.addFields({ name: "Thread", value: "❌ Missing", inline: true });
    }

    const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`audit-back:${sessionId}`)
        .setLabel("Back to List")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`audit-next:${sessionId}:${game.id}`)
        .setLabel("Go to Next Game")
        .setStyle(ButtonStyle.Secondary),
    );

    const actionRow = new ActionRowBuilder<ButtonBuilder>();
    if (!game.imageData && igdbImageAvailable) {
      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`audit-accept-igdb:${sessionId}:${game.id}`)
          .setLabel("Accept IGDB Image")
          .setStyle(ButtonStyle.Success),
      );
    }

    if (!game.featuredVideoUrl && (igdbVideoUrl || igdbDetailsLoaded)) {
      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`audit-accept-video:${sessionId}:${game.id}`)
          .setLabel("Accept IGDB Video")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(!igdbVideoUrl),
      );
    }

    const session = AUDIT_SESSIONS.get(sessionId);
    if (session) {
      if (!game.featuredVideoUrl && ["video", "mixed", "all"].includes(session.filter)) {
        actionRow.addComponents(
          new ButtonBuilder()
            .setCustomId(`audit-video:${sessionId}:${game.id}`)
            .setLabel("Add YouTube Video")
            .setStyle(ButtonStyle.Primary),
        );
      }
      if (!game.description && ["description", "mixed", "all"].includes(session.filter)) {
        actionRow.addComponents(
          new ButtonBuilder()
            .setCustomId(`audit-description:${sessionId}:${game.id}`)
            .setLabel("Add Description")
            .setStyle(ButtonStyle.Primary),
        );
      }
    }

    const editRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`audit-img:${sessionId}:${game.id}`)
        .setLabel("Upload Image")
        .setStyle(ButtonStyle.Primary),
    );

    const components: ActionRowBuilder<ButtonBuilder>[] = [navRow];
    if (actionRow.components.length) {
      components.push(actionRow);
    }
    components.push(editRow);

    return {
      embeds: [embed],
      components,
      files: files.length ? files : undefined,
    };
  }

  private async runAutoAcceptImages(
    interaction: CommandInteraction,
    isPublic: boolean,
    useFollowUp: boolean,
    titleWords?: string[],
  ): Promise<void> {
    const runId = `audit-auto-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    AUTO_ACCEPT_RUNS.set(runId, {
      canceled: false,
      ownerId: interaction.guild?.ownerId ?? null,
    });

    let currentEmbed = new EmbedBuilder()
      .setTitle("Auto-Accept IGDB Images")
      .setDescription("Starting auto accept run...")
      .setColor(0x0099ff);
    const stopRow = this.buildAutoAcceptStopRow(runId, false);

    const followUpPayload = buildAutoAcceptFollowUpPayload([currentEmbed], [stopRow], isPublic);
    const editPayload = {
      embeds: [currentEmbed],
      components: [stopRow],
    };
    let currentMessage: any = null;
    try {
      currentMessage = useFollowUp
        ? await interaction.followUp(followUpPayload)
        : await interaction.editReply(editPayload);
    } catch {
      // ignore
    }
    if (!currentMessage) {
      try {
        currentMessage = await interaction.followUp(followUpPayload);
      } catch {
        // ignore
      }
    }

    const logLines: string[] = [];
    let currentChunk = 0;
    const shouldStop = (): boolean => AUTO_ACCEPT_RUNS.get(runId)?.canceled ?? true;
    const updateEmbed = async (log?: string, processed?: number) => {
      if (processed && processed > 0) {
        const chunk = Math.floor((processed - 1) / 50);
        if (chunk !== currentChunk) {
          currentChunk = chunk;
          currentEmbed = new EmbedBuilder()
            .setTitle("Auto-Accept IGDB Images")
            .setDescription("Processing...")
            .setColor(0x0099ff);
          logLines.length = 0;
          try {
            currentMessage = await interaction.followUp(
              buildAutoAcceptFollowUpPayload(
                [currentEmbed],
                [this.buildAutoAcceptStopRow(runId, shouldStop())],
                isPublic,
              ),
            );
          } catch {
            // ignore
          }
        }
      }
      if (log) {
        logLines.push(log);
      }

      let content = logLines.join("\n");
      while (content.length > 3500) {
        logLines.shift();
        content = logLines.join("\n");
      }

      currentEmbed.setDescription(content || "Processing...");
      try {
        if (currentMessage?.edit) {
          await currentMessage.edit({
            embeds: [currentEmbed],
            components: [this.buildAutoAcceptStopRow(runId, shouldStop())],
          });
        }
      } catch {
        // ignore
      }
    };

    const { updated, skipped, failed, logs } = await performAutoAcceptImages(
      updateEmbed,
      shouldStop,
      titleWords,
    );
    if (!logs.length) {
      await safeReply(interaction, {
        content: "No games found with missing images and valid IGDB IDs.",
        flags: isPublic ? undefined : MessageFlags.Ephemeral,
      });
      AUTO_ACCEPT_RUNS.delete(runId);
      return;
    }

    const summary =
      `\n**Run Complete**\n✅ Updated: ${updated}\n` +
      `⏭️ Skipped: ${skipped}\n❌ Failed: ${failed}`;
    await updateEmbed(summary);
    currentEmbed.setColor(0x2ecc71);
    const stopped = shouldStop();
    const finalStopRow = this.buildAutoAcceptStopRow(
      runId,
      true,
      stopped ? "Stopped" : "Stop",
    );
    if (currentMessage?.edit) {
      await currentMessage.edit({ embeds: [currentEmbed], components: [finalStopRow] });
    }
    AUTO_ACCEPT_RUNS.delete(runId);
  }

  private async runAutoAcceptVideos(
    interaction: CommandInteraction,
    isPublic: boolean,
    useFollowUp: boolean,
    titleWords?: string[],
  ): Promise<void> {
    const runId = `audit-auto-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    AUTO_ACCEPT_RUNS.set(runId, {
      canceled: false,
      ownerId: interaction.guild?.ownerId ?? null,
    });

    let currentEmbed = new EmbedBuilder()
      .setTitle("Auto-Accept IGDB Videos")
      .setDescription("Starting auto accept run...")
      .setColor(0x0099ff);
    const stopRow = this.buildAutoAcceptStopRow(runId, false);

    const followUpPayload = buildAutoAcceptFollowUpPayload([currentEmbed], [stopRow], isPublic);
    const editPayload = {
      embeds: [currentEmbed],
      components: [stopRow],
    };
    let currentMessage: any = null;
    try {
      currentMessage = useFollowUp
        ? await interaction.followUp(followUpPayload)
        : await interaction.editReply(editPayload);
    } catch {
      // ignore
    }
    if (!currentMessage) {
      try {
        currentMessage = await interaction.followUp(followUpPayload);
      } catch {
        // ignore
      }
    }

    const logLines: string[] = [];
    let currentChunk = 0;
    const shouldStop = (): boolean => AUTO_ACCEPT_RUNS.get(runId)?.canceled ?? true;
    const updateEmbed = async (log?: string, processed?: number) => {
      if (processed && processed > 0) {
        const chunk = Math.floor((processed - 1) / 50);
        if (chunk !== currentChunk) {
          currentChunk = chunk;
          currentEmbed = new EmbedBuilder()
            .setTitle("Auto-Accept IGDB Videos")
            .setDescription("Processing...")
            .setColor(0x0099ff);
          logLines.length = 0;
          try {
            currentMessage = await interaction.followUp(
              buildAutoAcceptFollowUpPayload(
                [currentEmbed],
                [this.buildAutoAcceptStopRow(runId, shouldStop())],
                isPublic,
              ),
            );
          } catch {
            // ignore
          }
        }
      }
      if (log) {
        logLines.push(log);
      }

      let content = logLines.join("\n");
      while (content.length > 3500) {
        logLines.shift();
        content = logLines.join("\n");
      }

      currentEmbed.setDescription(content || "Processing...");
      try {
        if (currentMessage?.edit) {
          await currentMessage.edit({
            embeds: [currentEmbed],
            components: [this.buildAutoAcceptStopRow(runId, shouldStop())],
          });
        }
      } catch {
        // ignore
      }
    };

    const { updated, skipped, failed, logs } = await performAutoAcceptVideos(
      updateEmbed,
      shouldStop,
      titleWords,
    );
    if (!logs.length) {
      await safeReply(interaction, {
        content: "No games found with missing featured videos and valid IGDB IDs.",
        __forceFollowUp: useFollowUp,
        flags: isPublic ? undefined : MessageFlags.Ephemeral,
      });
      AUTO_ACCEPT_RUNS.delete(runId);
      return;
    }

    const summary =
      `\n**Run Complete**\n✅ Updated: ${updated}\n` +
      `⏭️ Skipped: ${skipped}\n❌ Failed: ${failed}`;
    await updateEmbed(summary);
    currentEmbed.setColor(0x2ecc71);
    const stopped = shouldStop();
    const finalStopRow = this.buildAutoAcceptStopRow(
      runId,
      true,
      stopped ? "Stopped" : "Stop",
    );
    if (currentMessage?.edit) {
      await currentMessage.edit({ embeds: [currentEmbed], components: [finalStopRow] });
    }
    AUTO_ACCEPT_RUNS.delete(runId);
  }

  private async runAutoAcceptReleaseData(
    interaction: CommandInteraction,
    isPublic: boolean,
    useFollowUp: boolean,
    titleWords?: string[],
  ): Promise<void> {
    const runId = `audit-auto-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    AUTO_ACCEPT_RUNS.set(runId, {
      canceled: false,
      ownerId: interaction.guild?.ownerId ?? null,
    });

    let currentEmbed = new EmbedBuilder()
      .setTitle("Auto-Accept IGDB Release Data")
      .setDescription("Starting auto accept run...")
      .setColor(0x0099ff);
    const stopRow = this.buildAutoAcceptStopRow(runId, false);

    const followUpPayload = buildAutoAcceptFollowUpPayload([currentEmbed], [stopRow], isPublic);
    const editPayload = {
      embeds: [currentEmbed],
      components: [stopRow],
    };
    let currentMessage: any = null;
    try {
      currentMessage = useFollowUp
        ? await interaction.followUp(followUpPayload)
        : await interaction.editReply(editPayload);
    } catch {
      // ignore
    }
    if (!currentMessage) {
      try {
        currentMessage = await interaction.followUp(followUpPayload);
      } catch {
        // ignore
      }
    }

    const logLines: string[] = [];
    let currentChunk = 0;
    const shouldStop = (): boolean => AUTO_ACCEPT_RUNS.get(runId)?.canceled ?? true;
    const updateEmbed = async (log?: string, processed?: number) => {
      if (processed && processed > 0) {
        const chunk = Math.floor((processed - 1) / 50);
        if (chunk !== currentChunk) {
          currentChunk = chunk;
          currentEmbed = new EmbedBuilder()
            .setTitle("Auto-Accept IGDB Release Data")
            .setDescription("Processing...")
            .setColor(0x0099ff);
          logLines.length = 0;
          try {
            currentMessage = await interaction.followUp(
              buildAutoAcceptFollowUpPayload(
                [currentEmbed],
                [this.buildAutoAcceptStopRow(runId, shouldStop())],
                isPublic,
              ),
            );
          } catch {
            // ignore
          }
        }
      }
      if (log) {
        logLines.push(log);
      }

      let content = logLines.join("\n");
      while (content.length > 3500) {
        logLines.shift();
        content = logLines.join("\n");
      }

      currentEmbed.setDescription(content || "Processing...");
      try {
        if (currentMessage?.edit) {
          await currentMessage.edit({
            embeds: [currentEmbed],
            components: [this.buildAutoAcceptStopRow(runId, shouldStop())],
          });
        }
      } catch {
        // ignore
      }
    };

    const { updated, skipped, failed, logs } = await performAutoAcceptReleaseData(
      updateEmbed,
      shouldStop,
      titleWords,
    );
    if (!logs.length) {
      await safeReply(interaction, {
        content: "No games found with missing release data and valid IGDB IDs.",
        __forceFollowUp: useFollowUp,
        flags: isPublic ? undefined : MessageFlags.Ephemeral,
      });
      AUTO_ACCEPT_RUNS.delete(runId);
      return;
    }

    const summary =
      `\n**Run Complete**\n✅ Updated: ${updated}\n` +
      `⏭️ Skipped: ${skipped}\n❌ Failed: ${failed}`;
    await updateEmbed(summary);
    currentEmbed.setColor(0x2ecc71);
    const stopped = shouldStop();
    const finalStopRow = this.buildAutoAcceptStopRow(
      runId,
      true,
      stopped ? "Stopped" : "Stop",
    );
    if (currentMessage?.edit) {
      await currentMessage.edit({ embeds: [currentEmbed], components: [finalStopRow] });
    }
    AUTO_ACCEPT_RUNS.delete(runId);
  }

  @Slash({
    description: "List GameDB search synonyms (Admin only)",
    name: "synonym-list",
  })
  async synonymList(
    @SlashOption({
      description: "Optional query to filter terms",
      name: "query",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    query: string | undefined,
    @SlashOption({
      description: "Show in chat (public) instead of ephemeral",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const isPublic = !!showInChat;
    await safeDeferReply(interaction, { flags: isPublic ? undefined : MessageFlags.Ephemeral });
    if (!(await isAdmin(interaction))) return;

    const cleanedQuery = query ? sanitizeUserInput(query, { preserveNewlines: false }) : "";
    const payload = await this.buildSynonymListPayload(
      interaction.user.id,
      cleanedQuery,
      0,
      isPublic,
    );
    await safeReply(interaction, payload);
  }

  @ModalComponent({ id: /^gamedb-syn-add:\d+$/ })
  async synonymAddModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const draftId = Number(parts[1]);
    if (!Number.isInteger(draftId) || draftId <= 0) {
      await safeReply(interaction, {
        content: "This synonym draft is no longer valid.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const draft = await GameSearchSynonymDraft.getDraft(draftId);
    if (!draft || draft.userId !== interaction.user.id) {
      await safeReply(interaction, {
        content: "This synonym draft is no longer available.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const rawInput = interaction.fields.getTextInputValue(SYNONYM_ADD_BULK_INPUT_ID);
    const cleanedInput = sanitizeUserInput(rawInput, { preserveNewlines: true });
    const pairs = parseSynonymPairs(cleanedInput, 50);
    if (!pairs.length) {
      await safeReply(interaction, {
        content:
          "No valid pairs found. Use one pair per line with a separator like \"<->\" or \"->\".",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const addedLines: string[] = [];
    const errors: string[] = [];
    for (const pair of pairs) {
      const termText = sanitizeUserInput(pair.term, { preserveNewlines: false });
      const matchText = sanitizeUserInput(pair.match, { preserveNewlines: false });
      if (!termText || !matchText) continue;
      try {
        const result = await GameSearchSynonym.addSynonymPair(
          termText,
          matchText,
          interaction.user.id,
        );
        const list = result.terms.map((item) => `"${item.termText}"`).join(" | ");
        addedLines.push(`Group ${result.groupId}: ${list}`);
      } catch (err: any) {
        errors.push(err?.message ?? `Failed to add ${termText}`);
      }
    }

    await GameSearchSynonymDraft.appendPairs(draftId, pairs);

    const summaryLines = [
      `Added ${addedLines.length} synonym pair${addedLines.length === 1 ? "" : "s"}.`,
      ...addedLines,
      ...(errors.length ? ["", "Errors:", ...errors] : []),
      "",
      "Use Add More to continue, or Done to finish.",
    ];
    let content = summaryLines.join("\n");
    if (content.length > 1900) {
      content = `${content.slice(0, 1900)}...`;
    }

    await safeReply(interaction, {
      content,
      components: buildSynonymContinueComponents(draftId),
      flags: MessageFlags.Ephemeral,
    });
  }

  @ButtonComponent({ id: /^gamedb-syn-more:\d+$/ })
  async synonymAddMore(interaction: ButtonInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const draftId = Number(parts[1]);
    if (!Number.isInteger(draftId) || draftId <= 0) {
      await safeReply(interaction, {
        content: "This synonym draft is no longer valid.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const draft = await GameSearchSynonymDraft.getDraft(draftId);
    if (!draft || draft.userId !== interaction.user.id) {
      await safeReply(interaction, {
        content: "This synonym draft is no longer available.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.showModal(buildSynonymAddModal(draftId)).catch(() => {});
  }

  @ButtonComponent({ id: /^gamedb-syn-done:\d+$/ })
  async synonymAddDone(interaction: ButtonInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const draftId = Number(parts[1]);
    if (!Number.isInteger(draftId) || draftId <= 0) {
      await safeReply(interaction, {
        content: "This synonym draft is no longer valid.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const draft = await GameSearchSynonymDraft.getDraft(draftId);
    if (!draft || draft.userId !== interaction.user.id) {
      await safeReply(interaction, {
        content: "This synonym draft is no longer available.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await GameSearchSynonymDraft.deleteDraft(draftId);
    await safeUpdate(interaction, {
      content: "Synonym entry complete.",
      components: [],
      flags: MessageFlags.Ephemeral,
    });
  }

  @SelectMenuComponent({ id: /^gamedb-syn-edit-group:\d+:\d+:[A-Za-z0-9_-]*$/ })
  async synonymGroupEditSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const parts = interaction.customId.split(":");
    const ownerId = parts[1];
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, {
        content: "This list isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const groupId = Number(interaction.values[0]);
    if (!Number.isInteger(groupId) || groupId <= 0) {
      await safeReply(interaction, {
        content: "Invalid synonym group selected.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const terms = await GameSearchSynonym.listGroupTerms(groupId);
    if (!terms.length) {
      await safeReply(interaction, {
        content: "Synonym group not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let termLines = terms.map((term) => term.termText).join("\n");
    if (termLines.length > 2000) {
      termLines = termLines.slice(0, 2000);
    }

    await interaction
      .showModal(buildSynonymGroupEditModal(ownerId, groupId, termLines))
      .catch(async () => {
        await safeReply(interaction, {
          content: "Unable to open the edit modal. Please try again.",
          flags: MessageFlags.Ephemeral,
        });
      });
  }

  @SelectMenuComponent({ id: /^gamedb-syn-delete-group:\d+:\d+:[A-Za-z0-9_-]*$/ })
  async synonymGroupDeleteSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const parts = interaction.customId.split(":");
    const ownerId = parts[1];
    const page = Number(parts[2]);
    const encodedQuery = parts[3] ?? "";
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, {
        content: "This list isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const groupId = Number(interaction.values[0]);
    if (!Number.isInteger(groupId) || groupId <= 0) {
      await safeReply(interaction, {
        content: "Invalid synonym group selected.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const deleted = await GameSearchSynonym.deleteGroup(groupId);
    if (!deleted) {
      await safeReply(interaction, {
        content: "Synonym group not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const query = sanitizeUserInput(decodeSynonymQuery(encodedQuery), { preserveNewlines: false });
    const isPublic = !(interaction.message?.flags?.has(MessageFlags.Ephemeral));
    const payload = await this.buildSynonymListPayload(
      ownerId,
      query,
      Number.isFinite(page) ? page : 0,
      isPublic,
    );
    await safeUpdate(interaction, payload);
  }

  @ButtonComponent({ id: /^gamedb-syn-add-from-list:\d+:\d+:[A-Za-z0-9_-]*$/ })
  async synonymAddFromList(interaction: ButtonInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const ownerId = parts[1];
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, {
        content: "This list isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const draft = await GameSearchSynonymDraft.createDraft(interaction.user.id);
    await interaction
      .showModal(buildSynonymAddModal(draft.draftId))
      .catch(async () => {
        await safeReply(interaction, {
          content: "Unable to open the synonym modal. Please try again.",
          flags: MessageFlags.Ephemeral,
        });
      });
  }

  @ModalComponent({ id: /^gamedb-syn-edit-group-modal:\d+:\d+$/ })
  async synonymGroupEditModal(
    interaction: ModalSubmitInteraction,
  ): Promise<void> {
    const parts = interaction.customId.split(":");
    const ownerId = parts[1];
    const groupId = Number(parts[2]);
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, {
        content: "This edit request isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!Number.isInteger(groupId) || groupId <= 0) {
      await safeReply(interaction, {
        content: "Invalid synonym group selected.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const rawInput = interaction.fields.getTextInputValue(SYNONYM_EDIT_GROUP_INPUT_ID);
    const cleanedInput = sanitizeUserInput(rawInput, { preserveNewlines: true });
    const terms: string[] = [];
    const seen = new Set<string>();
    for (const line of cleanedInput.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const norm = GameSearchSynonym.normalizeTerm(trimmed);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      terms.push(trimmed);
    }

    if (terms.length < 2) {
      await safeReply(interaction, {
        content: "Synonym groups must include at least two terms.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const result = await GameSearchSynonym.updateGroupTerms(
        groupId,
        terms,
        interaction.user.id,
      );
      const termList = result.terms.map((term) => `"${term.termText}"`).join(" | ");
      let content = `Updated synonym group with ${result.terms.length} terms:\n${termList}`;
      if (content.length > 1900) {
        content = `${content.slice(0, 1900)}...`;
      }
      await safeReply(interaction, {
        content,
        flags: MessageFlags.Ephemeral,
      });
    } catch (err: any) {
      await safeReply(interaction, {
        content: err?.message ?? "Failed to update synonym group.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @ButtonComponent({ id: /^gamedb-syn-page:\d+:\d+:[A-Za-z0-9_-]*:(next|prev)$/ })
  async synonymListPage(interaction: ButtonInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const ownerId = parts[1];
    const page = Number(parts[2]);
    const encodedQuery = parts[3] ?? "";
    const direction = parts[4];

    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, {
        content: "This list isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const query = sanitizeUserInput(decodeSynonymQuery(encodedQuery), { preserveNewlines: false });
    const delta = direction === "next" ? 1 : -1;
    const isPublic = !(interaction.message?.flags?.has(MessageFlags.Ephemeral));
    const payload = await this.buildSynonymListPayload(
      ownerId,
      query,
      Number.isFinite(page) ? page + delta : 0,
      isPublic,
    );

    await safeUpdate(interaction, payload);
  }
}
