import type {
  AutocompleteInteraction,
  CommandInteraction,
  ForumChannel,
  MessageCreateOptions,
} from "discord.js";
import { ApplicationCommandOptionType, AttachmentBuilder, MessageFlags } from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import Game from "../classes/Game.js";
import { getThreadsByGameId } from "../classes/Thread.js";
import { NOW_PLAYING_FORUM_ID } from "../config/channels.js";
import { safeDeferReply, safeReply, sanitizeOptionalInput, sanitizeUserInput } from
  "../functions/InteractionUtils.js";
import { formatGameTitleWithYear } from "../functions/GameTitleAutocompleteUtils.js";

const DEFAULT_FIRST_POST_PREFIX = "Thread created by";

function buildDefaultFirstPostText(userId: string): string {
  return `${DEFAULT_FIRST_POST_PREFIX} <@${userId}>`;
}

async function autocompleteCreateThreadTitle(
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

async function autocompleteCreateThreadTag(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const rawQuery = focused?.value ? String(focused.value) : "";
  const query = sanitizeUserInput(rawQuery, { preserveNewlines: false }).trim().toLowerCase();

  const forum = (await interaction.guild?.channels.fetch(NOW_PLAYING_FORUM_ID)) as ForumChannel | null;
  if (!forum) {
    await interaction.respond([]);
    return;
  }

  const filtered = forum.availableTags
    .filter((tag) => !query || tag.name.toLowerCase().includes(query))
    .slice(0, 25)
    .map((tag) => ({
      name: tag.name.slice(0, 100),
      value: tag.name.slice(0, 100),
    }));
  await interaction.respond(filtered);
}

@Discord()
export class CreateThreadCommand {
  @Slash({ description: "Create a forum thread for a GameDB title", name: "create-thread" })
  async createThread(
    @SlashOption({
      autocomplete: autocompleteCreateThreadTitle,
      description: "Game title (autocomplete from GameDB)",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    title: string,
    @SlashOption({
      autocomplete: autocompleteCreateThreadTag,
      description: "Forum tag title",
      name: "tag",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    tagTitle: string,
    @SlashOption({
      description: "First post text",
      name: "first-post-text",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    firstPostText: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const gameId = Number.parseInt(title, 10);
    if (!Number.isFinite(gameId) || gameId <= 0) {
      await safeReply(interaction, {
        content: "Please select a game from title autocomplete.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const game = await Game.getGameById(gameId);
    if (!game) {
      await safeReply(interaction, {
        content: `Could not find GameDB game #${gameId}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const existingThreads = await getThreadsByGameId(gameId);
    const existingThreadId = existingThreads[0] ?? null;
    if (existingThreadId) {
      await safeReply(interaction, {
        content: `A thread is already linked for "${game.title}": <#${existingThreadId}>`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!game.imageData) {
      await safeReply(interaction, {
        content: `Cannot create a thread for "${game.title}" because it has no cover image.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const forum = (await interaction.guild?.channels.fetch(NOW_PLAYING_FORUM_ID)) as ForumChannel | null;
    if (!forum) {
      await safeReply(interaction, {
        content: "Now Playing forum channel was not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const selectedTag = forum.availableTags.find((tag) =>
      tag.name.toLowerCase() === tagTitle.toLowerCase().trim()
    );
    if (!selectedTag) {
      await safeReply(interaction, {
        content: `Could not find forum tag "${tagTitle}". Please pick one from tag autocomplete.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const sanitizedPost = sanitizeOptionalInput(firstPostText, {
      maxLength: 1800,
      preserveNewlines: true,
    });
    const postText = sanitizedPost ?? buildDefaultFirstPostText(interaction.user.id);
    const fileName = `gamedb_${game.id}.png`;
    const messagePayload: MessageCreateOptions = {
      content: postText,
      files: [new AttachmentBuilder(game.imageData, { name: fileName })],
    };

    const thread = await forum.threads.create({
      appliedTags: [selectedTag.id],
      message: messagePayload,
      name: game.title.slice(0, 100),
    });

    await safeReply(interaction, {
      content: `Created thread <#${thread.id}> for "${game.title}" with tag "${selectedTag.name}".`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
