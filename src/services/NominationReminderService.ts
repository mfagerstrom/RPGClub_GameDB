import type { TextBasedChannel } from "discord.js";
import type { Client } from "discordx";
import { DateTime } from "luxon";
import BotVotingInfo, { type IBotVotingInfoEntry } from "../classes/BotVotingInfo.js";
import { NOMINATION_DISCUSSION_CHANNEL_IDS } from "../config/nominationChannels.js";

const CHECK_INTERVAL_MS = 60_000;
const REMINDER_ZONE = "America/New_York";

type ReminderDefinition = {
  kind: "fiveDay" | "oneDay";
  daysBefore: number;
  wasSent: (entry: IBotVotingInfoEntry) => boolean;
  description: string;
};

const REMINDERS: ReminderDefinition[] = [
  {
    kind: "fiveDay",
    daysBefore: 5,
    wasSent: (entry) => entry.fiveDayReminderSent,
    description: "Voting is in five days",
  },
  {
    kind: "oneDay",
    daysBefore: 1,
    wasSent: (entry) => entry.oneDayReminderSent,
    description: "Voting is tomorrow",
  },
];

let reminderTimer: NodeJS.Timeout | null = null;
let currentlyChecking = false;

type SendableTextChannel = TextBasedChannel & {
  send: (content: string) => Promise<any>;
};

function isSendableTextChannel(channel: TextBasedChannel | null): channel is SendableTextChannel {
  return Boolean(channel && typeof (channel as any).send === "function");
}

export function startNominationReminderService(client: Client): void {
  if (reminderTimer) {
    return;
  }

  const run = async (): Promise<void> => {
    if (currentlyChecking) {
      return;
    }
    currentlyChecking = true;
    try {
      await checkAndSendReminders(client);
    } catch (err) {
      console.error("Nomination reminder check failed:", err);
    } finally {
      currentlyChecking = false;
    }
  };

  void run();
  reminderTimer = setInterval(() => {
    void run();
  }, CHECK_INTERVAL_MS);
}

async function checkAndSendReminders(client: Client): Promise<void> {
  const current = await BotVotingInfo.getCurrentRound();
  if (!current || !(current.nextVoteAt instanceof Date)) {
    return;
  }

  const entry = current;
  const voteSourceUtc = DateTime.fromJSDate(entry.nextVoteAt, { zone: "utc" });
  const voteDateEt = DateTime.fromObject(
    {
      year: voteSourceUtc.year,
      month: voteSourceUtc.month,
      day: voteSourceUtc.day,
      hour: 12,
      minute: 0,
      second: 0,
      millisecond: 0,
    },
    { zone: REMINDER_ZONE },
  );
  const nowUtc = DateTime.utc();

  for (const reminder of REMINDERS) {
    if (reminder.wasSent(entry)) {
      continue;
    }

    const reminderMomentUtc = voteDateEt
      .minus({ days: reminder.daysBefore })
      .set({ hour: 17, minute: 0, second: 0, millisecond: 0 })
      .toUTC();

    if (nowUtc < reminderMomentUtc) {
      continue;
    }

    const voteLabel = `${voteDateEt.toFormat("cccc, LLL dd")} (ET)`;

    const content =
      `${reminder.description}! (${voteLabel})\n` +
      "Please nominate games for the upcoming vote so they can be included.";

    const sent = await sendReminderToAllChannels(client, content);
    if (sent) {
      await BotVotingInfo.markReminderSent(entry.roundNumber, reminder.kind);
    }
  }
}

async function sendReminderToAllChannels(client: Client, content: string): Promise<boolean> {
  let successCount = 0;

  for (const channelId of NOMINATION_DISCUSSION_CHANNEL_IDS) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel) {
        console.warn(`Nomination reminder skipped channel ${channelId}: not found.`);
        continue;
      }

      const textChannel: TextBasedChannel | null = channel.isTextBased()
        ? channel
        : null;

      if (!textChannel || !isSendableTextChannel(textChannel)) {
        console.warn(`Nomination reminder skipped channel ${channelId}: not text-based or cannot send.`);
        continue;
      }

      await textChannel.send(content);
      successCount += 1;
    } catch (err) {
      console.error(`Failed to send nomination reminder to channel ${channelId}:`, err);
    }
  }

  return successCount > 0;
}
