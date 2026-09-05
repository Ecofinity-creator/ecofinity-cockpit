const express = require('express');
const crypto = require('crypto');
const config = require('../config');

/**
 * Implementeert exact de "authorization code grant" flow uit de Teamleader-documentatie:
 *   1. Redirect de gebruiker naar https://focus.teamleader.eu/oauth2/authorize
 *   2. Teamleader stuurt terug naar TEAMLEADER_REDIRECT_URI met ?code=...&state=...
 *   3. Wij wisselen de code in voor een access_token + refresh_token
 */
function buildOAuthRouter(tokenStore) {
  const router = express.Router();
  const pendingStates = new Set(); // simpele in-memory CSRF-bescherming; gebruik desnoods sessions

  router.get('/authorize', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    pendingStates.add(state);

    const url = new URL(config.teamleader.authorizeUrl);
    url.searchParams.set('client_id', config.teamleader.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', config.teamleader.redirectUri);
    url.searchParams.set('state', state);

    res.redirect(url.toString());
  });

  router.get('/callback', async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
      return res.status(400).send(`Teamleader-autorisatie geweigerd: ${error}`);
    }
    if (!state || !pendingStates.has(state)) {
      return res.status(400).send('Ongeldige of ontbrekende state-parameter — mogelijke CSRF-poging, autorisatie geweigerd.');
    }
    pendingStates.delete(state);

    try {
      await tokenStore.exchangeAuthorizationCode(code);
      res.send(
        'Teamleader-koppeling gelukt. Je kan dit tabblad sluiten; de synchronisatie start automatisch. ' +
          'Vergeet niet de webhooks te registreren via POST /admin/register-webhooks.'
      );
    } catch (err) {
      res.status(500).send(`Kon autorisatiecode niet omwisselen voor een token: ${err.message}`);
    }
  });

  return router;
}

module.exports = buildOAuthRouter;
