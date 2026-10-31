'use strict';

/**
 * giveawayManager : toute la logique métier des giveaways et des drops.
 * Les fichiers commands/ et events/ ne font que l'appeler.
 *
 * Prérequis : client.db = client Supabase (déjà le cas dans index.js).
 */

const crypto = require('crypto');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require('discord.js');
const { computeLevel } = require('../events/xpManager');

// ─── Configuration ────────────────────────────────────────────────────────────
const CONFIG = Object.freeze({
  EMBED_COLOR: 4394149,                      // même couleur que absence.js
  EMBED_COLOR_ENDED: 0x747f8d,
  EMBED_COLOR_CANCELLED: 0xed4245,
  DEFAULT_CLAIM_DELAY_MS: 24 * 3_600_000,    // 24 h
  DEFAULT_MAX_REROLLS: 5,                    // remplacements automatiques max par giveaway
  MIN_DURATION_MS: 60_000,                   // 1 min
  MAX_DURATION_MS: 60 * 86_400_000,          // 60 jours
  MAX_WINNERS: 25,
  MAX_VOTES: 100,
  MESSAGE_COUNT_COOLDOWN_MS: 5_000,          // anti-farm : 1 message compté / 5 s / membre
  MESSAGE_FLUSH_INTERVAL_MS: 30_000,
  SCHEDULER_INTERVAL_MS: 10_000,
  EMBED_REFRESH_DELAY_MS: 5_000,             // regroupe les mises à jour d'embed
  // Voix cumulées ? 'max' = on prend la valeur la plus haute parmi les rôles possédés.
  VOTE_MODE: 'max',
});

// ─── Utilitaires ──────────────────────────────────────────────────────────────
const DURATION_UNITS = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/** "30m" | "2h" | "1d" | "1w" → millisecondes (ou null si invalide) */
function parseDuration(input) {
  if (typeof input !== 'string') return null;
  const m = input.trim().toLowerCase().match(/^(\d+)\s*([mhdw])$/);
  if (!m) return null;
  const ms = parseInt(m[1], 10) * DURATION_UNITS[m[2]];
  return Number.isSafeInteger(ms) && ms > 0 ? ms : null;
}

function formatDuration(ms) {
  const units = [
    ['semaine', 'semaines', 604_800_000],
    ['jour', 'jours', 86_400_000],
    ['heure', 'heures', 3_600_000],
    ['minute', 'minutes', 60_000],
  ];
  for (const [singular, plural, value] of units) {
    if (ms >= value && ms % value === 0) {
      const n = ms / value;
      return `${n} ${n > 1 ? plural : singular}`;
    }
  }
  const n = Math.max(1, Math.round(ms / 60_000));
  return `${n} minute${n > 1 ? 's' : ''}`;
}

const unix = d => Math.floor(new Date(d).getTime() / 1000);

