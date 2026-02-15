import {
  AttachmentBuilder,
  type CommandInteraction,
  ApplicationCommandOptionType,
  EmbedBuilder,
  type User,
  MessageFlags,
  PermissionsBitField,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from "discord.js";
import {
  Discord,
  SelectMenuComponent,
  Slash,
  SlashGroup,
  SlashOption,
} from "discordx";
import axios from "axios";
import Member, {
  type IMemberRecord,
  type IMemberSearchFilters,
} from "../classes/Member.js";
import { safeDeferReply, safeReply, sanitizeUserInput } from "../functions/InteractionUtils.js";


export const COMPLETION_TYPES = [
  "Main Story",
  "Main Story + Side Content",
  "Completionist",
] as const;

export type CompletionType = (typeof COMPLETION_TYPES)[number];



export const COMPLETION_PAGE_SIZE = 20;

type ProfileField = {
  label: string;
  value: string;
  inline?: boolean;
};

export type ProfileViewPayload = {
  payload?: {
    embeds: EmbedBuilder[];
    files?: AttachmentBuilder[];
  };
  notFoundMessage?: string;
  errorMessage?: string;
};

function parseDateInput(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function clampLimit(limit: number | undefined, max: number): number {
  if (!limit || Number.isNaN(limit)) return Math.min(50, max);
  return Math.min(Math.max(limit, 1), max);
}

export function parseCompletionDateInput(value: string | undefined): Date | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "today") {
    return new Date();
  }
  if (normalized === "unknown" || normalized === "skip") {
    return null;
  }
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    const parsed = new Date(year, month - 1, day);
    if (
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) {
      throw new Error(
        "Could not parse completion date. Use YYYY-MM-DD, or 'today'/'unknown'.",
      );
    }
    return parsed;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      "Could not parse completion date. Use YYYY-MM-DD, or 'today'/'unknown'.",
    );
  }
  return parsed;
}

export function formatPlaytimeHours(val: number | null | undefined): string | null {
  if (val === null || val === undefined) return null;
  const rounded = Math.round(val * 100) / 100;
  return `${rounded} hours`;
}

function formatCompletionLine(
  record: Awaited<ReturnType<typeof Member.getCompletions>>[number],
  guildId?: string,
): string {
  const title =
    record.threadId && guildId
      ? `[${record.title}](https://discord.com/channels/${guildId}/${record.threadId})`
      : record.title;
  return title;
}

