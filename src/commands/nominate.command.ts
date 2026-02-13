import type {
  ButtonInteraction,
  CommandInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  TextBasedChannel,
} from "discord.js";
import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";
import {
  ComponentType as ApiComponentType,
  TextInputStyle as ApiTextInputStyle,
  type APIModalInteractionResponseCallbackComponent,
} from "discord-api-types/v10";
import { Discord, ModalComponent, Slash } from "discordx";
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
import {
  areNominationsClosed,
  getUpcomingNominationWindow,
} from "../functions/NominationWindow.js";
import { safeDeferReply, safeReply, sanitizeUserInput } from "../functions/InteractionUtils.js";
import { GOTM_NOMINATION_CHANNEL_ID, NR_GOTM_NOMINATION_CHANNEL_ID } from "../config/nominationChannels.js";
import { RawModalApiService } from "../services/raw-modal/RawModalApiService.js";
import { parseRawModalCustomId } from "../services/raw-modal/RawModalCustomId.js";
import { SelectMenuComponent } from "discordx";
import { GameDb } from "./gamedb.command.js";

const NOMINATE_MODAL_TITLE = "Nominate a Game";
const NOMINATE_CURRENT_NOMS_ID = "nominate-current";
const NOMINATE_GAME_TITLE_ID = "nominate-title";
const NOMINATE_TYPE_ID = "nominate-kind";
const NOMINATE_REASON_ID = "nominate-reason";
const NOMINATE_REASON_MAX_LENGTH = 250;

function buildNominateSessionId(userId: string, roundNumber: number): string {
  return `u${userId}_r${roundNumber}`;
}

function parseRoundFromSessionId(sessionId: string): number | null {
  const match = /^u\d+_r(\d+)$/.exec(sessionId);
  if (!match || !match[1]) {
    return null;
  }
  const roundNumber = Number(match[1]);
  return Number.isInteger(roundNumber) && roundNumber > 0 ? roundNumber : null;
}

function parseNominationKind(value: unknown): NominationKind | null {
  if (value === "gotm" || value === "nr-gotm") {
    return value;
  }
  return null;
}

function extractNominationKindFromInteraction(
  interaction: ModalSubmitInteraction,
): NominationKind | null {
  const topLevelComponents = (
    interaction.components ?? []
  ) as Array<{
    type?: number;
    component?: { customId?: string; value?: unknown };
    components?: Array<{ customId?: string; value?: unknown }>;
  }>;

  for (const topLevel of topLevelComponents) {
    if (!topLevel || typeof topLevel !== "object") {
      continue;
    }

    const children = Array.isArray(topLevel.components)
      ? topLevel.components
      : topLevel.component
        ? [topLevel.component]
        : [];

    for (const child of children) {
      if (!child || child.customId !== NOMINATE_TYPE_ID) {
        continue;
      }
      const parsed = parseNominationKind(child.value);
      if (parsed) {
        return parsed;
      }
    }
  }

  return null;
}

function formatCurrentNominationText(
  roundNumber: number,
  gotmNominationTitle?: string,
  nrGotmNominationTitle?: string,
): string {
  const gotmLine = gotmNominationTitle
    ? `GOTM: ${gotmNominationTitle}`
    : "GOTM: (none yet)";
  const nrGotmLine = nrGotmNominationTitle
    ? `NR-GOTM: ${nrGotmNominationTitle}`
    : "NR-GOTM: (none yet)";
  return `Round ${roundNumber}\n${gotmLine}\n${nrGotmLine}`;
}

