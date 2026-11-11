'use strict';

const { ChannelType, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { sendLog, buildTicketEmbed, LOG_TYPES } = require('../events/logManager');
const T = require('./tickets');

/**
 * Crée un ticket (salon staff + ligne en BDD) pour un utilisateur qui a écrit au bot en MP,
 * puis y transfère les messages reçus avant le choix du type.
 *
 * @returns {Promise<{ok: true, channel, linearId, config} | {ok: false, reason: string}>}
 *   reason : 'no_guild' | 'not_member' | 'exists' | 'busy' | 'error'
 */
async function openTicketFromDM(client, user, typeKey) {
  const config = T.TICKET_TYPES[typeKey];
  if (!config) return { ok: false, reason: 'error' };

  const guild = T.getTargetGuild(client);
  if (!guild) return { ok: false, reason: 'no_guild' };

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return { ok: false, reason: 'not_member' };

  if (T.creating.has(user.id)) return { ok: false, reason: 'busy' };
  T.creating.add(user.id);

  const db = client.db;
  let ticketChannel = null;

  try {
    if (await T.getActiveTicketByUser(db, user.id)) return { ok: false, reason: 'exists' };

    const categoryOpen = await T.getOpenCategory(guild);
    const staffRole = T.getStaffRole(guild);

    // L'utilisateur n'est PAS dans le salon : seuls le staff et le bot y accèdent.
    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks] },
    ];
    if (staffRole?.id) {
      overwrites.push({ id: staffRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
    }

    // Numérotation linéaire par type (comme avant)
    const { count, error: countError } = await db
      .from('tickets')
      .select('*', { count: 'exact', head: true })
      .eq('type', config.label);
    if (countError) {
      console.error('[Supabase] Erreur count ticket :', countError.message);
      return { ok: false, reason: 'error' };
    }
    const linearId = String((count || 0) + 1).padStart(4, '0');

    ticketChannel = await guild.channels.create({
      name: `${config.prefix}-${linearId}`,
      type: ChannelType.GuildText,
      parent: categoryOpen.id,
      topic: `Ticket MP de ${user.username} (${user.id})`,
      permissionOverwrites: overwrites,
    });

    // La BDD pilote le routage des MP : si l'insertion échoue, on annule tout.
    const { error: insertError } = await db.from('tickets').insert({
      ticket_id: ticketChannel.id,
      type: config.label,
      author_id: user.id,
      status: 'Ouvert',
      created_at: new Date().toISOString(),
    });
    if (insertError) {
      console.error('[Supabase] Erreur insertion ticket :', insertError.message);
      await ticketChannel.delete('Insertion BDD échouée').catch(() => {});
      return { ok: false, reason: 'error' };
    }

    // Embed de contrôle (l'ordre des champs compte : Statut = index 2)
    const embed = new EmbedBuilder()
      .setTitle(`🎫 Ticket N°${linearId} — ${config.label}`)
      .setDescription([
        `Ticket ouvert par MP par ${user}.`,
        '',
        '• Tout message écrit ici est **transmis en MP** à l\'utilisateur.',
        `• Commence ton message par \`${T.INTERNAL_PREFIX}\` pour une note interne (non transmise).`,
      ].join('\n'))
      .setColor(T.COLOR)
      .addFields(
        { name: 'Auteur', value: `${user.tag} (<@${user.id}>)`, inline: true },
        { name: 'Type', value: config.label, inline: true },
        { name: 'Statut', value: '🔓 Ouvert / Non pris en charge', inline: true },
      )
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_claim').setLabel('🙋‍♂️ Claim').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('ticket_close').setLabel('🔒 Fermer').setStyle(ButtonStyle.Danger),
    );
    await ticketChannel.send({ embeds: [embed], components: [row], allowedMentions: { parse: [] } });

    // Transfert des messages envoyés avant le choix du type (boucle : d'autres ont pu arriver entre-temps)
    for (let i = 0; i < 3 && T.pending.has(user.id); i++) {
      const entry = T.pending.get(user.id);
      T.pending.delete(user.id);
      for (const m of entry.messages) {
        try {
          await ticketChannel.send({
            embeds: [T.buildUserRelayEmbed(user, m.content, m.attachments)],
            allowedMentions: { parse: [] },
          });
        } catch (err) {
          console.error('[Tickets] Relais message initial :', err.message);
        }
      }
    }

    // Un échec de log (salon de logs absent/inaccessible) ne doit pas annuler le ticket
    try {
      await sendLog(guild, LOG_TYPES.TICKET, buildTicketEmbed('open', ticketChannel, user, linearId, { targetUserId: user.id }));
    } catch (err) {
      console.error('[Tickets] Log d\'ouverture :', err.message);
    }

    return { ok: true, channel: ticketChannel, linearId, config };
  } catch (err) {
    console.error('[Tickets] Erreur création ticket MP :', err);
    if (ticketChannel) {
      // Ne pas laisser une ligne « Ouvert » orpheline : elle bloquerait l'utilisateur
      try { await db.from('tickets').update({ status: 'Supprimé' }).eq('ticket_id', ticketChannel.id); } catch { /* best effort */ }
      await ticketChannel.delete('Erreur pendant la création').catch(() => {});
    }
    return { ok: false, reason: 'error' };
  } finally {
    T.creating.delete(user.id);
  }
}

module.exports = { openTicketFromDM };
