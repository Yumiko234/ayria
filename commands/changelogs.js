const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { sendLog, buildSanctionEmbed, LOG_TYPES } = require('../events/logManager');
const { CHANGELOGS_ROLES, hasAnyRole } = require('../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('changelogs')
    .setDescription('Modifie la raison d\'une sanction existante')
    .addIntegerOption(option =>
      option.setName('case')
        .setDescription('ID de la sanction à modifier')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('new_reason')
        .setDescription('Nouvelle raison pour cette sanction')
        .setRequired(true)
        .setMaxLength(512))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    // 🛡️ Vérification des rôles autorisés à modifier une sanction
    if (!hasAnyRole(interaction.member, CHANGELOGS_ROLES)) {
      return interaction.reply({
        content: "❌ Vous n'avez pas l'un des rôles requis pour exécuter cette commande.",
        flags: [MessageFlags.Ephemeral],
      });
    }

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const caseId    = interaction.options.getInteger('case');
    const newReason = interaction.options.getString('new_reason');
    const db        = interaction.client.db;

    // ── 1. Récupération de la sanction ─────────────────────────────────────
    const { data: row, error: fetchError } = await db
      .from('sanctions')
      .select('*')
      .eq('id', caseId)
      .eq('guild_id', interaction.guild.id)
      .single();

    if (fetchError || !row) {
      return interaction.editReply({
        content: `❌ Aucune sanction trouvée avec l'ID **#${caseId}** sur ce serveur.`,
      });
    }

    const oldReason = row.raison;

    // ── 2. Mise à jour en base ──────────────────────────────────────────────
    const { error: updateError } = await db
      .from('sanctions')
      .update({ raison: newReason })
      .eq('id', caseId)
      .eq('guild_id', interaction.guild.id);

    if (updateError) {
      console.error('[changelogs] Supabase update error:', updateError.message);
      return interaction.editReply({
        content: '❌ Une erreur est survenue lors de la mise à jour en base de données.',
      });
    }

    // ── 3. Confirmation en éphémère ─────────────────────────────────────────
    const confirmEmbed = new EmbedBuilder()
      .setTitle(`✏️ Sanction #${caseId} modifiée`)
      .setColor('#5865F2')
      .addFields(
        { name: 'Utilisateur',   value: `<@${row.user_id}>`,      inline: true },
        { name: 'Type',          value: row.type,                  inline: true },
        { name: 'Modérateur',    value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Ancienne raison', value: oldReason },
        { name: 'Nouvelle raison', value: newReason },
      )
      .setFooter({ text: `Modifié par ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [confirmEmbed] });

    // ── 4. Log dans le salon de sanctions ───────────────────────────────────
    const logEmbed = new EmbedBuilder()
      .setTitle(`✏️ Raison modifiée — Case #${caseId}`)
      .setColor('#5865F2')
      .addFields(
        { name: 'Utilisateur',    value: `<@${row.user_id}>`,         inline: true },
        { name: 'Type',           value: row.type,                     inline: true },
        { name: 'Modifié par',    value: `<@${interaction.user.id}>`,  inline: true },
        { name: 'Ancienne raison', value: oldReason },
        { name: 'Nouvelle raison', value: newReason },
      )
      .setFooter({ text: `Case ID : ${caseId}` })
      .setTimestamp();

    await sendLog(interaction.guild, LOG_TYPES.SANCTION, logEmbed);
  },
};