const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bannit un utilisateur, temporairement ou définitivement')
    .addUserOption(option =>
      option.setName('utilisateur')
        .setDescription('L\'utilisateur à bannir')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('raison')
        .setDescription('Raison du bannissement')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('duree')
        .setDescription('Durée du bannissement (ex. : 1h, 1d, 1w), optionnel pour ban permanent')
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  async execute(interaction) {
    await interaction.deferReply();

    // 🛡️ DOUBLE VÉRIFICATION DE SÉCURITÉ (Qui exécute la commande)
    const hasPermission = interaction.member.permissions.has(PermissionFlagsBits.BanMembers);
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
      return interaction.editReply({ content: "❌ Vous ne pouvez pas vous bannir vous-même." });
    }
    if (user.bot) {
      return interaction.editReply({ content: "❌ Vous ne pouvez pas bannir un bot." });
    }

    // 🛡️ PROTECTION ID CIBLE (Impossible de ban cet utilisateur)
    if (user.id === '1327683141749444709') {
      return interaction.editReply({
        content: "❌ Cet utilisateur est protégé. Il est impossible de le bannir."
      });
    }

    // Récupération sécurisée du membre si présent sur le serveur
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (member) {
      // 🛡️ PROTECTION INTER-MODÉRATEURS (Hiérarchie Staff)
      if (member.permissions.has(PermissionFlagsBits.BanMembers)) {
        return interaction.editReply({
          content: "❌ Cet utilisateur fait partie de l'équipe de modération. Vous ne pouvez pas le sanctionner."
        });
      }

      if (!member.bannable) {
        return interaction.editReply({ content: 'Je ne peux pas bannir cet utilisateur (vérifiez mes permissions ou la hiérarchie des rôles).' });
      }
    }

    // Calculer la durée
    let durationMs = null;
    let isTempBan  = false;
    let dureeText  = null;

    if (dureeInput) {
      const durationMatch = dureeInput.match(/^(\d+)([hdw])$/);
      if (!durationMatch) {
        return interaction.editReply({ content: 'Format de durée invalide. Utilisez ex. : 1h, 1d, 1w.' });
      }
      const [, value, unit] = durationMatch;
      if (unit === 'h') durationMs = value * 3600000;
      else if (unit === 'd') durationMs = value * 86400000;
      else if (unit === 'w') durationMs = value * 604800000;
      isTempBan = true;
      if (unit === 'h') dureeText = `${value} heure${value > 1 ? 's' : ''}`;
      else if (unit === 'd') dureeText = `${value} jour${value > 1 ? 's' : ''}`;
      else if (unit === 'w') dureeText = `${value} semaine${value > 1 ? 's' : ''}`;
    }

    const dmEmbed = new EmbedBuilder()
      .setTitle(isTempBan ? '🚫 Bannissement Temporaire' : '🚫 Bannissement Permanent')
      .setColor('#ff0000')
      .addFields(
        { name: 'Serveur',    value: interaction.guild.name,      inline: true },
        { name: 'Raison',     value: raison,                      inline: true },
        ...(isTempBan ? [{ name: 'Durée', value: dureeText, inline: true }] : []),
        { name: 'Modérateur', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Date',       value: date,                        inline: true }
      )
      .setTimestamp();

    try {
      // DM avant le ban
      try { await user.send({ embeds: [dmEmbed] }); }
      catch { console.error(`Impossible d'envoyer un DM à ${user.tag}`); }

      // Ban Discord
      await interaction.guild.members.ban(user, { reason: raison, deleteMessageSeconds: 0 });

      // INSERT Supabase
      const { error } = await db
        .from('sanctions')
        .insert({
          user_id:      user.id,
          guild_id:     interaction.guild.id,
          type:         'ban',
          raison,
          date,
          moderator_id: interaction.user.id,
          duration:     dureeInput ?? null,
        });

      const { buildSanctionEmbed, sendLog, LOG_TYPES } = require('../events/logManager');
      const logEmbed = buildSanctionEmbed('ban', user, interaction.user, raison, { duration: dureeText });
      await sendLog(interaction.guild, LOG_TYPES.SANCTION, logEmbed);

      if (error) {
        console.error('Supabase (ban) :', error.message);
        return interaction.editReply({ content: 'Erreur lors de l\'enregistrement du bannissement.' });
      }

      const reply = isTempBan
        ? `🚫 Le membre **${user.tag}** a été banni temporairement pour une durée de **${dureeText}** avec comme motif : **${raison}**.`
        : `🚫 Le membre **${user.tag}** a été banni définitivement pour le motif : **${raison}**`;
      await interaction.editReply(reply);

      // Débannissement automatique si temporaire
      if (isTempBan) {
        setTimeout(async () => {
          try {
            await interaction.guild.members.unban(user);

            const unbanEmbed = new EmbedBuilder()
              .setTitle('🔓 Débannissement Automatique')
              .setColor('#00ff00')
              .addFields(
                { name: 'Serveur', value: interaction.guild.name,       inline: true },
                { name: 'Raison',  value: 'Expiration automatique',     inline: true },
                { name: 'Date',    value: new Date().toISOString(),      inline: true }
              )
              .setTimestamp();

            try { await user.send({ embeds: [unbanEmbed] }); }
            catch { console.error(`Impossible d'envoyer un DM d'expiration à ${user.tag}`); }

            const { error: unbanError } = await db
              .from('sanctions')
              .insert({
                user_id:      user.id,
                guild_id:     interaction.guild.id,
                type:         'unban',
                raison:       'Expiration automatique',
                date:         new Date().toISOString(),
                moderator_id: null,
              });

            if (unbanError) console.error('Supabase (unban auto) :', unbanError.message);
            const logUnban = buildSanctionEmbed('unban', user, null, 'Expiration automatique');
            await sendLog(interaction.guild, LOG_TYPES.SANCTION, logUnban);
          } catch (err) {
            console.error(`Erreur lors du débannissement automatique de ${user.tag} :`, err);
          }
        }, durationMs);
      }
    } catch (err) {
      console.error('Erreur lors du bannissement :', err);
      interaction.editReply({ content: 'Une erreur est survenue lors du bannissement.' });
    }
  },
};