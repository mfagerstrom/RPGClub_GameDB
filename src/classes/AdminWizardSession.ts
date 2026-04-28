import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";

export const ADMIN_WIZARD_COMMANDS = ["nextround-setup"] as const;
export type AdminWizardCommand = (typeof ADMIN_WIZARD_COMMANDS)[number];

export const ADMIN_WIZARD_SESSION_STATUSES = ["active", "completed", "cancelled"] as const;
export type AdminWizardSessionStatus = (typeof ADMIN_WIZARD_SESSION_STATUSES)[number];

export const NEXT_ROUND_WIZARD_STEPS = [
  "start",
  "gotm-count",
  "gotm-select",
  "gotm-order",
  "nr-count",
  "nr-select",
  "nr-order",
  "date-choice",
  "date-input",
  "review",
  "commit",
] as const;
export type NextRoundWizardStep = (typeof NEXT_ROUND_WIZARD_STEPS)[number];

export interface INextRoundWizardState {
  step: NextRoundWizardStep;
  roundNumber: number | null;
  monthYear: string | null;
  selectedGotmNominationIds: number[];
  selectedNrGotmNominationIds: number[];
  selectedGotmOrder: number[];
  selectedNrGotmOrder: number[];
  gotmPickCount: number | null;
  nrPickCount: number | null;
  chosenVoteDateIso: string | null;
  testMode: boolean;
  stateLastUpdatedAt: Date;
}

export interface IAdminWizardSession {
  sessionId: string;
  commandKey: AdminWizardCommand;
  ownerUserId: string;
  channelId: string;
  guildId: string | null;
  status: AdminWizardSessionStatus;
  state: INextRoundWizardState;
  createdAt: Date;
  updatedAt: Date;
  lastUpdatedAt: Date;
}

type AdminWizardSessionRow = {
  SESSION_ID: string;
  COMMAND_KEY: string;
  OWNER_USER_ID: string;
  CHANNEL_ID: string;
  GUILD_ID: string | null;
  STATUS: string;
  STATE_JSON: string;
  LAST_UPDATED_AT: Date | string;
  CREATED_AT: Date | string;
  UPDATED_AT: Date | string;
};

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toDbStatus(status: AdminWizardSessionStatus): string {
  return status.toUpperCase();
}

function fromDbStatus(status: string): AdminWizardSessionStatus {
  const normalized = status.trim().toLowerCase();
  if (ADMIN_WIZARD_SESSION_STATUSES.includes(normalized as AdminWizardSessionStatus)) {
    return normalized as AdminWizardSessionStatus;
  }
  throw new Error(`Unknown admin wizard status: ${status}`);
}

function sanitizeNumberArray(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function parseNextRoundWizardState(raw: string): INextRoundWizardState {
  let parsed: any = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }

  const rawStep = String(parsed?.step ?? "start");
  const step = NEXT_ROUND_WIZARD_STEPS.includes(rawStep as NextRoundWizardStep)
    ? (rawStep as NextRoundWizardStep)
    : "start";

  const roundNumber = parsed?.roundNumber == null ? null : Number(parsed.roundNumber);
  const normalizedRoundNumber =
    roundNumber !== null && Number.isInteger(roundNumber) && roundNumber > 0 ? roundNumber : null;

  const monthYear =
    typeof parsed?.monthYear === "string" && parsed.monthYear.trim()
      ? parsed.monthYear.trim()
      : null;

  const chosenVoteDateIso =
    typeof parsed?.chosenVoteDateIso === "string" && parsed.chosenVoteDateIso.trim()
      ? parsed.chosenVoteDateIso.trim()
      : null;

  const parsedUpdated = parsed?.stateLastUpdatedAt
    ? new Date(parsed.stateLastUpdatedAt)
    : new Date();
  const stateLastUpdatedAt = Number.isNaN(parsedUpdated.getTime()) ? new Date() : parsedUpdated;

  return {
    step,
    roundNumber: normalizedRoundNumber,
    monthYear,
    selectedGotmNominationIds: sanitizeNumberArray(parsed?.selectedGotmNominationIds),
    selectedNrGotmNominationIds: sanitizeNumberArray(parsed?.selectedNrGotmNominationIds),
    selectedGotmOrder: sanitizeNumberArray(parsed?.selectedGotmOrder),
    selectedNrGotmOrder: sanitizeNumberArray(parsed?.selectedNrGotmOrder),
    gotmPickCount:
      Number.isInteger(Number(parsed?.gotmPickCount)) && Number(parsed?.gotmPickCount) > 0
        ? Number(parsed?.gotmPickCount)
        : null,
    nrPickCount:
      Number.isInteger(Number(parsed?.nrPickCount)) && Number(parsed?.nrPickCount) > 0
        ? Number(parsed?.nrPickCount)
        : null,
    chosenVoteDateIso,
    testMode: Boolean(parsed?.testMode),
    stateLastUpdatedAt,
  };
}

function serializeNextRoundWizardState(state: INextRoundWizardState): string {
  return JSON.stringify({
    ...state,
    stateLastUpdatedAt: state.stateLastUpdatedAt.toISOString(),
  });
}

function mapAdminWizardSessionRow(row: AdminWizardSessionRow): IAdminWizardSession {
  return {
    sessionId: row.SESSION_ID,
    commandKey: row.COMMAND_KEY as AdminWizardCommand,
    ownerUserId: row.OWNER_USER_ID,
    channelId: row.CHANNEL_ID,
    guildId: row.GUILD_ID,
    status: fromDbStatus(row.STATUS),
    state: parseNextRoundWizardState(row.STATE_JSON),
    createdAt: toDate(row.CREATED_AT),
    updatedAt: toDate(row.UPDATED_AT),
    lastUpdatedAt: toDate(row.LAST_UPDATED_AT),
  };
}

