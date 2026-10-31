const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const {
  getAutomodConfig,
  setEnabled,
  addWhitelistDomain,
  removeWhitelistDomain,
} = require('../utils/automodConfig');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription("Gère le système anti-scam / anti-token automatique")
    .addSubcommand(sub =>
      sub.setName('status')
        .setDescription("Affiche l'état actuel de l'auto-mod"))
    .addSubcommand(sub =>
      sub.setName('toggle')
        .setDescription("Active ou désactive l'auto-mod")
        .addBooleanOption(opt =>
          opt.setName('actif')
            .setDescription('True pour activer, False pour désactiver')
            .setRequired(true)))
    .addSubcommandGroup(group =>
      group.setName('whitelist')
        .setDescription('Gère les domaines de confiance (jamais analysés)')
        .addSubcommand(sub =>
          sub.setName('add')
            .setDescription('Ajoute un domaine à la whitelist')
            .addStringOption(opt =>
              opt.setName('domaine')
                .setDescription('Ex : youtube.com')
                .setRequired(true)))
        .addSubcommand(sub =>
          sub.setName('remove')
            .setDescription('Retire un domaine de la whitelist')
            .addStringOption(opt =>
              opt.setName('domaine')
                .setDescription('Domaine à retirer')
                .setRequired(true)))
        .addSubcommand(sub =>
          sub.setName('list')
            .setDescription('Liste les domaines whitelistés')))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const db      = interaction.client.db;
    const guildId = interaction.guild.id;
    const group   = interaction.options.getSubcommandGroup(false);
    const sub     = interaction.options.getSubcommand();

    if (!group && sub === 'status') {
      const config = await getAutomodConfig(db, guildId);
      const embed = new EmbedBuilder()
        .setTitle('🛡️ État de l\'auto-mod anti-scam')
        .setColor(config.enabled ? '#00CC66' : '#FF4444')
        .addFields(
          { name: 'Statut',    value: config.enabled ? '✅ Activé' : '❌ Désactivé', inline: true },
          { name: 'Honeypot',  value: config.honeypot_channel_id ? `<#${config.honeypot_channel_id}>` : 'Non configuré', inline: true },
          { name: 'Whitelist', value: config.whitelist.length ? config.whitelist.join(', ') : 'Aucune', inline: false },
        )
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    if (!group && sub === 'toggle') {
      const actif = interaction.options.getBoolean('actif');
      const error = await setEnabled(db, guildId, actif);
      if (error) {
        console.error('[automod toggle] Supabase error :', error.message);
        return interaction.editReply('❌ Erreur lors de la mise à jour.');
      }
      return interaction.editReply(actif ? "✅ Auto-mod anti-scam **activé**." : "🛑 Auto-mod anti-scam **désactivé**.");
    }

    if (group === 'whitelist') {
      if (sub === 'add') {
        const domaine = interaction.options.getString('domaine').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        const error = await addWhitelistDomain(db, guildId, domaine);
        if (error) return interaction.editReply('❌ Erreur lors de l\'ajout à la whitelist.');
        return interaction.editReply(`✅ **${domaine}** ajouté à la whitelist.`);
      }

      if (sub === 'remove') {
        const domaine = interaction.options.getString('domaine').toLowerCase();
        const error = await removeWhitelistDomain(db, guildId, domaine);
        if (error) return interaction.editReply('❌ Erreur lors de la suppression.');
        return interaction.editReply(`🗑️ **${domaine}** retiré de la whitelist.`);
      }

      if (sub === 'list') {
        const config = await getAutomodConfig(db, guildId);
        return interaction.editReply(
          config.whitelist.length
            ? `📋 Domaines whitelistés :\n${config.whitelist.map(d => `• ${d}`).join('\n')}`
            : 'Aucun domaine whitelisté.'
        );
      }
    }
  },
};