
const { getAutomodConfig, incrementHoneypotCatches } = require('../utils/automodConfig');
const { hasAnyRole, MODREMOVE_ROLES, DEVELOPER_ID } = require('../utils/permissions');
const { PermissionFlagsBits } = require('discord.js');

function isStaff(member) {
  if (!member) return false;
  if (member.user?.id === DEVELOPER_ID) return true;
  if (member.permissions.has(PermissionFlagsBits.BanMembers)) return true;
  return hasAnyRole(member, MODREMOVE_ROLES);
}

async function updatePreventionEmbed(guild, db, config) {
  if (!config.honeypot_channel_id || !config.honeypot_message_id) return;
  const { buildHoneypotPreventionEmbed } = require('./logManager');

  try {
    const channel = await guild.channels.fetch(config.honeypot_channel_id).catch(() => null);
    if (!channel) return;
    const msg = await channel.messages.fetch(config.honeypot_message_id).catch(() => null);
    if (!msg) return; // le message a été supprimé manuellement, on ne le recrée pas automatiquement
    await msg.edit({ embeds: [buildHoneypotPreventionEmbed(config.honeypot_catches)] });
  } catch (err) {
    console.error('[Honeypot] Impossible de mettre à jour l\'embed de prévention :', err.message);
  }
}

module.exports = {
  name: 'messageCreate',
  async execute(message, client) {
    if (message.author.bot) return;
    if (!message.guild) return;

    const db = client.db;
    const config = await getAutomodConfig(db, message.guild.id);
    if (!config.honeypot_channel_id) return;
    if (message.channel.id !== config.honeypot_channel_id) return;

    // 🛡️ Le staff peut poster dans le salon (pour le configurer, tester, etc.) sans être banni
    if (isStaff(message.member)) return;

    const { buildHoneypotEmbed, buildSanctionEmbed, buildAutoBanDMEmbed, sendLog, LOG_TYPES } = require('./logManager');
    const raison = 'Piège honeypot déclenché : message envoyé dans un salon leurre';
    const contentSnapshot = message.content?.slice(0, 1024) || '*[pièce jointe / vide]*';
    const date = new Date().toISOString();

    await message.delete().catch(() => {});

    try {
      await message.author.send({ embeds: [buildAutoBanDMEmbed(message.guild.name, raison, date, 'Honeypot')] });
    } catch { /* DMs fermés, on ignore */ }

    const member = message.member;
    if (!member || !member.bannable) {
      console.warn(`[Honeypot] Impossible de bannir ${message.author.tag} (hiérarchie/permissions insuffisantes).`);
      const alertEmbed = buildHoneypotEmbed(message, contentSnapshot, 'ÉCHEC DU BAN — action manuelle requise');
      await sendLog(message.guild, LOG_TYPES.AUTO_MOD, alertEmbed);
      return;
    }

    try {
      await message.guild.members.ban(message.author, { reason: raison, deleteMessageSeconds: 3600 });

      const { data: insertedSanction, error } = await db
        .from('sanctions')
        .insert({
          user_id:      message.author.id,
          guild_id:     message.guild.id,
          type:         'ban',
          raison,
          date,
          moderator_id: null,
        })
        .select()
        .single();

      if (error) console.error('[Honeypot] Erreur insertion Supabase :', error.message);

      const sanctionEmbed = buildSanctionEmbed('ban', message.author, null, raison, { caseId: insertedSanction?.id });
      await sendLog(message.guild, LOG_TYPES.SANCTION, sanctionEmbed);

      const alertEmbed = buildHoneypotEmbed(message, contentSnapshot, 'BANNI AUTOMATIQUEMENT', insertedSanction?.id);
      await sendLog(message.guild, LOG_TYPES.AUTO_MOD, alertEmbed);

      // 🎯 Mise à jour du compteur + de l'embed persistant dans le salon honeypot
      const newCatches = await incrementHoneypotCatches(db, message.guild.id);
      const updatedConfig = { ...config, honeypot_catches: newCatches };
      await updatePreventionEmbed(message.guild, db, updatedConfig);

      console.log(`[Honeypot] ${message.author.tag} banni automatiquement (salon leurre). Total : ${newCatches}.`);
    } catch (err) {
      console.error(`[Honeypot] Échec du ban pour ${message.author.tag} :`, err.message);
    }
  },
};