import type { CommandInteraction } from "discord.js";
import { ButtonStyle } from "discord.js";
import { safeReply } from "../../functions/InteractionUtils.js";
import NrGotm, {
  type INrGotmEntry,
  type INrGotmGame,
  updateNrGotmGameFieldInDatabase,
  type NrGotmDatabaseEditableField,
  insertNrGotmRoundInDatabase,
} from "../../classes/NrGotm.js";
import Game from "../../classes/Game.js";
import { getThreadsByGameId } from "../../classes/Thread.js";
import { buildNrGotmEntryEmbed } from "../../functions/GotmEntryEmbeds.js";
import {
  promptUserForInput,
  promptUserForChoice,
  buildNumberChoiceOptions,
  addCancelOption,
} from "./admin-prompt.utils.js";

export async function handleAddNrGotm(interaction: CommandInteraction): Promise<void> {
  let allEntries: INrGotmEntry[];
  try {
    allEntries = NrGotm.all();
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    await safeReply(interaction, {
      content: `Error loading existing NR-GOTM data: ${msg}`,
    });
    return;
  }

  const nextRound =
    allEntries.length > 0 ? Math.max(...allEntries.map((e) => e.round)) + 1 : 1;

  await safeReply(interaction, {
    content: `Preparing to create NR-GOTM round ${nextRound}.`,
  });

  const monthYearRaw = await promptUserForInput(
    interaction,
    `Enter the month/year label for NR-GOTM round ${nextRound} (for example: "March 2024"). Type \`cancel\` to abort.`,
  );
  if (monthYearRaw === null) {
    return;
  }
  const monthYear = monthYearRaw.trim();
  if (!monthYear) {
    await safeReply(interaction, {
      content: "Month/year label cannot be empty. Creation cancelled.",
    });
    return;
  }

  const gameCountRaw = await promptUserForChoice(
    interaction,
    "How many games are in this NR-GOTM round?",
    addCancelOption(buildNumberChoiceOptions(1, 5)),
  );
  if (gameCountRaw === null) {
    return;
  }

  const gameCount = Number(gameCountRaw);
  if (!Number.isInteger(gameCount) || gameCount < 1 || gameCount > 5) {
    await safeReply(interaction, {
      content: `Invalid game count "${gameCountRaw}". Creation cancelled.`,
    });
    return;
  }

  const games: INrGotmGame[] = [];

  for (let i = 0; i < gameCount; i++) {
    const n = i + 1;

    const gamedbRaw = await promptUserForInput(
      interaction,
      `Enter the GameDB id for NR-GOTM game #${n} (use /gamedb add first if needed).`,
    );
    if (gamedbRaw === null) return;
    const gamedbId = Number(gamedbRaw.trim());
    if (!Number.isInteger(gamedbId) || gamedbId <= 0) {
      await safeReply(interaction, { content: "Invalid GameDB id. Creation cancelled." });
      return;
    }
    const gameMeta = await Game.getGameById(gamedbId);
    if (!gameMeta) {
      await safeReply(interaction, {
        content: `GameDB id ${gamedbId} not found. Use /gamedb add first.`,
      });
      return;
    }

    const threadId = (await getThreadsByGameId(gamedbId))[0] ?? null;

    games.push({
      title: gameMeta.title,
      threadId,
      redditUrl: null,
      gamedbGameId: gamedbId,
    });
  }

  try {
    const insertedIds = await insertNrGotmRoundInDatabase(nextRound, monthYear, games);
    const gamesWithIds = games.map((g, idx) => ({ ...g, id: insertedIds[idx] ?? null }));
    const newEntry = NrGotm.addRound(nextRound, monthYear, gamesWithIds);
    const embedAssets = await buildNrGotmEntryEmbed(
      newEntry,
      interaction.guildId ?? undefined,
      interaction.client as any,
    );

    await safeReply(interaction, {
      content: `Created NR-GOTM round ${nextRound}.`,
      embeds: [embedAssets.embed],
      files: embedAssets.files?.length ? embedAssets.files : undefined,
    });
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    await safeReply(interaction, {
      content: `Failed to create NR-GOTM round ${nextRound}: ${msg}`,
    });
  }
}

