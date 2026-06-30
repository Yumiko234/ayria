// ─── IDs des rôles staff (utilisés pour les vérifications de permissions) ─────
const ROLE_IDS = {
  OWNEUSE:        '1518290149220290680',
  CO_OWNEUR:      '1518290096082915328',
  SUPERVISEUR:    '1519691553314967693',
  ADMINISTRATEUR: '1519095538912465067',
  GERANT_STAFF:   '1519461712313581748',
  RESPONSABLE:    '1519461680986456285',
  DJ1:            '1521186380057804853',
};

// Bypass développeur déjà utilisé sur les autres commandes du bot
const DEVELOPER_ID = '1327683141749444709';

// Rôles autorisés à utiliser /modremove
const MODREMOVE_ROLES = [
  ROLE_IDS.OWNEUSE,
  ROLE_IDS.CO_OWNEUR,
  ROLE_IDS.SUPERVISEUR,
  ROLE_IDS.ADMINISTRATEUR,
  ROLE_IDS.GERANT_STAFF,
  ROLE_IDS.RESPONSABLE,
];

// Rôles autorisés à utiliser /changelogs (= modremove + DJ1)
const CHANGELOGS_ROLES = [
  ...MODREMOVE_ROLES,
  ROLE_IDS.DJ1,
];

// Rôles autorisés à utiliser /clearlogs
const CLEARLOGS_ROLES = [
  ROLE_IDS.OWNEUSE,
  ROLE_IDS.CO_OWNEUR,
  ROLE_IDS.SUPERVISEUR,
  ROLE_IDS.ADMINISTRATEUR,
  ROLE_IDS.GERANT_STAFF,
];

/**
 * Vérifie si un membre possède au moins l'un des rôles fournis (ou est le développeur).
 * @param {import('discord.js').GuildMember} member
 * @param {string[]} roleIds
 * @returns {boolean}
 */
function hasAnyRole(member, roleIds) {
  if (!member) return false;
  if (member.user?.id === DEVELOPER_ID) return true;
  return roleIds.some(id => member.roles.cache.has(id));
}

module.exports = {
  ROLE_IDS,
  DEVELOPER_ID,
  MODREMOVE_ROLES,
  CHANGELOGS_ROLES,
  CLEARLOGS_ROLES,
  hasAnyRole,
};