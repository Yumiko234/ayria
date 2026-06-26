const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, InteractionResponseFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket-panel')
    .setDescription('Crée un panneau pour ouvrir des tickets de support')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
  async execute(interaction) {
    try {
      console.log('Traitement de l\'interaction:', interaction.id);
      
      // Vérifier et différer avec un délai de sécurité
      if (!interaction.deferred && !interaction.replied) {
        try {
          await interaction.deferReply({ timeout: 2000 });
          console.log('Interaction différée:', interaction.id);
        } catch (deferErr) {
          console.error('Échec du deferReply pour', interaction.id, ':', deferErr);
          await interaction.reply({ content: 'Préparation du panneau...', flags: InteractionResponseFlags.Ephemeral });
        }
      }

      // Nouveau texte de description mis en forme
      const descriptionText = [
        "# Bienvenue dans le salon Support de AYRIA !",
        "",
        "",
        "Ci-dessous, vous trouverez les trois types de tickets actuellement disponibles sur le serveur :",
        "",
        "• **Question / Signalement :** Utilisable si vous avez une question d'ordre général ou pour signaler une personne qui ne respecterait pas les règles du serveur ou les ToS de Discord.",
        "",
        "• **Recrutement Staff :** Pour envoyer votre candidature quand ceux-ci sont ouverts par l'Administration.",
        "",
        "• **Partenariat :** Si vous souhaitez effectuer un partenariat entre AYRIA et votre serveur.",
        "",
        "",
        "⚠️ **L'Équipe de modération étant entièrement bénévole, merci de bien vouloir excuser les potentiels délais de réponse.**"
      ].join('\n');

      const embed = new EmbedBuilder()
        .setTitle("Ouverture d'un ticket")
        .setDescription(descriptionText)
        .setColor("#9f00f5")
        .setFooter({
          text: "AYRIA",
          iconURL: "https://cdn.discordapp.com/attachments/1519273679173845133/1519293727430934618/70f58098faef1487b54ab48a02b2b7a0.png?ex=6a3d080b&is=6a3bb68b&hm=b194703dba3b89fb6e8c4b474a0d0f8d93f6610de50f0c1704cf046805b517c7&",
        })
        .setTimestamp();

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('open_request')
            .setLabel('Question / Signalement')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('open_application')
            .setLabel('Recrutement Staff')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('open_partnership')
            .setLabel('Partenariat')
            .setStyle(ButtonStyle.Primary)
        );

      await interaction.editReply({ embeds: [embed], components: [row] }).catch(err => {
        console.error('Erreur lors de l\'édition de la réponse :', err);
        if (!interaction.replied) {
          interaction.followUp({ content: 'Une erreur est survenue lors de la création du panneau.', flags: InteractionResponseFlags.Ephemeral }).catch(console.error);
        }
      });
    } catch (error) {
      console.error('Erreur globale lors de l\'exécution de ticket-panel :', error);
      if (!interaction.replied && !interaction.deferred) {
        interaction.followUp({ content: 'Une erreur est survenue lors de l\'exécution de la commande.', flags: InteractionResponseFlags.Ephemeral }).catch(console.error);
      }
    }
  },
};