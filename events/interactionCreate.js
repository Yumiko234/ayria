const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    const { client } = interaction;
    const supabase = client.db;
    
    // ── 1. GESTION DES COMMANDES SLASH ────────────────────────────────────────
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      if (interaction.commandName === 'ticket-transcript') {
        if (interaction.channel.parent && interaction.channel.parent.name.toLowerCase() !== 'tickets fermés') {
          return interaction.reply({ 
            content: '❌ La commande `/ticket-transcript` ne peut être utilisée que dans un ticket archivé dans la catégorie **Tickets fermés**.', 
            flags: [MessageFlags.Ephemeral] 
          });
        }
      }

      try {
        await command.execute(interaction, client);
      } catch (error) {
        console.error(`[Erreur Commande ${interaction.commandName}] :`, error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ 
            content: 'Une erreur est survenue lors de l\'exécution de la commande !', 
            flags: [MessageFlags.Ephemeral] 
          });
        }
      }
      return;
    }

    // ── 2. GESTION DES BOUTONS (TICKETS) ──────────────────────────────────────
    if (!interaction.isButton()) return;

    const { customId, guild, user, channel } = interaction;

    const ticketTypes = {
      open_request:     { prefix: 'ticket-qs',         label: 'Question / Signalement' },
      open_application: { prefix: 'ticket-candi',      label: 'Recrutement Staff' },
      open_partnership: { prefix: 'ticket-partenariat', label: 'Partenariat' }
    };

    // 📂 A. CRÉATION DU TICKET
    if (ticketTypes[customId]) {
      // 🛡️ Sécurisation immédiate de l'interaction (Évite l'erreur 10062)
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

      const config = ticketTypes[customId];
      
      // 🔍 Recherche robuste de la catégorie (Cache puis API Discord)
      let categoryOpen = guild.channels.cache.find(c => c.name.toLowerCase() === 'tickets ouvert' && c.type === ChannelType.GuildCategory);
      if (!categoryOpen) {
        const fetchedChannels = await guild.channels.fetch();
        categoryOpen = fetchedChannels.find(c => c.name.toLowerCase() === 'tickets ouvert' && c.type === ChannelType.GuildCategory);
        if (!categoryOpen) {
          categoryOpen = await guild.channels.create({ name: 'Tickets ouvert', type: ChannelType.GuildCategory });
        }
      }

      const staffRole = guild.roles.cache.find(r => r.permissions.has(PermissionFlagsBits.ManageMessages));

      const baseOverwrites = [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
      ];

      if (staffRole && staffRole.id) {
        baseOverwrites.push({ 
          id: staffRole.id, 
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] 
        });
      }

      // 🔢 Récupération sécurisée du nombre de tickets existants pour ce type précis
      const { count, error: countError } = await supabase
        .from('tickets')
        .select('*', { count: 'exact', head: true })
        .eq('type', config.label);

      if (countError) {
        console.error('[Supabase] Erreur count ticket :', countError.message);
        return interaction.editReply('❌ Une erreur est survenue lors de la configuration du numéro de votre ticket.');
      }

      const nextNumber = (count || 0) + 1;
      const linearId = String(nextNumber).padStart(4, '0');

      // 🏢 Création du salon textuel avec ID linéaire par type
      const ticketChannel = await guild.channels.create({
        name: `${config.prefix}-${linearId}`,
        type: ChannelType.GuildText,
        parent: categoryOpen.id,
        permissionOverwrites: baseOverwrites
      });

      // 💾 Insertion des données finales dans Supabase
      const { error: insertError } = await supabase
        .from('tickets')
        .insert({
          ticket_id: ticketChannel.id, 
          type: config.label,
          author_id: user.id,
          status: 'Ouvert',
          created_at: new Date().toISOString()
        });

      if (insertError) {
        console.error('[Supabase] Erreur insertion ticket :', insertError.message);
      }

      const embed = new EmbedBuilder()
        .setTitle(`🎫 Ticket N°${linearId} — ${config.label}`)
        .setDescription(`Bonjour ${user}, bienvenue dans ton ticket.\nUn membre de l'équipe de modération va te prendre en charge sous peu.\n\nMerci de détailler au maximum ta demande en attendant.`)
        .setColor('#9f00f5')
        .addFields(
          { name: 'Auteur', value: `${user.tag} (<@${user.id}>)`, inline: true },
          { name: 'Type', value: config.label, inline: true },
          { name: 'Statut', value: '🔓 Ouvert / Non pris en charge', inline: true }
        )
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_claim').setLabel('🙋‍♂️ Claim').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('ticket_close').setLabel('🔒 Fermer').setStyle(ButtonStyle.Danger)
      );

      await ticketChannel.send({ embeds: [embed], components: [row] });
      return interaction.editReply(`✅ Votre ticket a été créé avec succès : <#${ticketChannel.id}>`);
    }

    // 🙋‍♂️ B. SYSTÈME DE CLAIM / UNCLAIM
    if (customId === 'ticket_claim' || customId === 'ticket_unclaim') {
      // 🛡️ Sécurisation immédiate de l'interaction (Évite l'erreur 10062)
      await interaction.deferUpdate();

      const isClaim = customId === 'ticket_claim';
      const staffRole = guild.roles.cache.find(r => r.permissions.has(PermissionFlagsBits.ManageMessages));
      
      const originalMessage = interaction.message;
      const receivedEmbed = originalMessage.embeds[0];
      if (!receivedEmbed) return;

      const updatedEmbed = EmbedBuilder.from(receivedEmbed);
      const updatedRow = ActionRowBuilder.from(originalMessage.components[0]);
      const targetUserId = receivedEmbed.fields[0].value.split('(')[1].replace(/[^\d]/g, '');

      if (isClaim) {
        const overwrites = [
          { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: targetUserId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
        ];

        if (staffRole && staffRole.id) {
          overwrites.push({ id: staffRole.id, deny: [PermissionFlagsBits.ViewChannel] });
        }

        await channel.permissionOverwrites.set(overwrites);

        await supabase
          .from('tickets')
          .update({ status: `Pris en charge par ${user.id}` })
          .eq('ticket_id', channel.id);

        updatedEmbed.spliceFields(2, 1, { name: 'Statut', value: `🎯 Pris en charge par <@${user.id}>`, inline: true });
        updatedRow.components[0] = new ButtonBuilder().setCustomId('ticket_unclaim').setLabel('🤷‍♂️ Unclaim').setStyle(ButtonStyle.Secondary);
        
        await channel.send({ content: `🙋‍♂️ **${user.username}** a pris en charge le ticket. Les autres modérateurs n'y ont plus accès.` });
      } else {
        const overwrites = [
          { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: targetUserId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
        ];

        if (staffRole && staffRole.id) {
          overwrites.push({ id: staffRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
        }

        await channel.permissionOverwrites.set(overwrites);

        await supabase
          .from('tickets')
          .update({ status: 'Ouvert' })
          .eq('ticket_id', channel.id);

        updatedEmbed.spliceFields(2, 1, { name: 'Statut', value: '🔓 Ouvert / Non pris en charge', inline: true });
        updatedRow.components[0] = new ButtonBuilder().setCustomId('ticket_claim').setLabel('🙋‍♂️ Claim').setStyle(ButtonStyle.Success);
        
        await channel.send({ content: `🤷‍♂️ **${user.username}** s'est retiré du ticket. L'équipe complète peut à nouveau intervenir.` });
      }

      await originalMessage.edit({ embeds: [updatedEmbed], components: [updatedRow] });
    }

    // 🔒 C. FERMETURE ET ARCHIVAGE DU TICKET
    if (customId === 'ticket_close') {
      // 🛡️ Sécurisation immédiate de l'interaction (Évite l'erreur 10062)
      await interaction.deferUpdate();

      // 🔍 Recherche robuste de la catégorie de fermeture
      let categoryClose = guild.channels.cache.find(c => c.name.toLowerCase() === 'tickets fermés' && c.type === ChannelType.GuildCategory);
      if (!categoryClose) {
        const fetchedChannels = await guild.channels.fetch();
        categoryClose = fetchedChannels.find(c => c.name.toLowerCase() === 'tickets fermés' && c.type === ChannelType.GuildCategory);
        if (!categoryClose) {
          categoryClose = await guild.channels.create({ name: 'Tickets fermés', type: ChannelType.GuildCategory });
        }
      }

      const staffRole = guild.roles.cache.find(r => r.permissions.has(PermissionFlagsBits.ManageMessages));
      const closeOverwrites = [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }
      ];

      if (staffRole && staffRole.id) {
        closeOverwrites.push({ id: staffRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] });
      }

      await channel.edit({
        parent: categoryClose.id,
        permissionOverwrites: closeOverwrites
      });

      await supabase
        .from('tickets')
        .update({ status: 'Fermé' })
        .eq('ticket_id', channel.id);

      const originalMessage = interaction.message;
      const receivedEmbed = originalMessage.embeds[0];
      if (!receivedEmbed) return;

      const updatedEmbed = EmbedBuilder.from(receivedEmbed)
        .spliceFields(2, 1, { name: 'Statut', value: '🔒 Fermé / Archivé', inline: true });

      const updatedRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_reopen').setLabel('🔓 Réouvrir').setStyle(ButtonStyle.Secondary)
      );

      await originalMessage.edit({ embeds: [updatedEmbed], components: [updatedRow] });
      await channel.send({ content: '🔒 **Ticket fermé et archivé.** La commande `/ticket-transcript` est désormais accessible ici.' });
    }

    // 🔓 D. RÉOUVERTURE D'UN TICKET ARCHIVÉ
    if (customId === 'ticket_reopen') {
      // 🛡️ Sécurisation immédiate de l'interaction (Évite l'erreur 10062)
      await interaction.deferUpdate();

      // 🔍 Recherche robuste de la catégorie d'ouverture
      let categoryOpen = guild.channels.cache.find(c => c.name.toLowerCase() === 'tickets ouvert' && c.type === ChannelType.GuildCategory);
      if (!categoryOpen) {
        const fetchedChannels = await guild.channels.fetch();
        categoryOpen = fetchedChannels.find(c => c.name.toLowerCase() === 'tickets ouvert' && c.type === ChannelType.GuildCategory);
        if (!categoryOpen) {
          categoryOpen = await guild.channels.create({ name: 'Tickets ouvert', type: ChannelType.GuildCategory });
        }
      }

      const staffRole = guild.roles.cache.find(r => r.permissions.has(PermissionFlagsBits.ManageMessages));
      const originalMessage = interaction.message;
      const receivedEmbed = originalMessage.embeds[0];
      if (!receivedEmbed) return;

      const targetUserId = receivedEmbed.fields[0].value.split('(')[1].replace(/[^\d]/g, '');

      const openOverwrites = [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: targetUserId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
      ];

      if (staffRole && staffRole.id) {
        openOverwrites.push({ id: staffRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
      }

      await channel.edit({
        parent: categoryOpen.id,
        permissionOverwrites: openOverwrites
      });

      await supabase
        .from('tickets')
        .update({ status: 'Ouvert' })
        .eq('ticket_id', channel.id);

      const updatedEmbed = EmbedBuilder.from(receivedEmbed)
        .spliceFields(2, 1, { name: 'Statut', value: '🔓 Ouvert / Non pris en charge', inline: true });

      const updatedRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_claim').setLabel('🙋‍♂️ Claim').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('ticket_close').setLabel('🔒 Fermer').setStyle(ButtonStyle.Danger)
      );

      await originalMessage.edit({ embeds: [updatedEmbed], components: [updatedRow] });
      await channel.send({ content: '🔓 **Ticket réouvert.** Tout le monde retrouve ses accès d\'origine.' });
    }
  },
};