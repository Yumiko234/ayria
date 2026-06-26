const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { computeLevel } = require('../events/xpManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Affiche le top 10 des membres par XP'),

  async execute(interaction) {
    await interaction.deferReply();
    const db = interaction.client.db;

    const { data: rows, error } = await db
      .from('xp_profiles')
      .select('user_id, xp')
      .eq('guild_id', interaction.guild.id)
      .order('xp', { ascending: false })
      .limit(10);

    if (error || !rows?.length) {
      return interaction.editReply('Aucune donnée XP disponible pour ce serveur.');
    }

    const medals = ['🥇', '🥈', '🥉'];

    const lines = await Promise.all(rows.map(async (row, i) => {
      const { level } = computeLevel(row.xp);
      let tag = `<@${row.user_id}>`;
      try {
        const user = await interaction.client.users.fetch(row.user_id);
        tag = user.tag;
      } catch { /* utilisateur introuvable */ }

      const medal = medals[i] ?? `**${i + 1}.**`;
      return `${medal} ${tag} — Niv. **${level}** · ${row.xp.toLocaleString()} XP`;
    }));

    const embed = new EmbedBuilder()
      .setTitle(`🏆 Classement XP — ${interaction.guild.name}`)
      .setColor('#FFD700')
      .setDescription(lines.join('\n'))
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};