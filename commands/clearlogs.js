const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clearlogs')
    .setDescription('Supprime tout l\'historique des sanctions d\'un utilisateur')
    .addUserOption(option =>
      option.setName('utilisateur')
        .setDescription('L\'utilisateur dont on veut supprimer l\'historique')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('raison')
        .setDescription('Raison de la suppression des logs')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const user   = interaction.options.getUser('utilisateur');
    const raison = interaction.options.getString('raison');
    const date   = new Date().toISOString();
    const db     = interaction.client.db;

    const member = interaction.guild.members.cache.get(user.id);
    if (!member) {
      return interaction.reply({ content: 'Utilisateur introuvable sur le serveur.',  flags : [MessageFlags.Ephemeral] });
    }

    // Suppression de toutes les sanctions
    const { data: deleted, error: deleteError } = await db
      .from('sanctions')
      .delete()
      .eq('user_id', user.id)
      .eq('guild_id', interaction.guild.id)
      .select();

    if (deleteError) {
      console.error('Supabase (clearlogs delete) :', deleteError.message);
      return interaction.reply({ content: 'Erreur lors de la suppression de l\'historique.',  flags : [MessageFlags.Ephemeral] });
    }
    if (!deleted || deleted.length === 0) {
      return interaction.reply({ content: `Aucune sanction trouvée pour ${user.tag} sur ce serveur.`,  flags : [MessageFlags.Ephemeral] });
    }

    // Enregistrement de l'action clearlogs
    const { error: insertError } = await db
      .from('sanctions')
      .insert({
        user_id:      user.id,
        guild_id:     interaction.guild.id,
        type:         'clearlogs',
        raison,
        date,
        moderator_id: interaction.user.id,
      });

    if (insertError) {
      console.error('Supabase (clearlogs insert) :', insertError.message);
      return interaction.reply({ content: 'Erreur lors de l\'enregistrement de l\'action de suppression.',  flags : [MessageFlags.Ephemeral]});
    }

    await interaction.reply(`🗑️ L\'historique des sanctions de **${user.tag}** a été supprimé (${deleted.length} entrée(s)) avec comme raison : **${raison}**.`);
  },
};