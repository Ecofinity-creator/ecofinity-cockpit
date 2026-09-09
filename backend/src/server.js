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
    const fs = require('fs');
    const path = require('path');
    const pool = require('./db/pool');

    // Automatische migratie: het schema gebruikt overal CREATE TABLE IF NOT EXISTS, dus dit
    // is veilig om bij elke opstart opnieuw te draaien. Bespaart een handmatige psql-stap.
    try {
      const schemaSql = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
      await pool.query(schemaSql);
      console.log('▶ Databaseschema gecontroleerd/aangemaakt.');
    } catch (err) {
      console.error('Kon databaseschema niet toepassen:', err.message);
      throw err;
    }

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

    app.post('/admin/sync-now', (req, res) => {
      // Start de volledige, zichzelf herhalende verwerking van de wachtrij op de achtergrond
      // (zie runUntilQueueEmpty in syncEngine.js) — dit ene verzoek volstaat, ook als er
      // honderden of duizenden historische deals in de wachtrij staan. Bevraag ondertussen
      // /admin/sync-status om de voortgang te volgen.
      res.status(202).json({
        started: true,
        message: 'Synchronisatie gestart op de achtergrond en loopt door tot de volledige wachtrij verwerkt is. Bevraag /admin/sync-status om de voortgang (remainingInQueue) te volgen — dit hoeft maar één keer aangeroepen te worden.',
      });
      syncEngine
        .runUntilQueueEmpty({ incremental: req.query.full !== 'true' })
        .then((result) => console.log('[admin] volledige synchronisatie afgerond:', result))
        .catch((err) => console.error('[admin] synchronisatie mislukt:', err.message));
    });

    app.get('/admin/sync-status', async (req, res) => {
      try {
        const lastSyncAt = await settingsRepo.getLastSyncTimestamp();
        const pendingQueue = await settingsRepo.getPendingSyncQueue();
        const issuesRes = await pool.query(
          `SELECT deal_id, message, occurred_at FROM sync_issues ORDER BY occurred_at DESC LIMIT 10`
        );
        const projectCountRes = await pool.query(`SELECT COUNT(*) FROM deals`);
        res.json({
          lastSyncAt,
          syncComplete: pendingQueue.length === 0 && !!lastSyncAt,
          remainingInQueue: pendingQueue.length,
          totalDealsInDatabase: Number(projectCountRes.rows[0].count),
          recentIssues: issuesRes.rows,
        });
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
