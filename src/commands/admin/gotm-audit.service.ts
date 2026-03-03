// This file contains the GOTM Audit service which orchestrates the CSV import workflow
// It uses the parser, UI, and database functions to process and import historical GOTM data

import type { CommandInteraction, Attachment } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import { safeReply } from "../../functions/InteractionUtils.js";
import type { IGameWithPlatforms } from "../../classes/Game.js";
import Game from "../../classes/Game.js";
import Gotm, {
  insertGotmRoundInDatabase,
  updateGotmGameFieldInDatabase,
} from "../../classes/Gotm.js";
import NrGotm, {
  insertNrGotmRoundInDatabase,
  updateNrGotmGameFieldInDatabase,
} from "../../classes/NrGotm.js";
import { setThreadGameLink } from "../../classes/Thread.js";
import {
  createGotmAuditImportSession,
  countGotmAuditItems,
  getActiveGotmAuditImportForUser,
  getGotmAuditImportById,
  getGotmAuditItemsForRound,
  getNextGotmAuditItem,
  insertGotmAuditImportItems,
  setGotmAuditImportStatus,
  updateGotmAuditImportIndex,
  updateGotmAuditItem,
  type GotmAuditKind,
  type IGotmAuditImport,
  type IGotmAuditItem,
} from "../../classes/GotmAuditImport.js";
import { buildComponentsV2Flags } from "../../functions/NominationListComponents.js";
import { type GotmAuditAction, GOTM_AUDIT_RESULT_LIMIT } from "./admin.types.js";
import {
  fetchGotmAuditCsvText,
  parseGotmAuditCsv,
  findExactGameDbMatch,
} from "./gotm-audit-parser.service.js";
import {
  buildGotmAuditPromptContent,
  buildGotmAuditPromptContainer,
  buildGotmAuditPromptComponents,
} from "./gotm-audit-ui.service.js";

