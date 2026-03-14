import {
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import { type AdminHelpTopic, type AdminHelpTopicId } from "./admin.types.js";

export const ADMIN_HELP_TOPICS: AdminHelpTopic[] = [
  {
    id: "sync",
    label: "/admin sync",
    summary: "Refresh slash command registrations with Discord.",
    syntax: "Syntax: /admin sync",
    notes: "Use after updating command choices or definitions.",
  },
  {
    id: "nextround-setup",
    label: "/admin nextround-setup",
    summary: "Interactive wizard to setup the next round (games, threads, dates).",
    syntax: "Syntax: /admin nextround-setup",
    notes: "Walks through adding GOTM/NR-GOTM winners, linking threads, and setting the next vote date.",
  },
  {
    id: "add-gotm",
    label: "/admin add-gotm",
    summary: "Add the next GOTM round with guided prompts.",
    syntax: "Syntax: /admin add-gotm",
    notes:
      "Round number is auto-assigned to the next open round.",
  },
  {
    id: "edit-gotm",
    label: "/admin edit-gotm",
    summary: "Update details for a specific GOTM round.",
    syntax: "Syntax: /admin edit-gotm round:<integer>",
    parameters:
      "round (required) — GOTM round to edit. The bot shows current data and lets you pick what to change.",
  },
  {
    id: "add-nr-gotm",
    label: "/admin add-nr-gotm",
    summary: "Add the next NR-GOTM round with guided prompts.",
    syntax: "Syntax: /admin add-nr-gotm",
    notes:
      "Round number is auto-assigned to the next open NR-GOTM round.",
  },
  {
    id: "gotm-audit",
    label: "/admin gotm-audit",
    summary: "Audit and import past GOTM and NR-GOTM entries from a CSV file.",
    syntax:
      "Syntax: /admin gotm-audit action:<start|resume|pause|cancel|status> " +
      "[file:<attachment>]",
    notes:
      "CSV headers: kind, round, monthYear, title. Optional: gameIndex (1-based), threadId, " +
      "redditUrl, gameDbId. Use action:start with a CSV file to begin; resume continues " +
      "the latest active session.",
  },
  {
    id: "edit-nr-gotm",
    label: "/admin edit-nr-gotm",
    summary: "Update details for a specific NR-GOTM round.",
    syntax: "Syntax: /admin edit-nr-gotm round:<integer>",
    parameters:
      "round (required) — NR-GOTM round to edit. The bot shows current data and lets you pick what to change.",
  },
  {
    id: "delete-gotm-nomination",
    label: "/admin delete-gotm-nomination",
    summary: "Remove a user's GOTM nomination for the upcoming round and announce it.",
    syntax: "Syntax: /admin delete-gotm-nomination user:<user> reason:<string>",
    notes: "Targets the upcoming nomination set. A public update is posted with the refreshed list.",
  },
  {
    id: "delete-nr-gotm-nomination",
    label: "/admin delete-nr-gotm-nomination",
    summary: "Remove a user's NR-GOTM nomination for the upcoming round and announce it.",
    syntax: "Syntax: /admin delete-nr-gotm-nomination user:<user>",
    notes: "Targets the upcoming nomination set. The command opens a required reason prompt, then a final Delete Nomination confirmation step before the public update is posted.",
  },
  {
    id: "delete-gotm-noms",
    label: "/admin delete-gotm-noms",
    summary: "Interactive panel to delete GOTM nominations.",
    syntax: "Syntax: /admin delete-gotm-noms",
    notes: "Shows the current nomination list, a title dropdown, a required reason prompt, and a final Delete Nomination confirmation button.",
  },
  {
    id: "delete-nr-gotm-noms",
    label: "/admin delete-nr-gotm-noms",
    summary: "Interactive panel to delete NR-GOTM nominations.",
    syntax: "Syntax: /admin delete-nr-gotm-noms",
    notes: "Shows the current nomination list, a title dropdown, a required reason prompt, and a final Delete Nomination confirmation button.",
  },
  {
    id: "set-nextvote",
    label: "/admin set-nextvote",
    summary: "Set when the next GOTM/NR-GOTM vote will happen.",
    syntax: "Syntax: /admin set-nextvote date:<date>",
    notes: "Votes are typically held the last Friday of the month. Date input is interpreted in America/New_York.",
  },
  {
    id: "voting-setup",
    label: "/admin voting-setup",
    summary: "Build ready-to-paste Subo /poll commands from current nominations.",
    syntax: "Syntax: /admin voting-setup",
    notes: "Pulls current nominations for GOTM and NR-GOTM, sorts answers, and sets a sensible max_select.",
  },
];

export function buildAdminHelpButtons(
  activeId?: AdminHelpTopicId,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const select = new StringSelectMenuBuilder()
    .setCustomId("admin-help-select")
    .setPlaceholder("/admin help")
    .addOptions(
      ADMIN_HELP_TOPICS.map((topic) => ({
        label: topic.label,
        value: topic.id,
        description: topic.summary.slice(0, 95),
        default: topic.id === activeId,
      })),
    )
    .addOptions({ label: "Back to Help Main Menu", value: "help-main" });

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

export function buildAdminHelpEmbed(topic: AdminHelpTopic): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${topic.label} help`)
    .setDescription(topic.summary)
    .addFields({ name: "Syntax", value: topic.syntax });

  if (topic.parameters) {
    embed.addFields({ name: "Parameters", value: topic.parameters });
  }

  if (topic.notes) {
    embed.addFields({ name: "Notes", value: topic.notes });
  }

  return embed;
}

export function buildAdminHelpResponse(
  activeTopicId?: AdminHelpTopicId,
): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<StringSelectMenuBuilder>[];
} {
  const embed = new EmbedBuilder()
    .setTitle("Admin Commands Help")
    .setDescription("Pick an `/admin` command below to see what it does and how to use it.");

  const components = buildAdminHelpButtons(activeTopicId);

  return {
    embeds: [embed],
    components,
  };
}
