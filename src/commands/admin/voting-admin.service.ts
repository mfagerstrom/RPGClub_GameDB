import { DateTime } from "luxon";
import type { CommandInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import { safeReply } from "../../functions/InteractionUtils.js";
import { listNominationsForRound } from "../../classes/Nomination.js";
import { getUpcomingNominationWindow } from "../../functions/NominationWindow.js";
import { calculateNextVoteDateEt } from "../../functions/VoteDateUtils.js";
import { ADMIN_CHANNEL_ID } from "../../config/channels.js";
import { promptUserForInput } from "./admin-prompt.utils.js";
import { VOTING_TITLE_MAX_LEN } from "./admin.types.js";

export async function handleVotingSetup(interaction: CommandInteraction): Promise<void> {
  try {
    const window = await getUpcomingNominationWindow();
    const roundNumber = window.targetRound;
    const nextMonth = (() => {
      const base = new Date();
      const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1));
      return d.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
    })();
    const monthLabel = nextMonth || "the upcoming month";

    const gotmNoms = await listNominationsForRound("gotm", roundNumber);
    const nrNoms = await listNominationsForRound("nr-gotm", roundNumber);

    const buildPoll = (kindLabel: string, answers: string[]): string => {
      if (!answers.length) {
        return `${kindLabel}: (no nominations found for Round ${roundNumber})`;
      }
      const maxSelect = Math.max(1, Math.floor(answers.length / 2));
      const answersJoined = answers.join(";");
      const pollName =
        kindLabel === "GOTM"
          ? `GOTM_Round_${roundNumber}`
          : `NR-GOTM_Round_${roundNumber}`;
      const question =
        kindLabel === "GOTM"
          ? `What Roleplaying Game(s) would you like to discuss in ${monthLabel}?`
          : `What Non-Roleplaying Game(s) would you like to discuss in ${monthLabel}?`;

      // Calculate time until 8 PM Eastern
      const nowInEastern = DateTime.now().setZone("America/New_York");
      const today8pm = nowInEastern.set({ hour: 20, minute: 0, second: 0, millisecond: 0 });

      let startOutput: string;
      let timeLimitOutput: string;

      if (nowInEastern < today8pm) {
        const diff = today8pm.diff(nowInEastern).shiftTo("hours", "minutes", "seconds");
        startOutput = diff.toFormat("h'h'm'm's's");
        timeLimitOutput = "48h";
      } else {
        startOutput = "1m";
        // End at 8 PM on (Today + 2 days)
        const targetEnd = today8pm.plus({ days: 2 });
        const actualStart = nowInEastern.plus({ minutes: 1 });
        const diff = targetEnd.diff(actualStart).shiftTo("hours", "minutes", "seconds");
        timeLimitOutput = diff.toFormat("h'h'm'm's's");
      }

      return `/poll question:${question} answers:${answersJoined} max_select:${maxSelect} start:${startOutput} time_limit:${timeLimitOutput} vote_change:Yes realtime_results:🙈 Hidden privacy:🤐 Semi-private role_required:@members channel:#announcements name:${pollName} final_reveal:Yes chart_emoji:🟩 voting_button:Full Answer`;
    };

    const gotmAnswers = gotmNoms.map((n) => n.gameTitle).map((t) => t.trim()).filter(Boolean);
    const nrAnswers = nrNoms.map((n) => n.gameTitle).map((t) => t.trim()).filter(Boolean);

    const normalizedGotmAnswers = await normalizeVotingTitles(
      interaction,
      "GOTM",
      gotmAnswers,
    );
    if (!normalizedGotmAnswers) return;

    const normalizedNrAnswers = await normalizeVotingTitles(
      interaction,
      "NR-GOTM",
      nrAnswers,
    );
    if (!normalizedNrAnswers) return;

    const gotmPoll = buildPoll("GOTM", normalizedGotmAnswers);
    const nrPoll = buildPoll("NR-GOTM", normalizedNrAnswers);

    const adminChannel = ADMIN_CHANNEL_ID
      ? await interaction.client.channels.fetch(ADMIN_CHANNEL_ID).catch(() => null)
      : null;

    const messageContent = `GOTM:\n\`\`\`\n${gotmPoll}\n\`\`\`\nNR-GOTM:\n\`\`\`\n${nrPoll}\n\`\`\``;

    if (adminChannel && (adminChannel as any).send) {
      await (adminChannel as any).send({ content: messageContent });
      await safeReply(interaction, {
        content: "Voting setup commands posted to #admin.",
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await safeReply(interaction, {
        content: messageContent,
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    await safeReply(interaction, {
      content: `Could not generate vote commands: ${msg}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function normalizeVotingTitles(
  interaction: CommandInteraction,
  kindLabel: string,
  answers: string[],
): Promise<string[] | null> {
  const normalized: string[] = [];

  for (const answer of answers) {
    if (answer.length < 39) {
      normalized.push(answer);
      continue;
    }

    while (true) {
      const prompt =
        `The ${kindLabel} title "${answer}" is ${answer.length} characters. ` +
        `Enter a shorter title (max ${VOTING_TITLE_MAX_LEN}).`;
      const response = await promptUserForInput(interaction, prompt, 180_000);
      if (!response) return null;

      const trimmed = response.trim();
      if (!trimmed) {
        await safeReply(interaction, { content: "Title cannot be empty." });
        continue;
      }

      if (trimmed.length >= 39) {
        await safeReply(interaction, {
          content: `Title must be ${VOTING_TITLE_MAX_LEN} characters or fewer.`,
        });
        continue;
      }

      normalized.push(trimmed);
      break;
    }
  }

  return normalized;
}

export function calculateNextVoteDate(): Date {
  return calculateNextVoteDateEt();
}
