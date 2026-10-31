const { SlashCommandBuilder, ChannelType, MessageFlags } = require('discord.js');
const { hasAnyRole, GIVEAWAY_ROLES } = require('../utils/permissions');
const gm = require('../utils/giveawayManager');

const VOTE_SLOTS = [1, 2, 3];

const builder = new SlashCommandBuilder()
  .setName('giveaway')
  .setDescription('Gère les giveaways');

builder.addSubcommand(sub => {
  sub.setName('lancer').setDescription('Lance un giveaway')
    // ── Obligatoires (Discord impose de les déclarer en premier)
    .addStringOption(o => o.setName('lot').setDescription('Intitulé du lot').setMaxLength(200).setRequired(true))
    .addStringOption(o => o.setName('duree').setDescription('Durée : 30m, 2h, 1d, 1w').setRequired(true))
    .addIntegerOption(o => o.setName('gagnants').setDescription('Nombre de gagnants')
      .setMinValue(1).setMaxValue(gm.CONFIG.MAX_WINNERS).setRequired(true))
    // ── Récompense
    .addStringOption(o => o.setName('recompense').setDescription('Type de récompense (défaut : autre = texte libre)')
      .addChoices(
        { name: 'Rôle', value: 'role' },
        { name: 'XP', value: 'xp' },
        { name: 'Autre (texte libre, remis par le staff)', value: 'autre' },
      ))
    .addRoleOption(o => o.setName('role_recompense').setDescription('Rôle offert (si recompense = rôle)'))
    .addIntegerOption(o => o.setName('xp_recompense').setDescription('XP offerte (si recompense = xp)')
      .setMinValue(1).setMaxValue(10_000_000))
    .addChannelOption(o => o.setName('salon').setDescription('Salon du giveaway (défaut : salon actuel)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addStringOption(o => o.setName('claim_delai').setDescription('Délai pour réclamer avant reroll auto (défaut : 24h)'))
    // ── Conditions
    .addIntegerOption(o => o.setName('niveau_min').setDescription('Niveau minimum').setMinValue(1))
    .addIntegerOption(o => o.setName('messages_min').setDescription('Nombre de messages minimum').setMinValue(1))
    .addIntegerOption(o => o.setName('anciennete_jours').setDescription("Ancienneté minimale sur le serveur (jours)").setMinValue(1))
    .addRoleOption(o => o.setName('role_requis').setDescription('Rôle obligatoire pour participer'))
    .addRoleOption(o => o.setName('role_interdit').setDescription('Rôle exclu du giveaway'));
  // ── Voix multiples : 3 paires rôle → nombre de voix
  for (const i of VOTE_SLOTS) {
    sub
      .addRoleOption(o => o.setName(`voix_role_${i}`).setDescription(`Voix bonus n°${i} : rôle concerné`))
      .addIntegerOption(o => o.setName(`voix_nb_${i}`).setDescription(`Voix bonus n°${i} : nombre de voix de ce rôle`)
        .setMinValue(2).setMaxValue(gm.CONFIG.MAX_VOTES));
  }
  return sub;
});

builder
  .addSubcommand(sub => sub.setName('terminer').setDescription('Termine un giveaway maintenant (tirage immédiat)')
    .addIntegerOption(o => o.setName('id').setDescription('Numéro du giveaway (#id dans le pied de l\'embed)').setMinValue(1).setRequired(true)))
  .addSubcommand(sub => sub.setName('annuler').setDescription('Annule un giveaway en cours (sans tirage)')
    .addIntegerOption(o => o.setName('id').setDescription('Numéro du giveaway').setMinValue(1).setRequired(true)))
  .addSubcommand(sub => sub.setName('reroll').setDescription("Remplace un gagnant qui n'a pas encore réclamé")
    .addIntegerOption(o => o.setName('id').setDescription('Numéro du giveaway').setMinValue(1).setRequired(true))
    .addUserOption(o => o.setName('utilisateur').setDescription('Gagnant à remplacer').setRequired(true)));

async function lancer(interaction) {
  const opt = interaction.options;

  const durationMs = gm.parseDuration(opt.getString('duree'));
  if (!durationMs) return interaction.editReply('❌ Durée invalide. Exemples : `30m`, `2h`, `1d`, `1w`.');
  if (durationMs < gm.CONFIG.MIN_DURATION_MS || durationMs > gm.CONFIG.MAX_DURATION_MS) {
    return interaction.editReply(`❌ La durée doit être comprise entre ${gm.formatDuration(gm.CONFIG.MIN_DURATION_MS)} et ${gm.formatDuration(gm.CONFIG.MAX_DURATION_MS)}.`);
  }

  let claimDelayMs = gm.CONFIG.DEFAULT_CLAIM_DELAY_MS;
  const claimInput = opt.getString('claim_delai');
  if (claimInput) {
    claimDelayMs = gm.parseDuration(claimInput);
    if (!claimDelayMs || claimDelayMs < gm.CONFIG.MIN_DURATION_MS || claimDelayMs > gm.CONFIG.MAX_DURATION_MS) {
      return interaction.editReply('❌ `claim_delai` invalide (ex. `12h`, `2d`), entre 1 minute et 60 jours.');
    }
  }

  const reward = gm.parseRewardOptions(interaction);
  if (reward.error) return interaction.editReply(`❌ ${reward.error}`);

  const voteRoles = [];
  for (const i of VOTE_SLOTS) {
    const role = opt.getRole(`voix_role_${i}`);
    const nb = opt.getInteger(`voix_nb_${i}`);
    if (!role && nb == null) continue;
    if (!role || nb == null) return interaction.editReply(`❌ Voix bonus n°${i} : renseigne à la fois le rôle et le nombre de voix.`);
    if (voteRoles.some(v => v.role_id === role.id)) return interaction.editReply(`❌ Le rôle ${role} est utilisé deux fois dans les voix bonus.`);
    voteRoles.push({ role_id: role.id, votes: nb });
  }

  const requiredRole = opt.getRole('role_requis');
  const forbiddenRole = opt.getRole('role_interdit');
  if (requiredRole && forbiddenRole && requiredRole.id === forbiddenRole.id) {
    return interaction.editReply('❌ `role_requis` et `role_interdit` désignent le même rôle : personne ne pourrait participer.');
  }

  const channel = opt.getChannel('salon') ?? interaction.channel;
  const permError = gm.checkChannelPermissions(channel, interaction.guild.members.me);
  if (permError) return interaction.editReply(`❌ ${permError}`);

  const giveaway = await gm.createGiveaway(interaction.client, {
    guild: interaction.guild,
    channel,
    hostId: interaction.user.id,
    prize: opt.getString('lot'),
    ...reward,
    winnersCount: opt.getInteger('gagnants'),
    durationMs,
    claimDelayMs,
    minLevel: opt.getInteger('niveau_min'),
    minMessages: opt.getInteger('messages_min'),
    minServerDays: opt.getInteger('anciennete_jours'),
    requiredRoleId: requiredRole?.id,
    forbiddenRoleId: forbiddenRole?.id,
    voteRoles,
  });

  const link = gm.messageUrl(interaction.guild.id, channel.id, giveaway.message_id);
  return interaction.editReply(`✅ Giveaway **#${giveaway.id}** lancé dans ${channel}. [Voir le message](${link})`);
}

module.exports = {
  data: builder,

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Cette commande ne fonctionne que sur un serveur.', flags: [MessageFlags.Ephemeral] });
    }
    if (!hasAnyRole(interaction.member, GIVEAWAY_ROLES)) {
      return interaction.reply({ content: "❌ Tu n'as pas le rôle requis pour gérer les giveaways.", flags: [MessageFlags.Ephemeral] });
    }

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const sub = interaction.options.getSubcommand();
    const client = interaction.client;

    try {
      if (sub === 'lancer') return await lancer(interaction);

      const id = interaction.options.getInteger('id');

      if (sub === 'terminer') {
        const res = await gm.endGiveaway(client, id, interaction.guild.id);
        if (!res.ok) return interaction.editReply(`❌ ${res.reason}`);
        return interaction.editReply(`✅ Giveaway **#${id}** terminé : ${res.winners.length} gagnant(s) tiré(s) au sort.`);
      }

      if (sub === 'annuler') {
        const res = await gm.cancelGiveaway(client, id, interaction.guild.id);
        return interaction.editReply(res.ok ? `🚫 Giveaway **#${id}** annulé.` : `❌ ${res.reason}`);
      }

      if (sub === 'reroll') {
        const user = interaction.options.getUser('utilisateur');
        const res = await gm.rerollWinner(client, id, interaction.guild.id, user.id);
        if (!res.ok) return interaction.editReply(`❌ ${res.reason}`);
        return interaction.editReply(res.next
          ? `🔁 ${user} remplacé par <@${res.next.user_id}>.`
          : `🔁 ${user} retiré, mais aucun remplaçant éligible n'a été trouvé.`);
      }
    } catch (err) {
      console.error(`[/giveaway ${sub}] Erreur :`, err);
      return interaction.editReply('❌ Une erreur est survenue (voir les logs du bot).');
    }
  },
};
