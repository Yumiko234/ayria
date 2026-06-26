const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('userinfo')
        .setDescription('Affiche les informations d\'un utilisateur')
        .addUserOption(option =>
            option
                .setName('utilisateur')
                .setDescription('L\'utilisateur dont vous voulez voir les infos (facultatif)')
                .setRequired(false)),
    async execute(interaction) {
        const targetUser = interaction.options.getUser('utilisateur') || interaction.user;
        let targetMember = interaction.guild.members.cache.get(targetUser.id);

        if (!targetMember) {
            try {
                targetMember = await interaction.guild.members.fetch(targetUser.id);
            } catch (error) {
                return await interaction.reply({ content: 'Impossible de récupérer les membres.', flags: [MessageFlags.Ephemeral] });
            }
        }

        // --- Gestion des Badges HypeSquad ---
        const flags = (await targetUser.fetchFlags()).toArray();
        let hypesquadEmoji = "";
        if (flags.includes('HypeSquadOnlineHouse1')) hypesquadEmoji = "<:HPBravery:1490036116533805278> ";
        if (flags.includes('HypeSquadOnlineHouse2')) hypesquadEmoji = "<:HPBrillance:1490036020035715293> ";
        if (flags.includes('HypeSquadOnlineHouse3')) hypesquadEmoji = "<:HPBalance:1490036065384272023> ";

        // --- Gestion des Rôles (Mentions) ---
        const roles = targetMember.roles.cache
            .filter(role => role.name !== '@everyone')
            .map(role => `<@&${role.id}>`)
            .join(', ') || 'Aucun rôle';

        // --- Construction de l'Embed ---
        const embed = new EmbedBuilder()
            .setTitle(`${hypesquadEmoji}Infos de ${targetUser.tag}`)
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .setColor('#0099ff')
            .addFields(
                { name: '🆔 ID', value: `\`${targetUser.id}\``, inline: true },
                { name: '📅 Compte créé', value: `<t:${Math.floor(targetUser.createdTimestamp / 1000)}:R>`, inline: true },
                { name: '📥 Arrivée ici', value: `<t:${Math.floor(targetMember.joinedTimestamp / 1000)}:R>`, inline: true },
                { 
                    name: '<:FakeNitroEmoji:1519087800434167838> Abonnement Nitro', 
                    value: (targetUser.accentColor || targetUser.banner) ? `✅ Oui` : `✖️ Non`, 
                    inline: true 
                },
                { 
                    name: '<:Boost:1519270352658628698> Boosteur', 
                    value: targetMember.premiumSince ? `✅ Oui` : `✖️ Non`, 
                    inline: true 
                },
                { name: '🎭 Rôles', value: roles, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: `Demandé par ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() });

        await interaction.reply({ embeds: [embed] });
    },
};