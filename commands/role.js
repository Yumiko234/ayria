const {
  SlashCommandBuilder,
  InteractionContextType,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const { hasAnyRole, ADMIN_ROLES, DEVELOPER_ID } = require('../utils/permissions');
const { sendLog, LOG_TYPES } = require('../events/logManager');

const COLOR       = 9413506; // #8FA382
const MAX_TARGETS = 25;
const MAX_ROLES   = 10;

// Un rôle portant l'une de ces permissions ne peut être géré que par le développeur / le propriétaire.
const DANGEROUS_PERMS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ModerateMembers,
];

/** Extrait les IDs (mentions <@id>, <@&id> ou IDs bruts) d'une chaîne, sans doublon. */
const extractIds = (str) => [...new Set(str.match(/\d{17,20}/g) ?? [])];

const addCommonOptions = (sub, verbe) =>
  sub
    .addStringOption(o =>
      o.setName('membres')
        .setDescription(`Membre(s) visé(s) : mentions ou IDs, séparés par des espaces (max ${MAX_TARGETS})`)
        .setRequired(true))
    .addStringOption(o =>
      o.setName('roles')
        .setDescription(`Rôle(s) à ${verbe} : mentions ou IDs, séparés par des espaces (max ${MAX_ROLES})`)
        .setRequired(true))
    .addStringOption(o =>
      o.setName('raison')
        .setDescription('Raison (facultatif, inscrite dans le journal d\'audit)')
        .setRequired(false));

