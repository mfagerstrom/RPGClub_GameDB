import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";

export interface IMemberRecord {
  userId: string;
  isBot: number;
  username: string | null;
  globalName: string | null;
  avatarBlob: Buffer | null;
  serverJoinedAt: Date | null;
  serverLeftAt: Date | null;
  lastSeenAt: Date | null;
  roleAdmin: number;
  roleModerator: number;
  roleRegular: number;
  roleMember: number;
  roleNewcomer: number;
  messageCount: number | null;
  completionatorUrl: string | null;
  psnUsername: string | null;
  xblUsername: string | null;
  nswFriendCode: string | null;
  steamUrl: string | null;
  profileImage: Buffer | null;
  profileImageAt: Date | null;
}

export interface IMemberPlatformRecord {
  userId: string;
  username: string | null;
  globalName: string | null;
  steamUrl: string | null;
  psnUsername: string | null;
  xblUsername: string | null;
  nswFriendCode: string | null;
}

export interface IMemberSearchFilters {
  userId?: string;
  username?: string;
  globalName?: string;
  completionatorUrl?: string;
  steamUrl?: string;
  psnUsername?: string;
  xblUsername?: string;
  nswFriendCode?: string;
  roleAdmin?: boolean;
  roleModerator?: boolean;
  roleRegular?: boolean;
  roleMember?: boolean;
  roleNewcomer?: boolean;
  isBot?: boolean;
  includeDeparted?: boolean;
  joinedAfter?: Date;
  joinedBefore?: Date;
  lastSeenAfter?: Date;
  lastSeenBefore?: Date;
  limit?: number;
}

export interface IMemberSearchResult {
  userId: string;
  username: string | null;
  globalName: string | null;
  isBot: number;
  completionatorUrl: string | null;
  steamUrl: string | null;
  psnUsername: string | null;
  xblUsername: string | null;
  nswFriendCode: string | null;
  roleAdmin: number;
  roleModerator: number;
  roleRegular: number;
  roleMember: number;
  roleNewcomer: number;
  serverJoinedAt: Date | null;
  serverLeftAt: Date | null;
  lastSeenAt: Date | null;
}

export interface IMemberNickHistory {
  oldNick: string | null;
  newNick: string | null;
  changedAt: Date;
}

export interface IMemberNowPlayingEntry {
  gameId: number;
  title: string;
  platformId: number | null;
  platformName: string | null;
  platformAbbreviation: string | null;
  threadId: string | null;
  note: string | null;
  addedAt: Date | null;
  noteUpdatedAt: Date | null;
  sortOrder: number | null;
}

export interface IMemberNowPlayingList {
  userId: string;
  username: string | null;
  globalName: string | null;
  entries: IMemberNowPlayingEntry[];
}

export interface IAvatarHistoryRecord {
  eventId: number;
  userId: string;
  avatarHash: string | null;
  avatarUrl: string | null;
  avatarBlob: Buffer | null;
  changedAt: Date;
}

export interface ICompletionRecord {
  completionId: number;
  gameId: number;
  title: string;
  completionType: string;
  platformId: number | null;
  completedAt: Date | null;
  finalPlaytimeHours: number | null;
  createdAt: Date;
  threadId: string | null;
  note: string | null;
}

type Connection = oracledb.Connection;
const MAX_NOW_PLAYING = 10;

function buildParams(record: IMemberRecord) {
  return {
    userId: record.userId,
    isBot: record.isBot ? 1 : 0,
    username: record.username,
    globalName: record.globalName,
    avatarBlob: record.avatarBlob,
    joinedAt: record.serverJoinedAt,
    leftAt: record.serverLeftAt,
    lastSeenAt: record.lastSeenAt,
    roleAdmin: record.roleAdmin ? 1 : 0,
    roleModerator: record.roleModerator ? 1 : 0,
    roleRegular: record.roleRegular ? 1 : 0,
    roleMember: record.roleMember ? 1 : 0,
    roleNewcomer: record.roleNewcomer ? 1 : 0,
    completionatorUrl: record.completionatorUrl,
    psnUsername: record.psnUsername,
    xblUsername: record.xblUsername,
    nswFriendCode: record.nswFriendCode,
    steamUrl: record.steamUrl,
  };
}

export default class Member {
  static async touchLastSeen(userId: string, when: Date = new Date()): Promise<void> {
    const connection = await getOraclePool().getConnection();
    try {
      await connection.execute(
        `UPDATE RPG_CLUB_USERS
            SET LAST_SEEN_AT = :lastSeen,
                UPDATED_AT = SYSTIMESTAMP
          WHERE USER_ID = :userId`,
        { userId, lastSeen: when },
        { autoCommit: true },
      );
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error(`[Member] Failed to update last seen for ${userId}: ${msg}`);
    } finally {
      await connection.close();
    }
  }

