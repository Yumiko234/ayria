const { EmbedBuilder } = require('discord.js');

// Types de logs disponibles
const LOG_TYPES = {
  SANCTION:    'sanctions',
  MESSAGE_DEL: 'messages_supprimes',
  MESSAGE_EDI: 'messages_modifies',
  TICKET:      'tickets',
  MEMBER:      'membres',
  MOD:         'moderation',
  ROLE_UPDATE: 'roles', // 👈 Ajouté ici
};

/**
 * Récupère le salon de log configuré pour un type donné.
 * @param {import('discord.js').Guild} guild
 * @param {string} logType  — une valeur de LOG_TYPES
 * @returns {Promise<import('discord.js').TextChannel|null>}
 */
async function getLogChannel(guild, logType) {
  const db = guild.client.db;
  const { data, error } = await db
    .from('log_channels')
    .select('channel_id')
    .eq('guild_id', guild.id)
    .eq('log_type', logType)
    .single();

  if (error || !data) return null;

  try {
    return await guild.channels.fetch(data.channel_id);
  } catch {
    return null;
  }
}

/**
 * Envoie un embed dans le salon de log correspondant.
 * @param {import('discord.js').Guild} guild
 * @param {string} logType
 * @param {EmbedBuilder} embed
 */
async function sendLog(guild, logType, embed) {
  const channel = await getLogChannel(guild, logType);
  if (!channel) return;
  try {
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error(`[logManager] Impossible d'envoyer le log (${logType}) :`, err.message);
  }
}

// ── Builders d'embeds ────────────────────────────────────────────────────────

function buildSanctionEmbed(type, user, moderator, raison, extra = {}) {
  const colors = {
    ban: '#FF2222', unban: '#00CC66', kick: '#FF8800',
    mute: '#FFAA00', unmute: '#00CC66', warn: '#FFDD00',
    clearlogs: '#AAAAAA',
  };
  const icons = {
    ban: '🚫', unban: '🔓', kick: '👢',
    mute: '🔇', unmute: '🔊', warn: '⚠️', clearlogs: '🗑️',
  };

  const embed = new EmbedBuilder()
    .setTitle(`${icons[type] ?? '🛡️'} Sanction — ${type.toUpperCase()}`)
    .setColor(colors[type] ?? '#FF0000')
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: 'Utilisateur',  value: `${user.tag} (<@${user.id}>)`, inline: true },
      { name: 'Modérateur',   value: moderator ? `<@${moderator.id}>` : 'Automatique', inline: true },
      { name: 'Raison',       value: raison, inline: false },
      ...(extra.duration ? [{ name: 'Durée', value: extra.duration, inline: true }] : []),
    )
    .setFooter({ text: `ID utilisateur : ${user.id}` })
    .setTimestamp();

  return embed;
}

function buildRoleUpdateEmbed(member, addedRoles, removedRoles, executor) {
  const lines = [];
  if (addedRoles.length)   lines.push(`**Ajoutés :** ${addedRoles.map(r => `<@&${r.id}>`).join(', ')}`);
  if (removedRoles.length) lines.push(`**Retirés :** ${removedRoles.map(r => `<@&${r.id}>`).join(', ')}`);

  return new EmbedBuilder()
    .setTitle('🎭 Rôles modifiés')
    .setColor('#5865F2')
    .setThumbnail(member.user.displayAvatarURL())
    .addFields(
      { name: 'Membre',      value: `${member.user.tag} (<@${member.user.id}>)`, inline: true },
      { name: 'Modifié par', value: executor ? `<@${executor.id}>` : 'Inconnu / automatique', inline: true },
      { name: 'Changements', value: lines.join('\n') || '—' },
    )
    .setFooter({ text: `ID membre : ${member.id}` })
    .setTimestamp();
}

function buildMessageDeleteEmbed(message) {
  return new EmbedBuilder()
    .setTitle('🗑️ Message supprimé')
    .setColor('#FF6633')
    .addFields(
      { name: 'Auteur',  value: `${message.author.tag} (<@${message.author.id}>)`, inline: true },
      { name: 'Salon',   value: `<#${message.channel.id}>`, inline: true },
      { name: 'Contenu', value: message.content?.slice(0, 1024) || '*[vide ou média]*' },
    )
    .setFooter({ text: `Message ID : ${message.id}` })
    .setTimestamp();
}

function buildMessageEditEmbed(oldMessage, newMessage) {
  return new EmbedBuilder()
    .setTitle('✏️ Message modifié')
    .setColor('#FFAA00')
    .setURL(newMessage.url)
    .addFields(
      { name: 'Auteur',  value: `${newMessage.author.tag} (<@${newMessage.author.id}>)`, inline: true },
      { name: 'Salon',   value: `<#${newMessage.channel.id}>`, inline: true },
      { name: 'Avant',   value: oldMessage.content?.slice(0, 512) || '*[vide]*' },
      { name: 'Après',   value: newMessage.content?.slice(0, 512) || '*[vide]*' },
    )
    .setFooter({ text: `Message ID : ${newMessage.id}` })
    .setTimestamp();
}

function buildMemberJoinEmbed(member) {
  const created = Math.floor(member.user.createdTimestamp / 1000);
  return new EmbedBuilder()
    .setTitle('📥 Nouveau membre')
    .setColor('#00CC66')
    .setThumbnail(member.user.displayAvatarURL())
    .addFields(
      { name: 'Utilisateur', value: `${member.user.tag} (<@${member.user.id}>)`, inline: true },
      { name: 'Compte créé', value: `<t:${created}:R>`, inline: true },
      { name: 'Membres',     value: `${member.guild.memberCount}`, inline: true },
    )
    .setFooter({ text: `ID : ${member.user.id}` })
    .setTimestamp();
}

function buildMemberLeaveEmbed(member) {
  const roles = member.roles.cache
    .filter(r => r.name !== '@everyone')
    .map(r => `<@&${r.id}>`)
    .join(', ') || 'Aucun';

  return new EmbedBuilder()
    .setTitle('📤 Membre parti')
    .setColor('#FF4444')
    .setThumbnail(member.user.displayAvatarURL())
    .addFields(
      { name: 'Utilisateur', value: `${member.user.tag} (<@${member.user.id}>)`, inline: true },
      { name: 'Rôles',       value: roles.slice(0, 512), inline: false },
    )
    .setFooter({ text: `ID : ${member.user.id}` })
    .setTimestamp();
}

function buildTicketEmbed(action, channel, user, ticketNumber) {
  const isOpen = action === 'open';
  return new EmbedBuilder()
    .setTitle(isOpen ? '🎫 Ticket ouvert' : '🔒 Ticket fermé')
    .setColor(isOpen ? '#00CC66' : '#FF8800')
    .addFields(
      { name: 'Utilisateur', value: `<@${user.id}>`, inline: true },
      { name: 'Salon',       value: `<#${channel.id}>`, inline: true },
      { name: 'Numéro',      value: `#${ticketNumber}`, inline: true },
    )
    .setFooter({ text: `Channel ID : ${channel.id}` })
    .setTimestamp();
}

module.exports = {
  LOG_TYPES,
  sendLog,
  buildSanctionEmbed,
  buildMessageDeleteEmbed,
  buildMessageEditEmbed,
  buildMemberJoinEmbed,
  buildMemberLeaveEmbed,
  buildTicketEmbed,
  buildRoleUpdateEmbed
};