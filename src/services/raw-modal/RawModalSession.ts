import type { RawModalFeature, RawModalFlow } from "./RawModalScope.js";
import oracledb from "oracledb";
import { getOraclePool } from "../../db/oracleClient.js";

export const RAW_MODAL_SESSION_STATUSES = ["open", "submitted", "expired"] as const;
export type RawModalSessionStatus = (typeof RAW_MODAL_SESSION_STATUSES)[number];
const RAW_MODAL_DEFAULT_TTL_MINUTES = 15;

type RawModalSessionRow = {
  SESSION_ID: string;
  FEATURE_ID: string;
  FLOW_ID: string;
  OWNER_USER_ID: string;
  GUILD_ID: string | null;
  CHANNEL_ID: string | null;
  STATE_JSON: string;
  STATUS: string;
  EXPIRES_AT: Date | string;
  CREATED_AT: Date | string;
  UPDATED_AT: Date | string;
};

export interface IRawModalSessionRecord {
  sessionId: string;
  feature: RawModalFeature;
  flow: RawModalFlow;
  ownerUserId: string;
  guildId: string | null;
  channelId: string | null;
  stateJson: string;
  status: RawModalSessionStatus;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IRawModalSessionCreateInput {
  sessionId: string;
  feature: RawModalFeature;
  flow: RawModalFlow;
  ownerUserId: string;
  guildId?: string | null;
  channelId?: string | null;
  stateJson: string;
  expiresAt: Date;
}

export interface IRawModalSessionUpdateInput {
  sessionId: string;
  status: RawModalSessionStatus;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toDbStatus(status: RawModalSessionStatus): string {
  return status.toUpperCase();
}

function fromDbStatus(status: string): RawModalSessionStatus {
  const normalized = status.trim().toLowerCase();
  if (isRawModalSessionStatus(normalized)) {
    return normalized;
  }
  throw new Error(`Unknown raw modal session status: ${status}`);
}

function mapRawModalSessionRow(row: RawModalSessionRow): IRawModalSessionRecord {
  return {
    sessionId: row.SESSION_ID,
    feature: row.FEATURE_ID as RawModalFeature,
    flow: row.FLOW_ID as RawModalFlow,
    ownerUserId: row.OWNER_USER_ID,
    guildId: row.GUILD_ID,
    channelId: row.CHANNEL_ID,
    stateJson: row.STATE_JSON,
    status: fromDbStatus(row.STATUS),
    expiresAt: toDate(row.EXPIRES_AT),
    createdAt: toDate(row.CREATED_AT),
    updatedAt: toDate(row.UPDATED_AT),
  };
}

function normalizeCreateInput(input: IRawModalSessionCreateInput): IRawModalSessionCreateInput {
  return {
    ...input,
    guildId: input.guildId ?? null,
    channelId: input.channelId ?? null,
  };
}

export function isRawModalSessionStatus(value: string): value is RawModalSessionStatus {
  return RAW_MODAL_SESSION_STATUSES.includes(value as RawModalSessionStatus);
}

export function isRawModalSessionExpired(
  session: Pick<IRawModalSessionRecord, "expiresAt">,
  now: Date = new Date(),
): boolean {
  return session.expiresAt.getTime() <= now.getTime();
}

export function buildRawModalSessionExpiry(
  now: Date = new Date(),
  ttlMinutes = RAW_MODAL_DEFAULT_TTL_MINUTES,
): Date {
  return new Date(now.getTime() + Math.max(1, ttlMinutes) * 60 * 1000);
}

export async function createRawModalSessionRecord(
  input: IRawModalSessionCreateInput,
): Promise<IRawModalSessionRecord> {
  const connection = await getOraclePool().getConnection();
  try {
    const session = normalizeCreateInput(input);

    await connection.execute(
      `INSERT INTO RPG_CLUB_RAW_MODAL_SESSIONS
         (SESSION_ID, OWNER_USER_ID, FEATURE_ID, FLOW_ID, STATE_JSON, EXPIRES_AT, STATUS, GUILD_ID, CHANNEL_ID)
       VALUES
         (:sessionId, :ownerUserId, :featureId, :flowId, :stateJson, :expiresAt, :status, :guildId, :channelId)`,
      {
        sessionId: session.sessionId,
        ownerUserId: session.ownerUserId,
        featureId: session.feature,
        flowId: session.flow,
        stateJson: session.stateJson,
        expiresAt: session.expiresAt,
        status: toDbStatus("open"),
        guildId: session.guildId,
        channelId: session.channelId,
      },
      { autoCommit: true },
    );

    const saved = await getRawModalSessionRecord(session.sessionId, connection);
    if (!saved) {
      throw new Error("Failed to create raw modal session.");
    }
    return saved;
  } finally {
    await connection.close();
  }
}

export async function getRawModalSessionRecord(
  sessionId: string,
  existingConnection?: oracledb.Connection,
): Promise<IRawModalSessionRecord | null> {
  const connection = existingConnection ?? (await getOraclePool().getConnection());
  try {
    const result = await connection.execute<RawModalSessionRow>(
      `SELECT SESSION_ID,
              OWNER_USER_ID,
              FEATURE_ID,
              FLOW_ID,
              STATE_JSON,
              STATUS,
              EXPIRES_AT,
              GUILD_ID,
              CHANNEL_ID,
              CREATED_AT,
              UPDATED_AT
         FROM RPG_CLUB_RAW_MODAL_SESSIONS
        WHERE SESSION_ID = :sessionId`,
      { sessionId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    const row = result.rows?.[0];
    return row ? mapRawModalSessionRow(row) : null;
  } finally {
    if (!existingConnection) {
      await connection.close();
    }
  }
}

export async function updateRawModalSessionStatus(
  input: IRawModalSessionUpdateInput,
): Promise<boolean> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute(
      `UPDATE RPG_CLUB_RAW_MODAL_SESSIONS
          SET STATUS = :status
        WHERE SESSION_ID = :sessionId`,
      { status: toDbStatus(input.status), sessionId: input.sessionId },
      { autoCommit: true },
    );
    return Number(result.rowsAffected ?? 0) > 0;
  } finally {
    await connection.close();
  }
}

export async function claimRawModalSessionForSubmit(
  sessionId: string,
  ownerUserId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute(
      `UPDATE RPG_CLUB_RAW_MODAL_SESSIONS
          SET STATUS = 'SUBMITTED'
        WHERE SESSION_ID = :sessionId
          AND OWNER_USER_ID = :ownerUserId
          AND STATUS = 'OPEN'
          AND EXPIRES_AT > :nowTs`,
      {
        sessionId,
        ownerUserId,
        nowTs: now,
      },
      { autoCommit: true },
    );

    return Number(result.rowsAffected ?? 0) > 0;
  } finally {
    await connection.close();
  }
}

export async function expireRawModalSession(sessionId: string): Promise<boolean> {
  return updateRawModalSessionStatus({ sessionId, status: "expired" });
}

export async function deleteExpiredRawModalSessions(cutoffDate: Date): Promise<number> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute(
      `DELETE FROM RPG_CLUB_RAW_MODAL_SESSIONS
        WHERE EXPIRES_AT < :cutoffDate
          AND STATUS IN ('OPEN', 'EXPIRED')`,
      { cutoffDate },
      { autoCommit: true },
    );
    return Number(result.rowsAffected ?? 0);
  } finally {
    await connection.close();
  }
}
