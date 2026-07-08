const { PermissionFlagsBits } = require('discord.js');
const { getAutomodConfig } = require('../utils/automodConfig');
const { hasAnyRole, MODREMOVE_ROLES, DEVELOPER_ID } = require('../utils/permissions');

// ─────────────────────────────────────────────────────────────────────────
// ⚙️ Réglages (à ajuster selon le taux de faux positifs constaté)
// ─────────────────────────────────────────────────────────────────────────
const BAN_THRESHOLD    = 6; // score ≥ ce seuil → ban automatique immédiat
const REVIEW_THRESHOLD = 3; // score ≥ ce seuil (mais < BAN_THRESHOLD) → juste un signalement staff, pas de ban

// Domaines/mots-clés connus dans des liens de phishing Discord/Steam/crypto.
// Volontairement large : on matche des FRAGMENTS de hostname, pas le domaine entier,
// pour couvrir les variations (discord-nitro-gift.xyz, dlscord-app.com, etc.)
const PHISHING_HOST_FRAGMENTS = [
  'dlscord', 'discrod', 'diccord', 'dis-cord', 'discordapp-nitro', 'discord-nitro',
  'discordgift', 'discord-gift', 'discord-airdrop', 'nitro-free', 'free-nitro',
  'steamcommunlty', 'steamcomunity', 'steancommunity', 'steamcommunity-',
  'steam-community', 'steamgift', 'steam-gift',
];

