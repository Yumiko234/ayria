'use strict';

/**
 * Configuration du système de vérification (serveur officiel uniquement).
 */
module.exports = {
  GUILD_ID:         '1518048523818373300',
  CHANNEL_ID:       '1534931221006647407',
  ROLE_MEMBRE:      '1518297565655859280', // rôle « Visiteur » (= membre vérifié)
  ROLE_NON_VERIFIE: '1570038567512571964',

  COLOR: '#8FA382',

  MIN_ACCOUNT_AGE_MS:  3 * 24 * 60 * 60 * 1000, // âge minimum du compte Discord pour pouvoir répondre
  MAX_ATTEMPTS:        3,                        // essais par question
  MAX_ROUNDS:          2,                        // nombre de questions ; échec de la dernière = kick

  WELCOME_DM:          true,                     // MP envoyé à l'arrivée
  REMINDER_INTERVAL_MS: 6 * 60 * 60 * 1000,      // rappel toutes les 6 h (membres éligibles uniquement)
  MAX_REMINDERS:       null,                     // null = illimité ; sinon nombre maximum de rappels par membre
  SCHEDULER_TICK_MS:   10 * 60 * 1000,           // fréquence de vérification des rappels dus
};
