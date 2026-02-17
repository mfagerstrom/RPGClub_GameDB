import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type ButtonInteraction,
  type CommandInteraction,
  type Message,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "@discordjs/builders";
import {
  type CompletionType,
  formatPlaytimeHours,
  formatTableDate,
} from "../commands/profile.command.js";
import Game, { type IGame } from "../classes/Game.js";
import Member from "../classes/Member.js";
import { ANNOUNCEMENT_CHANNEL_ID, BOT_DEV_CHANNEL_ID } from "../config/channels.js";
import { COMPONENTS_V2_FLAG } from "../config/flags.js";

const MAX_PLAYTIME_HOURS = 999999.99;
const COMPLETION_COVER_ATTACHMENT_PREFIX = "completion-cover";

export function validateCompletionPlaytimeInput(
  input: string,
): { value: number | null; error: string | null } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { value: null, error: null };
  }
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0) {
    return { value: null, error: "Playtime must be a non-negative number." };
  }
  if (num > MAX_PLAYTIME_HOURS) {
    return { value: null, error: `Playtime must be ${MAX_PLAYTIME_HOURS} hours or less.` };
  }
  const decimalPart = trimmed.split(".")[1];
  if (decimalPart && decimalPart.length > 2) {
    return { value: null, error: "Playtime must have at most 2 decimal places." };
  }
  return { value: num, error: null };
}

