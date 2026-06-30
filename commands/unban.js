const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Débannit un utilisateur')
    .addUserOption(option =>
      option.setName('utilisateur')
        .setDescription('L\'utilisateur à débannir')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('raison')
        .setDescription('Raison du débannissement')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  async execute(interaction) {
    const user   = interaction.options.getUser('utilisateur');
    const raison = interaction.options.getString('raison');
    const date   = new Date().toISOString();
    const db     = interaction.client.db;

    const bannedUsers = await interaction.guild.bans.fetch();
    if (!bannedUsers.get(user.id)) {
      return interaction.reply({ content: `${user.tag} n\'est pas banni.`, ephemeral: true });
    }

    const dmEmbed = new EmbedBuilder()
      .setTitle('<:login:1393643411633995796> Débannissement')
      .setColor('#00ff00')
      .addFields(
        { name: 'Serveur',    value: interaction.guild.name,      inline: true },
        { name: 'Raison',     value: raison,                      inline: true },
        { name: 'Modérateur', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Date',       value: date,                        inline: true }
      )
      .setTimestamp();

    try {
      await interaction.guild.members.unban(user, raison);

      try { await user.send({ embeds: [dmEmbed] }); }
      catch { console.error(`Impossible d'envoyer un DM à ${user.tag}`); }

      const { data: insertedSanction, error } = await db
        .from('sanctions')
        .insert({
          user_id:      user.id,
          guild_id:     interaction.guild.id,
          type:         'unban',
          raison,
          date,
          moderator_id: interaction.user.id,
        })
        .select()
        .single();
const { buildSanctionEmbed, sendLog, LOG_TYPES } = require('../events/logManager');
const logEmbed = buildSanctionEmbed('unban', user, interaction.user, raison, { caseId: insertedSanction?.id });
await sendLog(interaction.guild, LOG_TYPES.SANCTION, logEmbed);
      if (error) {
        console.error('Supabase (unban) :', error.message);
        return interaction.reply({ content: 'Erreur lors de l\'enregistrement du débannissement.', ephemeral: true });
      }

      await interaction.reply(`<:login:1393643411633995796> Le membre **${user.tag}** a été débanni pour le motif suivant : ${raison}.`);
    } catch (err) {
      console.error('Erreur lors du débannissement :', err);
      interaction.reply({ content: 'Une erreur est survenue lors du débannissement.', ephemeral: true });
    }
  },
};