'use strict';

const { EmbedBuilder } = require('discord.js');
const C = require('../utils/verificationConfig');
const V = require('../utils/verification');
const { sendDM } = require('../utils/dm');

/**
 * Arrivée d'un membre sur le serveur officiel :
 *  - rôle « Non vérifié » + ligne « en attente » en base ;
 *  - MP d'accueil (désactivable dans verificationConfig.js).
 * Le mode raid garde la priorité (son handler expulse l'arrivant).
 */
module.exports = {
  name: 'guildMemberAdd',

  async execute(member, client) {
    if (member.guild.id !== C.GUILD_ID) return;
    if (member.user.bot) return;
    if (client.raidmode) return;

    try {
      await member.roles.add(C.ROLE_NON_VERIFIE, 'Nouvel arrivant : vérification requise');
    } catch (err) {
      console.error('[Vérification] Impossible d\'attribuer « Non vérifié » :', err.message);
    }

    await V.resetPending(client.db, member.id);

    if (!C.WELCOME_DM) return;

    const lines = [
      `Bienvenue sur **${member.guild.name}** !`,
      '',
      `Pour accéder au serveur, rends-toi dans <#${C.CHANNEL_ID}> et clique sur le bouton de vérification (un simple calcul).`,
    ];
    if (!V.isEligible(member.id)) {
      lines.push(
        '',
        `⏳ Ton compte Discord a été créé il y a moins de 3 jours : tu pourras te vérifier à partir du ${V.eligibleAtText(member.id)}.`,
      );
    }

    await sendDM(client, member.id, {
      embeds: [new EmbedBuilder().setColor(C.COLOR).setTitle('👋 Bienvenue !').setDescription(lines.join('\n')).setTimestamp()],
    });
  },
};
