import {
  ApplicationCommandOptionType,
  Attachment,
  ButtonInteraction,
  MessageFlags,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
  type CommandInteraction,
  type User,
} from "discord.js";
import {
  ButtonComponent,
  Discord,
  ModalComponent,
  SelectMenuComponent,
  Slash,
  SlashChoice,
  SlashGroup,
  SlashOption,
} from "discordx";
import {
  safeDeferReply,
  safeReply,
  safeUpdate,
  sanitizeUserInput,
} from "../functions/InteractionUtils.js";
import {
  formatVoteDateForDisplay,
  parseVoteDateInput,
} from "../functions/VoteDateUtils.js";
import { bot } from "../RPGClub_GameDB.js";
import BotVotingInfo from "../classes/BotVotingInfo.js";
import { isAdmin } from "./admin/admin-auth.utils.js";
import { ADMIN_HELP_TOPICS, buildAdminHelpEmbed, buildAdminHelpResponse } from "./admin/admin-help.service.js";
import { handleVotingSetup } from "./admin/voting-admin.service.js";
import {
  handleDeleteGotmNomination,
  handleDeleteNrGotmNomination,
  handleDeleteGotmNomsPanel,
  handleDeleteNrGotmNomsPanel,
  handleAdminNominationDeleteSelect as handleAdminNominationDeleteSelectAction,
  handleAdminNominationDeleteReasonModal as handleAdminNominationDeleteReasonModalAction,
  handleAdminNominationDeleteConfirmButton as handleAdminNominationDeleteConfirmButtonAction,
} from "./admin/nomination-admin.service.js";
import { handleAddGotm, handleEditGotm } from "./admin/gotm-admin.service.js";
import { handleAddNrGotm, handleEditNrGotm } from "./admin/nr-gotm-admin.service.js";
import { handleGotmAudit } from "./admin/gotm-audit.service.js";
import {
  handleGotmAuditSelect,
  handleGotmAuditAction,
  handleGotmAuditManualModal,
  handleGotmAuditQueryModal,
} from "./admin/gotm-audit-handlers.js";
import { handleNextRoundSetup } from "./admin/round-setup-wizard.service.js";
import { GOTM_AUDIT_ACTIONS, type AdminHelpTopicId, type GotmAuditAction } from "./admin/admin.types.js";

