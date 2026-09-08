const { deriveCurrentProjectPhase, resolvePhaseCode } = require('../phases/phaseModel');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  }

  /** Volledige of incrementele sync van alle gewonnen deals + hun gekoppelde project. */
  async syncAll({ incremental = true } = {}) {
    const lastSync = incremental ? await this.settingsRepo.getLastSyncTimestamp() : null;
    const deals = await this.dealsApi.listWonDeals(lastSync ? { updatedSince: lastSync } : {});

    let ok = 0;
    let failed = 0;
    for (const deal of deals) {
      try {
        await this.syncOneDeal(deal.id);
        ok += 1;
      } catch (err) {
        failed += 1;
        console.error(`[sync] deal ${deal.id} mislukt:`, err.message);
        await this.settingsRepo.logSyncIssue(deal.id, err.message);
      }
      // Kleine pauze tussen elke deal (elk goed voor 3-4 API-calls): voorkomt dat we de
      // rate limit proactief opbouwen bij een grote sync, in plaats van enkel achteraf te
      // moeten herstellen via de retry-logica in TeamleaderClient.
      await sleep(300);
    }

    await this.settingsRepo.setLastSyncTimestamp(new Date().toISOString());
    return { dealsProcessed: deals.length, ok, failed };
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
