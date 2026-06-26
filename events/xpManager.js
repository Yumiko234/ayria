/**
 * Progression logarithmique :
 * XP requis pour passer du niveau N au niveau N+1 :
 *   xpNeeded(N) = Math.floor(100 * Math.pow(N + 1, 1.6))
 *
 * Exemples :
 *   Niv 0 → 1 :   100 XP
 *   Niv 1 → 2 :   264 XP
 *   Niv 5 → 6 :   952 XP
 *   Niv 10 → 11 : 2 154 XP
 *   Niv 20 → 21 : 5 800 XP
 */

const XP_COOLDOWN_MS = 60_000;   // 1 message par minute donne de l'XP
const XP_PER_MESSAGE = { min: 15, max: 40 }; // XP aléatoire par message

function xpForLevel(level) {
  return Math.floor(100 * Math.pow(level + 1, 1.6));
}

/** XP total cumulé pour atteindre un niveau donné depuis le niveau 0 */
function totalXpForLevel(level) {
  let total = 0;
  for (let i = 0; i < level; i++) total += xpForLevel(i);
  return total;
}

/** Calcule le niveau et l'XP restant à partir de l'XP total brut */
function computeLevel(totalXp) {
  let level = 0;
  let remaining = totalXp;
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level++;
  }
  return { level, currentXp: remaining, xpNeeded: xpForLevel(level) };
}

function randomXp() {
  return Math.floor(Math.random() * (XP_PER_MESSAGE.max - XP_PER_MESSAGE.min + 1)) + XP_PER_MESSAGE.min;
}

/**
 * Traite un message : ajoute de l'XP, détecte les montées de niveau.
 * @returns {{ leveledUp: boolean, newLevel: number, role: string|null } | null}
 */
async function handleMessage(message) {
  const { guild, author, client } = message;
  if (!guild || author.bot) return null;

  const db  = client.db;
  const now = Date.now();

  // Récupère ou crée le profil
  let { data: profile, error } = await db
    .from('xp_profiles')
    .select('*')
    .eq('user_id', author.id)
    .eq('guild_id', guild.id)
    .single();

  if (error && error.code !== 'PGRST116') return null; // erreur autre que "not found"

  if (!profile) {
    profile = { user_id: author.id, guild_id: guild.id, xp: 0, level: 0, last_xp_at: 0 };
  }

  // Cooldown
  if (now - profile.last_xp_at < XP_COOLDOWN_MS) return null;

  const earned   = randomXp();
  const newXp    = profile.xp + earned;
  const oldLevel = profile.level;
  const { level: newLevel } = computeLevel(newXp);

  await db.from('xp_profiles').upsert(
    { user_id: author.id, guild_id: guild.id, xp: newXp, level: newLevel, last_xp_at: now },
    { onConflict: 'user_id,guild_id' }
  );

  const leveledUp = newLevel > oldLevel;
  let rewardRole  = null;

  if (leveledUp) {
    // Cherche s'il y a un rôle récompense pour ce niveau
    const { data: levelRow } = await db
      .from('xp_levels')
      .select('role_id')
      .eq('guild_id', guild.id)
      .eq('level', newLevel)
      .single();

    if (levelRow?.role_id) {
      rewardRole = levelRow.role_id;
      try {
        const member = await guild.members.fetch(author.id);
        await member.roles.add(levelRow.role_id, `Palier XP niveau ${newLevel}`);
      } catch (err) {
        console.error('[xpManager] Impossible d\'ajouter le rôle récompense :', err.message);
      }
    }
  }

  return leveledUp ? { leveledUp: true, newLevel, rewardRole } : null;
}

module.exports = { handleMessage, computeLevel, xpForLevel, totalXpForLevel, XP_COOLDOWN_MS };