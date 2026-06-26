const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Supprime le timeout (sourdine) d\'un utilisateur')
    .addUserOption(option =>
      option.setName('utilisateur')
        .setDescription('L\'utilisateur à démûter')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('raison')
        .setDescription('Raison du démûtage')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    try {
      const user   = interaction.options.getUser('utilisateur');
      const raison = interaction.options.getString('raison');
      const member = interaction.guild.members.cache.get(user.id);
      const date   = new Date().toISOString();
      const db     = interaction.client.db;

      await interaction.deferReply({ ephemeral: true });

      if (!member) {
        return interaction.editReply({ content: 'Utilisateur introuvable sur le serveur.', ephemeral: true });
      }
      if (!member.isCommunicationDisabled()) {
        return interaction.editReply({ content: `${user.tag} n\'est pas en timeout.`, ephemeral: true });
      }
      if (!member.moderatable) {
        return interaction.editReply({ content: 'Je ne peux pas démûter cet utilisateur (vérifiez mes permissions ou la hiérarchie des rôles).', ephemeral: true });
      }

      const dmEmbed = new EmbedBuilder()
        .setTitle('<:call:1393643397041881212> Timeout Supprimé')
        .setColor('#00ff00')
        .addFields(
          { name: 'Serveur',    value: interaction.guild.name,      inline: true },
          { name: 'Raison',     value: raison,                      inline: true },
          { name: 'Modérateur', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Date',       value: date,                        inline: true }
        )
        .setTimestamp();

      await member.timeout(null, raison);

      try { await user.send({ embeds: [dmEmbed] }); }
      catch { console.error(`Impossible d'envoyer un DM à ${user.tag}`); }

      const { error } = await db
        .from('sanctions')
        .insert({
          user_id:      user.id,
          guild_id:     interaction.guild.id,
          type:         'unmute',
          raison,
          date,
          moderator_id: interaction.user.id,
        });

        const { buildSanctionEmbed, sendLog, LOG_TYPES } = require('../events/logManager');
const logEmbed = buildSanctionEmbed('unmute', user, interaction.user, raison);
await sendLog(interaction.guild, LOG_TYPES.SANCTION, logEmbed);

      if (error) {
        console.error('Supabase (unmute) :', error.message);
        return interaction.editReply({ content: 'Erreur lors de l\'enregistrement du démûtage.', ephemeral: true });
      }

      await interaction.editReply({
        content: `<:call:1393643397041881212> Le membre **${user.tag}** a retrouvé la parole avec comme motif : ${raison}.`,
        ephemeral: true,
      });
    } catch (err) {
      console.error('Erreur globale /unmute :', err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'Une erreur est survenue lors du démûtage.', ephemeral: true }).catch(() => {});
      } else {
        await interaction.editReply({ content: 'Une erreur est survenue lors du démûtage.', ephemeral: true }).catch(() => {});
      }
    }
  },
};