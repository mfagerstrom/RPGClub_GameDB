import type { RawModalFeature } from "./RawModalScope.js";
import { RAW_MODAL_PILOT_FEATURES } from "./RawModalScope.js";

const RAW_IMPROVED_MODALS_ENV = "USE_RAW_IMPROVED_MODALS";
const RAW_MODAL_PILOT_GUILD_IDS_ENV = "RAW_MODAL_PILOT_GUILD_IDS";
const RAW_MODAL_ALL_GUILDS_TOKEN = "*";

function readBooleanEnv(name: string): boolean {
  return (process.env[name] ?? "").trim().toLowerCase() === "true";
}

function parseGuildIdList(rawValue: string): Set<string> {
  return new Set(
    rawValue
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
}

export function isRawImprovedModalsEnabled(): boolean {
  return readBooleanEnv(RAW_IMPROVED_MODALS_ENV);
}

export function isRawModalPilotFeature(feature: RawModalFeature): boolean {
  return RAW_MODAL_PILOT_FEATURES.includes(feature);
}

export function isRawModalPilotEnabledForGuild(guildId?: string | null): boolean {
  const configuredGuildIds = parseGuildIdList(process.env[RAW_MODAL_PILOT_GUILD_IDS_ENV] ?? "");
  if (configuredGuildIds.size === 0) {
    return false;
  }

  if (configuredGuildIds.has(RAW_MODAL_ALL_GUILDS_TOKEN)) {
    return true;
  }

  if (!guildId) {
    return false;
  }

  return configuredGuildIds.has(guildId);
}

export function isRawModalPilotEnabled(
  feature: RawModalFeature,
  guildId?: string | null,
): boolean {
  if (!isRawImprovedModalsEnabled()) {
    return false;
  }
  if (!isRawModalPilotFeature(feature)) {
    return false;
  }
  return isRawModalPilotEnabledForGuild(guildId);
}
