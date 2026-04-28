import type { CommandInteraction, StringSelectMenuInteraction } from "discord.js";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  ForumChannel,
  StringSelectMenuBuilder,
  type Message,
  type MessageCreateOptions,
} from "discord.js";
import { safeReply } from "../../functions/InteractionUtils.js";
import { ADMIN_CHANNEL_ID, NOW_PLAYING_FORUM_ID } from "../../config/channels.js";
import Gotm, { insertGotmRoundInDatabase, type IGotmGame } from "../../classes/Gotm.js";
import NrGotm, { insertNrGotmRoundInDatabase, type INrGotmGame } from "../../classes/NrGotm.js";
import BotVotingInfo from "../../classes/BotVotingInfo.js";
import { calculateNextVoteDate } from "./voting-admin.service.js";
import { formatVoteDateForDisplay, parseVoteDateInput } from "../../functions/VoteDateUtils.js";
import { addCancelOption, buildChoiceRows, buildNumberChoiceOptions } from "./admin-prompt.utils.js";
import { type WizardAction, type PromptChoiceOption } from "./admin.types.js";
import {
  closeActiveAdminWizardSession,
  createDefaultNextRoundWizardState,
  getActiveAdminWizardSession,
  saveAdminWizardSession,
  type INextRoundWizardState,
} from "../../classes/AdminWizardSession.js";
import { listNominationsForRound } from "../../classes/Nomination.js";
import Game from "../../classes/Game.js";
import { getThreadsByGameId, setThreadGameLink, upsertThreadRecord } from "../../classes/Thread.js";
import { GOTM_FORUM_TAG_ID, NR_GOTM_FORUM_TAG_ID } from "../../config/tags.js";
import {
  buildNominationPreviewLine,
  mapSelectedNominationsToRoundPayloads,
  normalizeOrder,
  splitEligibleNominations,
  toNominationOptionMap,
  type WizardNominationOption,
} from "./round-setup-wizard.utils.js";

const NEXT_ROUND_SETUP_COMMAND_KEY = "nextround-setup";
const MAX_SELECT_OPTIONS = 25;

function buildPickCountOptions(max: number): PromptChoiceOption[] {
  const capped = Math.max(1, Math.min(10, max));
  return buildNumberChoiceOptions(1, capped);
}

function buildPickCountOptionsWithMin(min: number, max: number): PromptChoiceOption[] {
  const safeMin = Math.max(0, min);
  const safeMax = Math.max(safeMin, Math.min(10, max));
  return buildNumberChoiceOptions(safeMin, safeMax);
}

function buildSelectionOptions(
  options: WizardNominationOption[],
  pickedIds: number[],
): Array<{ label: string; value: string; description: string }> {
  return options
    .filter((option) => !pickedIds.includes(option.nominationId))
    .slice(0, MAX_SELECT_OPTIONS)
    .map((option) => ({
      label: option.gameTitle.slice(0, 100),
      value: String(option.nominationId),
      description: `GameDB ${option.gamedbGameId} | ${option.userIds.length} nominee(s)`,
    }));
}

function buildNominationCountPreview(
  kindLabel: "GOTM" | "NR-GOTM",
  options: WizardNominationOption[],
): string {
  const lines = options.map((option, index) => {
    const nominators = option.userIds.map((userId) => `<@${userId}>`).join(", ");
    return `${index + 1}. ${option.gameTitle} (GameDB ${option.gamedbGameId}) - ${nominators}`;
  });
  return `**${kindLabel} nomination pool (${options.length})**\n${lines.join("\n")}`;
}

