import { type CommandInteraction, ApplicationCommandOptionType, MessageFlags } from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
import BotVotingInfo from "../classes/BotVotingInfo.js";
import Gotm from "../classes/Gotm.js";
import NrGotm from "../classes/NrGotm.js";
import {
  buildGotmCardsFromEntries,
  buildGotmSearchMessages,
} from "../functions/GotmSearchComponents.js";
import { buildComponentsV2Flags } from "../functions/NominationListComponents.js";

@Discord()
export class CurrentRoundCommand {
  @Slash({
    description: "Show the current GOTM round and winners",
    name: "round",
  })
  async round(
    @SlashOption({
      description: "If true, show results in the channel instead of ephemerally.",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const ephemeral = !showInChat;
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(ephemeral) });

    try {
      const current = await BotVotingInfo.getCurrentRound();
      if (!current) {
        await safeReply(interaction, {
          content: "No voting round information is available.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const roundNumber = current.roundNumber;

      const gotmEntries = Gotm.getByRound(roundNumber);
      const nrGotmEntries = NrGotm.getByRound(roundNumber);

      const gotmMonthYear = gotmEntries[0]?.monthYear;
      const nrGotmMonthYear = nrGotmEntries[0]?.monthYear;

      const gotmCards = buildGotmCardsFromEntries(gotmEntries, "GOTM");
      const nrCards = buildGotmCardsFromEntries(nrGotmEntries, "NR-GOTM").filter(
        (card) => card.title.trim().toLowerCase() !== "n/a",
      );
      const cards = [...gotmCards, ...nrCards];

      const currentDescLines: string[] = [];
      const mainLine = `Round ${roundNumber}`;
      const roundTitle = `Round ${roundNumber} - ${gotmMonthYear}`;

      currentDescLines.push(mainLine);

      if (!gotmMonthYear && !nrGotmMonthYear) {
        // no extra month/year lines
      } else if (!(gotmMonthYear && nrGotmMonthYear && gotmMonthYear === nrGotmMonthYear)) {
        if (gotmMonthYear) {
          currentDescLines.push(`GOTM: ${gotmMonthYear}`);
        }
        if (nrGotmMonthYear) {
          currentDescLines.push(`NR-GOTM: ${nrGotmMonthYear}`);
        }
      }

      if (!cards.length) {
        currentDescLines.push("");
        currentDescLines.push("(No GOTM or NR-GOTM entries found for this round.)");
      }

      const payloads = await buildGotmSearchMessages(interaction.client, cards, {
        title: roundTitle,
        continuationTitle: `${roundTitle} (continued)`,
        emptyMessage: "No GOTM or NR-GOTM entries found for this round.",
        introText: currentDescLines.slice(1).join("\n"),
        guildId: interaction.guildId ?? undefined,
        maxGamesPerContainer: 10,
      });

      for (let i = 0; i < payloads.length; i += 1) {
        const payload = payloads[i];
        await safeReply(interaction, {
          components: payload.components,
          files: payload.files.length ? payload.files : undefined,
          flags: buildComponentsV2Flags(ephemeral),
          ...(i > 0 ? { __forceFollowUp: true } : {}),
        });
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Error fetching current round information: ${msg}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
