const express = require('express');
const cors = require('cors');
const config = require('./config');
const buildCockpitRouter = require('./api/cockpitRoutes');

async function main() {
  const app = express();
  app.use(express.json());
  // De cockpit-frontend is een standalone HTML-artifact dat vanaf eender welke origin
  // (file://, een preview-sandbox, of straks jullie eigen hosting) kan draaien. Omdat dit
  // enkel leesoperaties + de settings-endpoints blootstelt (geen gevoelige klant-/betaaldata
  // buiten wat toch al in de cockpit te zien is), laten we alle origins toe. Vervang dit door
  // een whitelist van jullie eigen domein zodra de cockpit een vaste hosting-locatie heeft.
  app.use('/api', cors());

  let dataProvider;
  let syncEngine = null;

  if (config.mockMode) {
    console.log('▶ MOCK_MODE actief — ingebakken voorbeelddata, geen echte Teamleader-koppeling of database nodig.');
    const MockDataProvider = require('./data/mockDataProvider');
    dataProvider = new MockDataProvider();
  } else {
    console.log('▶ LIVE-modus — koppelt met Postgres + Teamleader.');
    const pool = require('./db/pool');
    const SettingsRepo = require('./db/repositories/settingsRepo');
    const DealsRepo = require('./db/repositories/dealsRepo');
    const ProjectsRepo = require('./db/repositories/projectsRepo');
    const LiveDataProvider = require('./data/liveDataProvider');
    const TokenStore = require('./oauth/tokenStore');
    const TeamleaderClient = require('./teamleader/client');
    const DealsApi = require('./teamleader/dealsApi');
    const ProjectsApi = require('./teamleader/projectsApi');
    const SyncEngine = require('./sync/syncEngine');
    const buildOAuthRouter = require('./oauth/routes');
    const buildWebhookRouter = require('./webhooks/receiver');
    const { registerWebhooks } = require('./teamleader/webhooksApi');
    const startPollJob = require('./jobs/pollJob');

    const settingsRepo = new SettingsRepo(pool);
    const dealsRepo = new DealsRepo(pool);
    const projectsRepo = new ProjectsRepo(pool);
    dataProvider = new LiveDataProvider(pool, settingsRepo);

    const tokenStore = new TokenStore(settingsRepo);
    const client = new TeamleaderClient(tokenStore);
    const dealsApi = new DealsApi(client);
    const projectsApi = new ProjectsApi(client);
    syncEngine = new SyncEngine({ dealsApi, projectsApi, dealsRepo, projectsRepo, settingsRepo });

    app.use('/oauth', buildOAuthRouter(tokenStore));
    app.use('/webhooks', buildWebhookRouter(syncEngine));

    app.post('/admin/register-webhooks', async (req, res) => {
      try {
        const results = await registerWebhooks(client);
        res.json({ results });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/admin/sync-now', async (req, res) => {
      try {
        const result = await syncEngine.syncAll({ incremental: req.query.full !== 'true' });
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    startPollJob(syncEngine);
  }

  app.use('/api', buildCockpitRouter(dataProvider));

  app.get('/health', (req, res) => res.json({ ok: true, mockMode: config.mockMode }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: err.message });
  });

  app.listen(config.port, () => {
    console.log(`Ecofinity cockpit-backend luistert op http://localhost:${config.port}`);
    if (config.mockMode) {
      console.log(`Probeer: curl http://localhost:${config.port}/api/cockpit-data`);
    } else {
      console.log(`Start koppeling via: http://localhost:${config.port}/oauth/authorize`);
    }
  });
}

main().catch((err) => {
  console.error('Kon server niet starten:', err);
  process.exit(1);
});
