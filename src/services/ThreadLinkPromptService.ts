import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Client,
  EmbedBuilder,
  MessageFlags,
  ThreadChannel,
} from "discord.js";
import {
  setThreadGameLink,
  setThreadSkipLinking,
  getThreadLinkInfo,
} from "../classes/Thread.js";
import Game from "../classes/Game.js";
import { igdbService, type IGDBGameDetails } from "./IGDB/IgdbService.js";
import {
  createIgdbSession,
  type IgdbSelectOption,
} from "./IGDB/IgdbSelectService.js";
import { NOW_PLAYING_FORUM_ID } from "../config/channels.js";
import { NOW_PLAYING_SIDEGAME_TAG_ID } from "../config/tags.js";

const PROMPT_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h
const promptCache = new Map<string, number>();
function hasIgdbConfig(): boolean {
  return Boolean(process.env.IGDB_CLIENT_ID && process.env.IGDB_CLIENT_SECRET);
}

function shouldPrompt(threadId: string): boolean {
  const last = promptCache.get(threadId) ?? 0;
  return Date.now() - last > PROMPT_COOLDOWN_MS;
}

function markPrompted(threadId: string): void {
  promptCache.set(threadId, Date.now());
}

function buildPromptEmbed(thread: ThreadChannel): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("Link this thread to a game?")
    .setDescription(
      "This Now Playing thread doesn't have a linked GameDB entry yet. " +
        "Linking helps show the right cover art, metadata, and GOTM/NR-GOTM info.\n\n" +
        "Choose an option below.",
    )
    .setColor(0x2d7ff9)
    .setFooter({ text: thread.name ?? thread.id });
}

function buildButtons(threadId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`thread-link:${threadId}`)
      .setLabel("Link a game")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`thread-skip:${threadId}`)
      .setLabel("Skip Linking Game")
      .setStyle(ButtonStyle.Secondary),
  );
}

async function promptThread(thread: ThreadChannel): Promise<void> {
  if (!hasIgdbConfig()) return; // Don't prompt when IGDB is not configured
  const isBotCreated = thread.ownerId && thread.ownerId === thread.client.user?.id;
  const isSidegameTag = thread.appliedTags?.includes(NOW_PLAYING_SIDEGAME_TAG_ID) ?? false;
  if (thread.parentId === NOW_PLAYING_FORUM_ID && isBotCreated && isSidegameTag) {
    return;
  }
  const info = await getThreadLinkInfo(thread.id).catch(() => ({
    skipLinking: false,
    gamedbGameIds: [],
  }));
  if (info.skipLinking) return;
  if (info.gamedbGameIds.length) return; // Already linked
  if (!shouldPrompt(thread.id)) return;
  markPrompted(thread.id);

  try {
    await thread.send({ embeds: [buildPromptEmbed(thread)], components: [buildButtons(thread.id)] });
  } catch (err) {
    console.error("[ThreadLinkPrompt] Failed to post prompt:", err);
  }
}