const messageUrl = (guildId, channelId, messageId) =>
  `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

/** Réel aléatoire cryptographique dans ]0, 1[ */
function randomUnit() {
  const max = 2 ** 48;
  return crypto.randomInt(1, max) / max;
}

/**
 * Tirage pondéré SANS remise (Efraimidis-Spirakis) :
 * chaque candidat reçoit la clé ln(u)/poids ; on garde les k plus grandes.
 * Un membre à 3 voix a donc 3× plus de chances d'être tiré qu'un membre à 1 voix.
 * @param {{userId:string, votes:number}[]} pool
 */
function weightedSample(pool, k) {
  return pool
    .map(c => ({ ...c, key: Math.log(randomUnit()) / c.votes }))
    .sort((a, b) => b.key - a.key)
    .slice(0, k)
    .map(({ key, ...rest }) => rest);
}

/** Lit toutes les lignes d'une requête Supabase (la limite par défaut est 1000). */
async function fetchAllRows(buildQuery, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// ─── Compteur de messages ─────────────────────────────────────────────────────
// Tampon en mémoire, écrit en base toutes les 30 s (1 RPC par serveur).
// Limite assumée : un crash perd au plus ~30 s de comptage.
const pendingCounts = new Map();   // guildId → Map<userId, n>
const lastCounted   = new Map();   // "guildId:userId" → timestamp

function trackMessage(message) {
  if (!message.guild || message.author?.bot || message.webhookId || message.system) return;
  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  if (now - (lastCounted.get(key) ?? 0) < CONFIG.MESSAGE_COUNT_COOLDOWN_MS) return;
  lastCounted.set(key, now);

  let users = pendingCounts.get(message.guild.id);
  if (!users) {
    users = new Map();
    pendingCounts.set(message.guild.id, users);
  }
  users.set(message.author.id, (users.get(message.author.id) ?? 0) + 1);
}

async function flushMessageCounts(db) {
  const cutoff = Date.now() - CONFIG.MESSAGE_COUNT_COOLDOWN_MS;
  for (const [key, ts] of lastCounted) if (ts < cutoff) lastCounted.delete(key);

  if (pendingCounts.size === 0) return;
  const snapshot = new Map(pendingCounts);
  pendingCounts.clear();

  for (const [guildId, users] of snapshot) {
    const { error } = await db.rpc('add_message_counts', {
      p_guild_id: guildId,
      p_rows: Object.fromEntries(users),
    });
    if (error) {
      console.error('[Giveaway] Flush compteur messages :', error.message);
      // On remet les compteurs dans le tampon pour ne rien perdre.
      let current = pendingCounts.get(guildId);
      if (!current) { current = new Map(); pendingCounts.set(guildId, current); }
      for (const [userId, n] of users) current.set(userId, (current.get(userId) ?? 0) + n);
    }
  }
}

// ─── Statistiques membres (niveau, messages) ──────────────────────────────────
async function loadStats(db, g, userIds) {
  const stats = new Map(userIds.map(id => [id, { level: 0, messages: 0 }]));

  if (g.min_level) {
    for (const ids of chunk(userIds, 200)) {
      const { data, error } = await db
        .from('xp_profiles').select('user_id, level')
        .eq('guild_id', g.guild_id).in('user_id', ids);
      if (error) throw new Error(`xp_profiles : ${error.message}`);
      for (const r of data) stats.get(r.user_id).level = Number(r.level) || 0;
    }
  }

  if (g.min_messages) {
    for (const ids of chunk(userIds, 200)) {
      const { data, error } = await db
        .from('message_counts').select('user_id, count')
        .eq('guild_id', g.guild_id).in('user_id', ids);
      if (error) throw new Error(`message_counts : ${error.message}`);
      for (const r of data) stats.get(r.user_id).messages = Number(r.count) || 0;
    }
    const buffered = pendingCounts.get(g.guild_id);
    if (buffered) for (const id of userIds) stats.get(id).messages += buffered.get(id) ?? 0;
  }

  return stats;
}

/**
 * Vérifie les conditions et calcule le nombre de voix d'un membre.
 * Fonction pure (aucun accès réseau) : utilisée à la participation ET au tirage.
 */
function evaluateMember(g, member, stat) {
  const reasons = [];
  const roles = member.roles.cache;

  if (g.required_role_id && !roles.has(g.required_role_id)) {
    reasons.push(`Il te faut le rôle <@&${g.required_role_id}>.`);
  }
  if (g.forbidden_role_id && roles.has(g.forbidden_role_id)) {
    reasons.push(`Le rôle <@&${g.forbidden_role_id}> est exclu de ce giveaway.`);
  }
  if (g.min_server_days) {
    const days = (Date.now() - (member.joinedTimestamp ?? Date.now())) / 86_400_000;
    if (days < g.min_server_days) {
      reasons.push(`Ancienneté requise : **${g.min_server_days}** jour(s) sur le serveur (tu y es depuis **${Math.floor(days)}**).`);
    }
  }
  if (g.min_level && stat.level < g.min_level) {
    reasons.push(`Niveau requis : **${g.min_level}** (tu es niveau **${stat.level}**).`);
  }
  if (g.min_messages && stat.messages < g.min_messages) {
    reasons.push(`Messages requis : **${g.min_messages}** (tu en as **${stat.messages}**).`);
  }

  let votes = 1;
  for (const v of g.vote_roles ?? []) {
    if (roles.has(v.role_id)) votes = Math.max(votes, v.votes);
  }
  votes = Math.min(votes, CONFIG.MAX_VOTES);

  return { ok: reasons.length === 0, reasons, votes };
}

// ─── Affichage ────────────────────────────────────────────────────────────────
function describeReward(src) {
  if (src.reward_type === 'role') return `Rôle <@&${src.reward_role_id}>`;
  if (src.reward_type === 'xp') return `**${src.reward_xp}** XP`;
  return 'Lot remis par le staff';
}

function describeConditions(g) {
  const lines = [];
  if (g.required_role_id)  lines.push(`• Rôle requis : <@&${g.required_role_id}>`);
  if (g.forbidden_role_id) lines.push(`• Rôle interdit : <@&${g.forbidden_role_id}>`);
  if (g.min_level)         lines.push(`• Niveau ${g.min_level} minimum`);
  if (g.min_messages)      lines.push(`• ${g.min_messages} messages minimum`);
  if (g.min_server_days)   lines.push(`• ${g.min_server_days} jour(s) d'ancienneté minimum`);
  return lines.length ? lines.join('\n') : 'Aucune';
}

function describeVotes(g) {
  const list = g.vote_roles ?? [];
  if (!list.length) return null;
  const lines = list.map(v => `• <@&${v.role_id}> : **${v.votes}** voix`);
  return `${lines.join('\n')}\n(sans rôle bonus : 1 voix)`;
}

const WINNER_LINE = {
  pending:  w => `⏳ <@${w.user_id}>, à réclamer <t:${unix(w.claim_deadline)}:R>`,
  claimed:  w => `✅ <@${w.user_id}>, réclamé`,
  expired:  w => `❌ <@${w.user_id}>, délai dépassé`,
  replaced: w => `🔁 <@${w.user_id}>, remplacé`,
};

function button(customId, label, emoji, style, disabled = false) {
  return new ButtonBuilder()
    .setCustomId(customId).setLabel(label).setEmoji(emoji)
    .setStyle(style).setDisabled(disabled);
}

