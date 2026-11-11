// ─── IDs des rôles staff (utilisés pour les vérifications de permissions) ─────
const ROLE_IDS = {
  EA:   '1518290149220290680',
  GD:   '1518290096082915328',
  PF:   '1519691553314967693',
  AR:   '1519095538912465067',
  CG:   '1519461712313581748',
  SB:   '1519461680986456285',
  DJ1:   '1521186380057804853',
};

// Bypass développeur déjà utilisé sur les autres commandes du bot
const DEVELOPER_ID = '1519406500571775230';

// Rôles autorisés à utiliser /modremove
const MODREMOVE_ROLES = [
  ROLE_IDS.EA,
  ROLE_IDS.GD,
  ROLE_IDS.PF,
  ROLE_IDS.AR,
  ROLE_IDS.CG,
  ROLE_IDS.SB,
];

// Rôles autorisés à utiliser /reason (= modremove + DJ1)
const CHANGELOGS_ROLES = [
  ...MODREMOVE_ROLES,
  ROLE_IDS.DJ1,
];

// Rôles autorisés à utiliser /clearlogs
const CLEARLOGS_ROLES = [
  ROLE_IDS.EA,
  ROLE_IDS.GD,
  ROLE_IDS.PF,
];

// Rôles autorisés à utiliser /giveaway et /drop (= mêmes rôles que /modremove ; à ajuster)
const GIVEAWAY_ROLES = [...MODREMOVE_ROLES];

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
  GIVEAWAY_ROLES,
  hasAnyRole,
};