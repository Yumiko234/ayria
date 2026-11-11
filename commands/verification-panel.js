const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, MessageFlags } = require('discord.js');
const C = require('../utils/verificationConfig');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verification-panel')
    .setDescription('Publie le message de vérification dans le salon dédié')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    if (interaction.guildId !== C.GUILD_ID) {
      return interaction.editReply('❌ Le système de vérification n\'est configuré que pour le serveur officiel.');
    }

    const channel = await interaction.guild.channels.fetch(C.CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased()) {
      return interaction.editReply('❌ Salon de vérification introuvable (vérifie `CHANNEL_ID` dans `utils/verificationConfig.js`).');
    }

    const embed = new EmbedBuilder()
      .setColor(C.COLOR)
      .setTitle('Vérification')
      .setDescription([
        'Pour accéder au serveur, clique sur le bouton ci-dessous et résous un **calcul simple**.',
        '',
        '• Ton compte Discord doit avoir au moins **3 jours**.',
        '• Tu as **3 essais** par question.',
        '• Après 3 erreurs, une **nouvelle question** est posée (3 nouveaux essais).',
        '• Si tu échoues encore, tu seras **expulsé** du serveur (tu pourras le rejoindre à nouveau).',
      ].join('\n'))
      .setFooter({ text: 'AYRIA' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('verif:start').setLabel('Se vérifier').setStyle(ButtonStyle.Success),
    );

    try {
      await channel.send({ embeds: [embed], components: [row] });
      await interaction.editReply(`✅ Message de vérification publié dans <#${C.CHANNEL_ID}>.`);
    } catch (err) {
      console.error('[Vérification] Publication du panneau :', err.message);
      await interaction.editReply('❌ Impossible de publier dans ce salon (permissions du bot ?).');
    }
  },
};
