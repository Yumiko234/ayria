'use strict';

const {
  ActionRowBuilder, EmbedBuilder, MessageFlags,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const C = require('../utils/verificationConfig');
const V = require('../utils/verification');
const { sendDM } = require('../utils/dm');
const { sendLog, buildSanctionEmbed, LOG_TYPES } = require('./logManager');

const EPHEMERAL = [MessageFlags.Ephemeral];
const inflight = new Set(); // anti double-soumission simultanée

module.exports = {
  name: 'interactionCreate',

  async execute(interaction, client) {
    try {
      if (interaction.isButton() && interaction.customId === 'verif:start') return await onStart(interaction, client);
      if (interaction.isModalSubmit() && interaction.customId === 'verif:answer') return await onSubmit(interaction, client);
    } catch (err) {
      console.error('[Vérification] Erreur interaction :', err);
      const payload = { content: '❌ Une erreur est survenue. Réessaie dans un instant.' };
      try {
        if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
        else await interaction.reply({ ...payload, flags: EPHEMERAL });
      } catch { /* interaction expirée */ }
    }
  },
};

// ─── Clic sur le bouton : contrôles puis affichage du modal ──────────────────
async function onStart(interaction, client) {
  if (interaction.guildId !== C.GUILD_ID) return;
  const { user, member } = interaction;

  if (member.roles.cache.has(C.ROLE_MEMBRE)) {
    return interaction.reply({ content: '✅ Tu es déjà vérifié.', flags: EPHEMERAL });
  }

  if (!V.isEligible(user.id)) {
    return interaction.reply({
      content: `⏳ Ton compte Discord a été créé il y a moins de 3 jours. Tu pourras te vérifier à partir du ${V.eligibleAtText(user.id)}.`,
      flags: EPHEMERAL,
    });
  }

  const row = await V.ensureQuestion(client.db, user.id);
  if (!row) {
    return interaction.reply({ content: '❌ Erreur technique, réessaie dans un instant.', flags: EPHEMERAL });
  }

  const modal = new ModalBuilder()
    .setCustomId('verif:answer')
    .setTitle('Vérification')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('answer')
        .setLabel(row.question) // ≤ 45 caractères (limite Discord) : « Combien font 59 + 59 ? » = 22
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ta réponse (un nombre)')
        .setMinLength(1)
        .setMaxLength(6)
        .setRequired(true),
    ));

  return interaction.showModal(modal);
}

