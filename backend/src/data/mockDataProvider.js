const { deriveCurrentProjectPhase, resolvePhaseCode, normalizeLabel } = require('../phases/phaseModel');

/**
 * Dezelfde voorbeeldset als in het frontend-concept (ecofinity-cockpit.html), maar nu
 * bediend via het REST-contract van de echte backend. Zo kan de frontend nu al overschakelen
 * van "ingebakken mockdata" naar "fetch bij een backend" zonder dat er functioneel iets verandert —
 * en zodra MOCK_MODE=false gaat, roept exact dezelfde API-laag de LiveDataProvider aan.
 */
const RAW = [
  { dealId: 'DEAL-1042', projectId: 'PRJ-284', priority: 14, customer: 'Familie De Smet', type: 'Warmtepomp lucht/water',
    dealClosedAt: '2026-08-21', phaseEnteredDate: '2026-09-16',
    history: { '01': { done: true, date: '2026-08-22' }, '02': { done: true, date: '2026-09-18' } },
    deadlines: { '03': '2026-09-27', '04': '2026-10-05', '05': '2026-10-13', '06': '2026-10-21', '07': '2026-10-29' },
    workOverview: { '01': { reg: '-', est: '1u00' } } },

  { dealId: 'DEAL-1011', projectId: 'PRJ-260', priority: 9, customer: 'Familie Janssens', type: 'Zonnepanelen (12 stuks)',
    dealClosedAt: '2026-08-12', phaseEnteredDate: '2026-09-20',
    history: { '01': { done: true, date: '2026-08-13' }, '02': { done: true, date: '2026-08-29' }, '03': { done: true, date: '2026-09-20' } },
    deadlines: { '04': '2026-09-25' } },

  { dealId: 'DEAL-1015', projectId: 'PRJ-271', priority: 11, customer: 'Familie Peeters', type: 'Warmtepomp lucht/lucht',
    dealClosedAt: '2026-08-15', phaseEnteredDate: '2026-09-22',
    history: { '01': { done: true, date: '2026-08-16' }, '02': { done: true, date: '2026-09-02' }, '03': { done: true, date: '2026-09-22' } },
    deadlines: { '04': '2026-10-02' } },

  { dealId: 'DEAL-1024', projectId: 'PRJ-299', priority: 18, customer: 'Familie Claeys', type: 'Laadpaal',
    dealClosedAt: '2026-08-24', phaseEnteredDate: '2026-09-25',
    history: { '01': { done: true, date: '2026-08-25' }, '02': { done: true, date: '2026-09-05' }, '03': { done: true, date: '2026-09-25' } },
    deadlines: { '04': '2026-10-10' } },

  { dealId: 'DEAL-1002', projectId: 'PRJ-241', priority: 8, customer: 'Familie Vermeulen', type: 'Warmtepomp lucht/water',
    dealClosedAt: '2026-07-30', phaseEnteredDate: '2026-09-10',
    history: { '01': { done: true, date: '2026-07-31' }, '02': { done: true, date: '2026-08-14' }, '03': { done: true, date: '2026-09-10' } },
    deadlines: { '04': '2026-09-20' },
    hold: { reason: 'Klant vraagt uitstel', note: 'Klant wenst uitvoering pas vanaf november' } },

  { dealId: 'DEAL-1031', projectId: 'PRJ-305', priority: 20, customer: 'Familie Van Acker', type: 'Dakisolatie',
    dealClosedAt: '2026-08-28', phaseEnteredDate: '2026-08-28', history: {}, deadlines: {} },

  { dealId: 'DEAL-1026', projectId: 'PRJ-291', priority: 16, customer: 'Familie Willems', type: 'Warmtepomp lucht/water',
    dealClosedAt: '2026-08-22', phaseEnteredDate: '2026-09-02',
    history: { '01': { done: true, date: '2026-08-23' } }, deadlines: { '02': '2026-09-30' } },

  { dealId: 'DEAL-1016', projectId: 'PRJ-275', priority: 12, customer: 'Familie Mertens', type: 'Zonnepanelen (9 stuks)',
    dealClosedAt: '2026-08-16', phaseEnteredDate: '2026-09-18',
    history: { '01': { done: true, date: '2026-08-17' }, '02': { done: true, date: '2026-08-30' }, '03': { done: true, date: '2026-09-18' }, '04': { done: true, date: '2026-09-18' } },
    deadlines: { '05': '2026-10-13' },
    installation: { date: '2026-10-06', start: '08:00', end: '16:00', team: 'Team Noord — Kevin & Tom' } },

  { dealId: 'DEAL-1019', projectId: 'PRJ-279', priority: 13, customer: 'Familie Bogaert', type: 'Warmtepomp lucht/water',
    dealClosedAt: '2026-08-19', phaseEnteredDate: '2026-09-15',
    history: { '01': { done: true, date: '2026-08-20' }, '02': { done: true, date: '2026-09-01' }, '03': { done: true, date: '2026-09-15' }, '04': { done: true, date: '2026-09-15' } },
    deadlines: { '05': '2026-10-09' }, installation: null },

  { dealId: 'DEAL-0994', projectId: 'PRJ-233', priority: 6, customer: 'Familie Coppens', type: 'Laadpaal',
    dealClosedAt: '2026-07-28', phaseEnteredDate: '2026-09-10',
    history: { '01': { done: true, date: '2026-07-29' }, '02': { done: true, date: '2026-08-05' }, '03': { done: true, date: '2026-08-20' }, '04': { done: true, date: '2026-09-05' }, '05': { done: true, date: '2026-09-10' } },
    deadlines: { '06': '2026-09-24' } },

  { dealId: 'DEAL-0987', projectId: 'PRJ-220', priority: 5, customer: 'Familie Van Damme', type: 'Zonnepanelen (16 stuks)',
    dealClosedAt: '2026-08-02', phaseEnteredDate: '2026-09-20',
    history: { '01': { done: true, date: '2026-08-03' }, '02': { done: true, date: '2026-08-12' }, '03': { done: true, date: '2026-08-25' }, '04': { done: true, date: '2026-09-05' }, '05': { done: true, date: '2026-09-12' }, '06': { done: true, date: '2026-09-20' } },
    deadlines: { '07': '2026-10-01' } },

  { dealId: 'DEAL-0955', projectId: 'PRJ-198', priority: 3, customer: "Familie D'Hondt", type: 'Warmtepomp lucht/water',
    dealClosedAt: '2026-07-10', phaseEnteredDate: '2026-08-20',
    history: { '01': { done: true, date: '2026-07-11' }, '02': { done: true, date: '2026-07-20' }, '03': { done: true, date: '2026-08-01' }, '04': { done: true, date: '2026-08-10' }, '05': { done: true, date: '2026-08-15' }, '06': { done: true, date: '2026-08-20' }, '07': { done: true, date: '2026-09-05' } },
    deadlines: {} },

  { dealId: 'DEAL-1033', projectId: 'PRJ-311', priority: 22, customer: 'Familie Lambrecht', type: 'Warmtepomp lucht/water',
    dealClosedAt: '2026-09-01', phaseEnteredDate: '2026-09-21',
    history: { '01': { done: true, date: '2026-09-02' }, '02': { done: false }, '03': { done: true, date: '2026-09-15' } },
    deadlines: { '05': '2026-10-11' },
    teamleaderActivePhase: '05',
    installation: { date: '2026-10-11', start: '09:00', end: '15:00', team: 'Team Zuid — Bram & Yorick' } },

  { dealId: 'DEAL-1036', projectId: 'PRJ-318', priority: 25, customer: 'Familie Sterckx', type: 'Warmtepomp lucht/water',
    dealClosedAt: '2026-09-03', phaseEnteredDate: '2026-09-24',
    history: { '01': { done: true, date: '2026-09-04' }, '02': { done: true, date: '2026-09-15' }, '03': { done: true, date: '2026-09-24' } },
    deadlines: {}, unknownPhase: 'Nazorgcontrole' },

  { dealId: 'DEAL-1038', projectId: null, priority: 27, customer: 'Familie Aerts', type: 'Warmtepomp lucht/water',
    dealClosedAt: '2026-09-04', phaseEnteredDate: '2026-09-04', history: {}, deadlines: {}, missingProject: true },
];

