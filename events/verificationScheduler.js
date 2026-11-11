'use strict';

const { EmbedBuilder } = require('discord.js');
const C = require('../utils/verificationConfig');
const V = require('../utils/verification');
const { sendDM } = require('../utils/dm');

const BATCH = 50;          // rappels max par passage
const DM_DELAY_MS = 1500;  // pause entre deux MP (évite de se faire limiter par Discord)
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Rappel par MP, toutes les 6 h, aux membres « Non vérifié » dont le compte est éligible.
 * Tout est lu en base : un redémarrage du bot ne perd rien. Aucune expulsion ici.
 */
async function tick(client) {
  const guild = client.guilds.cache.get(C.GUILD_ID);
  if (!guild) return;
  const db = client.db;

  const cutoff = new Date(Date.now() - C.REMINDER_INTERVAL_MS).toISOString();
  const { data: rows, error } = await db
    .from('verifications')
    .select('*')
    .eq('guild_id', C.GUILD_ID)
    .eq('status', 'pending')
    .or(`last_reminder_at.is.null,last_reminder_at.lte.${cutoff}`)
    .order('last_reminder_at', { ascending: true, nullsFirst: true })
    .limit(BATCH);

  if (error) { console.error('[Vérification] Scheduler :', error.message); return; }

  for (const row of rows ?? []) {
    if (!V.isEligible(row.user_id)) continue; // pas de rappel tant que le compte ne peut pas répondre
    if (C.MAX_REMINDERS !== null && row.reminder_count >= C.MAX_REMINDERS) continue;

    const member = await guild.members.fetch(row.user_id).catch(() => null);
    if (!member) { await V.updateRow(db, row.user_id, { status: 'left' }); continue; }
    if (member.roles.cache.has(C.ROLE_MEMBRE)) { await V.updateRow(db, row.user_id, { status: 'verified' }); continue; }

    await sendDM(client, row.user_id, {
      embeds: [new EmbedBuilder()
        .setColor(C.COLOR)
        .setTitle('🔔 Vérification en attente')
        .setDescription(`Tu n'as pas encore vérifié ton compte sur **${guild.name}**.\nRends-toi dans <#${C.CHANNEL_ID}> et clique sur le bouton de vérification (un simple calcul).`)
        .setTimestamp()],
    });

    // Mis à jour même si le MP échoue (MP fermés) pour ne pas réessayer à chaque passage
    await V.updateRow(db, row.user_id, {
      last_reminder_at: new Date().toISOString(),
      reminder_count: (row.reminder_count ?? 0) + 1,
    });
    await sleep(DM_DELAY_MS);
  }
}

module.exports = {
  name: 'ready',
  once: true,
  execute(client) {
    const run = () => tick(client).catch(err => console.error('[Vérification] Scheduler :', err));
    setTimeout(run, 30_000);
    setInterval(run, C.SCHEDULER_TICK_MS);
  },
};