const IP_URL_REGEX         = /https?:\/\/(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?/i;
const URL_REGEX            = /https?:\/\/[^\s]+/gi;
const SHORTENER_REGEX      = /(bit\.ly|tinyurl\.com|cutt\.ly|is\.gd|t\.co|shorturl\.at|rebrand\.ly|s\.id|v\.gd|grabify\.link|iplogger\.(?:org|com|ru))/i;
const SUSPICIOUS_TLD_REGEX = /\.(xyz|top|gq|cf|tk|ml|icu|club|rest|surge)(\/|\b)/i;
const EXECUTABLE_ATTACH_REGEX = /\.(exe|scr|bat|cmd|vbs|jar|msi|ps1)$/i;

// Mots-clés typiques des arnaques crypto / phishing (FR + EN)
const SCAM_KEYWORDS = [
  /seed\s?phrase/i, /phrase\s?secr[eè]te/i, /cl[ée]\s?priv[ée]e/i, /private\s?key/i,
  /connect(ez)?\s?(your|votre)\s?wallet/i, /portefeuille\s?crypto/i,
  /airdrop\s?(gratuit|exclusif)?/i, /doubl(e|ez)\s?(vos|your)\s?(btc|eth|crypto)/i,
  /gagnez?\s?\d+\s?(btc|eth|\$|€)/i, /investissement\s?crypto\s?garanti/i,
  /nitro\s?gratuit/i, /free\s?nitro/i, /\bsteam\s?gift\b/i,
  /vous\s?avez\s?[ée]t[ée]\s?s[ée]lectionn[ée]/i, /congratulations,?\s?you\s?(have\s?)?won/i,
  /claim\s?your\s?(reward|nitro|gift)/i, /verify\s?your\s?account/i, /v[ée]rifiez?\s?votre\s?compte/i,
  /discord\s?nitro\s?free/i,
];

function extractHostnames(content) {
  const urls = content.match(URL_REGEX) || [];
  const hosts = [];
  for (const raw of urls) {
    try {
      hosts.push(new URL(raw).hostname.toLowerCase());
    } catch {
      /* URL invalide, on ignore */
    }
  }
  return { urls, hosts };
}

function isWhitelisted(hosts, whitelist) {
  if (!whitelist?.length) return false;
  return hosts.some(host => whitelist.some(w => host === w || host.endsWith(`.${w}`)));
}

/**
 * Analyse un message et retourne { score, reasons[] }.
 */
function analyzeMessage(message, whitelist) {
  const content = message.content || '';
  let score = 0;
  const reasons = [];

  const { urls, hosts } = extractHostnames(content);

  if (urls.length && isWhitelisted(hosts, whitelist)) {
    return { score: 0, reasons: [] }; // domaine de confiance → on n'analyse pas plus loin
  }

  // Domaine de phishing connu
  if (hosts.some(h => PHISHING_HOST_FRAGMENTS.some(frag => h.includes(frag)))) {
    score += 5;
    reasons.push('Nom de domaine imitant Discord/Steam (typosquatting)');
  }

  // Lien vers une IP brute
  if (IP_URL_REGEX.test(content)) {
    score += 4;
    reasons.push('Lien pointant vers une adresse IP directe');
  }

  // Raccourcisseur d'URL / logger IP
  if (SHORTENER_REGEX.test(content)) {
    score += 1;
    reasons.push("Utilisation d'un raccourcisseur de lien");
  }

  // TLD suspect
  if (SUSPICIOUS_TLD_REGEX.test(content)) {
    score += 1;
    reasons.push('Extension de domaine à risque (.xyz, .top, .tk…)');
  }

  // Mots-clés d'arnaque crypto / phishing
  const matchedKeywords = SCAM_KEYWORDS.filter(re => re.test(content));
  if (matchedKeywords.length) {
    score += Math.min(matchedKeywords.length * 2, 6); // plafonné pour éviter l'inflation
    reasons.push(`${matchedKeywords.length} expression(s) typique(s) d'arnaque détectée(s)`);
  }

  // Ping de masse + lien = pattern raid/scam classique
  if ((message.mentions.everyone) && urls.length > 0) {
    score += 3;
    reasons.push('Mention @everyone/@here accompagnée d\'un lien');
  }

  // Beaucoup de liens dans un seul message
  if (urls.length >= 3) {
    score += 2;
    reasons.push(`${urls.length} liens dans un seul message`);
  }

  // Pièce jointe exécutable (token grabber classique)
  const hasExecutable = message.attachments.some(a => EXECUTABLE_ATTACH_REGEX.test(a.name || ''));
  if (hasExecutable) {
    score += 6;
    reasons.push('Pièce jointe exécutable (.exe/.bat/.jar/.scr…)');
  }

  return { score, reasons };
}

function isStaff(member) {
  if (!member) return false;
  if (member.user?.id === DEVELOPER_ID) return true;
  if (member.permissions.has(PermissionFlagsBits.BanMembers)) return true;
  return hasAnyRole(member, MODREMOVE_ROLES);
}

module.exports = {
  name: 'messageCreate',
  async execute(message, client) {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (!message.content && message.attachments.size === 0) return;

    const db = client.db;
    const config = await getAutomodConfig(db, message.guild.id);
    if (!config.enabled) return;

    // 🛡️ Le staff est toujours ignoré par l'auto-mod
    if (isStaff(message.member)) return;

    const { score, reasons } = analyzeMessage(message, config.whitelist);
    if (score < REVIEW_THRESHOLD) return;

    const { buildAutoModAlertEmbed, buildSanctionEmbed, sendLog, LOG_TYPES } = require('./logManager');

    // ── Score élevé : ban automatique ─────────────────────────────────────
    if (score >= BAN_THRESHOLD) {
      const raison = `Détection automatique (score ${score}) : ${reasons.join(', ')}`;
      const contentSnapshot = message.content?.slice(0, 1024) || '*[pièce jointe uniquement]*';
      const date = new Date().toISOString();

      await message.delete().catch(() => {});

      const { buildAutoBanDMEmbed } = require('./logManager');
      try { await message.author.send({ embeds: [buildAutoBanDMEmbed(message.guild.name, raison, date, 'Anti-Scam')] }); }
      catch { /* DMs fermés, on ignore */ }

      const member = message.member;
      if (!member || !member.bannable) {
        console.warn(`[AntiScam] Impossible de bannir ${message.author.tag} (hiérarchie/permissions insuffisantes).`);
        const alertEmbed = buildAutoModAlertEmbed(message, reasons, score, contentSnapshot, 'ÉCHEC DU BAN — action manuelle requise');
        await sendLog(message.guild, LOG_TYPES.AUTO_MOD, alertEmbed);
        return;
      }

      try {
        await message.guild.members.ban(message.author, { reason: raison, deleteMessageSeconds: 3600 });

        const { data: insertedSanction, error } = await db
          .from('sanctions')
          .insert({
            user_id:      message.author.id,
            guild_id:     message.guild.id,
            type:         'ban',
            raison,
            date,
            moderator_id: null, // action automatique
          })
          .select()
          .single();

        if (error) console.error('[AntiScam] Erreur insertion Supabase :', error.message);

        const sanctionEmbed = buildSanctionEmbed('ban', message.author, null, raison, { caseId: insertedSanction?.id });
        await sendLog(message.guild, LOG_TYPES.SANCTION, sanctionEmbed);

        const alertEmbed = buildAutoModAlertEmbed(message, reasons, score, contentSnapshot, 'BANNI AUTOMATIQUEMENT', insertedSanction?.id);
        await sendLog(message.guild, LOG_TYPES.AUTO_MOD, alertEmbed);

        console.log(`[AntiScam] ${message.author.tag} banni automatiquement (score ${score}).`);
      } catch (err) {
        console.error(`[AntiScam] Échec du ban pour ${message.author.tag} :`, err.message);
      }
      return;
    }

    // ── Score modéré : on ne ban pas, on signale juste au staff ───────────
    const alertEmbed = buildAutoModAlertEmbed(message, reasons, score, message.content?.slice(0, 1024), 'À VÉRIFIER — sous le seuil de ban auto');
    await sendLog(message.guild, LOG_TYPES.AUTO_MOD, alertEmbed);
  },
};