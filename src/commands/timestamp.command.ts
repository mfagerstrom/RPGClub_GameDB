import type { CommandInteraction } from "discord.js";
import { ApplicationCommandOptionType, MessageFlags } from "discord.js";
import { Discord, Slash, SlashChoice, SlashOption } from "discordx";
import { DateTime } from "luxon";
import { safeDeferReply, safeReply, sanitizeUserInput } from "../functions/InteractionUtils.js";

type DiscordTimestampFormat = "t" | "T" | "d" | "D" | "f" | "F" | "R";
type RelativeUnit = "minutes" | "hours" | "days" | "weeks";

type ParseOutcome =
  | { ok: true; dateTime: DateTime }
  | { ok: false; error: string };

const DEFAULT_SERVER_TIMEZONE = "America/New_York";

const TIMESTAMP_FORMAT_CHOICES: { name: string; value: DiscordTimestampFormat }[] = [
  { name: "Long Date Time", value: "F" },
  { name: "Short Date Time", value: "f" },
  { name: "Long Date", value: "D" },
  { name: "Short Date", value: "d" },
  { name: "Long Time", value: "T" },
  { name: "Short Time", value: "t" },
  { name: "Relative", value: "R" },
];

const WEEKDAY_MAP: Record<string, number> = {
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
  sunday: 7,
  sun: 7,
};

const ABSOLUTE_FORMATS_WITH_YEAR: string[] = [
  "yyyy-MM-dd HH:mm",
  "yyyy-MM-dd H:mm",
  "yyyy-MM-dd h:mm a",
  "yyyy-MM-dd h:mma",
  "M/d/yyyy HH:mm",
  "M/d/yyyy H:mm",
  "M/d/yyyy h:mm a",
  "M/d/yyyy h:mma",
  "M/d/yy HH:mm",
  "M/d/yy h:mm a",
  "M/d/yyyy",
  "yyyy-MM-dd",
];

const ABSOLUTE_FORMATS_NO_YEAR: string[] = [
  "M/d HH:mm",
  "M/d H:mm",
  "M/d h:mm a",
  "M/d h:mma",
  "M/d",
];

const TIME_ONLY_FORMATS: string[] = [
  "h:mm a",
  "h:mma",
  "ha",
  "h a",
  "HH:mm",
  "H:mm",
];

