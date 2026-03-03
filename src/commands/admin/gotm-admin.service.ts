import type { CommandInteraction } from "discord.js";
import { ButtonStyle } from "discord.js";
import { safeReply } from "../../functions/InteractionUtils.js";
import Gotm, {
  type IGotmEntry,
  type IGotmGame,
  updateGotmGameFieldInDatabase,
  type GotmDatabaseEditableField,
  insertGotmRoundInDatabase,
} from "../../classes/Gotm.js";
import Game from "../../classes/Game.js";
import { getThreadsByGameId } from "../../classes/Thread.js";
import { buildGotmEntryEmbed } from "../../functions/GotmEntryEmbeds.js";
import {
  promptUserForInput,
  promptUserForChoice,
  buildNumberChoiceOptions,
  addCancelOption,
} from "./admin-prompt.utils.js";

export async function handleAddGotm(interaction: CommandInteraction): Promise<void> {
  let allEntries: IGotmEntry[];
  try {
    allEntries = Gotm.all();
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    await safeReply(interaction, {
      content: `Error loading existing GOTM data: ${msg}`,
    });
    return;
  }

  const nextRound =
    allEntries.length > 0 ? Math.max(...allEntries.map((e) => e.round)) + 1 : 1;

  await safeReply(interaction, {
    content: `Preparing to create GOTM round ${nextRound}.`,
  });

  const monthYearRaw = await promptUserForInput(
    interaction,
    `Enter the month/year label for round ${nextRound} (for example: "March 2024"). Type \`cancel\` to abort.`,
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
    "How many games are in this GOTM round?",
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

  const games: IGotmGame[] = [];

  for (let i = 0; i < gameCount; i++) {
    const n = i + 1;

    const gamedbRaw = await promptUserForInput(
      interaction,
      `Enter the GameDB id for game #${n} (use /gamedb add first if needed).`,
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
    await insertGotmRoundInDatabase(nextRound, monthYear, games);
    const newEntry = Gotm.addRound(nextRound, monthYear, games);
    const embedAssets = await buildGotmEntryEmbed(
      newEntry,
      interaction.guildId ?? undefined,
      interaction.client as any,
    );

    await safeReply(interaction, {
      content: `Created GOTM round ${nextRound}.`,
      embeds: [embedAssets.embed],
      files: embedAssets.files?.length ? embedAssets.files : undefined,
    });
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    await safeReply(interaction, {
      content: `Failed to create GOTM round ${nextRound}: ${msg}`,
    });
  }
}

export async function handleEditGotm(
  interaction: CommandInteraction,
  round: number,
): Promise<void> {
  const roundNumber = Number(round);
  if (!Number.isFinite(roundNumber)) {
    await safeReply(interaction, {
      content: "Invalid round number.",
    });
    return;
  }

  let entries: IGotmEntry[];
  try {
    entries = Gotm.getByRound(roundNumber);
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    await safeReply(interaction, {
      content: `Error loading GOTM data: ${msg}`,
    });
    return;
  }

  if (!entries.length) {
    await safeReply(interaction, {
      content: `No GOTM entry found for round ${roundNumber}.`,
    });
    return;
  }

  const entry = entries[0];

  const embedAssets = await buildGotmEntryEmbed(
    entry,
    interaction.guildId ?? undefined,
    interaction.client as any,
  );

  await safeReply(interaction, {
    content: `Editing GOTM round ${roundNumber}.`,
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
  let field: GotmDatabaseEditableField | null = null;
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
    await updateGotmGameFieldInDatabase(roundNumber, gameIndex, field!, newValue);

    let updatedEntry: IGotmEntry | null = null;
    if (field === "gamedbGameId") {
      updatedEntry = Gotm.updateGamedbIdByRound(roundNumber, newValue as number, gameIndex);
    } else if (field === "redditUrl") {
      updatedEntry = Gotm.updateRedditUrlByRound(roundNumber, newValue as string | null, gameIndex);
    }

    const entryToShow = updatedEntry ?? entry;
    const updatedAssets = await buildGotmEntryEmbed(
      entryToShow,
      interaction.guildId ?? undefined,
      interaction.client as any,
    );

    await safeReply(interaction, {
      content: `GOTM round ${roundNumber} updated successfully.`,
      embeds: [updatedAssets.embed],
      files: updatedAssets.files?.length ? updatedAssets.files : undefined,
    });
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    await safeReply(interaction, {
      content: `Failed to update GOTM round ${roundNumber}: ${msg}`,
    });
  }
}