export async function saveCompletion(
  interaction: CommandInteraction | StringSelectMenuInteraction,
  userId: string,
  gameId: number,
  platformId: number | null,
  completionType: CompletionType,
  completedAt: Date | null,
  finalPlaytimeHours: number | null,
  note: string | null,
  gameTitle?: string,
  announce?: boolean,
  isAdminOverride: boolean = false,
  removeFromNowPlaying: boolean = true,
): Promise<void> {
  if (interaction.user.id !== userId && !isAdminOverride) {
    await interaction.followUp({
      content: "You can only log completions for yourself.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const game = await Game.getGameById(gameId);
  if (!game) {
    await interaction.followUp({
      content: `GameDB #${gameId} was not found.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await Member.addCompletion({
      userId,
      gameId,
      completionType,
      platformId,
      completedAt,
      finalPlaytimeHours,
      note,
    });
  } catch (err: any) {
    const msg = err?.message ?? "Failed to save completion.";
    await interaction.followUp({
      content: `Could not save completion: ${msg}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (removeFromNowPlaying) {
    try {
      await Member.removeNowPlaying(userId, gameId);
    } catch {
      // Ignore cleanup errors
    }
  }

  const playtimeText = formatPlaytimeHours(finalPlaytimeHours);
  const details = [completionType, playtimeText].filter(Boolean).join(" — ");

  await interaction.followUp({
    content: `Logged completion for **${gameTitle ?? game.title}** (${details}).`,
    flags: MessageFlags.Ephemeral,
  });

  if (announce) {
    await announceCompletion(
      interaction,
      userId,
      game,
      completionType,
      completedAt,
      finalPlaytimeHours,
      isAdminOverride,
    );
  }
}

export async function notifyUnknownCompletionPlatform(
  interaction:
    | CommandInteraction
    | StringSelectMenuInteraction
    | ButtonInteraction
    | ModalSubmitInteraction,
  gameTitle: string,
  gameId: number,
): Promise<void> {
  try {
    const channel = await interaction.client.channels.fetch(BOT_DEV_CHANNEL_ID).catch(() => null);
    if (!channel || !("send" in channel)) {
      return;
    }
    const username = interaction.user.username ?? interaction.user.id;
    await (channel as any).send({
      content:
        `Unknown completion platform selected.\n` +
        `User: ${username} (<@${interaction.user.id}>)\n` +
        `Game: ${gameTitle} (GameDB #${gameId})`,
      allowedMentions: { parse: [] },
    });
  } catch {
    // ignore reporting errors
  }
}

export async function announceCompletion(
  interaction:
    | CommandInteraction
    | StringSelectMenuInteraction
    | ButtonInteraction
    | ModalSubmitInteraction,
  userId: string,
  game: IGame,
  completionType: CompletionType,
  completedAt: Date | null,
  finalPlaytimeHours: number | null,
  isAdminOverride: boolean = false,
): Promise<void> {
  try {
    const channel = await interaction.client.channels.fetch(ANNOUNCEMENT_CHANNEL_ID);
    if (!channel || !("send" in channel)) {
      return;
    }

    const user = await interaction.client.users.fetch(userId).catch(() => null);
    if (!user) {
      return;
    }

    const completions = await Game.getGameCompletions(game.id);
    const isFirst = completions.length === 1;

    const playtimeText = formatPlaytimeHours(finalPlaytimeHours);
    const dateStr = completedAt ? formatTableDate(completedAt) : "No date";
    const hoursStr = playtimeText ? ` - ${playtimeText}` : "";
    let yearlySummary = "";
    if (completedAt) {
      const completionYear = completedAt.getFullYear();
      const yearlyCount = await Member.countCompletions(userId, completionYear);
      yearlySummary = `\nGame completion #${yearlyCount} for ${completionYear}`;
    }
    let desc =
      `<@${user.id}> has added a game completion: **${game.title}** - ` +
      `${completionType} - ${dateStr}${hoursStr}` +
      yearlySummary;
    if (isAdminOverride && interaction.user.id !== userId) {
      desc =
        `<@${interaction.user.id}> added a game completion for <@${user.id}>: ` +
        `**${game.title}** - ${completionType} - ${dateStr}${hoursStr}` +
        yearlySummary;
    }
    const summaryLines = [
      `### ${user.displayName ?? user.username}`,
      desc,
    ];
    if (isFirst) {
      summaryLines.push("This is the first recorded completion for this game in the club!");
    }

    const summaryText = summaryLines.join("\n\n");
    const container = new ContainerBuilder();
    const section = new SectionBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(summaryText),
    );
    const files: AttachmentBuilder[] = [];
    if (game.imageData) {
      const coverName = `${COMPLETION_COVER_ATTACHMENT_PREFIX}-${game.id}.png`;
      files.push(new AttachmentBuilder(game.imageData, { name: coverName }));
      section.setThumbnailAccessory(
        new ThumbnailBuilder().setURL(`attachment://${coverName}`).setDescription(game.title),
      );
    }
    container.addSectionComponents(section);

    await (channel as any).send({
      files,
      components: [container],
      flags: COMPONENTS_V2_FLAG,
    });
  } catch (err) {
    console.error("Failed to announce completion:", err);
  }
}

export async function promptRemoveFromNowPlaying(
  interaction:
    | CommandInteraction
    | StringSelectMenuInteraction
    | ButtonInteraction
    | ModalSubmitInteraction,
  gameTitle: string,
): Promise<boolean> {
  const promptId = `np-remove:${interaction.user.id}:${Date.now()}`;
  const yesId = `${promptId}:yes`;
  const noId = `${promptId}:no`;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(yesId)
      .setLabel("Yes")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(noId)
      .setLabel("No")
      .setStyle(ButtonStyle.Secondary),
  );

  const payload = {
    content: `Remove **${gameTitle}** from your Now Playing list?`,
    components: [row],
    flags: MessageFlags.Ephemeral,
  };

  let message: Message | null = null;
  try {
    if (interaction.deferred || interaction.replied) {
      const reply = await interaction.followUp(payload as any);
      message = reply as Message;
    } else {
      const reply = await interaction.reply({ ...payload, withResponse: true } as any);
      message = reply.resource?.message ?? null;
    }
  } catch {
    try {
      const reply = await interaction.followUp(payload as any);
      message = reply as Message;
    } catch {
      return false;
    }
  }

  if (!message || typeof message.awaitMessageComponent !== "function") {
    return false;
  }

  try {
    const selection = await message.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) => i.user.id === interaction.user.id && i.customId.startsWith(promptId),
      time: 120_000,
    });
    const remove = selection.customId.endsWith(":yes");
    await selection.update({
      content: remove
        ? "Okay, I'll remove it from Now Playing."
        : "Okay, I'll leave it in your Now Playing list.",
      components: [],
    }).catch(() => {});
    return remove;
  } catch {
    await message.edit({
      content: "No response received. Leaving it in your Now Playing list.",
      components: [],
    }).catch(() => {});
    return false;
  }
}
