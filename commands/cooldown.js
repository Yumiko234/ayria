const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cooldown')
    .setDescription('Définit ou désactive un cooldown entre les messages dans un salon')
    .addChannelOption(option =>
      option.setName('salon')
        .setDescription('Le salon à limiter (par défaut : salon actuel)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false))
    .addIntegerOption(option =>
      option.setName('delai')
        .setDescription('Délai en secondes entre les messages (max : 300)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(300))
    .addBooleanOption(option =>
      option.setName('desactiver')
        .setDescription('Désactive le cooldown')
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    try {
      const targetChannel = interaction.options.getChannel('salon') || interaction.channel;
      const delaySeconds  = interaction.options.getInteger('delai');
      const disable       = interaction.options.getBoolean('desactiver') ?? false;
      const db            = interaction.client.db;

      await interaction.deferReply({  flags : [MessageFlags.Ephemeral] });

      if (!targetChannel?.isTextBased()) {
        return interaction.editReply({ content: 'Salon invalide ou non accessible.' });
      }

      if (disable) {
        // Supprimer le cooldown
        const { error } = await db
          .from('message_cooldowns')
          .delete()
          .eq('user_id', 'cooldown_config')
          .eq('channel_id', targetChannel.id);

        if (error) {
          console.error('Supabase (cooldown disable) :', error.message);
          return interaction.editReply({ content: 'Erreur lors de la désactivation du cooldown.' });
        }
        return interaction.editReply({ content: `✅ Cooldown désactivé pour **${targetChannel.name}**.` });
      }

      if (delaySeconds !== null && delaySeconds !== undefined) {
        // Définir un nouveau cooldown (upsert)
        const delayMs = Math.min(delaySeconds * 1000, 300000);

        const { error } = await db
          .from('message_cooldowns')
          .upsert({
            user_id:                'cooldown_config',
            channel_id:             targetChannel.id,
            last_message_timestamp: delayMs,
          }, { onConflict: 'user_id,channel_id' });

        if (error) {
          console.error('Supabase (cooldown set) :', error.message);
          return interaction.editReply({ content: 'Erreur lors de la configuration du cooldown.' });
        }
        return interaction.editReply({ content: `✅ Cooldown de **${delaySeconds}** seconde(s) défini pour **${targetChannel.name}**.` });
      }

      // Vérifier l'état actuel
      const { data: row, error } = await db
        .from('message_cooldowns')
        .select('last_message_timestamp')
        .eq('user_id', 'cooldown_config')
        .eq('channel_id', targetChannel.id)
        .single();

      if (error || !row) {
        return interaction.editReply({ content: `Aucun cooldown actif pour **${targetChannel.name}**.` });
      }
      return interaction.editReply({ content: `ℹ️ Cooldown actuel : **${row.last_message_timestamp / 1000}** seconde(s) pour **${targetChannel.name}**.` });

    } catch (err) {
      console.error('Erreur globale /cooldown :', err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'Une erreur est survenue.',  flags : [MessageFlags.Ephemeral] }).catch(() => {});
      } else {
        await interaction.editReply({ content: 'Une erreur est survenue.' }).catch(() => {});
      }
    }
  },
};