  static async getNowPlaying(
    userId: string,
  ): Promise<IMemberNowPlayingEntry[]> {
    const connection = await getOraclePool().getConnection();
    try {
      const res = await connection.execute<{
        GAME_ID: number;
        TITLE: string;
        PLATFORM_ID: number | null;
        PLATFORM_NAME: string | null;
        PLATFORM_ABBREVIATION: string | null;
        THREAD_ID: string | null;
        NOTE: string | null;
        ADDED_AT: Date | string | null;
        NOTE_UPDATED_AT: Date | string | null;
        SORT_ORDER: number | null;
      }>(
        `SELECT g.GAME_ID,
                g.TITLE,
                u.PLATFORM_ID,
                p.PLATFORM_NAME,
                p.PLATFORM_ABBREVIATION,
                COALESCE(
                  (
                    SELECT MIN(tgl.THREAD_ID)
                    FROM THREAD_GAME_LINKS tgl
                    WHERE tgl.GAMEDB_GAME_ID = u.GAMEDB_GAME_ID
                  ),
                  (
                    SELECT MIN(th.THREAD_ID)
                    FROM THREADS th
                    WHERE th.GAMEDB_GAME_ID = u.GAMEDB_GAME_ID
                  )
                ) AS THREAD_ID,
                u.NOTE,
                u.ADDED_AT,
                u.NOTE_UPDATED_AT,
                u.SORT_ORDER
           FROM USER_NOW_PLAYING u
           JOIN GAMEDB_GAMES g ON g.GAME_ID = u.GAMEDB_GAME_ID
           LEFT JOIN GAMEDB_PLATFORMS p ON p.PLATFORM_ID = u.PLATFORM_ID
          WHERE u.USER_ID = :userId
            AND u.GAMEDB_GAME_ID IS NOT NULL
          ORDER BY u.SORT_ORDER NULLS LAST, u.ADDED_AT DESC, u.ENTRY_ID DESC`,
        { userId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return (res.rows ?? [])
        .map((r) => ({
          gameId: Number(r.GAME_ID),
          title: r.TITLE,
          platformId: r.PLATFORM_ID == null ? null : Number(r.PLATFORM_ID),
          platformName: r.PLATFORM_NAME ?? null,
          platformAbbreviation: r.PLATFORM_ABBREVIATION ?? null,
          threadId: r.THREAD_ID ?? null,
          note: r.NOTE ?? null,
          addedAt: r.ADDED_AT instanceof Date
            ? r.ADDED_AT
            : r.ADDED_AT
              ? new Date(r.ADDED_AT as any)
              : null,
          noteUpdatedAt: r.NOTE_UPDATED_AT instanceof Date
            ? r.NOTE_UPDATED_AT
            : r.NOTE_UPDATED_AT
              ? new Date(r.NOTE_UPDATED_AT as any)
              : null,
          sortOrder: r.SORT_ORDER == null ? null : Number(r.SORT_ORDER),
        }))
        .slice(0, MAX_NOW_PLAYING);
    } finally {
      await connection.close();
    }
  }

  static async getAllNowPlaying(): Promise<IMemberNowPlayingList[]> {
    const connection = await getOraclePool().getConnection();
    try {
      const res = await connection.execute<{
        USER_ID: string;
        USERNAME: string | null;
        GLOBAL_NAME: string | null;
        GAME_ID: number;
        TITLE: string;
        PLATFORM_ID: number | null;
        PLATFORM_NAME: string | null;
        PLATFORM_ABBREVIATION: string | null;
        THREAD_ID: string | null;
        NOTE: string | null;
        ADDED_AT: Date | string | null;
        NOTE_UPDATED_AT: Date | string | null;
      }>(
        `SELECT u.USER_ID,
                ru.USERNAME,
                ru.GLOBAL_NAME,
                g.GAME_ID,
                g.TITLE,
                u.PLATFORM_ID,
                p.PLATFORM_NAME,
                p.PLATFORM_ABBREVIATION,
                COALESCE(
                  (
                    SELECT MIN(tgl.THREAD_ID)
                    FROM THREAD_GAME_LINKS tgl
                    WHERE tgl.GAMEDB_GAME_ID = u.GAMEDB_GAME_ID
                  ),
                  (
                    SELECT MIN(th.THREAD_ID)
                    FROM THREADS th
                    WHERE th.GAMEDB_GAME_ID = u.GAMEDB_GAME_ID
                  )
                ) AS THREAD_ID,
                u.NOTE,
                u.ADDED_AT,
                u.NOTE_UPDATED_AT,
                u.ENTRY_ID
           FROM USER_NOW_PLAYING u
           JOIN RPG_CLUB_USERS ru ON ru.USER_ID = u.USER_ID
           JOIN GAMEDB_GAMES g ON g.GAME_ID = u.GAMEDB_GAME_ID
           LEFT JOIN GAMEDB_PLATFORMS p ON p.PLATFORM_ID = u.PLATFORM_ID
          WHERE NVL(ru.IS_BOT, 0) = 0
            AND ru.SERVER_LEFT_AT IS NULL
          ORDER BY COALESCE(ru.GLOBAL_NAME, ru.USERNAME, ru.USER_ID),
                   u.ADDED_AT DESC,
                   u.ENTRY_ID DESC`,
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      const grouped = new Map<string, IMemberNowPlayingList>();
      for (const row of res.rows ?? []) {
        let record = grouped.get(row.USER_ID);
        if (!record) {
          record = {
            userId: row.USER_ID,
            username: row.USERNAME ?? null,
            globalName: row.GLOBAL_NAME ?? null,
            entries: [],
          };
          grouped.set(row.USER_ID, record);
        }

        if (record.entries.length < MAX_NOW_PLAYING) {
          record.entries.push({
            gameId: Number(row.GAME_ID),
            title: row.TITLE,
            platformId: row.PLATFORM_ID == null ? null : Number(row.PLATFORM_ID),
            platformName: row.PLATFORM_NAME ?? null,
            platformAbbreviation: row.PLATFORM_ABBREVIATION ?? null,
            threadId: row.THREAD_ID ?? null,
            note: row.NOTE ?? null,
            addedAt: row.ADDED_AT instanceof Date
              ? row.ADDED_AT
              : row.ADDED_AT
                ? new Date(row.ADDED_AT as any)
                : null,
            noteUpdatedAt: row.NOTE_UPDATED_AT instanceof Date
              ? row.NOTE_UPDATED_AT
              : row.NOTE_UPDATED_AT
                ? new Date(row.NOTE_UPDATED_AT as any)
                : null,
            sortOrder: null,
          });
        }
      }

      return Array.from(grouped.values()).sort((a, b) => {
        const aName = (a.globalName ?? a.username ?? a.userId).toLowerCase();
        const bName = (b.globalName ?? b.username ?? b.userId).toLowerCase();
        return aName.localeCompare(bName);
      });
    } finally {
      await connection.close();
    }
  }

  static async getNowPlayingByGameIds(
    gameIds: number[],
  ): Promise<{ gameId: number; title: string; userId: string }[]> {
    if (!gameIds.length) return [];
    const connection = await getOraclePool().getConnection();
    const placeholders = gameIds.map((_, idx) => `:id${idx}`);
    const binds: Record<string, number> = {};
    gameIds.forEach((id, idx) => {
      binds[`id${idx}`] = id;
    });

    try {
      const res = await connection.execute<{
        GAME_ID: number;
        TITLE: string;
        USER_ID: string;
      }>(
        `SELECT u.GAMEDB_GAME_ID AS GAME_ID,
                g.TITLE,
                u.USER_ID
           FROM USER_NOW_PLAYING u
           JOIN RPG_CLUB_USERS ru ON ru.USER_ID = u.USER_ID
           JOIN GAMEDB_GAMES g ON g.GAME_ID = u.GAMEDB_GAME_ID
          WHERE u.GAMEDB_GAME_ID IN (${placeholders.join(", ")})
            AND NVL(ru.IS_BOT, 0) = 0
            AND ru.SERVER_LEFT_AT IS NULL
          ORDER BY g.TITLE, u.USER_ID`,
        binds,
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return (res.rows ?? []).map((row) => ({
        gameId: Number(row.GAME_ID),
        title: row.TITLE,
        userId: row.USER_ID,
      }));
    } finally {
      await connection.close();
    }
  }

  static async getNowPlayingByTitleSearch(
    query: string,
  ): Promise<{ gameId: number; title: string; userId: string }[]> {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return [];
    const connection = await getOraclePool().getConnection();
    const searchQuery = `%${trimmed}%`;
    const normalizedQuery = `%${trimmed.replace(/[^a-z0-9]/g, "")}%`;
    try {
      const res = await connection.execute<{
        GAME_ID: number;
        TITLE: string;
        USER_ID: string;
      }>(
        `SELECT u.GAMEDB_GAME_ID AS GAME_ID,
                g.TITLE,
                u.USER_ID
           FROM USER_NOW_PLAYING u
           JOIN RPG_CLUB_USERS ru ON ru.USER_ID = u.USER_ID
           JOIN GAMEDB_GAMES g ON g.GAME_ID = u.GAMEDB_GAME_ID
          WHERE (LOWER(g.TITLE) LIKE :searchQuery
              OR REGEXP_REPLACE(LOWER(g.TITLE), '[^a-z0-9]', '') LIKE :normalizedQuery)
            AND NVL(ru.IS_BOT, 0) = 0
            AND ru.SERVER_LEFT_AT IS NULL
          ORDER BY g.TITLE, u.USER_ID`,
        { searchQuery, normalizedQuery },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return (res.rows ?? []).map((row) => ({
        gameId: Number(row.GAME_ID),
        title: row.TITLE,
        userId: row.USER_ID,
      }));
    } finally {
      await connection.close();
    }
  }

  static async getNowPlayingEntries(
    userId: string,
  ): Promise<{
    gameId: number;
    title: string;
    platformId: number | null;
    platformName: string | null;
    platformAbbreviation: string | null;
    note: string | null;
    addedAt: Date | null;
    noteUpdatedAt: Date | null;
    sortOrder: number | null;
  }[]> {
    const connection = await getOraclePool().getConnection();
    try {
      const res = await connection.execute<{
        GAME_ID: number;
        TITLE: string;
        PLATFORM_ID: number | null;
        PLATFORM_NAME: string | null;
        PLATFORM_ABBREVIATION: string | null;
        NOTE: string | null;
        ADDED_AT: Date | string | null;
        NOTE_UPDATED_AT: Date | string | null;
        SORT_ORDER: number | null;
      }>(
        `SELECT u.GAMEDB_GAME_ID AS GAME_ID,
                g.TITLE,
                u.PLATFORM_ID,
                p.PLATFORM_NAME,
                p.PLATFORM_ABBREVIATION,
                u.NOTE,
                u.ADDED_AT,
                u.NOTE_UPDATED_AT,
                u.SORT_ORDER
           FROM USER_NOW_PLAYING u
           JOIN GAMEDB_GAMES g ON g.GAME_ID = u.GAMEDB_GAME_ID
           LEFT JOIN GAMEDB_PLATFORMS p ON p.PLATFORM_ID = u.PLATFORM_ID
          WHERE u.USER_ID = :userId
            AND u.GAMEDB_GAME_ID IS NOT NULL
          ORDER BY u.SORT_ORDER NULLS LAST, u.ADDED_AT DESC, u.ENTRY_ID DESC`,
        { userId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return (res.rows ?? []).map((r) => ({
        gameId: Number(r.GAME_ID),
        title: r.TITLE,
        platformId: r.PLATFORM_ID == null ? null : Number(r.PLATFORM_ID),
        platformName: r.PLATFORM_NAME ?? null,
        platformAbbreviation: r.PLATFORM_ABBREVIATION ?? null,
        note: r.NOTE ?? null,
        addedAt: r.ADDED_AT instanceof Date
          ? r.ADDED_AT
          : r.ADDED_AT
            ? new Date(r.ADDED_AT as any)
            : null,
        noteUpdatedAt: r.NOTE_UPDATED_AT instanceof Date
          ? r.NOTE_UPDATED_AT
          : r.NOTE_UPDATED_AT
            ? new Date(r.NOTE_UPDATED_AT as any)
            : null,
        sortOrder: r.SORT_ORDER == null ? null : Number(r.SORT_ORDER),
      }));
    } finally {
      await connection.close();
    }
  }

  static async getNowPlayingEntryMeta(
    userId: string,
    gameId: number,
  ): Promise<{ addedAt: Date | null } | null> {
    if (!Number.isInteger(gameId) || gameId <= 0) {
      throw new Error("Invalid GameDB id.");
    }
    const connection = await getOraclePool().getConnection();
    try {
      const res = await connection.execute<{
        ADDED_AT: Date | string | null;
      }>(
        `SELECT ADDED_AT
           FROM USER_NOW_PLAYING
          WHERE USER_ID = :userId
            AND GAMEDB_GAME_ID = :gameId`,
        { userId, gameId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const row = res.rows?.[0];
      if (!row) {
        return null;
      }
      const addedAt = row.ADDED_AT instanceof Date
        ? row.ADDED_AT
        : row.ADDED_AT
          ? new Date(row.ADDED_AT as any)
          : null;
      return { addedAt };
    } finally {
      await connection.close();
    }
  }

  static async updateNowPlayingNote(
    userId: string,
    gameId: number,
    note: string | null,
  ): Promise<boolean> {
    if (!Number.isInteger(gameId) || gameId <= 0) {
      throw new Error("Invalid GameDB id.");
    }
    const connection = await getOraclePool().getConnection();
    const normalizedNote = note?.trim();
    const noteValue = normalizedNote ? normalizedNote : null;
    const noteUpdatedAt = noteValue ? new Date() : null;

    try {
      const res = await connection.execute(
        `UPDATE USER_NOW_PLAYING
            SET NOTE = :note,
                NOTE_UPDATED_AT = :noteUpdatedAt
          WHERE USER_ID = :userId
            AND GAMEDB_GAME_ID = :gameId`,
        { userId, gameId, note: noteValue, noteUpdatedAt },
        { autoCommit: true },
      );
      return (res.rowsAffected ?? 0) > 0;
    } finally {
      await connection.close();
    }
  }

  static async addNowPlaying(
    userId: string,
    gameId: number,
    platformId: number,
    note: string | null = null,
  ): Promise<void> {
    if (!Number.isInteger(gameId) || gameId <= 0) {
      throw new Error("Invalid GameDB id.");
    }
    if (!Number.isInteger(platformId) || platformId <= 0) {
      throw new Error("Invalid platform selection.");
    }
    const connection = await getOraclePool().getConnection();
    const normalizedNote = note?.trim();
    const noteValue = normalizedNote ? normalizedNote : null;
    const noteUpdatedAt = noteValue ? new Date() : null;

    try {
      const countRes = await connection.execute<{ CNT: number }>(
        `SELECT COUNT(*) AS CNT FROM USER_NOW_PLAYING WHERE USER_ID = :userId`,
        { userId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const count = Number((countRes.rows ?? [])[0]?.CNT ?? 0);
      if (count >= MAX_NOW_PLAYING) {
        throw new Error(`You can only track up to ${MAX_NOW_PLAYING} Now Playing titles.`);
      }

      const sortRes = await connection.execute<{ MAX_SORT: number | null }>(
        `SELECT MAX(SORT_ORDER) AS MAX_SORT
           FROM USER_NOW_PLAYING
          WHERE USER_ID = :userId`,
        { userId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const maxSort = Number((sortRes.rows ?? [])[0]?.MAX_SORT ?? 0);
      const nextSort = maxSort + 1;

      await connection.execute(
        `INSERT INTO USER_NOW_PLAYING
          (USER_ID, GAMEDB_GAME_ID, PLATFORM_ID, NOTE, NOTE_UPDATED_AT, SORT_ORDER)
         VALUES (:userId, :gameId, :platformId, :note, :noteUpdatedAt, :sortOrder)`,
        { userId, gameId, platformId, note: noteValue, noteUpdatedAt, sortOrder: nextSort },
        { autoCommit: true },
      );
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (/unique/i.test(msg) || /UQ_USER_NOW_PLAYING/i.test(msg)) {
        throw new Error("That title is already in your Now Playing list.");
      }
      throw err;
    } finally {
      await connection.close();
    }
  }

  static async updateNowPlayingSort(
    userId: string,
    orderedGameIds: number[],
  ): Promise<boolean> {
    if (!orderedGameIds.length) return false;
    const connection = await getOraclePool().getConnection();
    try {
      const binds = orderedGameIds.map((gameId, idx) => ({
        userId,
        gameId,
        sortOrder: idx + 1,
      }));
      const result = await connection.executeMany(
        `UPDATE USER_NOW_PLAYING
            SET SORT_ORDER = :sortOrder
          WHERE USER_ID = :userId
            AND GAMEDB_GAME_ID = :gameId`,
        binds,
        { autoCommit: true },
      );
      return (result.rowsAffected ?? 0) > 0;
    } finally {
      await connection.close();
    }
  }

  static async removeNowPlaying(userId: string, gameId: number): Promise<boolean> {
    if (!Number.isInteger(gameId) || gameId <= 0) {
      throw new Error("Invalid GameDB id.");
    }
    const connection = await getOraclePool().getConnection();

    try {
      const res = await connection.execute(
        `DELETE FROM USER_NOW_PLAYING WHERE USER_ID = :userId AND GAMEDB_GAME_ID = :gameId`,
        { userId, gameId },
        { autoCommit: true },
      );
      const rows = (res as any).rowsAffected ?? 0;
      return rows > 0;
    } finally {
      await connection.close();
    }
  }

  static async addCompletion(params: {
    userId: string;
    gameId: number;
    completionType: string;
    platformId: number | null;
    completedAt?: Date | null;
    finalPlaytimeHours?: number | null;
    note?: string | null;
  }): Promise<number> {
    const {
      userId,
      gameId,
      completionType,
      platformId,
      completedAt,
      finalPlaytimeHours,
      note,
    } = params;
    if (!Number.isInteger(gameId) || gameId <= 0) {
      throw new Error("Invalid GameDB id.");
    }
    if (platformId != null && (!Number.isInteger(platformId) || platformId <= 0)) {
      throw new Error("Invalid platform selection.");
    }
    if (finalPlaytimeHours != null) {
      if (!Number.isFinite(finalPlaytimeHours) || finalPlaytimeHours < 0) {
        throw new Error("Playtime must be a non-negative number.");
      }
      const maxPlaytime = 999999.99;
      if (finalPlaytimeHours > maxPlaytime) {
        throw new Error(`Playtime must be ${maxPlaytime} hours or less.`);
      }
      const rounded = Math.round(finalPlaytimeHours * 100) / 100;
      if (Math.abs(finalPlaytimeHours - rounded) > 0.000001) {
        throw new Error("Playtime must have at most 2 decimal places.");
      }
    }
    const connection = await getOraclePool().getConnection();
    const normalizedNote = note?.trim();
    const noteValue = normalizedNote ? normalizedNote : null;

    try {
      const result = await connection.execute<{ COMPLETION_ID: number }>(
        `
        INSERT INTO USER_GAME_COMPLETIONS (
          USER_ID, GAMEDB_GAME_ID, COMPLETION_TYPE, PLATFORM_ID,
          COMPLETED_AT, FINAL_PLAYTIME_HRS, NOTE
        ) VALUES (
          :userId, :gameId, :type, :platformId, :completedAt, :playtime, :note
        )
        RETURNING COMPLETION_ID INTO :completionId
        `,
        {
          userId,
          gameId,
          type: completionType,
          platformId,
          completedAt: completedAt ?? null,
          playtime: finalPlaytimeHours ?? null,
          note: noteValue,
          completionId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        },
        { autoCommit: false },
      );

      const id = (result.outBinds as any)?.completionId?.[0];
      if (!id) throw new Error("Failed to save completion (no id returned).");

      const verify = await connection.execute<{ CNT: number }>(
        `SELECT COUNT(*) AS CNT FROM USER_GAME_COMPLETIONS WHERE COMPLETION_ID = :id AND USER_ID = :userId`,
        { id, userId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const exists = Number((verify.rows ?? [])[0]?.CNT ?? 0) > 0;
      if (!exists) {
        throw new Error("Completion insert verification failed (row not found after insert).");
      }

      await connection.commit();
      return Number(id);
    } catch (err) {
      await connection.rollback().catch(() => {});
      throw err;
    } finally {
      await connection.close();
    }
  }

  static async getCompletion(completionId: number): Promise<ICompletionRecord | null> {
    const connection = await getOraclePool().getConnection();
    try {
      const res = await connection.execute<{
        COMPLETION_ID: number;
        GAME_ID: number;
        TITLE: string;
        COMPLETION_TYPE: string;
        PLATFORM_ID: number | null;
        COMPLETED_AT: Date | null;
        FINAL_PLAYTIME_HRS: number | null;
        CREATED_AT: Date;
        THREAD_ID: string | null;
        NOTE: string | null;
      }>(
        `
        SELECT c.COMPLETION_ID,
               g.GAME_ID,
               g.TITLE,
               c.COMPLETION_TYPE,
               c.PLATFORM_ID,
               c.COMPLETED_AT,
               c.FINAL_PLAYTIME_HRS,
               c.CREATED_AT,
               c.NOTE,
               COALESCE(
                  (
                    SELECT MIN(tgl.THREAD_ID)
                    FROM THREAD_GAME_LINKS tgl
                    WHERE tgl.GAMEDB_GAME_ID = c.GAMEDB_GAME_ID
                  ),
                  (
                    SELECT MIN(th.THREAD_ID)
                    FROM THREADS th
                    WHERE th.GAMEDB_GAME_ID = c.GAMEDB_GAME_ID
                  )
                ) AS THREAD_ID
          FROM USER_GAME_COMPLETIONS c
          JOIN GAMEDB_GAMES g ON g.GAME_ID = c.GAMEDB_GAME_ID
         WHERE c.COMPLETION_ID = :completionId
        `,
        { completionId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      const row = (res.rows ?? [])[0];
      if (!row) return null;

      return {
        completionId: Number(row.COMPLETION_ID),
        gameId: Number(row.GAME_ID),
        title: String(row.TITLE),
        completionType: String(row.COMPLETION_TYPE),
        platformId: row.PLATFORM_ID ? Number(row.PLATFORM_ID) : null,
        completedAt:
          row.COMPLETED_AT instanceof Date
            ? row.COMPLETED_AT
            : row.COMPLETED_AT
              ? new Date(row.COMPLETED_AT as any)
              : null,
        finalPlaytimeHours:
          row.FINAL_PLAYTIME_HRS == null ? null : Number(row.FINAL_PLAYTIME_HRS),
        createdAt:
          row.CREATED_AT instanceof Date
            ? row.CREATED_AT
            : row.CREATED_AT
              ? new Date(row.CREATED_AT as any)
              : new Date(),
        threadId: row.THREAD_ID ?? null,
        note: row.NOTE ?? null,
      };
    } finally {
      await connection.close();
    }
  }

  static async getCompletionForUser(
    userId: string,
    completionId: number,
  ): Promise<ICompletionRecord | null> {
    const connection = await getOraclePool().getConnection();
    try {
      const res = await connection.execute<{
        COMPLETION_ID: number;
        GAME_ID: number;
        TITLE: string;
        COMPLETION_TYPE: string;
        PLATFORM_ID: number | null;
        COMPLETED_AT: Date | null;
        FINAL_PLAYTIME_HRS: number | null;
        CREATED_AT: Date;
        THREAD_ID: string | null;
        NOTE: string | null;
      }>(
        `
        SELECT c.COMPLETION_ID,
               g.GAME_ID,
               g.TITLE,
               c.COMPLETION_TYPE,
               c.PLATFORM_ID,
               c.COMPLETED_AT,
               c.FINAL_PLAYTIME_HRS,
               c.CREATED_AT,
               c.NOTE,
               COALESCE(
                  (
                    SELECT MIN(tgl.THREAD_ID)
                    FROM THREAD_GAME_LINKS tgl
                    WHERE tgl.GAMEDB_GAME_ID = c.GAMEDB_GAME_ID
                  ),
                  (
                    SELECT MIN(th.THREAD_ID)
                    FROM THREADS th
                    WHERE th.GAMEDB_GAME_ID = c.GAMEDB_GAME_ID
                  )
                ) AS THREAD_ID
          FROM USER_GAME_COMPLETIONS c
          JOIN GAMEDB_GAMES g ON g.GAME_ID = c.GAMEDB_GAME_ID
         WHERE c.USER_ID = :userId
           AND c.COMPLETION_ID = :completionId
        `,
        { userId, completionId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      const row = (res.rows ?? [])[0];
      if (!row) return null;

      return {
        completionId: Number(row.COMPLETION_ID),
        gameId: Number(row.GAME_ID),
        title: String(row.TITLE),
        completionType: String(row.COMPLETION_TYPE),
        platformId: row.PLATFORM_ID ? Number(row.PLATFORM_ID) : null,
        completedAt:
          row.COMPLETED_AT instanceof Date
            ? row.COMPLETED_AT
            : row.COMPLETED_AT
              ? new Date(row.COMPLETED_AT as any)
              : null,
        finalPlaytimeHours:
          row.FINAL_PLAYTIME_HRS == null ? null : Number(row.FINAL_PLAYTIME_HRS),
        createdAt:
          row.CREATED_AT instanceof Date
            ? row.CREATED_AT
            : row.CREATED_AT
              ? new Date(row.CREATED_AT as any)
              : new Date(),
        threadId: row.THREAD_ID ?? null,
        note: row.NOTE ?? null,
      };
    } finally {
      await connection.close();
    }
  }

  static async getCompletionByGameId(
    userId: string,
    gameId: number,
  ): Promise<ICompletionRecord | null> {
    if (!Number.isInteger(gameId) || gameId <= 0) {
      throw new Error("Invalid GameDB id.");
    }
    const connection = await getOraclePool().getConnection();
    try {
      const res = await connection.execute<{
        COMPLETION_ID: number;
        GAME_ID: number;
        TITLE: string;
        COMPLETION_TYPE: string;
        PLATFORM_ID: number | null;
        COMPLETED_AT: Date | null;
        FINAL_PLAYTIME_HRS: number | null;
        CREATED_AT: Date;
        THREAD_ID: string | null;
        NOTE: string | null;
      }>(
        `
        SELECT c.COMPLETION_ID,
               g.GAME_ID,
               g.TITLE,
               c.COMPLETION_TYPE,
               c.PLATFORM_ID,
               c.COMPLETED_AT,
               c.FINAL_PLAYTIME_HRS,
               c.CREATED_AT,
               c.NOTE,
               COALESCE(
                  (
                    SELECT MIN(tgl.THREAD_ID)
                    FROM THREAD_GAME_LINKS tgl
                    WHERE tgl.GAMEDB_GAME_ID = c.GAMEDB_GAME_ID
                  ),
                  (
                    SELECT MIN(th.THREAD_ID)
                    FROM THREADS th
                    WHERE th.GAMEDB_GAME_ID = c.GAMEDB_GAME_ID
                  )
                ) AS THREAD_ID
          FROM USER_GAME_COMPLETIONS c
          JOIN GAMEDB_GAMES g ON g.GAME_ID = c.GAMEDB_GAME_ID
         WHERE c.USER_ID = :userId
           AND c.GAMEDB_GAME_ID = :gameId
         FETCH FIRST 1 ROWS ONLY
        `,
        { userId, gameId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      const row = (res.rows ?? [])[0];
      if (!row) return null;

      return {
        completionId: Number(row.COMPLETION_ID),
        gameId: Number(row.GAME_ID),
        title: String(row.TITLE),
        completionType: String(row.COMPLETION_TYPE),
        platformId: row.PLATFORM_ID ? Number(row.PLATFORM_ID) : null,
        completedAt:
          row.COMPLETED_AT instanceof Date
            ? row.COMPLETED_AT
            : row.COMPLETED_AT
              ? new Date(row.COMPLETED_AT as any)
              : null,
        finalPlaytimeHours:
          row.FINAL_PLAYTIME_HRS == null ? null : Number(row.FINAL_PLAYTIME_HRS),
        createdAt:
          row.CREATED_AT instanceof Date
            ? row.CREATED_AT
            : row.CREATED_AT
              ? new Date(row.CREATED_AT as any)
              : new Date(),
        threadId: row.THREAD_ID ?? null,
        note: row.NOTE ?? null,
      };
    } finally {
      await connection.close();
    }
  }

  static async getCompletions(params: {
    userId: string;
    limit: number;
    offset?: number;
    year?: number | "unknown" | null;
    title?: string;
  }): Promise<ICompletionRecord[]> {
    const { userId, limit, offset = 0, year = null, title } = params;
    const connection = await getOraclePool().getConnection();
    const safeLimit = Math.min(Math.max(limit, 1), 1000);
    const safeOffset = Math.max(offset, 0);

    const clauses: string[] = ["c.USER_ID = :userId"];
    const binds: Record<string, any> = { userId, limit: safeLimit, offset: safeOffset };
    if (year === "unknown") {
      clauses.push("c.COMPLETED_AT IS NULL");
    } else if (typeof year === "number") {
      clauses.push("EXTRACT(YEAR FROM c.COMPLETED_AT) = :year");
      binds.year = year;
    }
    if (title) {
      clauses.push("UPPER(g.TITLE) LIKE '%' || UPPER(:title) || '%'");
      binds.title = title;
    }

    try {
      const res = await connection.execute<{
        COMPLETION_ID: number;
        GAME_ID: number;
        TITLE: string;
        COMPLETION_TYPE: string;
        PLATFORM_ID: number | null;
        COMPLETED_AT: Date | null;
        FINAL_PLAYTIME_HRS: number | null;
        CREATED_AT: Date;
        THREAD_ID: string | null;
        NOTE: string | null;
      }>(
        `
        SELECT c.COMPLETION_ID,
               g.GAME_ID,
               g.TITLE,
               c.COMPLETION_TYPE,
               c.PLATFORM_ID,
               c.COMPLETED_AT,
               c.FINAL_PLAYTIME_HRS,
               c.CREATED_AT,
               c.NOTE,
               COALESCE(
                  (
                    SELECT MIN(tgl.THREAD_ID)
                    FROM THREAD_GAME_LINKS tgl
                    WHERE tgl.GAMEDB_GAME_ID = c.GAMEDB_GAME_ID
                  ),
                  (
                    SELECT MIN(th.THREAD_ID)
                    FROM THREADS th
                    WHERE th.GAMEDB_GAME_ID = c.GAMEDB_GAME_ID
                  )
                ) AS THREAD_ID
          FROM USER_GAME_COMPLETIONS c
          JOIN GAMEDB_GAMES g ON g.GAME_ID = c.GAMEDB_GAME_ID
         WHERE ${clauses.join(" AND ")}
         ORDER BY c.COMPLETED_AT DESC NULLS LAST, c.COMPLETION_ID DESC
         OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY
        `,
        binds,
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      return (res.rows ?? []).map((row) => ({
        completionId: Number(row.COMPLETION_ID),
        gameId: Number(row.GAME_ID),
        title: String(row.TITLE),
        completionType: String(row.COMPLETION_TYPE),
        platformId: row.PLATFORM_ID ? Number(row.PLATFORM_ID) : null,
        completedAt:
          row.COMPLETED_AT instanceof Date
            ? row.COMPLETED_AT
            : row.COMPLETED_AT
              ? new Date(row.COMPLETED_AT as any)
              : null,
        finalPlaytimeHours:
          row.FINAL_PLAYTIME_HRS == null ? null : Number(row.FINAL_PLAYTIME_HRS),
        createdAt:
          row.CREATED_AT instanceof Date
            ? row.CREATED_AT
            : row.CREATED_AT
              ? new Date(row.CREATED_AT as any)
              : new Date(),
        threadId: row.THREAD_ID ?? null,
        note: row.NOTE ?? null,
      }));
    } finally {
      await connection.close();
    }
  }

  static async getAllCompletions(userId: string): Promise<ICompletionRecord[]> {
    const connection = await getOraclePool().getConnection();
    try {
      const res = await connection.execute<{
        COMPLETION_ID: number;
        GAME_ID: number;
        TITLE: string;
        COMPLETION_TYPE: string;
        PLATFORM_ID: number | null;
        COMPLETED_AT: Date | null;
        FINAL_PLAYTIME_HRS: number | null;
        CREATED_AT: Date;
        THREAD_ID: string | null;
        NOTE: string | null;
      }>(
        `
        SELECT c.COMPLETION_ID,
               g.GAME_ID,
               g.TITLE,
               c.COMPLETION_TYPE,
               c.PLATFORM_ID,
               c.COMPLETED_AT,
               c.FINAL_PLAYTIME_HRS,
               c.CREATED_AT,
               c.NOTE,
               COALESCE(
                  (
                    SELECT MIN(tgl.THREAD_ID)
                    FROM THREAD_GAME_LINKS tgl
                    WHERE tgl.GAMEDB_GAME_ID = c.GAMEDB_GAME_ID
                  ),
                  (
                    SELECT MIN(th.THREAD_ID)
                    FROM THREADS th
                    WHERE th.GAMEDB_GAME_ID = c.GAMEDB_GAME_ID
                  )
                ) AS THREAD_ID
          FROM USER_GAME_COMPLETIONS c
          JOIN GAMEDB_GAMES g ON g.GAME_ID = c.GAMEDB_GAME_ID
         WHERE c.USER_ID = :userId
         ORDER BY c.COMPLETED_AT DESC NULLS LAST, c.CREATED_AT DESC, c.COMPLETION_ID DESC
        `,
        { userId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      return (res.rows ?? []).map((row) => ({
        completionId: Number(row.COMPLETION_ID),
        gameId: Number(row.GAME_ID),
        title: String(row.TITLE),
        completionType: String(row.COMPLETION_TYPE),
        platformId: row.PLATFORM_ID ? Number(row.PLATFORM_ID) : null,
        completedAt:
          row.COMPLETED_AT instanceof Date
            ? row.COMPLETED_AT
            : row.COMPLETED_AT
              ? new Date(row.COMPLETED_AT as any)
              : null,
        finalPlaytimeHours:
          row.FINAL_PLAYTIME_HRS == null ? null : Number(row.FINAL_PLAYTIME_HRS),
        createdAt:
          row.CREATED_AT instanceof Date
            ? row.CREATED_AT
            : row.CREATED_AT
              ? new Date(row.CREATED_AT as any)
              : new Date(),
        threadId: row.THREAD_ID ?? null,
        note: row.NOTE ?? null,
      }));
    } finally {
      await connection.close();
    }
  }

  static async countCompletions(
    userId: string,
    year?: number | "unknown" | null,
    title?: string,
  ): Promise<number> {
    const connection = await getOraclePool().getConnection();
    const clauses: string[] = ["c.USER_ID = :userId"];
    const binds: Record<string, any> = { userId };
    if (year === "unknown") {
      clauses.push("c.COMPLETED_AT IS NULL");
    } else if (typeof year === "number") {
      clauses.push("EXTRACT(YEAR FROM c.COMPLETED_AT) = :year");
      binds.year = year;
    }
    if (title) {
      clauses.push("UPPER(g.TITLE) LIKE '%' || UPPER(:title) || '%'");
      binds.title = title;
    }

    try {
      const res = await connection.execute<{ CNT: number }>(
        `
        SELECT COUNT(*) AS CNT
          FROM USER_GAME_COMPLETIONS c
          JOIN GAMEDB_GAMES g ON g.GAME_ID = c.GAMEDB_GAME_ID
         WHERE ${clauses.join(" AND ")}
        `,
        binds,
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return Number((res.rows ?? [])[0]?.CNT ?? 0);
    } finally {
      await connection.close();
    }
  }

  static async updateCompletion(
    userId: string,
    completionId: number,
    updates: Partial<{
      completionType: string;
      completedAt: Date | null;
      platformId: number | null;
      finalPlaytimeHours: number | null;
      note: string | null;
    }>,
  ): Promise<boolean> {
    if (!Number.isInteger(completionId) || completionId <= 0) {
      throw new Error("Invalid completion id.");
    }

    const fields: string[] = [];
    const binds: Record<string, any> = { userId, completionId };

    if (updates.completionType !== undefined) {
      fields.push("COMPLETION_TYPE = :type");
      binds.type = updates.completionType;
    }
    if (updates.completedAt !== undefined) {
      fields.push("COMPLETED_AT = :completedAt");
      binds.completedAt = updates.completedAt;
    }
    if (updates.platformId !== undefined) {
      if (updates.platformId != null && (!Number.isInteger(updates.platformId) || updates.platformId <= 0)) {
        throw new Error("Invalid platform selection.");
      }
      fields.push("PLATFORM_ID = :platformId");
      binds.platformId = updates.platformId;
    }
    if (updates.finalPlaytimeHours !== undefined) {
      fields.push("FINAL_PLAYTIME_HRS = :playtime");
      binds.playtime = updates.finalPlaytimeHours;
    }
    if (updates.note !== undefined) {
      fields.push("NOTE = :note");
      const normalizedNote = updates.note?.trim();
      binds.note = normalizedNote ? normalizedNote : null;
    }

    if (!fields.length) return false;

    const connection = await getOraclePool().getConnection();
    try {
      const res = await connection.execute(
        `
        UPDATE USER_GAME_COMPLETIONS
           SET ${fields.join(", ")}
         WHERE COMPLETION_ID = :completionId
           AND USER_ID = :userId
        `,
        binds,
        { autoCommit: true },
      );
      const rows = (res as any).rowsAffected ?? 0;
      return rows > 0;
    } finally {
      await connection.close();
    }
  }

  static async deleteCompletion(userId: string, completionId: number): Promise<boolean> {
    if (!Number.isInteger(completionId) || completionId <= 0) {
      throw new Error("Invalid completion id.");
    }
    const connection = await getOraclePool().getConnection();
    try {
      const res = await connection.execute(
        `
        DELETE FROM USER_GAME_COMPLETIONS
         WHERE COMPLETION_ID = :completionId
           AND USER_ID = :userId
        `,
        { completionId, userId },
        { autoCommit: true },
      );
      const rows = (res as any).rowsAffected ?? 0;
      return rows > 0;
    } finally {
      await connection.close();
    }
  }

  static async getRecentNickHistory(
    userId: string,
    limit: number = 5,
  ): Promise<IMemberNickHistory[]> {
    const connection = await getOraclePool().getConnection();
    const safeLimit = Math.min(Math.max(limit, 1), 20);
    try {
      const result = await connection.execute<{
        OLD_NICK: string | null;
        NEW_NICK: string | null;
        CHANGED_AT: Date;
      }>(
        `SELECT OLD_NICK, NEW_NICK, CHANGED_AT
           FROM RPG_CLUB_USER_NICK_HISTORY
          WHERE USER_ID = :userId
          ORDER BY CHANGED_AT DESC
          FETCH FIRST :limit ROWS ONLY`,
        { userId, limit: safeLimit },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      return (result.rows ?? []).map((row) => ({
        oldNick: row.OLD_NICK ?? null,
        newNick: row.NEW_NICK ?? null,
        changedAt: row.CHANGED_AT,
      }));
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error(`[Member] Failed to load nick history for ${userId}: ${msg}`);
      return [];
    } finally {
      await connection.close();
    }
  }

  static async getCompletionLeaderboard(
    limit: number = 25,
    title?: string,
  ): Promise<{
    userId: string;
    username: string | null;
    globalName: string | null;
    count: number;
  }[]> {
    const connection = await getOraclePool().getConnection();
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const clauses: string[] = ["u.SERVER_LEFT_AT IS NULL"];
    const binds: Record<string, any> = { limit: safeLimit };
    if (title) {
      clauses.push("UPPER(g.TITLE) LIKE '%' || UPPER(:title) || '%'");
      binds.title = title;
    }

    try {
      const res = await connection.execute<{
        USER_ID: string;
        USERNAME: string | null;
        GLOBAL_NAME: string | null;
        CNT: number;
      }>(
        `
        SELECT c.USER_ID, u.USERNAME, u.GLOBAL_NAME, COUNT(*) AS CNT
          FROM USER_GAME_COMPLETIONS c
          JOIN RPG_CLUB_USERS u ON u.USER_ID = c.USER_ID
          JOIN GAMEDB_GAMES g ON g.GAME_ID = c.GAMEDB_GAME_ID
         WHERE ${clauses.join(" AND ")}
         GROUP BY c.USER_ID, u.USERNAME, u.GLOBAL_NAME
         ORDER BY CNT DESC
         FETCH FIRST :limit ROWS ONLY
        `,
        binds,
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      return (res.rows ?? []).map((row) => ({
        userId: row.USER_ID,
        username: row.USERNAME ?? null,
        globalName: row.GLOBAL_NAME ?? null,
        count: Number(row.CNT),
      }));
    } finally {
      await connection.close();
    }
  }

  static async search(filters: IMemberSearchFilters): Promise<IMemberSearchResult[]> {
    const connection = await getOraclePool().getConnection();

    const safeLimit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
    const clauses: string[] = [];
    const params: Record<string, any> = { limit: safeLimit };

    const addLike = (column: string, param: string, value?: string): void => {
      if (!value) return;
      clauses.push(`UPPER(${column}) LIKE '%' || UPPER(:${param}) || '%'`);
      params[param] = value;
    };

    const addBool = (column: string, param: string, value?: boolean): void => {
      if (value === undefined) return;
      clauses.push(`${column} = :${param}`);
      params[param] = value ? 1 : 0;
    };

    addLike("USER_ID", "userId", filters.userId);
    addLike("USERNAME", "username", filters.username);
    addLike("GLOBAL_NAME", "globalName", filters.globalName);
    addLike("COMPLETIONATOR_URL", "completionatorUrl", filters.completionatorUrl);
    addLike("STEAM_URL", "steamUrl", filters.steamUrl);
    addLike("PSN_USERNAME", "psnUsername", filters.psnUsername);
    addLike("XBL_USERNAME", "xblUsername", filters.xblUsername);
    addLike("NSW_FRIEND_CODE", "nswFriendCode", filters.nswFriendCode);

    addBool("ROLE_ADMIN", "roleAdmin", filters.roleAdmin);
    addBool("ROLE_MODERATOR", "roleModerator", filters.roleModerator);
    addBool("ROLE_REGULAR", "roleRegular", filters.roleRegular);
    addBool("ROLE_MEMBER", "roleMember", filters.roleMember);
    addBool("ROLE_NEWCOMER", "roleNewcomer", filters.roleNewcomer);
    addBool("IS_BOT", "isBot", filters.isBot);

    if (!filters.includeDeparted) {
      clauses.push("SERVER_LEFT_AT IS NULL");
    }

    if (filters.joinedAfter) {
      clauses.push("SERVER_JOINED_AT >= :joinedAfter");
      params.joinedAfter = filters.joinedAfter;
    }

    if (filters.joinedBefore) {
      clauses.push("SERVER_JOINED_AT <= :joinedBefore");
      params.joinedBefore = filters.joinedBefore;
    }

    if (filters.lastSeenAfter) {
      clauses.push("LAST_SEEN_AT >= :lastSeenAfter");
      params.lastSeenAfter = filters.lastSeenAfter;
    }

    if (filters.lastSeenBefore) {
      clauses.push("LAST_SEEN_AT <= :lastSeenBefore");
      params.lastSeenBefore = filters.lastSeenBefore;
    }

    const where = clauses.length ? clauses.join(" AND ") : "1=1";

    try {
      const result = await connection.execute<{
        USER_ID: string;
        USERNAME: string | null;
        GLOBAL_NAME: string | null;
        IS_BOT: number;
        COMPLETIONATOR_URL: string | null;
        STEAM_URL: string | null;
        PSN_USERNAME: string | null;
        XBL_USERNAME: string | null;
        NSW_FRIEND_CODE: string | null;
        ROLE_ADMIN: number;
        ROLE_MODERATOR: number;
        ROLE_REGULAR: number;
        ROLE_MEMBER: number;
        ROLE_NEWCOMER: number;
        SERVER_LEFT_AT: Date | null;
        SERVER_JOINED_AT: Date | null;
        LAST_SEEN_AT: Date | null;
      }>(
        `SELECT USER_ID,
                USERNAME,
                GLOBAL_NAME,
                IS_BOT,
                COMPLETIONATOR_URL,
                STEAM_URL,
                PSN_USERNAME,
                XBL_USERNAME,
                NSW_FRIEND_CODE,
                ROLE_ADMIN,
                ROLE_MODERATOR,
                ROLE_REGULAR,
                ROLE_MEMBER,
                ROLE_NEWCOMER,
                SERVER_LEFT_AT,
                SERVER_JOINED_AT,
                LAST_SEEN_AT
           FROM RPG_CLUB_USERS
          WHERE ${where}
          ORDER BY COALESCE(UPPER(GLOBAL_NAME), UPPER(USERNAME), USER_ID)
          FETCH FIRST :limit ROWS ONLY`,
        params,
        {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
        },
      );

      const rows = result.rows ?? [];
      return rows.map<IMemberSearchResult>((row) => ({
        userId: row.USER_ID,
        username: row.USERNAME ?? null,
        globalName: row.GLOBAL_NAME ?? null,
        isBot: row.IS_BOT,
        completionatorUrl: row.COMPLETIONATOR_URL ?? null,
        steamUrl: row.STEAM_URL ?? null,
        psnUsername: row.PSN_USERNAME ?? null,
        xblUsername: row.XBL_USERNAME ?? null,
        nswFriendCode: row.NSW_FRIEND_CODE ?? null,
        roleAdmin: row.ROLE_ADMIN,
        roleModerator: row.ROLE_MODERATOR,
        roleRegular: row.ROLE_REGULAR,
        roleMember: row.ROLE_MEMBER,
        roleNewcomer: row.ROLE_NEWCOMER,
        serverLeftAt: row.SERVER_LEFT_AT ?? null,
        serverJoinedAt: row.SERVER_JOINED_AT ?? null,
        lastSeenAt: row.LAST_SEEN_AT ?? null,
      }));
    } finally {
      await connection.close();
    }
  }

  static async setMessageCount(userId: string, count: number): Promise<void> {
    void userId;
    void count;
    return;
  }

  static async recordMessageActivity(
    userId: string,
    when: Date = new Date(),
  ): Promise<void> {
    void userId;
    void when;
    return;
  }

  static async getByUserId(userId: string): Promise<IMemberRecord | null> {
    const connection = await getOraclePool().getConnection();

    try {
      const result = await connection.execute<{
        USER_ID: string;
        IS_BOT: number;
        USERNAME: string | null;
        GLOBAL_NAME: string | null;
        AVATAR_BLOB: Buffer | null;
        SERVER_JOINED_AT: Date | null;
        SERVER_LEFT_AT: Date | null;
        LAST_SEEN_AT: Date | null;
        ROLE_ADMIN: number;
        ROLE_MODERATOR: number;
        ROLE_REGULAR: number;
        ROLE_MEMBER: number;
        ROLE_NEWCOMER: number;
        MESSAGE_COUNT: number | null;
        COMPLETIONATOR_URL: string | null;
        PSN_USERNAME: string | null;
        XBL_USERNAME: string | null;
        NSW_FRIEND_CODE: string | null;
        STEAM_URL: string | null;
        PROFILE_IMAGE: Buffer | null;
        PROFILE_IMAGE_AT: Date | null;
      }>(
        `SELECT USER_ID,
                IS_BOT,
                USERNAME,
                GLOBAL_NAME,
               AVATAR_BLOB,
               SERVER_JOINED_AT,
                SERVER_LEFT_AT,
                LAST_SEEN_AT,
                ROLE_ADMIN,
                ROLE_MODERATOR,
                ROLE_REGULAR,
                ROLE_MEMBER,
                ROLE_NEWCOMER,
                MESSAGE_COUNT,
                COMPLETIONATOR_URL,
                PSN_USERNAME,
                XBL_USERNAME,
                NSW_FRIEND_CODE,
                STEAM_URL,
                PROFILE_IMAGE,
                PROFILE_IMAGE_AT
           FROM RPG_CLUB_USERS
          WHERE USER_ID = :userId`,
        { userId },
        {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          fetchInfo: {
            AVATAR_BLOB: { type: oracledb.BUFFER },
            PROFILE_IMAGE: { type: oracledb.BUFFER },
          },
        },
      );

      const row = (result.rows ?? [])[0];
      if (!row) {
        return null;
      }

      return {
        userId: row.USER_ID,
        isBot: row.IS_BOT,
        username: row.USERNAME ?? null,
        globalName: row.GLOBAL_NAME ?? null,
        avatarBlob: row.AVATAR_BLOB ?? null,
        serverJoinedAt: row.SERVER_JOINED_AT ?? null,
        serverLeftAt: row.SERVER_LEFT_AT ?? null,
        lastSeenAt: row.LAST_SEEN_AT ?? null,
        roleAdmin: row.ROLE_ADMIN,
        roleModerator: row.ROLE_MODERATOR,
        roleRegular: row.ROLE_REGULAR,
        roleMember: row.ROLE_MEMBER,
        roleNewcomer: row.ROLE_NEWCOMER,
        messageCount: row.MESSAGE_COUNT ?? null,
        completionatorUrl: row.COMPLETIONATOR_URL ?? null,
        psnUsername: row.PSN_USERNAME ?? null,
        xblUsername: row.XBL_USERNAME ?? null,
        nswFriendCode: row.NSW_FRIEND_CODE ?? null,
        steamUrl: row.STEAM_URL ?? null,
        profileImage: row.PROFILE_IMAGE ?? null,
        profileImageAt: row.PROFILE_IMAGE_AT ?? null,
      };
    } finally {
      await connection.close();
    }
  }

  static async updateNowPlayingPlatform(
    userId: string,
    gameId: number,
    platformId: number,
  ): Promise<boolean> {
    if (!Number.isInteger(gameId) || gameId <= 0) {
      throw new Error("Invalid GameDB id.");
    }
    if (!Number.isInteger(platformId) || platformId <= 0) {
      throw new Error("Invalid platform selection.");
    }
    const connection = await getOraclePool().getConnection();
    try {
      const res = await connection.execute(
        `UPDATE USER_NOW_PLAYING
            SET PLATFORM_ID = :platformId
          WHERE USER_ID = :userId
            AND GAMEDB_GAME_ID = :gameId`,
        { userId, gameId, platformId },
        { autoCommit: true },
      );
      return (res.rowsAffected ?? 0) > 0;
    } finally {
      await connection.close();
    }
  }

  static async getAvatarHistory(
    userId: string,
    limit: number = 10,
    offset: number = 0,
  ): Promise<IAvatarHistoryRecord[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const safeOffset = Math.max(offset, 0);
    const connection = await getOraclePool().getConnection();
    try {
      const result = await connection.execute<{
        EVENT_ID: number;
        USER_ID: string;
        AVATAR_HASH: string | null;
        AVATAR_URL: string | null;
        AVATAR_BLOB: Buffer | null;
        CHANGED_AT: Date | string;
      }>(
        `SELECT EVENT_ID,
                USER_ID,
                AVATAR_HASH,
                AVATAR_URL,
                AVATAR_BLOB,
                CHANGED_AT
           FROM RPG_CLUB_USER_AVATAR_HISTORY
          WHERE USER_ID = :userId
          ORDER BY CHANGED_AT DESC, EVENT_ID DESC
          OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
        { userId, limit: safeLimit, offset: safeOffset },
        {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          fetchInfo: { AVATAR_BLOB: { type: oracledb.BUFFER } },
        },
      );
      return (result.rows ?? []).map((row) => ({
        eventId: Number(row.EVENT_ID),
        userId: String(row.USER_ID),
        avatarHash: row.AVATAR_HASH ?? null,
        avatarUrl: row.AVATAR_URL ?? null,
        avatarBlob: row.AVATAR_BLOB ?? null,
        changedAt:
          row.CHANGED_AT instanceof Date
            ? row.CHANGED_AT
            : new Date(row.CHANGED_AT as any),
      }));
    } finally {
      await connection.close();
    }
  }

  static async getCompletionsForGame(
    userId: string,
    gameId: number,
  ): Promise<ICompletionRecord[]> {
    if (!Number.isInteger(gameId) || gameId <= 0) {
      throw new Error("Invalid GameDB id.");
    }
    const connection = await getOraclePool().getConnection();
    try {
      const res = await connection.execute<{
        COMPLETION_ID: number;
        GAME_ID: number;
        TITLE: string;
        COMPLETION_TYPE: string;
        PLATFORM_ID: number | null;
        COMPLETED_AT: Date | null;
        FINAL_PLAYTIME_HRS: number | null;
        CREATED_AT: Date;
        THREAD_ID: string | null;
        NOTE: string | null;
      }>(
        `
        SELECT c.COMPLETION_ID,
               g.GAME_ID,
               g.TITLE,
               c.COMPLETION_TYPE,
               c.PLATFORM_ID,
               c.COMPLETED_AT,
               c.FINAL_PLAYTIME_HRS,
               c.CREATED_AT,
               c.NOTE,
               COALESCE(
                  (
                    SELECT MIN(tgl.THREAD_ID)
                    FROM THREAD_GAME_LINKS tgl
                    WHERE tgl.GAMEDB_GAME_ID = c.GAMEDB_GAME_ID
                  ),
                  (
                    SELECT MIN(th.THREAD_ID)
                    FROM THREADS th
                    WHERE th.GAMEDB_GAME_ID = c.GAMEDB_GAME_ID
                  )
                ) AS THREAD_ID
          FROM USER_GAME_COMPLETIONS c
          JOIN GAMEDB_GAMES g ON g.GAME_ID = c.GAMEDB_GAME_ID
         WHERE c.USER_ID = :userId
           AND c.GAMEDB_GAME_ID = :gameId
         ORDER BY c.COMPLETED_AT DESC NULLS LAST, c.COMPLETION_ID DESC
        `,
        { userId, gameId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      return (res.rows ?? []).map((row) => ({
        completionId: Number(row.COMPLETION_ID),
        gameId: Number(row.GAME_ID),
        title: String(row.TITLE),
        completionType: String(row.COMPLETION_TYPE),
        platformId: row.PLATFORM_ID ? Number(row.PLATFORM_ID) : null,
        completedAt:
          row.COMPLETED_AT instanceof Date
            ? row.COMPLETED_AT
            : row.COMPLETED_AT
              ? new Date(row.COMPLETED_AT as any)
              : null,
        finalPlaytimeHours:
          row.FINAL_PLAYTIME_HRS == null ? null : Number(row.FINAL_PLAYTIME_HRS),
        createdAt:
          row.CREATED_AT instanceof Date
            ? row.CREATED_AT
            : row.CREATED_AT
              ? new Date(row.CREATED_AT as any)
              : new Date(),
        threadId: row.THREAD_ID ?? null,
        note: row.NOTE ?? null,
      }));
    } finally {
      await connection.close();
    }
  }

  static async getRecentCompletionForGame(
    userId: string,
    gameId: number,
    referenceDate: Date,
    windowDays: number = 7,
  ): Promise<ICompletionRecord | null> {
    if (!Number.isInteger(gameId) || gameId <= 0) {
      throw new Error("Invalid GameDB id.");
    }
    const ref = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
    const windowMs = windowDays * 24 * 60 * 60 * 1000;
    const startDate = new Date(ref.getTime() - windowMs);
    const endDate = new Date(ref.getTime() + windowMs);

    const connection = await getOraclePool().getConnection();
    try {
      const res = await connection.execute<{
        COMPLETION_ID: number;
        GAME_ID: number;
        TITLE: string;
        COMPLETION_TYPE: string;
        PLATFORM_ID: number | null;
        COMPLETED_AT: Date | null;
        FINAL_PLAYTIME_HRS: number | null;
        CREATED_AT: Date;
        THREAD_ID: string | null;
        NOTE: string | null;
      }>(
        `
        SELECT c.COMPLETION_ID,
               g.GAME_ID,
               g.TITLE,
               c.COMPLETION_TYPE,
               c.PLATFORM_ID,
               c.COMPLETED_AT,
               c.FINAL_PLAYTIME_HRS,
               c.CREATED_AT,
               c.NOTE,
               COALESCE(
                  (
                    SELECT MIN(tgl.THREAD_ID)
                    FROM THREAD_GAME_LINKS tgl
                    WHERE tgl.GAMEDB_GAME_ID = c.GAMEDB_GAME_ID
                  ),
                  (
                    SELECT MIN(th.THREAD_ID)
                    FROM THREADS th
                    WHERE th.GAMEDB_GAME_ID = c.GAMEDB_GAME_ID
                  )
                ) AS THREAD_ID
          FROM USER_GAME_COMPLETIONS c
          JOIN GAMEDB_GAMES g ON g.GAME_ID = c.GAMEDB_GAME_ID
         WHERE c.USER_ID = :userId
           AND c.GAMEDB_GAME_ID = :gameId
           AND COALESCE(c.COMPLETED_AT, c.CREATED_AT) BETWEEN :startDate AND :endDate
         ORDER BY COALESCE(c.COMPLETED_AT, c.CREATED_AT) DESC
         FETCH FIRST 1 ROWS ONLY
        `,
        { userId, gameId, startDate, endDate },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      const row = (res.rows ?? [])[0];
      if (!row) return null;

      return {
        completionId: Number(row.COMPLETION_ID),
        gameId: Number(row.GAME_ID),
        title: String(row.TITLE),
        completionType: String(row.COMPLETION_TYPE),
        platformId: row.PLATFORM_ID ? Number(row.PLATFORM_ID) : null,
        completedAt:
          row.COMPLETED_AT instanceof Date
            ? row.COMPLETED_AT
            : row.COMPLETED_AT
              ? new Date(row.COMPLETED_AT as any)
              : null,
        finalPlaytimeHours:
          row.FINAL_PLAYTIME_HRS == null ? null : Number(row.FINAL_PLAYTIME_HRS),
        createdAt:
          row.CREATED_AT instanceof Date
            ? row.CREATED_AT
            : row.CREATED_AT
              ? new Date(row.CREATED_AT as any)
              : new Date(),
        threadId: row.THREAD_ID ?? null,
        note: row.NOTE ?? null,
      };
    } finally {
      await connection.close();
    }
  }

  static async getGiveawayDonorNotifySetting(userId: string): Promise<boolean> {
    const connection = await getOraclePool().getConnection();
    try {
      const result = await connection.execute<{ DONOR_NOTIFY_ON_CLAIM: number | null }>(
        `SELECT DONOR_NOTIFY_ON_CLAIM
           FROM RPG_CLUB_USERS
          WHERE USER_ID = :userId`,
        { userId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const row = result.rows?.[0];
      return Boolean(row?.DONOR_NOTIFY_ON_CLAIM);
    } finally {
      await connection.close();
    }
  }

  static async setGiveawayDonorNotifySetting(
    userId: string,
    enabled: boolean,
  ): Promise<void> {
    const connection = await getOraclePool().getConnection();
    try {
      const result = await connection.execute(
        `UPDATE RPG_CLUB_USERS
            SET DONOR_NOTIFY_ON_CLAIM = :enabled
          WHERE USER_ID = :userId`,
        { userId, enabled: enabled ? 1 : 0 },
        { autoCommit: true },
      );
      if ((result.rowsAffected ?? 0) > 0) {
        return;
      }

      try {
        await connection.execute(
          `INSERT INTO RPG_CLUB_USERS (USER_ID, DONOR_NOTIFY_ON_CLAIM)
           VALUES (:userId, :enabled)`,
          { userId, enabled: enabled ? 1 : 0 },
          { autoCommit: true },
        );
      } catch (err: any) {
        const code = err?.code ?? err?.errorNum;
        if (code === "ORA-00001") {
          await connection.execute(
            `UPDATE RPG_CLUB_USERS
                SET DONOR_NOTIFY_ON_CLAIM = :enabled
              WHERE USER_ID = :userId`,
            { userId, enabled: enabled ? 1 : 0 },
            { autoCommit: true },
          );
        } else {
          throw err;
        }
      }
    } finally {
      await connection.close();
    }
  }

  static async countAvatarHistory(userId: string): Promise<number> {
    const connection = await getOraclePool().getConnection();
    try {
      const result = await connection.execute<{ TOTAL: number | null }>(
        `SELECT COUNT(*) AS TOTAL
           FROM RPG_CLUB_USER_AVATAR_HISTORY
          WHERE USER_ID = :userId`,
        { userId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const row = result.rows?.[0];
      return Number(row?.TOTAL ?? 0);
    } finally {
      await connection.close();
    }
  }

  static async getMembersWithPlatforms(): Promise<IMemberPlatformRecord[]> {
    const connection = await getOraclePool().getConnection();

    try {
      const result = await connection.execute<{
        USER_ID: string;
        USERNAME: string | null;
        GLOBAL_NAME: string | null;
        STEAM_URL: string | null;
        PSN_USERNAME: string | null;
        XBL_USERNAME: string | null;
        NSW_FRIEND_CODE: string | null;
        SERVER_LEFT_AT: Date | null;
      }>(
        `SELECT USER_ID,
                USERNAME,
                GLOBAL_NAME,
                STEAM_URL,
                PSN_USERNAME,
                XBL_USERNAME,
                NSW_FRIEND_CODE,
                SERVER_LEFT_AT
           FROM RPG_CLUB_USERS
          WHERE (STEAM_URL IS NOT NULL
                 OR PSN_USERNAME IS NOT NULL
                 OR XBL_USERNAME IS NOT NULL
                 OR NSW_FRIEND_CODE IS NOT NULL)
            AND NVL(IS_BOT, 0) = 0
            AND SERVER_LEFT_AT IS NULL`,
        {},
        {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
        },
      );

      const rows = result.rows ?? [];
      const members = rows.map<IMemberPlatformRecord>((row) => ({
        userId: row.USER_ID,
        username: row.USERNAME ?? null,
        globalName: row.GLOBAL_NAME ?? null,
        steamUrl: row.STEAM_URL ?? null,
        psnUsername: row.PSN_USERNAME ?? null,
        xblUsername: row.XBL_USERNAME ?? null,
        nswFriendCode: row.NSW_FRIEND_CODE ?? null,
      }));

      return members.sort((a, b) => {
        const aName = (a.globalName ?? a.username ?? a.userId).toLowerCase();
        const bName = (b.globalName ?? b.username ?? b.userId).toLowerCase();
        return aName.localeCompare(bName);
      });
    } finally {
      await connection.close();
    }
  }

  static async upsert(
    record: IMemberRecord,
    opts?: { connection?: Connection },
  ): Promise<void> {
    const externalConn = opts?.connection ?? null;
    const connection = externalConn ?? (await getOraclePool().getConnection());

    const params = buildParams(record);

    try {
      const update = await connection.execute(
        `UPDATE RPG_CLUB_USERS
            SET IS_BOT = :isBot,
                USERNAME = :username,
                GLOBAL_NAME = :globalName,
                AVATAR_BLOB = :avatarBlob,
                SERVER_JOINED_AT = :joinedAt,
                SERVER_LEFT_AT = :leftAt,
                LAST_SEEN_AT = :lastSeenAt,
                LAST_FETCHED_AT = SYSTIMESTAMP,
                ROLE_ADMIN = :roleAdmin,
                ROLE_MODERATOR = :roleModerator,
                ROLE_REGULAR = :roleRegular,
                ROLE_MEMBER = :roleMember,
                ROLE_NEWCOMER = :roleNewcomer,
                COMPLETIONATOR_URL = :completionatorUrl,
                PSN_USERNAME = :psnUsername,
                XBL_USERNAME = :xblUsername,
                NSW_FRIEND_CODE = :nswFriendCode,
                STEAM_URL = :steamUrl,
                UPDATED_AT = SYSTIMESTAMP
          WHERE USER_ID = :userId`,
        params,
        { autoCommit: true },
      );

      const rowsUpdated = update.rowsAffected ?? 0;
      if (rowsUpdated > 0) return;

      try {
        await connection.execute(
          `INSERT INTO RPG_CLUB_USERS (
             USER_ID, IS_BOT, USERNAME, GLOBAL_NAME, AVATAR_BLOB,
             SERVER_JOINED_AT, SERVER_LEFT_AT, LAST_SEEN_AT, LAST_FETCHED_AT,
             ROLE_ADMIN, ROLE_MODERATOR, ROLE_REGULAR, ROLE_MEMBER, ROLE_NEWCOMER,
             COMPLETIONATOR_URL, PSN_USERNAME, XBL_USERNAME, NSW_FRIEND_CODE,
             STEAM_URL,
             CREATED_AT, UPDATED_AT
           ) VALUES (
             :userId, :isBot, :username, :globalName, :avatarBlob,
             :joinedAt, :leftAt, :lastSeenAt, SYSTIMESTAMP,
             :roleAdmin, :roleModerator, :roleRegular, :roleMember, :roleNewcomer,
             :completionatorUrl, :psnUsername, :xblUsername,
             :nswFriendCode, :steamUrl,
             SYSTIMESTAMP, SYSTIMESTAMP
           )`,
          params,
          { autoCommit: true },
        );
      } catch (insErr: any) {
        const code = insErr?.code ?? insErr?.errorNum;
        if (code === "ORA-00001") {
          await connection.execute(
            `UPDATE RPG_CLUB_USERS
                SET IS_BOT = :isBot,
                    USERNAME = :username,
                    GLOBAL_NAME = :globalName,
                    AVATAR_BLOB = :avatarBlob,
                    SERVER_JOINED_AT = :joinedAt,
                    SERVER_LEFT_AT = :leftAt,
                    LAST_SEEN_AT = :lastSeenAt,
                    LAST_FETCHED_AT = SYSTIMESTAMP,
                    ROLE_ADMIN = :roleAdmin,
                    ROLE_MODERATOR = :roleModerator,
                    ROLE_REGULAR = :roleRegular,
                    ROLE_MEMBER = :roleMember,
                    ROLE_NEWCOMER = :roleNewcomer,
                    COMPLETIONATOR_URL = :completionatorUrl,
                    PSN_USERNAME = :psnUsername,
                    XBL_USERNAME = :xblUsername,
                    NSW_FRIEND_CODE = :nswFriendCode,
                    STEAM_URL = :steamUrl,
                    UPDATED_AT = SYSTIMESTAMP
              WHERE USER_ID = :userId`,
            params,
            { autoCommit: true },
          );
        } else {
          throw insErr;
        }
      }
    } finally {
      if (!externalConn) {
        await connection.close();
      }
    }
  }

  static async markDepartedNotIn(userIds: string[]): Promise<number> {
    if (!userIds.length) return 0;

    const connection = await getOraclePool().getConnection();
    const chunkSize = 999; // Oracle IN clause limit per statement (safe)
    let totalUpdated = 0;

    try {
      for (let i = 0; i < userIds.length; i += chunkSize) {
        const chunk = userIds.slice(i, i + chunkSize);
        const binds: Record<string, string> = {};
        const placeholders = chunk.map((id, idx) => {
          const key = `id${idx}`;
          binds[key] = id;
          return `:${key}`;
        });

        const sql = `
          UPDATE RPG_CLUB_USERS
             SET SERVER_LEFT_AT = SYSTIMESTAMP,
                 UPDATED_AT = SYSTIMESTAMP
           WHERE SERVER_LEFT_AT IS NULL
             AND USER_ID NOT IN (${placeholders.join(", ")})
        `;

        const result = await connection.execute(sql, binds, { autoCommit: true });
        totalUpdated += result.rowsAffected ?? 0;
      }
    } finally {
      await connection.close();
    }

    return totalUpdated;
  }
}
