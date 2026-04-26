import { EmbedBuilder } from "discord.js";
import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";
import { formatTimestampWithDay } from "../utilities/DiscordLogUtils.js";
import { BAN_LOG_CHANNEL_ID, UNBAN_LOG_CHANNEL_ID } from "../config/channels.js";

async function resolveLogChannel(client: Client, channelId: string): Promise<any | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;
  const sendable = channel as any;
  return typeof sendable.send === "function" ? sendable : null;
}

function formatAccountCreated(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:F>`;
}

function buildBanEmbed(
  title: string,
  userId: string,
  username: string,
  avatarUrl: string | null,
  createdAt: Date,
  color: number,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .addFields(
      { name: "User", value: `<@${userId}>\n${username}` },
      { name: "Account Created On", value: formatAccountCreated(createdAt) },
    )
    .setFooter({ text: `ID: ${userId} • ${formatTimestampWithDay(Date.now())}` });

  if (avatarUrl) {
    embed.setThumbnail(avatarUrl);
  }

  return embed;
}

@Discord()
export class GuildBanLog {
  @On()
  async guildBanAdd([ban]: ArgsOf<"guildBanAdd">, client: Client): Promise<void> {
    const user = ban.user;
    if (!user || user.bot) return;

    const logChannel = await resolveLogChannel(client, BAN_LOG_CHANNEL_ID);
    if (!logChannel) return;

    const username = user.tag ?? user.username ?? user.id;
    const embed = buildBanEmbed(
      "User Banned",
      user.id,
      username,
      user.displayAvatarURL?.() ?? null,
      user.createdAt ?? new Date(),
      0xe74c3c,
    );

    await (logChannel as any).send({ embeds: [embed] });
  }

  @On()
  async guildBanRemove([ban]: ArgsOf<"guildBanRemove">, client: Client): Promise<void> {
    const user = ban.user;
    if (!user || user.bot) return;

    const logChannel = await resolveLogChannel(client, UNBAN_LOG_CHANNEL_ID);
    if (!logChannel) return;

    const username = user.tag ?? user.username ?? user.id;
    const embed = buildBanEmbed(
      "User Unbanned",
      user.id,
      username,
      user.displayAvatarURL?.() ?? null,
      user.createdAt ?? new Date(),
      0x3498db,
    );

    await (logChannel as any).send({ embeds: [embed] });
  }
}
