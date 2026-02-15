import oracledb from "oracledb";
import { getOraclePool } from "../../db/oracleClient.js";
import Game from "../../classes/Game.js";
import { igdbService } from "./IgdbService.js";

type IgdbScanConfig = {
  enabled: boolean;
  intervalMs: number;
  batchSize: number;
  minAgeDays: number;
  throttleMs: number;
};

type IgdbScanCandidate = {
  gameId: number;
  title: string;
  igdbId: number;
  updatedAt: Date | null;
};

const DEFAULT_SCAN_INTERVAL_MINUTES = 15;
const DEFAULT_SCAN_BATCH_SIZE = 25;
const DEFAULT_SCAN_MIN_AGE_DAYS = 30;
const DEFAULT_SCAN_THROTTLE_MS = 300;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function parseNumberEnv(name: string, fallback: number, min?: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  if (min !== undefined && value < min) return fallback;
  return value;
}

function getScanConfig(): IgdbScanConfig {
  return {
    enabled: process.env.IGDB_SCAN_ENABLED !== "false",
    intervalMs: parseNumberEnv("IGDB_SCAN_INTERVAL_MINUTES", DEFAULT_SCAN_INTERVAL_MINUTES, 1)
      * 60
      * 1000,
    batchSize: parseNumberEnv("IGDB_SCAN_BATCH_SIZE", DEFAULT_SCAN_BATCH_SIZE, 1),
    minAgeDays: parseNumberEnv("IGDB_SCAN_MIN_AGE_DAYS", DEFAULT_SCAN_MIN_AGE_DAYS, 0),
    throttleMs: parseNumberEnv("IGDB_SCAN_THROTTLE_MS", DEFAULT_SCAN_THROTTLE_MS, 0),
  };
}

function hasIgdbConfig(): boolean {
  return Boolean(process.env.IGDB_CLIENT_ID && process.env.IGDB_CLIENT_SECRET);
}

async function listScanCandidates(
  connection: oracledb.Connection,
  cutoff: Date,
  limit: number,
): Promise<IgdbScanCandidate[]> {
  const result = await connection.execute<{
    GAME_ID: number;
    TITLE: string;
    IGDB_ID: number;
    UPDATED_AT: Date | null;
  }>(
    `SELECT *
       FROM (
            SELECT GAME_ID, TITLE, IGDB_ID, UPDATED_AT
              FROM GAMEDB_GAMES
             WHERE IGDB_ID IS NOT NULL
               AND (UPDATED_AT IS NULL OR UPDATED_AT < :cutoff)
             ORDER BY UPDATED_AT NULLS FIRST, GAME_ID
       )
      WHERE ROWNUM <= :limit`,
    { cutoff, limit },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );

  return (result.rows ?? []).map((row) => ({
    gameId: Number(row.GAME_ID),
    title: String(row.TITLE),
    igdbId: Number(row.IGDB_ID),
    updatedAt: row.UPDATED_AT ? new Date(row.UPDATED_AT) : null,
  }));
}

async function countScanCandidates(
  connection: oracledb.Connection,
  cutoff: Date,
): Promise<number> {
  const result = await connection.execute<{ TOTAL: number }>(
    `SELECT COUNT(*) AS TOTAL
       FROM GAMEDB_GAMES
      WHERE IGDB_ID IS NOT NULL
        AND (UPDATED_AT IS NULL OR UPDATED_AT < :cutoff)`,
    { cutoff },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );

  const row = (result.rows ?? [])[0] as { TOTAL?: number } | undefined;
  return Number(row?.TOTAL ?? 0);
}

export async function igdbScanTick(): Promise<void> {
  const config = getScanConfig();
  if (!config.enabled) return;
  if (!hasIgdbConfig()) {
    console.warn("[IGDB Scan] IGDB credentials not configured; skipping scan.");
    return;
  }

  const cutoff = new Date(Date.now() - (config.minAgeDays * 24 * 60 * 60 * 1000));
  const pool = getOraclePool();
  let connection: oracledb.Connection | null = null;

  try {
    connection = await pool.getConnection();
    const totalEligible = await countScanCandidates(connection, cutoff);
    const candidates = await listScanCandidates(connection, cutoff, config.batchSize);
    if (!candidates.length) {
      console.log(
        "[IGDB Scan] No games queued for refresh.",
        `Interval: ${(config.intervalMs / 60000).toFixed(1)}m,`,
        `Batch: ${config.batchSize},`,
        `Min age: ${config.minAgeDays}d,`,
        `Remaining: ${totalEligible}.`,
      );
      return;
    }

    let successCount = 0;
    let failCount = 0;
    let releaseUpdated = 0;
    let descriptionUpdated = 0;
    const startedAt = Date.now();

    for (const candidate of candidates) {
      try {
        const details = await igdbService.getGameDetails(candidate.igdbId);
        if (!details) {
          const missingDetailsMessage =
            `[IGDB Scan] No IGDB details returned for ${candidate.title} ` +
            `(ID: ${candidate.gameId}).`;
          console.warn(missingDetailsMessage);
          await Game.touchGameUpdatedAt(candidate.gameId);
          continue;
        }

        const summary = details.summary?.trim() ?? "";
        if (summary.length > 0) {
          await Game.updateGameDescription(candidate.gameId, summary);
          descriptionUpdated++;
        }

        const releases = details.release_dates ?? [];
        if (releases.length > 0) {
          await Game.refreshReleaseDates(candidate.gameId, releases);
          releaseUpdated++;
        }

        await Game.touchGameUpdatedAt(candidate.gameId);
        successCount++;

        if (config.throttleMs > 0) {
          await sleep(config.throttleMs);
        }
      } catch (err: any) {
        failCount++;
        console.error(
          `[IGDB Scan] Failed to refresh ${candidate.title} (ID: ${candidate.gameId}):`,
          err?.message ?? err,
        );
      }
    }

    const elapsedMs = Date.now() - startedAt;
    const remaining = Math.max(totalEligible - candidates.length, 0);
    console.log(
      "[IGDB Scan] Completed batch.",
      `Interval: ${(config.intervalMs / 60000).toFixed(1)}m,`,
      `Batch: ${config.batchSize},`,
      `Min age: ${config.minAgeDays}d,`,
      `Total eligible: ${totalEligible},`,
      `Remaining: ${remaining},`,
      `Success: ${successCount}, Failed: ${failCount},`,
      `Descriptions: ${descriptionUpdated}, Releases: ${releaseUpdated},`,
      `Elapsed: ${(elapsedMs / 1000).toFixed(1)}s.`,
    );
  } catch (err) {
    console.error("[IGDB Scan] Batch failed:", err);
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeErr) {
        console.error("[IGDB Scan] Error closing connection:", closeErr);
      }
    }
  }
}

export function startIgdbScanService(): void {
  const config = getScanConfig();
  if (!config.enabled) {
    console.log("[IGDB Scan] IGDB_SCAN_ENABLED is false; service disabled.");
    return;
  }

  let isRunning = false;
  const tick = async () => {
    if (isRunning) {
      console.warn("[IGDB Scan] Previous scan still running; skipping.");
      return;
    }
    isRunning = true;
    try {
      await igdbScanTick();
    } finally {
      isRunning = false;
    }
  };

  void tick();
  setInterval(() => {
    void tick();
  }, config.intervalMs);
}
