'use strict';

/**
 * Envoi de MP centralisé et sûr : ne lève JAMAIS d'exception.
 * @returns {Promise<boolean>} true si le MP est parti, false sinon (MP fermés, utilisateur introuvable…)
 */
async function sendDM(client, userId, payload) {
  try {
    const user = await client.users.fetch(userId);
    await user.send(payload);
    return true;
  } catch (err) {
    // 50007 = « Cannot send messages to this user » (MP fermés) : cas normal, pas une erreur.
    if (err?.code !== 50007) console.error(`[DM] Échec d'envoi à ${userId} :`, err?.message ?? err);
    return false;
  }
}

module.exports = { sendDM };