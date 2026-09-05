const axios = require('axios');
const config = require('../config');

/**
 * Bewaart en ververst het OAuth2-token voor de Teamleader-koppeling.
 *
 * Teamleader-tokens zijn kortlevend (±1 uur) en een refresh_token kan maar ÉÉN keer
 * gebruikt worden (elke refresh levert een NIEUW access_token + refresh_token-paar op).
 * Daarom slaan we na elke refresh meteen het nieuwe paar op.
 *
 * In deze referentie-implementatie zit de opslag in de settingsRepo (DB); in mock-modus
 * wordt dit nooit aangesproken.
 */
class TokenStore {
  constructor(settingsRepo) {
    this.settingsRepo = settingsRepo;
    this.cache = null; // { accessToken, refreshToken, expiresAt }
    this.refreshingPromise = null;
  }

  async load() {
    if (this.cache) return this.cache;
    const row = await this.settingsRepo.getOAuthTokens(); // null als nog niet gekoppeld
    this.cache = row;
    return row;
  }

  async getValidAccessToken() {
    const tokens = await this.load();
    if (!tokens) {
      throw new Error(
        'Geen Teamleader-koppeling gevonden. Rond eerst de OAuth-autorisatie af via GET /oauth/authorize.'
      );
    }
    const expiresInMs = new Date(tokens.expiresAt).getTime() - Date.now();
    if (expiresInMs > 30_000) {
      return tokens.accessToken;
    }
    return this.forceRefresh();
  }

  async forceRefresh() {
    // voorkom dat meerdere gelijktijdige requests elk hun eigen refresh_token verbruiken
    if (this.refreshingPromise) return this.refreshingPromise;

    this.refreshingPromise = (async () => {
      const tokens = await this.load();
      const res = await axios.post(
        config.teamleader.tokenUrl,
        {
          client_id: config.teamleader.clientId,
          client_secret: config.teamleader.clientSecret,
          refresh_token: tokens.refreshToken,
          grant_type: 'refresh_token',
        },
        { headers: { 'Content-Type': 'application/json' } }
      );

      const { access_token, refresh_token, expires_in } = res.data;
      const expiresAt = new Date(Date.now() + expires_in * 1000);
      await this.settingsRepo.saveOAuthTokens({ accessToken: access_token, refreshToken: refresh_token, expiresAt });
      this.cache = { accessToken: access_token, refreshToken: refresh_token, expiresAt };
      return access_token;
    })();

    try {
      return await this.refreshingPromise;
    } finally {
      this.refreshingPromise = null;
    }
  }

  async exchangeAuthorizationCode(code) {
    const res = await axios.post(
      config.teamleader.tokenUrl,
      {
        client_id: config.teamleader.clientId,
        client_secret: config.teamleader.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: config.teamleader.redirectUri,
      },
      { headers: { 'Content-Type': 'application/json' } }
    );
    const { access_token, refresh_token, expires_in } = res.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000);
    await this.settingsRepo.saveOAuthTokens({ accessToken: access_token, refreshToken: refresh_token, expiresAt });
    this.cache = { accessToken: access_token, refreshToken: refresh_token, expiresAt };
  }
}

module.exports = TokenStore;
