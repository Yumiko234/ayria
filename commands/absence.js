const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('absence')
    .setDescription('Envoie le règlement des absences')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    // Création de l'embed à partir de ton JSON
    const rulesEmbed = new EmbedBuilder()
      .setTitle("Règlement des absences Staff")
      .setDescription(
        "Les absences Staff prennent trois formes : les absences de moins d'une semaine, d'une à quatre semaines et les absences de plus d'un mois.\n"+
        "En fonction de la durée de votre absences vous recevrez :\n"+
        "- Moins d'une semaine : Aucun rôle, conservation des permissions de modération ;\n"+
        "- D'une semaine à quatre semaines : <@&152163119753>, conservation des permissions Staff de base ;\n"+
        "- De plus d'un mois : <@&1521163080725>, suspension des permissions de Staff. \n\n"+
        "### Format :\n"+
        "Pseudo :\n"+
        "Date de début :\n"+
        "Date de fin estimée :\n"+
        "Mention : @votre Responsable"
      )
      .setColor(4394149)
      .setImage("https://cdn.discordapp.com/attachments/1495675329555988604/1519665152226754610/Ayria_Banner.png?ex=6a3e61f6&is=6a3d1076&hm=e3b910b61fe27de5baf7c52ccdeb0cc45bd857da60e51c81ec5890cdb513d621&")
      .setThumbnail("https://cdn.discordapp.com/icons/1518048523818373300/70f58098faef1487b54ab48a02b2b7a0.webp");

    // Envoi de la réponse à l'interaction pour éviter le "Le bot n'a pas répondu"
    await interaction.reply({ content: 'Règlement envoyé avec succès !', ephemeral: true });

    // Envoi du message final dans le salon avec la mention @everyone si tu le souhaites
    await interaction.channel.send({ 
      embeds: [rulesEmbed] 
    });
  }
};