// ─── Soumission du modal ─────────────────────────────────────────────────────
async function onSubmit(interaction, client) {
  if (interaction.guildId !== C.GUILD_ID) return;
  const { user, member } = interaction;

  if (inflight.has(user.id)) {
    return interaction.reply({ content: '⏳ Une réponse est déjà en cours de traitement.', flags: EPHEMERAL });
  }
  inflight.add(user.id);

  try {
    await interaction.deferReply({ flags: EPHEMERAL });
    const db = client.db;

    if (member.roles.cache.has(C.ROLE_MEMBRE)) {
      return interaction.editReply('✅ Tu es déjà vérifié.');
    }
    if (!V.isEligible(user.id)) {
      return interaction.editReply(`⏳ Ton compte pourra se vérifier à partir du ${V.eligibleAtText(user.id)}.`);
    }

    const row = await V.getRow(db, user.id);
    if (!row || row.status !== 'pending' || !row.question) {
      return interaction.editReply('⌛ Session expirée : clique à nouveau sur le bouton de vérification.');
    }

    const raw = interaction.fields.getTextInputValue('answer').trim();
    const correct = /^-?\d{1,6}$/.test(raw) && Number(raw) === row.answer;

    // ✅ Bonne réponse
    if (correct) {
      try {
        await member.roles.add(C.ROLE_MEMBRE, 'Vérification réussie');
      } catch (err) {
        console.error('[Vérification] Impossible d\'attribuer le rôle membre :', err.message);
        return interaction.editReply("❌ Je n'ai pas pu t'attribuer le rôle (permissions du bot). Préviens le staff.");
      }
      await member.roles.remove(C.ROLE_NON_VERIFIE, 'Vérification réussie').catch(() => {});
      await V.updateRow(db, user.id, { status: 'verified', question: null, answer: null, verified_at: new Date().toISOString() });

      try {
        await sendLog(interaction.guild, LOG_TYPES.MEMBER, new EmbedBuilder()
          .setColor(C.COLOR)
          .setTitle('✅ Membre vérifié')
          .addFields({ name: 'Utilisateur', value: `${user.tag} (<@${user.id}>)`, inline: true })
          .setFooter({ text: `ID utilisateur : ${user.id}` })
          .setTimestamp());
      } catch (err) { console.error('[Vérification] Log :', err.message); }

      return interaction.editReply('✅ Vérification réussie, bienvenue !');
    }

    // ❌ Mauvaise réponse
    const attempts = row.attempts + 1;

    if (attempts < C.MAX_ATTEMPTS) {
      await V.updateRow(db, user.id, { attempts });
      return interaction.editReply(`❌ Mauvaise réponse (${attempts}/${C.MAX_ATTEMPTS}). Clique à nouveau sur le bouton pour réessayer.`);
    }

    if (row.round < C.MAX_ROUNDS) {
      const q = V.generateQuestion();
      await V.updateRow(db, user.id, { round: row.round + 1, attempts: 0, question: q.question, answer: q.answer });
      return interaction.editReply(
        `❌ Mauvaise réponse (${attempts}/${C.MAX_ATTEMPTS}). Tu as épuisé tes essais pour cette question : une **nouvelle question** t'attend avec ${C.MAX_ATTEMPTS} nouveaux essais. Clique à nouveau sur le bouton.`,
      );
    }

    return await kickMember(interaction, client, row);
  } finally {
    inflight.delete(user.id);
  }
}

// ─── Échec définitif : MP puis kick ──────────────────────────────────────────
async function kickMember(interaction, client, row) {
  const { user, member, guild } = interaction;
  const db = client.db;
  const total = C.MAX_ATTEMPTS * C.MAX_ROUNDS;
  const raison = `Échec de la vérification (${total} réponses fausses)`;

  await sendDM(client, user.id, {
    embeds: [new EmbedBuilder()
      .setColor('#FF8800')
      .setTitle('👢 Expulsion — vérification échouée')
      .setDescription(`Tu as été expulsé de **${guild.name}** après ${total} réponses fausses aux questions de vérification. Tu peux rejoindre le serveur à nouveau et retenter ta chance.`)
      .setTimestamp()],
  });

  if (!member.kickable) {
    console.warn(`[Vérification] ${user.tag} ne peut pas être expulsé (hiérarchie/permissions).`);
    await V.updateRow(db, user.id, { status: 'kicked' });
    return interaction.editReply("❌ Trop de réponses fausses. Contacte le staff pour poursuivre ta vérification.");
  }

  try {
    await member.kick(raison);
  } catch (err) {
    console.error('[Vérification] Échec du kick :', err.message);
    return interaction.editReply('❌ Trop de réponses fausses. Contacte le staff pour poursuivre ta vérification.');
  }

  await V.updateRow(db, user.id, { status: 'kicked', question: null, answer: null });

  // Même enregistrement que l'anti-pub : table sanctions + log
  const { data: inserted, error: dbError } = await db.from('sanctions').insert({
    user_id: user.id,
    guild_id: guild.id,
    type: 'kick',
    raison,
    date: new Date().toISOString(),
    moderator_id: null,
  }).select().single();
  if (dbError) console.error('[Vérification] Insertion sanction :', dbError.message);

  try {
    await sendLog(guild, LOG_TYPES.SANCTION, buildSanctionEmbed('kick', user, null, raison, { caseId: inserted?.id }));
  } catch (err) { console.error('[Vérification] Log sanction :', err.message); }

  return interaction.editReply("❌ Trop de réponses fausses : tu as été expulsé du serveur. Tu peux le rejoindre à nouveau pour retenter.");
}
