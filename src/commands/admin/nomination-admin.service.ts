import type {
  CommandInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import { MessageFlags } from "discord.js";
import { safeDeferReply, safeReply, sanitizeUserInput } from "../../functions/InteractionUtils.js";
import {
  deleteNominationForUser,
  getNominationForUser,
  listNominationsForRound,
} from "../../classes/Nomination.js";
import { getUpcomingNominationWindow } from "../../functions/NominationWindow.js";
import {
  buildDeletionReasonState,
  buildDeletionReasonModal,
  buildDeletionSelectControls,
  buildNominationDeleteView,
  parseDeletionReasonModalCustomId,
  parseDeletionReasonStateId,
  parseDeletionSelectCustomId,
  announceNominationChange,
} from "../../functions/NominationAdminHelpers.js";
import {
  buildComponentsV2Flags,
  buildNominationListPayload,
} from "../../functions/NominationListComponents.js";

export async function handleDeleteGotmNomsPanel(interaction: CommandInteraction): Promise<void> {
  const window = await getUpcomingNominationWindow();
  const view = await buildNominationDeleteView("gotm", "/nominate");
  if (!view) {
    await safeReply(interaction, {
      content: `No GOTM nominations found for Round ${window.targetRound}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await safeReply(interaction, {
    content: `Choose a GOTM nomination for Round ${window.targetRound} to start deletion.`,
    components: [...view.payload.components, ...view.controls],
    files: view.payload.files,
    flags: buildComponentsV2Flags(true),
  });
}

export async function handleDeleteNrGotmNomsPanel(interaction: CommandInteraction): Promise<void> {
  const window = await getUpcomingNominationWindow();
  const view = await buildNominationDeleteView("nr-gotm", "/nominate");
  if (!view) {
    await safeReply(interaction, {
      content: `No NR-GOTM nominations found for Round ${window.targetRound}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await safeReply(interaction, {
    content: `Choose an NR-GOTM nomination for Round ${window.targetRound} to start deletion.`,
    components: [...view.payload.components, ...view.controls],
    files: view.payload.files,
    flags: buildComponentsV2Flags(true),
  });
}

export async function handleAdminNominationDeleteSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const parsed = parseDeletionSelectCustomId(interaction.customId);
  const selectedUserId = interaction.values?.[0];
  if (!parsed || !selectedUserId) {
    await safeReply(interaction, {
      content: "This nomination deletion menu is invalid. Run the command again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const nomination = await getNominationForUser(parsed.kind, parsed.round, selectedUserId);
  if (!nomination) {
    await safeReply(interaction, {
      content: "That nomination no longer exists. Run the command again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.showModal(
    buildDeletionReasonModal(parsed.kind, parsed.round, selectedUserId, nomination.gameTitle),
  ).catch(async () => {
    await safeReply(interaction, {
      content: "Unable to open the deletion reason prompt. Try again.",
      flags: MessageFlags.Ephemeral,
    });
  });
}

export async function handleAdminNominationDeleteReasonModal(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const parsed = parseDeletionReasonModalCustomId(interaction.customId);
  if (!parsed) {
    await safeReply(interaction, {
      content: "This nomination deletion prompt is invalid. Run the command again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const parsedState = parseDeletionReasonStateId(parsed.sessionId);
  if (!parsedState) {
    await safeReply(interaction, {
      content: "This nomination deletion prompt is invalid. Run the command again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const nomination = await getNominationForUser(parsedState.kind, parsedState.round, parsedState.userId);
  const sessionState = nomination
    ? buildDeletionReasonState(
      parsedState.kind,
      parsedState.round,
      parsedState.userId,
      nomination.gameTitle,
    )
    : null;
  if (!sessionState) {
    await safeReply(interaction, {
      content: "That nomination no longer exists. Run the command again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const reason = sanitizeUserInput(
    interaction.fields.getTextInputValue("admin-nom-del-reason-input"),
    { preserveNewlines: true, maxLength: 250 },
  );
  if (!reason) {
    await safeReply(interaction, {
      content: "A deletion reason is required.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
  await deleteNominationForUser(sessionState.kind, sessionState.round, sessionState.userId);
  const nominations = await listNominationsForRound(sessionState.kind, sessionState.round);
  const window = await getUpcomingNominationWindow();
  const payload = await buildNominationListPayload(
    sessionState.kind === "gotm" ? "GOTM" : "NR-GOTM",
    "/nominate",
    {
      ...window,
      targetRound: sessionState.round,
    },
    nominations,
    false,
  );
  const content =
    `<@${interaction.user.id}> deleted <@${sessionState.userId}>'s nomination ` +
    `"${sessionState.gameTitle}" for ${sessionState.kind.toUpperCase()} Round ${sessionState.round}. ` +
    `Reason: ${reason}`;

  await safeReply(interaction, {
    components: [
      ...payload.components,
    ],
    content,
    files: payload.files,
    flags: buildComponentsV2Flags(true),
  });
  await announceNominationChange(sessionState.kind, interaction, content, payload);
}

export async function buildDeleteViewForTests(
  kind: "gotm" | "nr-gotm",
  round: number,
): Promise<Array<any>> {
  const nominations = await listNominationsForRound(kind, round);
  const payload = await buildNominationListPayload(
    kind === "gotm" ? "GOTM" : "NR-GOTM",
    "/nominate",
    {
      closesAt: new Date("2026-03-13T12:00:00.000Z"),
      nextVoteAt: new Date("2026-03-20T12:00:00.000Z"),
      targetRound: round,
    },
    nominations,
    false,
    { includeDetailSelect: false },
  );

  return [...payload.components, ...buildDeletionSelectControls(kind, round, nominations)];
}
