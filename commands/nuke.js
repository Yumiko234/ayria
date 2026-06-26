const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('nuke')
        .setDescription('Supprime et recrée ce salon pour effacer tous les messages.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels), 

    async execute(interaction) {
        const { channel, guild } = interaction;

        // On récupère la position actuelle pour remettre le salon au même endroit
        const position = channel.position;

        try {
            // On clone le salon avec les mêmes paramètres
            const newChannel = await channel.clone({
                reason: `Nuke demandé par ${interaction.user.tag}`
            });

            // On place le nouveau salon à l'ancienne position
            await newChannel.setPosition(position);

            // On supprime l'ancien salon
            await channel.delete(`Nuke par ${interaction.user.tag}`);

            // On envoie un message de confirmation dans le NOUVEAU salon
            const embed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('💥 Salon Nucléarisé')
                .setDescription('Tous les messages ont été supprimés.')
                .setImage('https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExM2I1ejR4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4JmVwPXYxX2ludGVybmFsX2dpZl9ieV9pZCZjdD1n/HhTXt43pk1I1W/giphy.gif') // Optionnel : un petit GIF d'explosion
                .setFooter({ text: `Action effectuée par ${interaction.user.tag}` })
                .setTimestamp();

            await newChannel.send({ embeds: [embed] });

        } catch (error) {
            console.error('Erreur lors du nuke :', error);
            if (!interaction.replied) {
                await interaction.reply({ 
                    content: 'Une erreur est survenue lors de la tentative de nuke.', 
                    ephemeral: true 
                });
            }
        }
    },
};