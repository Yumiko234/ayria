const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, AttachmentBuilder, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket-transcript')
    .setDescription('Génère un transcript du ticket actuel et l\'enregistre dans la BDD')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Le canal du ticket à archiver')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText)),
        
  async execute(interaction, client) {
    // deferReply avec les drapeaux v14 propres
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const channel = interaction.options.getChannel('channel');
    const supabase = client.db;

    if (!channel || channel.type !== ChannelType.GuildText) {
      return interaction.editReply({ content: '❌ Veuillez sélectionner un canal texte valide.', flags: [MessageFlags.Ephemeral] });
    }

    // 🛑 Vérification dynamique basée sur le nom de la catégorie parente
    if (!channel.parent || channel.parent.name.toLowerCase() !== 'tickets fermés') {
      return interaction.editReply({ 
        content: '❌ Ce canal n\'est pas un ticket archivé dans la catégorie **Tickets fermés**.', 
        flags: [MessageFlags.Ephemeral] 
      });
    }

    // 📥 Récupération des 100 derniers messages et tri chronologique (du plus vieux au plus récent)
    const fetchedMessages = await channel.messages.fetch({ limit: 100 });
    const transcript = fetchedMessages
      .reverse()
      .map(msg => `[${new Date(msg.createdTimestamp).toLocaleString('fr-FR')}] ${msg.author.tag}: ${msg.content}`)
      .join('\n');

    try {
      // 💾 Recherche du ticket existant dans Supabase pour garder une cohérence
      const { data: existingTicket, error: fetchError } = await supabase
        .from('tickets')
        .select('*')
        .eq('ticket_id', channel.id)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 = Aucun résultat trouvé
        console.error('[Supabase] Erreur fetch :', fetchError.message);
      }

      if (existingTicket) {
        // Le ticket existe déjà, on met à jour son statut et on injecte le transcript
        const { error: updateError } = await supabase
          .from('tickets')
          .update({
            status: 'Archivé (Transcript généré)',
            transcript: transcript
          })
          .eq('ticket_id', channel.id);

        if (updateError) throw updateError;
      } else {
        // Si jamais le ticket n'était pas en BDD, on crée une entrée propre
        const { error: insertError } = await supabase
          .from('tickets')
          .insert({
            ticket_id: channel.id,
            type: 'Inconnu (Post-Transcript)',
            author_id: interaction.user.id, // Par défaut on attribue à celui qui ferme si l'auteur est perdu
            status: 'Archivé (Transcript généré)',
            transcript: transcript,
            created_at: new Date().toISOString()
          });

        if (insertError) throw insertError;
      }

      // 📂 Génération et envoi du fichier .txt
      const attachment = new AttachmentBuilder(Buffer.from(transcript, 'utf-8'), { name: `transcript-${channel.name}.txt` });
      
      await interaction.editReply({ 
        content: '✅ Transcript généré avec succès et sauvegardé dans la base de données Supabase.', 
        files: [attachment], 
        flags: [MessageFlags.Ephemeral] 
      });

      await channel.send('🔒 **Ce ticket a été définitivement archivé. Le transcript a été enregistré.**');

    } catch (dbError) {
      console.error('❌ Erreur lors de l\'enregistrement Supabase :', dbError.message);
      return interaction.editReply({ 
        content: '❌ Une erreur est survenue lors de la synchronisation avec la base de données.', 
        flags: [MessageFlags.Ephemeral] 
      });
    }
  },
};