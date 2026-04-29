import type { CommandInteraction, ModalSubmitInteraction } from "discord.js";
import { Discord, ModalComponent, Slash, SlashGroup } from "discordx";
import { isModerator } from "./mod.command.js";
import {
  handleLiveStreamCreateModal,
  openLiveStreamCreateModal,
} from "./admin/live-stream-admin.service.js";

@Discord()
@SlashGroup({ description: "Moderator Event Commands", name: "moderator" })
@SlashGroup("moderator")
export class ModeratorLiveEventCommand {
  @Slash({
    description: "Create a Live Events thread and linked scheduled event from one modal",
    name: "create-live-event",
  })
  async createLiveEvent(interaction: CommandInteraction): Promise<void> {
    const okToUseCommand: boolean = await isModerator(interaction);
    if (!okToUseCommand) {
      return;
    }

    await openLiveStreamCreateModal(interaction);
  }

  @ModalComponent({ id: /^admin-live-stream-create:\d+$/ })
  async handleCreateLiveEventModal(interaction: ModalSubmitInteraction): Promise<void> {
    const okToUseCommand: boolean = await isModerator(interaction);
    if (!okToUseCommand) {
      return;
    }

    await handleLiveStreamCreateModal(interaction);
  }
}
