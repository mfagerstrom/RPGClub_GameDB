import {
  ActionRowBuilder,
  ActivityType,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  MessageFlags,
} from "discord.js";
import type { Presence } from "discord.js";
import type { ArgsOf, Client } from "discordx";
import { ButtonComponent, Discord, On } from "discordx";
import Game from "../classes/Game.js";
import Member from "../classes/Member.js";
import PresencePromptOptOut, { normalizePresenceGameTitle } from "../classes/PresencePromptOptOut.js";
import PresencePromptHistory from "../classes/PresencePromptHistory.js";
import UserActivityIcon from "../classes/UserActivityIcon.js";
import { igdbService } from "../services/IGDB/IgdbService.js";
import { PRESENCE_PROMPT_CHANNEL_ID } from "../config/channels.js";

const YES_PREFIX = "presence-np-yes";
const NO_PREFIX = "presence-np-no";
const OPT_OUT_GAME_PREFIX = "presence-np-optout-game";
const OPT_OUT_ALL_PREFIX = "presence-np-optout-all";
const UNANSWERED_GAME_LIMIT = 3;
const UNANSWERED_USER_LIMIT = 6;
const RICH_PRESENCE_PROMPTS_ENABLED =
  process.env.RICH_PRESENCE_NOW_PLAYING_PROMPTS_ENABLED === "true";

type PresencePromptSession = {
  userId: string;
  gameTitle: string;
  gameTitleNorm: string;
  messageId: string | null;
};

const presencePromptSessions = new Map<string, PresencePromptSession>();
const lastPresenceGameByUser = new Map<string, string>();

function getPresenceGameTitle(presence?: Presence | null): string | null {
  if (!presence) return null;
  const activity = presence.activities.find((entry) => entry.type === ActivityType.Playing);
  const name = activity?.name?.trim();
  return name ? name : null;
}

function isSameUtcDay(a: Date, b: Date): boolean {
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}

async function resolvePresenceGame(
  title: string,
): Promise<{ gameId: number; title: string } | null> {
  const normalized = normalizePresenceGameTitle(title);
  const searchResults = await Game.searchGames(title);
  const exact = searchResults.find(
    (game) => normalizePresenceGameTitle(game.title) === normalized,
  );
  if (exact) {
    return { gameId: exact.id, title: exact.title };
  }
  if (searchResults.length) {
    const fallback = searchResults[0];
    return { gameId: fallback.id, title: fallback.title };
  }

  const igdbResults = await igdbService.searchGames(title);
  const igdbGame = igdbResults.results?.[0];
  if (!igdbGame) {
    return null;
  }

  return Game.importGameFromIgdb(igdbGame.id);
}

function buildPromptButtons(sessionId: string): ActionRowBuilder<ButtonBuilder> {
  const yes = new ButtonBuilder()
    .setCustomId(`${YES_PREFIX}:${sessionId}`)
    .setLabel("Yes")
    .setStyle(ButtonStyle.Success);
  const no = new ButtonBuilder()
    .setCustomId(`${NO_PREFIX}:${sessionId}`)
    .setLabel("No")
    .setStyle(ButtonStyle.Secondary);
  const optOutGame = new ButtonBuilder()
    .setCustomId(`${OPT_OUT_GAME_PREFIX}:${sessionId}`)
    .setLabel("Don't ask again for this game")
    .setStyle(ButtonStyle.Secondary);
  const optOutAll = new ButtonBuilder()
    .setCustomId(`${OPT_OUT_ALL_PREFIX}:${sessionId}`)
    .setLabel("Don't ask again for any game")
    .setStyle(ButtonStyle.Danger);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(yes, no, optOutGame, optOutAll);
}

