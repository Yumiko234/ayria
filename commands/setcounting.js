const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setcounting')
    .setDescription('Configure le salon de counting')
    .addSubcommand(sub =>
      sub.setName('set')
        .setDescription('Définit le salon de counting')
        .addChannelOption(opt =>
          opt.setName('salon')
            .setDescription('Salon où se déroulera le counting')
            .setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('reset')
        .setDescription('Remet le compteur à zéro'))
    .addSubcommand(sub =>
      sub.setName('disable')
        .setDescription('Désactive le counting'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const sub = interaction.options.getSubcommand();
    const db  = interaction.client.db;

    if (sub === 'set') {
      const channel = interaction.options.getChannel('salon');

      const { error } = await db
        .from('counting')
        .upsert(
          { guild_id: interaction.guild.id, channel_id: channel.id, count: 0, last_user_id: null },
          { onConflict: 'guild_id' }
        );

      if (error) {
        console.error('[setcounting] Supabase upsert error:', error.message);
        return interaction.editReply('❌ Erreur lors de la configuration.');
      }

      return interaction.editReply(`✅ Salon de counting défini sur <#${channel.id}>. Le compteur démarre à **0**.`);
    }

    if (sub === 'reset') {
      const { error } = await db
        .from('counting')
        .update({ count: 0, last_user_id: null })
        .eq('guild_id', interaction.guild.id);

      if (error) {
        console.error('[setcounting reset] Supabase error:', error.message);
        return interaction.editReply('❌ Erreur lors de la réinitialisation.');
      }

      return interaction.editReply('🔄 Compteur remis à **0**.');
    }

    if (sub === 'disable') {
      const { error } = await db
        .from('counting')
        .delete()
        .eq('guild_id', interaction.guild.id);

      if (error) {
        console.error('[setcounting disable] Supabase error:', error.message);
        return interaction.editReply('❌ Erreur lors de la désactivation.');
      }

      return interaction.editReply('🗑️ Counting désactivé sur ce serveur.');
    }
  },
};