const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('send-rules')
    .setDescription('Envoie le règlement du serveur sous forme d\'embed')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    // Création de l'embed à partir de ton JSON
    const rulesEmbed = new EmbedBuilder()
      .setTitle("Règlement du serveur  𝑨𝒀𝑹𝑰𝑨 🍵")
      .setDescription(
        "Le règlement se doit d’être lu et approuvé dès la première arrivée sur le serveur. De plus, les [**conditions générales d’utilisation de Discord**](https://discord.com/terms) sont à respecter. Nous en profitons pour vous rappeler que le règlement est non-exhaustif.\n\n" +
        "# Section I : Dispositions générales\n" +
        "- **Courtoisie et respect :** Les insultes, provocations, discriminations (racisme, sexisme, homophobie, etc.), harcèlement et discours haineux sont strictement interdit. \n" +
        "- **Contenu innaproprié :** Tout contenu à caractère pornographique, violent, gore ou choquant est formellement interdit.\n" +
        "- **Pseudonymes et Avatars :** Votre pseudonyme, votre photo de profile, statut et bannière ne doivent pas être provocants, insultants à connotation politique extrême ou usurper l'identité d'un tiers.\n" +
        "- **Protection de la vie privée :** Le partage d'informations personnelles (Doxxing) d'un membre ou de toute autre personne sans son consentement explicite est sanctionné d'un bannissement immédiat, définitif et sans possibilité d'appel. Si le doxx concerne une personne mineure, un signalement aux autorités sera réalisé.\n\n" +
        "# Section II : Utilisation des canaux\n" +
        "- **Respect des thématiques :** Veillez à poster vos messages dans les channels appropriés. Si nécessaire, lisez les descriptions des salons.\n" +
        "- **Pollution visuelle et sonore :**\n" +
        "                    - **En textuel :** Le spam (envoi de message massif et/ou répétitif), le flood et les mentions abusives (notamment envers le Staff, de surcroit envers la Owneuse) sont interdits.\n" +
        "  - **En vocal :** Les bruits parasites, les soundboards abusives, les cris et les coupures de paroles intempestives sont interdits.\n" +
        "- **Langue du serveur :** La langue du serveur est le français. Merci de ne pas abuser de l'usage de langue étrangère.\n" +
        "- **Publicité et démarchage :** La publicité non sollicitée (dans les salons ou par message privé) est strictement interdite sans l'accord préalable du staff.\n\n" +
        "# Section III : Dispositions Légales\n" +
        "- **Conditions d'Utilisation de Discord :** Tout membre doit respecter les [**Conditions générales d’Utilisation de Discord**](https://discord.com/terms) ainsi que leur [**Charte de la Communauté**](https://discord.com/guidelines).\n" +
        "- **Activités illégales :** Tout partage de contenu piratet, de logiciel malveillant ou l'apologie d'actes illégaux entraineront un bannissement définitif sans possibilité d'appel.\n\n" +
        "# Section IV : Modération\n" +
        "L'Équipe de modération est la seule autorisée à faire respecter le règlement. Ses décisions sont prises dans l'intérêt du serveur.\n" +
        "En cas de non respect des règles, les sanctions suivantes pourront être appliquées :\n" +
        "- **Avertissement (Warn) :** Rappel à l'ordre formel.\n" +
        "- **Le Mute (Exclusion temporaire/Timeout) :** Retrait de la possibilité d'interagir sur le serveur.\n" +
        "- **Expulsion (Kick) :** Retrait du serveur avec possibilité de revenir.\n" +
        "- **Bannissement (Ban) :** Exclusion temporaire ou définitive.\n\n" +
        "**Note d'information :** Sauf dans le cas des présentes dispositions et les décisions individuelles des Administrateurs+, chaque sanctions peut faire l'objet d'un appel. Les plaintes publiques ou virulentes ne seront pas traitées.\n\n\n" +
        "Le Staff d'𝑨𝒀𝑹𝑰𝑨 🍵 vous souhaite d'excellents moments parmi nous."
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