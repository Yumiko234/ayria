const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');

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
    // ✨ On defer tout de suite : bans.fetch() peut être lent sur un gros serveur,
    //    et on ne veut plus jamais risquer un double-reply plus loin.
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const user   = interaction.options.getUser('utilisateur');
    const raison = interaction.options.getString('raison');
    const date   = new Date().toISOString();
    const db     = interaction.client.db;

    const bannedUsers = await interaction.guild.bans.fetch().catch(() => null);
    const wasKnownBanned = bannedUsers?.get(user.id) != null;

    if (bannedUsers && !wasKnownBanned) {
      return interaction.editReply({ content: `${user.tag} n'est pas banni.` });
    }

    const dmEmbed = new EmbedBuilder()
      .setTitle('<:login:1567087268211064832> Débannissement')
      .setColor('#00ff00')
      .addFields(
        { name: 'Serveur',    value: interaction.guild.name,      inline: true },
        { name: 'Raison',     value: raison,                      inline: true },
        { name: 'Modérateur', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Date',       value: date,                        inline: true }
      )
      .setTimestamp();

    try {
      try {
        await interaction.guild.members.unban(user, raison);
      } catch (unbanErr) {
        // ✨ Code 10026 = "Unknown Ban" : la personne n'est déjà plus bannie.
        //    Souvent causé par un retry réseau qui rejoue une requête déjà réussie.
        //    On le traite comme un succès idempotent plutôt qu'une erreur bloquante.
        if (unbanErr.code === 10026) {
          console.warn(`[Unban] ${user.tag} n'était déjà plus banni (10026) — traité comme un succès.`);
        } else {
          throw unbanErr;
        }
      }

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
        return interaction.editReply({ content: 'Débannissement effectué, mais erreur lors de l\'enregistrement en base.' });
      }

      await interaction.editReply(`<:login:1567087268211064832> Le membre **${user.tag}** a été débanni pour le motif suivant : ${raison}.`);
    } catch (err) {
      console.error('Erreur lors du débannissement :', err);
      // 🛡️ On ne répond que si l'interaction n'a pas déjà reçu de réponse
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ content: 'Une erreur est survenue lors du débannissement.' }).catch(() => {});
      } else {
        await interaction.reply({ content: 'Une erreur est survenue lors du débannissement.', flags: [MessageFlags.Ephemeral] }).catch(() => {});
      }
    }
  },
};