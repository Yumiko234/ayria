const gm = require('../utils/giveawayManager');

/**
 * Démarre le planificateur (fin des giveaways, auto-reroll, expiration des drops,
 * écriture du compteur de messages). Tout est lu en base : un redémarrage du bot
 * ne perd rien.
 */
module.exports = {
  name: 'ready',
  once: true,
  execute(client) {
    gm.startScheduler(client);
  },
};
