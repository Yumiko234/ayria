const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('modremove')
    .setDescription('Supprime une sanction via son ID')
    .addIntegerOption(option =>
      option.setName('id')
        .setDescription('ID de la sanction à supprimer')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const id = interaction.options.getInteger('id');
    const db = interaction.client.db;


    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`confirm_delete_sanction_${id}`)
          .setLabel('Oui')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`cancel_delete_sanction_${id}`)
          .setLabel('Non')
          .setStyle(ButtonStyle.Secondary)
      );

    await interaction.editReply({
      content: `Voulez-vous vraiment supprimer la sanction avec l'ID **${id}** ?`,
      components: [row],
    });

    const filter = i =>
      (i.customId === `confirm_delete_sanction_${id}` || i.customId === `cancel_delete_sanction_${id}`) &&
      i.user.id === interaction.user.id;

    const collector = interaction.channel.createMessageComponentCollector({ filter, time: 15000 });

    collector.on('collect', async i => {
      if (i.customId === `confirm_delete_sanction_${id}`) {
        const { data, error } = await db
          .from('sanctions')
          .delete()
          .eq('id', id)
          .eq('guild_id', interaction.guild.id)
          .select();

        if (error) {
          console.error('Supabase (modremove) :', error.message);
          return i.update({ content: 'Erreur lors de la suppression de la sanction.', components: [] });
        }
        if (!data || data.length === 0) {
          return i.update({ content: `Aucune sanction trouvée avec l'ID **${id}**.`, components: [] });
        }
        await i.update({ content: `✅ Sanction ID **${id}** supprimée avec succès.`, components: [] });
      } else {
        await i.update({ content: 'Suppression annulée.', components: [] });
      }
      collector.stop();
    });

    collector.on('end', collected => {
      if (collected.size === 0) {
        // Optionnel
        interaction.editReply({ content: 'Temps écoulé. Aucune action effectuée.', components: [] }).catch(() => {});
      }
    });
  },
};