const gm = require('../utils/giveawayManager');

/** Alimente le compteur de messages (condition « messages_min » des giveaways). */
module.exports = {
  name: 'messageCreate',
  execute(message) {
    gm.trackMessage(message);
  },
};