function buildGiveawayView(g, winners, participants) {
  const embed = new EmbedBuilder().setFooter({ text: `Giveaway #${g.id}` });
  let components = [];

  if (g.status === 'active') {
    const votes = describeVotes(g);
    embed
      .setColor(CONFIG.EMBED_COLOR)
      .setTitle(`🎉 ${g.prize}`)
      .setDescription('Clique sur **Participer** pour tenter ta chance !')
      .addFields(
        { name: 'Récompense',   value: describeReward(g), inline: true },
        { name: 'Gagnants',     value: String(g.winners_count), inline: true },
        { name: 'Participants', value: String(participants), inline: true },
        { name: 'Fin',          value: `<t:${unix(g.ends_at)}:R> (<t:${unix(g.ends_at)}:f>)` },
        { name: 'Organisateur', value: `<@${g.host_id}>`, inline: true },
        { name: 'Conditions',   value: describeConditions(g) },
      );
    if (votes) embed.addFields({ name: 'Voix bonus', value: votes });
    components = [new ActionRowBuilder().addComponents(
      button(`gw:join:${g.id}`, 'Participer', '🎉', ButtonStyle.Success),
    )];
  } else if (g.status === 'cancelled') {
    embed
      .setColor(CONFIG.EMBED_COLOR_CANCELLED)
      .setTitle(`🚫 ${g.prize}`)
      .setDescription('Ce giveaway a été **annulé**.');
  } else {
    const lines = winners.map(w => WINNER_LINE[w.status](w));
    let description = lines.length
      ? lines.join('\n')
      : 'Aucun participant éligible : personne ne remporte ce lot.';
    if (description.length > 3900) description = description.slice(0, 3900) + '\n…';

    embed
      .setColor(CONFIG.EMBED_COLOR_ENDED)
      .setTitle(`🏆 ${g.prize}, terminé`)
      .setDescription(description)
      .addFields(
        { name: 'Récompense',   value: describeReward(g), inline: true },
        { name: 'Participants', value: String(participants), inline: true },
        { name: 'Réclamation',
          value: `Délai : ${formatDuration(Number(g.claim_delay_ms))}\nRemplacements auto : ${g.max_rerolls} max`,
          inline: true },
      );
    if (winners.some(w => w.status === 'pending')) {
      components = [new ActionRowBuilder().addComponents(
        button(`gw:claim:${g.id}`, 'Réclamer', '🎁', ButtonStyle.Primary),
      )];
    }
  }
  return { embeds: [embed], components };
}

/** Met à jour l'embed d'origine ; le recrée s'il a été supprimé et qu'il reste utile. */
async function refreshGiveawayMessage(client, id) {
  const db = client.db;
  const { data: g } = await db.from('giveaways').select('*').eq('id', id).maybeSingle();
  if (!g) return;

  const [{ data: winners }, { count }] = await Promise.all([
    db.from('giveaway_winners').select('*').eq('giveaway_id', id).order('id'),
    db.from('giveaway_entries').select('user_id', { count: 'exact', head: true }).eq('giveaway_id', id),
  ]);
  const view = buildGiveawayView(g, winners ?? [], count ?? 0);

  const channel = await client.channels.fetch(g.channel_id).catch(() => null);
  if (!channel) return;

  const existing = g.message_id ? await channel.messages.fetch(g.message_id).catch(() => null) : null;
  if (existing) {
    await existing.edit(view).catch(err => console.error('[Giveaway] Edit message :', err.message));
    return;
  }
  if (g.status === 'cancelled') return;
  const sent = await channel.send(view).catch(err => {
    console.error('[Giveaway] Recréation du message :', err.message);
    return null;
  });
  if (sent) await db.from('giveaways').update({ message_id: sent.id }).eq('id', id);
}

const refreshTimers = new Map();
function scheduleGiveawayRefresh(client, id) {
  if (refreshTimers.has(id)) return;
  refreshTimers.set(id, setTimeout(() => {
    refreshTimers.delete(id);
    refreshGiveawayMessage(client, id).catch(err => console.error('[Giveaway] Refresh :', err.message));
  }, CONFIG.EMBED_REFRESH_DELAY_MS));
}

// ─── Options de commande partagées (giveaway + drop) ──────────────────────────
function parseRewardOptions(interaction) {
  const type = interaction.options.getString('recompense') ?? 'autre';
  const role = interaction.options.getRole('role_recompense');
  const xp   = interaction.options.getInteger('xp_recompense');

  if (type === 'role') {
    if (!role) return { error: "Récompense « rôle » : renseigne l'option `role_recompense`." };
    if (xp != null) return { error: "`xp_recompense` est incompatible avec une récompense de type rôle." };
    if (role.id === interaction.guild.id) return { error: 'Le rôle @everyone ne peut pas être une récompense.' };
    if (role.editable === false) {
      return { error: "Je ne peux pas attribuer ce rôle (il est au-dessus de mon rôle, ou géré par une intégration, ou il me manque « Gérer les rôles »)." };
    }
    return { rewardType: 'role', rewardRoleId: role.id, rewardXp: null };
  }
  if (type === 'xp') {
    if (xp == null) return { error: "Récompense « XP » : renseigne l'option `xp_recompense`." };
    if (role) return { error: "`role_recompense` est incompatible avec une récompense de type XP." };
    return { rewardType: 'xp', rewardRoleId: null, rewardXp: xp };
  }
  if (role || xp != null) {
    return { error: "`role_recompense` / `xp_recompense` ne s'appliquent qu'aux types « rôle » / « xp ». Choisis `recompense` en conséquence." };
  }
  return { rewardType: 'autre', rewardRoleId: null, rewardXp: null };
}

