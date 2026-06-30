const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Affiche la liste de toutes les commandes disponibles')
    .addStringOption(option =>
      option.setName('categorie')
        .setDescription('Afficher une catégorie spécifique')
        .setRequired(false)
        .addChoices(
          { name: '🛡️ Modération', value: 'moderation' },
          { name: '⭐ XP & Niveaux', value: 'xp' },
          { name: '🔧 Utilitaires',  value: 'utilitaires' },
        )),

  async execute(interaction) {
    const categorie = interaction.options.getString('categorie');

    // ─── Définition des commandes ────────────────────────────────────────────
    const categories = {
      moderation: {
        label: '🛡️ Modération',
        color: '#ff4d4d',
        commands: [
          { name: '/ban',    desc: 'Bannit un utilisateur temporairement ou définitivement.\n`/ban <utilisateur> <raison> [durée]` — formats : `1h`, `1d`, `1w`' },
          { name: '/unban',  desc: 'Débannit un utilisateur du serveur.\n`/unban <utilisateur> <raison>`' },
          { name: '/kick',   desc: 'Expulse un utilisateur du serveur.\n`/kick <utilisateur> <raison>`' },
          { name: '/mute',   desc: 'Met un utilisateur en timeout.\n`/mute <utilisateur> <raison> <durée>` — max 28 jours' },
          { name: '/unmute', desc: 'Supprime le timeout d\'un utilisateur.\n`/unmute <utilisateur> <raison>`' },
          { name: '/warn',      desc: 'Donne un avertissement à un utilisateur.\n`/warn <utilisateur> <raison>`' },
          { name: '/purge',     desc: 'Supprime un nombre précis de messages (1-100).\n`/purge <nombre> [utilisateur]`' },
          { name: '/case',      desc: 'Affiche les détails d\'une sanction via son ID.\n`/case <id>`' },
          { name: '/modlogs',   desc: 'Affiche l\'historique des sanctions d\'un utilisateur.\n`/modlogs <utilisateur>`' },
          { name: '/modremove', desc: 'Supprime une sanction via son ID. *(Responsable Modération+)*\n`/modremove <id>`' },
          { name: '/clearlogs', desc: 'Supprime tout l\'historique des sanctions d\'un utilisateur. *(Superviseur+)*\n`/clearlogs <utilisateur> <raison>`' },
          { name: '/raidmode',  desc: 'Active ou désactive le protocole anti-raid.\n`/raidmode <true/false>` — Réservé aux administrateurs' },
        ],
      },
      xp: {
        label: '⭐ XP & Niveaux',
        color: '#f5c518',
        commands: [
          { name: '/rank',        desc: 'Affiche ton niveau et ta progression XP.\n`/rank [utilisateur]`' },
          { name: '/leaderboard', desc: 'Affiche le top 10 des membres par XP.' },
          { name: '/xp voir',     desc: 'Affiche l\'XP brut d\'un membre.\n`/xp voir <utilisateur>`' },
          { name: '/xp donner',   desc: 'Ajoute de l\'XP à un membre. *(Admin)*\n`/xp donner <utilisateur> <montant>`' },
          { name: '/xp retirer',  desc: 'Retire de l\'XP à un membre. *(Admin)*\n`/xp retirer <utilisateur> <montant>`' },
          { name: '/xp set-xp',   desc: 'Définit l\'XP exact d\'un membre. *(Admin)*\n`/xp set-xp <utilisateur> <valeur>`' },
          { name: '/xp set-niveau', desc: 'Place un membre directement à un niveau. *(Admin)*\n`/xp set-niveau <utilisateur> <niveau>`' },
          { name: '/xp reset',    desc: 'Remet l\'XP d\'un membre à zéro. *(Admin)*\n`/xp reset <utilisateur>`' },
          { name: '/xp palier',   desc: 'Associe un rôle récompense à un niveau. *(Admin)*\n`/xp palier <niveau> [rôle]`' },
          { name: '/xp paliers',  desc: 'Liste tous les paliers de rôles configurés.' },
        ],
      },
      utilitaires: {
        label: '🔧 Utilitaires',
        color: '#5865F2',
        commands: [
          { name: '/ping', desc: 'Affiche la latence du bot.\n`/ping`' },
          { name: '/help', desc: 'Affiche cette aide.\n`/help [catégorie]`' },
        ],
      },
    };

    // ─── Réponse pour une catégorie spécifique ───────────────────────────────
    if (categorie) {
      const cat = categories[categorie];
      if (!cat) {
        return interaction.reply({ flags: [MessageFlags.Ephemeral], content: '❌ Catégorie introuvable.' });
      }

      const embed = new EmbedBuilder()
        .setTitle(`${cat.label} — Commandes`)
        .setColor(cat.color)
        .setDescription(
          cat.commands
            .map(c => `**${c.name}**\n${c.desc}`)
            .join('\n\n')
        )
        .setFooter({ text: 'AYRIA • ✦ = Responsable Modération+ · /help pour voir toutes les catégories' })
        .setTimestamp();

      return interaction.reply({ flags: [MessageFlags.Ephemeral], embeds: [embed] });
    }

    // ─── Réponse globale (toutes les catégories) ─────────────────────────────
    const totalCommands = Object.values(categories).reduce((acc, cat) => acc + cat.commands.length, 0);

    const mainEmbed = new EmbedBuilder()
      .setTitle('📖 Aide — AYRIA')
      .setColor('#5865F2')
      .setDescription(
        `Bienvenue dans l'aide d'**AYRIA** !\n` +
        `Utilisez \`/help <catégorie>\` pour voir le détail d'une catégorie.\n\n` +
        Object.values(categories)
          .map(cat => {
            const list = cat.commands.map(c => `\`${c.name}\``).join(', ');
            return `**${cat.label}** *(${cat.commands.length} commandes)*\n${list}`;
          })
          .join('\n\n')
      )
      .addFields(
        { name: '📊 Statistiques', value: `**${totalCommands}** commandes disponibles · **${Object.keys(categories).length}** catégories`, inline: false }
      )
      .setFooter({ text: 'AYRIA • (Responsable Modération+) pour les commandes restreintes' })
      .setTimestamp();

    return interaction.reply({ flags: [MessageFlags.Ephemeral], embeds: [mainEmbed] });
  },
};