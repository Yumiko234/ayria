// Tout en haut de index.js, modifie l'importation comme ceci :
const { Client, GatewayIntentBits, Collection, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { REST }         = require('@discordjs/rest');
const { Routes }       = require('discord-api-types/v10');
const { createClient } = require('@supabase/supabase-js');
const fs               = require('fs');
require('dotenv').config({ path: './login.env' });

// ─── Supabase ────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ———— EXPRESS
const express = require('express');
const app = express();
const PORT = process.envPORT || 3000;

app.get('/', (req, res) => {
    res.send("Le bot AYRIA est ligne !");
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur activé sur le port ${PORT}`);
});

// ─── Modules internes ─────────────────────────────────────────────────────────
const {
  LOG_TYPES,
  sendLog,
  buildSanctionEmbed,
  buildMessageDeleteEmbed,
  buildMessageEditEmbed,
  buildMemberJoinEmbed,
  buildMemberLeaveEmbed,
  buildRoleUpdateEmbed,
} = require('./events/logManager');

const { handleMessage } = require('./events/xpManager');

// ─── Client Discord ───────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers, // ✨ Requis pour intercepter les arrivées et le kick automatique
    GatewayIntentBits.GuildModeration,
  ],
});

client.commands = new Collection();
client.db       = supabase;
client.raidmode = false; // 🚨 Initialisation de la variable globale pour le /raidmode

// ─── Chargement des commandes ─────────────────────────────────────────────────
const loadCommands = () => {
  const commandFiles = fs.readdirSync('./commands').filter(f => f.endsWith('.js'));
  for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    if (command?.data?.name) {
      client.commands.set(command.data.name, command);
      console.log(`✅ Commande chargée : ${command.data.name}`);
    } else {
      console.error(`❌ Fichier invalide : ${file}`);
    }
  }
};

// ─── Enregistrement des slash commands (global) ────────────────
const registerSlashCommands = async () => {
  const rest     = new REST({ version: '10' }).setToken(process.env.TOKEN);
  const commands = Array.from(client.commands.values()).map(c => c.data.toJSON());
  try {
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log('✅ Commandes slash globales enregistrées.');
  } catch (err) {
    console.error('❌ Erreur enregistrement commandes :', err);
  }
};

// ─── Chargement automatique des Événements (Handler) ─────────────────────────
const eventFiles = fs.readdirSync('./events').filter(file => file.endsWith('.js'));
for (const file of eventFiles) {
  if (file === 'logManager.js' || file === 'xpManager.js') continue;
  
  try {
    const event = require(`./events/${file}`);
    if (event.name && typeof event.execute === 'function') {
      if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
      } else {
        client.on(event.name, (...args) => event.execute(...args, client));
      }
      console.log(`📂 Événement chargé : ${event.name}`);
    }
  } catch (err) {
    console.warn(`⚠️ Impossible de charger le fichier d'événement ${file} :`, err.message);
  }
}

// ─── Helper : config du serveur ───────────────────────────────────────────────
async function getGuildConfig(guildId) {
  const { data } = await supabase
    .from('guild_config')
    .select('*')
    .eq('guild_id', guildId)
    .single();
  return data ?? null;
}

// ─── Ready ────────────────────────────────────────────────────────────────────
client.once('ready', () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
  loadCommands();
  registerSlashCommands();
  client.user.setPresence({
    activities: [{ name: 'Mon créateur @yumiko0001', type: 3 }],
    status: 'online',
  });
});