function checkChannelPermissions(channel, me) {
  const perms = channel.permissionsFor(me);
  const needed = [
    [PermissionFlagsBits.ViewChannel, 'Voir le salon'],
    [PermissionFlagsBits.SendMessages, 'Envoyer des messages'],
    [PermissionFlagsBits.EmbedLinks, 'Intégrer des liens'],
  ];
  const missing = needed.filter(([flag]) => !perms?.has(flag)).map(([, name]) => name);
  return missing.length ? `Il me manque des permissions dans ${channel} : ${missing.join(', ')}.` : null;
}

// ─── Récompenses ──────────────────────────────────────────────────────────────
/** Ajoute de l'XP (atomique) et applique les rôles de palier franchis. */
async function grantXp(client, guild, userId, amount) {
  const db = client.db;
  const { data: before } = await db.from('xp_profiles').select('level')
    .eq('guild_id', guild.id).eq('user_id', userId).maybeSingle();
  const oldLevel = before?.level ?? 0;

  const { data: totalXp, error } = await db.rpc('add_xp', {
    p_guild_id: guild.id, p_user_id: userId, p_amount: amount,
  });
  if (error) throw new Error(`add_xp : ${error.message}`);

  const { level: newLevel } = computeLevel(Number(totalXp));
  if (newLevel === oldLevel) return;

  await db.from('xp_profiles').update({ level: newLevel })
    .eq('guild_id', guild.id).eq('user_id', userId);

  // xpManager ne donne le rôle de palier qu'au passage de niveau par message.
  // Ici le niveau change hors message : on applique donc nous-mêmes les paliers franchis.
  if (newLevel > oldLevel) {
    const { data: tiers } = await db.from('xp_levels').select('level, role_id')
      .eq('guild_id', guild.id).gt('level', oldLevel).lte('level', newLevel);
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) {
      for (const tier of tiers ?? []) {
        if (tier.role_id) {
          await member.roles.add(tier.role_id, `Palier XP niveau ${tier.level} (récompense)`)
            .catch(err => console.error('[Giveaway] Rôle de palier :', err.message));
        }
      }
    }
  }
}

/** @param src ligne `giveaways` ou `drops` */
async function grantReward(client, src, userId, reason) {
  if (src.reward_type === 'autre') return { ok: true, manual: true };

  const guild = client.guilds.cache.get(src.guild_id);
  if (!guild) return { ok: false, error: 'Serveur indisponible.' };
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return { ok: false, error: "Tu n'es plus sur le serveur." };

  try {
    if (src.reward_type === 'role') {
      await member.roles.add(src.reward_role_id, reason);
    } else {
      await grantXp(client, guild, userId, src.reward_xp);
    }
    return { ok: true };
  } catch (err) {
    console.error('[Giveaway] Attribution récompense :', err.message);
    return { ok: false, error: "La récompense n'a pas pu être attribuée automatiquement. Préviens le staff." };
  }
}

// ─── Giveaway : création ──────────────────────────────────────────────────────
async function createGiveaway(client, o) {
  const db = client.db;
  const { data: row, error } = await db.from('giveaways').insert({
    guild_id:          o.guild.id,
    channel_id:        o.channel.id,
    host_id:           o.hostId,
    prize:             o.prize,
    reward_type:       o.rewardType,
    reward_role_id:    o.rewardRoleId,
    reward_xp:         o.rewardXp,
    winners_count:     o.winnersCount,
    ends_at:           new Date(Date.now() + o.durationMs).toISOString(),
    claim_delay_ms:    o.claimDelayMs,
    max_rerolls:       CONFIG.DEFAULT_MAX_REROLLS,
    min_level:         o.minLevel ?? null,
    min_messages:      o.minMessages ?? null,
    min_server_days:   o.minServerDays ?? null,
    required_role_id:  o.requiredRoleId ?? null,
    forbidden_role_id: o.forbiddenRoleId ?? null,
    vote_roles:        o.voteRoles ?? [],
  }).select().single();
  if (error) throw new Error(`Insertion giveaway : ${error.message}`);

  try {
    const msg = await o.channel.send(buildGiveawayView(row, [], 0));
    await db.from('giveaways').update({ message_id: msg.id }).eq('id', row.id);
    return { ...row, message_id: msg.id };
  } catch (err) {
    await db.from('giveaways').delete().eq('id', row.id);   // pas de giveaway fantôme
    throw err;
  }
}

// ─── Giveaway : tirage ────────────────────────────────────────────────────────
async function fetchMembersMap(guild, ids) {
  const map = new Map();
  for (const part of chunk(ids, 100)) {
    try {
      const found = await guild.members.fetch({ user: part });
      found.forEach((m, id) => map.set(id, m));
    } catch {
      for (const id of part) {
        const m = await guild.members.fetch(id).catch(() => null);
        if (m) map.set(id, m);
      }
    }
  }
  return map;
}

