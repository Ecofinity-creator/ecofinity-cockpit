const { deriveCurrentProjectPhase, resolvePhaseCode } = require('../phases/phaseModel');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Aantal deals per portie. Render's gratis laag lijkt achtergrondwerk niet onbeperkt lang
// te garanderen als er geen actief HTTP-verzoek meer loopt; door in kleine porties te werken
// (in plaats van in één keer alle 100+ deals te verwerken) blijft elke aanroep kort genoeg
// om altijd volledig af te ronden, en bouwt de voortgang betrouwbaar op over meerdere
// aanroepen heen — via herhaalde handmatige triggers, of gewoon via de periodieke poll.
const BATCH_SIZE = 15;

/**
 * Orkestreert de volledige sync-stroom, exact volgens sectie 17 van de spec:
 *
 *   Teamleader deal gewonnen
 *        -> besteldatum (deal.closed_at, NOOIT project.created_at)
 *        -> gekoppeld Teamleader-project
 *        -> bestaande Ecofinity-projectfase (via deriveCurrentProjectPhase)
 *        -> deadline/status
 *        -> Order & Project Cockpit (REST API -> frontend)
 */
class SyncEngine {
  constructor({ dealsApi, projectsApi, dealsRepo, projectsRepo, settingsRepo }) {
    this.dealsApi = dealsApi;
    this.projectsApi = projectsApi;
    this.dealsRepo = dealsRepo;
    this.projectsRepo = projectsRepo;
    this.settingsRepo = settingsRepo;
    this._syncing = false; // vergrendeling: voorkomt overlappende syncs (poll + handmatige trigger)
  }

  /**
   * Verwerkt één portie (BATCH_SIZE) van de openstaande wachtrij deals. Bij een nieuwe of
   * volledige sync wordt de wachtrij eerst (opnieuw) opgebouwd; bij een lopende sync wordt
   * gewoon verdergegaan waar de vorige aanroep stopte. `lastSyncAt` wordt pas gezet zodra de
   * wachtrij volledig leeg is — zo blijft altijd zichtbaar of een sync écht compleet is.
   */
  async syncAll({ incremental = true } = {}) {
    if (this._syncing) {
      console.log('[sync] overgeslagen: er loopt al een synchronisatie (voorkomt dubbele API-belasting/rate limits).');
      return { skipped: true, reason: 'sync already in progress' };
    }
    this._syncing = true;
    try {
      let queue = await this.settingsRepo.getPendingSyncQueue();

      if (!incremental || queue.length === 0) {
        // Enkel een nieuwe lijst ophalen als er niets meer in de wachtrij staat (of bij een
        // expliciet volledige sync) — anders bouwen we gewoon verder op het vorige werk.
        const lastSync = incremental ? await this.settingsRepo.getLastSyncTimestamp() : null;
        const deals = await this.dealsApi.listWonDeals(lastSync ? { updatedSince: lastSync } : {});
        queue = deals.map((d) => d.id);
        await this.settingsRepo.setPendingSyncQueue(queue);
      }

      const batch = queue.slice(0, BATCH_SIZE);
      const rest = queue.slice(BATCH_SIZE);

      let ok = 0;
      let failed = 0;
      for (const dealId of batch) {
        try {
          await this.syncOneDeal(dealId);
          ok += 1;
        } catch (err) {
          failed += 1;
          console.error(`[sync] deal ${dealId} mislukt:`, err.message);
          await this.settingsRepo.logSyncIssue(dealId, err.message);
        }
        await sleep(1500);
      }

      await this.settingsRepo.setPendingSyncQueue(rest);
      const queueComplete = rest.length === 0;
      if (queueComplete) {
        await this.settingsRepo.setLastSyncTimestamp(new Date().toISOString());
      }

      return { batchSize: batch.length, ok, failed, remainingInQueue: rest.length, queueComplete };
    } finally {
      this._syncing = false;
    }
  }

