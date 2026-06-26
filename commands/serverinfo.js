const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('serverinfo')
        .setDescription('Affiche des informations détaillées sur le serveur.'),

    async execute(interaction) {
        const { guild } = interaction;
        const { members, channels, roles, emojis } = guild;

        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle(`Information sur le serveur : ${guild.name}`)
            .setThumbnail(guild.iconURL({ dynamic: true }))
            .addFields(
                { name: '🆔 ID du serveur', value: guild.id, inline: true },
                { name: '👑 Propriétaire', value: `<@${guild.ownerId}>`, inline: true },
                { name: '📅 Créé le', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
                { 
                    name: '👥 Membres', 
                    value: `Total: **${guild.memberCount}**`, 
                    inline: true 
                },
                { 
                    name: '💬 Salons', 
                    value: `Texte: **${channels.cache.filter(c => c.type === 0).size}**\nVocaux: **${channels.cache.filter(c => c.type === 2).size}**`, 
                    inline: true 
                },
                { 
                    name: '<:Boost:1519270352658628698> Boosts', 
                    value: `Niveau: **${guild.premiumTier}** (${guild.premiumSubscriptionCount} boosts)`, 
                    inline: true 
                },
                { name: '🛡️ Rôles', value: `${roles.cache.size}`, inline: true },
                { name: '😀 Emojis', value: `${emojis.cache.size}`, inline: true }
            )
            .setFooter({ text: `Requête de ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
};