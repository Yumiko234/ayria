const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('case')
    .setDescription('Affiche les détails d\'une sanction via son ID')
    .addIntegerOption(option =>
      option.setName('id')
        .setDescription('ID de la sanction à afficher')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const id = interaction.options.getInteger('id');
    const db = interaction.client.db;

    const { data: row, error } = await db
      .from('sanctions')
      .select('*')
      .eq('id', id)
      .eq('guild_id', interaction.guild.id)
      .single();

    if (error || !row) {
      return interaction.reply({ content: `Aucune sanction trouvée avec l'ID ${id}.`, flags : [MessageFlags.Ephemeral] });
    }

    const embed = new EmbedBuilder()
      .setTitle(`Sanction ID ${row.id}`)
      .setColor('#ff0000')
      .addFields(
        { name: 'Utilisateur', value: `<@${row.user_id}>`,                                         inline: true },
        { name: 'Type',        value: row.type,                                                    inline: true },
        { name: 'Raison',      value: row.raison,                                                  inline: true },
        { name: 'Date',        value: `<t:${Math.floor(new Date(row.date).getTime() / 1000)}:f>`,  inline: true },
        { name: 'Modérateur',  value: row.moderator_id ? `<@${row.moderator_id}>` : 'Automatique', inline: true },
        { name: 'Durée',       value: row.duration ?? 'N/A',                                       inline: true }
      );

    await interaction.reply({ embeds: [embed] });
  },
};