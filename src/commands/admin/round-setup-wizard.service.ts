// Round Setup Wizard - Interactive wizard for setting up GOTM/NR-GOTM rounds
// Due to complexity, this is extracted as a separate service

import type { CommandInteraction } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ComponentType, type Message } from "discord.js";
import { safeReply } from "../../functions/InteractionUtils.js";
import { ADMIN_CHANNEL_ID } from "../../config/channels.js";
import Gotm, { insertGotmRoundInDatabase } from "../../classes/Gotm.js";
import NrGotm, { insertNrGotmRoundInDatabase } from "../../classes/NrGotm.js";
import BotVotingInfo from "../../classes/BotVotingInfo.js";
import { calculateNextVoteDate } from "./voting-admin.service.js";
import {
  formatVoteDateForDisplay,
  parseVoteDateInput,
} from "../../functions/VoteDateUtils.js";
import {
  addCancelOption,
  buildChoiceRows,
} from "./admin-prompt.utils.js";
import { type WizardAction, type PromptChoiceOption } from "./admin.types.js";

export async function handleNextRoundSetup(
  interaction: CommandInteraction,
  testModeInput: boolean | undefined,
): Promise<void> {
  if (interaction.channelId !== ADMIN_CHANNEL_ID) {
    await safeReply(interaction, {
      content: `This command can only be used in <#${ADMIN_CHANNEL_ID}>.`,
    });
    return;
  }

  const testMode = !!testModeInput;

  const embed = new EmbedBuilder()
    .setTitle("Round Setup Wizard")
    .setColor(0x0099ff)
    .setDescription("Initializing...");

  if (testMode) {
    embed.setFooter({ text: "TEST MODE ENABLED" });
  }

  await safeReply(interaction, { embeds: [embed] });
  const message = await interaction.fetchReply();
  let logHistory = "";

  const updateEmbed = async (log?: string) => {
    if (log) {
      logHistory += `${log}\n`;
    }
    if (logHistory.length > 3500) {
      logHistory = "..." + logHistory.slice(logHistory.length - 3500);
    }
    embed.setDescription(logHistory || "Processing...");
    try {
      await interaction.editReply({ embeds: [embed] });
    } catch {
      // ignore
    }
  };

  const wizardLog = async (msg: string) => {
    await updateEmbed(`✅ ${msg}`);
  };

  const wizardPrompt = async (question: string): Promise<string | null> => {
    await updateEmbed(`\n❓ **${question}**`);

    const channel: any = interaction.channel;
    const userId = interaction.user.id;
    try {
      const collected = await channel.awaitMessages({
        filter: (m: any) => m.author.id === userId,
        max: 1,
        time: 120_000,
      });
      const first = collected.first();
      if (first) {
        const content = first.content.trim();
        await first.delete().catch(() => {});
        await updateEmbed(`> *${content}*`);
        if (/^cancel$/i.test(content)) {
          await updateEmbed("❌ Cancelled by user.");
          return null;
        }
        return content;
      }
      await updateEmbed("❌ Timed out.");
      return null;
    } catch {
      await updateEmbed("❌ Error waiting for input.");
      return null;
    }
  };

  const wizardChoice = async (
    question: string,
    options: PromptChoiceOption[],
  ): Promise<string | null> => {
    await updateEmbed(`\n❓ **${question}**`);

    const channel: any = interaction.channel;
    const userId = interaction.user.id;

    if (!channel || typeof channel.send !== "function") {
      await updateEmbed("❌ Cannot prompt for input in this channel.");
      return null;
    }

    const promptId = `wiz-choice:${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const rows = buildChoiceRows(promptId, options);
    const promptMessage: Message | null = await channel.send({
      content: `<@${userId}> ${question}`,
      components: rows,
      allowedMentions: { users: [userId] },
    }).catch(() => null);

    if (!promptMessage) {
      await updateEmbed("❌ Failed to send prompt.");
      return null;
    }

    try {
      const selection = await promptMessage.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (i) => i.user.id === userId && i.customId.startsWith(`${promptId}:`),
        time: 120_000,
      });
      await selection.deferUpdate().catch(() => {});
      const value = selection.customId.slice(promptId.length + 1);
      const chosenLabel = options.find((opt) => opt.value === value)?.label ?? value;
      await promptMessage.edit({ components: [] }).catch(() => {});
      await updateEmbed(`> *${chosenLabel}*`);
      if (value === "cancel") {
        await updateEmbed("❌ Cancelled by user.");
        return null;
      }
      return value;
    } catch {
      await promptMessage.edit({ components: [] }).catch(() => {});
      await updateEmbed("❌ Timed out waiting for a selection.");
      return null;
    }
  };

  let allActions: WizardAction[] = [];

  while (true) {
    logHistory = "";
    allActions = [];
    await updateEmbed("Starting setup...");

    let allEntries;
    try {
      allEntries = Gotm.all();
    } catch (err: any) {
      await wizardLog(`Error loading data: ${err.message}`);
      return;
    }

    const nextRound =
      allEntries.length > 0 ? Math.max(...allEntries.map((e: any) => e.round)) + 1 : 1;
    await wizardLog(`**Starting setup for Round ${nextRound}.**`);

    // 1. Month/Year
    const nextMonthDate = new Date();
    nextMonthDate.setMonth(nextMonthDate.getMonth() + 1);
    const monthYear = nextMonthDate.toLocaleString("en-US", { month: "long", year: "numeric" });
    await wizardLog(`Auto-assigned label: **${monthYear}**`);

    // 2. GOTM - simplified stub
    await wizardLog("GOTM setup (simplified stub - add games manually)");
    const gotmGames: any[] = [];

    // 3. NR-GOTM - simplified stub
    await wizardLog("NR-GOTM setup (simplified stub - add games manually)");
    const nrGotmGames: any[] = [];

    // 4. DB Actions
    allActions.push({
      description: `Insert GOTM Round ${nextRound} (${gotmGames.length} games)`,
      execute: async () => {
        if (testMode) {
          await wizardLog("[Test] Would insert GOTM round.");
          return;
        }
        if (gotmGames.length) {
          await insertGotmRoundInDatabase(nextRound, monthYear, gotmGames);
          Gotm.addRound(nextRound, monthYear, gotmGames);
        }
      },
    });

    allActions.push({
      description: `Insert NR-GOTM Round ${nextRound} (${nrGotmGames.length} games)`,
      execute: async () => {
        if (testMode) {
          await wizardLog("[Test] Would insert NR-GOTM round.");
          return;
        }
        if (nrGotmGames.length) {
          await insertNrGotmRoundInDatabase(nextRound, monthYear, nrGotmGames);
          NrGotm.addRound(nextRound, monthYear, nrGotmGames);
        }
      },
    });

    // 5. Next Vote Date
    const defaultDate = calculateNextVoteDate();
    const dateStr = formatVoteDateForDisplay(defaultDate);

    const dateChoice = await wizardChoice(
      `When should the *next* vote be? (Default: ${dateStr})`,
      addCancelOption([
        { label: "Use Default", value: "default", style: ButtonStyle.Primary },
        { label: "Enter Date", value: "date" },
      ]),
    );

    if (!dateChoice) return;

    let finalDate = defaultDate;
    if (dateChoice === "date") {
      const dateResp = await wizardPrompt("Enter the next vote date (YYYY-MM-DD).");
      if (!dateResp) return;
      const parsed = parseVoteDateInput(dateResp);
      if (parsed) {
        finalDate = parsed;
      } else {
        await wizardLog("Invalid date. Using default.");
      }
    }

    allActions.push({
      description:
        `Set next vote date to <t:${Math.floor(finalDate.getTime() / 1000)}:D> ` +
        "(America/New_York)",
      execute: async () => {
        if (testMode) {
          await wizardLog("[Test] Would set round info.");
          return;
        }
        await BotVotingInfo.setRoundInfo(nextRound, finalDate, null);
      },
    });

    // Confirmation
    const lines = allActions.map((a, i) => `${i + 1}. ${a.description}`);
    await updateEmbed(`\n**Review planned actions:**\n${lines.join("\n")}`);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("wiz-commit")
        .setLabel("Commit")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("wiz-edit")
        .setLabel("Edit (Restart)")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("wiz-cancel")
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Danger),
    );

    await interaction.editReply({ components: [row] });

    let decision = "cancel";
    try {
      const collected = await message.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (i: any) => i.user.id === interaction.user.id,
        time: 300_000,
      });
      await collected.deferUpdate();
      await interaction.editReply({ components: [] });

      if (collected.customId === "wiz-commit") decision = "commit";
      else if (collected.customId === "wiz-edit") decision = "edit";
    } catch {
      decision = "cancel";
    }

    if (decision === "cancel") {
      await wizardLog("Cancelled.");
      return;
    }
    if (decision === "commit") {
      break;
    }
  }

  // Execute Actions
  await wizardLog("\n**Executing actions...**");
  for (const action of allActions) {
    try {
      await wizardLog(`Executing: ${action.description}`);
      await action.execute();
    } catch (err: any) {
      await wizardLog(`❌ Error executing action: ${err.message}`);
      await wizardLog("Stopping execution.");
      return;
    }
  }

  await wizardLog("Setup complete! 🎉");
}
