import type {
  AutocompleteInteraction,
  CommandInteraction,
  StringSelectMenuInteraction,
  TextBasedChannel,
} from "discord.js";
import {
  ApplicationCommandOptionType,
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
} from "discord.js";
import { Discord, SelectMenuComponent, Slash, SlashChoice, SlashOption } from "discordx";
import type { NominationKind } from "../classes/Nomination.js";
import {
  getNominationForUser,
  listNominationsForRound,
  upsertNomination,
} from "../classes/Nomination.js";
import Game, { type IGame } from "../classes/Game.js";
import {
  buildComponentsV2Flags,
  buildNominationListPayload,
} from "../functions/NominationListComponents.js";
import { formatGameTitleWithYear, parseTitleWithYear } from "../functions/GameTitleAutocompleteUtils.js";
import {
  areNominationsClosed,
  getUpcomingNominationWindow,
} from "../functions/NominationWindow.js";
import { safeDeferReply, safeReply, sanitizeUserInput } from "../functions/InteractionUtils.js";
import { GOTM_NOMINATION_CHANNEL_ID, NR_GOTM_NOMINATION_CHANNEL_ID } from "../config/nominationChannels.js";
import { GameDb } from "./gamedb.command.js";

const NOMINATE_REASON_MAX_LENGTH = 1500;

async function autocompleteNominationTitle(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const rawQuery = focused?.value ? String(focused.value) : "";
  const query = sanitizeUserInput(rawQuery, { preserveNewlines: false }).trim();
  if (!query) {
    await interaction.respond([]);
    return;
  }

  const results = await Game.searchGamesAutocomplete(query);
  await interaction.respond(
    results.slice(0, 25).map((game) => ({
      name: formatGameTitleWithYear(game).slice(0, 100),
      value: formatGameTitleWithYear(game).slice(0, 100),
    })),
  );
}

function parseNominationKind(value: string): NominationKind | null {
  if (value === "gotm" || value === "nr-gotm") {
    return value;
  }
  return null;
}

async function resolveNominatedGameByTitle(searchTerm: string): Promise<IGame | null> {
  const parsed = parseTitleWithYear(searchTerm);
  const normalizedSearchTerm = parsed.title;
  const existing = await Game.searchGames(normalizedSearchTerm);
  const exact = existing.find((game) => {
    if (game.title.toLowerCase() !== normalizedSearchTerm.toLowerCase()) {
      return false;
    }
    if (parsed.year == null) {
      return true;
    }

    const releaseDate = game.initialReleaseDate instanceof Date
      ? game.initialReleaseDate
      : game.initialReleaseDate
        ? new Date(game.initialReleaseDate)
        : null;
    return releaseDate instanceof Date && !Number.isNaN(releaseDate.getTime())
      ? releaseDate.getFullYear() === parsed.year
      : false;
  });
  if (exact) {
    return exact;
  }
  if (existing.length === 1) {
    return existing[0] ?? null;
  }
  return null;
}

async function announceNominationList(
  interaction: CommandInteraction,
  kind: NominationKind,
  nominatorUserId: string,
  nominatedTitle: string,
  payload: Awaited<ReturnType<typeof buildNominationListPayload>>,
): Promise<void> {
  const channelId = kind === "gotm" ? GOTM_NOMINATION_CHANNEL_ID : NR_GOTM_NOMINATION_CHANNEL_ID;

  try {
    const channel = await interaction.client.channels.fetch(channelId);
    const textChannel: TextBasedChannel | null = channel?.isTextBased()
      ? (channel as TextBasedChannel)
      : null;
    if (!textChannel || !isSendableTextChannel(textChannel)) {
      return;
    }

    const nominationNotice = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `<@${nominatorUserId}> Nominated "${nominatedTitle}"!`,
      ),
    );

    await textChannel.send({
      components: [nominationNotice, ...payload.components],
      files: payload.files,
      flags: buildComponentsV2Flags(false),
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    console.error(`Failed to announce nomination list in channel ${channelId}:`, error);
  }
}

type SendableTextChannel = TextBasedChannel & {
  send: (content: unknown) => Promise<unknown>;
};

function isSendableTextChannel(channel: TextBasedChannel | null): channel is SendableTextChannel {
  return Boolean(channel && typeof (channel as SendableTextChannel).send === "function");
}

