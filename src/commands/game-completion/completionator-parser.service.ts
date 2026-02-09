// CSV parsing logic for Completionator import

import axios from "axios";
import type { CompletionType } from "../profile.command.js";
import Game from "../../classes/Game.js";
import { buildProgressiveTitleVariants, normalizeTitleWithSteps } from "../../functions/ImportTitleNormalization.js";

export async function fetchCsv(url: string): Promise<string | null> {
  try {
    const response = await axios.get(url, { responseType: "arraybuffer" });
    return Buffer.from(response.data).toString("utf-8");
  } catch {
    return null;
  }
}

export function parseCompletionatorCsv(csvText: string): Array<{
  rowIndex: number;
  gameTitle: string;
  platformName: string | null;
  regionName: string | null;
  sourceType: string | null;
  timeText: string | null;
  completedAt: Date | null;
  completionType: string | null;
  playtimeHours: number | null;
}> {
  const rows = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!rows.length) return [];
  const dataRows = rows.slice(1);
  const items: Array<{
    rowIndex: number;
    gameTitle: string;
    platformName: string | null;
    regionName: string | null;
    sourceType: string | null;
    timeText: string | null;
    completedAt: Date | null;
    completionType: string | null;
    playtimeHours: number | null;
  }> = [];

  dataRows.forEach((line, idx) => {
    const fields = parseCsvLine(line);
    if (fields.length < 6) return;
    const [name, platform, region, type, timeText, dateText] = fields;
    const completionType = mapCompletionatorType(type);
    const completedAt = parseCompletionatorDate(dateText);
    const playtimeHours = parseCompletionatorTime(timeText);

    items.push({
      rowIndex: idx + 1,
      gameTitle: name.trim(),
      platformName: platform?.trim() || null,
      regionName: region?.trim() || null,
      sourceType: type?.trim() || null,
      timeText: timeText?.trim() || null,
      completedAt,
      completionType,
      playtimeHours,
    });
  });

  return items;
}

export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }

    current += char;
  }
  fields.push(current);
  return fields;
}

export function mapCompletionatorType(value: string | undefined): CompletionType | null {
  const normalized = (value ?? "").trim();
  if (!normalized) return null;
  const lower = normalized.toLowerCase();
  if (lower === "core game") return "Main Story";
  if (lower === "core game (+ a few extras)") return "Main Story + Side Content";
  if (lower === "core game (+ lots of extras)") return "Main Story + Side Content";
  if (lower === "completionated") return "Completionist";
  return null;
}

export function parseCompletionatorTime(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.trim().match(/(\d+)h:(\d+)m:(\d+)s/i);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return Math.round((hours + minutes / 60) * 100) / 100;
}

export function parseCompletionatorDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parts = value.trim().split("/");
  if (parts.length !== 3) return null;
  const month = Number(parts[0]);
  const day = Number(parts[1]);
  const year = Number(parts[2]);
  if (!month || !day || !year) return null;
  return new Date(year, month - 1, day);
}

export async function searchGameDbWithFallback(
  rawTitle: string,
): Promise<Awaited<ReturnType<typeof Game.searchGames>>> {
  const variants = buildProgressiveTitleVariants(rawTitle);
  for (const variant of variants) {
    const results = await Game.searchGames(variant);
    if (results.length) {
      return results;
    }
  }

  const normalizedTitle = normalizeTitleWithSteps(rawTitle);
  const titleVariants = buildTitleVariants(rawTitle, normalizedTitle);
  for (const variant of titleVariants) {
    const variantResults = await Game.searchGames(variant);
    if (variantResults.length) {
      return variantResults;
    }
  }

  const tokens = rawTitle
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}\p{N}'-]/gu, ""))
    .filter((token) => token.length > 1);
  const uniqueTokens = Array.from(new Set(tokens));
  if (!uniqueTokens.length) {
    return [];
  }

  const resultMap = new Map<number, Awaited<ReturnType<typeof Game.searchGames>>[number]>();
  for (const token of uniqueTokens) {
    const matches = await Game.searchGames(token);
    for (const match of matches) {
      if (!resultMap.has(match.id)) {
        resultMap.set(match.id, match);
      }
    }
  }

  return Array.from(resultMap.values());
}

function buildTitleVariants(rawTitle: string, normalizedTitle: string): string[] {
  const variants: string[] = [];
  const trimmed = rawTitle.trim();
  if (normalizedTitle && normalizedTitle !== trimmed) {
    variants.push(normalizedTitle);
  }

  const colonIndex = trimmed.indexOf(":");
  if (colonIndex > -1) {
    const prefix = trimmed.slice(0, colonIndex).trim();
    const suffix = trimmed.slice(colonIndex + 1).trim();
    const loweredSuffix = suffix.toLowerCase();
    if (!loweredSuffix.startsWith("the ")) {
      variants.push(`${prefix}: The ${suffix}`);
    } else {
      variants.push(`${prefix}: ${suffix.replace(/^the\s+/i, "")}`);
    }
    variants.push(`${prefix} ${suffix}`);
  } else {
    const lowered = trimmed.toLowerCase();
    if (!lowered.startsWith("the ")) {
      variants.push(`The ${trimmed}`);
    } else {
      variants.push(trimmed.replace(/^the\s+/i, ""));
    }
  }

  return Array.from(new Set(variants.filter((variant) => variant && variant !== trimmed)));
}


export { importGameFromIgdb } from "./completion-add.service.js";
