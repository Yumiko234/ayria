const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, PermissionFlagsBits, MessageFlags,
} = require('discord.js');
const { hasAnyRole, CHANGELOGS_ROLES } = require('../utils/permissions');

const EMBED_COLOR        = 4394149;        // même couleur que /absence
const MODAL_TIMEOUT_MS   = 15 * 60_000;    // temps pour écrire le changelog
const PREVIEW_TIMEOUT_MS = 5 * 60_000;     // temps pour confirmer l'aperçu

/** Titre : « 📝 Titre — version » */
function buildEmbed({ version, title, content, authorName }) {
  const heading = `📝 ${title || 'Changelog'}${version ? ` — ${version}` : ''}`;
  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(heading.slice(0, 256))
    .setDescription(content)
    .setFooter({ text: `Publié par ${authorName}` })
    .setTimestamp();
}

/** Mention optionnelle : uniquement le rôle choisi est notifié, jamais un autre. */
function mentionPayload(role, guildId) {
  if (!role) return { content: undefined, allowedMentions: { parse: [] } };
  if (role.id === guildId) return { content: '@everyone', allowedMentions: { parse: ['everyone'] } };
  return { content: `<@&${role.id}>`, allowedMentions: { roles: [role.id] } };
}

/** Retourne un message d'erreur si le bot ne peut pas publier dans ce salon (ou pinger ce rôle). */
function checkPublishPermissions(channel, me, role, guildId) {
  const perms = channel.permissionsFor(me);
  const needed = [
    [PermissionFlagsBits.ViewChannel, 'Voir le salon'],
    [PermissionFlagsBits.SendMessages, 'Envoyer des messages'],
    [PermissionFlagsBits.EmbedLinks, 'Intégrer des liens'],
  ];
  const missing = needed.filter(([flag]) => !perms?.has(flag)).map(([, name]) => name);
  if (missing.length) return `Il me manque des permissions dans ${channel} : ${missing.join(', ')}.`;

  if (role) {
    const canPing = role.id !== guildId && role.mentionable
      ? true
      : perms.has(PermissionFlagsBits.MentionEveryone);
    if (!canPing) return `Je ne peux pas mentionner ${role.id === guildId ? '@everyone' : role} : le rôle n'est pas mentionnable et il me manque « Mentionner @everyone, @here et tous les rôles ».`;
  }
  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('changelog')
    .setDescription('Publie un changelog (avec aperçu avant l\'envoi)')
    .addChannelOption(o => o.setName('salon')
      .setDescription('Salon de publication (défaut : salon actuel)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addRoleOption(o => o.setName('mention')
      .setDescription('Rôle à mentionner avec le changelog (optionnel)')),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Cette commande ne fonctionne que sur un serveur.', flags: [MessageFlags.Ephemeral] });
    }
    if (!hasAnyRole(interaction.member, CHANGELOGS_ROLES)) {
      return interaction.reply({ content: "❌ Tu n'as pas le rôle requis pour publier un changelog.", flags: [MessageFlags.Ephemeral] });
    }

    const channel = interaction.options.getChannel('salon') ?? interaction.channel;
    const role    = interaction.options.getRole('mention');

    const permError = checkPublishPermissions(channel, interaction.guild.members.me, role, interaction.guild.id);
    if (permError) return interaction.reply({ content: `❌ ${permError}`, flags: [MessageFlags.Ephemeral] });

    // ── 1. Formulaire (une option de commande ne peut pas contenir de retours à la ligne) ──
    const modalId = `changelogs:${interaction.id}`;
    const modal = new ModalBuilder().setCustomId(modalId).setTitle('Nouveau changelog').addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('version').setLabel('Version (optionnel)')
          .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(32).setPlaceholder('ex. v1.4'),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('title').setLabel('Titre (optionnel)')
          .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100).setPlaceholder('Défaut : Changelog'),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('content').setLabel('Contenu (markdown Discord accepté)')
          .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(3900)
          .setPlaceholder('## Nouveautés\n• …\n\n## Corrections\n• …'),
      ),
    );
    await interaction.showModal(modal);

    const submitted = await interaction.awaitModalSubmit({
      time: MODAL_TIMEOUT_MS,
      filter: i => i.customId === modalId && i.user.id === interaction.user.id,
    }).catch(() => null);
    if (!submitted) return;   // formulaire fermé ou délai dépassé : rien à publier

    const version = submitted.fields.getTextInputValue('version').trim();
    const title   = submitted.fields.getTextInputValue('title').trim();
    const content = submitted.fields.getTextInputValue('content').trim();
    if (!content) {
      return submitted.reply({ content: '❌ Le contenu est vide.', flags: [MessageFlags.Ephemeral] });
    }

    const embed   = buildEmbed({ version, title, content, authorName: interaction.member.displayName ?? interaction.user.username });
    const mention = mentionPayload(role, interaction.guild.id);

    // ── 2. Aperçu privé + confirmation ──
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${modalId}:ok`).setLabel('Publier').setEmoji('📣').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${modalId}:no`).setLabel('Annuler').setStyle(ButtonStyle.Secondary),
    );
    await submitted.reply({
      content: `**Aperçu** — publication dans ${channel}${role ? ` avec mention de ${role.id === interaction.guild.id ? '@everyone' : role}` : ''}.`,
      embeds: [embed],
      components: [row],
      flags: [MessageFlags.Ephemeral],
      allowedMentions: { parse: [] },     // l'aperçu ne notifie personne
    });
    const preview = await submitted.fetchReply();

    const choice = await preview.awaitMessageComponent({
      time: PREVIEW_TIMEOUT_MS,
      filter: i => i.user.id === interaction.user.id && i.customId.startsWith(modalId),
    }).catch(() => null);

    if (!choice) {
      return submitted.editReply({ content: '⌛ Délai dépassé : rien n\'a été publié.', embeds: [], components: [] }).catch(() => {});
    }
    if (choice.customId.endsWith(':no')) {
      return choice.update({ content: '🚫 Publication annulée.', embeds: [], components: [] });
    }

    // ── 3. Publication ──
    try {
      const sent = await channel.send({ content: mention.content, embeds: [embed], allowedMentions: mention.allowedMentions });
      return choice.update({
        content: `✅ Changelog publié dans ${channel}. [Voir le message](${sent.url ?? `https://discord.com/channels/${interaction.guild.id}/${channel.id}/${sent.id}`})`,
        embeds: [], components: [],
      });
    } catch (err) {
      console.error('[/changelogs] Publication impossible :', err);
      return choice.update({ content: '❌ Impossible de publier le changelog (voir les logs du bot).', embeds: [], components: [] });
    }
  },
};