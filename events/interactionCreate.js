const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { sendLog, buildTicketEmbed, LOG_TYPES } = require('./logManager');
const T = require('../utils/tickets');
const { openTicketFromDM } = require('../utils/ticketService');
const { sendDM } = require('../utils/dm');

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

        // 🛡️ Ce bloc ne doit JAMAIS relancer d'exception : une interaction déjà
        // expirée (10062) ou déjà acquittée (40060) ne doit pas faire planter le bot.
        try {
          if (interaction.deferred) {
            await interaction.editReply({
              content: 'Une erreur est survenue lors de l\'exécution de la commande !',
            });
          } else if (!interaction.replied) {
            await interaction.reply({
              content: 'Une erreur est survenue lors de l\'exécution de la commande !',
              flags: [MessageFlags.Ephemeral],
            });
          }
        } catch (replyError) {
          console.error(`[Erreur Commande ${interaction.commandName}] Impossible d'informer l'utilisateur (interaction probablement expirée) :`, replyError.message);
        }
      }
      return;
    }

    // ── 2. GESTION DES BOUTONS (TICKETS PAR MP) ───────────────────────────────
    if (!interaction.isButton()) return;

    const { customId, guild, user, channel } = interaction;

    // 📩 A. CHOIX DU TYPE DANS LE MP -> CRÉATION DU TICKET
    if (customId.startsWith('dmticket:')) {
      if (interaction.inGuild()) return; // ces boutons n'existent qu'en MP
      await interaction.deferUpdate();

      const typeKey = customId.split(':')[1];
      const result = await openTicketFromDM(client, user, typeKey);

      if (!result.ok) {
        const reasons = {
          exists:     "Tu as déjà un ticket ouvert : écris simplement ici, tes messages lui sont transmis.",
          busy:       "Ton ticket est en cours de création, patiente quelques secondes.",
          not_member: "Tu dois être membre du serveur pour ouvrir un ticket.",
          no_guild:   "Le serveur est introuvable pour le moment. Réessaie plus tard.",
          error:      "Une erreur est survenue lors de la création du ticket. Réessaie dans un instant.",
        };
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor('#FF2222').setDescription(`❌ ${reasons[result.reason] ?? reasons.error}`)],
          components: [],
        }).catch(() => {});
      }

      const confirm = new EmbedBuilder()
        .setColor(T.COLOR)
        .setTitle(`✅ Ticket N°${result.linearId} ouvert — ${result.config.label}`)
        .setDescription([
          "Ton message a été transmis à l'équipe. Tu peux continuer à écrire ici : tout sera transmis à l'équipe, et leurs réponses arriveront dans ce MP.",
          '',
          "⚠️ L'équipe de modération étant entièrement bénévole, merci de bien vouloir excuser les potentiels délais de réponse.",
        ].join('\n'))
        .setTimestamp();
      return interaction.editReply({ embeds: [confirm], components: [] }).catch(() => {});
    }

    // ♻️ Anciens panneaux : les boutons d'ouverture du salon Support n'existent plus
    if (['open_request', 'open_application', 'open_partnership'].includes(customId)) {
      return interaction.reply({
        content: `📩 Les tickets s'ouvrent désormais **par message privé** : envoie un MP à <@${client.user.id}> et choisis le type de ticket.`,
        flags: [MessageFlags.Ephemeral],
      });
    }

    // Les boutons ci-dessous sont réservés aux salons de tickets (serveur)
    if (!guild) return;

    // 🙋‍♂️ B. SYSTÈME DE CLAIM / UNCLAIM
    if (customId === 'ticket_claim' || customId === 'ticket_unclaim') {
      await interaction.deferUpdate();

      const ticket = await T.getTicketByChannel(supabase, channel.id);
      if (!ticket) {
        return interaction.followUp({ content: '❌ Ce salon n\'est lié à aucun ticket en base de données.', flags: [MessageFlags.Ephemeral] });
      }

      const isClaim = customId === 'ticket_claim';
      const staffRole = T.getStaffRole(guild);
      const targetUserId = ticket.author_id;

      const originalMessage = interaction.message;
      const receivedEmbed = originalMessage.embeds[0];
      if (!receivedEmbed) return;

      const updatedEmbed = EmbedBuilder.from(receivedEmbed);
      const updatedRow = ActionRowBuilder.from(originalMessage.components[0]);

      const botAccess = { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks] };
      const staffAccess = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory];

      if (isClaim) {
        const overwrites = [
          { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          botAccess,
          { id: user.id, allow: staffAccess },
        ];
        if (staffRole?.id) overwrites.push({ id: staffRole.id, deny: [PermissionFlagsBits.ViewChannel] });

        await channel.permissionOverwrites.set(overwrites);
        await supabase.from('tickets').update({ status: `Pris en charge par ${user.id}` }).eq('ticket_id', channel.id);

        updatedEmbed.spliceFields(2, 1, { name: 'Statut', value: `🎯 Pris en charge par <@${user.id}>`, inline: true });
        updatedRow.components[0] = new ButtonBuilder().setCustomId('ticket_unclaim').setLabel('🤷‍♂️ Unclaim').setStyle(ButtonStyle.Secondary);

        await channel.send({ content: `🙋‍♂️ **${user.username}** a pris en charge le ticket. Les autres modérateurs n'y ont plus accès.`, allowedMentions: { parse: [] } });
      } else {
        const overwrites = [
          { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          botAccess,
        ];
        if (staffRole?.id) overwrites.push({ id: staffRole.id, allow: staffAccess });

        await channel.permissionOverwrites.set(overwrites);
        await supabase.from('tickets').update({ status: 'Ouvert' }).eq('ticket_id', channel.id);

        updatedEmbed.spliceFields(2, 1, { name: 'Statut', value: '🔓 Ouvert / Non pris en charge', inline: true });
        updatedRow.components[0] = new ButtonBuilder().setCustomId('ticket_claim').setLabel('🙋‍♂️ Claim').setStyle(ButtonStyle.Success);

        await channel.send({ content: `🤷‍♂️ **${user.username}** s'est retiré du ticket. L'équipe complète peut à nouveau intervenir.`, allowedMentions: { parse: [] } });
      }

      await originalMessage.edit({ embeds: [updatedEmbed], components: [updatedRow] });

      const ticketNumberClaim = channel.name.split('-').pop();
      await sendLog(guild, LOG_TYPES.TICKET, buildTicketEmbed(isClaim ? 'claim' : 'unclaim', channel, user, ticketNumberClaim, { targetUserId }));
    }

    // 🔒 C. FERMETURE ET ARCHIVAGE DU TICKET
    if (customId === 'ticket_close') {
      await interaction.deferUpdate();

      const ticket = await T.getTicketByChannel(supabase, channel.id);
      const targetUserId = ticket?.author_id;

      const categoryClose = await T.getClosedCategory(guild);
      const staffRole = T.getStaffRole(guild);
      const closeOverwrites = [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks] },
      ];
      if (staffRole?.id) {
        closeOverwrites.push({ id: staffRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] });
      }

      await channel.edit({ parent: categoryClose.id, permissionOverwrites: closeOverwrites });
      await supabase.from('tickets').update({ status: 'Fermé' }).eq('ticket_id', channel.id);

      const originalMessage = interaction.message;
      const receivedEmbed = originalMessage.embeds[0];
      if (!receivedEmbed) return;

      const updatedEmbed = EmbedBuilder.from(receivedEmbed).spliceFields(2, 1, { name: 'Statut', value: '🔒 Fermé / Archivé', inline: true });
      const updatedRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_reopen').setLabel('🔓 Réouvrir').setStyle(ButtonStyle.Secondary),
      );

      await originalMessage.edit({ embeds: [updatedEmbed], components: [updatedRow] });
      await channel.send({ content: '🔒 **Ticket fermé et archivé.** La commande `/ticket-transcript` est désormais accessible ici.' });

      // ✉️ Prévenir l'utilisateur en MP
      if (targetUserId) {
        const dmOk = await sendDM(client, targetUserId, {
          embeds: [new EmbedBuilder()
            .setColor('#FF8800')
            .setTitle('🔒 Ticket fermé')
            .setDescription("Ton ticket a été fermé par l'équipe. Si tu as besoin d'autre chose, envoie-moi simplement un nouveau message pour en ouvrir un autre.")
            .setTimestamp()],
        });
        if (!dmOk) await channel.send({ content: "⚠️ L'utilisateur n'a pas pu être prévenu en MP (MP fermés).", allowedMentions: { parse: [] } });
      }

      const ticketNumber = channel.name.split('-').pop();
      await sendLog(guild, LOG_TYPES.TICKET, buildTicketEmbed('close', channel, user, ticketNumber, { targetUserId }));
    }

    // 🔓 D. RÉOUVERTURE D'UN TICKET ARCHIVÉ
    if (customId === 'ticket_reopen') {
      await interaction.deferUpdate();

      const ticket = await T.getTicketByChannel(supabase, channel.id);
      if (!ticket) {
        return interaction.followUp({ content: '❌ Ce salon n\'est lié à aucun ticket en base de données.', flags: [MessageFlags.Ephemeral] });
      }
      const targetUserId = ticket.author_id;

      // Un seul ticket actif par utilisateur : on refuse si un autre est déjà ouvert
      const other = await T.getActiveTicketByUser(supabase, targetUserId);
      if (other && other.ticket_id !== channel.id) {
        return interaction.followUp({
          content: `❌ Cet utilisateur a déjà un ticket actif : <#${other.ticket_id}>. Ferme-le avant de réouvrir celui-ci.`,
          flags: [MessageFlags.Ephemeral],
        });
      }

      const categoryOpen = await T.getOpenCategory(guild);
      const staffRole = T.getStaffRole(guild);
      const originalMessage = interaction.message;
      const receivedEmbed = originalMessage.embeds[0];
      if (!receivedEmbed) return;

      const openOverwrites = [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks] },
      ];
      if (staffRole?.id) {
        openOverwrites.push({ id: staffRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
      }

      await channel.edit({ parent: categoryOpen.id, permissionOverwrites: openOverwrites });
      await supabase.from('tickets').update({ status: 'Ouvert' }).eq('ticket_id', channel.id);

      const updatedEmbed = EmbedBuilder.from(receivedEmbed).spliceFields(2, 1, { name: 'Statut', value: '🔓 Ouvert / Non pris en charge', inline: true });
      const updatedRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_claim').setLabel('🙋‍♂️ Claim').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('ticket_close').setLabel('🔒 Fermer').setStyle(ButtonStyle.Danger),
      );

      await originalMessage.edit({ embeds: [updatedEmbed], components: [updatedRow] });
      await channel.send({ content: '🔓 **Ticket réouvert.** Les messages écrits ici sont de nouveau transmis en MP.' });

      const dmOk = await sendDM(client, targetUserId, {
        embeds: [new EmbedBuilder()
          .setColor('#00CC66')
          .setTitle('🔓 Ticket réouvert')
          .setDescription("Ton ticket a été réouvert par l'équipe. Tu peux y répondre directement dans ce MP.")
          .setTimestamp()],
      });
      if (!dmOk) await channel.send({ content: "⚠️ L'utilisateur n'a pas pu être prévenu en MP (MP fermés).", allowedMentions: { parse: [] } });

      const ticketNumberReopen = channel.name.split('-').pop();
      await sendLog(guild, LOG_TYPES.TICKET, buildTicketEmbed('reopen', channel, user, ticketNumberReopen, { targetUserId }));
    }
  },
};
