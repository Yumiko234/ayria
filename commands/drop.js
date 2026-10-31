const { SlashCommandBuilder, ChannelType, MessageFlags } = require('discord.js');
const { hasAnyRole, GIVEAWAY_ROLES } = require('../utils/permissions');
const gm = require('../utils/giveawayManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('drop')
    .setDescription('Lance un drop : les premiers à cliquer remportent le lot')
    .addStringOption(o => o.setName('lot').setDescription('Intitulé du lot').setMaxLength(200).setRequired(true))
    .addIntegerOption(o => o.setName('gagnants').setDescription('Nombre de gagnants (les N premiers clics)')
      .setMinValue(1).setMaxValue(gm.CONFIG.MAX_WINNERS).setRequired(true))
    .addStringOption(o => o.setName('recompense').setDescription('Type de récompense (défaut : autre = texte libre)')
      .addChoices(
        { name: 'Rôle', value: 'role' },
        { name: 'XP', value: 'xp' },
        { name: 'Autre (texte libre, remis par le staff)', value: 'autre' },
      ))
    .addRoleOption(o => o.setName('role_recompense').setDescription('Rôle offert (si recompense = rôle)'))
    .addIntegerOption(o => o.setName('xp_recompense').setDescription('XP offerte (si recompense = xp)')
      .setMinValue(1).setMaxValue(10_000_000))
    .addChannelOption(o => o.setName('salon').setDescription('Salon du drop (défaut : salon actuel)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addStringOption(o => o.setName('duree').setDescription('Expiration : 30m, 2h, 1d (défaut : aucune)')),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Cette commande ne fonctionne que sur un serveur.', flags: [MessageFlags.Ephemeral] });
    }
    if (!hasAnyRole(interaction.member, GIVEAWAY_ROLES)) {
      return interaction.reply({ content: "❌ Tu n'as pas le rôle requis pour lancer un drop.", flags: [MessageFlags.Ephemeral] });
    }

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    try {
      const opt = interaction.options;

      let durationMs = null;
      const durationInput = opt.getString('duree');
      if (durationInput) {
        durationMs = gm.parseDuration(durationInput);
        if (!durationMs || durationMs < gm.CONFIG.MIN_DURATION_MS || durationMs > gm.CONFIG.MAX_DURATION_MS) {
          return interaction.editReply('❌ Durée invalide (ex. `30m`, `2h`, `1d`), entre 1 minute et 60 jours.');
        }
      }

      const reward = gm.parseRewardOptions(interaction);
      if (reward.error) return interaction.editReply(`❌ ${reward.error}`);

      const channel = opt.getChannel('salon') ?? interaction.channel;
      const permError = gm.checkChannelPermissions(channel, interaction.guild.members.me);
      if (permError) return interaction.editReply(`❌ ${permError}`);

      const drop = await gm.createDrop(interaction.client, {
        guild: interaction.guild,
        channel,
        hostId: interaction.user.id,
        prize: opt.getString('lot'),
        ...reward,
        winnersCount: opt.getInteger('gagnants'),
        durationMs,
      });

      const link = gm.messageUrl(interaction.guild.id, channel.id, drop.message_id);
      return interaction.editReply(`✅ Drop **#${drop.id}** lancé dans ${channel}. [Voir le message](${link})`);
    } catch (err) {
      console.error('[/drop] Erreur :', err);
      return interaction.editReply('❌ Une erreur est survenue (voir les logs du bot).');
    }
  },
};
