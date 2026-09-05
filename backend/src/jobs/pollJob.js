const cron = require('node-cron');
const config = require('../config');

/**
 * Draait elke POLL_INTERVAL_MINUTES een incrementele sync (updated_since = laatste sync).
 * Dit is bewust een VEILIGHEIDSNET naast de webhooks: als een webhook-event verloren gaat
 * (netwerkstoring, herstart van de server, onbekende/niet-geregistreerde type-naam), haalt
 * deze poll het binnen de ingestelde termijn alsnog recht.
 */
function startPollJob(syncEngine) {
  const cronExpr = `*/${config.pollIntervalMinutes} * * * *`;
  console.log(`[poll] gepland elke ${config.pollIntervalMinutes} minuten (${cronExpr})`);

  cron.schedule(cronExpr, async () => {
    try {
      const result = await syncEngine.syncAll({ incremental: true });
      console.log(`[poll] sync afgerond:`, result);
    } catch (err) {
      console.error('[poll] sync mislukt:', err.message);
    }
  });
}

module.exports = startPollJob;
