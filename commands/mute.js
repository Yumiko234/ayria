const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Met un utilisateur en timeout (sourdine temporaire)')
    .addUserOption(option =>
      option.setName('utilisateur')
        .setDescription('L\'utilisateur à mettre en timeout')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('raison')
        .setDescription('Raison du timeout')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('duree')
        .setDescription('Durée du timeout (ex. : 1h, 1d, 1w, max 28d)')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    await interaction.deferReply();

    // 🛡️ DOUBLE VÉRIFICATION DE SÉCURITÉ (Qui exécute la commande)
    const hasPermission = interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers);
    const isDeveloper = interaction.user.id === '1327683141749444709';

    if (!hasPermission && !isDeveloper) {
      return interaction.editReply({
        content: "❌ Vous n'avez pas la permission de modération requise ni le bypass développeur pour exécuter cette commande."
      });
    }

    const user       = interaction.options.getUser('utilisateur');
    const raison     = interaction.options.getString('raison');
    const dureeInput = interaction.options.getString('duree');
    const date       = new Date().toISOString();
    const db         = interaction.client.db;

    // 🛡️ ANTI-AUTO-SANCTION & ANTI-BOT
    if (user.id === interaction.user.id) {
      return interaction.editReply({ content: "❌ Vous ne pouvez pas vous mettre en timeout vous-même." });
    }
    if (user.bot) {
      return interaction.editReply({ content: "❌ Vous ne pouvez pas mettre un bot en timeout." });
    }

    // 🛡️ PROTECTION ID CIBLE (Impossible de mute cet utilisateur)
    if (user.id === '1327683141749444709') {
      return interaction.editReply({
        content: "❌ Cet utilisateur est protégé. Il est impossible de le réduire au silence."
      });
    }

    // Récupération sécurisée du membre (Fetch si pas dans le cache)
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (!member) {
      return interaction.editReply({ content: 'Utilisateur introuvable sur le serveur.' });
    }

    // 🛡️ PROTECTION INTER-MODÉRATEURS (Hiérarchie Staff)
    if (member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return interaction.editReply({
        content: "❌ Cet utilisateur fait partie de l'équipe de modération. Vous ne pouvez pas le sanctionner."
      });
    }

    if (!member.moderatable) {
      return interaction.editReply({ content: 'Je ne peux pas mettre cet utilisateur en timeout (vérifiez mes permissions ou la hiérarchie des rôles).' });
    }

    // Vérification du format de la durée
    const durationMatch = dureeInput.match(/^(\d+)([hdw])$/);
    if (!durationMatch) {
      return interaction.editReply({ content: 'Format de durée invalide. Utilisez ex. : 1h, 1d, 1w (max 28d).' });
    }

    const [, value, unit] = durationMatch;
    let durationMs;
    if (unit === 'h') durationMs = value * 3600000;
    else if (unit === 'd') durationMs = value * 86400000;
    else if (unit === 'w') durationMs = value * 604800000;

    if (durationMs > 2419200000) {
      return interaction.editReply({ content: 'La durée ne peut pas dépasser 28 jours.' });
    }

    let dureeText;
    if (unit === 'h') dureeText = `${value} heure${value > 1 ? 's' : ''}`;
    else if (unit === 'd') dureeText = `${value} jour${value > 1 ? 's' : ''}`;
    else if (unit === 'w') dureeText = `${value} semaine${value > 1 ? 's' : ''}`;

    const dmEmbed = new EmbedBuilder()
      .setTitle('🔇 Timeout')
      .setColor('#ff0000')
      .addFields(
        { name: 'Serveur',    value: interaction.guild.name,      inline: true },
        { name: 'Raison',     value: raison,                      inline: true },
        { name: 'Durée',      value: dureeText,                   inline: true },
        { name: 'Modérateur', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Date',       value: date,                        inline: true }
      )
      .setTimestamp();

    try {
      await member.timeout(durationMs, raison);

      try { await user.send({ embeds: [dmEmbed] }); }
      catch { console.error(`Impossible d'envoyer un DM à ${user.tag}`); }

      const { data: insertedSanction, error } = await db
        .from('sanctions')
        .insert({
          user_id:      user.id,
          guild_id:     interaction.guild.id,
          type:         'mute',
          raison,
          date,
          moderator_id: interaction.user.id,
          duration:     dureeInput,
        })
        .select()
        .single();

      const { buildSanctionEmbed, sendLog, LOG_TYPES } = require('../events/logManager');
      const logEmbed = buildSanctionEmbed('mute', user, interaction.user, raison, { duration: dureeText, caseId: insertedSanction?.id });
      await sendLog(interaction.guild, LOG_TYPES.SANCTION, logEmbed);

      if (error) {
        console.error('Supabase (mute) :', error.message);
        return interaction.editReply({ content: 'Erreur lors de l\'enregistrement du timeout.' });
      }

      await interaction.editReply(`<:callMuted:1393643402574434496> Le membre **${user.tag}** a été réduit au silence pour une durée de **${dureeText}** pour le motif : **${raison}**.`);
    } catch (err) {
      console.error('Erreur lors de l\'application du timeout :', err);
      interaction.editReply({ content: 'Une erreur est survenue lors de la mise en timeout.' });
    }
  },
};