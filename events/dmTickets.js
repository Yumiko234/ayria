'use strict';

const T = require('../utils/tickets');
const { sendDM } = require('../utils/dm');

/**
 * Tickets par MP.
 *  - MP reçu par le bot  -> ticket existant : relais vers le salon staff ;
 *                           sinon : choix du type (boutons), puis création du ticket.
 *  - Message staff dans un salon de « Tickets ouvert » -> relais en MP à l'auteur du ticket.
 */
module.exports = {
  name: 'messageCreate',

  async execute(message, client) {
    if (message.author.bot || message.system || message.webhookId) return;
    if (message.guild) return handleStaffMessage(message, client);
    return handleUserDM(message, client);
  },
};

// ─── Staff -> utilisateur ────────────────────────────────────────────────────
async function handleStaffMessage(message, client) {
  const { channel } = message;
  if (!channel.parent || channel.parent.name.toLowerCase() !== T.CATEGORY_OPEN) return;

  const content = message.content?.trim() ?? '';
  if (content.startsWith(T.INTERNAL_PREFIX)) return; // note interne
  const attachments = [...message.attachments.values()];
  if (!content && attachments.length === 0) return;

  const ticket = await T.getActiveTicketByChannel(client.db, channel.id);
  if (!ticket) return;

  const delivered = await sendDM(client, ticket.author_id, {
    embeds: [T.buildStaffRelayEmbed(message.author, content, attachments)],
  });

  await message.react(delivered ? '✅' : '❌').catch(() => {});
  if (!delivered) {
    await channel.send({
      content: "⚠️ Impossible d'envoyer ce message en MP : l'utilisateur a fermé ses MP ou ne partage plus de serveur avec le bot.",
      allowedMentions: { parse: [] },
    }).catch(() => {});
  }
}

// ─── Utilisateur -> staff ────────────────────────────────────────────────────
async function handleUserDM(message, client) {
  const user = message.author;
  const db = client.db;
  const attachments = [...message.attachments.values()];
  const content = message.content ?? '';
  if (!content.trim() && attachments.length === 0) return;

  const guild = T.getTargetGuild(client);
  if (!guild) return;

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) {
    return message.reply('❌ Tu dois être membre du serveur **' + guild.name + '** pour ouvrir un ticket.').catch(() => {});
  }

  // 1. Ticket déjà ouvert -> relais direct
  const ticket = await T.getActiveTicketByUser(db, user.id);
  if (ticket) {
    const ticketChannel = await guild.channels.fetch(ticket.ticket_id).catch(() => null);
    if (ticketChannel) {
      try {
        await ticketChannel.send({
          embeds: [T.buildUserRelayEmbed(user, content, attachments)],
          allowedMentions: { parse: [] },
        });
        return void message.react('✅').catch(() => {});
      } catch (err) {
        console.error('[Tickets] Relais MP -> salon :', err.message);
        return void message.react('❌').catch(() => {});
      }
    }
    // Salon supprimé à la main : on marque le ticket comme supprimé et on repart sur un nouveau ticket
    await db.from('tickets').update({ status: 'Supprimé' }).eq('ticket_id', ticket.ticket_id);
  }

  // 2. Création en cours : on met le message en attente, sans nouveau prompt
  if (T.creating.has(user.id)) {
    const entry = T.pending.get(user.id) ?? { messages: [], createdAt: Date.now() };
    entry.messages.push({ content, attachments: attachments.map(slimAttachment) });
    T.pending.set(user.id, entry);
    return;
  }

  // 3. Pas de ticket : on garde le message et on demande le type (une seule fois)
  let entry = T.pending.get(user.id);
  const expired = entry && Date.now() - entry.createdAt > T.PENDING_TTL_MS;
  const slim = { content, attachments: attachments.map(slimAttachment) };

  if (entry && !expired) {
    if (entry.messages.length < 10) entry.messages.push(slim);
    return;
  }

  T.pending.set(user.id, { messages: [slim], createdAt: Date.now() });
  await message.channel.send({
    embeds: [T.buildTypeChoiceEmbed()],
    components: [T.buildTypeChoiceRow()],
  }).catch(err => console.error('[Tickets] Envoi du choix de type :', err.message));
}

// On ne garde que ce qui sert au relais (évite de retenir des objets Discord entiers en mémoire)
function slimAttachment(a) {
  return { url: a.url, contentType: a.contentType ?? null, name: a.name };
}
