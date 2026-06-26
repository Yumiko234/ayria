const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member, client) {
    // Si le mode raid n'est pas actif, on ne fait rien
    if (!client.raidmode) return;

    try {
      // 1. Envoyer un message privé explicatif à l'utilisateur avant le kick
      const dmEmbed = new EmbedBuilder()
        .setTitle('⚠️ Accès temporairement restreint')
        .setDescription(`Bonjour, le serveur **${member.guild.name}** subit actuellement une attaque ou une maintenance de sécurité.\n\nLe mode anti-raid est activé, ce qui empêche toute nouvelle connexion pour le moment. Veuillez réessayer de nous rejoindre plus tard. Merci de votre compréhension.`)
        .setColor('#ff3333')
        .setTimestamp();

      // On utilise un try/catch pour le DM car certains utilisateurs bloquent leurs messages privés
      await member.send({ embeds: [dmEmbed] }).catch(() => console.log(`Impossible d'envoyer un MP à ${member.user.tag}`));

      // 2. Expulsion immédiate du membre
      await member.kick('Protocole d\'urgence : Raidmode activé (Kick automatique des nouveaux arrivants)');
      
      console.log(`[RAIDMODE] Utilisateur expulsé automatiquement : ${member.user.tag} (${member.id})`);

    } catch (error) {
      console.error(`[RAIDMODE] Échec du kick automatique pour ${member.user.tag} :`, error);
    }
  },
};