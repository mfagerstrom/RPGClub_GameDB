import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";
import Game from "./Game.js";
import { getThreadsByGameId } from "./Thread.js";

export interface INrGotmGame {
  id?: number | null;
  title: string;
  threadId: string | null;
  redditUrl: string | null;
  gamedbGameId: number;
}

export interface INrGotmEntry {
  round: number;
  monthYear: string;
  gameOfTheMonth: INrGotmGame[];
  votingResultsMessageId?: string | null;
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

let nrGotmData: INrGotmEntry[] = [];
let loadPromise: Promise<INrGotmEntry[]> | null = null;
let nrGotmLoaded = false;
const nrGameCache: Map<number, { title: string }> = new Map();

async function getNrGameDetailsCached(gameId: number): Promise<{ title: string }> {
  const cached = nrGameCache.get(gameId);
  if (cached) return cached;
  const game = await Game.getGameById(gameId);
  if (!game) {
    throw new Error(`GameDB game ${gameId} not found for NR-GOTM entry.`);
  }
  const payload = { title: game.title };
  nrGameCache.set(gameId, payload);
  return payload;
}

async function getPrimaryThreadIdForGame(gameId: number): Promise<string | null> {
  const threadIds = await getThreadsByGameId(gameId);
  return threadIds[0] ?? null;
}

async function loadFromDatabaseInternal(): Promise<INrGotmEntry[]> {
  const pool = getOraclePool();
  const connection = await pool.getConnection();

  try {
    const result = await connection.execute<{
      NR_GOTM_ID: number;
      ROUND_NUMBER: number;
      MONTH_YEAR: string;
      GAME_INDEX: number;
      REDDIT_URL: string | null;
      VOTING_RESULTS_MESSAGE_ID: string | null;
      GAMEDB_GAME_ID: number | null;
    }>(
      `SELECT ROUND_NUMBER,
              MONTH_YEAR,
              GAME_INDEX,
              REDDIT_URL,
              VOTING_RESULTS_MESSAGE_ID,
              GAMEDB_GAME_ID
         FROM NR_GOTM_ENTRIES
        ORDER BY ROUND_NUMBER, GAME_INDEX`,
      [],
      {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      },
    );

    const rows = result.rows ?? [];
    const byRound = new Map<number, INrGotmEntry>();

    for (const anyRow of rows as any[]) {
      const row = anyRow as {
        NR_GOTM_ID: number;
        ROUND_NUMBER: number;
        MONTH_YEAR: string;
        GAME_INDEX: number;
        REDDIT_URL: string | null;
        VOTING_RESULTS_MESSAGE_ID: string | null;
        GAMEDB_GAME_ID: number | null;
      };

      const round = Number(row.ROUND_NUMBER);
      if (!Number.isFinite(round)) continue;

      const monthYear = row.MONTH_YEAR;
      const votingId = row.VOTING_RESULTS_MESSAGE_ID ?? null;

      let entry = byRound.get(round);
      if (!entry) {
        entry = {
          round,
          monthYear,
          gameOfTheMonth: [],
        };
        if (votingId) {
          entry.votingResultsMessageId = votingId;
        }
        byRound.set(round, entry);
      } else if (!entry.votingResultsMessageId && votingId) {
        entry.votingResultsMessageId = votingId;
      }

      const gamedbGameId = Number(row.GAMEDB_GAME_ID);
      if (!Number.isInteger(gamedbGameId) || gamedbGameId <= 0) {
        throw new Error(`NR-GOTM round ${round} game ${row.GAME_INDEX} is missing GAMEDB_GAME_ID.`);
      }
      const gameDetails = await getNrGameDetailsCached(gamedbGameId);
      const derivedThreadId = await getPrimaryThreadIdForGame(gamedbGameId);

      const game: INrGotmGame = {
        id: Number(row.NR_GOTM_ID),
        title: gameDetails.title,
        threadId: derivedThreadId,
        redditUrl: row.REDDIT_URL ?? null,
        gamedbGameId,
      };

      entry.gameOfTheMonth.push(game);
    }

    const data = Array.from(byRound.values()).sort((a, b) => a.round - b.round);
    nrGotmData = data;
    nrGotmLoaded = true;
    return nrGotmData;
  } finally {
    await connection.close();
  }
}

export async function loadNrGotmFromDb(): Promise<void> {
  if (nrGotmLoaded) return;
  if (!loadPromise) {
    loadPromise = loadFromDatabaseInternal().catch((err) => {
      loadPromise = null;
      throw err;
    });
  }
  await loadPromise;
}

function ensureInitialized(): void {
  if (!nrGotmLoaded) {
    throw new Error("NR-GOTM data not initialized. Call loadNrGotmFromDb() during startup.");
  }
}

function parseYear(value: string): number | null {
  const m = value.match(/(\d{4})\s*$/);
  return m ? Number(m[1]) : null;
}

function parseMonthLabel(value: string): string {
  const label = value.replace(/\s*\d{4}\s*$/, "").trim();
  return label;
}

function monthNumberToName(month: number): string | null {
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return MONTHS[month - 1];
}

export default class NrGotm {
  static all(): INrGotmEntry[] {
    ensureInitialized();
    return nrGotmData.slice();
  }

