const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket-panel')
    .setDescription("Publie le message d'information expliquant comment ouvrir un ticket par MP")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, client) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const description = [
      '# Bienvenue dans le salon Support de AYRIA !',
      '',
      "Les tickets s'ouvrent désormais **par message privé** :",
      '',
      `1. Envoie un MP à <@${client.user.id}> (clic droit sur le bot → **Envoyer un message**).`,
      '2. Choisis le type de ticket avec les boutons qui apparaissent.',
      '3. Continue la discussion directement en MP : l\'équipe te répondra dans la même conversation.',
      '',
      'Trois types de tickets sont disponibles :',
      '',
      "• **Question / Signalement :** Question d'ordre général, ou signalement d'une personne qui ne respecterait pas les règles du serveur ou les ToS de Discord.",
      '',
      "• **Recrutement Staff :** Pour envoyer ta candidature quand ceux-ci sont ouverts par l'Administration.",
      '',
      '• **Partenariat :** Si tu souhaites effectuer un partenariat entre AYRIA et ton serveur.',
      '',
      '⚠️ **Pense à autoriser les messages privés des membres du serveur pour recevoir les réponses.**',
      "⚠️ **L'Équipe de modération étant entièrement bénévole, merci de bien vouloir excuser les potentiels délais de réponse.**",
    ].join('\n');

    const embed = new EmbedBuilder()
      .setTitle("Ouverture d'un ticket")
      .setDescription(description)
      .setColor('#8FA382')
      .setFooter({
        text: 'AYRIA',
        iconURL: 'https://cdn.discordapp.com/attachments/1519273679173845133/1519293727430934618/70f58098faef1487b54ab48a02b2b7a0.png?ex=6a3d080b&is=6a3bb68b&hm=b194703dba3b89fb6e8c4b474a0d0f8d93f6610de50f0c1704cf046805b517c7&',
      })
      .setTimestamp();

    try {
      await interaction.channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
      await interaction.editReply('✅ Message d\'information publié dans ce salon.');
    } catch (error) {
      console.error('Erreur lors de la publication du panneau ticket :', error);
      await interaction.editReply('❌ Impossible de publier le message dans ce salon (permissions du bot ?).').catch(() => {});
    }
  },
};
