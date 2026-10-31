// ─── Config AutoMod / Honeypot ─────────────────────────────────────────────
// Table Supabase requise : automod_config (voir sql/automod_migration.sql)
//
// Colonnes :
//   guild_id             text PRIMARY KEY
//   enabled              boolean      default true
//   honeypot_channel_id  text         nullable
//   honeypot_message_id  text         nullable  -- embed persistant affiché dans le salon
//   honeypot_catches     integer      default 0 -- compteur de comptes piégés
//   whitelist            text[]       default '{}'

const CACHE_TTL_MS = 30_000; // évite de spam Supabase à chaque message
const cache = new Map(); // guild_id -> { data, ts }

const DEFAULT_CONFIG = {
  guild_id: null,
  enabled: true, // 🛡️ activé par défaut : mieux vaut protéger dès l'install
  honeypot_channel_id: null,
  honeypot_message_id: null,
  honeypot_catches: 0,
  whitelist: [],
};

function invalidate(guildId) {
  cache.delete(guildId);
}

async function getAutomodConfig(db, guildId) {
  const cached = cache.get(guildId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  const { data, error } = await db
    .from('automod_config')
    .select('*')
    .eq('guild_id', guildId)
    .single();

  const config = error || !data
    ? { ...DEFAULT_CONFIG, guild_id: guildId }
    : { ...DEFAULT_CONFIG, ...data };

  cache.set(guildId, { data: config, ts: Date.now() });
  return config;
}

async function setEnabled(db, guildId, enabled) {
  const { error } = await db
    .from('automod_config')
    .upsert({ guild_id: guildId, enabled }, { onConflict: 'guild_id' });
  invalidate(guildId);
  return error;
}

/**
 * Configure le salon honeypot. Si un messageId est fourni, réinitialise aussi
 * le compteur de captures (nouvelle mise en service du piège).
 */
async function setHoneypotChannel(db, guildId, channelId, messageId = null) {
  const payload = { guild_id: guildId, honeypot_channel_id: channelId };
  if (channelId) {
    payload.honeypot_message_id = messageId;
    payload.honeypot_catches = 0;
  } else {
    payload.honeypot_message_id = null;
  }

  const { error } = await db
    .from('automod_config')
    .upsert(payload, { onConflict: 'guild_id' });
  invalidate(guildId);
  return error;
}

async function setHoneypotMessageId(db, guildId, messageId) {
  const { error } = await db
    .from('automod_config')
    .upsert({ guild_id: guildId, honeypot_message_id: messageId }, { onConflict: 'guild_id' });
  invalidate(guildId);
  return error;
}

/**
 * Incrémente le compteur de captures honeypot et retourne la nouvelle valeur.
 */
async function incrementHoneypotCatches(db, guildId) {
  const config = await getAutomodConfig(db, guildId);
  const newCount = (config.honeypot_catches || 0) + 1;

  const { error } = await db
    .from('automod_config')
    .upsert({ guild_id: guildId, honeypot_catches: newCount }, { onConflict: 'guild_id' });
  invalidate(guildId);

  if (error) {
    console.error('[automodConfig] Erreur incrementHoneypotCatches :', error.message);
    return config.honeypot_catches || 0;
  }
  return newCount;
}

async function addWhitelistDomain(db, guildId, domain) {
  const config = await getAutomodConfig(db, guildId);
  const whitelist = Array.from(new Set([...config.whitelist, domain.toLowerCase()]));
  const { error } = await db
    .from('automod_config')
    .upsert({ guild_id: guildId, whitelist }, { onConflict: 'guild_id' });
  invalidate(guildId);
  return error;
}

async function removeWhitelistDomain(db, guildId, domain) {
  const config = await getAutomodConfig(db, guildId);
  const whitelist = config.whitelist.filter(d => d !== domain.toLowerCase());
  const { error } = await db
    .from('automod_config')
    .upsert({ guild_id: guildId, whitelist }, { onConflict: 'guild_id' });
  invalidate(guildId);
  return error;
}

module.exports = {
  getAutomodConfig,
  setEnabled,
  setHoneypotChannel,
  setHoneypotMessageId,
  incrementHoneypotCatches,
  addWhitelistDomain,
  removeWhitelistDomain,
  invalidate,
};