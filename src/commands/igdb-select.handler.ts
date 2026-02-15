import { ButtonComponent, Discord, SelectMenuComponent } from "discordx";
import { type ButtonInteraction, type StringSelectMenuInteraction, MessageFlags } from "discord.js";
import { handleIgdbFirstMatchInteraction, handleIgdbSelectInteraction } from "../services/IGDB/IgdbSelectService.js";

@Discord()
export class IgdbSelectHandler {
  @SelectMenuComponent({ id: /^igdb-select:.+/ })
  async handleIgdbSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const handled = await handleIgdbSelectInteraction(interaction);
    if (!handled && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "This IGDB selection is no longer valid.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }

  @ButtonComponent({ id: /^igdb-first:.+/ })
  async handleIgdbFirstMatch(interaction: ButtonInteraction): Promise<void> {
    const handled = await handleIgdbFirstMatchInteraction(interaction);
    if (!handled && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "This IGDB selection is no longer valid.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
