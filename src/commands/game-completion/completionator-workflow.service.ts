import type {
  ButtonInteraction,
  CommandInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import type { ContainerBuilder } from "@discordjs/builders";
import Game, { type IPlatformDef } from "../../classes/Game.js";
import Member from "../../classes/Member.js";
import type {
  CompletionatorAddFormState,
  CompletionatorThreadContext,
  ICompletionatorImport,
  ICompletionatorItem,
} from "./completion.types.js";
import {
  getNextPendingItem,
  setImportStatus,
  updateImportIndex,
  updateImportItem,
} from "../../classes/CompletionatorImport.js";
import { CompletionatorUiService } from "./completionator-ui.service.js";
import { completionatorThreadContexts, completionatorAddFormStates } from "./completion.types.js";
import { getCompletionatorThreadKey, getCompletionatorFormKey, resolveNowPlayingRemoval } from "./completion-helpers.js";
import { notifyUnknownCompletionPlatform } from "../../functions/CompletionHelpers.js";
import { formatTableDate } from "../profile.command.js";
import { COMPLETION_TYPES, type CompletionType } from "../profile.command.js";
import { STANDARD_PLATFORM_IDS } from "../../config/standardPlatforms.js";
import { igdbService } from "../../services/IGDB/IgdbService.js";
import { importGameFromIgdb } from "./completionator-parser.service.js";
import { searchGameDbWithFallback } from "./completionator-parser.service.js";
import { runDockerVolumeBackup } from "../../services/DockerVolumeBackupService.js";
import { buildImportTextContainer } from "../imports/import-scaffold.service.js";

export class CompletionatorWorkflowService {
  private uiService: CompletionatorUiService;

  constructor() {
    this.uiService = new CompletionatorUiService();
  }

  async processNextCompletionatorItem(
    interaction:
      | CommandInteraction
      | ButtonInteraction
      | StringSelectMenuInteraction
      | ModalSubmitInteraction,
    session: ICompletionatorImport,
    options?: { ephemeral?: boolean; context?: CompletionatorThreadContext },
  ): Promise<void> {
    const nextItem = await getNextPendingItem(session.importId);
    if (!nextItem) {
      await setImportStatus(session.importId, "COMPLETED");
      await this.uiService.respondToImportInteraction(
        interaction,
        {
          components: this.uiService.buildCompletionatorComponents({
            headerLines: [
              `## Completionator Import #${session.importId}`,
              "Import completed.",
            ],
          }),
        },
        options?.ephemeral,
        options?.context,
      );
      if (options?.context) {
        const key: string = getCompletionatorThreadKey(
          options.context.userId,
          options.context.importId,
        );
        completionatorThreadContexts.delete(key);
      }
      const backupReason = `completionator-import-${session.importId}`;
      void runDockerVolumeBackup({ reason: backupReason }).catch((error) => {
        console.error(
          "Failed to run Docker backup after completionator import.",
          session.importId,
          error,
        );
      });
      return;
    }

    await updateImportIndex(session.importId, nextItem.rowIndex);
    await this.renderCompletionatorItem(
      interaction,
      session,
      nextItem,
      options?.ephemeral,
      options?.context,
    );
  }

  async renderCompletionatorItem(
    interaction:
      | CommandInteraction
      | ButtonInteraction
      | StringSelectMenuInteraction
      | ModalSubmitInteraction,
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    ephemeral?: boolean,
    context?: CompletionatorThreadContext,
  ): Promise<void> {
    const searchTitle = item.gameTitle;
    const results = await searchGameDbWithFallback(searchTitle);
    if (!results.length) {
      const igdbContainer = await this.buildCompletionatorIgdbContainer(
        interaction,
        session,
        item,
        searchTitle,
        context,
      );
      const rows = this.uiService.buildCompletionatorNoMatchRows(
        interaction.user.id,
        session.importId,
        item.itemId,
      );
      await this.uiService.respondToImportInteraction(
        interaction,
        {
          components: this.uiService.buildCompletionatorComponents({
            session,
            item,
            extraContainers: igdbContainer ? [igdbContainer] : [],
            actionText:
              `No GameDB matches found for "${item.gameTitle}". Choose an option below.`,
            actionRows: rows,
          }),
        },
        ephemeral,
        context,
      );
      return;
    }

    if (results.length === 1) {
      await this.handleCompletionatorMatch(
        interaction,
        session,
        item,
        results[0].id,
        ephemeral,
        context,
      );
      return;
    }

    await this.renderCompletionatorGameDbResults(
      interaction,
      session,
      item,
      results,
      ephemeral,
      context,
    );
  }

  async handleCompletionatorMatch(
    interaction:
      | CommandInteraction
      | ButtonInteraction
      | StringSelectMenuInteraction
      | ModalSubmitInteraction,
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    gameId: number,
    ephemeral?: boolean,
    context?: CompletionatorThreadContext,
  ): Promise<void> {
    const game = await Game.getGameById(gameId);
    if (!game) {
      await updateImportItem(item.itemId, {
        gameDbGameId: null,
        errorText: `GameDB id ${gameId} not found.`,
      });
      const rows = this.uiService.buildCompletionatorNoMatchRows(
        interaction.user.id,
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
              `GameDB id ${gameId} was not found. Choose another option below.`,
            actionRows: rows,
          }),
        },
        ephemeral,
        context,
      );
      return;
    }

    const existing = await Member.getCompletionByGameId(interaction.user.id, gameId);
    if (!existing) {
      await updateImportItem(item.itemId, {
        gameDbGameId: gameId,
      });
      item.gameDbGameId = gameId;
      let platforms = await Game.getPlatformsForGameWithStandard(
        gameId,
        STANDARD_PLATFORM_IDS,
      );
      const state = this.getOrCreateCompletionatorAddFormState(
        session,
        item,
        gameId,
        interaction.user.id,
      );
      const resolution = await this.resolveCompletionatorPlatformState(state, item, gameId, platforms);
      platforms = resolution.platforms;

      if (this.canAutoAddCompletion(item, state)) {
        await this.addCompletionFromImport(interaction, session, item, state);
        await this.processNextCompletionatorItem(interaction, session, {
          ephemeral,
          context,
        });
        return;
      }

      await this.renderCompletionatorAddForm(
        interaction,
        session,
        item,
        gameId,
        Boolean(ephemeral),
        context,
      );
      return;
    }

    const updates = this.buildCompletionUpdate(existing, item);
    await updateImportItem(item.itemId, {
      gameDbGameId: gameId,
      completionId: existing.completionId,
    });

    if (!updates) {
      await updateImportItem(item.itemId, {
        status: "SKIPPED",
        gameDbGameId: gameId,
        completionId: existing.completionId,
      });
      await this.processNextCompletionatorItem(interaction, session, { context });
      return;
    }

    const shouldConfirmSame = this.shouldConfirmCompletionMatch(existing, item);
    if (shouldConfirmSame) {
      const confirmContent = this.buildCompletionSameCheckLines(session, item, existing);
      const mappedType =
        this.mapCompletionatorType(item.sourceType ?? undefined) ??
        item.completionType ??
        "Unknown";
      const existingPayload = await this.uiService.buildCompletionatorExistingCompletionsContainer(
        interaction.user.id,
        gameId,
        mappedType,
        session,
        item,
      );
      const confirmButtons = this.uiService.buildConfirmSameButtons(
        interaction.user.id,
        session.importId,
        item.itemId,
      );

      await this.uiService.respondToImportInteraction(
        interaction,
        {
          components: this.uiService.buildCompletionatorComponents({
            headerLines: confirmContent.headerLines,
            extraContainers: [
              buildImportTextContainer(confirmContent.detailLines.join("\n").trim()),
              existingPayload.container,
            ],
            actionText: confirmContent.actionText,
            actionRows: [confirmButtons, existingPayload.changeRow],
          }),
          files: existingPayload.files,
        },
        ephemeral,
        context,
      );
      return;
    }

    await this.renderCompletionatorUpdateSelection(
      interaction,
      session,
      item,
      existing,
      ephemeral,
      context,
    );
  }

  async renderCompletionatorUpdateSelection(
    interaction:
      | CommandInteraction
      | ButtonInteraction
      | StringSelectMenuInteraction
      | ModalSubmitInteraction,
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    existing: Awaited<ReturnType<typeof Member.getCompletionByGameId>>,
    ephemeral?: boolean,
    context?: CompletionatorThreadContext,
  ): Promise<void> {
    const updateContent = this.buildCompletionatorUpdateLines(session, item, existing);
    const gameId = item.gameDbGameId ?? existing?.gameId ?? 0;
    const mappedType =
      this.mapCompletionatorType(item.sourceType ?? undefined) ??
      item.completionType ??
      "Unknown";
    const existingPayload = gameId
      ? await this.uiService.buildCompletionatorExistingCompletionsContainer(
          interaction.user.id,
          gameId,
          mappedType,
          session,
          item,
        )
      : null;
    const updateOptions = this.buildCompletionUpdateOptions(existing, item);
    if (!updateOptions.length) {
      await updateImportItem(item.itemId, {
        status: "SKIPPED",
        gameDbGameId: item.gameDbGameId ?? null,
        completionId: existing?.completionId ?? null,
      });
      await this.processNextCompletionatorItem(interaction, session, {
        ephemeral,
        context,
      });
      return;
    }

    const { updateRow, buttonsRow } = this.uiService.buildUpdateSelectionComponents(
      interaction.user.id,
      session.importId,
      item.itemId,
      updateOptions,
    );

    const extraContainers = [
      buildImportTextContainer(updateContent.detailLines.join("\n").trim()),
      ...(existingPayload ? [existingPayload.container] : []),
    ];
    await this.uiService.respondToImportInteraction(
      interaction,
      {
        components: this.uiService.buildCompletionatorComponents({
          headerLines: updateContent.headerLines,
          extraContainers,
          actionText: updateContent.actionText,
          actionRows: [updateRow, buttonsRow, ...(existingPayload ? [existingPayload.changeRow] : [])],
        }),
        files: existingPayload?.files,
      },
      ephemeral,
      context,
    );
  }

  async renderCompletionatorAddForm(
    interaction:
      | CommandInteraction
      | ButtonInteraction
      | StringSelectMenuInteraction
      | ModalSubmitInteraction,
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    gameId: number,
    ephemeral: boolean,
    context?: CompletionatorThreadContext,
    notice?: string,
  ): Promise<void> {
    const payload = await this.buildCompletionatorAddFormPayload(
      session,
      item,
      gameId,
      interaction.user.id,
      notice,
    );
    await this.uiService.respondToImportInteraction(interaction, payload, ephemeral, context);
  }

  async buildCompletionatorAddFormPayload(
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    gameId: number,
    ownerId: string,
    notice?: string,
  ): Promise<{
    components: Array<any>;
    files: any[];
  }> {
    let platforms = await Game.getPlatformsForGameWithStandard(gameId, STANDARD_PLATFORM_IDS);
    const state = this.getOrCreateCompletionatorAddFormState(session, item, gameId, ownerId);
    const resolution = await this.resolveCompletionatorPlatformState(state, item, gameId, platforms);
    platforms = resolution.platforms;

    if (!platforms.length) {
      return {
        components: this.uiService.buildCompletionatorComponents({
          session,
          item,
          actionText: "No platform release data is available for this game.",
        }),
        files: [],
      };
    }

    const mappedType =
      this.mapCompletionatorType(item.sourceType ?? undefined) ??
      item.completionType ??
      "Unknown";
    const { container, files, changeRow } =
      await this.uiService.buildCompletionatorExistingCompletionsContainer(
        ownerId,
        gameId,
        mappedType,
        session,
        item,
      );
    const rows = this.uiService.buildCompletionatorAddFormRows(state, item, platforms);
    const actionText = notice
      ? `Complete the form below to add this completion.\n${notice}`
      : "Complete the form below to add this completion.";
    return {
      components: this.uiService.buildCompletionatorComponents({
        session,
        item,
        extraContainers: [container],
        actionText,
        actionRows: [...rows, changeRow],
      }),
      files,
    };
  }

  async renderCompletionatorGameDbResults(
    interaction:
      | CommandInteraction
      | ButtonInteraction
      | StringSelectMenuInteraction
      | ModalSubmitInteraction,
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    results: Awaited<ReturnType<typeof Game.searchGames>>,
    ephemeral?: boolean,
    context?: CompletionatorThreadContext,
  ): Promise<void> {
    if (results.length === 1) {
      await this.handleCompletionatorMatch(
        interaction,
        session,
        item,
        results[0].id,
        ephemeral,
        context,
      );
      return;
    }

    const guidance = results.length > 1
      ? "Ambiguous match. Use Choose to select the right GameDB title."
      : "Single match found. Use Choose to confirm import.";
    const candidatesContainer = this.uiService.buildCompletionatorCandidatesContainer({
      ownerId: interaction.user.id,
      importId: session.importId,
      itemId: item.itemId,
      results,
      guidanceText: guidance,
    });
    const igdbContainer = await this.buildCompletionatorIgdbContainer(
      interaction,
      session,
      item,
      item.gameTitle,
      context,
    );
    const actionRows = this.uiService.buildCompletionatorNoMatchRows(
      interaction.user.id,
      session.importId,
      item.itemId,
    );
    const actionText = "Use Choose, or search IGDB, enter a GameDB ID, skip, or pause.";
    await this.uiService.respondToImportInteraction(
      interaction,
      {
        components: this.uiService.buildCompletionatorComponents({
          session,
          item,
          extraContainers: igdbContainer
            ? [candidatesContainer, igdbContainer]
            : [candidatesContainer],
          actionText,
          actionRows,
        }),
      },
      ephemeral,
      context,
    );
  }

  async promptCompletionatorIgdbSelection(
    interaction:
      | ButtonInteraction
      | StringSelectMenuInteraction
      | ModalSubmitInteraction,
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    initialQuery?: string,
    context?: CompletionatorThreadContext,
  ): Promise<void> {
    const isComponent =
      "isMessageComponent" in interaction && interaction.isMessageComponent();
    if (!interaction.deferred && !interaction.replied) {
      if (isComponent) {
        await interaction.deferUpdate().catch(() => {});
      } else {
        await interaction.deferReply({ flags: 64 }).catch(() => {});
      }
    }

    const searchTerm = initialQuery?.trim() || item.gameTitle;

    await this.uiService.respondToImportInteraction(
      interaction,
      {
        components: this.uiService.buildCompletionatorComponents({
          session,
          item,
          actionText: `Searching IGDB for "${searchTerm}"...`,
        }),
      },
      this.uiService.isInteractionEphemeral(interaction),
      context,
    );

    const igdbSearch = await igdbService.searchGames(searchTerm);
    if (igdbSearch.results.length) {
      const { selectComponents, extraRows } = this.uiService.buildIgdbSelectionComponents(
        interaction.user.id,
        session,
        item,
        igdbSearch.results,
        async (sel, gameId) => {
          if (!sel.deferred && !sel.replied) {
            await sel.deferUpdate().catch(() => {});
          }
          await this.uiService.respondToImportInteraction(
            sel,
            {
              components: this.uiService.buildCompletionatorComponents({
                session,
                item,
                actionText: "Importing game details from IGDB...",
              }),
            },
            this.uiService.isInteractionEphemeral(sel),
            context,
          );

          const imported = await importGameFromIgdb(gameId);
          await this.handleCompletionatorMatch(
            sel,
            session,
            item,
            imported.gameId,
            this.uiService.isInteractionEphemeral(sel),
            context,
          );
        },
      );

      await this.uiService.respondToImportInteraction(
        interaction,
        {
          components: this.uiService.buildCompletionatorComponents({
            session,
            item,
            actionText: `Select an IGDB result to import for "${searchTerm}".`,
            actionRows: [...selectComponents, ...extraRows],
          }),
        },
        this.uiService.isInteractionEphemeral(interaction),
        context,
      );
      return;
    }

    const retryRow = this.uiService.buildIgdbRetryButtons(
      interaction.user.id,
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
            `No IGDB matches found for "${searchTerm}". ` +
            "Use the buttons below to search again, skip, or pause.",
          actionRows: [retryRow],
        }),
      },
      this.uiService.isInteractionEphemeral(interaction),
      context,
    );
  }

  private async buildCompletionatorIgdbContainer(
    interaction:
      | CommandInteraction
      | ButtonInteraction
      | StringSelectMenuInteraction
      | ModalSubmitInteraction,
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    searchTitle: string,
    context?: CompletionatorThreadContext,
  ): Promise<ContainerBuilder | null> {
    try {
      const igdbSearch = await igdbService.searchGames(searchTitle, 10);
      const igdbRows = igdbSearch.results.length
        ? this.uiService.buildCompletionatorIgdbSelectRows(
            interaction.user.id,
            igdbSearch.results,
          async (selectionInteraction, gameId) => {
            if (!selectionInteraction.deferred && !selectionInteraction.replied) {
              await selectionInteraction.deferUpdate().catch(() => {});
            }
            await this.uiService.respondToImportInteraction(
              selectionInteraction,
              {
                components: this.uiService.buildCompletionatorWorkingComponents(),
              },
              this.uiService.isInteractionEphemeral(selectionInteraction),
              context,
            );

              const imported = await importGameFromIgdb(gameId);
              await this.handleCompletionatorMatch(
                selectionInteraction,
                session,
                item,
                imported.gameId,
                this.uiService.isInteractionEphemeral(selectionInteraction),
                context,
              );
            },
          )
        : [];
      const noResultsText = igdbSearch.results.length
        ? null
        : `No IGDB matches found for "${searchTitle}". Try Search a different title.`;
      return this.uiService.buildCompletionatorIgdbContainer({
        searchTitle,
        igdbRows,
        noResultsText,
      });
    } catch {
      return this.uiService.buildCompletionatorIgdbContainer({
        searchTitle,
        igdbRows: [],
        noResultsText:
          `No IGDB matches found for "${searchTitle}". Try Search a different title.`,
      });
    }
  }

  async addCompletionFromImport(
    interaction:
      | CommandInteraction
      | ButtonInteraction
      | StringSelectMenuInteraction
      | ModalSubmitInteraction,
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    state: CompletionatorAddFormState,
  ): Promise<void> {
    const completedAt = this.resolveCompletionatorDateChoice(state, item);
    if (state.otherPlatform) {
      await notifyUnknownCompletionPlatform(interaction, item.gameTitle, item.gameDbGameId!);
    }

    const removeFromNowPlaying = await resolveNowPlayingRemoval(
      interaction,
      interaction.user.id,
      item.gameDbGameId!,
      item.gameTitle,
      completedAt,
      true,
    );

    const completionId = await Member.addCompletion({
      userId: interaction.user.id,
      gameId: item.gameDbGameId!,
      completionType: state.completionType ?? "Main Story",
      platformId: state.otherPlatform ? null : state.platformId,
      completedAt,
      finalPlaytimeHours: item.playtimeHours,
      note: null,
    });

    if (removeFromNowPlaying) {
      await Member.removeNowPlaying(interaction.user.id, item.gameDbGameId!).catch(() => {});
    }

    completionatorAddFormStates.delete(getCompletionatorFormKey(session.importId, item.itemId));
    await updateImportItem(item.itemId, {
      status: "IMPORTED",
      gameDbGameId: item.gameDbGameId,
      completionId,
    });
  }

  async resolveCompletionatorPlatformState(
    state: CompletionatorAddFormState,
    item: ICompletionatorItem,
    gameId: number,
    platforms: IPlatformDef[],
  ): Promise<{ platforms: IPlatformDef[] }> {
    if (state.platformId || state.otherPlatform) {
      return { platforms };
    }

    if (item.platformName) {
      const matchingId = this.uiService.resolvePlatformId(item.platformName, platforms);
      if (matchingId) {
        state.platformId = matchingId;
        state.otherPlatform = false;
        return { platforms };
      }

      const allPlatforms = await Game.getAllPlatforms();
      const mappedPlatformId = this.uiService.resolvePlatformId(item.platformName, allPlatforms);
      if (mappedPlatformId) {
        const wasAdded = await this.ensureCompletionatorPlatformRelease(gameId, mappedPlatformId);
        if (wasAdded) {
          const refreshedPlatforms = await Game.getPlatformsForGameWithStandard(
            gameId,
            STANDARD_PLATFORM_IDS,
          );
          state.platformId = mappedPlatformId;
          state.otherPlatform = false;
          return { platforms: refreshedPlatforms };
        }
      }
    }

    if (platforms.length === 1) {
      state.platformId = platforms[0].id;
      state.otherPlatform = false;
    }
    return { platforms };
  }

  private async ensureCompletionatorPlatformRelease(
    gameId: number,
    platformId: number,
  ): Promise<boolean> {
    const existingReleases = await Game.getGameReleases(gameId);
    if (existingReleases.some((release) => release.platformId === platformId)) {
      return false;
    }

    const game = await Game.getGameById(gameId);
    let region = await Game.getRegionByCode("WW");
    if (!region) {
      region = await Game.ensureRegion(8);
    }
    if (!region) {
      return false;
    }

    try {
      await Game.addReleaseInfo(
        gameId,
        platformId,
        region.id,
        null,
        game?.initialReleaseDate ?? null,
        "Auto-added from Completionator import platform mapping.",
      );
      return true;
    } catch (error: any) {
      const message = String(error?.message ?? "");
      if (message.includes("ORA-00001")) {
        return false;
      }
      throw error;
    }
  }

  canAutoAddCompletion(
    item: ICompletionatorItem,
    state: CompletionatorAddFormState,
  ): boolean {
    if (!state.platformId && !state.otherPlatform) return false;
    if (state.dateChoice === "date") return false;
    if (state.dateChoice === "csv" && !item.completedAt) return false;
    return true;
  }

  getOrCreateCompletionatorAddFormState(
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    gameId: number,
    ownerId: string,
  ): CompletionatorAddFormState {
    const key = getCompletionatorFormKey(session.importId, item.itemId);
    const existing = completionatorAddFormStates.get(key);
    if (existing) return existing;

    const mappedType = this.mapCompletionatorType(item.sourceType ?? undefined);
    const defaultType = COMPLETION_TYPES.includes(mappedType as CompletionType)
      ? (mappedType as CompletionType)
      : COMPLETION_TYPES.includes(item.completionType as CompletionType)
        ? (item.completionType as CompletionType)
        : "Main Story";
    const defaultDateChoice: "csv" | "today" | "unknown" | "date" =
      item.completedAt ? "csv" : "unknown";
    const state: CompletionatorAddFormState = {
      ownerId,
      importId: session.importId,
      itemId: item.itemId,
      gameId,
      completionType: defaultType,
      dateChoice: defaultDateChoice,
      customDate: null,
      platformId: null,
      otherPlatform: false,
    };
    completionatorAddFormStates.set(key, state);
    return state;
  }

  resolveCompletionatorDateChoice(
    state: CompletionatorAddFormState,
    item: ICompletionatorItem,
  ): Date | null {
    if (state.dateChoice === "csv") {
      return item.completedAt ?? null;
    }
    if (state.dateChoice === "today") {
      return new Date();
    }
    if (state.dateChoice === "date") {
      return state.customDate ?? null;
    }
    return null;
  }

  buildCompletionUpdate(
    existing: Awaited<ReturnType<typeof Member.getCompletionByGameId>>,
    item: ICompletionatorItem,
  ): Partial<{
    completionType: string;
    completedAt: Date | null;
    finalPlaytimeHours: number | null;
  }> | null {
    if (!existing) return null;
    const updates: Partial<{
      completionType: string;
      completedAt: Date | null;
      finalPlaytimeHours: number | null;
    }> = {};

    if (item.completionType && item.completionType !== existing.completionType) {
      updates.completionType = item.completionType;
    }

    if (item.playtimeHours != null) {
      const existingPlaytime = existing.finalPlaytimeHours ?? null;
      if (existingPlaytime == null) {
        updates.finalPlaytimeHours = item.playtimeHours;
      } else if (Math.abs(existingPlaytime - item.playtimeHours) >= 1) {
        updates.finalPlaytimeHours = item.playtimeHours;
      }
    }

    if (item.completedAt) {
      const existingDate = existing.completedAt ? formatTableDate(existing.completedAt) : null;
      const incomingDate = formatTableDate(item.completedAt);
      if (!existingDate || existingDate !== incomingDate) {
        updates.completedAt = item.completedAt;
      }
    }

    return Object.keys(updates).length ? updates : null;
  }

  buildCompletionUpdateOptions(
    existing: Awaited<ReturnType<typeof Member.getCompletionByGameId>>,
    item: ICompletionatorItem,
  ): Array<{ label: string; value: string; description: string }> {
    const options: Array<{ label: string; value: string; description: string }> = [];
    const clamp = (value: string): string => value.slice(0, 95);

    if (item.completionType && item.completionType !== existing?.completionType) {
      options.push({
        label: "Completion Type",
        value: "type",
        description: clamp(`${existing?.completionType ?? "Unknown"} → ${item.completionType}`),
      });
    }

    if (item.completedAt) {
      const existingDate = existing?.completedAt
        ? formatTableDate(existing.completedAt)
        : "Unknown";
      const incomingDate = formatTableDate(item.completedAt);
      if (existingDate !== incomingDate) {
        options.push({
          label: "Completion Date",
          value: "date",
          description: clamp(`${existingDate} → ${incomingDate}`),
        });
      }
    }

    if (item.playtimeHours != null) {
      const existingPlaytime = existing?.finalPlaytimeHours ?? null;
      const delta =
        existingPlaytime == null ? null : Math.abs(existingPlaytime - item.playtimeHours);
      if (existingPlaytime == null || (delta != null && delta >= 1)) {
        options.push({
          label: "Playtime",
          value: "playtime",
          description: clamp(
            `${existingPlaytime ?? "Unknown"} hrs → ${item.playtimeHours} hrs`,
          ),
        });
      }
    }

    return options;
  }

  shouldConfirmCompletionMatch(
    existing: Awaited<ReturnType<typeof Member.getCompletionByGameId>>,
    item: ICompletionatorItem,
  ): boolean {
    if (!existing?.completedAt || !item.completedAt) {
      return false;
    }
    return formatTableDate(existing.completedAt) !== formatTableDate(item.completedAt);
  }

  buildCompletionSameCheckLines(
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    existing: Awaited<ReturnType<typeof Member.getCompletionByGameId>>,
  ): { headerLines: string[]; detailLines: string[]; actionText: string } {
    const currentDate = existing?.completedAt ? formatTableDate(existing.completedAt) : "Unknown";
    const csvDate = item.completedAt ? formatTableDate(item.completedAt) : "Unknown";
    return {
      headerLines: [
        `## Completionator Import #${session.importId}`,
        `Is this the same completion for "${item.gameTitle}"?`,
      ],
      detailLines: [
        `**Current:** ${existing?.completionType ?? "Unknown"} - ${currentDate} - ${
          existing?.finalPlaytimeHours ?? "Unknown"
        } hrs`,
        `**CSV:** ${item.completionType ?? "Unknown"} - ${csvDate} - ${
          item.playtimeHours ?? "Unknown"
        } hrs`,
      ],
      actionText: "Yes = update existing. No = add as new completion.",
    };
  }

  buildCompletionatorUpdateLines(
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    existing: Awaited<ReturnType<typeof Member.getCompletionByGameId>>,
  ): { headerLines: string[]; detailLines: string[]; actionText: string } {
    const currentDate = existing?.completedAt ? formatTableDate(existing.completedAt) : "Unknown";
    const csvDate = item.completedAt ? formatTableDate(item.completedAt) : "Unknown";
    return {
      headerLines: [
        `## Completionator Import #${session.importId}`,
        `Update existing completion for "${item.gameTitle}"?`,
      ],
      detailLines: [
        `**Current:** ${existing?.completionType ?? "Unknown"} - ${currentDate} - ${
          existing?.finalPlaytimeHours ?? "Unknown"
        } hrs`,
        `**CSV:** ${item.completionType ?? "Unknown"} - ${csvDate} - ${
          item.playtimeHours ?? "Unknown"
        } hrs`,
      ],
      actionText: "Select fields to update.",
    };
  }

  mapCompletionatorType(value: string | undefined): string | null {
    const normalized = (value ?? "").trim();
    if (!normalized) return null;
    const lower = normalized.toLowerCase();
    if (lower === "core game") return "Main Story";
    if (lower === "core game (+ a few extras)") return "Main Story + Side Content";
    if (lower === "core game (+ lots of extras)") return "Main Story + Side Content";
    if (lower === "completionated") return "Completionist";
    return null;
  }

}