export function formatTableDate(date: Date | null): string {
  if (!date) return "No date";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

function summarizeFilters(filters: IMemberSearchFilters): string {
  const parts: string[] = [];
  if (filters.userId) parts.push(`userId~${filters.userId}`);
  if (filters.username) parts.push(`username~${filters.username}`);
  if (filters.globalName) parts.push(`globalName~${filters.globalName}`);
  if (filters.completionatorUrl) parts.push(`completionator~${filters.completionatorUrl}`);
  if (filters.steamUrl) parts.push(`steam~${filters.steamUrl}`);
  if (filters.psnUsername) parts.push(`psn~${filters.psnUsername}`);
  if (filters.xblUsername) parts.push(`xbl~${filters.xblUsername}`);
  if (filters.nswFriendCode) parts.push(`switch~${filters.nswFriendCode}`);
  if (filters.roleAdmin !== undefined) parts.push(`admin=${filters.roleAdmin ? 1 : 0}`);
  if (filters.roleModerator !== undefined)
    parts.push(`moderator=${filters.roleModerator ? 1 : 0}`);
  if (filters.roleRegular !== undefined) parts.push(`regular=${filters.roleRegular ? 1 : 0}`);
  if (filters.roleMember !== undefined) parts.push(`member=${filters.roleMember ? 1 : 0}`);
  if (filters.roleNewcomer !== undefined) parts.push(`newcomer=${filters.roleNewcomer ? 1 : 0}`);
  if (filters.isBot !== undefined) parts.push(`bot=${filters.isBot ? 1 : 0}`);
  if (filters.joinedAfter) parts.push(`joined>=${filters.joinedAfter.toISOString()}`);
  if (filters.joinedBefore) parts.push(`joined<=${filters.joinedBefore.toISOString()}`);
  if (filters.lastSeenAfter) parts.push(`seen>=${filters.lastSeenAfter.toISOString()}`);
  if (filters.lastSeenBefore) parts.push(`seen<=${filters.lastSeenBefore.toISOString()}`);
  parts.push(`includeDeparted=${filters.includeDeparted ? "yes" : "no"}`);
  return parts.join(" | ") || "none";
}

function chunkOptions<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export function formatDiscordTimestamp(value: Date | null): string {
  if (!value) return "Unknown";
  const seconds = Math.floor(value.getTime() / 1000);
  return `<t:${seconds}:F>`;
}

function buildProfileFields(
  record: Awaited<ReturnType<typeof Member.getByUserId>>,
  nickHistory: string[],
  nowPlaying: { title: string; threadId: string | null; note: string | null }[],
  completions: Awaited<ReturnType<typeof Member.getCompletions>>,
  guildId?: string,
): ProfileField[] {
  if (!record) {
    return [];
  }

  const fields: ProfileField[] = [];

  const globalName = record.globalName ?? "Unknown";
  if (globalName !== "Unknown") {
    fields.push({ label: "Global Name", value: globalName, inline: true });
  }

  if (record.isBot) {
    fields.push({ label: "Bot", value: "Yes", inline: true });
  }

  if (nickHistory.length > 0) {
    fields.push({
      label: "AKA",
      value: nickHistory.join(", "),
      inline: true,
    });
  }

  fields.push({
    label: "Roles",
    value:
      [
        record.roleAdmin ? "Admin" : null,
        record.roleModerator ? "Moderator" : null,
        record.roleRegular ? "Regular" : null,
        record.roleMember ? "Member" : null,
        record.roleNewcomer ? "Newcomer" : null,
      ]
        .filter(Boolean)
        .join(", ")
        .replace(/, $/, "") || "None",
    inline: true,
  });

  fields.push({
    label: "Last Seen",
    value: formatDiscordTimestamp(record.lastSeenAt),
  });
  fields.push({
    label: "Joined Server",
    value: formatDiscordTimestamp(record.serverJoinedAt),
  });

  if (record.completionatorUrl) {
    fields.push({ label: "Game Collection Tracker URL", value: record.completionatorUrl });
  }

  if (record.steamUrl) {
    fields.push({ label: "Steam", value: record.steamUrl });
  }

  if (record.psnUsername) {
    fields.push({ label: "PSN", value: record.psnUsername, inline: true });
  }

  if (record.xblUsername) {
    fields.push({ label: "Xbox", value: record.xblUsername, inline: true });
  }

  if (record.nswFriendCode) {
    fields.push({ label: "Switch", value: record.nswFriendCode, inline: true });
  }

  if (nowPlaying.length) {
    const lines: string[] = [];
    nowPlaying.forEach((entry) => {
      if (entry.threadId && guildId) {
        lines.push(`[${entry.title}](https://discord.com/channels/${guildId}/${entry.threadId})`);
      } else {
        lines.push(entry.title);
      }
      if (entry.note) {
        lines.push(`> ${entry.note}`);
      }
    });
    fields.push({
      label: "Now Playing",
      value: lines.join("\n"),
    });
  }

  if (completions.length) {
    const lines: string[] = [];
    completions.forEach((c) => {
      lines.push(formatCompletionLine(c, guildId));
      if (c.note) {
        lines.push(`> ${c.note}`);
      }
    });
    fields.push({
      label: "Completed (recent)",
      value: lines.join("\n"),
    });
  }

  return fields;
}

function buildAvatarAttachment(
  record: Awaited<ReturnType<typeof Member.getByUserId>>,
): AttachmentBuilder | null {
  if (!record?.avatarBlob) return null;
  return new AttachmentBuilder(record.avatarBlob, { name: "profile-avatar.png" });
}

function avatarBuffersDifferent(a: Buffer | null, b: Buffer | null): boolean {
  if (!a && !b) return false;
  if (!!a !== !!b) return true;
  if (!a || !b) return true;
  if (a.length !== b.length) return true;
  return !a.equals(b);
}

async function downloadAvatar(url: string): Promise<Buffer | null> {
  try {
    const resp = await axios.get<ArrayBuffer>(url, { responseType: "arraybuffer" });
    return Buffer.from(resp.data);
  } catch {
    return null;
  }
}

function buildBaseMemberRecord(user: User): IMemberRecord {
  return {
    userId: user.id,
    isBot: user.bot ? 1 : 0,
    username: user.username ?? null,
    globalName: (user as any).globalName ?? null,
    avatarBlob: null,
    serverJoinedAt: null,
    serverLeftAt: null,
    lastSeenAt: null,
    roleAdmin: 0,
    roleModerator: 0,
    roleRegular: 0,
    roleMember: 0,
    roleNewcomer: 0,
    messageCount: null,
    completionatorUrl: null,
    psnUsername: null,
    xblUsername: null,
    nswFriendCode: null,
    steamUrl: null,
    profileImage: null,
    profileImageAt: null,
  };
}

export async function buildProfileViewPayload(
  target: User,
  guildId?: string,
): Promise<ProfileViewPayload> {
  try {
    let record = await Member.getByUserId(target.id);
    const nowPlaying = await Member.getNowPlaying(target.id);
    const completions = await Member.getCompletions({ userId: target.id, limit: 5 });
    const nickHistoryEntries = await Member.getRecentNickHistory(target.id, 6);
    const avatarUrl = target.displayAvatarURL({
      extension: "png",
      size: 512,
      forceStatic: true,
    });

    if (avatarUrl) {
      const newAvatar = await downloadAvatar(avatarUrl);
      const baseRecord: IMemberRecord = record ?? buildBaseMemberRecord(target);

      if (newAvatar && avatarBuffersDifferent(baseRecord.avatarBlob, newAvatar)) {
        record = {
          ...baseRecord,
          avatarBlob: newAvatar,
          username: target.username ?? baseRecord.username,
          globalName: (target as any).globalName ?? baseRecord.globalName,
          isBot: target.bot ? 1 : 0,
        };
        await Member.upsert(record);
      } else if (!record) {
        record = baseRecord;
      }
    }

    if (!record) {
      return { notFoundMessage: `No profile data found for <@${target.id}>.` };
    }

    const nickHistory: string[] = [];
    for (const entry of nickHistoryEntries) {
      const candidateRaw = entry.oldNick ?? entry.newNick;
      const candidate = candidateRaw?.trim();
      if (!candidate) continue;
      if (candidate === record.globalName || candidate === record.username) continue;
      if (nickHistory.includes(candidate)) continue;
      nickHistory.push(candidate);
      if (nickHistory.length >= 5) break;
    }

    const fields = buildProfileFields(record, nickHistory, nowPlaying, completions, guildId).map((f) => ({
      name: f.label,
      value: f.value,
      inline: f.inline ?? false,
    }));
    const embed = new EmbedBuilder()
      .setTitle("Member Profile")
      .setDescription(`<@${target.id}>`)
      .addFields(fields);

    const attachment = buildAvatarAttachment(record);
    if (attachment) {
      embed.setThumbnail("attachment://profile-avatar.png");
    } else if (target.displayAvatarURL()) {
      embed.setThumbnail(target.displayAvatarURL());
    }

    return {
      payload: {
        embeds: [embed],
        files: attachment ? [attachment] : undefined,
      },
    };
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    return { errorMessage: `Error loading profile: ${msg}` };
  }
}

@SlashGroup({ description: "Profile commands", name: "profile" })
@Discord()
export class ProfileCommand {
  @Slash({ description: "Show a member profile", name: "view" })
  @SlashGroup("profile")
  async profileView(
    @SlashOption({
      description: "Member to view; leave blank to view your own profile.",
      name: "member",
      required: false,
      type: ApplicationCommandOptionType.User,
    })
    member: User | undefined,
    @SlashOption({
      description: "If true, post in channel instead of ephemerally.",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const target = member ?? interaction.user;
    const ephemeral = !showInChat;
    await safeDeferReply(interaction, { flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    const result = await buildProfileViewPayload(target, interaction.guildId ?? undefined);

    if (result.errorMessage) {
      await safeReply(interaction, {
        content: result.errorMessage,
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    if (!result.payload) {
      await safeReply(interaction, {
        content:
          result.notFoundMessage ?? `No profile data found for <@${target.id}>.`,
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    await safeReply(interaction, {
      ...result.payload,
      ephemeral,
    });
  }













  @SelectMenuComponent({ id: /^profile-search-select-\d+$/ })
  async handleProfileSearchSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const userId = interaction.values?.[0];
    if (!userId) {
      await safeReply(interaction, {
        content: "Could not determine which member to load.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    try {
      const user = await interaction.client.users.fetch(userId);
      const result = await buildProfileViewPayload(user, interaction.guildId ?? undefined);

      if (result.errorMessage) {
        await safeReply(interaction, {
          content: result.errorMessage,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (!result.payload) {
        await safeReply(interaction, {
          content:
            result.notFoundMessage ?? `No profile data found for <@${userId}>.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await safeReply(interaction, {
        ...result.payload,
        flags: MessageFlags.Ephemeral,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Could not load that profile: ${msg}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({ description: "Search member profiles", name: "search" })
  @SlashGroup("profile")
  async profileSearch(
    @SlashOption({
      description: "If true, post in channel instead of ephemerally.",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    @SlashOption({
      description: "Filter by user id.",
      name: "userid",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    userId: string | undefined,
    @SlashOption({
      description: "Filter by username (contains).",
      name: "username",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    username: string | undefined,
    @SlashOption({
      description: "Filter by global display name (contains).",
      name: "globalname",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    globalName: string | undefined,
    @SlashOption({
      description: "Filter by Game Collection Tracker URL (contains).",
      name: "completionator",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    completionator: string | undefined,
    @SlashOption({
      description: "Filter by Steam URL (contains).",
      name: "steam",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    steam: string | undefined,
    @SlashOption({
      description: "Filter by PlayStation Network username (contains).",
      name: "psn",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    psn: string | undefined,
    @SlashOption({
      description: "Filter by Xbox Live username (contains).",
      name: "xbl",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    xbl: string | undefined,
    @SlashOption({
      description: "Filter by Nintendo Switch friend code (contains).",
      name: "switch",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    nsw: string | undefined,
    @SlashOption({
      description: "Filter by Admin role flag (1 or 0).",
      name: "admin",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    roleAdmin: boolean | undefined,
    @SlashOption({
      description: "Filter by Moderator role flag (1 or 0).",
      name: "moderator",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    roleModerator: boolean | undefined,
    @SlashOption({
      description: "Filter by Regular role flag (1 or 0).",
      name: "regular",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    roleRegular: boolean | undefined,
    @SlashOption({
      description: "Filter by Member role flag (1 or 0).",
      name: "member",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    roleMember: boolean | undefined,
    @SlashOption({
      description: "Filter by Newcomer role flag (1 or 0).",
      name: "newcomer",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    roleNewcomer: boolean | undefined,
    @SlashOption({
      description: "Filter by bot flag (1 or 0).",
      name: "bot",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    isBot: boolean | undefined,
    @SlashOption({
      description: "Joined server on/after (ISO date/time).",
      name: "joinedafter",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    joinedAfter: string | undefined,
    @SlashOption({
      description: "Joined server on/before (ISO date/time).",
      name: "joinedbefore",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    joinedBefore: string | undefined,
    @SlashOption({
      description: "Last seen on/after (ISO date/time).",
      name: "lastseenafter",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    lastSeenAfter: string | undefined,
    @SlashOption({
      description: "Last seen on/before (ISO date/time).",
      name: "lastseenbefore",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    lastSeenBefore: string | undefined,
    @SlashOption({
      description: "Max results to return (1-50).",
      name: "limit",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    limit: number | undefined,
    @SlashOption({
      description: "Include departed members (SERVER_LEFT_AT not null).",
      name: "include-departed-members",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    includeDeparted: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const ephemeral = !showInChat;
    await safeDeferReply(interaction, { flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    userId = userId ? sanitizeUserInput(userId, { preserveNewlines: false }) : undefined;
    username = username ? sanitizeUserInput(username, { preserveNewlines: false }) : undefined;
    globalName = globalName ? sanitizeUserInput(globalName, { preserveNewlines: false }) : undefined;
    completionator = completionator
      ? sanitizeUserInput(completionator, { preserveNewlines: false })
      : undefined;
    steam = steam ? sanitizeUserInput(steam, { preserveNewlines: false }) : undefined;
    psn = psn ? sanitizeUserInput(psn, { preserveNewlines: false }) : undefined;
    xbl = xbl ? sanitizeUserInput(xbl, { preserveNewlines: false }) : undefined;
    nsw = nsw ? sanitizeUserInput(nsw, { preserveNewlines: false }) : undefined;
    joinedAfter = joinedAfter ? sanitizeUserInput(joinedAfter, { preserveNewlines: false }) : undefined;
    joinedBefore = joinedBefore
      ? sanitizeUserInput(joinedBefore, { preserveNewlines: false })
      : undefined;
    lastSeenAfter = lastSeenAfter
      ? sanitizeUserInput(lastSeenAfter, { preserveNewlines: false })
      : undefined;
    lastSeenBefore = lastSeenBefore
      ? sanitizeUserInput(lastSeenBefore, { preserveNewlines: false })
      : undefined;

    const joinedAfterDate = parseDateInput(joinedAfter);
    const joinedBeforeDate = parseDateInput(joinedBefore);
    const lastSeenAfterDate = parseDateInput(lastSeenAfter);
    const lastSeenBeforeDate = parseDateInput(lastSeenBefore);

    if (joinedAfter && !joinedAfterDate) {
      await safeReply(interaction, {
        content: "Invalid joinedafter date/time. Please use an ISO format.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    if (joinedBefore && !joinedBeforeDate) {
      await safeReply(interaction, {
        content: "Invalid joinedbefore date/time. Please use an ISO format.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    if (lastSeenAfter && !lastSeenAfterDate) {
      await safeReply(interaction, {
        content: "Invalid lastseenafter date/time. Please use an ISO format.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    if (lastSeenBefore && !lastSeenBeforeDate) {
      await safeReply(interaction, {
        content: "Invalid lastseenbefore date/time. Please use an ISO format.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const filters: IMemberSearchFilters = {
      userId,
      username,
      globalName,
      completionatorUrl: completionator,
      steamUrl: steam,
      psnUsername: psn,
      xblUsername: xbl,
      nswFriendCode: nsw,
      roleAdmin,
      roleModerator,
      roleRegular,
      roleMember,
      roleNewcomer,
      isBot,
      joinedAfter: joinedAfterDate ?? undefined,
      joinedBefore: joinedBeforeDate ?? undefined,
      lastSeenAfter: lastSeenAfterDate ?? undefined,
      lastSeenBefore: lastSeenBeforeDate ?? undefined,
      limit: clampLimit(limit, 100),
      includeDeparted: includeDeparted ?? false,
    };

    const results = await Member.search(filters);
    if (!results.length) {
      await safeReply(interaction, {
        content: "No members matched those filters.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const filterSummary = summarizeFilters(filters);
    const lines = results.map((record, idx) => {
      const name = record.globalName ?? record.username;
      const label = name ? `(${name})` : "";
      const botTag = record.isBot ? " [Bot]" : "";
      return `${idx + 1}. <@${record.userId}> ${label}${botTag}`;
    });

    const description = `Filters: ${filterSummary}\n\n${lines.join("\n")}`;

    const selectOptions = results.map((record, idx) => {
      const label = (record.globalName ?? record.username ?? `Member ${idx + 1}`).slice(0, 100);
      const descriptionText = `ID: ${record.userId}${record.isBot ? " | Bot" : ""}`;
      return {
        label,
        value: record.userId,
        description: descriptionText.slice(0, 100),
      };
    });

    const selectChunks = chunkOptions(selectOptions, 25);
    const components = selectChunks.slice(0, 5).map((chunk, idx) =>
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`profile-search-select-${idx}`)
          .setPlaceholder("Select a member to view their profile")
          .addOptions(chunk)
          .setMinValues(1)
          .setMaxValues(1),
      ),
    );

    const embed = new EmbedBuilder()
      .setTitle(`Profile search (${results.length})`)
      .setDescription(description.slice(0, 4000))
      .setFooter({ text: "Choose a member below to view a profile." });

    const content =
      selectChunks.length > 5
        ? "Showing the first 125 selectable results (Discord limits). Refine filters to narrow further."
        : description.length > 4000
            ? "Showing truncated results (Discord length limits). Refine filters for more detail."
            : undefined;

    await safeReply(interaction, {
      content,
      embeds: [embed],
      components,
      ephemeral,
    });
  }

  @Slash({ description: "Edit profile links (self, or any user if admin)", name: "edit" })
  @SlashGroup("profile")
  async profileEdit(
    @SlashOption({
      description: "Member to edit; admin only.",
      name: "member",
      required: false,
      type: ApplicationCommandOptionType.User,
    })
    member: User | undefined,
    @SlashOption({
      description: "Game Collection Tracker URL.",
      name: "completionator",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    completionator: string | undefined,
    @SlashOption({
      description: "PlayStation Network username.",
      name: "psn",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    psn: string | undefined,
    @SlashOption({
      description: "Xbox Live username.",
      name: "xbl",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    xbl: string | undefined,
    @SlashOption({
      description: "Nintendo Switch friend code.",
      name: "nsw",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    nsw: string | undefined,
    @SlashOption({
      description: "Steam profile URL.",
      name: "steam",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    steam: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const target = member ?? interaction.user;
    const isAdmin =
      interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator) ?? false;
    const isSelf = target.id === interaction.user.id;
    const ephemeral = true;
    await safeDeferReply(interaction, { flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    completionator = completionator
      ? sanitizeUserInput(completionator, { preserveNewlines: false })
      : undefined;
    psn = psn ? sanitizeUserInput(psn, { preserveNewlines: false }) : undefined;
    xbl = xbl ? sanitizeUserInput(xbl, { preserveNewlines: false }) : undefined;
    nsw = nsw ? sanitizeUserInput(nsw, { preserveNewlines: false }) : undefined;
    steam = steam ? sanitizeUserInput(steam, { preserveNewlines: false }) : undefined;

    if (!isSelf && !isAdmin) {
      await safeReply(interaction, {
        content: "You can only edit your own profile.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (
      completionator === undefined &&
      psn === undefined &&
      xbl === undefined &&
      nsw === undefined &&
      steam === undefined
    ) {
      await safeReply(interaction, {
        content: "Provide at least one field to update.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const existing = (await Member.getByUserId(target.id)) ?? buildBaseMemberRecord(target);

      const updated: IMemberRecord = {
        ...existing,
        username: existing.username ?? target.username ?? null,
        globalName: existing.globalName ?? (target as any).globalName ?? null,
        completionatorUrl:
          completionator !== undefined ? completionator || null : existing.completionatorUrl,
        psnUsername: psn !== undefined ? psn || null : existing.psnUsername,
        xblUsername: xbl !== undefined ? xbl || null : existing.xblUsername,
        nswFriendCode: nsw !== undefined ? nsw || null : existing.nswFriendCode,
        steamUrl: steam !== undefined ? steam || null : existing.steamUrl,
      };

      await Member.upsert(updated);

      const changedFields: string[] = [];
      if (completionator !== undefined) changedFields.push("Completionator");
      if (psn !== undefined) changedFields.push("PSN");
      if (xbl !== undefined) changedFields.push("Xbox");
      if (nsw !== undefined) changedFields.push("Switch");
      if (steam !== undefined) changedFields.push("Steam");

      await safeReply(interaction, {
        content: `Updated profile for <@${target.id}> (${changedFields.join(", ")}).`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Error updating profile: ${msg}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }


}