export async function handleEditNrGotm(
  interaction: CommandInteraction,
  round: number,
): Promise<void> {
  const roundNumber = Number(round);
  if (!Number.isFinite(roundNumber)) {
    await safeReply(interaction, {
      content: "Invalid NR-GOTM round number.",
    });
    return;
  }

  let entries: INrGotmEntry[];
  try {
    entries = NrGotm.getByRound(roundNumber);
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    await safeReply(interaction, {
      content: `Error loading NR-GOTM data: ${msg}`,
    });
    return;
  }

  if (!entries.length) {
    await safeReply(interaction, {
      content: `No NR-GOTM entry found for round ${roundNumber}.`,
    });
    return;
  }

  const entry = entries[0];

  const embedAssets = await buildNrGotmEntryEmbed(
    entry,
    interaction.guildId ?? undefined,
    interaction.client as any,
  );

  await safeReply(interaction, {
    content: `Editing NR-GOTM round ${roundNumber}.`,
    embeds: [embedAssets.embed],
    files: embedAssets.files?.length ? embedAssets.files : undefined,
  });

  const totalGames = entry.gameOfTheMonth.length;
  let gameIndex = 0;

  if (totalGames > 1) {
    const gameAnswer = await promptUserForChoice(
      interaction,
      `Which game number (1-${totalGames}) do you want to edit?`,
      addCancelOption(buildNumberChoiceOptions(1, totalGames)),
    );
    if (gameAnswer === null) {
      return;
    }

    const idx = Number(gameAnswer);
    if (!Number.isInteger(idx) || idx < 1 || idx > totalGames) {
      await safeReply(interaction, {
        content: `Invalid game number "${gameAnswer}". Edit cancelled.`,
      });
      return;
    }
    gameIndex = idx - 1;
  }

  const fieldAnswerRaw = await promptUserForChoice(
    interaction,
    "Which field do you want to edit?",
    addCancelOption([
      { label: "GameDB", value: "gamedb", style: ButtonStyle.Primary },
      { label: "Reddit", value: "reddit" },
    ]),
  );
  if (fieldAnswerRaw === null) {
    return;
  }

  const fieldAnswer = fieldAnswerRaw.toLowerCase();
  let field: NrGotmDatabaseEditableField | null = null;
  let nullableField = false;

  if (fieldAnswer === "gamedb") {
    field = "gamedbGameId";
  } else if (fieldAnswer === "reddit") {
    field = "redditUrl";
    nullableField = true;
  } else {
    await safeReply(interaction, {
      content: `Unknown field "${fieldAnswerRaw}". Edit cancelled.`,
    });
    return;
  }

  const valuePrompt = nullableField
    ? `Enter the new value for ${fieldAnswer} (or type \`none\` / \`null\` to clear it).`
    : `Enter the new value for ${fieldAnswer} (GameDB id required).`;

  const valueAnswerRaw = await promptUserForInput(interaction, valuePrompt, 5 * 60_000);
  if (valueAnswerRaw === null) {
    return;
  }

  const valueTrimmed = valueAnswerRaw.trim();
  let newValue: string | number | null = valueTrimmed;

  if (nullableField && /^none|null$/i.test(valueTrimmed)) {
    newValue = null;
  } else if (field === "gamedbGameId") {
    const parsed = Number(valueTrimmed);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      await safeReply(interaction, {
        content: "Please provide a valid numeric GameDB id.",
      });
      return;
    }
    const game = await Game.getGameById(parsed);
    if (!game) {
      await safeReply(interaction, {
        content: `GameDB id ${parsed} was not found. Use /gamedb add first if needed.`,
      });
      return;
    }
    newValue = parsed;
  }

  try {
    await updateNrGotmGameFieldInDatabase({
      rowId: entry.gameOfTheMonth?.[gameIndex]?.id ?? null,
      round: roundNumber,
      gameIndex,
      field: field!,
      value: newValue,
    });

    let updatedEntry: INrGotmEntry | null = null;
    if (field === "gamedbGameId") {
      updatedEntry = NrGotm.updateGamedbIdByRound(roundNumber, newValue as number, gameIndex);
    } else if (field === "redditUrl") {
      updatedEntry = NrGotm.updateRedditUrlByRound(roundNumber, newValue as string | null, gameIndex);
    }

    const entryToShow = updatedEntry ?? entry;
    const updatedAssets = await buildNrGotmEntryEmbed(
      entryToShow,
      interaction.guildId ?? undefined,
      interaction.client as any,
    );

    await safeReply(interaction, {
      content: `NR-GOTM round ${roundNumber} updated successfully.`,
      embeds: [updatedAssets.embed],
      files: updatedAssets.files?.length ? updatedAssets.files : undefined,
    });
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    await safeReply(interaction, {
      content: `Failed to update NR-GOTM round ${roundNumber}: ${msg}`,
    });
  }
}