@Discord()
export class TimestampCommand {
  @Slash({
    description: "Generate a Discord timestamp from natural date/time input",
    name: "timestamp",
  })
  async timestamp(
    @SlashOption({
      description: "Date/time input (e.g. in 5 hours, 8pm on Friday, tomorrow at 5pm)",
      name: "datetime",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    datetimeInput: string,
    @SlashOption({
      description: "Timezone used to parse datetime (e.g. America/New_York, UTC)",
      name: "parsing_timezone",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    parsingTimezoneInput: string | undefined,
    @SlashOption({
      description: "If true, send publicly in channel (default false)",
      name: "public",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    isPublicInput: boolean | undefined,
    @SlashChoice(...TIMESTAMP_FORMAT_CHOICES)
    @SlashOption({
      description: "Optional single timestamp format (recommended on mobile)",
      name: "format",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    formatInput: DiscordTimestampFormat | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    datetimeInput = sanitizeUserInput(datetimeInput, { preserveNewlines: false }).trim();
    parsingTimezoneInput = parsingTimezoneInput
      ? sanitizeUserInput(parsingTimezoneInput, { preserveNewlines: false }).trim()
      : undefined;

    const isPublic = isPublicInput === true;
    const timezoneResult = resolveParsingTimezone(parsingTimezoneInput);

    await safeDeferReply(interaction, {
      flags: isPublic ? undefined : MessageFlags.Ephemeral,
    });

    if (!timezoneResult.ok) {
      await safeReply(interaction, {
        content:
          `${timezoneResult.error}\n` +
          "Use an IANA timezone like `America/New_York`, `Europe/London`, `Asia/Tokyo`, or `UTC`.",
      });
      return;
    }

    const parseResult = parseDateTimeInput(datetimeInput, timezoneResult.zone);
    if (!parseResult.ok) {
      await safeReply(interaction, {
        content:
          `${parseResult.error}\n` +
          "Examples: `in 5 hours`, `8pm on Friday`, `08/21 at 19:30`, `tomorrow at 5pm`.",
      });
      return;
    }

    const unixSeconds = Math.floor(parseResult.dateTime.toSeconds());
    await safeReply(interaction, {
      content: buildTimestampDetailsMessage(unixSeconds, timezoneResult.zone, formatInput),
    });
  }
}

function resolveParsingTimezone(
  timezoneInput: string | undefined,
): { ok: true; zone: string } | { ok: false; error: string } {
  if (!timezoneInput) {
    return { ok: true, zone: DEFAULT_SERVER_TIMEZONE };
  }

  const zone = timezoneInput.trim();
  const probe = DateTime.now().setZone(zone);
  if (!probe.isValid) {
    return { ok: false, error: `Invalid parsing_timezone: \`${zone}\`.` };
  }

  return { ok: true, zone };
}

function parseDateTimeInput(input: string, zone: string): ParseOutcome {
  if (!input) {
    return { ok: false, error: "`datetime` cannot be empty." };
  }

  const normalizedInput = input.replace(/\s+/g, " ").trim();
  const withoutAt = normalizedInput.replace(/\bat\b/gi, " ").replace(/\s+/g, " ").trim();
  const now = DateTime.now().setZone(zone);

  const relativeResult = tryParseRelative(withoutAt, now);
  if (relativeResult) {
    return { ok: true, dateTime: relativeResult };
  }

  const tomorrowResult = tryParseTomorrow(withoutAt, now);
  if (tomorrowResult) {
    return { ok: true, dateTime: tomorrowResult };
  }

  const weekdayResult = tryParseWeekdayExpression(withoutAt, now);
  if (weekdayResult) {
    return { ok: true, dateTime: weekdayResult };
  }

  const iso = DateTime.fromISO(normalizedInput, { zone });
  if (iso.isValid) {
    return { ok: true, dateTime: iso };
  }

  const withYear = parseFromFormats(withoutAt, zone, ABSOLUTE_FORMATS_WITH_YEAR);
  if (withYear) {
    return { ok: true, dateTime: withYear };
  }

  const noYear = parseFromFormats(withoutAt, zone, ABSOLUTE_FORMATS_NO_YEAR);
  if (noYear) {
    const withCurrentYear = noYear.set({ year: now.year });
    const hasNoYearAndNoTime = /^\d{1,2}\/\d{1,2}$/.test(withoutAt);
    if (hasNoYearAndNoTime) {
      return { ok: true, dateTime: withCurrentYear.startOf("day") };
    }

    const normalizedNoYear = withCurrentYear < now
      ? withCurrentYear.plus({ years: 1 })
      : withCurrentYear;
    return { ok: true, dateTime: normalizedNoYear };
  }

  return {
    ok: false,
    error: `Could not parse datetime: \`${input}\`.`,
  };
}

function tryParseRelative(input: string, now: DateTime): DateTime | null {
  const relativeMatch = input.match(
    /^in\s+(\d+)\s*(minute|minutes|min|mins|hour|hours|hr|hrs|day|days|week|weeks)$/i,
  );
  if (!relativeMatch) {
    return null;
  }

  const amount = Number(relativeMatch[1]);
  const unitLabel = relativeMatch[2].toLowerCase();

  const unitMap: Record<string, RelativeUnit> = {
    minute: "minutes",
    minutes: "minutes",
    min: "minutes",
    mins: "minutes",
    hour: "hours",
    hours: "hours",
    hr: "hours",
    hrs: "hours",
    day: "days",
    days: "days",
    week: "weeks",
    weeks: "weeks",
  };

  const unit = unitMap[unitLabel];
  if (!unit || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return now.plus({ [unit]: amount });
}

function tryParseTomorrow(input: string, now: DateTime): DateTime | null {
  const tomorrowMatch = input.match(/^tomorrow(?:\s+(.+))?$/i);
  if (!tomorrowMatch) {
    return null;
  }

  const timePart = tomorrowMatch[1]?.trim();
  const tomorrow = now.plus({ days: 1 }).startOf("day");

  if (!timePart) {
    return tomorrow;
  }

  const time = parseTimeForDate(timePart, tomorrow);
  if (!time) {
    return null;
  }

  return time;
}

function tryParseWeekdayExpression(input: string, now: DateTime): DateTime | null {
  const match = input.match(/^(.+?)\s+on\s+([a-z]+)$/i);
  if (!match) {
    return null;
  }

  const timePart = match[1].trim();
  const weekdayLabel = match[2].toLowerCase();
  const targetWeekday = WEEKDAY_MAP[weekdayLabel];
  if (!targetWeekday) {
    return null;
  }

  const dayOffset = (targetWeekday - now.weekday + 7) % 7;
  const targetDate = now.plus({ days: dayOffset }).startOf("day");
  const parsedTime = parseTimeForDate(timePart, targetDate);
  if (!parsedTime) {
    return null;
  }

  if (dayOffset === 0 && parsedTime <= now) {
    return parsedTime.plus({ days: 7 });
  }

  return parsedTime;
}

function parseFromFormats(input: string, zone: string, formats: string[]): DateTime | null {
  for (const format of formats) {
    const parsed = DateTime.fromFormat(input, format, { zone });
    if (parsed.isValid) {
      return parsed;
    }
  }

  return null;
}

function parseTimeForDate(timeInput: string, baseDate: DateTime): DateTime | null {
  for (const format of TIME_ONLY_FORMATS) {
    const parsed = DateTime.fromFormat(timeInput, format, { zone: baseDate.zone });
    if (!parsed.isValid) {
      continue;
    }

    return baseDate.set({
      hour: parsed.hour,
      minute: parsed.minute,
      second: 0,
      millisecond: 0,
    });
  }

  return null;
}

function buildDiscordTimestamp(unixSeconds: number, format: DiscordTimestampFormat): string {
  return `<t:${unixSeconds}:${format}>`;
}

function buildTimestampDetailsMessage(
  unixSeconds: number,
  timezone: string,
  format: DiscordTimestampFormat | undefined,
): string {
  const header =
    "**Timestamp Details**\n" +
    `Times are parsed using the \`${timezone}\` timezone.\n\n` +
    "Copy and paste the text below to show a time converted to each user's local timezone.\n";

  const selectedFormats: DiscordTimestampFormat[] = format
    ? [format]
    : TIMESTAMP_FORMAT_CHOICES.map((choice) => choice.value);

  const lines = selectedFormats.map((formatCode) => {
    const code = buildDiscordTimestamp(unixSeconds, formatCode);
    return `\`${code}\` ${code}`;
  });

  return `${header}\n${lines.join("\n")}`;
}
