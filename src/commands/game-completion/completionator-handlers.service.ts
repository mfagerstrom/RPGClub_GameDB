import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import { MessageFlags } from "discord.js";
import Member from "../../classes/Member.js";
import Game from "../../classes/Game.js";
import type { CompletionatorModalKind, CompletionatorDateChoice } from "./completion.types.js";
import { completionatorAddFormStates, completionatorThreadContexts } from "./completion.types.js";
import {
  getCompletionatorThreadKey,
  getCompletionatorFormKey,
  parseCompletionatorChooseId,
} from "./completion-helpers.js";
import {  getImportById,
  updateImportItem,
  getImportItemById,
  setImportStatus,
} from "../../classes/CompletionatorImport.js";
import { CompletionatorWorkflowService } from "./completionator-workflow.service.js";
import { CompletionatorUiService } from "./completionator-ui.service.js";
import { COMPLETION_TYPES } from "../profile.command.js";
import { STANDARD_PLATFORM_IDS } from "../../config/standardPlatforms.js";
import { COMPLETIONATOR_SKIP_SENTINEL } from "./completion.types.js";
import { parseCompletionDateInput } from "../profile.command.js";
import { buildComponentsV2Flags } from "../../functions/NominationListComponents.js";
import { searchGameDbWithFallback, importGameFromIgdb } from "./completionator-parser.service.js";


export class CompletionatorHandlersService {
  private workflowService: CompletionatorWorkflowService;
  private uiService: CompletionatorUiService;

  constructor() {
    this.workflowService = new CompletionatorWorkflowService();
    this.uiService = new CompletionatorUiService();
  }

