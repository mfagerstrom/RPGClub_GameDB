import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import axios from "axios";
import type { ArgsOf, Client } from "discordx";
import { ButtonComponent, Discord, ModalComponent, On, SelectMenuComponent } from "discordx";
import Game from "../classes/Game.js";
import Member from "../classes/Member.js";
import { COMPLETION_TYPES, type CompletionType } from "../commands/profile.command.js";
import { createIgdbSession, type IgdbSelectOption } from "../services/IGDB/IgdbSelectService.js";
import { igdbService, type IGDBGameDetails } from "../services/IGDB/IgdbService.js";
import { stripModalInput } from "../functions/InteractionUtils.js";
import { notifyUnknownCompletionPlatform } from "../functions/CompletionHelpers.js";
import { COMPLETION_REACTION_DEV_CHANNEL_ID } from "../config/channels.js";

const PUSH_PIN_EMOJI = "📌";
const PLUS_EMOJI = "➕";
const PLUS_EMOJI_NAME = "heavy_plus_sign";

type CompletionReactionSession = {
  sessionId: string;
  requesterId: string;
  targetUserId: string;
  completedAt: Date;
  query: string;
  messageUrl: string;
  completionType: CompletionType | null;
  promptMessageId: string | null;
  promptChannelId: string | null;
};

const completionReactionSessions = new Map<string, CompletionReactionSession>();
type CompletionReactionPlatformSession = CompletionReactionSession & {
  gameId: number;
  platforms: Array<{ id: number; name: string }>;
};
const completionReactionPlatformSessions = new Map<string, CompletionReactionPlatformSession>();
const COMPLETION_REACTION_PLATFORM_SELECT_PREFIX = "completion-react-platform";

const buildCompletionTypeRow = (sessionId: string): ActionRowBuilder<StringSelectMenuBuilder> => {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`completion-react-type:${sessionId}`)
    .setPlaceholder("Select a completion type")
    .addOptions(
      COMPLETION_TYPES.map((type) => ({
        label: type,
        value: type,
      })),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
};

const buildCompletionTitleRow = (sessionId: string): ActionRowBuilder<ButtonBuilder> =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`completion-react-title:${sessionId}`)
      .setLabel("Change title")
      .setStyle(ButtonStyle.Secondary),
  );

const buildCompletionGameRow = (
  sessionId: string,
  gameOptions: { label: string; value: string; description?: string }[],
): ActionRowBuilder<StringSelectMenuBuilder> => {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`completion-react-game:${sessionId}`)
    .setPlaceholder("Select the game")
    .addOptions(gameOptions);
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
};

