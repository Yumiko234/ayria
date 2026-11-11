'use strict';

const { ChannelType, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// ─── Réglages ────────────────────────────────────────────────────────────────
const CATEGORY_OPEN   = 'tickets ouvert';
const CATEGORY_CLOSED = 'tickets fermés';
const COLOR           = '#8FA382';
const INTERNAL_PREFIX = '//';   // un message du staff commençant par // n'est PAS envoyé à l'utilisateur
const ANONYMOUS_STAFF = true;   // true : l'utilisateur voit « Équipe AYRIA » ; false : il voit le pseudo du modérateur
const PENDING_TTL_MS  = 10 * 60 * 1000; // délai pour choisir un type après le premier MP

// Types de tickets (mêmes libellés qu'avant : ils sont stockés tels quels dans la colonne `type`)
const TICKET_TYPES = {
  request:     { prefix: 'ticket-qs',          label: 'Question / Signalement' },
  application: { prefix: 'ticket-candi',       label: 'Recrutement Staff' },
  partnership: { prefix: 'ticket-partenariat', label: 'Partenariat' },
};

// ─── État en mémoire ─────────────────────────────────────────────────────────
// userId -> { messages: [{content, attachments}], createdAt }  (messages reçus avant le choix du type)
const pending  = new Map();
// userId présents ici = création de ticket en cours (anti double-ticket sur clics/messages simultanés)
const creating = new Set();

// ─── Serveur cible ───────────────────────────────────────────────────────────
// Un MP n'a pas de serveur : on utilise GUILD_ID (login.env) ou, à défaut, le premier serveur du bot.
function getTargetGuild(client) {
  if (process.env.GUILD_ID) return client.guilds.cache.get(process.env.GUILD_ID) ?? null;
  return client.guilds.cache.first() ?? null;
}

// ─── Catégories ──────────────────────────────────────────────────────────────
async function findOrCreateCategory(guild, name, displayName) {
  let cat = guild.channels.cache.find(c => c.name.toLowerCase() === name && c.type === ChannelType.GuildCategory);
  if (!cat) {
    const fetched = await guild.channels.fetch();
    cat = fetched.find(c => c.name.toLowerCase() === name && c.type === ChannelType.GuildCategory);
  }
  if (!cat) cat = await guild.channels.create({ name: displayName, type: ChannelType.GuildCategory });
  return cat;
}
const getOpenCategory   = guild => findOrCreateCategory(guild, CATEGORY_OPEN,   'Tickets ouvert');
const getClosedCategory = guild => findOrCreateCategory(guild, CATEGORY_CLOSED, 'Tickets fermés');

// Même logique qu'avant : premier rôle disposant de « Gérer les messages ».
function getStaffRole(guild) {
  return guild.roles.cache.find(r => r.permissions.has(PermissionFlagsBits.ManageMessages));
}

// ─── Base de données ─────────────────────────────────────────────────────────
// Ticket actif (Ouvert ou Pris en charge) d'un utilisateur. Aucune migration : on utilise `author_id`.
async function getActiveTicketByUser(db, userId) {
  const { data, error } = await db
    .from('tickets')
    .select('*')
    .eq('author_id', userId)
    .or('status.eq.Ouvert,status.like.Pris*')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) { console.error('[Tickets] Erreur lecture ticket actif :', error.message); return null; }
  return data?.[0] ?? null;
}

// Ticket actif lié à un salon (null si salon fermé / inconnu).
async function getActiveTicketByChannel(db, channelId) {
  const { data, error } = await db
    .from('tickets')
    .select('*')
    .eq('ticket_id', channelId)
    .or('status.eq.Ouvert,status.like.Pris*')
    .limit(1);
  if (error) { console.error('[Tickets] Erreur lecture ticket (salon) :', error.message); return null; }
  return data?.[0] ?? null;
}

// Ticket quel que soit son statut (fermeture / réouverture / claim).
async function getTicketByChannel(db, channelId) {
  const { data } = await db.from('tickets').select('*').eq('ticket_id', channelId).limit(1);
  return data?.[0] ?? null;
}

// ─── Mise en forme des messages relayés ──────────────────────────────────────
function attachmentsToText(attachments) {
  if (!attachments?.length) return '';
  return attachments.map(a => `📎 ${a.url}`).join('\n');
}

// MP utilisateur -> salon staff (embed, pour garder l'auteur lisible et neutraliser les mentions)
function buildUserRelayEmbed(user, content, attachments) {
  const extra = attachmentsToText(attachments);
  const desc = [content, extra].filter(Boolean).join('\n\n').slice(0, 4096) || '*(message vide)*';
  const embed = new EmbedBuilder()
    .setColor('#5865f2')
    .setAuthor({ name: `${user.username} (${user.id})`, iconURL: user.displayAvatarURL() })
    .setDescription(desc)
    .setTimestamp();
  const firstImage = attachments?.find(a => a.contentType?.startsWith('image/'));
  if (firstImage) embed.setImage(firstImage.url);
  return embed;
}

// Salon staff -> MP utilisateur
function buildStaffRelayEmbed(staffUser, content, attachments) {
  const extra = attachmentsToText(attachments);
  const desc = [content, extra].filter(Boolean).join('\n\n').slice(0, 4096) || '*(message vide)*';
  return new EmbedBuilder()
    .setColor(COLOR)
    .setAuthor({ name: ANONYMOUS_STAFF ? 'Équipe AYRIA' : `${staffUser.username} — Équipe AYRIA` })
    .setDescription(desc)
    .setTimestamp();
}

function buildTypeChoiceEmbed() {
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle("Ouverture d'un ticket")
    .setDescription([
      "Bonjour ! Pour que ta demande soit transmise à la bonne équipe, choisis son type ci-dessous :",
      '',
      "• **Question / Signalement** : question d'ordre général, ou signalement d'une personne qui ne respecte pas les règles du serveur ou les ToS de Discord.",
      "• **Recrutement Staff** : candidature, quand les recrutements sont ouverts par l'Administration.",
      '• **Partenariat** : partenariat entre AYRIA et ton serveur.',
      '',
      '*Ton message sera transmis automatiquement une fois le type choisi.*',
    ].join('\n'))
    .setFooter({ text: 'AYRIA' });
}

function buildTypeChoiceRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('dmticket:request').setLabel('Question / Signalement').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('dmticket:application').setLabel('Recrutement Staff').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('dmticket:partnership').setLabel('Partenariat').setStyle(ButtonStyle.Primary),
  );
}

module.exports = {
  CATEGORY_OPEN, CATEGORY_CLOSED, COLOR, INTERNAL_PREFIX, PENDING_TTL_MS,
  TICKET_TYPES, pending, creating,
  getTargetGuild, getOpenCategory, getClosedCategory, getStaffRole,
  getActiveTicketByUser, getActiveTicketByChannel, getTicketByChannel,
  buildUserRelayEmbed, buildStaffRelayEmbed, buildTypeChoiceEmbed, buildTypeChoiceRow,
};