@Discord()
@SlashGroup({ description: "Admin Commands", name: "admin" })
@SlashGroup("admin")
export class Admin {
  @Slash({
    description: "Synchronize application commands with Discord",
    name: "sync",
  })
  async sync(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    try {
      await bot.initApplicationCommands();
      await safeReply(interaction, {
        content: "✅ Commands synchronized with Discord.",
        flags: MessageFlags.Ephemeral,
      });
    } catch (err: any) {
      const msg: string = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Failed to sync commands: ${msg}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    description: "Votes are typically held the last Friday of the month",
    name: "set-nextvote",
  })
  async setNextVote(
    @SlashOption({
      description:
        "Next vote date. Votes are typically held the last Friday of the month.",
      name: "date",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    dateText: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    // Run publicly; avoid default ephemeral deferral for admin commands
    await safeDeferReply(interaction, {});
    dateText = sanitizeUserInput(dateText, { preserveNewlines: false });

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    const parsed = parseVoteDateInput(dateText);
    if (!parsed) {
      await safeReply(interaction, {
        content:
          "Invalid date format. Please use a recognizable date such as `YYYY-MM-DD`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const current = await BotVotingInfo.getCurrentRound();
      if (!current) {
        await safeReply(interaction, {
          content:
            "No voting round information is available. Create a round before setting the next vote date.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await BotVotingInfo.updateNextVoteAt(current.roundNumber, parsed);

      await safeReply(interaction, {
        content:
          `Next vote date updated to ${formatVoteDateForDisplay(parsed)} (America/New_York).`,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Error updating next vote date: ${msg}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    description: "Delete any GOTM nomination for the upcoming round",
    name: "delete-gotm-nomination",
  })
  async deleteGotmNomination(
    @SlashOption({
      description: "User whose nomination should be removed",
      name: "user",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    user: User,
    @SlashOption({
      description: "Reason for deletion (required)",
      name: "reason",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    reason: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    await handleDeleteGotmNomination(interaction, user, reason);
  }

  @Slash({
    description: "Delete any NR-GOTM nomination for the upcoming round",
    name: "delete-nr-gotm-nomination",
  })
  async deleteNrGotmNomination(
    @SlashOption({
      description: "User whose nomination should be removed",
      name: "user",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    user: User,
    interaction: CommandInteraction,
  ): Promise<void> {
    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      await safeReply(interaction, { content: "Access denied. Command requires Administrator role.", flags: MessageFlags.Ephemeral });
      return;
    }

    await handleDeleteNrGotmNomination(interaction, user);
  }

  @Slash({
    description: "Interactive deletion of GOTM nominations for the upcoming round",
    name: "delete-gotm-noms",
  })
  async deleteGotmNomsPanel(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    await handleDeleteGotmNomsPanel(interaction);
  }

  @Slash({
    description: "Generate Subo /poll commands for GOTM and NR-GOTM voting",
    name: "voting-setup",
  })
  async votingSetup(
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) return;

    await handleVotingSetup(interaction);
  }

  @Slash({
    description: "Interactive deletion of NR-GOTM nominations for the upcoming round",
    name: "delete-nr-gotm-noms",
  })
  async deleteNrGotmNomsPanel(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    await handleDeleteNrGotmNomsPanel(interaction);
  }

  @SelectMenuComponent({ id: /^admin-nom-del-select:(gotm|nr-gotm):(\d+)$/ })
  async handleAdminNominationDeleteSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    await handleAdminNominationDeleteSelectAction(interaction);
  }

  @ModalComponent({ id: /^admin-nom-del-reason:[A-Za-z0-9_-]{1,64}$/ })
  async handleAdminNominationDeleteReasonModal(interaction: ModalSubmitInteraction): Promise<void> {
    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    await handleAdminNominationDeleteReasonModalAction(interaction);
  }

  @ButtonComponent({ id: /^admin-nom-del-confirm:[A-Za-z0-9_-]{1,64}$/ })
  async handleAdminNominationDeleteConfirmButton(interaction: ButtonInteraction): Promise<void> {
    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    await handleAdminNominationDeleteConfirmButtonAction(interaction);
  }

  @Slash({ description: "Interactive setup for the next round (GOTM, NR-GOTM, dates)", name: "nextround-setup" })
  async nextRoundSetup(
    @SlashOption({
      description: "Run in test mode (no DB changes)",
      name: "testmode",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    testModeInput: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, {});

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) return;

    await handleNextRoundSetup(interaction, testModeInput);
  }

  @Slash({ description: "Add a new GOTM round", name: "add-gotm" })
  async addGotm(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    await handleAddGotm(interaction);
  }

  @Slash({ description: "Add a new NR-GOTM round", name: "add-nr-gotm" })
  async addNrGotm(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    await handleAddNrGotm(interaction);
  }

  @Slash({ description: "Audit and import past GOTM and NR-GOTM entries", name: "gotm-audit" })
  async gotmAudit(
    @SlashChoice(
      ...GOTM_AUDIT_ACTIONS.map((value) => ({
        name: value,
        value,
      })),
    )
    @SlashOption({
      description: "Action to perform",
      name: "action",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    action: GotmAuditAction,
    @SlashOption({
      description: "CSV file of past GOTM/NR-GOTM entries (required for start)",
      name: "file",
      required: false,
      type: ApplicationCommandOptionType.Attachment,
    })
    file: Attachment | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    await handleGotmAudit(interaction, action, file);
  }

  @SelectMenuComponent({ id: /^gotm-audit-select:\d+:\d+:\d+$/ })
  async handleGotmAuditSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    await handleGotmAuditSelect(interaction);
  }

  @ButtonComponent({ id: /^gotm-audit-action:\d+:\d+:\d+:(manual|query|accept|skip|pause)$/ })
  async handleGotmAuditAction(interaction: ButtonInteraction): Promise<void> {
    await handleGotmAuditAction(interaction);
  }

  @ModalComponent({ id: /^gotm-audit-manual:\d+:\d+:\d+$/ })
  async handleGotmAuditManualModal(interaction: ModalSubmitInteraction): Promise<void> {
    await handleGotmAuditManualModal(interaction);
  }

  @ModalComponent({ id: /^gotm-audit-query:\d+:\d+:\d+$/ })
  async handleGotmAuditQueryModal(interaction: ModalSubmitInteraction): Promise<void> {
    await handleGotmAuditQueryModal(interaction);
  }

  @Slash({ description: "Edit GOTM data by round", name: "edit-gotm" })
  async editGotm(
    @SlashOption({
      description: "Round number to edit",
      name: "round",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    round: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    await handleEditGotm(interaction, round);
  }

  @Slash({ description: "Edit NR-GOTM data by round", name: "edit-nr-gotm" })
  async editNrGotm(
    @SlashOption({
      description: "NR-GOTM Round number to edit",
      name: "round",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    round: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    await handleEditNrGotm(interaction, round);
  }

  @Slash({ description: "Show help for admin commands", name: "help" })
  async help(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    const response = buildAdminHelpResponse();

    await safeReply(interaction, {
      ...response,
      flags: MessageFlags.Ephemeral,
    });
  }

  @SelectMenuComponent({ id: "admin-help-select" })
  async handleAdminHelpMenu(interaction: StringSelectMenuInteraction): Promise<void> {
    const topicId = interaction.values?.[0] as AdminHelpTopicId | "help-main" | undefined;

    if (topicId === "help-main") {
      const { buildMainHelpResponse } = await import("./help.command.js");
      const response = buildMainHelpResponse();
      await safeUpdate(interaction, response);
      return;
    }

    const topic = ADMIN_HELP_TOPICS.find((entry) => entry.id === topicId);

    if (!topic) {
      const response = buildAdminHelpResponse();
      await safeUpdate(interaction, {
        ...response,
        content: "Sorry, I don't recognize that admin help topic. Showing the admin help menu.",
      });
      return;
    }

    const helpEmbed = buildAdminHelpEmbed(topic);
    const response = buildAdminHelpResponse(topic.id);

    await safeUpdate(interaction, {
      embeds: [helpEmbed],
      components: response.components,
    });
  }
}

// Export isAdmin for external use
export { isAdmin };
