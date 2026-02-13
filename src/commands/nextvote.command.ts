import { type CommandInteraction, EmbedBuilder, ApplicationCommandOptionType, MessageFlags } from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
import BotVotingInfo from "../classes/BotVotingInfo.js";

@Discord()
export class NextVoteCommand {
  @Slash({
    description: "Show the date of the next GOTM/NR-GOTM vote",
    name: "nextvote",
  })
  async nextvote(
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
    await safeDeferReply(interaction, { flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    try {
      const current = await BotVotingInfo.getCurrentRound();
      if (!current || !current.nextVoteAt) {
        await safeReply(interaction, {
          content: "No next vote information is available.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      let dateText: string;
      if (current.nextVoteAt instanceof Date) {
        dateText = current.nextVoteAt.toLocaleDateString();
      } else {
        const parsed = new Date(current.nextVoteAt as unknown as string);
        dateText = Number.isNaN(parsed.getTime())
          ? String(current.nextVoteAt)
          : parsed.toLocaleDateString();
      }

      const descriptionLines: string[] = [];
      descriptionLines.push(dateText);
      descriptionLines.push("");
      descriptionLines.push("Nominate a game: /nominate");

      const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle("Next Vote:")
        .setDescription(descriptionLines.join("\n"));

      await safeReply(interaction, {
        embeds: [embed],
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Error fetching next vote information: ${msg}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
