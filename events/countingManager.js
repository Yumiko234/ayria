const { EmbedBuilder } = require('discord.js');

// Couleurs progressives selon la "streak" du compteur
function getColor(count) {
  if (count < 10)   return '#5865F2'; // bleu Discord
  if (count < 50)   return '#57F287'; // vert
  if (count < 100)  return '#FEE75C'; // jaune
  if (count < 500)  return '#FF9B4E'; // orange
  if (count < 1000) return '#EB459E'; // rose
  return '#FF2222';                   // rouge — légendaire
}

/**
 * Gère un message dans le salon de counting.
 * @param {import('discord.js').Message} message
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 */
async function handleCounting(message, db) {
  const { guild, channel, author, content } = message;

  // ── 1. Récupère la config counting pour ce serveur ─────────────────────────
  const { data: config, error } = await db
    .from('counting')
    .select('*')
    .eq('guild_id', guild.id)
    .single();

  if (error || !config) return;                        // counting non configuré
  if (config.channel_id !== channel.id) return;       // pas le bon salon

  // ── 2. Supprime le message de l'utilisateur dans tous les cas ──────────────
  await message.delete().catch(() => {});

  const expected = config.count + 1;
  const written  = parseInt(content.trim(), 10);

  // ── 3. Vérifie que le message est bien un chiffre ──────────────────────────
  if (isNaN(written) || content.trim() !== String(written)) {
    // Message invalide — on avertit en éphémère via un message temporaire
    const warn = await channel.send({
      content: `❌ <@${author.id}> — Seuls les chiffres sont autorisés ici !`,
    });
    setTimeout(() => warn.delete().catch(() => {}), 4000);
    return;
  }

  // ── 4. Vérifie que c'est le bon chiffre ────────────────────────────────────
  if (written !== expected) {
    const warn = await channel.send({
      content: `❌ <@${author.id}> — Le prochain chiffre attendu est **${expected}**, pas ${written}.`,
    });
    setTimeout(() => warn.delete().catch(() => {}), 4000);
    return;
  }

  // ── 5. Vérifie que ce n'est pas le même utilisateur deux fois de suite ─────
  if (config.last_user_id === author.id) {
    const warn = await channel.send({
      content: `⛔ <@${author.id}> — Tu ne peux pas poster deux chiffres d'affilée !`,
    });
    setTimeout(() => warn.delete().catch(() => {}), 4000);
    return;
  }

  // ── 6. Tout est bon — met à jour la BDD ────────────────────────────────────
  const { error: updateError } = await db
    .from('counting')
    .update({ count: written, last_user_id: author.id })
    .eq('guild_id', guild.id);

  if (updateError) {
    console.error('[countingManager] Supabase update error:', updateError.message);
    return;
  }

  // ── 7. Envoie l'embed ───────────────────────────────────────────────────────
  const embed = new EmbedBuilder()
    .setColor(getColor(written))
    .setDescription(`# ${written}`)
    .setFooter({
      text: `${author.displayName ?? author.username}`,
      iconURL: author.displayAvatarURL(),
    });

  // Milestone ? Petit bonus visuel
  if (written % 100 === 0) {
    embed.setTitle(`🎉 Milestone atteint !`);
  } else if (written % 10 === 0) {
    embed.setTitle(`✨ ${written} — continuez !`);
  }

  await channel.send({ embeds: [embed] });
}

module.exports = { handleCounting };