const DURATION_STATS = [
  { code: '01', avg: 1.8, median: 1, active: 6, oldest: 9 },
  { code: '02', avg: 2.4, median: 2, active: 5, oldest: 11 },
  { code: '03', avg: 16.7, median: 13, active: 12, oldest: 31 },
  { code: '04', avg: 8.3, median: 6, active: 9, oldest: 19 },
  { code: '05', avg: 12.5, median: 11, active: 7, oldest: 22 },
  { code: '06', avg: 1.6, median: 1, active: 3, oldest: 5 },
  { code: '07', avg: null, median: null, active: 2, oldest: 6 },
];

class MockDataProvider {
  constructor() {
    this._threshold = 7;
    this._aliases = []; // { alias, code }
    // Zelfde vaste illustratieve peildatum als het frontend-concept (ecofinity-cockpit.html),
    // zodat beide demo's identieke "dagen in fase"/deadline-uitkomsten tonen. De LiveDataProvider
    // gebruikt altijd de echte huidige datum — enkel deze mockdata is aan een vaste datum verankerd.
  }

  getReferenceDate() {
    return new Date(2026, 8, 27); // 27/09/2026
  }

  async listProjects() {
    return RAW.map((raw) => this._toView(raw));
  }

  async getProject(dealId) {
    const raw = RAW.find((r) => r.dealId === dealId);
    return raw ? this._toView(raw) : null;
  }