  async handleCompletionatorSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, ownerId, importIdRaw, itemIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This import prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const ephemeral = this.uiService.isInteractionEphemeral(interaction);
    const importId = Number(importIdRaw);
    const itemId = Number(itemIdRaw);
    if (!Number.isInteger(importId) || !Number.isInteger(itemId)) {
      await interaction.reply({
        content: "Invalid import selection.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const session = await getImportById(importId);
    if (!session) {
      await interaction.reply({
        content: "Import session not found.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }
    const context = completionatorThreadContexts.get(
      getCompletionatorThreadKey(interaction.user.id, session.importId),
    );

    const choice = interaction.values?.[0];
    if (!choice) {
      await interaction.reply({
        content: "No selection received.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    if (choice === COMPLETIONATOR_SKIP_SENTINEL) {
      await updateImportItem(itemId, { status: "SKIPPED" });
      await this.workflowService.processNextCompletionatorItem(interaction, session);
      return;
    }

    if (choice === "import-igdb") {
      const item = await getImportItemById(itemId);
      if (!item) {
        await interaction.reply({
          content: "Import item not found.",
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
        return;
      }

      await this.workflowService.promptCompletionatorIgdbSelection(interaction, session, item);
      return;
    }

    const gameId = Number(choice);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      await interaction.reply({
        content: "Invalid game selection.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const item = await getImportItemById(itemId);
    if (!item) {
      await interaction.reply({
        content: "Import item not found.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    await this.uiService.respondToImportInteraction(
      interaction,
      {
        components: this.uiService.buildCompletionatorWorkingComponents(),
      },
      ephemeral,
      context,
    );
    await this.workflowService.handleCompletionatorMatch(
      interaction,
      session,
      item,
      gameId,
      this.uiService.isInteractionEphemeral(interaction),
    );
  }

  async handleCompletionatorChoose(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseCompletionatorChooseId(interaction.customId);
    if (!parsed) {
      await interaction.reply({
        content: "Invalid completionator selection.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.user.id !== parsed.ownerId) {
      await interaction.reply({
        content: "This import prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferUpdate().catch(() => {});

    const session = await getImportById(parsed.importId);
    if (!session) {
      await interaction.followUp({
        content: "Import session not found.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const item = await getImportItemById(parsed.itemId);
    if (!item) {
      await interaction.followUp({
        content: "Import item not found.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const context = completionatorThreadContexts.get(
      getCompletionatorThreadKey(parsed.ownerId, parsed.importId),
    );
    await this.uiService.respondToImportInteraction(
      interaction,
      {
        components: this.uiService.buildCompletionatorWorkingComponents(),
      },
      this.uiService.isInteractionEphemeral(interaction),
      context,
    );
    await this.workflowService.handleCompletionatorMatch(
      interaction,
      session,
      item,
      parsed.gameId,
      this.uiService.isInteractionEphemeral(interaction),
    );
  }

  async handleCompletionatorUpdateFields(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, ownerId, importIdRaw, itemIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This import prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const ephemeral = this.uiService.isInteractionEphemeral(interaction);
    const importId = Number(importIdRaw);
    const itemId = Number(itemIdRaw);
    if (!Number.isInteger(importId) || !Number.isInteger(itemId)) {
      await interaction.reply({
        content: "Invalid import selection.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const session = await getImportById(importId);
    if (!session) {
      await interaction.reply({
        content: "Import session not found.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const item = await getImportItemById(itemId);
    if (!item || !item.completionId) {
      await interaction.reply({
        content: "Import item not found.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const existing = await Member.getCompletion(item.completionId);
    if (!existing) {
      await interaction.reply({
        content: "Completion not found.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const updates = this.workflowService.buildCompletionUpdate(existing, item);
    if (!updates) {
      await updateImportItem(item.itemId, { status: "SKIPPED" });
      await this.workflowService.processNextCompletionatorItem(interaction, session, {
        ephemeral,
      });
      return;
    }

    const selected = new Set(interaction.values ?? []);
    const filtered: Partial<{
      completionType: string;
      completedAt: Date | null;
      finalPlaytimeHours: number | null;
    }> = {};

    if (selected.has("type") && updates.completionType !== undefined) {
      filtered.completionType = updates.completionType;
    }
    if (selected.has("date") && updates.completedAt !== undefined) {
      filtered.completedAt = updates.completedAt;
    }
    if (selected.has("playtime") && updates.finalPlaytimeHours !== undefined) {
      filtered.finalPlaytimeHours = updates.finalPlaytimeHours;
    }

    if (!Object.keys(filtered).length) {
      await updateImportItem(item.itemId, { status: "SKIPPED" });
      await this.workflowService.processNextCompletionatorItem(interaction, session, {
        ephemeral,
      });
      return;
    }

    await Member.updateCompletion(interaction.user.id, existing.completionId, filtered);
    await updateImportItem(item.itemId, {
      status: "UPDATED",
      gameDbGameId: item.gameDbGameId,
      completionId: existing.completionId,
    });
    await this.workflowService.processNextCompletionatorItem(interaction, session, { ephemeral });
  }

  async handleCompletionatorAction(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, importIdRaw, itemIdRaw, action] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This import prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const ephemeral = this.uiService.isInteractionEphemeral(interaction);
    const importId = Number(importIdRaw);
    const itemId = Number(itemIdRaw);
    if (!Number.isInteger(importId) || !Number.isInteger(itemId)) {
      await interaction.reply({
        content: "Invalid import action.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const session = await getImportById(importId);
    if (!session) {
      await interaction.reply({
        content: "Import session not found.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const item = await getImportItemById(itemId);
    if (!item) {
      await interaction.reply({
        content: "Import item not found.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    if (action === "add") {
      if (!item.gameDbGameId) {
        await interaction.reply({
          content: "Import item data is missing. Please resume the import.",
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
        return;
      }

      const state = this.workflowService.getOrCreateCompletionatorAddFormState(
        session,
        item,
        item.gameDbGameId,
        interaction.user.id,
      );
      if (!state.platformId && !state.otherPlatform) {
        await this.workflowService.renderCompletionatorAddForm(
          interaction,
          session,
          item,
          item.gameDbGameId,
          this.uiService.isInteractionEphemeral(interaction),
          undefined,
          "Select a platform before adding this completion.",
        );
        return;
      }
      if (state.dateChoice === "date" && !state.customDate) {
        const modal = this.uiService.createDateModal(
          interaction.user.id,
          session.importId,
          item.itemId,
        );
        await interaction.showModal(modal);
        return;
      }
      if (state.dateChoice === "csv" && !item.completedAt) {
        await this.workflowService.renderCompletionatorAddForm(
          interaction,
          session,
          item,
          item.gameDbGameId,
          this.uiService.isInteractionEphemeral(interaction),
          undefined,
          "The CSV date is missing. Choose another date option.",
        );
        return;
      }

      const context = completionatorThreadContexts.get(
        getCompletionatorThreadKey(interaction.user.id, session.importId),
      );
      await this.uiService.respondToImportInteraction(
        interaction,
        {
          components: this.uiService.buildCompletionatorWorkingComponents(),
        },
        this.uiService.isInteractionEphemeral(interaction),
        context,
      );
      await this.workflowService.addCompletionFromImport(interaction, session, item, state);
      await this.workflowService.processNextCompletionatorItem(interaction, session);
      return;
    }

    if (action === "same-yes") {
      if (!item.completionId) {
        await interaction.reply({
          content: "Import item data is missing. Please resume the import.",
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
        return;
      }

      const existing = await Member.getCompletion(item.completionId);
      if (!existing) {
        await interaction.reply({
          content: "Completion not found.",
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
        return;
      }

      const updates = this.workflowService.buildCompletionUpdate(existing, item);
      if (!updates) {
        await updateImportItem(item.itemId, { status: "SKIPPED" });
        await this.workflowService.processNextCompletionatorItem(interaction, session, {
          ephemeral,
        });
        return;
      }

      await this.workflowService.renderCompletionatorUpdateSelection(
        interaction,
        session,
        item,
        existing,
        ephemeral,
      );
      return;
    }

    if (action === "same-no") {
      if (!item.gameDbGameId) {
        await interaction.reply({
          content: "Import item data is missing. Please resume the import.",
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
        return;
      }

      await this.workflowService.renderCompletionatorAddForm(
        interaction,
        session,
        item,
        item.gameDbGameId,
        this.uiService.isInteractionEphemeral(interaction),
      );
      return;
    }

    if (action === "igdb") {
      await this.workflowService.promptCompletionatorIgdbSelection(
        interaction,
        session,
        item,
        item.gameTitle,
      );
      return;
    }

    if (action === "igdb-query") {
      const modal = this.uiService.createInputModal(
        "igdb-query",
        "IGDB Search",
        "IGDB search string",
        "Search IGDB",
        interaction.user.id,
        session.importId,
        item.itemId,
      );
      await interaction.showModal(modal);
      return;
    }

    if (action === "igdb-manual") {
      const modal = this.uiService.createInputModal(
        "igdb-manual",
        "IGDB ID",
        `IGDB id for "${item.gameTitle}"`,
        "",
        interaction.user.id,
        session.importId,
        item.itemId,
        item.gameTitle,
      );
      await interaction.showModal(modal);
      return;
    }

    if (action === "query") {
      const modal = this.uiService.createInputModal(
        "gamedb-query",
        "GameDB Search",
        `GameDB search string for "${item.gameTitle}"`,
        item.gameTitle,
        interaction.user.id,
        session.importId,
        item.itemId,
        item.gameTitle,
      );
      await interaction.showModal(modal);
      return;
    }

    if (action === "manual") {
      const modal = this.uiService.createInputModal(
        "gamedb-manual",
        "GameDB ID",
        `GameDB id for "${item.gameTitle}"`,
        "",
        interaction.user.id,
        session.importId,
        item.itemId,
        item.gameTitle,
      );
      await interaction.showModal(modal);
      return;
    }

    if (action === "pause") {
      await this.pauseCompletionatorImport(interaction, session);
      return;
    }

    if (action === "skip") {
      completionatorAddFormStates.delete(getCompletionatorFormKey(importId, itemId));
      await updateImportItem(itemId, { status: "SKIPPED" });
      await this.workflowService.processNextCompletionatorItem(interaction, session);
      return;
    }

    if (action === "update") {
      if (!item.gameDbGameId || !item.completionId) {
        await interaction.reply({
          content: "Import item data is missing. Please resume the import.",
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
        return;
      }

      const existing = await Member.getCompletion(item.completionId);
      if (!existing) {
        await interaction.reply({
          content: "Completion not found.",
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
        return;
      }

      const updates = this.workflowService.buildCompletionUpdate(existing, item);
      if (!updates) {
        await updateImportItem(item.itemId, { status: "SKIPPED" });
        await this.workflowService.processNextCompletionatorItem(interaction, session);
        return;
      }

      await Member.updateCompletion(interaction.user.id, existing.completionId, updates);
      await updateImportItem(item.itemId, {
        status: "UPDATED",
        gameDbGameId: item.gameDbGameId,
        completionId: existing.completionId,
      });
      await this.workflowService.processNextCompletionatorItem(interaction, session);
    }
  }

  async handleCompletionatorFormSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, ownerId, importIdRaw, itemIdRaw, field] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This import prompt is not for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const importId = Number(importIdRaw);
    const itemId = Number(itemIdRaw);
    if (!Number.isInteger(importId) || !Number.isInteger(itemId)) {
      await interaction.reply({
        content: "Invalid import selection.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const session = await getImportById(importId);
    if (!session) {
      await interaction.reply({
        content: "Import session not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const item = await getImportItemById(itemId);
    if (!item || !item.gameDbGameId) {
      await interaction.reply({
        content: "Import item data is missing. Please resume the import.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const value = interaction.values?.[0];
    if (!value) {
      await interaction.reply({
        content: "No selection received.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const state = this.workflowService.getOrCreateCompletionatorAddFormState(
      session,
      item,
      item.gameDbGameId,
      interaction.user.id,
    );

    if (field === "type") {
      const normalized = COMPLETION_TYPES.find((t) => t === value);
      if (!normalized) {
        await interaction.reply({
          content: "Invalid completion type selected.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      state.completionType = normalized;
    } else if (field === "date") {
      const choice = value as CompletionatorDateChoice;
      if (!["csv", "today", "unknown", "date"].includes(choice)) {
        await interaction.reply({
          content: "Invalid date option selected.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      state.dateChoice = choice;
      if (choice !== "date") {
        state.customDate = null;
      }
      if (choice === "date") {
        const modal = this.uiService.createDateModal(
          interaction.user.id,
          session.importId,
          item.itemId,
        );
        await interaction.showModal(modal);
        return;
      }
    } else if (field === "platform") {
      if (value === "other") {
        state.otherPlatform = true;
        state.platformId = null;
      } else {
        const platformId = Number(value);
        const platforms = await Game.getPlatformsForGameWithStandard(
          item.gameDbGameId,
          STANDARD_PLATFORM_IDS,
        );
        const platformIds = new Set(platforms.map((platform) => platform.id));
        if (!Number.isInteger(platformId) || !platformIds.has(platformId)) {
          await interaction.reply({
            content: "Invalid platform selected.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        state.platformId = platformId;
        state.otherPlatform = false;
      }
    }

    await interaction.deferUpdate().catch(() => {});
    const context = completionatorThreadContexts.get(
      getCompletionatorThreadKey(ownerId, session.importId),
    );
    await this.workflowService.renderCompletionatorAddForm(
      interaction,
      session,
      item,
      item.gameDbGameId,
      this.uiService.isInteractionEphemeral(interaction),
      context,
    );
  }

  async handleCompletionatorDateModal(interaction: ModalSubmitInteraction): Promise<void> {
    const [, ownerId, importIdRaw, itemIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This import prompt is not for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const importId = Number(importIdRaw);
    const itemId = Number(itemIdRaw);
    if (!Number.isInteger(importId) || !Number.isInteger(itemId)) {
      await interaction.reply({
        content: "Invalid import selection.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const session = await getImportById(importId);
    if (!session) {
      await interaction.reply({
        content: "Import session not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const item = await getImportItemById(itemId);
    if (!item || !item.gameDbGameId) {
      await interaction.reply({
        content: "Import item data is missing. Please resume the import.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const rawValue = interaction.fields.getTextInputValue("completion-date")?.trim();
    let parsedDate: Date | null = null;
    try {
      parsedDate = parseCompletionDateInput(rawValue);
    } catch (err: any) {
      await interaction.reply({
        content: err?.message ?? "Invalid completion date.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!parsedDate) {
      await interaction.reply({
        content: "Completion date is required.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const state = this.workflowService.getOrCreateCompletionatorAddFormState(
      session,
      item,
      item.gameDbGameId,
      interaction.user.id,
    );
    state.customDate = parsedDate;
    state.dateChoice = "date";

    const key = getCompletionatorThreadKey(ownerId, session.importId);
    const context = completionatorThreadContexts.get(key);
    const payload = await this.workflowService.buildCompletionatorAddFormPayload(
      session,
      item,
      item.gameDbGameId,
      ownerId,
    );
    if (context?.message) {
      await context.message
        .edit({
          components: payload.components,
          files: payload.files,
          flags: buildComponentsV2Flags(false),
        })
        .catch(() => {});
    }

    await interaction.reply({
      content: "Completion date saved.",
      flags: MessageFlags.Ephemeral,
    });
  }

  async handleCompletionatorInputModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const kind = parts[1] as CompletionatorModalKind;
    const ownerId = parts[2];
    const importId = Number(parts[3]);
    const itemId = Number(parts[4]);

    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This import prompt is not for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!Number.isInteger(importId) || !Number.isInteger(itemId)) {
      await interaction.reply({
        content: "Invalid import request.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const session = await getImportById(importId);
    if (!session) {
      await interaction.reply({
        content: "Import session not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const item = await getImportItemById(itemId);
    if (!item) {
      await interaction.reply({
        content: "Import item not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const rawValue = interaction.fields.getTextInputValue("completionator-input")?.trim();
    if (!rawValue) {
      await interaction.reply({
        content: "Input is required.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const context = completionatorThreadContexts.get(
      getCompletionatorThreadKey(ownerId, session.importId),
    );
    const shouldDeferForContext = Boolean(context?.message);
    if (shouldDeferForContext) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }
    const cleanupDeferredReply = async (): Promise<void> => {
      if (shouldDeferForContext) {
        await interaction.deleteReply().catch(() => {});
      }
    };

    try {
      if (kind === "gamedb-query") {
        const results = await searchGameDbWithFallback(rawValue);
        if (!results.length) {
          const rows = this.uiService.buildCompletionatorNoMatchRows(
            ownerId,
            session.importId,
            item.itemId,
          );
          await this.uiService.respondToImportInteraction(
            interaction,
            {
              components: this.uiService.buildCompletionatorComponents({
                session,
                item,
                actionText:
                  `No GameDB matches found for "${rawValue}". ` +
                  "Use the buttons below to search again, skip, or pause.",
                actionRows: rows,
              }),
            },
            false,
            context,
          );
          return;
        }

        if (results.length === 1) {
          await this.uiService.respondToImportInteraction(
            interaction,
            {
              components: this.uiService.buildCompletionatorWorkingComponents(),
            },
            false,
            context,
          );
          await this.workflowService.handleCompletionatorMatch(
            interaction,
            session,
            item,
            results[0].id,
            false,
            context,
          );
          return;
        }

        await this.workflowService.renderCompletionatorGameDbResults(
          interaction,
          session,
          item,
          results,
          false,
          context,
        );
        return;
      }

      if (kind === "igdb-query") {
        await this.workflowService.promptCompletionatorIgdbSelection(
          interaction,
          session,
          item,
          rawValue,
          context,
        );
        return;
      }

      if (kind === "igdb-manual") {
        const igdbId = Number(rawValue);
        if (!Number.isInteger(igdbId) || igdbId <= 0) {
          await updateImportItem(item.itemId, {
            status: "ERROR",
            errorText: "Invalid IGDB id entered.",
          });
          await this.workflowService.processNextCompletionatorItem(interaction, session, {
            context,
          });
          return;
        }

        const imported = await importGameFromIgdb(igdbId);
        await this.workflowService.handleCompletionatorMatch(
          interaction,
          session,
          item,
          imported.gameId,
          false,
          context,
        );
        return;
      }

      if (kind === "gamedb-manual") {
        const manualId = Number(rawValue);
        if (!Number.isInteger(manualId) || manualId <= 0) {
          await updateImportItem(item.itemId, {
            status: "ERROR",
            errorText: "Invalid GameDB id entered.",
          });
          await this.workflowService.processNextCompletionatorItem(interaction, session, {
            context,
          });
          return;
        }

        await this.workflowService.handleCompletionatorMatch(
          interaction,
          session,
          item,
          manualId,
          false,
          context,
        );
      }
    } finally {
      await cleanupDeferredReply();
    }
  }

  private async pauseCompletionatorImport(
    interaction: ButtonInteraction,
    session: { importId: number; userId: string },
  ): Promise<void> {
    await setImportStatus(session.importId, "PAUSED");

    const key = getCompletionatorThreadKey(session.userId, session.importId);
    const context = completionatorThreadContexts.get(key);
    if (context) {
      completionatorThreadContexts.delete(key);
      if (context.thread && "delete" in context.thread) {
        await context.thread.delete().catch(() => {});
      }
      if (context.parentMessage && "delete" in context.parentMessage) {
        await context.parentMessage.delete().catch(() => {});
      }
    }

    const content =
      `Import #${session.importId} paused. ` +
      "Resume with `/game-completion import-completionator action:resume`.";
    const payload: {
      content: string;
      flags: number;
    } = {
      content,
      flags: MessageFlags.Ephemeral,
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
}

// Export handler functions for decorator usage
const handlerService = new CompletionatorHandlersService();

export async function handleCompletionatorSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  return handlerService.handleCompletionatorSelect(interaction);
}

export async function handleCompletionatorChoose(interaction: ButtonInteraction): Promise<void> {
  return handlerService.handleCompletionatorChoose(interaction);
}

export async function handleCompletionatorUpdateFields(interaction: StringSelectMenuInteraction): Promise<void> {
  return handlerService.handleCompletionatorUpdateFields(interaction);
}

export async function handleCompletionatorAction(interaction: ButtonInteraction): Promise<void> {
  return handlerService.handleCompletionatorAction(interaction);
}

export async function handleCompletionatorFormSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  return handlerService.handleCompletionatorFormSelect(interaction);
}

export async function handleCompletionatorDateModal(interaction: ModalSubmitInteraction): Promise<void> {
  return handlerService.handleCompletionatorDateModal(interaction);
}

export async function handleCompletionatorInputModal(interaction: ModalSubmitInteraction): Promise<void> {
  return handlerService.handleCompletionatorInputModal(interaction);
}