const buildCompletionPlatformRow = (
  sessionId: string,
  platformOptions: { label: string; value: string }[],
): ActionRowBuilder<StringSelectMenuBuilder> => {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${COMPLETION_REACTION_PLATFORM_SELECT_PREFIX}:${sessionId}`)
    .setPlaceholder("Select the platform")
    .addOptions(platformOptions);
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
};

const parseCompletionQuery = (content: string): string => {
  const firstLine = content.split("\n")[0]?.trim() ?? "";
  if (!firstLine) return "";
  const withoutHash = firstLine.startsWith("#") ? firstLine.slice(1).trim() : firstLine;
  const cleaned = withoutHash.replace(/^\d+\s*[-:]\s*/, "").trim();
  return cleaned || withoutHash;
};

const buildCompletionPromptContent = (
  session: CompletionReactionSession,
  requesterId: string,
): string => {
  const trimmedQuery = session.query.length > 120
    ? `${session.query.slice(0, 117)}...`
    : session.query;
  return [
    "Add completion from reaction.",
    `Requested by: <@${requesterId}>`,
    `Message: ${session.messageUrl}`,
    `Member: <@${session.targetUserId}>`,
    `Game title guess: ${trimmedQuery}`,
    "",
    "Select the completion type to continue.",
  ].join("\n");
};

const buildIgdbOptions = (
  results: { id: number; name: string; summary?: string; first_release_date?: number }[],
): IgdbSelectOption[] =>
  results.map((game) => {
    const year = game.first_release_date
      ? new Date(game.first_release_date * 1000).getFullYear()
      : "TBD";
    return {
      id: game.id,
      label: `${game.name} (${year})`,
      description: (game.summary || "No summary").slice(0, 95),
    };
  });

@Discord()
export class MessageReactionAdd {
  @On()
  async messageReactionAdd(
    [reaction, user]: ArgsOf<"messageReactionAdd">,
    _client: Client,
  ): Promise<void> {
    void _client;
    if (user.bot) return;

    try {
      if (reaction.partial) {
        await reaction.fetch();
      }
      if (reaction.message?.partial) {
        await reaction.message.fetch();
      }
    } catch {
      return;
    }

    const emojiName = reaction.emoji?.name;
    const isPinEmoji = emojiName === PUSH_PIN_EMOJI || emojiName === "pushpin";
    const isPlusEmoji = emojiName === PLUS_EMOJI || emojiName === PLUS_EMOJI_NAME;
    if (!isPinEmoji && !isPlusEmoji) {
      return;
    }

    const message = reaction.message;
    if (!message || !message.guild) {
      return;
    }

    if (isPlusEmoji) {
      if (message.guild.ownerId !== user.id) {
        return;
      }
      if (!message.author || message.author.bot) {
        return;
      }

      const content = message.content ?? "";
      const query = parseCompletionQuery(content);
      if (!query) {
        await user.send({
          content: "That message has no text to use as a game title.",
        }).catch(() => {});
        return;
      }

      const sessionId = `completion-react-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      completionReactionSessions.set(sessionId, {
        sessionId,
        requesterId: user.id,
        targetUserId: message.author.id,
        completedAt: message.createdAt ?? new Date(),
        query,
        messageUrl: message.url,
        completionType: null,
        promptMessageId: null,
        promptChannelId: null,
      });

      const row = buildCompletionTypeRow(sessionId);
      const titleRow = buildCompletionTitleRow(sessionId);
      const targetChannel = await _client.channels.fetch(COMPLETION_REACTION_DEV_CHANNEL_ID).catch(() => null);
      if (!targetChannel || !("send" in targetChannel)) {
        await user.send({
          content: "Bot dev channel not found. Cannot start completion flow.",
        }).catch(() => {});
        return;
      }
      const prompt = await targetChannel.send({
        content: buildCompletionPromptContent({
          sessionId,
          requesterId: user.id,
          targetUserId: message.author.id,
          completedAt: message.createdAt ?? new Date(),
          query,
          messageUrl: message.url,
          completionType: null,
          promptMessageId: null,
          promptChannelId: null,
        }, user.id),
        components: [row, titleRow],
      }).catch(() => {});
      const session = completionReactionSessions.get(sessionId);
      if (session) {
        session.promptMessageId = prompt?.id ?? null;
        session.promptChannelId = prompt?.channel?.id ?? null;
      }
      return;
    }

    if (!isPinEmoji || message.pinned) {
      return;
    }

    try {
      await message.pin();
    } catch (err: any) {
      const code = err?.code ?? err?.rawError?.code;
      const limitReached = code === 30003 || /maximum number of pins/i.test(err?.message ?? "");
      if (!limitReached) return;
      const channel: any = message.channel;
      if (channel && typeof channel.send === "function") {
        await channel.send({
          content: "Pin limit reached for this channel. Unpin something to pin this message.",
        }).catch(() => {});
      }
    }
  }

  @SelectMenuComponent({ id: /^completion-react-type:.+$/ })
  async handleCompletionReactionType(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const [, sessionId] = interaction.customId.split(":");
    const session = completionReactionSessions.get(sessionId);
    if (!session) {
      await interaction.update({
        content: "This completion prompt has expired.",
        components: [],
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== session.requesterId) {
      await interaction.reply({
        content: "This completion prompt is not for you.",
      }).catch(() => {});
      return;
    }

    const value = interaction.values?.[0];
    if (!value || !COMPLETION_TYPES.includes(value as CompletionType)) {
      await interaction.update({
        content: "Invalid completion type.",
        components: [],
      }).catch(() => {});
      completionReactionSessions.delete(sessionId);
      return;
    }

    session.completionType = value as CompletionType;
    session.promptMessageId = interaction.message?.id ?? session.promptMessageId;
    session.promptChannelId = interaction.channelId ?? session.promptChannelId;
    const matches = await Game.searchGames(session.query);
    if (!matches.length) {
      await this.promptIgdbImport(interaction, session);
      return;
    }

    if (matches.length === 1) {
      await this.saveCompletionFromReaction(interaction, session, matches[0].id);
      return;
    }

    const options = matches.slice(0, 24).map((game) => ({
      label: game.title.slice(0, 100),
      value: String(game.id),
      description: `GameDB #${game.id}`,
    }));
    const row = buildCompletionGameRow(sessionId, options);
    await interaction.update({
      content: `Select the game for "${session.query}".`,
      components: [row, buildCompletionTitleRow(sessionId)],
    }).catch(() => {});
  }

  @SelectMenuComponent({ id: /^completion-react-game:.+$/ })
  async handleCompletionReactionGame(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const [, sessionId] = interaction.customId.split(":");
    const session = completionReactionSessions.get(sessionId);
    if (!session) {
      await interaction.update({
        content: "This completion prompt has expired.",
        components: [],
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== session.requesterId) {
      await interaction.reply({
        content: "This completion prompt is not for you.",
      }).catch(() => {});
      return;
    }

    const value = interaction.values?.[0];
    const gameId = value ? Number(value) : Number.NaN;
    if (!Number.isInteger(gameId) || gameId <= 0) {
      await interaction.update({
        content: "Invalid game selection.",
        components: [],
      }).catch(() => {});
      completionReactionSessions.delete(sessionId);
      return;
    }

    await this.saveCompletionFromReaction(interaction, session, gameId);
  }

  @SelectMenuComponent({ id: /^completion-react-platform:.+$/ })
  async handleCompletionReactionPlatform(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const [, sessionId] = interaction.customId.split(":");
    const session = completionReactionPlatformSessions.get(sessionId);
    if (!session) {
      await interaction.update({
        content: "This completion prompt has expired.",
        components: [],
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== session.requesterId) {
      await interaction.reply({
        content: "This completion prompt is not for you.",
      }).catch(() => {});
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
      await interaction.update({
        content: "Invalid platform selection.",
        components: [],
      }).catch(() => {});
      completionReactionPlatformSessions.delete(sessionId);
      completionReactionSessions.delete(sessionId);
      return;
    }

    const completionType = session.completionType ?? (COMPLETION_TYPES[0] as CompletionType);
    const game = await Game.getGameById(session.gameId);
    if (!game) {
      await interaction.update({
        content: "Selected game was not found in GameDB.",
        components: [],
      }).catch(() => {});
      completionReactionPlatformSessions.delete(sessionId);
      completionReactionSessions.delete(sessionId);
      return;
    }

    if (isOther) {
      await notifyUnknownCompletionPlatform(interaction, game.title, game.id);
    }

    try {
      await Member.addCompletion({
        userId: session.targetUserId,
        gameId: game.id,
        completionType,
        platformId,
        completedAt: session.completedAt,
        finalPlaytimeHours: null,
        note: null,
      });
    } catch (err: any) {
      const msg = err?.message ?? "Failed to save completion.";
      await interaction.update({
        content: `Could not save completion: ${msg}`,
        components: [],
      }).catch(() => {});
      completionReactionPlatformSessions.delete(sessionId);
      completionReactionSessions.delete(sessionId);
      return;
    }

    await interaction.update({
      content: [
        "Completion added.",
        `Member: <@${session.targetUserId}>`,
        `Game: ${game.title}`,
        `Type: ${completionType}`,
        `Date: ${session.completedAt.toLocaleDateString()}`,
        `Message: ${session.messageUrl}`,
      ].join("\n"),
      components: [],
    }).catch(() => {});

    completionReactionPlatformSessions.delete(sessionId);
    completionReactionSessions.delete(sessionId);
  }

  @ButtonComponent({ id: /^completion-react-title:.+$/ })
  async handleCompletionReactionTitle(
    interaction: ButtonInteraction,
  ): Promise<void> {
    const [, sessionId] = interaction.customId.split(":");
    const session = completionReactionSessions.get(sessionId);
    if (!session) {
      await interaction.reply({
        content: "This completion prompt has expired.",
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== session.requesterId) {
      await interaction.reply({
        content: "This completion prompt is not for you.",
      }).catch(() => {});
      return;
    }

    session.promptMessageId = interaction.message?.id ?? session.promptMessageId;
    session.promptChannelId = interaction.channelId ?? session.promptChannelId;

    const modal = new ModalBuilder()
      .setCustomId(`completion-react-title-modal:${sessionId}`)
      .setTitle("Change completion title")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("completion-react-title-input")
            .setLabel("Game title")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100)
            .setValue(session.query.slice(0, 100)),
        ),
      );

    await interaction.showModal(modal).catch(() => {});
  }

  @ModalComponent({ id: /^completion-react-title-modal:.+$/ })
  async handleCompletionReactionTitleModal(
    interaction: ModalSubmitInteraction,
  ): Promise<void> {
    const [, sessionId] = interaction.customId.split(":");
    const session = completionReactionSessions.get(sessionId);
    if (!session) {
      await interaction.reply({
        content: "This completion prompt has expired.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== session.requesterId) {
      await interaction.reply({
        content: "This completion prompt is not for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const newTitle = stripModalInput(
      interaction.fields.getTextInputValue("completion-react-title-input"),
    );
    if (!newTitle) {
      await interaction.reply({
        content: "Game title is required.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    session.query = newTitle;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    const channelId = session.promptChannelId;
    const messageId = session.promptMessageId;
    if (channelId && messageId) {
      const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
      if (channel?.isTextBased()) {
        await channel.messages.fetch(messageId)
          .then((message) => message.edit({
            content: buildCompletionPromptContent(session, session.requesterId),
            components: [buildCompletionTypeRow(sessionId), buildCompletionTitleRow(sessionId)],
          }))
          .catch(() => {});
      }
    }
    await interaction.deleteReply().catch(() => {});
  }

  private async saveCompletionFromReaction(
    interaction: StringSelectMenuInteraction,
    session: CompletionReactionSession,
    gameId: number,
  ): Promise<void> {
    const updateMessage = async (content: string): Promise<void> => {
      const payload = { content, components: [] as never[] };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload).catch(() => {});
        return;
      }
      await interaction.update(payload).catch(() => {});
    };

    const game = await Game.getGameById(gameId);
    if (!game) {
      await updateMessage("Selected game was not found in GameDB.");
      return;
    }

    const platforms = await Game.getPlatformsForGame(game.id);
    if (!platforms.length) {
      await updateMessage("No platform release data is available for this game.");
      return;
    }

    const baseOptions = platforms.map((platform) => ({
      label: platform.name.slice(0, 100),
      value: String(platform.id),
    }));
    const platformOptions = [
      ...baseOptions.slice(0, 24),
      { label: "Other", value: "other" },
    ];
    completionReactionPlatformSessions.set(session.sessionId, {
      ...session,
      gameId: game.id,
      platforms: platforms.map((platform) => ({ id: platform.id, name: platform.name })),
    });
    const platformContent = platforms.length > 24
      ? `Select the platform for "${game.title}" (showing first 24).`
      : `Select the platform for "${game.title}".`;
    await interaction.update({
      content: platformContent,
      components: [buildCompletionPlatformRow(session.sessionId, platformOptions)],
    }).catch(() => {});
  }

  private async promptIgdbImport(
    interaction: StringSelectMenuInteraction,
    session: CompletionReactionSession,
  ): Promise<void> {
    let searchRes;
    try {
      searchRes = await igdbService.searchGames(session.query);
    } catch (err: any) {
      const msg = err?.message ?? "Failed to search IGDB.";
      await interaction.update({
        content: `IGDB search failed: ${msg}`,
        components: [],
      }).catch(() => {});
      completionReactionSessions.delete(session.sessionId);
      return;
    }

    if (!searchRes.results.length) {
      await interaction.update({
        content: `No IGDB results found for "${session.query}".`,
        components: [],
      }).catch(() => {});
      completionReactionSessions.delete(session.sessionId);
      return;
    }

    const opts = buildIgdbOptions(searchRes.results);
    const { components } = createIgdbSession(session.requesterId, opts, async (sel, igdbId) => {
      try {
        if (!sel.deferred && !sel.replied) {
          await sel.deferUpdate().catch(() => {});
        }
        await sel.editReply({
          content: "Importing game details from IGDB...",
          components: [],
        }).catch(() => {});
        const imported = await this.importGameFromIgdb(igdbId);
        await this.saveCompletionFromReaction(sel, session, imported.gameId);
        completionReactionSessions.delete(session.sessionId);
      } catch (err: any) {
        const msg = err?.message ?? "Failed to import from IGDB.";
        await sel.editReply({
          content: msg,
          components: [],
        }).catch(() => {});
        completionReactionSessions.delete(session.sessionId);
      }
    });

    await interaction.update({
      content: `No GameDB match. Select an IGDB result for "${session.query}".`,
      components: [...components, buildCompletionTitleRow(session.sessionId)],
    }).catch(() => {});
    session.promptMessageId = interaction.message?.id ?? session.promptMessageId;
    session.promptChannelId = interaction.channelId ?? session.promptChannelId;
  }

  private async importGameFromIgdb(igdbId: number): Promise<{ gameId: number; title: string }> {
    const existing = await Game.getGameByIgdbId(igdbId);
    if (existing) {
      return { gameId: existing.id, title: existing.title };
    }

    const details: IGDBGameDetails | null = await igdbService.getGameDetails(igdbId);
    if (!details) {
      throw new Error("Failed to load game details from IGDB.");
    }

    let imageData: Buffer | null = null;
    if (details.cover?.image_id) {
      try {
        const imageUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${details.cover.image_id}.jpg`;
        const imageResponse = await axios.get(imageUrl, { responseType: "arraybuffer" });
        imageData = Buffer.from(imageResponse.data);
      } catch (err) {
        console.error("Failed to download cover image:", err);
      }
    }

    const newGame = await Game.createGame(
      details.name,
      details.summary ?? "",
      imageData,
      details.id,
      details.slug ?? null,
      details.total_rating ?? null,
      details.url ?? null,
      Game.getFeaturedVideoUrl(details),
    );
    await Game.saveFullGameMetadata(newGame.id, details);
    return { gameId: newGame.id, title: details.name };
  }
}
