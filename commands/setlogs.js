const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, MessageFlags } = require('discord.js');
const { LOG_TYPES } = require('../events/logManager');

const LOG_CHOICES = [
  { name: 'Sanctions (ban, kick, mute, warn…)', value: LOG_TYPES.SANCTION },
  { name: 'Messages supprimés',                 value: LOG_TYPES.MESSAGE_DEL },
  { name: 'Messages modifiés',                  value: LOG_TYPES.MESSAGE_EDI },
  { name: 'Tickets ouverts / fermés',           value: LOG_TYPES.TICKET },
  { name: 'Entrée / sortie de membres',         value: LOG_TYPES.MEMBER },
  { name: 'Actions de modération générales',    value: LOG_TYPES.MOD },
  { name: 'Modification des rôles d\'un utilisateur', value: LOG_TYPES.ROLE_UPDATE }, // 👈 Corrigé ici
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setlogs')
    .setDescription('Configure les salons de logs du serveur')
    .addSubcommand(sub =>
      sub.setName('set')
        .setDescription('Définit un salon de log pour un type d\'événement')
        .addStringOption(opt =>
          opt.setName('type')
            .setDescription('Type d\'événement à logger')
            .setRequired(true)
            .addChoices(...LOG_CHOICES))
        .addChannelOption(opt =>
          opt.setName('salon')
            .setDescription('Salon où envoyer les logs')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Supprime la configuration d\'un type de log')
        .addStringOption(opt =>
          opt.setName('type')
            .setDescription('Type à désactiver')
            .setRequired(true)
            .addChoices(...LOG_CHOICES)))
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('Affiche la configuration actuelle des logs'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags : [MessageFlags.Ephemeral] });
    const sub = interaction.options.getSubcommand();
    const db  = interaction.client.db;

    // ── /setlogs set ──────────────────────────────────────────────────────────
    if (sub === 'set') {
      const type    = interaction.options.getString('type');
      const channel = interaction.options.getChannel('salon');

      const { error } = await db
        .from('log_channels')
        .upsert(
          { guild_id: interaction.guild.id, log_type: type, channel_id: channel.id },
          { onConflict: 'guild_id,log_type' }
        );

      if (error) {
        console.error('Supabase (setlogs set) :', error.message);
        return interaction.editReply('❌ Erreur lors de l\'enregistrement.');
      }

      return interaction.editReply(
        `✅ Les logs **${type}** seront envoyés dans <#${channel.id}>.`
      );
    }

    // ── /setlogs remove ───────────────────────────────────────────────────────
    if (sub === 'remove') {
      const type = interaction.options.getString('type');

      const { error } = await db
        .from('log_channels')
        .delete()
        .eq('guild_id', interaction.guild.id)
        .eq('log_type', type);

      if (error) {
        console.error('Supabase (setlogs remove) :', error.message);
        return interaction.editReply('❌ Erreur lors de la suppression.');
      }

      return interaction.editReply(`🗑️ Logs **${type}** désactivés.`);
    }

    // ── /setlogs list ─────────────────────────────────────────────────────────
    if (sub === 'list') {
      const { data: rows, error } = await db
        .from('log_channels')
        .select('log_type, channel_id')
        .eq('guild_id', interaction.guild.id);

      if (error) {
        console.error('Supabase (setlogs list) :', error.message);
        return interaction.editReply('❌ Erreur lors de la récupération.');
      }

      const allTypes = Object.values(LOG_TYPES);
      const map      = Object.fromEntries((rows ?? []).map(r => [r.log_type, r.channel_id]));

      const lines = allTypes.map(type => {
        const channelId = map[type];
        return channelId
          ? `✅ \`${type}\` → <#${channelId}>`
          : `❌ \`${type}\` → *non configuré*`;
      });

      const embed = new EmbedBuilder()
        .setTitle('⚙️ Configuration des logs')
        .setColor('#5865F2')
        .setDescription(lines.join('\n'))
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }
  },
};