/** Tire `count` gagnants parmi les participants encore éligibles (conditions revérifiées). */
async function drawWinners(client, g, count, excludeIds = new Set()) {
  const guild = client.guilds.cache.get(g.guild_id);
  if (!guild) throw new Error('Serveur indisponible');

  const entries = await fetchAllRows(() =>
    client.db.from('giveaway_entries').select('user_id').eq('giveaway_id', g.id).order('user_id'));
  const ids = entries.map(e => e.user_id).filter(id => !excludeIds.has(id));
  if (!ids.length) return [];

  const members = await fetchMembersMap(guild, ids);
  const stats = await loadStats(client.db, g, [...members.keys()]);

  const pool = [];
  for (const [id, member] of members) {
    if (member.user.bot) continue;
    const res = evaluateMember(g, member, stats.get(id));
    if (res.ok) pool.push({ userId: id, votes: res.votes });
  }
  return weightedSample(pool, count);
}

async function recordWinners(client, g, picks) {
  if (!picks.length) return [];
  const deadline = new Date(Date.now() + Number(g.claim_delay_ms)).toISOString();
  const { data, error } = await client.db.from('giveaway_winners')
    .insert(picks.map(p => ({ giveaway_id: g.id, user_id: p.userId, claim_deadline: deadline })))
    .select();
  if (error) throw new Error(`Insertion gagnants : ${error.message}`);
  return data;
}

async function announceWinners(client, g, winners, intro) {
  const channel = await client.channels.fetch(g.channel_id).catch(() => null);
  if (!channel) return;

  if (!winners.length) {
    await channel.send(`😕 Aucun participant éligible pour **${g.prize}** (giveaway #${g.id}).`).catch(() => {});
    return;
  }
  const mentions = winners.map(w => `<@${w.user_id}>`).join(' ');
  const deadline = unix(winners[0].claim_deadline);
  const link = g.message_id ? `\n➡️ [Réclamer ici](${messageUrl(g.guild_id, g.channel_id, g.message_id)})` : '';

  await channel.send({
    content: `${intro ?? '🎉 Félicitations'} ${mentions} ! Lot : **${g.prize}**.\n`
           + `Clique sur **Réclamer** avant <t:${deadline}:R>, sinon un remplaçant sera tiré au sort.${link}`,
    allowedMentions: { users: winners.map(w => w.user_id) },
  }).catch(err => console.error('[Giveaway] Annonce :', err.message));
}

/** Termine un giveaway actif (fin naturelle ou /giveaway terminer). */
async function endGiveaway(client, id, guildScope = null) {
  const db = client.db;
  let query = db.from('giveaways').select('*').eq('id', id);
  if (guildScope) query = query.eq('guild_id', guildScope);
  const { data: g0 } = await query.maybeSingle();

  if (!g0) return { ok: false, reason: 'Giveaway introuvable.' };
  if (g0.status !== 'active') return { ok: false, reason: 'Ce giveaway est déjà terminé ou annulé.' };
  if (!client.guilds.cache.has(g0.guild_id)) return { ok: false, reason: 'Serveur indisponible.' };

  // Transition atomique : un seul appelant (scheduler ou commande) passe.
  const { data: g } = await db.from('giveaways')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'active').select().maybeSingle();
  if (!g) return { ok: false, reason: 'Ce giveaway est déjà en cours de traitement.' };

  let winners;
  try {
    const picks = await drawWinners(client, g, g.winners_count);
    winners = await recordWinners(client, g, picks);
  } catch (err) {
    console.error(`[Giveaway #${id}] Tirage impossible :`, err.message);
    await db.from('giveaways').update({ status: 'active', ended_at: null }).eq('id', id);
    return { ok: false, reason: 'Erreur pendant le tirage (consulte les logs). Il sera retenté automatiquement.' };
  }

  await refreshGiveawayMessage(client, id);
  const { data: fresh } = await db.from('giveaways').select('*').eq('id', id).maybeSingle();
  await announceWinners(client, fresh ?? g, winners);
  return { ok: true, winners };
}

async function cancelGiveaway(client, id, guildScope) {
  const { data: g } = await client.db.from('giveaways')
    .update({ status: 'cancelled', ended_at: new Date().toISOString() })
    .eq('id', id).eq('guild_id', guildScope).eq('status', 'active')
    .select().maybeSingle();
  if (!g) return { ok: false, reason: 'Giveaway introuvable ou déjà terminé.' };
  await refreshGiveawayMessage(client, id);
  return { ok: true };
}

// ─── Giveaway : remplacement (auto-reroll et reroll manuel) ───────────────────
async function drawReplacement(client, g, previousUserLabel) {
  const channel = await client.channels.fetch(g.channel_id).catch(() => null);
  const prior = await fetchAllRows(() =>
    client.db.from('giveaway_winners').select('user_id').eq('giveaway_id', g.id).order('id'));
  const exclude = new Set(prior.map(r => r.user_id));

  let winners = [];
  try {
    const picks = await drawWinners(client, g, 1, exclude);
    winners = await recordWinners(client, g, picks);
  } catch (err) {
    console.error(`[Giveaway #${g.id}] Remplacement impossible :`, err.message);
  }

  await refreshGiveawayMessage(client, g.id);

  if (!winners.length) {
    await channel?.send(`😕 ${previousUserLabel} : aucun remplaçant éligible pour **${g.prize}**. La place reste vacante.`).catch(() => {});
    return null;
  }
  const { data: fresh } = await client.db.from('giveaways').select('*').eq('id', g.id).maybeSingle();
  await announceWinners(client, fresh ?? g, winners, `🔁 Nouveau tirage pour ${previousUserLabel} :`);
  return winners[0];
}

