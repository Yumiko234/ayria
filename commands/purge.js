const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Supprime un nombre précis de messages dans le canal')
    .addIntegerOption(option =>
      option.setName('number')
        .setDescription('Nombre de messages à supprimer (1-100)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100))
    .addUserOption(option =>
      option.setName('user_id')
        .setDescription('Cibler les messages d\'un utilisateur spécifique')
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    await interaction.deferReply({ flags : [MessageFlags.Ephemeral] });

    const number  = interaction.options.getInteger('number');
    const user    = interaction.options.getUser('user_id');
    const db      = interaction.client.db;
    const channel = interaction.channel;
    const date    = new Date().toISOString();

    if (!interaction.guild.members.me.permissionsIn(channel).has(PermissionFlagsBits.ManageMessages)) {
      return interaction.editReply({ content: 'Je n\'ai pas la permission de gérer les messages dans ce canal.' });
    }

    try {
      const messages = await channel.messages.fetch({ limit: number });
      const messagesToDelete = user
        ? messages.filter(msg => msg.author.id === user.id)
        : messages;

      const deletedMessages = await channel.bulkDelete(messagesToDelete, true);
      const deletedCount    = deletedMessages.size;

      const raison = user
        ? `Suppression de ${deletedCount} message(s) de ${user.tag}`
        : `Suppression de ${deletedCount} message(s) dans le canal ${channel.name}`;

      const { error } = await db
        .from('sanctions')
        .insert({
          user_id:      user?.id ?? null,
          guild_id:     interaction.guild.id,
          type:         'purge',
          raison,
          date,
          moderator_id: interaction.user.id,
        });

      if (error) console.error('Supabase (purge) :', error.message);

      const reply = user
        ? `🗑️ Supprimé **${deletedCount}** message(s) de ${user.tag}.`
        : `🗑️ Supprimé **${deletedCount}** message(s) dans le canal.`;

      await interaction.editReply({ content: reply });
    } catch (err) {
      console.error('Erreur lors de la suppression des messages :', err);
      await interaction.editReply({ content: 'Une erreur est survenue lors de la suppression des messages.' });
    }
  },
};