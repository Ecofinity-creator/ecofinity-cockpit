const config = require('../config');

/**
 * Registreert onze webhook-ontvanger bij Teamleader (webhooks.register, bevestigd endpoint).
 * We registreren breed op deal- en project-gerelateerde types; de exacte lijst van
 * ondersteunde webhook-types verschilt per API-versie en wordt best opgevraagd/bevestigd
 * bij het opzetten van de marketplace-app (zie developer.focus.teamleader.eu/#/reference/other/webhooks).
 *
 * We ontwerpen de sync bewust ROBUUST tegen onzekerheid over de exacte type-namen:
 * élk binnenkomend webhook-event triggert gewoon een gerichte re-sync van de betrokken
 * deal/project, en een periodieke volledige poll (zie jobs/pollJob.js) vangt sowieso
 * alles op wat een webhook zou missen.
 */
async function registerWebhooks(client) {
  const url = `${config.publicBaseUrl}/webhooks/teamleader/${config.webhookSecretPath}`;

  const candidateTypes = [
    'deal.created', 'deal.updated', 'deal.moved', 'deal.won', 'deal.lost', 'deal.deleted',
    'project.created', 'project.updated', 'project.deleted',
    'nextgenProject.created', 'nextgenProject.updated', 'nextgenProject.deleted',
    'milestone.created', 'milestone.updated', 'milestone.deleted',
    'timeTracking.added', 'timeTracking.updated', 'timeTracking.deleted',
  ];

  const results = [];
  for (const type of candidateTypes) {
    try {
      await client.call('webhooks.register', { url, types: [type] });
      results.push({ type, ok: true });
    } catch (err) {
      // Een niet-bestaand of niet-toegestaan type mag de rest niet blokkeren.
      results.push({ type, ok: false, error: err.message });
    }
  }
  return results;
}

module.exports = { registerWebhooks };
