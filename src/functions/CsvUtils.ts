import { normalizeTitleWithSteps } from "./ImportTitleNormalization.js";

export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === "\"" && inQuotes && next === "\"") {
      current += "\"";
      i += 1;
      continue;
    }

    if (char === "\"") {
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

export function parseCsvDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parts = value.trim().split("/");
  if (parts.length !== 3) return null;
  const month = Number(parts[0]);
  const day = Number(parts[1]);
  const year = Number(parts[2]);
  if (!month || !day || !year) return null;
  return new Date(year, month - 1, day);
}

export function normalizeCsvHeader(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizePlatformKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function stripTitleDateSuffix(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/\s*\((\d{4})(?:[/-]\d{1,2}){0,2}\)\s*$/);
  if (!match) return trimmed;
  return trimmed.slice(0, Math.max(0, match.index ?? trimmed.length)).trim();
}

export function normalizeTitleKey(value: string): string {
  const stripped = stripTitleDateSuffix(value);
  return normalizeTitleWithSteps(stripped).toLowerCase();
}
