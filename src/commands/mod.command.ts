import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  EmbedBuilder,
  MessageFlags,
  PermissionsBitField,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { CommandInteraction } from "discord.js";
import { Discord, SelectMenuComponent, Slash, SlashGroup, SlashOption } from "discordx";
import { getPresenceHistory, setPresence } from "../functions/SetPresence.js";
import {
  AnyRepliable,
  safeDeferReply,
  safeReply,
  safeUpdate,
  sanitizeUserInput,
} from "../functions/InteractionUtils.js";

type ModHelpTopicId = "presence" | "presence-history";

type ModHelpTopic = {
  id: ModHelpTopicId;
  label: string;
  summary: string;
  syntax: string;
  parameters?: string;
};

export const MOD_HELP_TOPICS: ModHelpTopic[] = [
  {
    id: "presence",
    label: "/mod presence",
    summary: 'Set the bot\'s "Now Playing" text.',
    syntax: "Syntax: /mod presence text:<string>",
    parameters: "text (required string) - new presence text.",
  },
  {
    id: "presence-history",
    label: "/mod presence-history",
    summary: "Show the most recent presence changes.",
    syntax: "Syntax: /mod presence-history [count:<integer>]",
    parameters: "count (optional integer, default 5, max 50) - number of entries.",
  },
];

function buildModHelpButtons(
  activeId?: ModHelpTopicId,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const select = new StringSelectMenuBuilder()
    .setCustomId("mod-help-select")
    .setPlaceholder("/mod help")
    .addOptions(
      MOD_HELP_TOPICS.map((topic) => ({
        label: topic.label,
        value: topic.id,
        description: topic.summary.slice(0, 95),
        default: topic.id === activeId,
      })),
    )
    .addOptions({ label: "Back to Help Main Menu", value: "help-main" });

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

export function buildModHelpEmbed(topic: ModHelpTopic): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${topic.label} help`)
    .setDescription(topic.summary)
    .addFields({ name: "Syntax", value: topic.syntax });

  if (topic.parameters) {
    embed.addFields({ name: "Parameters", value: topic.parameters });
  }

  return embed;
}

@Discord()
@SlashGroup({ description: "Moderator Commands", name: "mod" })
@SlashGroup("mod")
export class Mod {
  @Slash({ description: "Set Presence", name: "presence" })
  async presence(
    @SlashOption({
      description: "What should the 'Now Playing' value be?",
      name: "text",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    text: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isModerator(interaction);

    if (okToUseCommand) {
      text = sanitizeUserInput(text, { preserveNewlines: false });
      await setPresence(
        interaction,
        text,
      );
      await safeReply(interaction, {
        content: `I'm now playing: ${text}!`,
      });
    }
  }

  @Slash({ description: "Show presence history", name: "presence-history" })
  async presenceHistory(
    @SlashOption({
      description: "How many entries to show (default 5, max 50)",
      name: "count",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    count: number | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isModerator(interaction);
    if (!okToUseCommand) {
      return;
    }

    const limit =
      typeof count === "number" && Number.isFinite(count)
        ? Math.max(1, Math.min(50, Math.trunc(count)))
        : 5;

    const entries = await getPresenceHistory(limit);

    if (!entries.length) {
      await safeReply(interaction, {
        content: "No presence history found.",
      });
      return;
    }

    const lines = entries.map((entry) => {
      const timestamp =
        entry.setAt instanceof Date
          ? `<t:${Math.floor(entry.setAt.getTime() / 1000)}:F>`
          : String(entry.setAt);
      const userDisplay = entry.setByUsername ?? entry.setByUserId ?? "unknown user";
      return `• ${timestamp} ${entry.activityName} (set by ${userDisplay})`;
    });

    const header = `Last ${entries.length} presence entr${
      entries.length === 1 ? "y" : "ies"
    }:\n`;

    await safeReply(interaction, {
      content: header + lines.join("\n"),
    });
  }

  @Slash({ description: "Show help for moderator commands", name: "help" })
  async help(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const okToUseCommand: boolean = await isModerator(interaction);
    if (!okToUseCommand) {
      return;
    }

    const response = buildModHelpResponse();

    await safeReply(interaction, {
      ...response,
      flags: MessageFlags.Ephemeral,
    });
  }

  @SelectMenuComponent({ id: "mod-help-select" })
  async handleModHelpButton(interaction: StringSelectMenuInteraction): Promise<void> {
    const topicId = interaction.values?.[0] as ModHelpTopicId | "help-main" | undefined;

    if (topicId === "help-main") {
      const { buildMainHelpResponse } = await import("./help.command.js");
      const response = buildMainHelpResponse();
      await safeUpdate(interaction, response);
      return;
    }

    const topic = topicId ? MOD_HELP_TOPICS.find((entry) => entry.id === topicId) : null;

    if (!topic) {
      const response = buildModHelpResponse();
      await safeUpdate(interaction, {
        ...response,
        content: "Sorry, I don't recognize that moderator help topic. Showing the moderator help menu.",
      });
      return;
    }

    const helpEmbed = buildModHelpEmbed(topic);
    const response = buildModHelpResponse(topic.id);

    await safeUpdate(interaction, {
      embeds: [helpEmbed],
      components: response.components,
    });
  }
}

export async function isModerator(interaction: AnyRepliable) {
  const anyInteraction = interaction as any;
  const member: any = (interaction as any).member;
  const canCheck =
    member && typeof member.permissionsIn === "function" && interaction.channel;
  let isMod = canCheck
    ? member.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.ManageMessages)
    : false;

  if (!isMod) {
    const isAdmin = canCheck
      ? member.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.Administrator)
      : false;

    if (!isAdmin) {
      const denial = {
        content: "Access denied. Command requires Moderator role or above.",
        flags: MessageFlags.Ephemeral,
      };

      try {
        if (anyInteraction.replied || anyInteraction.deferred || anyInteraction.__rpgAcked) {
          await interaction.followUp(denial as any);
        } else {
          await interaction.reply(denial as any);
          anyInteraction.__rpgAcked = true;
          anyInteraction.__rpgDeferred = false;
        }
      } catch {
        // swallow
      }
    } else {
      isMod = true;
    }
  }

  return isMod;
}
export function buildModHelpResponse(
  activeTopicId?: ModHelpTopicId,
): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<StringSelectMenuBuilder>[];
} {
  const embed = new EmbedBuilder()
    .setTitle("Moderator Commands Help")
    .setDescription("Pick a `/mod` command to see what it does and how to run it.");

  const components = buildModHelpButtons(activeTopicId);

  return {
    embeds: [embed],
    components,
  };
}