/** Délai de réclamation dépassé : expire le gagnant puis tire un remplaçant (dans la limite autorisée). */
async function expireWinner(client, w) {
  const db = client.db;
  const { data: row } = await db.from('giveaway_winners')
    .update({ status: 'expired' })
    .eq('id', w.id).eq('status', 'pending').select().maybeSingle();
  if (!row) return;

  const { data: g } = await db.from('giveaways').select('*').eq('id', row.giveaway_id).maybeSingle();
  if (!g || !client.guilds.cache.has(g.guild_id)) return;

  const { count } = await db.from('giveaway_winners')
    .select('id', { count: 'exact', head: true })
    .eq('giveaway_id', g.id).eq('status', 'expired');

  if ((count ?? 0) > g.max_rerolls) {
    const channel = await client.channels.fetch(g.channel_id).catch(() => null);
    await channel?.send(`⌛ <@${row.user_id}> n'a pas réclamé **${g.prize}** à temps. Limite de ${g.max_rerolls} remplacements atteinte : la place reste vacante.`).catch(() => {});
    await refreshGiveawayMessage(client, g.id);
    return;
  }
  await drawReplacement(client, g, `<@${row.user_id}> (délai de réclamation dépassé)`);
}

/** Reroll manuel d'un gagnant qui n'a pas encore réclamé. */
async function rerollWinner(client, id, guildScope, userId) {
  const db = client.db;
  const { data: g } = await db.from('giveaways').select('*')
    .eq('id', id).eq('guild_id', guildScope).maybeSingle();
  if (!g) return { ok: false, reason: 'Giveaway introuvable.' };
  if (g.status !== 'ended') return { ok: false, reason: "Le giveaway n'est pas terminé." };

  const { data: row } = await db.from('giveaway_winners')
    .update({ status: 'replaced' })
    .eq('giveaway_id', id).eq('user_id', userId).eq('status', 'pending')
    .select().maybeSingle();
  if (!row) {
    return { ok: false, reason: "Ce membre n'est pas un gagnant en attente de réclamation (déjà réclamé, expiré ou inconnu)." };
  }
  const next = await drawReplacement(client, g, `<@${userId}>`);
  return { ok: true, next };
}

// ─── Giveaway : participation et réclamation ──────────────────────────────────
async function getGiveaway(client, id, guildId) {
  const { data } = await client.db.from('giveaways').select('*').eq('id', id).maybeSingle();
  return data && data.guild_id === guildId ? data : null;
}

async function handleJoin(interaction, id) {
  const client = interaction.client;
  const db = client.db;
  const g = await getGiveaway(client, id, interaction.guildId);

  if (!g || g.status !== 'active' || new Date(g.ends_at) <= new Date()) {
    return interaction.editReply('❌ Ce giveaway est terminé.');
  }
  const member = interaction.member?.roles?.cache
    ? interaction.member
    : await interaction.guild.members.fetch(interaction.user.id);

  const stats = await loadStats(db, g, [member.id]);
  const res = evaluateMember(g, member, stats.get(member.id));
  if (!res.ok) {
    return interaction.editReply(`❌ Tu ne remplis pas les conditions :\n${res.reasons.map(r => `• ${r}`).join('\n')}`);
  }

  const { data: existing } = await db.from('giveaway_entries').select('user_id')
    .eq('giveaway_id', id).eq('user_id', member.id).maybeSingle();
  if (existing) {
    return interaction.editReply({
      content: `✅ Tu participes déjà (**${res.votes}** voix).`,
      components: [new ActionRowBuilder().addComponents(
        button(`gw:leave:${id}`, 'Me retirer', '🚪', ButtonStyle.Secondary))],
    });
  }

  const { error } = await db.from('giveaway_entries').insert({ giveaway_id: id, user_id: member.id });
  if (error && error.code !== '23505') throw new Error(error.message);   // 23505 = déjà inscrit (double clic)

  scheduleGiveawayRefresh(client, id);
  return interaction.editReply(`🎉 Participation enregistrée ! Tu as **${res.votes}** voix.`);
}

async function handleLeave(interaction, id) {
  const client = interaction.client;
  const g = await getGiveaway(client, id, interaction.guildId);
  if (!g || g.status !== 'active') return interaction.update({ content: '❌ Ce giveaway est terminé.', components: [] });

  await client.db.from('giveaway_entries').delete().eq('giveaway_id', id).eq('user_id', interaction.user.id);
  scheduleGiveawayRefresh(client, id);
  return interaction.update({ content: '🚪 Tu ne participes plus à ce giveaway.', components: [] });
}