const truncate = (str, max) => (str.length > max ? `${str.slice(0, max - 1)}…` : str);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Ajoute ou retire des rôles à un ou plusieurs membres')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand(s => addCommonOptions(s.setName('ajouter').setDescription('Ajoute des rôles à des membres'), 'ajouter'))
    .addSubcommand(s => addCommonOptions(s.setName('retirer').setDescription('Retire des rôles à des membres'), 'retirer')),

  async execute(interaction) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const { guild } = interaction;
    const executor  = interaction.member;

    // 🛡️ 1. Autorisation (rôles staff de permissions.js)
    if (!hasAnyRole(executor, ADMIN_ROLES)) {
      return interaction.editReply({ content: '❌ Tu n\'as pas la permission d\'utiliser cette commande.' });
    }

    const action     = interaction.options.getSubcommand(); // 'ajouter' | 'retirer'
    const adding     = action === 'ajouter';
    const raisonSaisie = interaction.options.getString('raison');
    const memberIds  = extractIds(interaction.options.getString('membres'));
    const roleIds    = extractIds(interaction.options.getString('roles'));

    if (!memberIds.length) return interaction.editReply({ content: '❌ Aucun membre valide détecté (utilise des mentions ou des IDs).' });
    if (!roleIds.length)   return interaction.editReply({ content: '❌ Aucun rôle valide détecté (utilise des mentions ou des IDs).' });
    if (memberIds.length > MAX_TARGETS) return interaction.editReply({ content: `❌ Maximum ${MAX_TARGETS} membres par commande.` });
    if (roleIds.length > MAX_ROLES)     return interaction.editReply({ content: `❌ Maximum ${MAX_ROLES} rôles par commande.` });

    const isPrivileged = interaction.user.id === DEVELOPER_ID || guild.ownerId === interaction.user.id;
    const botHighest   = guild.members.me.roles.highest;
    const execHighest  = executor.roles.highest;

    // 🛡️ 2. Validation des rôles
    const validRoles = [];
    const refusedRoles = [];
    for (const id of roleIds) {
      const role = guild.roles.cache.get(id);
      if (!role)                         { refusedRoles.push(`❓ \`${id}\` : rôle introuvable`); continue; }
      if (role.id === guild.id)          { refusedRoles.push(`⛔ ${role} : @everyone n'est pas gérable`); continue; }
      if (role.managed)                  { refusedRoles.push(`⛔ ${role} : rôle géré par une intégration`); continue; }
      if (botHighest.comparePositionTo(role) <= 0) {
        refusedRoles.push(`⛔ ${role} : au-dessus (ou au niveau) de mon rôle le plus haut`); continue;
      }
      if (!isPrivileged && execHighest.comparePositionTo(role) <= 0) {
        refusedRoles.push(`⛔ ${role} : au-dessus (ou au niveau) de ton rôle le plus haut`); continue;
      }
      if (!isPrivileged && DANGEROUS_PERMS.some(p => role.permissions.has(p))) {
        refusedRoles.push(`⛔ ${role} : rôle à permissions sensibles (réservé au développeur / propriétaire)`); continue;
      }
      validRoles.push(role);
    }

    if (!validRoles.length) {
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(COLOR).setTitle('🎭 Aucun rôle applicable')
          .setDescription(truncate(refusedRoles.join('\n'), 4000))],
      });
    }

    // 🔁 3. Application membre par membre
    const reason = truncate(`${raisonSaisie ?? 'Aucune raison fournie'} — par ${interaction.user.tag} (${interaction.user.id})`, 512);
    const lines = [];
    const changes = []; // { member, roles }

    for (const id of memberIds) {
      const target = await guild.members.fetch(id).catch(() => null);
      if (!target) { lines.push(`❓ <@${id}> : introuvable sur le serveur`); continue; }

      if (!isPrivileged && target.id !== interaction.user.id && execHighest.comparePositionTo(target.roles.highest) <= 0) {
        lines.push(`⛔ ${target} : ton rôle le plus haut n'est pas supérieur au sien`); continue;
      }
      if (!target.manageable) {
        lines.push(`⛔ ${target} : je ne peux pas modifier ses rôles (hiérarchie)`); continue;
      }

      const toChange = validRoles.filter(r => (adding ? !target.roles.cache.has(r.id) : target.roles.cache.has(r.id)));
      if (!toChange.length) {
        lines.push(`ℹ️ ${target} : rien à ${adding ? 'ajouter' : 'retirer'} (déjà à jour)`); continue;
      }

      try {
        if (adding) await target.roles.add(toChange, reason);
        else        await target.roles.remove(toChange, reason);
        changes.push({ member: target, roles: toChange });
        lines.push(`✅ ${target} : ${toChange.map(r => `${r}`).join(', ')}`);
      } catch (err) {
        console.error(`[/role ${action}] Échec sur ${id} :`, err);
        lines.push(`❌ ${target} : erreur Discord (${err.code ?? 'inconnue'})`);
      }
    }

    // 🧾 4. Réponse éphémère
    const description = [
      ...lines,
      ...(refusedRoles.length ? ['', '**Rôles ignorés :**', ...refusedRoles] : []),
    ].join('\n');

    const embed = new EmbedBuilder()
      .setColor(COLOR)
      .setTitle(adding ? '🎭 Rôles ajoutés' : '🎭 Rôles retirés')
      .setDescription(truncate(description, 4000))
      .setFooter({ text: `${changes.length}/${memberIds.length} membre(s) modifié(s)` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    // 📜 5. Log (le journal automatique de index.js n'indique que le bot comme exécutant)
    if (changes.length) {
      const logEmbed = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(adding ? '🎭 Rôles ajoutés (commande /role)' : '🎭 Rôles retirés (commande /role)')
        .addFields(
          { name: 'Modérateur', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
          { name: 'Raison',     value: raisonSaisie ?? '—', inline: true },
          {
            name: 'Détail',
            value: truncate(changes.map(c => `<@${c.member.id}> → ${c.roles.map(r => `<@&${r.id}>`).join(', ')}`).join('\n'), 1024),
          },
        )
        .setTimestamp();
      await sendLog(guild, LOG_TYPES.ROLE_UPDATE, logEmbed).catch(err => console.error('[/role] sendLog :', err));
    }
  },
};