  /**
   * Blijft porties verwerken tot de wachtrij volledig leeg is, met een korte pauze ertussen.
   * Draait volledig verder op de achtergrond in dit Node-proces — er hoeft geen HTTP-verzoek
   * open te blijven staan. Bij een grote initiële wachtrij (honderden/duizenden historische
   * deals) kan dit een tijd duren; dat is de bedoeling, in plaats van in één keer te veel te
   * willen doen en halverwege vast te lopen.
   */
  async runUntilQueueEmpty({ incremental = true } = {}) {
    let first = true;
    let result;
    do {
      // eslint-disable-next-line no-await-in-loop
      result = await this.syncAll({ incremental: first ? incremental : true });
      first = false;
      console.log('[sync] portie verwerkt:', result);
      if (result.skipped) break; // een andere sync (bv. de periodieke poll) is al bezig
      if (!result.queueComplete) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(3000);
      }
    } while (!result.queueComplete);
    return result;
  }

  /** Sync van precies één deal — gebruikt zowel door de volledige poll als door webhook-triggers. */
  async syncOneDeal(dealId) {
    const deal = await this.dealsApi.getDeal(dealId);

    const dealRecord = {
      dealId: deal.id,
      customer: (deal.lead && deal.lead.customer && deal.lead.customer.name) || deal.title,
      title: deal.title,
      dealClosedAt: deal.closed_at, // BESTELDATUM — uitsluitend dit veld, nooit project.created_at
      priorityRank: null, // ingevuld hieronder t.o.v. andere open orders (sectie 6)
    };
    await this.dealsRepo.upsertDeal(dealRecord);

    // Een deal heeft in Teamleader niet noodzakelijk een directe "project"-relatie in de
    // .info-respons; sommige accounts koppelen dit via een custom field, andere via
    // `projects-v2/projects.list` gefilterd op deal_id. We proberen dat laatste eerst.
    const linkedProjectId = await this._resolveLinkedProjectId(deal);

    if (!linkedProjectId) {
      await this.projectsRepo.markDealWithoutProject(deal.id);
      await this._recomputePriorityRanking();
      return;
    }

    const project = await this.projectsApi.getProjectWithPhases(linkedProjectId);
    const aliases = await this.settingsRepo.getPhaseAliases();

    const phaseHistory = {};
    let unknownPhase = null;
    let explicitActiveCode = null;

    for (const phase of project.phases) {
      const code = resolvePhaseCode(phase.title, aliases);
      if (!code) {
        unknownPhase = { label: phase.title };
        continue;
      }
      phaseHistory[code] = {
        done: phase.closed,
        completedAt: phase.closed ? phase.plannedEndsOn : null, // best-effort; zie noot hieronder
        plannedEndsOn: phase.plannedEndsOn,
        timeEstimated: phase.timeEstimated,
        timeRegistered: phase.timeRegistered,
      };
      if (!phase.closed && explicitActiveCode === null) {
        explicitActiveCode = code; // eerste niet-gesloten groep/milestone = wat Teamleader als actief toont
      }
    }

    const derived = deriveCurrentProjectPhase({
      hasLinkedProject: true,
      hasUnknownPhase: unknownPhase,
      phaseHistory,
      teamleaderActivePhaseCode: explicitActiveCode,
    });

    await this.projectsRepo.upsertProjectSnapshot({
      dealId: deal.id,
      projectId: project.id,
      projectTitle: project.title,
      phaseHistory,
      unknownPhaseLabel: derived.unknown ? derived.unknownLabel : null,
      currentPhaseCode: derived.currentPhaseCode,
      closed: derived.closed,
      dataIssue: derived.dataIssue,
      syncedAt: new Date().toISOString(),
    });

    await this._recomputePriorityRanking();
  }

  async _resolveLinkedProjectId(deal) {
    if (deal.project_id) return deal.project_id; // sommige accounts exposeren dit rechtstreeks

    try {
      return await this.projectsApi.findProjectIdByDealId(deal.id);
    } catch (err) {
      // Als de deal_id-filter voor dit account/deze module onverwacht faalt, geen koppeling
      // verzinnen: het record verschijnt dan terecht onder "Project ontbreekt".
      console.error(`[sync] kon project voor deal ${deal.id} niet opzoeken via deal_id-filter:`, err.message);
      return null;
    }
  }

  /** Herberekent de bestelprioriteit (sectie 6/12: volgorde = datum deal gewonnen). */
  async _recomputePriorityRanking() {
    await this.projectsRepo.recomputePriorityByDealClosedAt();
  }

  /** Verwerkt één webhook-event: bepaalt welke deal erdoor geraakt is en synct die gericht. */
  async handleWebhookEvent(event) {
    const dealId =
      (event.details && event.details.id && event.type && event.type.startsWith('deal.') && event.details.id) ||
      (event.details && event.details.deal_id) ||
      null;

    if (dealId) {
      await this.syncOneDeal(dealId);
      return;
    }

    // Project/milestone/timeTracking-events dragen doorgaans geen deal-id rechtstreeks.
    // In dat geval zoeken we de deal op via de projectsRepo-koppeling die we eerder opgeslagen hebben.
    const projectId = event.details && (event.details.project_id || event.details.id);
    if (projectId) {
      const linkedDealId = await this.projectsRepo.findDealIdByProjectId(projectId);
      if (linkedDealId) await this.syncOneDeal(linkedDealId);
    }
  }
}

module.exports = SyncEngine;
