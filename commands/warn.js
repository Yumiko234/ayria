const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { buildSanctionEmbed, sendLog, LOG_TYPES } = require('../events/logManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Donne un avertissement à un utilisateur')
    .addUserOption(option =>
      option.setName('utilisateur')
        .setDescription("L'utilisateur à avertir")
        .setRequired(true))
    .addStringOption(option =>
      option.setName('raison')
        .setDescription("Raison de l'avertissement")
        .setRequired(true)),

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

    const user    = interaction.options.getUser('utilisateur');
    const raison  = interaction.options.getString('raison');

    // 🛡️ PROTECTION ID CIBLE (Impossible de warn cet utilisateur)
    if (user.id === '569409070440906783') {
      return interaction.editReply({
        content: "❌ Cet utilisateur est protégé. Il est impossible de lui donner un avertissement."
      });
    }

    const db      = interaction.client.db;
    const datePourSupabase = new Date(); 
    const timestampUnix = Math.floor(datePourSupabase.getTime() / 1000); 

    // Embed DM
    const dmEmbed = new EmbedBuilder()
      .setTitle('⚠️ Avertissement')
      .setColor('#ff0000')
      .addFields(
        { name: 'Serveur',     value: interaction.guild.name,          inline: true },
        { name: 'Raison',      value: raison,                          inline: true },
        { name: 'Modérateur',  value: `<@${interaction.user.id}>`,     inline: true },
        { name: 'Date',        value: `<t:${timestampUnix}:F>`,        inline: true } 
      )
      .setTimestamp();

    // ─── INSERT Supabase ─────────────────────────────────────────────────────
    const { error } = await db
      .from('sanctions')
      .insert({
        user_id:      user.id,
        guild_id:     interaction.guild.id,
        type:         'warn',
        raison:       raison,
        date:         datePourSupabase, 
        moderator_id: interaction.user.id,
      });

    // Logs de modération internes
    const logEmbed = buildSanctionEmbed('warn', user, interaction.user, raison);
    await sendLog(interaction.guild, LOG_TYPES.SANCTION, logEmbed);

    if (error) {
      console.error('Erreur Supabase (warn) :', error.message);
      return interaction.editReply({
        content: "Erreur lors de l'enregistrement de l'avertissement."
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Envoi du DM
    try {
      await user.send({ embeds: [dmEmbed] });
    } catch {
      console.error(`Impossible d'envoyer un DM à ${user.tag}`);
    }

    await interaction.editReply(
      `⚠️ Le membre \`${user.tag}\` a été averti pour : ${raison}`
    );
  },
};