async function handleLinkButton(interaction: ButtonInteraction, threadId: string): Promise<void> {
  if (!interaction.guild || !interaction.channel) return;

  if (!hasIgdbConfig()) {
    await interaction.reply({
      content:
        "IGDB service is not configured. Please set IGDB_CLIENT_ID and IGDB_CLIENT_SECRET in the environment.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const threadName = (interaction.channel as any)?.name ?? "Unknown Thread";
  const title = threadName.split("(")[0].trim() || threadName;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await interaction.message.edit({ components: [] }).catch(() => {});

  try {
    // First try existing GameDB by title
    const localMatches = (await Game.searchGames(title)).filter((g) =>
      g.title.toLowerCase() === title.toLowerCase(),
    );
    let gameId: number | null = localMatches[0]?.id ?? null;
    let chosenName: string | null = localMatches[0]?.title ?? null;

    const finalizeSelection = async (igdbId: number, nameHint?: string): Promise<number | null> => {
      const existing = await Game.getGameByIgdbId(igdbId);
      if (existing) {
        chosenName = existing.title;
        return existing.id;
      }
      const details: IGDBGameDetails | null = await igdbService.getGameDetails(igdbId);
      if (!details) {
        await interaction.followUp({
          content: "Failed to load game details from IGDB.",
          flags: MessageFlags.Ephemeral,
        });
        return null;
      }
      const newGame = await Game.createGame(
        details.name,
        details.summary ?? "",
        null,
        details.id,
        details.slug ?? null,
        details.total_rating ?? null,
        details.url ?? null,
        Game.getFeaturedVideoUrl(details),
      );
      await Game.saveFullGameMetadata(newGame.id, details);
      chosenName = nameHint ?? details.name;
      return newGame.id;
    };

    const finishLink = async (): Promise<void> => {
      if (!gameId) return;
      await setThreadGameLink(threadId, gameId!);
      await interaction.followUp({
        content:
          `Linked this thread to GameDB #${gameId}${chosenName ? ` (${chosenName})` : ""}.\n` +
          "Threads can have multiple links; use /thread unlink to remove one or all.",
        flags: MessageFlags.Ephemeral,
      });

      try {
        await interaction.message.delete().catch(async () => {
          await interaction.message.edit({ components: [] }).catch(() => {});
        });
      } catch {
        // ignore
      }
    };

    if (!gameId) {
      // Fallback to IGDB search
      const searchRes = await igdbService.searchGames(title);
      const results = searchRes.results;
      if (!results.length) {
        await interaction.followUp({
          content: `No GameDB/IGDB results found for "${title}". Tagging @admin to review.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const selectFirst = async (igdbId: number, name: string): Promise<void> => {
        const finalId = await finalizeSelection(igdbId, name);
        if (!finalId) return;
        gameId = finalId;
      };

      if (results.length === 1) {
        await selectFirst(results[0].id, results[0].name);
      } else {
        const opts: IgdbSelectOption[] = results.map((game) => {
          const year = game.first_release_date
            ? new Date(game.first_release_date * 1000).getFullYear()
            : "TBD";
          return {
            id: game.id,
            label: `${game.name} (${year})`,
            description: (game.summary || "No summary").slice(0, 95),
          };
        });

        const { components } = createIgdbSession(
          interaction.user.id,
          opts,
          async (sel, igdbId) => {
            const finalId = await finalizeSelection(igdbId);
            if (!finalId) return;
            gameId = finalId;
            await sel.update({ content: `Linked to GameDB #${finalId}.`, components: [] });
            await finishLink();
          },
        );

        await interaction.followUp({
          content: `Select the correct game for "${title}".`,
          components,
          flags: MessageFlags.Ephemeral,
        });

        // Defer finishing until selection happens
        return;
      }
    }

    await finishLink();
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    await interaction.followUp({ content: `Failed to link game: ${msg}` });
  }
}

async function handleSkipButton(interaction: ButtonInteraction, threadId: string): Promise<void> {
  try {
    await setThreadSkipLinking(threadId, true);
    await interaction.reply({
      content: "Okay, I'll skip linking a game for this thread going forward.",
      flags: MessageFlags.Ephemeral,
    });
    await interaction.message.edit({ components: [] }).catch(() => {});
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    await interaction.reply({ content: `Failed to update skip flag: ${msg}`, flags: MessageFlags.Ephemeral });
  }
}

export function startThreadLinkPromptService(client: Client): void {
  if (!hasIgdbConfig()) {
    console.warn(
      "[ThreadLinkPrompt] IGDB_CLIENT_ID/SECRET not set; skipping thread link prompts.",
    );
  }

  client.on("threadCreate", async (thread) => {
    if (thread.parentId !== NOW_PLAYING_FORUM_ID) return;
    await promptThread(thread);
  });

  client.on("messageCreate", async (message) => {
    const channel = message.channel;
    if (!("isThread" in channel) || !channel.isThread()) return;
    if (channel.parentId !== NOW_PLAYING_FORUM_ID) return;
    await promptThread(channel);
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isButton()) return;
    const [kind, threadId] = interaction.customId.split(":");
    if (!threadId) return;

    if (kind === "thread-link") {
      await handleLinkButton(interaction, threadId);
    } else if (kind === "thread-skip") {
      await handleSkipButton(interaction, threadId);
    }
  });

  console.log("[ThreadLinkPrompt] Service started");
}
