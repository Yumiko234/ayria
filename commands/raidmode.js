const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('raidmode')
    .setDescription('Active ou désactive le protocole anti-raid (Verrouillage + Kick auto)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption(option =>
      option.setName('status')
        .setDescription('True pour activer le verrouillage et les kicks, False pour désactiver')
        .setRequired(true)),

  async execute(interaction, client) {
    const supabase = client.db;
    const status = interaction.options.getBoolean('status');
    const { guild, user } = interaction;

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    try {
      if (status) {
        // 🔒 ACTIVATION DU RAIDMODE
        client.raidmode = true; // Variable globale lue par l'event guildMemberAdd

        // 1. Niveau de vérification max
        await guild.setVerificationLevel(4);

        // 2. Suppression de toutes les invitations existantes
        const invites = await guild.invites.fetch();
        for (const invite of invites.values()) {
          await invite.delete('Protocole Raidmode activé');
        }

        // 3. Log Supabase
        await supabase
          .from('server_security')
          .insert({
            action: 'RAIDMODE_ON',
            moderator_id: user.id,
            active: true,
            created_at: new Date().toISOString()
          });

        const embedOn = new EmbedBuilder()
          .setTitle('🚨 PROTOCOLE D\'URGENCE : RAIDMODE ACTIVÉ 🚨')
          .setDescription('Le serveur est sous verrouillage militaire strict.')
          .setColor('#ff0000')
          .addFields(
            { name: 'Niveau de vérification', value: '🔴 **Maximum (Téléphone requis)**', inline: true },
            { name: 'Invitations', value: '🗑️ **Toutes les invites ont été détruites**', inline: true },
            { name: 'Sécurité d\'Entrée', value: '🥾 **Kick automatique activé pour TOUS les nouveaux arrivants**', inline: false }
          )
          .setTimestamp();

        await interaction.channel.send({ embeds: [embedOn] });
        return interaction.editReply({ content: '✅ Mode Raid activé. Le serveur rejette désormais automatiquement toutes les entrées.' });

      } else {
        // 🔓 DÉSACTIVATION DU RAIDMODE
        client.raidmode = false;

        await guild.setVerificationLevel(2); // Retour à la normale (Moyen)

        await supabase
          .from('server_security')
          .update({ active: false })
          .eq('action', 'RAIDMODE_ON');

        const embedOff = new EmbedBuilder()
          .setTitle('🛡️ Protocole de sécurité levé')
          .setDescription('Le serveur est accessible à nouveau.')
          .setColor('#00ff00')
          .addFields(
            { name: 'Niveau de vérification', value: '🟢 Réduit à Moyen', inline: true },
            { name: 'Sécurité d\'Entrée', value: '✅ Kicks automatiques désactivés', inline: true }
          )
          .setTimestamp();

        await interaction.channel.send({ embeds: [embedOff] });
        return interaction.editReply({ content: '✅ Le mode raid a été désactivé avec succès.' });
      }

    } catch (error) {
      console.error('Erreur lors de l\'exécution du raidmode :', error);
      return interaction.editReply({ content: '❌ Une erreur est survenue lors de la configuration du protocole de sécurité.' });
    }
  },
};