@Discord()
export class NominateCommand {
  @Slash({ description: "Nominate a GameDB title for GOTM or NR-GOTM", name: "nominate" })
  async nominate(
    @SlashOption({
      autocomplete: autocompleteNominationTitle,
      description: "Game title (autocomplete from GameDB)",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    rawTitle: string,
    @SlashChoice(
      { name: "GOTM", value: "gotm" },
      { name: "NR-GOTM", value: "nr-gotm" },
    )
    @SlashOption({
      description: "Nomination type",
      name: "type",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    rawKind: string,
    @SlashOption({
      description: "Reason for your nomination",
      maxLength: NOMINATE_REASON_MAX_LENGTH,
      name: "reason",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    rawReason: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    const cleanedTitle = sanitizeUserInput(rawTitle, { preserveNewlines: false, maxLength: 256 });
    const cleanedReason = sanitizeUserInput(rawReason, { preserveNewlines: true });
    const selectedKind = parseNominationKind(rawKind);

    if (!cleanedTitle) {
      await safeReply(interaction, {
        content: "Please provide a non-empty game title.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!selectedKind) {
      await safeReply(interaction, {
        content: "Please choose either GOTM or NR-GOTM.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!cleanedReason) {
      await safeReply(interaction, {
        content: "Reason is required.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (cleanedReason.length > NOMINATE_REASON_MAX_LENGTH) {
      await safeReply(interaction, {
        content: `Reason must be ${NOMINATE_REASON_MAX_LENGTH} characters or fewer.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    try {
      const window = await getUpcomingNominationWindow();
      if (areNominationsClosed(window)) {
        await safeReply(interaction, {
          content:
            `Nominations for Round ${window.targetRound} are closed. ` +
            `Voting is scheduled for ${window.nextVoteAt.toLocaleString()}.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const game = await resolveNominatedGameByTitle(cleanedTitle);
      if (!game) {
        await safeReply(interaction, {
          content:
            `I could not find a unique GameDB match for "${cleanedTitle}". ` +
            "Please use the title autocomplete or add the game to GameDB first.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const existing = await getNominationForUser(selectedKind, window.targetRound, interaction.user.id);
      const saved = await upsertNomination(
        selectedKind,
        window.targetRound,
        interaction.user.id,
        game.id,
        cleanedReason,
      );

      const replaced =
        existing && existing.gameTitle !== saved.gameTitle
          ? ` (replaced "${existing.gameTitle}")`
          : existing
            ? " (no change to title)"
            : "";
      const kindLabel = selectedKind === "gotm" ? "GOTM" : "NR-GOTM";

      await safeReply(interaction, {
        content:
          `${existing ? "Updated" : "Recorded"} your ${kindLabel} nomination for Round ` +
          `${window.targetRound}: "${saved.gameTitle}".${replaced}`,
        flags: MessageFlags.Ephemeral,
      });

      const nominations = await listNominationsForRound(selectedKind, window.targetRound);
      const payload = await buildNominationListPayload(
        kindLabel,
        "/nominate",
        window,
        nominations,
        false,
      );
      await announceNominationList(
        interaction,
        selectedKind,
        interaction.user.id,
        saved.gameTitle,
        payload,
      );
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await safeReply(interaction, {
        content: `Could not save your nomination: ${errorMessage}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({ description: "Show the current GOTM or NR-GOTM nominations", name: "noms" })
  async noms(
    @SlashChoice(
      { name: "GOTM", value: "gotm" },
      { name: "NR-GOTM", value: "nr-gotm" },
    )
    @SlashOption({
      description: "Nomination type",
      name: "type",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    rawKind: string,
    @SlashOption({
      description: "Show in chat (public) instead of ephemeral",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean = false,
    interaction: CommandInteraction,
  ): Promise<void> {
    const selectedKind = parseNominationKind(rawKind);
    const ephemeral = !showInChat;

    if (!selectedKind) {
      await safeReply(interaction, {
        content: "Please choose either GOTM or NR-GOTM.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(ephemeral) });

    try {
      const window = await getUpcomingNominationWindow();
      const nominations = await listNominationsForRound(selectedKind, window.targetRound);
      const kindLabel = selectedKind === "gotm" ? "GOTM" : "NR-GOTM";
      const payload = await buildNominationListPayload(
        kindLabel,
        "/nominate",
        window,
        nominations,
        false,
      );

      await safeReply(interaction, {
        components: payload.components,
        files: payload.files,
        flags: buildComponentsV2Flags(ephemeral),
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await safeReply(interaction, {
        content: `Could not load nominations: ${errorMessage}`,
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
    }
  }

  @SelectMenuComponent({ id: /^gotm-nom-details:\d+$/ })
  async showGotmNominationDetails(interaction: StringSelectMenuInteraction): Promise<void> {
    await this.showNominationDetails(interaction);
  }

  @SelectMenuComponent({ id: /^nr-gotm-nom-details:\d+$/ })
  async showNrGotmNominationDetails(interaction: StringSelectMenuInteraction): Promise<void> {
    await this.showNominationDetails(interaction);
  }

  private async showNominationDetails(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const gameId = Number(interaction.values?.[0]);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      await safeReply(interaction, {
        content: "Invalid GameDB id.",
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const gameDb = new GameDb();
    await gameDb.showGameProfileFromNomination(interaction, gameId);
  }
}
