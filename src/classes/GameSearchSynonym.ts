import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";

export type IGameSearchSynonym = {
  termId: number;
  groupId: number;
  termText: string;
  termNorm: string;
  createdAt: Date;
  createdBy: string | null;
};

export function normalizeSearchTerm(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function mapSynonymRow(row: any): IGameSearchSynonym {
  return {
    termId: Number(row.TERM_ID),
    groupId: Number(row.GROUP_ID),
    termText: String(row.TERM_TEXT),
    termNorm: String(row.TERM_NORM),
    createdAt: row.CREATED_AT instanceof Date ? row.CREATED_AT : new Date(row.CREATED_AT),
    createdBy: row.CREATED_BY ? String(row.CREATED_BY) : null,
  };
}

export default class GameSearchSynonym {
  static normalizeTerm(text: string): string {
    return normalizeSearchTerm(text);
  }

  static async getGroupIdsForTerm(
    termText: string,
    connection?: oracledb.Connection,
  ): Promise<number[]> {
    const norm = normalizeSearchTerm(termText);
    if (!norm) return [];
    const pool = getOraclePool();
    const activeConnection = connection ?? await pool.getConnection();
    try {
      const result = await activeConnection.execute(
        `SELECT GROUP_ID
           FROM GAMEDB_SEARCH_SYNONYMS
          WHERE TERM_NORM = :termNorm`,
        { termNorm: norm },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return (result.rows ?? []).map((row: any) => Number(row.GROUP_ID));
    } finally {
      if (!connection) {
        await activeConnection.close();
      }
    }
  }

  static async listGroupTerms(
    groupId: number,
    connection?: oracledb.Connection,
  ): Promise<IGameSearchSynonym[]> {
    const pool = getOraclePool();
    const activeConnection = connection ?? await pool.getConnection();
    try {
      const result = await activeConnection.execute(
        `SELECT TERM_ID, GROUP_ID, TERM_TEXT, TERM_NORM, CREATED_AT, CREATED_BY
           FROM GAMEDB_SEARCH_SYNONYMS
          WHERE GROUP_ID = :groupId
          ORDER BY TERM_TEXT ASC`,
        { groupId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return (result.rows ?? []).map((row) => mapSynonymRow(row));
    } finally {
      if (!connection) {
        await activeConnection.close();
      }
    }
  }

  static async getTermsForQuery(
    query: string,
    connection?: oracledb.Connection,
  ): Promise<string[]> {
    const norm = normalizeSearchTerm(query);
    if (!norm) return [];
    const pool = getOraclePool();
    const activeConnection = connection ?? await pool.getConnection();
    try {
      const groupResult = await activeConnection.execute(
        `SELECT GROUP_ID
           FROM GAMEDB_SEARCH_SYNONYMS
          WHERE TERM_NORM = :termNorm`,
        { termNorm: norm },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const groupIds = (groupResult.rows ?? []).map((row: any) => Number(row.GROUP_ID));
      if (!groupIds.length) return [];
      const binds: Record<string, number> = {};
      const placeholders = groupIds.map((groupId, index) => {
        const key = `groupId${index}`;
        binds[key] = groupId;
        return `:${key}`;
      });
      const termResult = await activeConnection.execute(
        `SELECT DISTINCT TERM_TEXT
           FROM GAMEDB_SEARCH_SYNONYMS
          WHERE GROUP_ID IN (${placeholders.join(", ")})
          ORDER BY TERM_TEXT ASC`,
        binds,
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return (termResult.rows ?? []).map((row: any) => String(row.TERM_TEXT));
    } finally {
      if (!connection) {
        await activeConnection.close();
      }
    }
  }

  static async listSynonyms(
    options: { query?: string; limit?: number } = {},
  ): Promise<IGameSearchSynonym[]> {
    const pool = getOraclePool();
    const connection = await pool.getConnection();
    const query = options.query?.trim().toLowerCase() ?? "";
    const searchQuery = query ? `%${query}%` : null;
    const normalizedQuery = query ? `%${normalizeSearchTerm(query)}%` : null;
    const limit = options.limit ?? 50;
    try {
      const result = await connection.execute(
        `SELECT TERM_ID, GROUP_ID, TERM_TEXT, TERM_NORM, CREATED_AT, CREATED_BY
           FROM GAMEDB_SEARCH_SYNONYMS
          WHERE (:searchQuery IS NULL
             OR LOWER(TERM_TEXT) LIKE :searchQuery
             OR TERM_NORM LIKE :normalizedQuery)
          ORDER BY GROUP_ID ASC, TERM_TEXT ASC
          FETCH FIRST :limit ROWS ONLY`,
        { searchQuery, normalizedQuery, limit },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return (result.rows ?? []).map((row) => mapSynonymRow(row));
    } finally {
      await connection.close();
    }
  }

  static async countSynonymGroups(query?: string): Promise<number> {
    const pool = getOraclePool();
    const connection = await pool.getConnection();
    const cleanedQuery = query?.trim().toLowerCase() ?? "";
    const searchQuery = cleanedQuery ? `%${cleanedQuery}%` : null;
    const normalizedQuery = cleanedQuery ? `%${normalizeSearchTerm(cleanedQuery)}%` : null;
    try {
      const result = await connection.execute(
        `SELECT COUNT(DISTINCT GROUP_ID) AS CNT
           FROM GAMEDB_SEARCH_SYNONYMS
          WHERE (:searchQuery IS NULL
             OR LOWER(TERM_TEXT) LIKE :searchQuery
             OR TERM_NORM LIKE :normalizedQuery)`,
        { searchQuery, normalizedQuery },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const row = (result.rows ?? [])[0] as any;
      return Number(row?.CNT ?? 0);
    } finally {
      await connection.close();
    }
  }

  static async listSynonymGroups(
    options: { query?: string; limit?: number; offset?: number } = {},
  ): Promise<IGameSearchSynonym[]> {
    const pool = getOraclePool();
    const connection = await pool.getConnection();
    const cleanedQuery = options.query?.trim().toLowerCase() ?? "";
    const searchQuery = cleanedQuery ? `%${cleanedQuery}%` : null;
    const normalizedQuery = cleanedQuery ? `%${normalizeSearchTerm(cleanedQuery)}%` : null;
    const limit = options.limit ?? 10;
    const offset = options.offset ?? 0;

    try {
      const groupResult = await connection.execute(
        `SELECT DISTINCT GROUP_ID
           FROM GAMEDB_SEARCH_SYNONYMS
          WHERE (:searchQuery IS NULL
             OR LOWER(TERM_TEXT) LIKE :searchQuery
             OR TERM_NORM LIKE :normalizedQuery)
          ORDER BY GROUP_ID ASC
          OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
        { searchQuery, normalizedQuery, offset, limit },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      const groupIds = (groupResult.rows ?? []).map((row: any) => Number(row.GROUP_ID));
      if (!groupIds.length) return [];

      const binds: Record<string, number> = {};
      const placeholders = groupIds.map((groupId, index) => {
        const key = `groupId${index}`;
        binds[key] = groupId;
        return `:${key}`;
      });

      const termResult = await connection.execute(
        `SELECT TERM_ID, GROUP_ID, TERM_TEXT, TERM_NORM, CREATED_AT, CREATED_BY
           FROM GAMEDB_SEARCH_SYNONYMS
          WHERE GROUP_ID IN (${placeholders.join(", ")})
          ORDER BY GROUP_ID ASC, TERM_TEXT ASC`,
        binds,
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      return (termResult.rows ?? []).map((row) => mapSynonymRow(row));
    } finally {
      await connection.close();
    }
  }

  static async addSynonymPair(
    termText: string,
    matchText: string,
    createdBy: string | null,
  ): Promise<{ groupId: number; terms: IGameSearchSynonym[] }> {
    const trimmedTerm = termText.trim();
    const trimmedMatch = matchText.trim();
    if (!trimmedTerm || !trimmedMatch) {
      throw new Error("Both term and match text are required.");
    }

    const pool = getOraclePool();
    const connection = await pool.getConnection();
    try {
      const termGroups = await this.getGroupIdsForTerm(trimmedTerm, connection);
      const matchGroups = await this.getGroupIdsForTerm(trimmedMatch, connection);
      const sharedGroup = termGroups.find((groupId) => matchGroups.includes(groupId));
      let groupId = sharedGroup ?? null;

      if (!groupId) {
        const groupResult = await connection.execute(
          `INSERT INTO GAMEDB_SEARCH_SYNONYM_GROUPS (CREATED_BY)
           VALUES (:createdBy)
           RETURNING GROUP_ID INTO :groupId`,
          {
            createdBy,
            groupId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
          },
          { autoCommit: true },
        );
        groupId = Number((groupResult.outBinds as any)?.groupId?.[0]);
      }

      const inserts = [trimmedTerm, trimmedMatch];
      for (const text of inserts) {
        const norm = normalizeSearchTerm(text);
        if (!norm) {
          throw new Error("Synonyms must include letters or numbers.");
        }
        try {
          await connection.execute(
            `INSERT INTO GAMEDB_SEARCH_SYNONYMS (GROUP_ID, TERM_TEXT, TERM_NORM, CREATED_BY)
             VALUES (:groupId, :termText, :termNorm, :createdBy)`,
            {
              groupId,
              termText: text,
              termNorm: norm,
              createdBy,
            },
            { autoCommit: true },
          );
        } catch (err: any) {
          const msg = err?.message ?? "";
          if (!/ORA-00001/i.test(msg)) {
            throw err;
          }
        }
      }

      const terms = await this.listGroupTerms(groupId, connection);
      return { groupId, terms };
    } finally {
      await connection.close();
    }
  }

  static async updateSynonym(
    termId: number,
    termText: string,
  ): Promise<IGameSearchSynonym | null> {
    const trimmed = termText.trim();
    if (!trimmed) {
      throw new Error("Term text cannot be empty.");
    }
    const termNorm = normalizeSearchTerm(trimmed);
    if (!termNorm) {
      throw new Error("Term text must include letters or numbers.");
    }

    const pool = getOraclePool();
    const connection = await pool.getConnection();
    try {
      await connection.execute(
        `UPDATE GAMEDB_SEARCH_SYNONYMS
            SET TERM_TEXT = :termText,
                TERM_NORM = :termNorm
          WHERE TERM_ID = :termId`,
        { termId, termText: trimmed, termNorm },
        { autoCommit: true },
      );
      return await this.getSynonymById(termId, connection);
    } finally {
      await connection.close();
    }
  }

  static async updateGroupTerms(
    groupId: number,
    terms: string[],
    updatedBy: string | null,
  ): Promise<{ groupId: number; terms: IGameSearchSynonym[] }> {
    if (!Number.isInteger(groupId) || groupId <= 0) {
      throw new Error("Invalid synonym group.");
    }
    const cleaned = terms.map((term) => term.trim()).filter(Boolean);
    if (cleaned.length < 2) {
      throw new Error("A synonym group must contain at least two terms.");
    }

    const pool = getOraclePool();
    const connection = await pool.getConnection();
    try {
      const existsResult = await connection.execute(
        `SELECT COUNT(*) AS CNT
           FROM GAMEDB_SEARCH_SYNONYM_GROUPS
          WHERE GROUP_ID = :groupId`,
        { groupId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const existsRow = (existsResult.rows ?? [])[0] as any;
      if (Number(existsRow?.CNT ?? 0) === 0) {
        throw new Error("Synonym group not found.");
      }

      await connection.execute(
        `DELETE FROM GAMEDB_SEARCH_SYNONYMS
          WHERE GROUP_ID = :groupId`,
        { groupId },
        { autoCommit: true },
      );

      for (const text of cleaned) {
        const norm = normalizeSearchTerm(text);
        if (!norm) {
          throw new Error("Synonym terms must include letters or numbers.");
        }
        try {
          await connection.execute(
            `INSERT INTO GAMEDB_SEARCH_SYNONYMS (GROUP_ID, TERM_TEXT, TERM_NORM, CREATED_BY)
             VALUES (:groupId, :termText, :termNorm, :createdBy)`,
            {
              groupId,
              termText: text,
              termNorm: norm,
              createdBy: updatedBy,
            },
            { autoCommit: true },
          );
        } catch (err: any) {
          const msg = err?.message ?? "";
          if (!/ORA-00001/i.test(msg)) {
            throw err;
          }
        }
      }

      const updatedTerms = await this.listGroupTerms(groupId, connection);
      return { groupId, terms: updatedTerms };
    } finally {
      await connection.close();
    }
  }

  static async createGroupTerms(
    terms: string[],
    createdBy: string | null,
  ): Promise<{ groupId: number; terms: IGameSearchSynonym[] }> {
    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const term of terms) {
      const trimmed = term.trim();
      if (!trimmed) continue;
      const norm = normalizeSearchTerm(trimmed);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      cleaned.push(trimmed);
    }

    if (cleaned.length < 2) {
      throw new Error("A synonym group must contain at least two terms.");
    }

    const pool = getOraclePool();
    const connection = await pool.getConnection();
    try {
      const groupResult = await connection.execute(
        `INSERT INTO GAMEDB_SEARCH_SYNONYM_GROUPS (CREATED_BY)
         VALUES (:createdBy)
         RETURNING GROUP_ID INTO :groupId`,
        {
          createdBy,
          groupId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        },
        { autoCommit: true },
      );
      const groupId = Number((groupResult.outBinds as any)?.groupId?.[0]);
      if (!Number.isInteger(groupId) || groupId <= 0) {
        throw new Error("Failed to create synonym group.");
      }

      for (const text of cleaned) {
        const norm = normalizeSearchTerm(text);
        await connection.execute(
          `INSERT INTO GAMEDB_SEARCH_SYNONYMS (GROUP_ID, TERM_TEXT, TERM_NORM, CREATED_BY)
           VALUES (:groupId, :termText, :termNorm, :createdBy)`,
          {
            groupId,
            termText: text,
            termNorm: norm,
            createdBy,
          },
          { autoCommit: true },
        );
      }

      const savedTerms = await this.listGroupTerms(groupId, connection);
      return { groupId, terms: savedTerms };
    } finally {
      await connection.close();
    }
  }

  static async deleteSynonym(termId: number): Promise<boolean> {
    const pool = getOraclePool();
    const connection = await pool.getConnection();
    try {
      const groupResult = await connection.execute(
        `SELECT GROUP_ID
           FROM GAMEDB_SEARCH_SYNONYMS
          WHERE TERM_ID = :termId`,
        { termId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const groupRow = (groupResult.rows ?? [])[0] as any;
      const groupId = groupRow ? Number(groupRow.GROUP_ID) : null;

      const result = await connection.execute(
        `DELETE FROM GAMEDB_SEARCH_SYNONYMS WHERE TERM_ID = :termId`,
        { termId },
        { autoCommit: true },
      );

      if (groupId) {
        const countResult = await connection.execute(
          `SELECT COUNT(*) AS CNT
             FROM GAMEDB_SEARCH_SYNONYMS
            WHERE GROUP_ID = :groupId`,
          { groupId },
          { outFormat: oracledb.OUT_FORMAT_OBJECT },
        );
        const countRow = (countResult.rows ?? [])[0] as any;
        if (Number(countRow?.CNT ?? 0) === 0) {
          await connection.execute(
            `DELETE FROM GAMEDB_SEARCH_SYNONYM_GROUPS WHERE GROUP_ID = :groupId`,
            { groupId },
            { autoCommit: true },
          );
        }
      }

      return (result.rowsAffected ?? 0) > 0;
    } finally {
      await connection.close();
    }
  }

  static async deleteGroup(groupId: number): Promise<boolean> {
    if (!Number.isInteger(groupId) || groupId <= 0) return false;
    const pool = getOraclePool();
    const connection = await pool.getConnection();
    try {
      const existsResult = await connection.execute(
        `SELECT COUNT(*) AS CNT
           FROM GAMEDB_SEARCH_SYNONYM_GROUPS
          WHERE GROUP_ID = :groupId`,
        { groupId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const existsRow = (existsResult.rows ?? [])[0] as any;
      if (Number(existsRow?.CNT ?? 0) === 0) {
        return false;
      }

      await connection.execute(
        `DELETE FROM GAMEDB_SEARCH_SYNONYMS
          WHERE GROUP_ID = :groupId`,
        { groupId },
        { autoCommit: true },
      );
      await connection.execute(
        `DELETE FROM GAMEDB_SEARCH_SYNONYM_GROUPS
          WHERE GROUP_ID = :groupId`,
        { groupId },
        { autoCommit: true },
      );
      return true;
    } finally {
      await connection.close();
    }
  }

  static async getSynonymById(
    termId: number,
    connection?: oracledb.Connection,
  ): Promise<IGameSearchSynonym | null> {
    const pool = getOraclePool();
    const activeConnection = connection ?? await pool.getConnection();
    try {
      const result = await activeConnection.execute(
        `SELECT TERM_ID, GROUP_ID, TERM_TEXT, TERM_NORM, CREATED_AT, CREATED_BY
           FROM GAMEDB_SEARCH_SYNONYMS
          WHERE TERM_ID = :termId`,
        { termId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const row = (result.rows ?? [])[0] as any;
      return row ? mapSynonymRow(row) : null;
    } finally {
      if (!connection) {
        await activeConnection.close();
      }
    }
  }
}
