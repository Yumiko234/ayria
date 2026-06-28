const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('modlogs')
    .setDescription("Affiche l'historique des sanctions d'un utilisateur")
    .addUserOption(option =>
      option.setName('utilisateur')
        .setDescription("L'utilisateur dont on veut voir l'historique")
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const user = interaction.options.getUser('utilisateur');
    const db   = interaction.client.db;

    // Récupère le display name du membre sur le serveur
    let displayName = user.displayName;
    try {
      const member = await interaction.guild.members.fetch(user.id);
      displayName  = member.displayName;
    } catch { /* absent du serveur */ }

    const { data: rows, error } = await db
      .from('sanctions')
      .select('*')
      .eq('user_id', user.id)
      .eq('guild_id', interaction.guild.id)
      .order('id', { ascending: true });

    if (error) {
      console.error('Supabase (modlogs) :', error.message);
      return interaction.reply({
        content: "Erreur lors de la récupération de l'historique.",
        flags: [MessageFlags.Ephemeral]
      });
    }

    if (!rows || rows.length === 0) {
      return interaction.reply({
        content: `Aucune sanction trouvée pour **${displayName}**.`,
        flags: [MessageFlags.Ephemeral]
      });
    }

    // Chaque sanction sur deux lignes courtes pour que les mentions passent bien
    const lines = rows.map(row => {
      const timestamp = Math.floor(new Date(row.date).getTime() / 1000);
      const mod       = row.moderator_id ? `<@${row.moderator_id}>` : 'Automatique';
      return `**[#${row.id}] \`${row.type}\`** — <t:${timestamp}:d> par ${mod}\n↳ ${row.raison}`;
    });

    // Discord limite la description à 4096 chars — on pagine si nécessaire
    const MAX_LENGTH = 4000;
    const pages = [];
    let current  = '';

    for (const line of lines) {
      if ((current + '\n\n' + line).length > MAX_LENGTH) {
        pages.push(current);
        current = line;
      } else {
        current = current ? current + '\n\n' + line : line;
      }
    }
    if (current) pages.push(current);

    const embeds = pages.map((page, i) =>
      new EmbedBuilder()
        .setTitle(i === 0 ? `📋 Sanctions de ${displayName} (${rows.length})` : `📋 Sanctions de ${displayName} (suite)`)
        .setColor('#ff0000')
        .setDescription(page)
        .setFooter({ text: `Utilisateur ID : ${user.id}` })
    );

    await interaction.reply({ embeds: embeds.slice(0, 10) }); // max 10 embeds par message
  },
};