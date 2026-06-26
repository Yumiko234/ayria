module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    console.log(`Connecté en tant que ${client.user.tag} !`);
    // Note : loadCommands et registerCommands doivent être appelés ailleurs si déplacés
  },
};