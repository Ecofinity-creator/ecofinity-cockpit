require('dotenv').config();

const config = {
  // Draait de server zonder echte Teamleader-koppeling/DB, met ingebakken voorbeelddata?
  // Handig om de REST-contracten en de frontend te testen vóórdat de Teamleader-marketplace-app
  // goedgekeurd is en er echte OAuth-credentials zijn.
  mockMode: (process.env.MOCK_MODE || 'true').toLowerCase() === 'true',

  port: parseInt(process.env.PORT || '4000', 10),

  teamleader: {
    clientId: process.env.TEAMLEADER_CLIENT_ID || '',
    clientSecret: process.env.TEAMLEADER_CLIENT_SECRET || '',
    redirectUri: process.env.TEAMLEADER_REDIRECT_URI || 'http://localhost:4000/oauth/callback',
    authorizeUrl: 'https://focus.teamleader.eu/oauth2/authorize',
    tokenUrl: 'https://focus.teamleader.eu/oauth2/access_token',
    apiBaseUrl: 'https://api.focus.teamleader.eu',
  },

  // Willekeurig, geheim pad-segment voor de webhook-ontvanger i.p.v. te vertrouwen op een
  // (niet publiek gedocumenteerde) payload-signature. Zie src/webhooks/receiver.js.
  webhookSecretPath: process.env.WEBHOOK_SECRET_PATH || 'CHANGE_ME_TO_A_RANDOM_STRING',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:4000',

  db: {
    connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/ecofinity_cockpit',
  },

  // Sectie 9 uit de spec: configureerbare grenswaarde, default hier — wordt bij opstart
  // overschreven door de waarde uit de settings-tabel (of blijft dit als er geen DB is / mock-modus).
  defaultAttentionThresholdDays: 7,

  // Hoe vaak de veiligheids-poll draait naast de webhook-triggers (in minuten).
  // Webhooks houden de data vers; deze poll vangt gemiste/onbetrouwbare webhook-events op.
  pollIntervalMinutes: parseInt(process.env.POLL_INTERVAL_MINUTES || '15', 10),
};

module.exports = config;
