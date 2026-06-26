const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('modlogs')
    .setDescription("Affiche l'historique des sanctions d'un utilisateur")
    .addUserOption(option =>
      option.setName('utilisateur')
        .setDescription("L'utilisateur dont on veut voir l'historique")
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const user = interaction.options.getUser('utilisateur');
    const db   = interaction.client.db;

    const { data: rows, error } = await db
      .from('sanctions')
      .select('*')
      .eq('user_id', user.id)
      .eq('guild_id', interaction.guild.id)
      .order('id', { ascending: true });

    if (error) {
      console.error('Supabase (modlogs) :', error.message);
      return interaction.reply({ 
        content: "Erreur lors de la récupération de l'historique.", 
        flags: [MessageFlags.Ephemeral]
      });
    }

    if (!rows || rows.length === 0) {
      return interaction.reply({ 
        content: `Aucune sanction trouvée pour ${user.tag}.`, 
        flags: [MessageFlags.Ephemeral]
      });
    }

    const embed = new EmbedBuilder()
      .setTitle(`Historique des sanctions pour ${user.tag}`)
      .setColor('#ff0000')
      .setDescription(
        rows.map(row =>
          `**ID ${row.id}** | \`${row.type}\` | ${row.raison} | <t:${Math.floor(new Date(row.date).getTime() / 1000)}:d> | <@${row.moderator_id}>`
        ).join('\n')
      );

    await interaction.reply({ embeds: [embed] });
  },
};