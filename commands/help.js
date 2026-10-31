const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

// Limite d'un embed Discord : 4096 caractères de description
const MAX_DESC = 4000;
const clip = text => (text.length > MAX_DESC ? text.slice(0, MAX_DESC - 2) + '\n…' : text);

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
          { name: '🎁 Giveaways & Drops', value: 'giveaway' },
          { name: '🛠️ Administration', value: 'admin' },
          { name: '🔧 Utilitaires',  value: 'utilitaires' },
          { name: '📦 Autres commandes', value: 'autres' },
        )),

  async execute(interaction) {
    const categorie = interaction.options.getString('categorie');

    // ─── Définition des commandes (détaillées à la main) ─────────────────────
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
          { name: '/reason',    desc: 'Modifie la raison d\'une sanction existante.\n`/reason <id> <nouvelle_raison>`' },
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
      giveaway: {
        label: '🎁 Giveaways & Drops',
        color: '#ff7eb6',
        commands: [
          { name: '/giveaway lancer', desc: 'Lance un giveaway. *(Responsable Modération+)*\n`/giveaway lancer <lot> <durée> <gagnants> [options]`\n• Durée : `30m`, `2h`, `1d`, `1w`\n• Récompense : `recompense` = rôle (`role_recompense`), XP (`xp_recompense`) ou autre (texte libre remis par le staff)\n• Conditions : `niveau_min`, `messages_min`, `anciennete_jours`, `role_requis`, `role_interdit`\n• Voix bonus : jusqu\'à 3 paires `voix_role_N` + `voix_nb_N` (plus de voix = plus de chances)\n• `claim_delai` : temps pour réclamer avant reroll automatique (24h par défaut)\n• `salon` : salon du giveaway (défaut : salon actuel)' },
          { name: '/giveaway terminer', desc: 'Termine un giveaway immédiatement (tirage au sort). *(Responsable Modération+)*\n`/giveaway terminer <id>`' },
          { name: '/giveaway annuler',  desc: 'Annule un giveaway en cours, sans tirage. *(Responsable Modération+)*\n`/giveaway annuler <id>`' },
          { name: '/giveaway reroll',   desc: 'Remplace un gagnant qui n\'a pas encore réclamé. *(Responsable Modération+)*\n`/giveaway reroll <id> <utilisateur>`' },
          { name: '/drop', desc: 'Lance un drop : les premiers à cliquer remportent le lot. *(Responsable Modération+)*\n`/drop <lot> <gagnants> [recompense] [role_recompense] [xp_recompense] [salon] [durée]`' },
          { name: 'Participer / Réclamer', desc: 'Se fait avec les **boutons** du message : **Participer** pour entrer, **Réclamer** pour récupérer son lot (réservé aux gagnants). Les gagnants sont aussi prévenus par MP.' },
        ],
      },
      admin: {
        label: '🛠️ Administration',
        color: '#9f00f5',
        commands: [
          { name: '/automod', desc: 'Gère le système anti-scam / anti-token automatique. *(Admin)*\n`/automod status` · `/automod toggle <actif>` · `/automod whitelist add|remove|list`' },
          { name: '/absence', desc: 'Envoie le règlement des absences du staff dans le salon. *(Admin)*' },
        ],
      },
      utilitaires: {
        label: '🔧 Utilitaires',
        color: '#5865F2',
        commands: [
          { name: '/ping', desc: 'Affiche la latence du bot.\n`/ping`' },
          { name: '/help', desc: 'Affiche cette aide.\n`/help [catégorie]`' },
          { name : '/changelog', desc: 'Publie un changelog dans le salon de ton choix. *(Responsable Modération+)*\n`/changelog [salon] [mention]`' },
        ],
      },
    };

    // ─── Catégorie automatique : toute commande enregistrée mais non détaillée ci-dessus ─
    // Se met à jour toute seule quand tu ajoutes un fichier dans ./commands.
    const documented = new Set(
      Object.values(categories).flatMap(cat => cat.commands.map(c => c.name.slice(1).split(' ')[0]))
    );
    const registered = [...(interaction.client.commands?.values() ?? [])]
      .map(cmd => cmd?.data?.toJSON?.())
      .filter(Boolean);

    const extras = registered
      .filter(d => !documented.has(d.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(d => {
        // type 1 = sous-commande, type 2 = groupe de sous-commandes
        const subs = (d.options ?? []).filter(o => o.type === 1 || o.type === 2).map(o => o.name);
        const subText = subs.length ? `\nSous-commandes : ${subs.map(s => `\`${s}\``).join(', ')}` : '';
        return { name: `/${d.name}`, desc: `${d.description}${subText}` };
      });

    if (extras.length) {
      categories.autres = { label: '📦 Autres commandes', color: '#747f8d', commands: extras };
    }

    // ─── Réponse pour une catégorie spécifique ───────────────────────────────
    if (categorie) {
      const cat = categories[categorie];
      if (!cat) {
        return interaction.reply({ flags: [MessageFlags.Ephemeral], content: '❌ Catégorie introuvable ou vide.' });
      }

      const embed = new EmbedBuilder()
        .setTitle(`${cat.label} — Commandes`)
        .setColor(cat.color)
        .setDescription(
          clip(cat.commands.map(c => `**${c.name}**\n${c.desc}`).join('\n\n'))
        )
        .setFooter({ text: 'AYRIA • ✦ = Responsable Modération+ · /help pour voir toutes les catégories' })
        .setTimestamp();

      return interaction.reply({ flags: [MessageFlags.Ephemeral], embeds: [embed] });
    }

    // ─── Réponse globale (toutes les catégories) ─────────────────────────────
    const totalRegistered = registered.length || Object.values(categories).reduce((acc, cat) => acc + cat.commands.length, 0);

    const mainEmbed = new EmbedBuilder()
      .setTitle('📖 Aide — AYRIA')
      .setColor('#5865F2')
      .setDescription(clip(
        `Bienvenue dans l'aide d'**AYRIA** !\n` +
        `Utilisez \`/help <catégorie>\` pour voir le détail d'une catégorie.\n\n` +
        Object.values(categories)
          .map(cat => {
            const list = cat.commands.map(c => `\`${c.name}\``).join(', ');
            return `**${cat.label}** *(${cat.commands.length})*\n${list}`;
          })
          .join('\n\n')
      ))
      .addFields(
        { name: '📊 Statistiques', value: `**${totalRegistered}** commandes enregistrées · **${Object.keys(categories).length}** catégories`, inline: false }
      )
      .setFooter({ text: 'AYRIA • (Responsable Modération+) pour les commandes restreintes' })
      .setTimestamp();

    return interaction.reply({ flags: [MessageFlags.Ephemeral], embeds: [mainEmbed] });
  },
};