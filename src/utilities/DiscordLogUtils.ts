import type { Client } from "discordx";
import { DISCORD_LOG_CHANNEL_ID } from "../config/channels.js";

export async function resolveLogChannel(client: Client): Promise<any | null> {
  const channel = await client.channels.fetch(DISCORD_LOG_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;
  const sendable = channel as any;
  return typeof sendable.send === "function" ? sendable : null;
}

export function formatTimestampWithDay(timestamp: number | null | undefined): string {
  const unixSeconds = Math.floor((timestamp ?? Date.now()) / 1000);
  return `<t:${unixSeconds}:F>`;
}