function buildNominateModalComponents(
  currentNominationText: string,
  prefilledTitle?: string,
): APIModalInteractionResponseCallbackComponent[] {
  const titleValue = prefilledTitle
    ? sanitizeUserInput(prefilledTitle, {
      preserveNewlines: false,
      maxLength: 256,
    })
    : undefined;

  return [
    {
      type: ApiComponentType.ActionRow,
      components: [
        {
          type: ApiComponentType.TextInput,
          custom_id: NOMINATE_CURRENT_NOMS_ID,
          label: "Your current nominations",
          style: ApiTextInputStyle.Paragraph,
          required: false,
          max_length: 600,
          value: currentNominationText,
        },
      ],
    },
    {
      type: ApiComponentType.ActionRow,
      components: [
        {
          type: ApiComponentType.TextInput,
          custom_id: NOMINATE_GAME_TITLE_ID,
          label: "Game title",
          style: ApiTextInputStyle.Short,
          required: true,
          max_length: 256,
          value: titleValue,
        },
      ],
    },
    {
      type: ApiComponentType.Label,
      label: "Nomination type",
      description: "Choose one",
      component: {
        type: ApiComponentType.RadioGroup,
        custom_id: NOMINATE_TYPE_ID,
        required: true,
        options: [
          {
            label: "GOTM",
            value: "gotm",
            description: "Game of the Month nomination",
          },
          {
            label: "NR-GOTM",
            value: "nr-gotm",
            description: "Non-RPG Game of the Month nomination",
          },
        ],
      },
    },
    {
      type: ApiComponentType.ActionRow,
      components: [
        {
          type: ApiComponentType.TextInput,
          custom_id: NOMINATE_REASON_ID,
          label: "Reason",
          style: ApiTextInputStyle.Paragraph,
          required: true,
          max_length: NOMINATE_REASON_MAX_LENGTH,
        },
      ],
    },
  ];
}

export async function openNominationModal(
  interaction: CommandInteraction | ButtonInteraction,
  options?: { prefilledTitle?: string },
): Promise<void> {
  const modalApi = new RawModalApiService({
    applicationId: interaction.applicationId,
  });

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

  const [gotmNomination, nrGotmNomination] = await Promise.all([
    getNominationForUser("gotm", window.targetRound, interaction.user.id),
    getNominationForUser("nr-gotm", window.targetRound, interaction.user.id),
  ]);

  const currentNominationText = formatCurrentNominationText(
    window.targetRound,
    gotmNomination?.gameTitle,
    nrGotmNomination?.gameTitle,
  );
  const sessionId = buildNominateSessionId(interaction.user.id, window.targetRound);

  await modalApi.openModal({
    interactionId: interaction.id,
    interactionToken: interaction.token,
    feature: "nominate",
    flow: "create",
    sessionId,
    title: NOMINATE_MODAL_TITLE,
    components: buildNominateModalComponents(
      currentNominationText,
      options?.prefilledTitle,
    ),
  });
}

async function resolveNominatedGameByTitle(searchTerm: string): Promise<IGame | null> {
  const existing = await Game.searchGames(searchTerm);
  const exact = existing.find((game) => game.title.toLowerCase() === searchTerm.toLowerCase());
  if (exact) {
    return exact;
  }
  if (existing.length === 1) {
    return existing[0] ?? null;
  }
  return null;
}

async function announceNominationList(
  interaction: ModalSubmitInteraction,
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
  @Slash({ description: "Open nomination form for GOTM or NR-GOTM", name: "nominate" })
  async nominate(interaction: CommandInteraction): Promise<void> {
    try {
      await openNominationModal(interaction);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await safeReply(interaction, {
        content: `Unable to open nomination form: ${errorMessage}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @ModalComponent({ id: /^modal:nominate:v1:create:[A-Za-z0-9_-]{1,64}$/ })
  async submitNominateModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsedCustomId = parseRawModalCustomId(interaction.customId);
    const selectedKind = extractNominationKindFromInteraction(interaction);
    const rawTitle = interaction.fields.getTextInputValue(NOMINATE_GAME_TITLE_ID);
    const rawReason = interaction.fields.getTextInputValue(NOMINATE_REASON_ID);
    const cleanedTitle = sanitizeUserInput(rawTitle, { preserveNewlines: false });
    const cleanedReason = sanitizeUserInput(rawReason, {
      preserveNewlines: true,
      maxLength: NOMINATE_REASON_MAX_LENGTH,
    });

    if (!parsedCustomId || parsedCustomId.feature !== "nominate" || parsedCustomId.flow !== "create") {
      await safeReply(interaction, {
        content: "This nomination form is invalid. Please run /nominate again.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

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

      const expectedRound = parseRoundFromSessionId(parsedCustomId.sessionId);
      if (!expectedRound || expectedRound !== window.targetRound) {
        await safeReply(interaction, {
          content:
            `This form is no longer current for Round ${window.targetRound}. ` +
            "Please run /nominate again.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const game = await resolveNominatedGameByTitle(cleanedTitle);
      if (!game) {
        await safeReply(interaction, {
          content:
            `I could not find a unique GameDB match for "${cleanedTitle}". ` +
            "Please use /gamedb search or /gamedb add first, then try /nominate again.",
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