  static getByRound(round: number): INrGotmEntry[] {
    ensureInitialized();
    return nrGotmData.filter((e) => e.round === round);
  }

  static getByYearMonth(year: number, month: number | string): INrGotmEntry[] {
    ensureInitialized();
    const yearNum = Number(year);
    if (!Number.isFinite(yearNum)) return [];

    const wantedLabel: string | null =
      typeof month === "number" ? monthNumberToName(month) : month?.trim() ?? null;

    if (!wantedLabel) return [];
    const wantedLower = wantedLabel.toLowerCase();

    return nrGotmData.filter((e) => {
      const y = parseYear(e.monthYear);
      if (y !== yearNum) return false;
      const labelLower = parseMonthLabel(e.monthYear).toLowerCase();
      return labelLower === wantedLower;
    });
  }

  static getByYear(year: number): INrGotmEntry[] {
    ensureInitialized();
    const yearNum = Number(year);
    if (!Number.isFinite(yearNum)) return [];
    return nrGotmData.filter((e) => parseYear(e.monthYear) === yearNum);
  }

  static searchByTitle(query: string): INrGotmEntry[] {
    ensureInitialized();
    if (!query?.trim()) return [];
    const q = query.toLowerCase();
    return nrGotmData.filter((e) =>
      e.gameOfTheMonth.some((g) => g.title.toLowerCase().includes(q)),
    );
  }

  static addRound(round: number, monthYear: string, games: INrGotmGame[]): INrGotmEntry {
    ensureInitialized();
    const r = Number(round);
    if (!Number.isFinite(r)) {
      throw new Error("Invalid round number for new NR-GOTM round.");
    }
    if (nrGotmData.some((e) => e.round === r)) {
      throw new Error(`NR-GOTM round ${r} already exists.`);
    }
    const entry: INrGotmEntry = {
      round: r,
      monthYear,
      gameOfTheMonth: games.map((g) => {
        if (!Number.isInteger(g.gamedbGameId) || g.gamedbGameId <= 0) {
          throw new Error("GameDB id is required for NR-GOTM entries.");
        }
        return {
          id: g.id ?? null,
          title: g.title,
          threadId: g.threadId ?? null,
          redditUrl: g.redditUrl ?? null,
          gamedbGameId: g.gamedbGameId,
        };
      }),
    };
    nrGotmData.push(entry);
    nrGotmData.sort((a, b) => a.round - b.round);
    return entry;
  }

  private static getRoundEntry(round: number): INrGotmEntry | null {
    ensureInitialized();
    const r = Number(round);
    if (!Number.isFinite(r)) return null;
    const entry = nrGotmData.find((e) => e.round === r) ?? null;
    return entry ?? null;
  }

  private static resolveIndex(entry: INrGotmEntry, index?: number): number {
    const arrLen = entry.gameOfTheMonth.length;
    if (arrLen === 0) throw new Error(`Round ${entry.round} has no games.`);
    if (arrLen === 1) return 0;
    if (index === undefined || index === null) {
      throw new Error(
        `Round ${entry.round} has ${arrLen} games; provide an index (0-${arrLen - 1}).`,
      );
    }
    if (!Number.isInteger(index) || index < 0 || index >= arrLen) {
      throw new Error(`Index ${index} out of bounds for round ${entry.round}.`);
    }
    return index;
  }

  static updateThreadIdByRound(
    round: number,
    threadId: string | null,
    index?: number,
  ): INrGotmEntry | null {
    const entry = this.getRoundEntry(round);
    if (!entry) return null;
    const i = this.resolveIndex(entry, index);
    entry.gameOfTheMonth[i].threadId = threadId === null ? null : String(threadId);
    return entry;
  }

  static updateRedditUrlByRound(
    round: number,
    redditUrl: string | null,
    index?: number,
  ): INrGotmEntry | null {
    const entry = this.getRoundEntry(round);
    if (!entry) return null;
    const i = this.resolveIndex(entry, index);
    entry.gameOfTheMonth[i].redditUrl = redditUrl;
    return entry;
  }

