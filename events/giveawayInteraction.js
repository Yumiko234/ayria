const { MessageFlags } = require('discord.js');
const gm = require('../utils/giveawayManager');

/**
 * Gère uniquement les boutons dont le customId commence par « gw: » (giveaway)
 * ou « dr: » (drop). Toute autre interaction est ignorée.
 */
module.exports = {
  name: 'interactionCreate',

  async execute(interaction) {
    if (!interaction.isButton() || !interaction.inGuild()) return;

    const [ns, action, rawId] = interaction.customId.split(':');
    if (ns !== 'gw' && ns !== 'dr') return;
    const id = Number(rawId);
    if (!Number.isInteger(id)) return;

    try {
      // « leave » répond via interaction.update (bouton d'un message éphémère) ; les autres par un message éphémère.
      if (!(ns === 'gw' && action === 'leave')) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      }

      if (ns === 'gw' && action === 'join')  return await gm.handleJoin(interaction, id);
      if (ns === 'gw' && action === 'leave') return await gm.handleLeave(interaction, id);
      if (ns === 'gw' && action === 'claim') return await gm.handleClaim(interaction, id);
      if (ns === 'dr' && action === 'claim') return await gm.handleDropClaim(interaction, id);
    } catch (err) {
      console.error(`[Giveaway] Erreur bouton ${interaction.customId} :`, err);
      const payload = { content: '❌ Une erreur est survenue. Réessaie dans un instant.' };
      if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
      else await interaction.reply({ ...payload, flags: [MessageFlags.Ephemeral] }).catch(() => {});
    }
  },
};