async function handleClaim(interaction, id) {
  const client = interaction.client;
  const db = client.db;
  const userId = interaction.user.id;
  const nowIso = new Date().toISOString();

  const g = await getGiveaway(client, id, interaction.guildId);
  if (!g) return interaction.editReply('❌ Giveaway introuvable.');

  // Réclamation atomique : une seule requête valide le statut ET le délai.
  const { data: won } = await db.from('giveaway_winners')
    .update({ status: 'claimed', claimed_at: nowIso })
    .eq('giveaway_id', id).eq('user_id', userId).eq('status', 'pending').gt('claim_deadline', nowIso)
    .select().maybeSingle();

  if (!won) {
    const { data: any } = await db.from('giveaway_winners').select('status')
      .eq('giveaway_id', id).eq('user_id', userId).maybeSingle();
    if (!any) return interaction.editReply("❌ Tu n'es pas gagnant de ce giveaway.");
    if (any.status === 'claimed') return interaction.editReply('✅ Tu as déjà réclamé ce lot.');
    return interaction.editReply('⌛ Le délai de réclamation est dépassé : le lot a été remis en jeu.');
  }

  const grant = await grantReward(client, g, userId, `Giveaway #${id}`);
  if (!grant.ok) {
    // On annule la réclamation pour que le gagnant puisse réessayer.
    await db.from('giveaway_winners').update({ status: 'pending', claimed_at: null }).eq('id', won.id);
    return interaction.editReply(`❌ ${grant.error}`);
  }

  await refreshGiveawayMessage(client, id);

  if (grant.manual) {
    const channel = await client.channels.fetch(g.channel_id).catch(() => null);
    await channel?.send({
      content: `🎁 <@${userId}> a réclamé **${g.prize}**. <@${g.host_id}>, le lot est à remettre.`,
      allowedMentions: { users: [userId, g.host_id] },
    }).catch(() => {});
    return interaction.editReply(`🎁 Lot réclamé : **${g.prize}**. <@${g.host_id}> va te le remettre.`);
  }
  return interaction.editReply(`🎁 Récompense attribuée : ${describeReward(g)} !`);
}

// ─── Drops ────────────────────────────────────────────────────────────────────
function buildDropView(d, claims) {
  const active = d.status === 'active';
  const embed = new EmbedBuilder()
    .setColor(active ? CONFIG.EMBED_COLOR : CONFIG.EMBED_COLOR_ENDED)
    .setTitle(`🎁 DROP : ${d.prize}`)
    .setFooter({ text: `Drop #${d.id}` });

  const places = `${claims.length}/${d.winners_count}`;
  embed.setDescription(active
    ? `Les **${d.winners_count}** premiers à cliquer sur **Réclamer** remportent le lot !`
    : 'Ce drop est **terminé**.');
  embed.addFields(
    { name: 'Récompense', value: describeReward(d), inline: true },
    { name: 'Places prises', value: places, inline: true },
  );
  if (d.expires_at && active) embed.addFields({ name: 'Expire', value: `<t:${unix(d.expires_at)}:R>`, inline: true });
  if (claims.length) {
    let list = claims.map((c, i) => `**${i + 1}.** <@${c.user_id}>`).join('\n');
    if (list.length > 1000) list = list.slice(0, 1000) + '\n…';
    embed.addFields({ name: 'Gagnants', value: list });
  }

  const components = [new ActionRowBuilder().addComponents(
    button(`dr:claim:${d.id}`, 'Réclamer', '🎁', ButtonStyle.Success, !active),
  )];
  return { embeds: [embed], components };
}

async function refreshDropMessage(client, id) {
  const { data: d } = await client.db.from('drops').select('*').eq('id', id).maybeSingle();
  if (!d) return;
  const { data: claims } = await client.db.from('drop_claims').select('user_id')
    .eq('drop_id', id).order('claimed_at');
  const channel = await client.channels.fetch(d.channel_id).catch(() => null);
  const msg = channel && d.message_id ? await channel.messages.fetch(d.message_id).catch(() => null) : null;
  if (msg) await msg.edit(buildDropView(d, claims ?? [])).catch(err => console.error('[Drop] Edit :', err.message));
}

const dropTimers = new Map();
function scheduleDropRefresh(client, id) {
  if (dropTimers.has(id)) return;
  dropTimers.set(id, setTimeout(() => {
    dropTimers.delete(id);
    refreshDropMessage(client, id).catch(err => console.error('[Drop] Refresh :', err.message));
  }, 3_000));
}

async function createDrop(client, o) {
  const db = client.db;
  const { data: row, error } = await db.from('drops').insert({
    guild_id: o.guild.id, channel_id: o.channel.id, host_id: o.hostId, prize: o.prize,
    reward_type: o.rewardType, reward_role_id: o.rewardRoleId, reward_xp: o.rewardXp,
    winners_count: o.winnersCount,
    expires_at: o.durationMs ? new Date(Date.now() + o.durationMs).toISOString() : null,
  }).select().single();
  if (error) throw new Error(`Insertion drop : ${error.message}`);

  try {
    const msg = await o.channel.send(buildDropView(row, []));
    await db.from('drops').update({ message_id: msg.id }).eq('id', row.id);
    return { ...row, message_id: msg.id };
  } catch (err) {
    await db.from('drops').delete().eq('id', row.id);
    throw err;
  }
}

