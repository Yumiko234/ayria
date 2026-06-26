const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { computeLevel, xpForLevel } = require('../events/xpManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Affiche ton niveau et ta progression XP')
    .addUserOption(opt =>
      opt.setName('utilisateur')
        .setDescription('Voir le rang d\'un autre membre')
        .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply();

    const target = interaction.options.getUser('utilisateur') || interaction.user;
    const db     = interaction.client.db;

    const { data: profile } = await db
      .from('xp_profiles')
      .select('*')
      .eq('user_id', target.id)
      .eq('guild_id', interaction.guild.id)
      .single();

    const totalXp = profile?.xp ?? 0;
    const { level, currentXp, xpNeeded } = computeLevel(totalXp);

    // Classement
    const { data: allProfiles } = await db
      .from('xp_profiles')
      .select('user_id, xp')
      .eq('guild_id', interaction.guild.id)
      .order('xp', { ascending: false });

    const rank = (allProfiles ?? []).findIndex(p => p.user_id === target.id) + 1;

    // Barre de progression (20 blocs)
    const pct       = Math.min(currentXp / xpNeeded, 1);
    const filled    = Math.round(pct * 20);
    const bar       = '█'.repeat(filled) + '░'.repeat(20 - filled);
    const pctLabel  = Math.floor(pct * 100);

    const embed = new EmbedBuilder()
      .setTitle(`⭐ Rang de ${target.username}`)
      .setThumbnail(target.displayAvatarURL())
      .setColor('#5865F2')
      .addFields(
        { name: '🏆 Classement', value: rank > 0 ? `#${rank}` : '—',  inline: true },
        { name: '📊 Niveau',     value: `${level}`,                    inline: true },
        { name: '✨ XP total',   value: `${totalXp.toLocaleString()}`, inline: true },
        {
          name: `Progression vers le niveau ${level + 1}`,
          value: `\`${bar}\` ${pctLabel}%\n${currentXp.toLocaleString()} / ${xpNeeded.toLocaleString()} XP`,
        },
      )
      .setFooter({ text: `Il manque ${(xpNeeded - currentXp).toLocaleString()} XP pour le niveau ${level + 1}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};