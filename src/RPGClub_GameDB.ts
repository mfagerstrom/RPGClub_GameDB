import "dotenv/config";
import { dirname, importx } from "@discordx/importer";
import type {
  Channel,
  ChatInputCommandInteraction,
  Interaction,
  Message,
  TextBasedChannel,
} from "discord.js";
import { IntentsBitField, Partials } from "discord.js";
import { Client } from "discordx";

import { updateBotPresence } from "./functions/SetPresence.js";

import { initOraclePool } from "./db/oracleClient.js";
import { loadGotmFromDb } from "./classes/Gotm.js";
import { loadNrGotmFromDb } from "./classes/NrGotm.js";
import {
  installConsoleLogging,
  setConsoleLoggingClient,
} from "./utilities/DiscordConsoleLogger.js";
import { startNominationReminderService } from "./services/NominationReminderService.js";
import { startReminderService } from "./services/ReminderService.js";
import Member from "./classes/Member.js";
import { joinAllTargetForumThreads } from "./services/ForumThreadJoinService.js";
import { startRssFeedService } from "./services/RssFeedService.js";
import { startPublicReminderService } from "./services/PublicReminderService.js";
import { startThreadSyncService } from "./services/ThreadSyncService.js";
import { startThreadLinkPromptService } from "./services/ThreadLinkPromptService.js";
import { refreshGiveawayHubMessage } from "./services/GiveawayHubService.js";
import { startGameReleaseAnnouncementService } from "./services/GameReleaseAnnouncementService.js";
import { startIgdbScanService } from "./services/IgdbScanService.js";
import { tryHandleManagedRawModalInteraction } from "./services/raw-modal/RawModalInteractionRouter.js";
installConsoleLogging();

const PRESENCE_CHECK_INTERVAL_MS: number = 30 * 60 * 1000;
let presenceInterval: NodeJS.Timeout | null = null;

function clearPresenceInterval(): void {
  if (!presenceInterval) return;
  clearInterval(presenceInterval);
  presenceInterval = null;
}

async function refreshPresence(): Promise<void> {
  try {
    await updateBotPresence(bot);
  } catch (err) {
    console.error("Failed to refresh presence:", err);
  }
}

function registerPresenceShutdownHooks(): void {
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGBREAK"];
  for (const signal of signals) {
    process.once(signal, clearPresenceInterval);
  }
  process.once("beforeExit", clearPresenceInterval);
}

export const bot: Client = new Client({
  // To use only guild command
  // botGuilds: [(client) => client.guilds.cache.map((guild) => guild.id)],

  // Discord intents
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMembers,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.GuildMessageReactions,
    IntentsBitField.Flags.GuildModeration,
    IntentsBitField.Flags.GuildVoiceStates,
    IntentsBitField.Flags.GuildPresences,
    IntentsBitField.Flags.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],

  // Debug logs are disabled in silent mode
  silent: false,

  // Configuration for @SimpleCommand
  simpleCommand: {
    prefix: "!",
  },
});

type ChannelWithName = { id?: string; name?: string };
type ISlashOptionNode = {
  name: string;
  value?: unknown;
  options?: readonly ISlashOptionNode[];
};

function getChannelName(channel: Channel | TextBasedChannel | null): string {
  if (!channel) {
    return "unknown";
  }

  const candidate: ChannelWithName = channel as ChannelWithName;
  if (typeof candidate.name === "string" && candidate.name.length > 0) {
    return `#${candidate.name}`;
  }

  if (typeof candidate.id === "string" && candidate.id.length > 0) {
    return candidate.id;
  }

  return "unknown";
}

function sanitizeSlashValue(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value.length > 120 ? `${value.slice(0, 117)}...` : value);
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  if (value === null || value === undefined) {
    return "null";
  }

  try {
    const serialized = JSON.stringify(value);
    if (!serialized) return "\"\"";
    return serialized.length > 200 ? `${serialized.slice(0, 197)}...` : serialized;
  } catch {
    return String(value);
  }
}

function formatSlashOption(option: ISlashOptionNode): string {
  if (option.options && option.options.length > 0) {
    const nested = option.options.map(formatSlashOption).join(", ");
    return `${option.name}={${nested}}`;
  }

  if (option.value === undefined) {
    return option.name;
  }

  return `${option.name}=${sanitizeSlashValue(option.value)}`;
}