  async getDurationStats() {
    return DURATION_STATS;
  }

  async getAttentionThresholdDays() {
    return this._threshold;
  }

  async setAttentionThresholdDays(days) {
    this._threshold = days;
  }

  async getPhaseAliases() {
    return this._aliases;
  }

  async addPhaseAlias(alias, code) {
    this._aliases.push({ alias, code });
  }

  _toView(raw) {
    // Als er intussen een alias geconfigureerd is voor deze onbekende Teamleader-fasenaam
    // (sectie 5: "Koppel fase"), behandel het record dan alsof Teamleader die gekoppelde
    // fase als actief meldt — precies zoals resolvePhaseCode() dat voor live data ook doet.
    let unknownLabel = raw.unknownPhase || null;
    let explicitActiveCode = raw.teamleaderActivePhase || null;
    if (unknownLabel) {
      const resolved = resolvePhaseCode(unknownLabel, this._aliases);
      if (resolved) {
        explicitActiveCode = resolved;
        unknownLabel = null;
      }
    }

    const derived = deriveCurrentProjectPhase({
      hasLinkedProject: !raw.missingProject,
      hasUnknownPhase: unknownLabel ? { label: unknownLabel } : null,
      phaseHistory: raw.history || {},
      teamleaderActivePhaseCode: explicitActiveCode,
    });

    return {
      dealId: raw.dealId,
      projectId: raw.projectId,
      priority: raw.priority,
      customer: raw.customer,
      type: raw.type,
      dealClosedAt: raw.dealClosedAt,
      phaseEnteredDate: raw.phaseEnteredDate,
      history: raw.history || {},
      deadlines: raw.deadlines || {},
      workOverview: raw.workOverview || {},
      installation: raw.installation === undefined ? null : raw.installation,
      hold: raw.hold || null,
      missingProject: !!raw.missingProject,
      currentPhaseCode: derived.currentPhaseCode,
      closed: derived.closed,
      dataIssue: derived.dataIssue,
      unknownPhaseLabel: derived.unknown ? derived.unknownLabel : null,
    };
  }
}

module.exports = MockDataProvider;
