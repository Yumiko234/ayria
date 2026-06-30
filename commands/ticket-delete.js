const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { sendLog, buildTicketEmbed, LOG_TYPES } = require('../events/logManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket-delete')
    .setDescription('Supprime définitivement le ticket actuel et met à jour la BDD')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction, client) {
    const supabase = client.db;
    const { channel } = interaction;

    // 🛡️ Évite l'erreur 10062 (Unknown Interaction) en différant la réponse
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    // 🔍 Vérification basique pour s'assurer qu'on est bien dans un salon de ticket
    // Tu peux aussi rajouter une vérification sur le nom ou la catégorie si nécessaire
    if (!channel.name.startsWith('ticket-')) {
      return interaction.editReply({ 
        content: '❌ Cette commande ne peut être utilisée que dans un salon de ticket (commençant par `ticket-`).', 
        flags: [MessageFlags.Ephemeral] 
      });
    }

    try {
      // 💾 Mettre à jour le statut du ticket dans Supabase avant de supprimer le salon
      const { error: dbError } = await supabase
        .from('tickets')
        .update({ status: 'Supprimé' })
        .eq('ticket_id', channel.id);

      if (dbError) {
        console.error('[Supabase] Erreur lors du delete du ticket :', dbError.message);
        // On avertit mais on peut quand même choisir de continuer ou de bloquer. 
        // Ici, on bloque pour éviter de perdre la trace en BDD d'un salon supprimé.
        return interaction.editReply({
          content: '❌ Erreur avec la base de données. Suppression annulée pour préserver la cohérence des données.',
          flags: [MessageFlags.Ephemeral]
        });
      }

      // ✉️ Message d'adieu éphémère juste avant la suppression
      await interaction.editReply({ 
        content: '🗑️ Le ticket a été marqué comme supprimé en BDD. Suppression du salon en cours...', 
        flags: [MessageFlags.Ephemeral] 
      });

      // 📋 Log — ticket supprimé (avant suppression effective du salon)
      const ticketNumber = channel.name.split('-').pop();
      const deleteLogEmbed = buildTicketEmbed('delete', channel, interaction.user, ticketNumber);
      await sendLog(interaction.guild, LOG_TYPES.TICKET, deleteLogEmbed);

      // 🕒 Petit délai de 2 secondes pour que l'utilisateur voit le message de confirmation, puis suppression du salon
      setTimeout(async () => {
        try {
          await channel.delete('Commande /ticket-delete exécutée');
        } catch (deleteError) {
          console.error('Erreur lors de la suppression du salon Discord :', deleteError);
        }
      }, 2000);

    } catch (error) {
      console.error('Erreur globale sur /ticket-delete :', error);
      return interaction.editReply({ 
        content: '❌ Une erreur critique est survenue lors de la suppression.', 
        flags: [MessageFlags.Ephemeral] 
      });
    }
  },
};