export async function handleGotmAudit(
  interaction: CommandInteraction,
  action: GotmAuditAction,
  file: Attachment | undefined,
): Promise<void> {
  const userId = interaction.user.id;

  if (action === "start") {
    if (!file?.url) {
      await safeReply(interaction, {
        content: "Please attach the GOTM audit CSV file.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const csvText = await fetchGotmAuditCsvText(file.url);
    if (!csvText) {
      await safeReply(interaction, {
        content: "Failed to download the CSV file.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const parsed = parseGotmAuditCsv(csvText);
    if (!parsed.length) {
      await safeReply(interaction, {
        content: "No valid rows found in the CSV file.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const session = await createGotmAuditImportSession({
      userId,
      totalCount: parsed.length,
      sourceFilename: file.name ?? null,
    });
    await insertGotmAuditImportItems(session.importId, parsed);

    await safeReply(interaction, {
      content:
        `GOTM audit #${session.importId} created with ${parsed.length} rows.` +
        " Starting review now.",
      flags: MessageFlags.Ephemeral,
    });

    await processNextGotmAuditItem(interaction, session);
    return;
  }

  if (action === "status") {
    const session = await getActiveGotmAuditImportForUser(userId);
    if (!session) {
      await safeReply(interaction, {
        content: "No active GOTM audit session found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const stats = await countGotmAuditItems(session.importId);
    const embed = new EmbedBuilder()
      .setTitle(`GOTM Audit #${session.importId}`)
      .setDescription(`Status: ${session.status}`)
      .addFields(
        { name: "Pending", value: String(stats.pending), inline: true },
        { name: "Imported", value: String(stats.imported), inline: true },
        { name: "Skipped", value: String(stats.skipped), inline: true },
        { name: "Errors", value: String(stats.error), inline: true },
      );

    await safeReply(interaction, {
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const session = await getActiveGotmAuditImportForUser(userId);
  if (!session) {
    await safeReply(interaction, {
      content: "No active GOTM audit session found.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === "pause") {
    await setGotmAuditImportStatus(session.importId, "PAUSED");
    await safeReply(interaction, {
      content: `GOTM audit #${session.importId} paused.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === "cancel") {
    await setGotmAuditImportStatus(session.importId, "CANCELED");
    await safeReply(interaction, {
      content: `GOTM audit #${session.importId} canceled.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await setGotmAuditImportStatus(session.importId, "ACTIVE");
  await safeReply(interaction, {
    content: `Resuming GOTM audit #${session.importId}.`,
    flags: MessageFlags.Ephemeral,
  });
  await processNextGotmAuditItem(interaction, session);
}

export async function processNextGotmAuditItem(
  interaction: any,
  session: IGotmAuditImport,
): Promise<void> {
  const current = await getGotmAuditImportById(session.importId);
  if (!current || current.status !== "ACTIVE") {
    return;
  }

  const nextItem = await getNextGotmAuditItem(session.importId);
  if (!nextItem) {
    await setGotmAuditImportStatus(session.importId, "COMPLETED");
    await safeReply(interaction, {
      content: `GOTM audit #${session.importId} completed.`,
      flags: MessageFlags.Ephemeral,
      __forceFollowUp: true,
    });
    return;
  }

  await updateGotmAuditImportIndex(session.importId, nextItem.rowIndex);

  if (nextItem.gameDbGameId) {
    const game = await Game.getGameById(nextItem.gameDbGameId);
    if (!game) {
      await updateGotmAuditItem(nextItem.itemId, {
        status: "ERROR",
        errorText: `GameDB id ${nextItem.gameDbGameId} not found.`,
      });
    } else {
      await updateGotmAuditItem(nextItem.itemId, {
        status: "IMPORTED",
        gameDbGameId: nextItem.gameDbGameId,
        errorText: null,
      });
      await tryInsertGotmAuditRound(interaction, session, nextItem);
    }

    await processNextGotmAuditItem(interaction, session);
    return;
  }

  let results: IGameWithPlatforms[] = [];
  try {
    results = await Game.searchGames(nextItem.gameTitle);
  } catch (err: any) {
    await updateGotmAuditItem(nextItem.itemId, {
      status: "ERROR",
      errorText: err?.message ?? "GameDB search failed.",
    });
    await safeReply(interaction, {
      content: `GameDB search failed for "${nextItem.gameTitle}". Skipping.`,
      flags: MessageFlags.Ephemeral,
      __forceFollowUp: true,
    });
    await processNextGotmAuditItem(interaction, session);
    return;
  }

  const exactMatch = findExactGameDbMatch(nextItem.gameTitle, results);
  if (exactMatch) {
    await updateGotmAuditItem(nextItem.itemId, {
      status: "IMPORTED",
      gameDbGameId: exactMatch.id,
      errorText: null,
    });
    await tryInsertGotmAuditRound(interaction, session, nextItem);
    await processNextGotmAuditItem(interaction, session);
    return;
  }

  const options = results.slice(0, GOTM_AUDIT_RESULT_LIMIT).map((game) => {
    const year = game.initialReleaseDate instanceof Date
      ? game.initialReleaseDate.getFullYear()
      : game.initialReleaseDate
        ? new Date(game.initialReleaseDate).getFullYear()
        : null;
    const label = year ? `${game.title} (${year})` : game.title;
    return {
      id: game.id,
      label,
      description: `GameDB #${game.id}`,
    };
  });

  const content = buildGotmAuditPromptContent(
    session,
    nextItem,
    interaction.guildId ?? null,
    options.length > 0,
  );
  const container = buildGotmAuditPromptContainer(content);
  const components = buildGotmAuditPromptComponents(
    interaction.user.id,
    session.importId,
    nextItem.itemId,
    options,
  );

  await safeReply(interaction, {
    components: [container, ...components],
    flags: buildComponentsV2Flags(true),
    __forceFollowUp: true,
  });
}

export async function tryInsertGotmAuditRound(
  interaction: any,
  session: IGotmAuditImport,
  item: IGotmAuditItem,
): Promise<void> {
  const roundItems = await getGotmAuditItemsForRound(
    session.importId,
    item.kind,
    item.roundNumber,
  );
  if (!roundItems.length) return;
  if (roundItems.some((entry) => entry.status !== "IMPORTED")) {
    return;
  }

  const monthYear = roundItems[0].monthYear.trim();
  if (!monthYear) {
    await markGotmAuditRoundError(
      session.importId,
      item.kind,
      item.roundNumber,
      "Missing month/year for this round.",
    );
    return;
  }

  if (roundItems.some((entry) => entry.monthYear.trim() !== monthYear)) {
    await markGotmAuditRoundError(
      session.importId,
      item.kind,
      item.roundNumber,
      "Mismatched month/year values for this round.",
    );
    return;
  }

  const hasExisting =
    item.kind === "gotm"
      ? Gotm.getByRound(item.roundNumber).length > 0
      : NrGotm.getByRound(item.roundNumber).length > 0;
  if (hasExisting) {
    await updateMissingGotmAuditLinks(interaction, item, roundItems);
    return;
  }

  const games = roundItems
    .slice()
    .sort((a, b) => a.gameIndex - b.gameIndex)
    .map((entry) => ({
      title: entry.gameTitle,
      threadId: entry.threadId,
      redditUrl: entry.redditUrl,
      gamedbGameId: entry.gameDbGameId ?? 0,
    }));

  if (games.some((game) => !Number.isInteger(game.gamedbGameId) || game.gamedbGameId <= 0)) {
    await markGotmAuditRoundError(
      session.importId,
      item.kind,
      item.roundNumber,
      "Missing GameDB id for one or more items in the round.",
    );
    return;
  }

  try {
    if (item.kind === "gotm") {
      await insertGotmRoundInDatabase(item.roundNumber, monthYear, games);
      Gotm.addRound(item.roundNumber, monthYear, games);
    } else {
      const insertedIds = await insertNrGotmRoundInDatabase(item.roundNumber, monthYear, games);
      const gamesWithIds = games.map((g, idx) => ({ ...g, id: insertedIds[idx] ?? null }));
      NrGotm.addRound(item.roundNumber, monthYear, gamesWithIds);
    }

    for (const game of games) {
      if (game.threadId && Number.isInteger(game.gamedbGameId) && game.gamedbGameId > 0) {
        await setThreadGameLink(game.threadId, game.gamedbGameId);
      }
    }

    await safeReply(interaction, {
      content:
        `${item.kind === "gotm" ? "GOTM" : "NR-GOTM"} round ${item.roundNumber} ` +
        `inserted with ${games.length} game${games.length === 1 ? "" : "s"}.`,
      flags: MessageFlags.Ephemeral,
      __forceFollowUp: true,
    });
  } catch (err: any) {
    await markGotmAuditRoundError(
      session.importId,
      item.kind,
      item.roundNumber,
      err?.message ?? "Failed to insert round.",
    );
  }
}

async function updateMissingGotmAuditLinks(
  interaction: any,
  item: IGotmAuditItem,
  roundItems: IGotmAuditItem[],
): Promise<void> {
  const roundNumber = item.roundNumber;
  if (item.kind === "gotm") {
    const existingRounds = Gotm.getByRound(roundNumber);
    const entry = existingRounds[0];
    if (!entry) return;

    let updated = 0;
    for (const roundItem of roundItems) {
      const index = roundItem.gameIndex;
      const existingGame = entry.gameOfTheMonth[index];
      if (!existingGame) continue;

      if (!existingGame.threadId && roundItem.threadId) {
        await setThreadGameLink(roundItem.threadId, existingGame.gamedbGameId);
        Gotm.updateThreadIdByRound(roundNumber, roundItem.threadId, index);
        updated += 1;
      }

      if (!existingGame.redditUrl && roundItem.redditUrl) {
        await updateGotmGameFieldInDatabase(
          roundNumber,
          index,
          "redditUrl",
          roundItem.redditUrl,
        );
        Gotm.updateRedditUrlByRound(roundNumber, roundItem.redditUrl, index);
        updated += 1;
      }
    }

    if (updated > 0) {
      await safeReply(interaction, {
        content: `Updated ${updated} missing GOTM link${updated === 1 ? "" : "s"} for Round ${roundNumber}.`,
        flags: MessageFlags.Ephemeral,
        __forceFollowUp: true,
      });
    }
    return;
  }

  const existingNrRounds = NrGotm.getByRound(roundNumber);
  const nrEntry = existingNrRounds[0];
  if (!nrEntry) return;

  let updated = 0;
  for (const roundItem of roundItems) {
    const index = roundItem.gameIndex;
    const existingGame = nrEntry.gameOfTheMonth[index];
    if (!existingGame) continue;

    if (!existingGame.threadId && roundItem.threadId) {
      await setThreadGameLink(roundItem.threadId, existingGame.gamedbGameId);
      NrGotm.updateThreadIdByRound(roundNumber, roundItem.threadId, index);
      updated += 1;
    }

    if (!existingGame.redditUrl && roundItem.redditUrl) {
      await updateNrGotmGameFieldInDatabase({
        round: roundNumber,
        gameIndex: index,
        field: "redditUrl",
        value: roundItem.redditUrl,
      });
      NrGotm.updateRedditUrlByRound(roundNumber, roundItem.redditUrl, index);
      updated += 1;
    }
  }

  if (updated > 0) {
    await safeReply(interaction, {
      content: `Updated ${updated} missing NR-GOTM link${updated === 1 ? "" : "s"} for Round ${roundNumber}.`,
      flags: MessageFlags.Ephemeral,
      __forceFollowUp: true,
    });
  }
}

export async function markGotmAuditRoundError(
  importId: number,
  kind: GotmAuditKind,
  roundNumber: number,
  errorText: string,
): Promise<void> {
  const roundItems = await getGotmAuditItemsForRound(importId, kind, roundNumber);
  if (!roundItems.length) return;
  await Promise.all(
    roundItems.map((entry) =>
      updateGotmAuditItem(entry.itemId, {
        status: "ERROR",
        errorText,
      }),
    ),
  );
}