async function ensureWinnerThreadLinked(params: {
  interaction: CommandInteraction;
  gameId: number;
  gameTitle: string;
  roundNumber: number;
  kindLabel: "GOTM" | "NR-GOTM";
}): Promise<string | null> {
  const existingThreads = await getThreadsByGameId(params.gameId);
  if (existingThreads.length > 0) {
    return existingThreads[0] ?? null;
  }

  const forum = (await params.interaction.guild?.channels.fetch(
    NOW_PLAYING_FORUM_ID,
  )) as ForumChannel | null;
  if (!forum) {
    throw new Error("Now Playing forum channel was not found.");
  }

  const game = await Game.getGameById(params.gameId);
  if (!game) {
    throw new Error(`GameDB game ${params.gameId} not found while creating thread.`);
  }

  const threadTitle = `${params.gameTitle} [${params.kindLabel} Round ${params.roundNumber}]`;
  const files = game.imageData
    ? [new AttachmentBuilder(game.imageData, { name: `gamedb_${params.gameId}.png` })]
    : [];
  const messagePayload: MessageCreateOptions = {
    allowedMentions: { parse: [] },
  };
  if (files.length) {
    messagePayload.files = files;
  } else {
    messagePayload.content = "Cover image unavailable for this game.";
  }

  const appliedTags =
    params.kindLabel === "GOTM" ? [GOTM_FORUM_TAG_ID] : [NR_GOTM_FORUM_TAG_ID];
  const thread = await forum.threads.create({
    name: threadTitle,
    message: messagePayload,
    appliedTags,
  });
  await upsertThreadRecord({
    threadId: thread.id,
    forumChannelId: thread.parentId ?? NOW_PLAYING_FORUM_ID,
    threadName: thread.name ?? threadTitle,
    isArchived: Boolean(thread.archived),
    createdAt: thread.createdAt ?? new Date(),
    lastSeenAt: null,
    skipLinking: "Y",
  });
  await setThreadGameLink(thread.id, params.gameId);
  return thread.id;
}

async function promptSelectNomination(
  channel: any,
  userId: string,
  promptText: string,
  options: Array<{ label: string; value: string; description: string }>,
  promptPrefix: string,
): Promise<number | null> {
  if (!options.length) {
    return null;
  }

  const selectId = `${promptPrefix}:select`;
  const cancelId = `${promptPrefix}:cancel`;
  const select = new StringSelectMenuBuilder()
    .setCustomId(selectId)
    .setPlaceholder("Choose a nomination")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);
  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(cancelId).setLabel("Cancel").setStyle(ButtonStyle.Danger),
  );

  const promptMessage: Message | null = await channel.send({
    content: `<@${userId}> ${promptText}`,
    components: [selectRow, buttonRow],
    allowedMentions: { users: [userId] },
  }).catch(() => null);
  if (!promptMessage) {
    return null;
  }

  try {
    const component = await promptMessage.awaitMessageComponent({
      componentType: ComponentType.StringSelect,
      filter: (i) => i.user.id === userId && i.customId === selectId,
      time: 180_000,
    }) as StringSelectMenuInteraction;
    const pickedValue = Number(component.values?.[0] ?? "");
    await component.deferUpdate().catch(() => {});
    await promptMessage.delete().catch(async () => {
      await promptMessage.edit({ components: [] }).catch(() => {});
    });
    if (!Number.isInteger(pickedValue) || pickedValue <= 0) {
      return null;
    }
    return pickedValue;
  } catch {
    const cancel = await promptMessage.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) => i.user.id === userId && i.customId === cancelId,
      time: 1,
    }).catch(() => null);
    if (cancel) {
      await cancel.deferUpdate().catch(() => {});
    }
    await promptMessage.delete().catch(async () => {
      await promptMessage.edit({ components: [] }).catch(() => {});
    });
    return null;
  }
}

