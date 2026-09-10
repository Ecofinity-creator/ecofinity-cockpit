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

    // Eenmalig herstel: corrigeer deals die door een race-conditie tussen webhook-triggers en
    // de bulk-wachtrij als "has_linked_project=true" staan zonder bijhorende projects-rij
    // (de vergrendeling in syncEngine.js voorkomt dit voortaan). Idempotent, dus veilig bij
    // elke opstart. De betrokken deals worden opnieuw in de wachtrij gezet zodat ze — nu zonder
    // race — een eerlijke herkansing krijgen, in plaats van permanent als "geen project" te blijven staan.
    try {
      const repairRes = await pool.query(`
        UPDATE deals SET has_linked_project = FALSE
        WHERE has_linked_project = TRUE
          AND deal_id NOT IN (SELECT deal_id FROM projects)
        RETURNING deal_id
      `);
      if (repairRes.rowCount > 0) {
        const repairedIds = repairRes.rows.map((r) => r.deal_id);
        console.log(`▶ ${repairRes.rowCount} inconsistente deal(s) hersteld en opnieuw in de wachtrij gezet.`);
        const existingQueue = await settingsRepo.getPendingSyncQueue();
        const merged = Array.from(new Set([...existingQueue, ...repairedIds]));
        await settingsRepo.setPendingSyncQueue(merged);
      }
    } catch (err) {
      console.error('Kon inconsistente deals niet herstellen (niet-kritiek, ga verder):', err.message);
    }

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
      // BELANGRIJK: dit verwerkt bewust maar ÉÉN portie en stopt dan. Render's gratis laag
      // zet de service na ~15 minuten zonder inkomend HTTP-verzoek stil, ongeacht of er
      // intern nog werk loopt -- een aanpak die zelf urenlang op de achtergrond zou
      // doorlopen zonder nieuwe binnenkomende requests, overleeft dat niet. Roep dit
      // endpoint dus herhaaldelijk aan (bv. elke 5 minuten) tot de wachtrij leeg is --
      // handmatig, of automatisch via een gratis externe pingdienst (zie backend/README.md).
      res.status(202).json({
        started: true,
        message: 'Eén portie van de synchronisatie gestart. Bevraag /admin/sync-status om de voortgang te volgen, en roep dit endpoint herhaaldelijk aan (bv. elke 5 min) tot remainingInQueue op 0 staat.',
      });
      syncEngine
        .syncAll({ incremental: req.query.full !== 'true' })
        .then((result) => console.log('[admin] portie afgerond:', result))
        .catch((err) => console.error('[admin] portie mislukt:', err.message));
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
