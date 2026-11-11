'use strict';

const { randomInt } = require('crypto');
const { SnowflakeUtil } = require('discord.js');
const C = require('./verificationConfig');

const TABLE = 'verifications';

// ─── Questions ───────────────────────────────────────────────────────────────
/** Calcul simple : addition, soustraction (résultat positif) ou multiplication. */
function generateQuestion() {
  const op = ['+', '-', '×'][randomInt(0, 3)];
  let a, b, answer;
  if (op === '+') {
    a = randomInt(11, 60); b = randomInt(11, 60); answer = a + b;
  } else if (op === '-') {
    a = randomInt(30, 100); b = randomInt(11, a); answer = a - b;
  } else {
    a = randomInt(3, 13); b = randomInt(3, 13); answer = a * b;
  }
  return { question: `Combien font ${a} ${op} ${b} ?`, answer };
}

// ─── Âge du compte ───────────────────────────────────────────────────────────
/** Timestamp (ms) à partir duquel le compte peut se vérifier (création du compte + délai minimum). */
function eligibleAt(userId) {
  return SnowflakeUtil.timestampFrom(userId) + C.MIN_ACCOUNT_AGE_MS;
}
function isEligible(userId, now = Date.now()) {
  return now >= eligibleAt(userId);
}
/** Texte avec timestamps Discord (affichés dans le fuseau et la langue de chaque lecteur). */
function eligibleAtText(userId) {
  const unix = Math.ceil(eligibleAt(userId) / 1000);
  return `<t:${unix}:F> (<t:${unix}:R>)`;
}

// ─── Base de données ─────────────────────────────────────────────────────────
async function getRow(db, userId) {
  const { data, error } = await db.from(TABLE).select('*').eq('guild_id', C.GUILD_ID).eq('user_id', userId).limit(1);
  if (error) { console.error('[Vérification] Lecture :', error.message); return null; }
  return data?.[0] ?? null;
}

async function updateRow(db, userId, patch) {
  const { error } = await db.from(TABLE).update(patch).eq('guild_id', C.GUILD_ID).eq('user_id', userId);
  if (error) console.error('[Vérification] Mise à jour :', error.message);
  return !error;
}

/** Nouvelle ligne « en attente » (réinitialise essais et manche). */
async function resetPending(db, userId, { withQuestion = false } = {}) {
  const q = withQuestion ? generateQuestion() : { question: null, answer: null };
  const row = {
    guild_id: C.GUILD_ID,
    user_id: userId,
    status: 'pending',
    question: q.question,
    answer: q.answer,
    round: 1,
    attempts: 0,
    last_reminder_at: null,
    reminder_count: 0,
    created_at: new Date().toISOString(),
    verified_at: null,
  };
  const { error } = await db.from(TABLE).upsert(row, { onConflict: 'guild_id,user_id' });
  if (error) { console.error('[Vérification] Upsert :', error.message); return null; }
  return row;
}

/** Garantit une ligne « en attente » avec une question valide, sans toucher aux essais en cours. */
async function ensureQuestion(db, userId) {
  const row = await getRow(db, userId);
  if (!row || row.status !== 'pending') return resetPending(db, userId, { withQuestion: true });
  if (row.question && row.answer !== null && row.answer !== undefined) return row;
  const q = generateQuestion();
  const ok = await updateRow(db, userId, { question: q.question, answer: q.answer });
  return ok ? { ...row, question: q.question, answer: q.answer } : null;
}

module.exports = {
  generateQuestion, eligibleAt, isEligible, eligibleAtText,
  getRow, updateRow, resetPending, ensureQuestion,
};