async function promptOrderNomination(
  channel: any,
  userId: string,
  stepLabel: string,
  options: WizardNominationOption[],
  remainingIds: number[],
  promptPrefix: string,
): Promise<number | null> {
  const remainingOptions = options.filter((option) => remainingIds.includes(option.nominationId));
  const selectOptions = remainingOptions.slice(0, MAX_SELECT_OPTIONS).map((option) => ({
    label: option.gameTitle.slice(0, 100),
    value: String(option.nominationId),
    description: `GameDB ${option.gamedbGameId}`,
  }));
  return promptSelectNomination(
    channel,
    userId,
    `Pick ${stepLabel}:`,
    selectOptions,
    promptPrefix,
  );
}

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

  const channel: any = interaction.channel;
  if (!channel || typeof channel.send !== "function") {
    await safeReply(interaction, {
      content: "This command must be used in a text channel.",
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
  let wizardState: INextRoundWizardState = createDefaultNextRoundWizardState(testMode);

  const updateEmbed = async (log?: string) => {
    if (log) {
      logHistory += `${log}\n`;
    }
    if (logHistory.length > 3500) {
      logHistory = "..." + logHistory.slice(logHistory.length - 3500);
    }
    embed.setDescription(logHistory || "Processing...");
    await interaction.editReply({ embeds: [embed] }).catch(() => {});
  };

  const wizardLog = async (msg: string) => {
    await updateEmbed(`✅ ${msg}`);
  };

  const persistWizardState = async (nextState: Partial<INextRoundWizardState>) => {
    wizardState = {
      ...wizardState,
      ...nextState,
    };
    await saveAdminWizardSession({
      commandKey: NEXT_ROUND_SETUP_COMMAND_KEY,
      ownerUserId: interaction.user.id,
      channelId: interaction.channelId,
      guildId: interaction.guildId ?? null,
      state: wizardState,
    });
  };

  const closeWizardState = async (status: "completed" | "cancelled") => {
    await closeActiveAdminWizardSession({
      commandKey: NEXT_ROUND_SETUP_COMMAND_KEY,
      ownerUserId: interaction.user.id,
      channelId: interaction.channelId,
      status,
    });
  };

  const wizardChoice = async (
    question: string,
    options: PromptChoiceOption[],
  ): Promise<string | null> => {
    await updateEmbed(`\n❓ **${question}**`);
    const promptId = `nrs:${interaction.user.id}:${interaction.channelId}`;
    const rows = buildChoiceRows(promptId, options);
    const promptMessage: Message | null = await channel.send({
      content: `<@${interaction.user.id}> ${question}`,
      components: rows,
      allowedMentions: { users: [interaction.user.id] },
    }).catch(() => null);
    if (!promptMessage) {
      await updateEmbed("❌ Failed to send prompt.");
      return null;
    }
    try {
      const selection = await promptMessage.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (i) =>
          i.user.id === interaction.user.id && i.customId.startsWith(`${promptId}:`),
        time: 180_000,
      });
      await selection.deferUpdate().catch(() => {});
      const value = selection.customId.slice(promptId.length + 1);
      const chosenLabel = options.find((opt) => opt.value === value)?.label ?? value;
      await promptMessage.delete().catch(async () => {
        await promptMessage.edit({ components: [] }).catch(() => {});
      });
      await updateEmbed(`> *${chosenLabel}*`);
      if (value === "cancel") {
        await updateEmbed("❌ Cancelled by user.");
        await closeWizardState("cancelled");
        return null;
      }
      return value;
    } catch {
      await promptMessage.delete().catch(async () => {
        await promptMessage.edit({ components: [] }).catch(() => {});
      });
      await updateEmbed("❌ Timed out waiting for a selection.");
      await closeWizardState("cancelled");
      return null;
    }
  };

  const wizardPrompt = async (question: string): Promise<string | null> => {
    await updateEmbed(`\n❓ **${question}**`);
    try {
      const collected = await channel.awaitMessages({
        filter: (m: any) => m.author.id === interaction.user.id,
        max: 1,
        time: 180_000,
      });
      const first = collected.first();
      if (!first) {
        await updateEmbed("❌ Timed out.");
        await closeWizardState("cancelled");
        return null;
      }
      const content = first.content.trim();
      await first.delete().catch(() => {});
      await updateEmbed(`> *${content}*`);
      if (/^cancel$/i.test(content)) {
        await updateEmbed("❌ Cancelled by user.");
        await closeWizardState("cancelled");
        return null;
      }
      return content;
    } catch {
      await updateEmbed("❌ Error waiting for input.");
      await closeWizardState("cancelled");
      return null;
    }
  };

  const activeSession = await getActiveAdminWizardSession(
    NEXT_ROUND_SETUP_COMMAND_KEY,
    interaction.user.id,
    interaction.channelId,
  );
  if (activeSession) {
    wizardState = {
      ...activeSession.state,
      testMode,
    };
    await wizardLog(
      `Found unfinished setup from <t:${Math.floor(activeSession.lastUpdatedAt.getTime() / 1000)}:R>.`,
    );
    const resumeChoice = await wizardChoice(
      "Resume previous setup state?",
      addCancelOption([
        { label: "Resume", value: "resume", style: ButtonStyle.Primary },
        { label: "Discard and Restart", value: "restart" },
      ]),
    );
    if (!resumeChoice) {
      return;
    }
    if (resumeChoice === "restart") {
      await closeWizardState("cancelled");
      wizardState = createDefaultNextRoundWizardState(testMode);
      await wizardLog("Previous setup discarded. Starting a fresh setup.");
    } else {
      await wizardLog(`Resuming at step: **${wizardState.step}**`);
    }
  }
  await persistWizardState(wizardState);

  let allEntries;
  try {
    allEntries = Gotm.all();
  } catch (err: any) {
    await wizardLog(`Error loading data: ${err?.message ?? String(err)}`);
    return;
  }
  const computedNextRound =
    allEntries.length > 0 ? Math.max(...allEntries.map((e: any) => e.round)) + 1 : 1;
  let nextRound = computedNextRound;

  if (testMode) {
    const roundChoice = await wizardChoice(
      `Test mode: which round's nomination data should be used? (Default: ${computedNextRound})`,
      addCancelOption([
        { label: `Use ${computedNextRound}`, value: "default", style: ButtonStyle.Primary },
        { label: "Enter Round", value: "custom" },
      ]),
    );
    if (!roundChoice) return;
    if (roundChoice === "custom") {
      const roundInput = await wizardPrompt("Enter the round number to load nominations from.");
      if (!roundInput) return;
      const parsedRound = Number(roundInput.trim());
      if (!Number.isInteger(parsedRound) || parsedRound <= 0) {
        await wizardLog("Invalid round number. Cancelling.");
        await closeWizardState("cancelled");
        return;
      }
      nextRound = parsedRound;
    }
  }

  await persistWizardState({ roundNumber: nextRound, step: "start" });
  await wizardLog(
    `**Starting setup for Round ${nextRound}.**` +
    (testMode ? " (Test mode data source)" : ""),
  );

  if (!testMode && (Gotm.getByRound(nextRound).length > 0 || NrGotm.getByRound(nextRound).length > 0)) {
    await wizardLog(
      `Round ${nextRound} already exists in GOTM and/or NR-GOTM data. ` +
      "Use edit commands or choose another round.",
    );
    await closeWizardState("cancelled");
    return;
  }

  const nextMonthDate = new Date();
  nextMonthDate.setMonth(nextMonthDate.getMonth() + 1);
  const monthYear = nextMonthDate.toLocaleString("en-US", { month: "long", year: "numeric" });
  await persistWizardState({ monthYear });
  await wizardLog(`Auto-assigned label: **${monthYear}**`);

  const gotmNominations = await listNominationsForRound("gotm", nextRound);
  const nrNominations = await listNominationsForRound("nr-gotm", nextRound);
  const gotmSplit = splitEligibleNominations(gotmNominations);
  const nrSplit = splitEligibleNominations(nrNominations);
  const gotmOptions = [...toNominationOptionMap(gotmSplit.eligible).values()];
  const nrOptions = [...toNominationOptionMap(nrSplit.eligible).values()];

  if (gotmSplit.ineligible.length > 0 || nrSplit.ineligible.length > 0) {
    await wizardLog(
      `Filtered ineligible nominations. ` +
      `GOTM removed: ${gotmSplit.ineligible.length}, NR-GOTM removed: ${nrSplit.ineligible.length}.`,
    );
  }

  if (!gotmOptions.length) {
    await wizardLog(
      `No eligible GOTM nominations for Round ${nextRound}. ` +
      `Eligible GOTM: ${gotmOptions.length}, eligible NR-GOTM: ${nrOptions.length}. ` +
      "Run /nominate to add or fix nominations, then rerun /admin nextround-setup.",
    );
    await closeWizardState("cancelled");
    return;
  }

  if (!nrOptions.length) {
    await wizardLog("No eligible NR-GOTM nominations found. Continuing with 0 NR-GOTM picks.");
  }

  let gotmGames: IGotmGame[] = [];
  let nrGotmGames: INrGotmGame[] = [];
  let finalDate = calculateNextVoteDate();
  let allActions: WizardAction[] = [];

  while (true) {
    await persistWizardState({ step: "gotm-count" });
    let gotmPickCount = wizardState.gotmPickCount ?? null;
    if (!gotmPickCount || gotmPickCount > gotmOptions.length) {
      await updateEmbed(buildNominationCountPreview("GOTM", gotmOptions));
      const gotmCountChoice = await wizardChoice(
        `How many GOTM winners? (${gotmOptions.length} eligible)`,
        addCancelOption(buildPickCountOptions(gotmOptions.length)),
      );
      if (!gotmCountChoice) return;
      gotmPickCount = Number(gotmCountChoice);
      await persistWizardState({
        selectedGotmNominationIds: [],
        selectedGotmOrder: [],
      });
    }
    if (!Number.isInteger(gotmPickCount) || gotmPickCount <= 0) {
      await wizardLog("Invalid GOTM pick count.");
      await closeWizardState("cancelled");
      return;
    }
    await persistWizardState({ gotmPickCount });

    await persistWizardState({ step: "gotm-select" });
    const selectedGotmIds = wizardState.selectedGotmNominationIds
      .filter((id) => gotmOptions.some((opt) => opt.nominationId === id))
      .slice(0, gotmPickCount);
    if (gotmPickCount === gotmOptions.length && selectedGotmIds.length === 0) {
      selectedGotmIds.push(...gotmOptions.map((opt) => opt.nominationId));
      await persistWizardState({ selectedGotmNominationIds: selectedGotmIds });
      await wizardLog("GOTM nominations equal winner count. Auto-selected all GOTM nominations.");
    }
    while (selectedGotmIds.length < gotmPickCount) {
      const options = buildSelectionOptions(gotmOptions, selectedGotmIds);
      if (!options.length) {
        await wizardLog("Not enough GOTM nominations to satisfy pick count.");
        await closeWizardState("cancelled");
        return;
      }
      const pickedId = await promptSelectNomination(
        channel,
        interaction.user.id,
        `Pick GOTM winner #${selectedGotmIds.length + 1}`,
        options,
        `nrs:gotm:${selectedGotmIds.length + 1}`,
      );
      if (!pickedId) {
        await wizardLog("Cancelled during GOTM selection.");
        await closeWizardState("cancelled");
        return;
      }
      selectedGotmIds.push(pickedId);
      await persistWizardState({ selectedGotmNominationIds: selectedGotmIds });
    }

    await persistWizardState({ step: "gotm-order" });
    const gotmOrder = normalizeOrder(selectedGotmIds, wizardState.selectedGotmOrder);
    if (selectedGotmIds.length === gotmPickCount && gotmPickCount === gotmOptions.length) {
      gotmOrder.length = 0;
      gotmOrder.push(...selectedGotmIds);
      await persistWizardState({ selectedGotmOrder: gotmOrder });
      await wizardLog("GOTM order auto-set from nomination list.");
    }
    while (gotmOrder.length < selectedGotmIds.length) {
      const remaining = selectedGotmIds.filter((id) => !gotmOrder.includes(id));
      const pickedId = await promptOrderNomination(
        channel,
        interaction.user.id,
        `GOTM order slot #${gotmOrder.length + 1}`,
        gotmOptions,
        remaining,
        `nrs:gotm:order:${gotmOrder.length + 1}`,
      );
      if (!pickedId) {
        await wizardLog("Cancelled during GOTM ordering.");
        await closeWizardState("cancelled");
        return;
      }
      gotmOrder.push(pickedId);
      await persistWizardState({ selectedGotmOrder: gotmOrder });
    }

    await persistWizardState({ step: "nr-count" });
    let nrPickCount = wizardState.nrPickCount ?? null;
    if (!nrPickCount || nrPickCount > nrOptions.length) {
      await updateEmbed(buildNominationCountPreview("NR-GOTM", nrOptions));
      const nrCountChoice = await wizardChoice(
        `How many NR-GOTM winners? (${nrOptions.length} eligible, 0 allowed)`,
        addCancelOption(buildPickCountOptionsWithMin(0, nrOptions.length)),
      );
      if (!nrCountChoice) return;
      nrPickCount = Number(nrCountChoice);
      await persistWizardState({
        selectedNrGotmNominationIds: [],
        selectedNrGotmOrder: [],
      });
    }
    if (!Number.isInteger(nrPickCount) || nrPickCount < 0) {
      await wizardLog("Invalid NR-GOTM pick count.");
      await closeWizardState("cancelled");
      return;
    }
    await persistWizardState({ nrPickCount });

    await persistWizardState({ step: "nr-select" });
    const selectedNrIds = wizardState.selectedNrGotmNominationIds
      .filter((id) => nrOptions.some((opt) => opt.nominationId === id))
      .slice(0, nrPickCount);
    if (
      nrPickCount > 0 &&
      nrPickCount === nrOptions.length &&
      selectedNrIds.length === 0
    ) {
      selectedNrIds.push(...nrOptions.map((opt) => opt.nominationId));
      await persistWizardState({ selectedNrGotmNominationIds: selectedNrIds });
      await wizardLog("NR-GOTM nominations equal winner count. Auto-selected all NR-GOTM nominations.");
    }
    while (selectedNrIds.length < nrPickCount) {
      const options = buildSelectionOptions(nrOptions, selectedNrIds);
      if (!options.length) {
        await wizardLog("Not enough NR-GOTM nominations to satisfy pick count.");
        await closeWizardState("cancelled");
        return;
      }
      const pickedId = await promptSelectNomination(
        channel,
        interaction.user.id,
        `Pick NR-GOTM winner #${selectedNrIds.length + 1}`,
        options,
        `nrs:nr:${selectedNrIds.length + 1}`,
      );
      if (!pickedId) {
        await wizardLog("Cancelled during NR-GOTM selection.");
        await closeWizardState("cancelled");
        return;
      }
      selectedNrIds.push(pickedId);
      await persistWizardState({ selectedNrGotmNominationIds: selectedNrIds });
    }

    await persistWizardState({ step: "nr-order" });
    const nrOrder = normalizeOrder(selectedNrIds, wizardState.selectedNrGotmOrder);
    if (
      nrPickCount > 0 &&
      selectedNrIds.length === nrPickCount &&
      nrPickCount === nrOptions.length
    ) {
      nrOrder.length = 0;
      nrOrder.push(...selectedNrIds);
      await persistWizardState({ selectedNrGotmOrder: nrOrder });
      await wizardLog("NR-GOTM order auto-set from nomination list.");
    }
    while (nrOrder.length < selectedNrIds.length) {
      const remaining = selectedNrIds.filter((id) => !nrOrder.includes(id));
      const pickedId = await promptOrderNomination(
        channel,
        interaction.user.id,
        `NR-GOTM order slot #${nrOrder.length + 1}`,
        nrOptions,
        remaining,
        `nrs:nr:order:${nrOrder.length + 1}`,
      );
      if (!pickedId) {
        await wizardLog("Cancelled during NR-GOTM ordering.");
        await closeWizardState("cancelled");
        return;
      }
      nrOrder.push(pickedId);
      await persistWizardState({ selectedNrGotmOrder: nrOrder });
    }

    const gotmById = new Map(gotmOptions.map((opt) => [opt.nominationId, opt] as const));
    const nrById = new Map(nrOptions.map((opt) => [opt.nominationId, opt] as const));
    const gotmOrderedOptions = gotmOrder
      .map((id) => gotmById.get(id))
      .filter(Boolean) as WizardNominationOption[];
    const nrOrderedOptions = nrOrder
      .map((id) => nrById.get(id))
      .filter(Boolean) as WizardNominationOption[];

    await wizardLog("GOTM preview:");
    for (const [index, option] of gotmOrderedOptions.entries()) {
      await updateEmbed(buildNominationPreviewLine(index, option));
    }
    await wizardLog("NR-GOTM preview:");
    for (const [index, option] of nrOrderedOptions.entries()) {
      await updateEmbed(buildNominationPreviewLine(index, option));
    }

    await persistWizardState({ step: "date-choice" });
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

    finalDate = defaultDate;
    if (dateChoice === "date") {
      await persistWizardState({ step: "date-input" });
      const dateResp = await wizardPrompt("Enter the next vote date (YYYY-MM-DD).");
      if (!dateResp) return;
      const parsed = parseVoteDateInput(dateResp);
      if (parsed) {
        finalDate = parsed;
      } else {
        await wizardLog("Invalid date. Using default.");
      }
    }

    try {
      const mapped = await mapSelectedNominationsToRoundPayloads({
        gotmOrder,
        nrOrder,
        gotmOptionsByNominationId: gotmById,
        nrOptionsByNominationId: nrById,
        enforceCrossCategoryCollision: true,
      });
      gotmGames = mapped.gotmGames;
      nrGotmGames = mapped.nrGotmGames;
    } catch (err: any) {
      await wizardLog(`Mapping validation failed: ${err?.message ?? String(err)}`);
      await closeWizardState("cancelled");
      return;
    }

    allActions = [
    {
      description: `Insert GOTM Round ${nextRound} (${gotmGames.length} games)`,
      execute: async () => {
        if (testMode) {
          await wizardLog("[Test] Would insert GOTM round.");
          return;
        }
        for (const game of gotmGames) {
          const threadId = await ensureWinnerThreadLinked({
            interaction,
            gameId: game.gamedbGameId,
            gameTitle: game.title,
            roundNumber: nextRound,
            kindLabel: "GOTM",
          });
          if (threadId) {
            await wizardLog(`Linked GOTM thread <#${threadId}> for "${game.title}".`);
          }
        }
        await insertGotmRoundInDatabase(nextRound, monthYear, gotmGames);
        Gotm.addRound(nextRound, monthYear, gotmGames);
      },
    },
    {
      description: `Insert NR-GOTM Round ${nextRound} (${nrGotmGames.length} games)`,
      execute: async () => {
        if (testMode) {
          await wizardLog("[Test] Would insert NR-GOTM round.");
          return;
        }
        if (!nrGotmGames.length) {
          await wizardLog("Skipping NR-GOTM insert (0 games selected).");
          return;
        }
        for (const game of nrGotmGames) {
          const threadId = await ensureWinnerThreadLinked({
            interaction,
            gameId: game.gamedbGameId,
            gameTitle: game.title,
            roundNumber: nextRound,
            kindLabel: "NR-GOTM",
          });
          if (threadId) {
            await wizardLog(`Linked NR-GOTM thread <#${threadId}> for "${game.title}".`);
          }
        }
        const insertedIds = await insertNrGotmRoundInDatabase(nextRound, monthYear, nrGotmGames);
        const withIds = nrGotmGames.map((entry, index) => ({ ...entry, id: insertedIds[index] ?? null }));
        NrGotm.addRound(nextRound, monthYear, withIds);
      },
    },
    {
      description:
        `Set next vote date to <t:${Math.floor(finalDate.getTime() / 1000)}:D> (America/New_York)`,
      execute: async () => {
        if (testMode) {
          await wizardLog("[Test] Would set round info.");
          return;
        }
        await BotVotingInfo.setRoundInfo(nextRound, finalDate, null);
      },
    },
    ];

    await persistWizardState({
      step: "review",
      chosenVoteDateIso: finalDate.toISOString(),
    });

    const gotmSummary = gotmGames
      .map((game, index) => `${index + 1}. ${game.title} (GameDB ${game.gamedbGameId})`)
      .join("\n");
    const nrSummary = nrGotmGames
      .map((game, index) => `${index + 1}. ${game.title} (GameDB ${game.gamedbGameId})`)
      .join("\n");
    const actionLines = allActions.map((action, index) => `${index + 1}. ${action.description}`).join("\n");
    await updateEmbed(
      `\n**Summary**\n` +
      `Month label: **${monthYear}**\n` +
      `Next vote date: <t:${Math.floor(finalDate.getTime() / 1000)}:D>\n` +
      `Test mode: **${testMode ? "ON" : "OFF"}**\n\n` +
      `**Selected GOTM**\n${gotmSummary}\n\n` +
      `**Selected NR-GOTM**\n${nrSummary}\n\n` +
      `**DB Actions**\n${actionLines}`,
    );

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("wiz-commit").setLabel("Commit").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("wiz-edit").setLabel("Edit").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("wiz-cancel").setLabel("Cancel").setStyle(ButtonStyle.Danger),
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
      await closeWizardState("cancelled");
      return;
    }
    if (decision === "edit") {
      const editTarget = await wizardChoice(
        "Which step do you want to edit?",
        addCancelOption([
          { label: "GOTM Count", value: "gotm-count" },
          { label: "GOTM Picks", value: "gotm-select" },
          { label: "GOTM Order", value: "gotm-order" },
          { label: "NR Count", value: "nr-count" },
          { label: "NR Picks", value: "nr-select" },
          { label: "NR Order", value: "nr-order" },
          { label: "Vote Date", value: "date-choice" },
        ]),
      );
      if (!editTarget) return;
      if (editTarget === "gotm-count") {
        await persistWizardState({
          step: "gotm-count",
          gotmPickCount: null,
          selectedGotmNominationIds: [],
          selectedGotmOrder: [],
        });
      } else if (editTarget === "gotm-select") {
        await persistWizardState({
          step: "gotm-select",
          selectedGotmNominationIds: [],
          selectedGotmOrder: [],
        });
      } else if (editTarget === "gotm-order") {
        await persistWizardState({
          step: "gotm-order",
          selectedGotmOrder: [],
        });
      } else if (editTarget === "nr-count") {
        await persistWizardState({
          step: "nr-count",
          nrPickCount: null,
          selectedNrGotmNominationIds: [],
          selectedNrGotmOrder: [],
        });
      } else if (editTarget === "nr-select") {
        await persistWizardState({
          step: "nr-select",
          selectedNrGotmNominationIds: [],
          selectedNrGotmOrder: [],
        });
      } else if (editTarget === "nr-order") {
        await persistWizardState({
          step: "nr-order",
          selectedNrGotmOrder: [],
        });
      } else if (editTarget === "date-choice") {
        await persistWizardState({
          step: "date-choice",
          chosenVoteDateIso: null,
        });
      }
      await wizardLog(`Edit requested. Jumping to **${editTarget}**.`);
      continue;
    }

    break;
  }

  await persistWizardState({ step: "commit" });
  await wizardLog("\n**Executing actions...**");
  for (const action of allActions) {
    try {
      await wizardLog(`Executing: ${action.description}`);
      await action.execute();
    } catch (err: any) {
      await wizardLog(`❌ Error executing action: ${err?.message ?? String(err)}`);
      await wizardLog("Stopping execution.");
      await closeWizardState("cancelled");
      return;
    }
  }

  await wizardLog("Setup complete!");
  await closeWizardState("completed");
}
