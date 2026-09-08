const axios = require('axios');
const config = require('../config');

/**
 * Teamleader Focus API v2 is RPC-stijl: alle calls zijn POST naar
 * https://api.focus.teamleader.eu/<resource>.<actie>, met JSON-body.
 * (bron: developer.focus.teamleader.eu / apiary.apib — "General principles")
 *
 * Deze client kapselt:
 *  - het Bearer-token (opgehaald via tokenStore, met automatische refresh)
 *  - rate-limit-afhandeling (HTTP 429 + X-RateLimit-* headers, sliding window per minuut)
 *  - paginering (page.size / page.number, standaard doorlopen tot alle pagina's op zijn)
 *  - sideloading via het "include" veld, om extra API-calls te vermijden
 */
class TeamleaderClient {
  constructor(tokenStore) {
    this.tokenStore = tokenStore; // levert een geldig access_token, ververst indien nodig
  }

  async call(resourceAction, body = {}, { retries = 3, rateLimitRetries = 12 } = {}) {
    const accessToken = await this.tokenStore.getValidAccessToken();

    try {
      const res = await axios.post(`${config.teamleader.apiBaseUrl}/${resourceAction}`, body, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        validateStatus: () => true,
      });

      if (res.status === 401 && retries > 0) {
        // token bleek toch verlopen/ingetrokken -> forceer refresh en probeer opnieuw
        await this.tokenStore.forceRefresh();
        return this.call(resourceAction, body, { retries: retries - 1, rateLimitRetries });
      }

      if (res.status === 429) {
        // Rate limits zijn een NORMALE, verwachte situatie bij een grote sync (bv. de eerste
        // volledige sync met honderd+ deals) — geen echte fout. We wachten daarom gewoon de
        // volledige tijd tot de teller opnieuw vrijgeeft (geen willekeurige cap op de wachttijd),
        // met een apart, ruimer aantal pogingen dan bij echte fouten.
        if (rateLimitRetries <= 0) {
          throw Object.assign(new Error(`Teamleader API-fout op ${resourceAction}: rate limit bleef aanhouden na herhaalde pogingen (HTTP 429)`), { status: 429 });
        }
        const resetAt = res.headers['x-ratelimit-reset'];
        const waitMs = resetAt ? Math.max(1000, new Date(resetAt).getTime() - Date.now() + 500) : 10000;
        console.log(`[rate-limit] ${resourceAction}: wacht ${Math.round(waitMs / 1000)}s tot de teller vrijgeeft (${rateLimitRetries} pogingen resterend)`);
        await sleep(waitMs);
        return this.call(resourceAction, body, { retries, rateLimitRetries: rateLimitRetries - 1 });
      }

      if (res.status >= 400) {
        const message = (res.data && res.data.errors && res.data.errors.map((e) => e.title).join('; ')) || res.statusText;
        const err = new Error(`Teamleader API-fout op ${resourceAction}: ${message} (HTTP ${res.status})`);
        err.status = res.status;
        err.payload = res.data;
        throw err;
      }

      return res.data; // { data: ..., meta?: ..., included?: ... }
    } catch (err) {
      if (err.status) throw err;
      throw new Error(`Netwerkfout bij Teamleader-call ${resourceAction}: ${err.message}`);
    }
  }

  /**
   * Doorloopt alle pagina's van een .list-endpoint.
   * Teamleader gebruikt page.size (max 100 doorgaans) + page.number, en meta.matches
   * voor het totaal aantal treffers.
   */
  async listAll(resourceAction, { filter = {}, sort, include, pageSize = 100, maxPages = 50 } = {}) {
    let all = [];
    let page = 1;
    while (page <= maxPages) {
      const body = { filter, page: { size: pageSize, number: page } };
      if (sort) body.sort = sort;
      if (include) body.include = include;

      const res = await this.call(`${resourceAction}.list`, body);
      const items = res.data || [];
      all = all.concat(items);

      const matches = res.meta && res.meta.page ? res.meta.page.matches : (res.meta || {}).matches;
      if (items.length < pageSize) break; // laatste pagina bereikt
      if (typeof matches === 'number' && all.length >= matches) break;
      page += 1;
    }
    return all;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = TeamleaderClient;
