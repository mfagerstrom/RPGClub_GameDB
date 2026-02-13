import type { RawModalFeature, RawModalFlow } from "./RawModalScope.js";

export const RAW_MODAL_SESSION_STATUSES = ["open", "submitted", "expired"] as const;
export type RawModalSessionStatus = (typeof RAW_MODAL_SESSION_STATUSES)[number];

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

export function isRawModalSessionStatus(value: string): value is RawModalSessionStatus {
  return RAW_MODAL_SESSION_STATUSES.includes(value as RawModalSessionStatus);
}

export function isRawModalSessionExpired(
  session: Pick<IRawModalSessionRecord, "expiresAt">,
  now: Date = new Date(),
): boolean {
  return session.expiresAt.getTime() <= now.getTime();
}
