const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Expulse un utilisateur du serveur')
    .addUserOption(option =>
      option.setName('utilisateur')
        .setDescription('L\'utilisateur à expulser')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('raison')
        .setDescription('Raison de l\'expulsion')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  async execute(interaction) {
    await interaction.deferReply();

    // 🛡️ DOUBLE VÉRIFICATION DE SÉCURITÉ (Qui exécute la commande)
    const hasPermission = interaction.member.permissions.has(PermissionFlagsBits.KickMembers);
    const isDeveloper = interaction.user.id === '1327683141749444709';

    if (!hasPermission && !isDeveloper) {
      return interaction.editReply({
        content: "❌ Vous n'avez pas la permission de modération requise ni le bypass développeur pour exécuter cette commande."
      });
    }

    const user   = interaction.options.getUser('utilisateur');
    const raison = interaction.options.getString('raison');
    const date   = new Date().toISOString();
    const db     = interaction.client.db;

    // 🛡️ ANTI-AUTO-SANCTION & ANTI-BOT
    if (user.id === interaction.user.id) {
      return interaction.editReply({ content: "❌ Vous ne pouvez pas vous expulser vous-même." });
    }
    if (user.bot) {
      return interaction.editReply({ content: "❌ Vous ne pouvez pas expulser un bot." });
    }

    // 🛡️ PROTECTION ID CIBLE (Impossible de kick cet utilisateur)
    if (user.id === '1327683141749444709') {
      return interaction.editReply({
        content: "❌ Cet utilisateur est protégé. Il est impossible de l'expulser."
      });
    }

    // Récupération sécurisée du membre (Fetch si pas dans le cache)
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (!member) {
      return interaction.editReply({ content: 'Utilisateur introuvable sur le serveur.' });
    }

    // 🛡️ PROTECTION INTER-MODÉRATEURS (Hiérarchie Staff)
    if (member.permissions.has(PermissionFlagsBits.KickMembers)) {
      return interaction.editReply({
        content: "❌ Cet utilisateur fait partie de l'équipe de modération. Vous ne pouvez pas le sanctionner."
      });
    }

    if (!member.kickable) {
      return interaction.editReply({ content: 'Je ne peux pas expulser cet utilisateur (vérifiez mes permissions ou la hiérarchie des rôles).' });
    }

    const dmEmbed = new EmbedBuilder()
      .setTitle('<:kick:1393643401307488266> Expulsion')
      .setColor('#ff0000')
      .addFields(
        { name: 'Serveur',    value: interaction.guild.name,      inline: true },
        { name: 'Raison',     value: raison,                      inline: true },
        { name: 'Modérateur', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Date',       value: date,                        inline: true }
      )
      .setTimestamp();

    try {
      // Envoi du DM avant l'expulsion (sinon le bot ne peut plus lui écrire si pas de serveur en commun)
      try { await user.send({ embeds: [dmEmbed] }); }
      catch { console.error(`Impossible d'envoyer un DM à ${user.tag}`); }

      await member.kick(raison);

      const { data: insertedSanction, error } = await db
        .from('sanctions')
        .insert({
          user_id:      user.id,
          guild_id:     interaction.guild.id,
          type:         'kick',
          raison,
          date,
          moderator_id: interaction.user.id,
        })
        .select()
        .single();

      const { buildSanctionEmbed, sendLog, LOG_TYPES } = require('../events/logManager');
      const logEmbed = buildSanctionEmbed('kick', user, interaction.user, raison, { caseId: insertedSanction?.id });
      await sendLog(interaction.guild, LOG_TYPES.SANCTION, logEmbed);

      if (error) {
        console.error('Supabase (kick) :', error.message);
        return interaction.editReply({ content: 'Erreur lors de l\'enregistrement du kick.' });
      }

      await interaction.editReply(`<:kick:1393643401307488266> Le membre **${user.tag}** a été expulsé du serveur avec pour motif : **${raison}**.`);
    } catch (err) {
      console.error('Erreur lors de l\'expulsion :', err);
      interaction.editReply({ content: 'Une erreur est survenue lors de l\'expulsion.' });
    }
  },
};