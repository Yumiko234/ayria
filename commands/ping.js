const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Répond avec Pong et affiche la latence du bot'),
  async execute(interaction) {
    const ping = interaction.client.ws.ping;
    await interaction.reply(`Pong ! 🏓 : ${ping}ms`);
  },
};