  static updateGamedbIdByRound(
    round: number,
    gamedbGameId: number,
    index?: number,
  ): INrGotmEntry | null {
    const entry = this.getRoundEntry(round);
    if (!entry) return null;
    if (!Number.isInteger(gamedbGameId) || gamedbGameId <= 0) {
      throw new Error("GameDB id must be a positive integer.");
    }
    const i = this.resolveIndex(entry, index);
    entry.gameOfTheMonth[i].gamedbGameId = gamedbGameId;
    void getNrGameDetailsCached(gamedbGameId).then((meta) => {
      entry.gameOfTheMonth[i].title = meta.title;
      nrGameCache.set(gamedbGameId, meta);
    });
    return entry;
  }

  static updateVotingResultsByRound(
    round: number,
    messageId: string | null,
  ): INrGotmEntry | null {
    const entry = this.getRoundEntry(round);
    if (!entry) return null;
    entry.votingResultsMessageId = messageId;
    return entry;
  }

  static deleteRound(round: number): INrGotmEntry | null {
    ensureInitialized();
    const r = Number(round);
    if (!Number.isFinite(r)) return null;
    const index = nrGotmData.findIndex((e) => e.round === r);
    if (index === -1) return null;
    const [removed] = nrGotmData.splice(index, 1);
    return removed ?? null;
  }
}

export type NrGotmDatabaseEditableField = "redditUrl" | "gamedbGameId";

export async function updateNrGotmGameFieldInDatabase(
  opts: {
    rowId?: number | null;
    round?: number;
    gameIndex?: number;
    field: NrGotmDatabaseEditableField;
    value: string | number | null;
  },
): Promise<void> {
  ensureInitialized();
  const pool = getOraclePool();
  const connection = await pool.getConnection();

  try {
    const columnMap: Record<NrGotmDatabaseEditableField, string> = {
      redditUrl: "REDDIT_URL",
      gamedbGameId: "GAMEDB_GAME_ID",
    };

    const columnName = columnMap[opts.field];

    // Prefer rowId if provided
    let dbValue = opts.value;

    if (opts.field === "gamedbGameId") {
      const newId = Number(opts.value);
      if (!Number.isInteger(newId) || newId <= 0) {
        throw new Error("GameDB id must be a positive integer.");
      }
      const exists = await getNrGameDetailsCached(newId);
      nrGameCache.set(newId, exists);
      dbValue = newId;
    }

    if (opts.rowId) {
      await connection.execute(
        `UPDATE NR_GOTM_ENTRIES
            SET ${columnName} = :bindValue
          WHERE NR_GOTM_ID = :rowIdValue`,
        {
          rowIdValue: opts.rowId,
          bindValue: dbValue,
        },
        { autoCommit: true },
      );
      const entryWithRow = nrGotmData.find((e) =>
        e.gameOfTheMonth.some((g) => Number(g.id) === Number(opts.rowId)),
      );
      if (entryWithRow) {
        for (const g of entryWithRow.gameOfTheMonth) {
          if (Number(g.id) === Number(opts.rowId)) {
            if (opts.field === "gamedbGameId") {
              const newId = dbValue as number;
              g.gamedbGameId = newId;
              const meta = await getNrGameDetailsCached(newId);
              g.title = meta.title;
              g.threadId = await getPrimaryThreadIdForGame(newId);
            } else if (opts.field === "redditUrl") {
              g.redditUrl = opts.value as string | null;
            }
          }
        }
      }
      return;
    }

    const round = opts.round;
    const gameIndex = opts.gameIndex;

    if (!Number.isInteger(round)) {
      throw new Error("round is required when rowId is not provided.");
    }
    if (!Number.isInteger(gameIndex)) {
      throw new Error("gameIndex is required when rowId is not provided.");
    }
    const result = await connection.execute<{
      NR_GOTM_ID: number;
      ROUND_NUMBER: number;
      GAME_INDEX: number;
    }>(
      `SELECT NR_GOTM_ID,
              ROUND_NUMBER,
              GAME_INDEX
         FROM NR_GOTM_ENTRIES
        WHERE ROUND_NUMBER = :roundNumber
        ORDER BY GAME_INDEX`,
      { roundNumber: round },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    const rows = (result.rows ?? []) as any[];

    if (!rows.length) {
      throw new Error(`No NR-GOTM database rows found for round ${round}.`);
    }

    const gi = Number(gameIndex);
    if (!Number.isInteger(gi) || gi < 0 || gi >= rows.length) {
      throw new Error(
        `Game index ${gameIndex} is out of range for NR-GOTM round ${round} (have ${rows.length} games).`,
      );
    }

    const targetRow = rows[gi] as {
      NR_GOTM_ID: number;
      ROUND_NUMBER: number;
      GAME_INDEX: number;
    };

    const rowId = targetRow.NR_GOTM_ID;

    await connection.execute(
      `UPDATE NR_GOTM_ENTRIES
          SET ${columnName} = :bindValue
        WHERE NR_GOTM_ID = :rowIdValue`,
      {
        rowIdValue: rowId,
        bindValue: dbValue,
      },
      { autoCommit: true },
    );
    const entry = nrGotmData.find((e) => e.round === round);
    if (entry && entry.gameOfTheMonth[gi]) {
      const target = entry.gameOfTheMonth[gi];
      if (opts.field === "gamedbGameId") {
        const newId = dbValue as number;
        target.gamedbGameId = newId;
        const meta = await getNrGameDetailsCached(newId);
        target.title = meta.title;
        target.threadId = await getPrimaryThreadIdForGame(newId);
      } else if (opts.field === "redditUrl") {
        target.redditUrl = opts.value as string | null;
      }
    }
  } finally {
    await connection.close();
  }
}

export async function updateNrGotmVotingResultsInDatabase(
  round: number,
  messageId: string | null,
): Promise<void> {
  const pool = getOraclePool();
  const connection = await pool.getConnection();

  try {
    await connection.execute(
      `UPDATE NR_GOTM_ENTRIES
          SET VOTING_RESULTS_MESSAGE_ID = :bindValue
        WHERE ROUND_NUMBER = :roundNumber`,
      { roundNumber: round, bindValue: messageId },
      { autoCommit: true },
    );
  } finally {
    await connection.close();
  }
}

export async function insertNrGotmRoundInDatabase(
  round: number,
  monthYear: string,
  games: INrGotmGame[],
): Promise<number[]> {
  if (!Number.isFinite(round) || round <= 0) {
    throw new Error("Invalid round number for NR-GOTM insert.");
  }
  if (!games.length) {
    throw new Error("At least one game is required for an NR-GOTM round.");
  }

  const pool = getOraclePool();
  const connection = await pool.getConnection();

  try {
    const existing = await connection.execute<{ CNT: number }>(
      `SELECT COUNT(*) AS CNT
         FROM NR_GOTM_ENTRIES
        WHERE ROUND_NUMBER = :roundNumber`,
      { roundNumber: round },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    const rows = (existing.rows ?? []) as any[];
    const count = rows.length ? Number((rows[0] as any).CNT) : 0;
    if (Number.isFinite(count) && count > 0) {
      throw new Error(`NR-GOTM round ${round} already exists in the database.`);
    }

    const insertedIds: number[] = [];

    for (let i = 0; i < games.length; i++) {
      const g = games[i];
      if (!Number.isInteger(g.gamedbGameId) || g.gamedbGameId <= 0) {
        throw new Error(`GameDB id is required for NR-GOTM round ${round}, game ${i + 1}.`);
      }
      const meta = await getNrGameDetailsCached(g.gamedbGameId);
      const result = await connection.execute(
        `INSERT INTO NR_GOTM_ENTRIES (
           ROUND_NUMBER,
           MONTH_YEAR,
           GAME_INDEX,
           REDDIT_URL,
           VOTING_RESULTS_MESSAGE_ID,
           GAMEDB_GAME_ID
         ) VALUES (
           :roundNumber,
           :monthYear,
           :gameIndex,
           :redditUrl,
           NULL,
           :gamedbGameId
         )
         RETURNING NR_GOTM_ID INTO :outId`,
        {
          roundNumber: round,
          monthYear,
          gameIndex: i,
          redditUrl: g.redditUrl ?? null,
          gamedbGameId: g.gamedbGameId,
          outId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        },
        { autoCommit: true },
      );

      const outIdArr: any = (result.outBinds as any)?.outId;
      const newId = Array.isArray(outIdArr) ? outIdArr[0] : outIdArr;
      if (newId !== undefined && newId !== null) {
        insertedIds.push(Number(newId));
      }

      games[i].title = meta.title;
    }

    return insertedIds;
  } finally {
    await connection.close();
  }
}

export async function deleteNrGotmRoundFromDatabase(round: number): Promise<number> {
  if (!Number.isFinite(round) || round <= 0) {
    throw new Error("Invalid round number for NR-GOTM delete.");
  }

  const pool = getOraclePool();
  const connection = await pool.getConnection();

  try {
    const result = await connection.execute(
      `DELETE FROM NR_GOTM_ENTRIES
        WHERE ROUND_NUMBER = :roundNumber`,
      { roundNumber: round },
      { autoCommit: true },
    );

    const rowsAffected = result.rowsAffected ?? 0;
    return rowsAffected;
  } finally {
    await connection.close();
  }
}