// ─── Messages : cooldown + XP ─────────────────────────────────────────────────
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const channelId = message.channel.id;
  const userId    = message.author.id;

  // ── Anti-Liens d'invitation (Anti-Pub) ──────────────────────────────────────
  if (message.content) {
    const inviteRegex = /(https?:\/\/)?(www\.)?(discord\.(gg|io|me|li)|discord\.com\/invite)\/[a-zA-Z0-9\-]+/gi;
    
    if (inviteRegex.test(message.content)) {
      // 🛡️ Exception : On ignore le staff (permissions de gérer les messages)
      if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        
        // 1. Suppression du message contenant la pub
        await message.delete().catch(() => {});

        const date = new Date().toISOString();
        const raison = "Envoi de lien d'invitation Discord externe (Anti-Pub)";

        // 2. Insertion automatique du Warn dans Supabase
        const { error: dbError } = await supabase
          .from('sanctions')
          .insert({
            user_id:      userId,
            guild_id:     message.guild.id,
            type:         'kick',
            raison:       raison,
            date:         date,
            moderator_id: 'Automod', // Marqué comme sanctionné par le bot lui-même
          });

        if (dbError) console.error('[Anti-Pub] Erreur insertion Supabase :', dbError.message);

        // 3. Envoi du log via ton logManager
        const logEmbed = buildSanctionEmbed('kick', message.author, client.user, raison);
        await sendLog(message.guild, LOG_TYPES.SANCTION, logEmbed);

        // 4. Message d'avertissement temporaire dans le salon
        const warnMsg = await message.channel.send(`⚠️ ${message.author}, les invitations Discord externes sont strictement interdites. Un **warn** a été ajouté à votre dossier.`).catch(() => null);
        
        if (warnMsg) {
          setTimeout(() => warnMsg.delete().catch(() => {}), 6000);
        }
        
        return; // Arrêt complet pour ne pas traiter le cooldown ni distribuer d'XP
      }
    }
  }

  // ── Cooldown ───────────────────────────────────────────────────────────────
  const { data: cooldownConfig, error: cooldownErr } = await supabase
    .from('message_cooldowns')
    .select('last_message_timestamp')
    .eq('user_id', 'cooldown_config')
    .eq('channel_id', channelId)
    .single();

  if (!cooldownErr && cooldownConfig) {
    const cooldownMs = cooldownConfig.last_message_timestamp;

    const { data: userRow } = await supabase
      .from('message_cooldowns')
      .select('last_message_timestamp')
      .eq('user_id', userId)
      .eq('channel_id', channelId)
      .single();

    const now         = Date.now();
    const lastMsgTime = userRow?.last_message_timestamp ?? 0;

    if (now - lastMsgTime < cooldownMs) {
      message.delete().catch(() => {});
      message.author
        .send(`⏳ Veuillez attendre **${cooldownMs / 1000}** secondes avant de poster à nouveau dans **${message.channel.name}**.`)
        .catch(() => {});
    } else {
      await supabase
        .from('message_cooldowns')
        .upsert(
          { user_id: userId, channel_id: channelId, last_message_timestamp: now },
          { onConflict: 'user_id,channel_id' }
        );
    }
  }

  // ── XP ─────────────────────────────────────────────────────────────────────
  try {
    const xpResult = await handleMessage(message);

    if (xpResult?.leveledUp) {
      const lvlMsg = xpResult.rewardRole
        ? `🎉 GG ${message.author} ! Tu passes au niveau **${xpResult.newLevel}** et reçois le rôle <@&${xpResult.rewardRole}> !`
        : `🎉 GG ${message.author} ! Tu passes au niveau **${xpResult.newLevel}** !`;

      const config      = await getGuildConfig(message.guild.id);
      const lvlChannel  = config?.levelup_channel_id
        ? message.guild.channels.cache.get(config.levelup_channel_id) ?? message.channel
        : message.channel;

      const sent = await lvlChannel.send(lvlMsg).catch(() => null);
      if (sent) setTimeout(() => sent.delete().catch(() => {}), 10_000);
    }
  } catch (err) {
    console.error('[XP] Erreur handleMessage :', err.message);
  }
});

// ─── Messages supprimés ───────────────────────────────────────────────────────
client.on('messageDelete', async message => {
  if (!message.guild) return;
  if (message.author?.bot) return;
  if (!message.content && message.attachments.size === 0) return;

  const embed = buildMessageDeleteEmbed(message);
  await sendLog(message.guild, LOG_TYPES.MESSAGE_DEL, embed);
});

// ─── Messages modifiés ────────────────────────────────────────────────────────
client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (!newMessage.guild) return;
  if (newMessage.author?.bot) return;
  if (oldMessage.content === newMessage.content) return;

  const embed = buildMessageEditEmbed(oldMessage, newMessage);
  await sendLog(newMessage.guild, LOG_TYPES.MESSAGE_EDI, embed);
});

// ─── Arrivée / départ de membres ─────────────────────────────────────────────
client.on('guildMemberAdd', async member => {
  if (client.raidmode) {
    try {
      const dmEmbed = new EmbedBuilder()
        .setTitle('⚠️ Accès temporairement refusé')
        .setDescription(`Bonjour, le serveur **${member.guild.name}** est actuellement verrouillé pour des raisons de sécurité (Attaque ou maintenance).\n\nTous les nouveaux accès sont rejetés pour le moment. Veuillez réessayer plus tard.`)
        .setColor('#ff3333')
        .setTimestamp();

      await member.send({ embeds: [dmEmbed] }).catch(() => {
        console.log(`[Raidmode] Impossible d'envoyer un MP de kick à ${member.user.tag} (DMs fermés)`);
      });

      await member.kick('Protocole Raidmode : Expulsion automatique des nouveaux arrivants');
      console.log(`[Raidmode] Utilisateur expulsé automatiquement : ${member.user.tag} (${member.id})`);
      return;
    } catch (err) {
      console.error(`[Raidmode] Échec du kick automatique pour ${member.user.tag} :`, err);
    }
  }

  const embed = buildMemberJoinEmbed(member);
  await sendLog(member.guild, LOG_TYPES.MEMBER, embed);
});