@Discord()
export class PresenceUpdate {
  @On()
  async presenceUpdate(
    [oldPresence, newPresence]: ArgsOf<"presenceUpdate">,
    client: Client,
  ): Promise<void> {
    const member = newPresence?.member;
    const user = member?.user;
    if (!user || user.bot) return;

    if (newPresence?.activities?.length) {
      void UserActivityIcon.recordFromPresence(
        user.id,
        user.username ?? user.globalName ?? "",
        newPresence.activities,
      ).catch((err) => {
        console.error("Failed to record user activity icons:", err);
      });
    }

    if (!RICH_PRESENCE_PROMPTS_ENABLED) return;

    const newGame = getPresenceGameTitle(newPresence);
    if (!newGame) {
      lastPresenceGameByUser.delete(user.id);
      return;
    }

    const newNorm = normalizePresenceGameTitle(newGame);
    if (!newNorm) return;

    const oldGame = getPresenceGameTitle(oldPresence);
    const oldNorm = oldGame ? normalizePresenceGameTitle(oldGame) : "";
    const lastNorm = lastPresenceGameByUser.get(user.id) ?? "";

    if ((oldNorm && newNorm === oldNorm) || (!oldNorm && lastNorm === newNorm)) {
      lastPresenceGameByUser.set(user.id, newNorm);
      return;
    }

    lastPresenceGameByUser.set(user.id, newNorm);

    const optedOutAll = await PresencePromptOptOut.isOptedOutAll(user.id);
    if (optedOutAll) return;
    const optedOutGame = await PresencePromptOptOut.isOptedOutGame(user.id, newGame);
    if (optedOutGame) return;

    const pendingForGame = await PresencePromptHistory.countPendingForGame(user.id, newGame);
    if (pendingForGame >= UNANSWERED_GAME_LIMIT) {
      await PresencePromptOptOut.addOptOutGame(user.id, newGame);
      return;
    }
    const pendingForUser = await PresencePromptHistory.countPendingForUser(user.id);
    if (pendingForUser >= UNANSWERED_USER_LIMIT) {
      await PresencePromptOptOut.addOptOutAll(user.id);
      return;
    }

    const lastPromptDate = await PresencePromptHistory.getLastPromptDateForGame(user.id, newGame);
    if (lastPromptDate && isSameUtcDay(lastPromptDate, new Date())) {
      return;
    }

    const current = await Member.getNowPlaying(user.id).catch(() => []);
    if (current.some((entry) => normalizePresenceGameTitle(entry.title) === newNorm)) {
      return;
    }

    const channel = await client.channels.fetch(PRESENCE_PROMPT_CHANNEL_ID).catch(() => null);
    if (!channel || !channel.isTextBased()) return;
    const sendableChannel = channel as any;
    if (!sendableChannel || typeof sendableChannel.send !== "function") return;

    const sessionId = `${user.id}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    presencePromptSessions.set(sessionId, {
      userId: user.id,
      gameTitle: newGame,
      gameTitleNorm: newNorm,
      messageId: null,
    });
    await PresencePromptHistory.createPrompt(sessionId, user.id, newGame);

    const content =
      `<@${user.id}>, I see that you started playing **${newGame}**. ` +
      "Would you like me to add it to your Now Playing list? Choose an option below.";
    const message = await sendableChannel.send({
      content,
      components: [buildPromptButtons(sessionId)],
    });

    const session = presencePromptSessions.get(sessionId);
    if (session) {
      session.messageId = message.id;
    }
  }

  @ButtonComponent({ id: /^presence-np-yes:.+$/ })
  async handlePresenceYes(interaction: ButtonInteraction): Promise<void> {
    const sessionId = interaction.customId.replace(`${YES_PREFIX}:`, "");
    const session = presencePromptSessions.get(sessionId);
    if (!session) {
      await interaction.reply({
        content: "That prompt has expired.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (interaction.user.id !== session.userId) {
      await interaction.reply({
        content: "This prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await PresencePromptHistory.markResolved(sessionId, "ACCEPTED");
      const resolved = await resolvePresenceGame(session.gameTitle);
      if (!resolved) {
        await interaction.update({
          content:
            `I could not find **${session.gameTitle}** in GameDB. ` +
            "Try adding it with `/gamedb add`.",
          components: [],
        });
        presencePromptSessions.delete(sessionId);
        return;
      }

      const platforms = await Game.getPlatformsForGame(resolved.gameId);
      if (!platforms.length) {
        await interaction.update({
          content:
            `I found **${resolved.title}**, but it has no platform data yet. ` +
            "Please add it manually from `/now-playing list` when platform data is available.",
          components: [],
        });
        presencePromptSessions.delete(sessionId);
        return;
      }
      const defaultPlatform = platforms[0];
      await Member.addNowPlaying(session.userId, resolved.gameId, defaultPlatform.id, null);
      await interaction.update({
        content: `Added **${resolved.title}** to your Now Playing list.`,
        components: [],
      });
      presencePromptSessions.delete(sessionId);
    } catch (err: any) {
      await PresencePromptHistory.markResolved(sessionId, "DECLINED");
      const msg = err?.message ?? "Failed to add that game.";
      await interaction.update({
        content: msg,
        components: [],
      });
      presencePromptSessions.delete(sessionId);
    }
  }

  @ButtonComponent({ id: /^presence-np-no:.+$/ })
  async handlePresenceNo(interaction: ButtonInteraction): Promise<void> {
    const sessionId = interaction.customId.replace(`${NO_PREFIX}:`, "");
    const session = presencePromptSessions.get(sessionId);
    if (!session) {
      await interaction.reply({
        content: "That prompt has expired.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (interaction.user.id !== session.userId) {
      await interaction.reply({
        content: "This prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await PresencePromptHistory.markResolved(sessionId, "DECLINED");
    await interaction.update({
      content: `<@${session.userId}>, no problem. I won't add it.`,
      components: [],
    });
  }

  @ButtonComponent({ id: /^presence-np-optout-game:.+$/ })
  async handlePresenceOptOutGame(interaction: ButtonInteraction): Promise<void> {
    const sessionId = interaction.customId.replace(`${OPT_OUT_GAME_PREFIX}:`, "");
    const session = presencePromptSessions.get(sessionId);
    if (!session) {
      await interaction.reply({
        content: "That prompt has expired.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (interaction.user.id !== session.userId) {
      await interaction.reply({
        content: "This prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await PresencePromptOptOut.addOptOutGame(session.userId, session.gameTitle);
    await PresencePromptHistory.markResolved(sessionId, "OPT_OUT_GAME");
    await interaction.update({
      content: `<@${session.userId}>, got it. I won't ask again about **${session.gameTitle}**.`,
      components: [],
    });
    presencePromptSessions.delete(sessionId);
  }

  @ButtonComponent({ id: /^presence-np-optout-all:.+$/ })
  async handlePresenceOptOutAll(interaction: ButtonInteraction): Promise<void> {
    const sessionId = interaction.customId.replace(`${OPT_OUT_ALL_PREFIX}:`, "");
    const session = presencePromptSessions.get(sessionId);
    if (!session) {
      await interaction.reply({
        content: "That prompt has expired.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (interaction.user.id !== session.userId) {
      await interaction.reply({
        content: "This prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await PresencePromptOptOut.addOptOutAll(session.userId);
    await PresencePromptHistory.markResolved(sessionId, "OPT_OUT_ALL");
    await interaction.update({
      content: `<@${session.userId}>, got it. I won't ask again about any games.`,
      components: [],
    });
    presencePromptSessions.delete(sessionId);
  }
}
