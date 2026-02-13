import {
  RAW_MODAL_CUSTOM_ID_PREFIX,
  RAW_MODAL_SCHEMA_VERSION,
  RAW_MODAL_SUPPORTED_FEATURES,
  RAW_MODAL_TODO_PILOT_FLOWS,
} from "./RawModalScope.js";
import type { RawModalFeature, RawModalFlow } from "./RawModalScope.js";

const MAX_DISCORD_CUSTOM_ID_LENGTH = 100;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface IRawModalCustomIdParts {
  feature: RawModalFeature;
  flow: RawModalFlow;
  sessionId: string;
}

export interface IRawModalParsedCustomId extends IRawModalCustomIdParts {
  version: number;
}

function isSupportedFeature(value: string): value is RawModalFeature {
  return RAW_MODAL_SUPPORTED_FEATURES.includes(value as RawModalFeature);
}

function isSupportedFlow(value: string): value is RawModalFlow {
  return RAW_MODAL_TODO_PILOT_FLOWS.includes(value as RawModalFlow);
}

function isSessionIdValid(sessionId: string): boolean {
  return SESSION_ID_PATTERN.test(sessionId);
}

export function buildRawModalCustomId(parts: IRawModalCustomIdParts): string {
  if (!isSupportedFeature(parts.feature)) {
    throw new Error(`Unsupported raw modal feature: ${parts.feature}`);
  }
  if (!isSupportedFlow(parts.flow)) {
    throw new Error(`Unsupported raw modal flow: ${parts.flow}`);
  }
  if (!isSessionIdValid(parts.sessionId)) {
    throw new Error("Raw modal sessionId contains unsupported characters.");
  }

  const customId = [
    RAW_MODAL_CUSTOM_ID_PREFIX,
    parts.feature,
    `v${RAW_MODAL_SCHEMA_VERSION}`,
    parts.flow,
    parts.sessionId,
  ].join(":");

  if (customId.length > MAX_DISCORD_CUSTOM_ID_LENGTH) {
    throw new Error(
      `Raw modal custom id length exceeds ${MAX_DISCORD_CUSTOM_ID_LENGTH} characters.`,
    );
  }

  return customId;
}

export function parseRawModalCustomId(customId: string): IRawModalParsedCustomId | null {
  const [prefix, feature, versionPart, flow, sessionId] = customId.split(":");

  if (!prefix || !feature || !versionPart || !flow || !sessionId) {
    return null;
  }
  if (prefix !== RAW_MODAL_CUSTOM_ID_PREFIX) {
    return null;
  }
  if (!isSupportedFeature(feature) || !isSupportedFlow(flow)) {
    return null;
  }
  if (!versionPart.startsWith("v")) {
    return null;
  }
  if (!isSessionIdValid(sessionId)) {
    return null;
  }

  const parsedVersion = Number.parseInt(versionPart.slice(1), 10);
  if (!Number.isFinite(parsedVersion) || parsedVersion < 1) {
    return null;
  }

  return {
    feature,
    flow,
    sessionId,
    version: parsedVersion,
  };
}