client.on('guildMemberRemove', async member => {
  const embed = buildMemberLeaveEmbed(member);
  await sendLog(member.guild, LOG_TYPES.MEMBER, embed);
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {

//Message boost le serveur
  if (!oldMember.premiumSince && newMember.premiumSince) {
    const guild = newMember.guild;
    
    // ID du salon où tu veux envoyer les remerciements (Remplace par ton ID de salon)
    const thankYouChannelId = '1519466409338470571'; 
    const channel = guild.channels.cache.get(thankYouChannelId);

    if (channel) {
      const boostEmbed = new EmbedBuilder()
        .setTitle('✨ Un nouveau Boost ! ✨')
        .setDescription(`Un immense merci à ${newMember} qui vient de booster le serveur ! 💖`)
        .setColor('#ff73fa') // Couleur rose de Discord Boost
        .setThumbnail(newMember.user.displayAvatarURL({ dynamic: true }))
        .setTimestamp();

      await channel.send({ content: `🎉 Félicitations ${newMember} !`, embeds: [boostEmbed] }).catch(err => {
        console.error(`Impossible d'envoyer le message de boost dans le salon :`, err.message);
      });
    }
  }

// ─── Mise à jour membre (timeout expiré + modification de rôles) ──────────────

  // ── Expiration timeout automatique ────────────────────────────────────────
  if (oldMember.isCommunicationDisabled() && !newMember.isCommunicationDisabled()) {
    const user  = newMember.user;
    const guild = newMember.guild;
    const date  = new Date().toISOString();

    let isManualUnmute = false;
    try {
      await new Promise(r => setTimeout(r, 1000));
      const auditLogs = await guild.fetchAuditLogs({ type: 24, limit: 1 });
      const entry = auditLogs.entries.first();

      if (entry && entry.target.id === user.id) {
        const change = entry.changes.find(c => c.key === 'communication_disabled_until');
        const exactTime = Date.now() - entry.createdTimestamp;
        
        if (change && exactTime < 6000) {
          isManualUnmute = true; 
        }
      }
    } catch (err) {
      console.error("Impossible d'accéder aux audit logs pour filtrer l'unmute :", err.message);
    }

    if (isManualUnmute) return;

    const dmEmbed = new EmbedBuilder()
      .setTitle('🔊 Timeout Expiré')
      .setColor('#00ff00')
      .addFields(
        { name: 'Serveur', value: guild.name,               inline: true },
        { name: 'Raison',  value: 'Expiration automatique', inline: true },
        { name: 'Date',    value: date,                      inline: true }
      )
      .setTimestamp();

    try { await user.send({ embeds: [dmEmbed] }); }
    catch { console.error(`Impossible d'envoyer un DM d'expiration à ${user.tag}`); }

    const { error } = await supabase
      .from('sanctions')
      .insert({
        user_id:      user.id,
        guild_id:     guild.id,
        type:         'unmute',
        raison:       'Expiration automatique',
        date,
        moderator_id: null,
      });

    if (error) console.error('Supabase (unmute auto) :', error.message);

    const logEmbed = buildSanctionEmbed('unmute', user, null, 'Expiration automatique');
    await sendLog(guild, LOG_TYPES.SANCTION, logEmbed);
  }

  // ── Modification de rôles ─────────────────────────────────────────────────
  const oldRoles = oldMember.roles.cache;
  const newRoles = newMember.roles.cache;

  const addedRoles   = newRoles.filter(r => !oldRoles.has(r.id)).map(r => r);
  const removedRoles = oldRoles.filter(r => !newRoles.has(r.id)).map(r => r);

  if (addedRoles.length === 0 && removedRoles.length === 0) return;

  let executor = null;
  try {
    await new Promise(r => setTimeout(r, 1000));
    const logs  = await newMember.guild.fetchAuditLogs({ type: 25, limit: 1 });
    const entry = logs.entries.first();
    if (entry && entry.target.id === newMember.id && Date.now() - entry.createdTimestamp < 5000) {
      executor = entry.executor;
    }
  } catch { /* audit log inaccessible */ }

  const roleEmbed = buildRoleUpdateEmbed(newMember, addedRoles, removedRoles, executor);
  await sendLog(newMember.guild, LOG_TYPES.ROLE_UPDATE, roleEmbed);
});

// ─── Erreurs non capturées ────────────────────────────────────────────────────
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

client.login(process.env.TOKEN);