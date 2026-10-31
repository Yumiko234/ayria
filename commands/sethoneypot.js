const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { setHoneypotChannel, setHoneypotMessageId, getAutomodConfig } = require('../utils/automodConfig');
const { buildHoneypotPreventionEmbed } = require('../events/logManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sethoneypot')
    .setDescription("Configure le salon piège (honeypot) pour bannir automatiquement les bots/scammeurs")
    .addSubcommand(sub =>
      sub.setName('set')
        .setDescription('Définit le salon leurre')
        .addChannelOption(opt =>
          opt.setName('salon')
            .setDescription('Salon à utiliser comme piège (doit être invisible aux membres légitimes)')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Désactive le honeypot'))
    .addSubcommand(sub =>
      sub.setName('status')
        .setDescription('Affiche le salon honeypot configuré'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const db      = interaction.client.db;
    const guildId = interaction.guild.id;
    const sub     = interaction.options.getSubcommand();

    if (sub === 'set') {
      const channel = interaction.options.getChannel('salon');

      // 1. On enregistre d'abord le salon (sans message_id, catches remis à 0)
      let error = await setHoneypotChannel(db, guildId, channel.id, null);
      if (error) {
        console.error('[sethoneypot set] Supabase error :', error.message);
        return interaction.editReply('❌ Erreur lors de la configuration.');
      }

      // 2. On poste l'embed de prévention persistant dans le salon
      let sentMessage = null;
      try {
        sentMessage = await channel.send({ embeds: [buildHoneypotPreventionEmbed(0)] });
      } catch (err) {
        console.error('[sethoneypot set] Impossible de poster l\'embed :', err.message);
      }

      // 3. On stocke l'ID du message pour pouvoir le mettre à jour plus tard
      if (sentMessage) {
        error = await setHoneypotMessageId(db, guildId, sentMessage.id);
        if (error) console.error('[sethoneypot set] Erreur sauvegarde message_id :', error.message);
      }

      return interaction.editReply(
        `✅ Salon honeypot défini sur <#${channel.id}>.\n` +
        `⚠️ Pensez à configurer les permissions de ce salon pour qu'il soit **invisible aux membres légitimes** ` +
        `(ex : masqué pour le rôle vérifié, mais visible par défaut pour @everyone / nouveaux comptes). ` +
        `Tout message posté dedans entraînera un **ban immédiat**.` +
        (sentMessage ? `\n📌 Embed de prévention affiché avec un compteur qui se mettra à jour automatiquement.` : `\n⚠️ L'embed de prévention n'a pas pu être envoyé (permissions du bot dans ce salon ?).`)
      );
    }

    if (sub === 'remove') {
      const config = await getAutomodConfig(db, guildId);

      // On tente de nettoyer l'ancien embed de prévention si possible
      if (config.honeypot_channel_id && config.honeypot_message_id) {
        try {
          const oldChannel = await interaction.guild.channels.fetch(config.honeypot_channel_id).catch(() => null);
          const oldMessage = oldChannel ? await oldChannel.messages.fetch(config.honeypot_message_id).catch(() => null) : null;
          if (oldMessage) await oldMessage.delete().catch(() => {});
        } catch { /* ignore */ }
      }

      const error = await setHoneypotChannel(db, guildId, null);
      if (error) return interaction.editReply('❌ Erreur lors de la désactivation.');
      return interaction.editReply('🗑️ Honeypot désactivé.');
    }

    if (sub === 'status') {
      const config = await getAutomodConfig(db, guildId);
      return interaction.editReply(
        config.honeypot_channel_id
          ? `🍯 Honeypot actif sur <#${config.honeypot_channel_id}> — **${config.honeypot_catches}** compte(s) piégé(s).`
          : 'Aucun honeypot configuré.'
      );
    }
  },
};