function getSlashCommandPath(interaction: ChatInputCommandInteraction): string {
  const commandPath: string[] = [interaction.commandName];
  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand(false);
  if (subcommandGroup) commandPath.push(subcommandGroup);
  if (subcommand) commandPath.push(subcommand);
  return commandPath.join(" ");
}

function getSlashCommandParams(interaction: ChatInputCommandInteraction): string {
  const options = interaction.options.data as readonly ISlashOptionNode[];
  if (!options || options.length === 0) return "none";
  return options.map(formatSlashOption).join("; ");
}

bot.once("clientReady", async () => {
  // Make sure all guilds are cached
  await bot.guilds.fetch();
  setConsoleLoggingClient(bot);

  // Set presence state from stored value
  await refreshPresence();

  // Periodically refresh presence from the database to stay in sync
  presenceInterval = setInterval(() => {
    void refreshPresence();
  }, PRESENCE_CHECK_INTERVAL_MS);
  registerPresenceShutdownHooks();

  // Synchronize applications commands with Discord
  await bot.initApplicationCommands();

  // To clear all guild commands, uncomment this line,
  // This is useful when moving from guild commands to global commands
  // It must only be executed once
  //
  //  await bot.clearApplicationCommands(
  //    ...bot.guilds.cache.map((g) => g.id)
  //  );

  startNominationReminderService(bot);
  startReminderService(bot);
  startPublicReminderService(bot);
  startThreadSyncService(bot);
  startThreadLinkPromptService(bot);
  startGameReleaseAnnouncementService(bot);
  startIgdbScanService();
  await joinAllTargetForumThreads(bot);
  startRssFeedService(bot);
  await refreshGiveawayHubMessage(bot);
  console.log("Startup sequence completed.");
});

bot.on("interactionCreate", async (interaction: Interaction) => {
  if ("isChatInputCommand" in interaction && interaction.isChatInputCommand()) {
    const commandPath: string = getSlashCommandPath(interaction);
    const params: string = getSlashCommandParams(interaction);
    const userTag: string = interaction.user?.tag ?? interaction.user?.id ?? "unknown";
    const channel: Channel | null = interaction.channel;
    const channelName: string = getChannelName(channel);
    console.log(
      `[SlashCommand] /${commandPath} by ${userTag} in ${channelName} ` +
      `params: ${params}`,
    );
    if (interaction.user?.id) {
      void Member.touchLastSeen(interaction.user.id);
    }
  }

  const handledByRawModalRouter = await tryHandleManagedRawModalInteraction(interaction);
  if (handledByRawModalRouter) {
    return;
  }

  await bot.executeInteraction(interaction);
});

bot.on("messageCreate", async (message: Message) => {
  const content: string = message.content ?? "";
  const prefix: string = "!";

  if (content.startsWith(prefix)) {
    const withoutPrefix: string = content.slice(prefix.length).trim();
    const [commandName, ...args]: string[] = withoutPrefix.split(/\s+/);
    const userTag: string = message.author?.tag ?? message.author?.id ?? "unknown";
    const channel: TextBasedChannel = message.channel;
    const channelName: string = getChannelName(channel);
    console.log(
      `[MessageCommand] ${prefix}${commandName} by ${userTag} in ${channelName} args=${args.join(
        " ",
      )}`,
    );
  }

  if (message.author?.id && !message.author.bot) {
    void Member.recordMessageActivity(message.author.id);
  }

  await bot.executeCommand(message);
});

type DiscordClientError = { code?: number | string; rawError?: { code?: number | string } };

bot.on("error", (err: unknown) => {
  const normalizedErr: DiscordClientError | undefined =
    typeof err === "object" && err !== null ? (err as DiscordClientError) : undefined;
  const code: number | string | undefined = normalizedErr?.code ?? normalizedErr?.rawError?.code;
  if (code === 40060 || code === 10062) {
    // Ignore ack/unknown-interaction noise
    return;
  }
  console.error("Discord client error:", err);
});

async function run(): Promise<void> {
  if (!process.env.BOT_TOKEN) {
    throw Error("Could not find BOT_TOKEN in your environment");
  }

  await initOraclePool();
  await loadGotmFromDb();
  await loadNrGotmFromDb();

  await importx(
    `${dirname(import.meta.url)}/{events,commands}/**/*.{command,handler}.{ts,js}`,
  );

  await bot.login(process.env.BOT_TOKEN);
}

void run();
