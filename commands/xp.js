const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { computeLevel, xpForLevel, totalXpForLevel } = require('../events/xpManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('xp')
    .setDescription('Gestion du système XP')

    // ── Voir ──
    .addSubcommand(sub =>
      sub.setName('voir')
        .setDescription('Voir l\'XP brut d\'un membre')
        .addUserOption(o => o.setName('utilisateur').setDescription('Membre').setRequired(true)))

    // ── Donner ──
    .addSubcommand(sub =>
      sub.setName('donner')
        .setDescription('Ajoute de l\'XP à un membre')
        .addUserOption(o => o.setName('utilisateur').setDescription('Membre').setRequired(true))
        .addIntegerOption(o => o.setName('montant').setDescription('XP à ajouter (positif)').setRequired(true).setMinValue(1)))

    // ── Retirer ──
    .addSubcommand(sub =>
      sub.setName('retirer')
        .setDescription('Retire de l\'XP à un membre')
        .addUserOption(o => o.setName('utilisateur').setDescription('Membre').setRequired(true))
        .addIntegerOption(o => o.setName('montant').setDescription('XP à retirer').setRequired(true).setMinValue(1)))

    // ── Définir xp ──
    .addSubcommand(sub =>
      sub.setName('set-xp')
        .setDescription('Définit l\'XP exact d\'un membre')
        .addUserOption(o => o.setName('utilisateur').setDescription('Membre').setRequired(true))
        .addIntegerOption(o => o.setName('valeur').setDescription('Valeur XP totale').setRequired(true).setMinValue(0)))

    // ── Définir niveau ──
    .addSubcommand(sub =>
      sub.setName('set-niveau')
        .setDescription('Place un membre directement à un niveau')
        .addUserOption(o => o.setName('utilisateur').setDescription('Membre').setRequired(true))
        .addIntegerOption(o => o.setName('niveau').setDescription('Niveau cible').setRequired(true).setMinValue(0)))

    // ── Réinitialiser ──
    .addSubcommand(sub =>
      sub.setName('reset')
        .setDescription('Remet l\'XP d\'un membre à zéro')
        .addUserOption(o => o.setName('utilisateur').setDescription('Membre').setRequired(true)))

    // ── Configurer palier ──
    .addSubcommand(sub =>
      sub.setName('palier')
        .setDescription('Associe un rôle récompense à un niveau')
        .addIntegerOption(o => o.setName('niveau').setDescription('Niveau déclencheur').setRequired(true).setMinValue(1))
        .addRoleOption(o => o.setName('role').setDescription('Rôle à attribuer (vide = supprimer)').setRequired(false)))

    // ── Liste paliers ──
    .addSubcommand(sub =>
      sub.setName('paliers')
        .setDescription('Liste tous les paliers configurés'))

    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({  flags : [MessageFlags.Ephemeral] });
    const sub = interaction.options.getSubcommand();
    const db  = interaction.client.db;

    // Helper : charger ou créer un profil
    async function loadProfile(userId) {
      const { data } = await db
        .from('xp_profiles')
        .select('*')
        .eq('user_id', userId)
        .eq('guild_id', interaction.guild.id)
        .single();
      return data ?? { user_id: userId, guild_id: interaction.guild.id, xp: 0, level: 0, last_xp_at: 0 };
    }

    // Helper : sauvegarder un profil (recalcule le niveau)
    async function saveProfile(userId, newXp) {
      const safeXp = Math.max(0, newXp);
      const { level } = computeLevel(safeXp);
      const { error } = await db
        .from('xp_profiles')
        .upsert(
          { user_id: userId, guild_id: interaction.guild.id, xp: safeXp, level, last_xp_at: Date.now() },
          { onConflict: 'user_id,guild_id' }
        );
      return { error, level, xp: safeXp };
    }

    // ── voir ────────────────────────────────────────────────────────────────
    if (sub === 'voir') {
      const user    = interaction.options.getUser('utilisateur');
      const profile = await loadProfile(user.id);
      const { level, currentXp, xpNeeded } = computeLevel(profile.xp);

      return interaction.editReply(
        `**${user.tag}** — Niv. **${level}** · XP total : **${profile.xp}** · Progression : **${currentXp}/${xpNeeded}**`
      );
    }

    // ── donner ──────────────────────────────────────────────────────────────
    if (sub === 'donner') {
      const user    = interaction.options.getUser('utilisateur');
      const montant = interaction.options.getInteger('montant');
      const profile = await loadProfile(user.id);
      const { error, level, xp } = await saveProfile(user.id, profile.xp + montant);

      if (error) return interaction.editReply('❌ Erreur Supabase.');
      return interaction.editReply(`✅ +${montant} XP à **${user.tag}** → Niv. **${level}** (${xp} XP total)`);
    }

    // ── retirer ─────────────────────────────────────────────────────────────
    if (sub === 'retirer') {
      const user    = interaction.options.getUser('utilisateur');
      const montant = interaction.options.getInteger('montant');
      const profile = await loadProfile(user.id);
      const { error, level, xp } = await saveProfile(user.id, profile.xp - montant);

      if (error) return interaction.editReply('❌ Erreur Supabase.');
      return interaction.editReply(`✅ -${montant} XP à **${user.tag}** → Niv. **${level}** (${xp} XP total)`);
    }

    // ── set-xp ──────────────────────────────────────────────────────────────
    if (sub === 'set-xp') {
      const user   = interaction.options.getUser('utilisateur');
      const valeur = interaction.options.getInteger('valeur');
      const { error, level, xp } = await saveProfile(user.id, valeur);

      if (error) return interaction.editReply('❌ Erreur Supabase.');
      return interaction.editReply(`✅ **${user.tag}** → ${xp} XP · Niv. **${level}**`);
    }

    // ── set-niveau ──────────────────────────────────────────────────────────
    if (sub === 'set-niveau') {
      const user   = interaction.options.getUser('utilisateur');
      const niveau = interaction.options.getInteger('niveau');
      const xpCible = totalXpForLevel(niveau); // XP exact pour débuter ce niveau
      const { error, level, xp } = await saveProfile(user.id, xpCible);

      if (error) return interaction.editReply('❌ Erreur Supabase.');
      return interaction.editReply(`✅ **${user.tag}** placé au niveau **${level}** (${xp} XP)`);
    }

    // ── reset ────────────────────────────────────────────────────────────────
    if (sub === 'reset') {
      const user = interaction.options.getUser('utilisateur');
      const { error } = await db
        .from('xp_profiles')
        .delete()
        .eq('user_id', user.id)
        .eq('guild_id', interaction.guild.id);

      if (error) return interaction.editReply('❌ Erreur Supabase.');
      return interaction.editReply(`🗑️ XP de **${user.tag}** réinitialisé.`);
    }

    // ── palier ───────────────────────────────────────────────────────────────
    if (sub === 'palier') {
      const niveau = interaction.options.getInteger('niveau');
      const role   = interaction.options.getRole('role');

      if (!role) {
        // Supprimer le palier
        await db.from('xp_levels').delete()
          .eq('guild_id', interaction.guild.id).eq('level', niveau);
        return interaction.editReply(`🗑️ Palier niveau **${niveau}** supprimé.`);
      }

      const { error } = await db
        .from('xp_levels')
        .upsert(
          { guild_id: interaction.guild.id, level: niveau, role_id: role.id },
          { onConflict: 'guild_id,level' }
        );

      if (error) return interaction.editReply('❌ Erreur Supabase.');
      return interaction.editReply(`✅ Au niveau **${niveau}**, les membres recevront le rôle <@&${role.id}>.`);
    }

    // ── paliers ──────────────────────────────────────────────────────────────
    if (sub === 'paliers') {
      const { data: rows, error } = await db
        .from('xp_levels')
        .select('level, role_id')
        .eq('guild_id', interaction.guild.id)
        .order('level', { ascending: true });

      if (error || !rows?.length) {
        return interaction.editReply('Aucun palier configuré. Utilisez `/xp palier` pour en créer.');
      }

      const lines = rows.map(r => {
        const xpTotal = totalXpForLevel(r.level);
        return `Niv. **${r.level}** — ${xpTotal.toLocaleString()} XP cumulés → ${r.role_id ? `<@&${r.role_id}>` : '*Aucun rôle*'}`;
      });

      const embed = new EmbedBuilder()
        .setTitle('🎖️ Paliers XP configurés')
        .setColor('#5865F2')
        .setDescription(lines.join('\n'))
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }
  },
};