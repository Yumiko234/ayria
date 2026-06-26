const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('say')
    .setDescription('Fait envoyer un message par le bot')
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription('Le message que le bot doit envoyer')
        .setRequired(true))
    .addChannelOption(option =>
      option
        .setName('salon')
        .setDescription('Le salon où envoyer le message (optionnel)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)) // 👈 Optionnel
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    const messageText = interaction.options.getString('message');
    // Si aucun salon n'est fourni, on prend le salon actuel
    const targetChannel = interaction.options.getChannel('salon') || interaction.channel;

    try {
      // Envoyer le message dans le salon ciblé
      await targetChannel.send(messageText);

      // Répondre de manière éphémère pour confirmer
      await interaction.reply({ 
        content: `✅ Message envoyé avec succès dans <#${targetChannel.id}> !`, 
        flags: [MessageFlags.Ephemeral] 
      });
    } catch (error) {
      console.error('Erreur lors de l\'envoi du message :', error);
      await interaction.reply({ 
        content: '❌ Une erreur est survenue lors de l\'envoi du message (vérifiez mes permissions dans ce salon).', 
        flags: [MessageFlags.Ephemeral] 
      });
    }
  },
};