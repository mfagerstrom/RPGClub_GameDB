import { AuditLogEvent, EmbedBuilder } from "discord.js";
import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";
import { formatTimestampWithDay } from "../utilities/DiscordLogUtils.js";
import { JOIN_LEAVE_LOG_CHANNEL_ID } from "../config/channels.js";
const KICK_LOG_WINDOW_MS = 30_000;
const KICK_LOG_RETRY_COUNT = 3;
const KICK_LOG_RETRY_DELAY_MS = 750;

function formatDiscordDateTime(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:F>`;
}

async function resolveLogChannel(client: Client): Promise<any | null> {
  const channel = await client.channels.fetch(JOIN_LEAVE_LOG_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;
  const sendable = channel as any;
  return typeof sendable.send === "function" ? sendable : null;
}

async function getKickAudit(
  client: Client,
  guildId: string,
  userId: string,
): Promise<{ moderatorId: string; reason: string | null } | null> {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return null;

  for (let attempt = 0; attempt < KICK_LOG_RETRY_COUNT; attempt += 1) {
    const logs = await guild
      .fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 5 })
      .catch(() => null);
    const entries = logs?.entries;
    if (entries) {
      const now = Date.now();
      for (const entry of entries.values()) {
        const targetId = (entry.target as any)?.id ?? null;
        if (!targetId || String(targetId) !== userId) continue;
        const createdAt = entry.createdTimestamp ?? 0;
        if (now - createdAt > KICK_LOG_WINDOW_MS) continue;
        const moderatorId = entry.executor?.id ?? "";
        if (!moderatorId) return null;
        return { moderatorId, reason: entry.reason ?? null };
      }
    }

    await new Promise((resolve) => setTimeout(resolve, KICK_LOG_RETRY_DELAY_MS));
  }

  return null;
}

@Discord()
export class GuildMemberRemove {
  @On()
  async guildMemberRemove(
    [member]: ArgsOf<"guildMemberRemove">,
    _client: Client,
  ): Promise<void> {
    void _client;
    if (!member.user || member.user.bot) return;

    const logChannel = await resolveLogChannel(_client);
    if (!logChannel) return;

    const username = member.user.tag ?? member.user.username ?? member.user.id;
    const kickAudit = await getKickAudit(_client, member.guild.id, member.user.id);
    if (kickAudit) {
      const embed = new EmbedBuilder()
        .setTitle("User Kicked")
        .setColor(0xf39c12)
        .addFields(
          { name: "User", value: `<@${member.user.id}>\n${username}` },
          {
            name: "Account Created On",
            value: formatDiscordDateTime(member.user.createdAt),
          },
          { name: "Moderator", value: `<@${kickAudit.moderatorId}>` },
          {
            name: "Reason",
            value: kickAudit.reason ?? "No reason provided.",
          },
        )
        .setFooter({
          text: `ID: ${member.user.id} • ${formatTimestampWithDay(Date.now())}`,
        })
        .setThumbnail(member.user.displayAvatarURL());

      await (logChannel as any).send({ embeds: [embed] });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("User Left")
      .setColor(0x95a5a6)
      .addFields(
        { name: "User", value: `<@${member.user.id}>\n${username}` },
        {
          name: "Account Created On",
          value: formatDiscordDateTime(member.user.createdAt),
        },
      )
      .setFooter({
        text: `ID: ${member.user.id} • ${formatTimestampWithDay(Date.now())}`,
      })
      .setThumbnail(member.user.displayAvatarURL());

    await (logChannel as any).send({ embeds: [embed] });
  }
}