/** Dernier message d'un drop : mise à jour de l'embed + récapitulatif. Appelé une seule fois par drop. */
async function finalizeDrop(client, id) {
  await refreshDropMessage(client, id);
  const { data: d } = await client.db.from('drops').select('*').eq('id', id).maybeSingle();
  if (!d) return;
  const { data: claims } = await client.db.from('drop_claims').select('user_id')
    .eq('drop_id', id).order('claimed_at');
  const channel = await client.channels.fetch(d.channel_id).catch(() => null);
  if (!channel) return;

  const winners = (claims ?? []).map(c => c.user_id);
  if (!winners.length) {
    await channel.send(`⌛ Le drop **${d.prize}** a expiré sans gagnant.`).catch(() => {});
    return;
  }
  const mentions = winners.map(u => `<@${u}>`).join(', ');
  const tail = d.reward_type === 'autre' ? `\n<@${d.host_id}>, le lot est à remettre.` : '';
  await channel.send({
    content: `🏁 Drop terminé : **${d.prize}** remporté par ${mentions}.${tail}`,
    allowedMentions: { users: [...winners, d.host_id] },
  }).catch(() => {});
}

async function handleDropClaim(interaction, id) {
  const client = interaction.client;
  const db = client.db;
  const userId = interaction.user.id;

  const { data: d } = await db.from('drops').select('*').eq('id', id).maybeSingle();
  if (!d || d.guild_id !== interaction.guildId) return interaction.editReply('❌ Drop introuvable.');

  const { data, error } = await db.rpc('claim_drop', { p_drop_id: id, p_user_id: userId });
  if (error) throw new Error(`claim_drop : ${error.message}`);

  switch (data?.result) {
    case 'already': return interaction.editReply('✅ Tu as déjà réclamé ce drop.');
    case 'closed':
    case 'not_found': return interaction.editReply('❌ Trop tard : ce drop est terminé.');
    case 'won': break;
    default: throw new Error(`Réponse claim_drop inattendue : ${JSON.stringify(data)}`);
  }

  const grant = await grantReward(client, d, userId, `Drop #${id}`);

  if (data.closed) await finalizeDrop(client, id);
  else scheduleDropRefresh(client, id);

  if (!grant.ok) {
    console.error(`[Drop #${id}] Récompense non attribuée à ${userId} : ${grant.error}`);
    const channel = await client.channels.fetch(d.channel_id).catch(() => null);
    await channel?.send({
      content: `⚠️ <@${d.host_id}>, la récompense du drop #${id} n'a pas pu être attribuée automatiquement à <@${userId}>.`,
      allowedMentions: { users: [d.host_id] },
    }).catch(() => {});
    return interaction.editReply(`🏆 Tu es le n°**${data.position}** ! Mais : ${grant.error}`);
  }
  if (grant.manual) {
    return interaction.editReply(`🏆 Tu es le n°**${data.position}** ! Lot : **${d.prize}**. <@${d.host_id}> va te le remettre.`);
  }
  return interaction.editReply(`🏆 Tu es le n°**${data.position}** ! Récompense attribuée : ${describeReward(d)}.`);
}

// ─── Planificateur ────────────────────────────────────────────────────────────
let schedulerStarted = false;
let tickRunning = false;
let lastFlush = 0;

async function tick(client) {
  if (tickRunning) return;
  tickRunning = true;
  const db = client.db;
  const nowIso = new Date().toISOString();

  try {
    // 1. Giveaways arrivés à échéance
    const { data: due } = await db.from('giveaways').select('id')
      .eq('status', 'active').lte('ends_at', nowIso);
    for (const { id } of due ?? []) {
      await endGiveaway(client, id).catch(err => console.error(`[Giveaway #${id}] Fin :`, err.message));
    }

    // 2. Gagnants dont le délai de réclamation est dépassé → auto-reroll
    const { data: late } = await db.from('giveaway_winners').select('id')
      .eq('status', 'pending').lte('claim_deadline', nowIso);
    for (const w of late ?? []) {
      await expireWinner(client, w).catch(err => console.error(`[Giveaway] Expiration gagnant ${w.id} :`, err.message));
    }

    // 3. Drops expirés
    const { data: dueDrops } = await db.from('drops').select('id')
      .eq('status', 'active').not('expires_at', 'is', null).lte('expires_at', nowIso);
    for (const { id } of dueDrops ?? []) {
      const { data: closed } = await db.from('drops').update({ status: 'ended' })
        .eq('id', id).eq('status', 'active').select().maybeSingle();
      if (closed) await finalizeDrop(client, id).catch(err => console.error(`[Drop #${id}] Fin :`, err.message));
    }

    // 4. Compteur de messages
    if (Date.now() - lastFlush >= CONFIG.MESSAGE_FLUSH_INTERVAL_MS) {
      lastFlush = Date.now();
      await flushMessageCounts(db);
    }
  } catch (err) {
    console.error('[Giveaway Scheduler] Erreur :', err.message);
  } finally {
    tickRunning = false;
  }
}

function startScheduler(client) {
  if (schedulerStarted) return;
  schedulerStarted = true;
  tick(client);
  setInterval(() => tick(client), CONFIG.SCHEDULER_INTERVAL_MS);
  console.log('🎁 Planificateur giveaway/drop démarré.');
}

module.exports = {
  CONFIG,
  parseDuration, formatDuration, weightedSample, evaluateMember, buildGiveawayView, buildDropView,
  parseRewardOptions, checkChannelPermissions,
  trackMessage, flushMessageCounts,
  createGiveaway, endGiveaway, cancelGiveaway, rerollWinner,
  handleJoin, handleLeave, handleClaim,
  createDrop, handleDropClaim,
  startScheduler,
  messageUrl,
  _tick: tick,   // exposé pour les tests
};
