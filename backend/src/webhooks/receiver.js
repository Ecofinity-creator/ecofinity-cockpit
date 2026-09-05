const express = require('express');
const config = require('../config');

/**
 * Ontvangt webhook-callbacks van Teamleader.
 *
 * Beveiliging: Teamleader's officiële payload-signature-mechanisme staat niet eenduidig
 * gedocumenteerd in de publieke API-referentie op het moment van bouwen. In plaats van
 * een ongeverifieerd verificatieschema te implementeren, gebruiken we een praktisch
 * even veilig alternatief: een lang, willekeurig geheim als PAD-segment van de webhook-URL
 * (WEBHOOK_SECRET_PATH). Enkel wie deze URL kent (Teamleader, via webhooks.register) kan
 * events versturen. Voeg gerust een extra signature-check toe zodra je dat mechanisme
 * hebt geverifieerd in de Teamleader-documentatie of via hun support.
 */
function buildWebhookRouter(syncEngine) {
  const router = express.Router();

  router.post(`/teamleader/${config.webhookSecretPath}`, express.json(), async (req, res) => {
    // Antwoord snel — Teamleader verwacht een vlotte 2xx en verwerkt anders retries.
    res.status(202).send('accepted');

    try {
      const events = Array.isArray(req.body) ? req.body : [req.body];
      for (const event of events) {
        await syncEngine.handleWebhookEvent(event);
      }
    } catch (err) {
      // Bewust niet naar de response geschreven (die is al verstuurd); wel loggen voor monitoring.
      console.error('[webhook] verwerking mislukt:', err.message);
    }
  });

  return router;
}

module.exports = buildWebhookRouter;