export function createDefaultNextRoundWizardState(testMode: boolean): INextRoundWizardState {
  return {
    step: "start",
    roundNumber: null,
    monthYear: null,
    selectedGotmNominationIds: [],
    selectedNrGotmNominationIds: [],
    selectedGotmOrder: [],
    selectedNrGotmOrder: [],
    gotmPickCount: null,
    nrPickCount: null,
    chosenVoteDateIso: null,
    testMode,
    stateLastUpdatedAt: new Date(),
  };
}

export async function getActiveAdminWizardSession(
  commandKey: AdminWizardCommand,
  ownerUserId: string,
  channelId: string,
): Promise<IAdminWizardSession | null> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute<AdminWizardSessionRow>(
      `SELECT SESSION_ID,
              COMMAND_KEY,
              OWNER_USER_ID,
              CHANNEL_ID,
              GUILD_ID,
              STATUS,
              STATE_JSON,
              LAST_UPDATED_AT,
              CREATED_AT,
              UPDATED_AT
         FROM RPG_CLUB_ADMIN_WIZARD_SESSIONS
        WHERE COMMAND_KEY = :commandKey
          AND OWNER_USER_ID = :ownerUserId
          AND CHANNEL_ID = :channelId
          AND STATUS = 'ACTIVE'
        ORDER BY LAST_UPDATED_AT DESC
        FETCH FIRST 1 ROWS ONLY`,
      {
        commandKey,
        ownerUserId,
        channelId,
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    const row = result.rows?.[0];
    return row ? mapAdminWizardSessionRow(row) : null;
  } finally {
    await connection.close();
  }
}

export async function saveAdminWizardSession(params: {
  commandKey: AdminWizardCommand;
  ownerUserId: string;
  channelId: string;
  guildId?: string | null;
  state: INextRoundWizardState;
}): Promise<IAdminWizardSession> {
  const connection = await getOraclePool().getConnection();
  try {
    const normalizedState: INextRoundWizardState = {
      ...params.state,
      stateLastUpdatedAt: new Date(),
    };
    const stateJson = serializeNextRoundWizardState(normalizedState);
    const now = new Date();

    await connection.execute(
      `MERGE INTO RPG_CLUB_ADMIN_WIZARD_SESSIONS t
        USING (
          SELECT :commandKey AS COMMAND_KEY,
                 :ownerUserId AS OWNER_USER_ID,
                 :channelId AS CHANNEL_ID,
                 :guildId AS GUILD_ID,
                 :stateJson AS STATE_JSON,
                 :lastUpdatedAt AS LAST_UPDATED_AT
            FROM dual
        ) src
           ON (t.COMMAND_KEY = src.COMMAND_KEY
               AND t.OWNER_USER_ID = src.OWNER_USER_ID
               AND t.CHANNEL_ID = src.CHANNEL_ID
               AND t.STATUS = 'ACTIVE')
      WHEN MATCHED THEN
        UPDATE SET t.STATE_JSON = src.STATE_JSON,
                   t.GUILD_ID = src.GUILD_ID,
                   t.LAST_UPDATED_AT = src.LAST_UPDATED_AT
      WHEN NOT MATCHED THEN
        INSERT (SESSION_ID, COMMAND_KEY, OWNER_USER_ID, CHANNEL_ID, GUILD_ID, STATUS, STATE_JSON,
                LAST_UPDATED_AT)
        VALUES (
          :sessionId,
          src.COMMAND_KEY,
          src.OWNER_USER_ID,
          src.CHANNEL_ID,
          src.GUILD_ID,
          'ACTIVE',
          src.STATE_JSON,
          src.LAST_UPDATED_AT
        )`,
      {
        commandKey: params.commandKey,
        ownerUserId: params.ownerUserId,
        channelId: params.channelId,
        guildId: params.guildId ?? null,
        stateJson,
        lastUpdatedAt: now,
        sessionId: `wiz-${params.commandKey}-${params.ownerUserId}-${params.channelId}`,
      },
      { autoCommit: true },
    );

    const saved = await getActiveAdminWizardSession(
      params.commandKey,
      params.ownerUserId,
      params.channelId,
    );
    if (!saved) {
      throw new Error("Failed to save admin wizard session.");
    }
    return saved;
  } finally {
    await connection.close();
  }
}

export async function closeActiveAdminWizardSession(params: {
  commandKey: AdminWizardCommand;
  ownerUserId: string;
  channelId: string;
  status: Exclude<AdminWizardSessionStatus, "active">;
}): Promise<boolean> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute(
      `UPDATE RPG_CLUB_ADMIN_WIZARD_SESSIONS
          SET STATUS = :status,
              LAST_UPDATED_AT = :lastUpdatedAt
        WHERE COMMAND_KEY = :commandKey
          AND OWNER_USER_ID = :ownerUserId
          AND CHANNEL_ID = :channelId
          AND STATUS = 'ACTIVE'`,
      {
        status: toDbStatus(params.status),
        lastUpdatedAt: new Date(),
        commandKey: params.commandKey,
        ownerUserId: params.ownerUserId,
        channelId: params.channelId,
      },
      { autoCommit: true },
    );
    return Number(result.rowsAffected ?? 0) > 0;
  } finally {
    await connection.close();
  }
}
