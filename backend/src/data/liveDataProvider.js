const { PHASES } = require('../phases/phaseModel');

/**
 * Leest exact hetzelfde "ProjectView"-contract als MockDataProvider, maar dan vanuit de
 * Postgres-tabellen die de sync-engine vult (zie src/sync/syncEngine.js + db/schema.sql).
 * De REST-routes in src/api/* weten niet welke van de twee providers actief is.
 */
class LiveDataProvider {
  constructor(pool, settingsRepo) {
    this.pool = pool;
    this.settingsRepo = settingsRepo;
  }

  async listProjects() {
    const dealsRes = await this.pool.query(`SELECT * FROM deals ORDER BY priority_rank ASC NULLS LAST`);
    const views = [];
    for (const deal of dealsRes.rows) {
      try {
        views.push(await this._buildView(deal));
      } catch (err) {
        // Eén onvolledige/inconsistente rij (bv. een deal die halverwege een mislukte sync
        // zit) mag nooit de volledige cockpit voor alle andere, wél correcte deals platleggen.
        // We loggen het en tonen dit record als "probleem", in plaats van de hele lijst te
        // laten crashen.
        console.error(`[cockpit-data] kon deal ${deal.deal_id} niet opbouwen, sla over:`, err.message);
        views.push({
          dealId: deal.deal_id,
          projectId: null,
          priority: deal.priority_rank,
          customer: deal.customer,
          type: deal.title,
          dealClosedAt: toDateStr(deal.deal_closed_at),
          phaseEnteredDate: null,
          history: {},
          deadlines: {},
          workOverview: {},
          installation: null,
          hold: null,
          missingProject: false,
          currentPhaseCode: null,
          closed: false,
          dataIssue: `Kon dit record niet volledig laden: ${err.message}`,
          unknownPhaseLabel: null,
        });
      }
    }
    return views;
  }

  async getProject(dealId) {
    const res = await this.pool.query(`SELECT * FROM deals WHERE deal_id = $1`, [dealId]);
    if (!res.rows[0]) return null;
    return this._buildView(res.rows[0]);
  }

  async _buildView(deal) {
    if (!deal.has_linked_project) {
      return {
        dealId: deal.deal_id,
        projectId: null,
        priority: deal.priority_rank,
        customer: deal.customer,
        type: deal.title,
        dealClosedAt: toDateStr(deal.deal_closed_at),
        phaseEnteredDate: null,
        history: {},
        deadlines: {},
        workOverview: {},
        installation: null,
        hold: null,
        missingProject: true,
        currentPhaseCode: null,
        closed: false,
        dataIssue: null,
        unknownPhaseLabel: null,
      };
    }

    const projRes = await this.pool.query(`SELECT * FROM projects WHERE deal_id = $1`, [deal.deal_id]);
    const project = projRes.rows[0];
    if (!project) {
      // has_linked_project staat op TRUE, maar de bijhorende projects-rij ontbreekt —
      // een inconsistentie die niet zou mogen voorkomen (upsertProjectSnapshot zet beide
      // atomisch samen), maar we crashen hier niet blindelings op als het toch gebeurt.
      throw new Error(`deal.has_linked_project=true maar geen projects-rij gevonden voor deal ${deal.deal_id}`);
    }

    const phaseRes = await this.pool.query(
      `SELECT * FROM project_phase_history WHERE project_id = $1 ORDER BY phase_code ASC`,
      [project.project_id]
    );

    const history = {};
    const deadlines = {};
    const workOverview = {};
    let phaseEnteredDate = null;

    for (const row of phaseRes.rows) {
      history[row.phase_code] = { done: row.done, date: toDateStr(row.completed_at) };
      if (row.planned_ends_on) deadlines[row.phase_code] = toDateStr(row.planned_ends_on);
      workOverview[row.phase_code] = {
        reg: formatDuration(row.time_registered_seconds),
        est: formatDuration(row.time_estimated_seconds),
      };
      if (row.phase_code === project.current_phase_code) {
        phaseEnteredDate = toDateStr(row.entered_at);
      }
    }

    const installRes = await this.pool.query(`SELECT * FROM project_installations WHERE project_id = $1`, [
      project.project_id,
    ]);
    const install = installRes.rows[0];

    return {
      dealId: deal.deal_id,
      projectId: project.project_id,
      priority: deal.priority_rank,
      customer: deal.customer,
      type: project.project_title || deal.title,
      dealClosedAt: toDateStr(deal.deal_closed_at),
      phaseEnteredDate,
      history,
      deadlines,
      workOverview,
      installation: install
        ? { date: toDateStr(install.install_date), start: install.start_time, end: install.end_time, team: install.team_label }
        : null,
      hold: project.hold_reason ? { reason: project.hold_reason, note: project.hold_note } : null,
      missingProject: false,
      currentPhaseCode: project.current_phase_code,
      closed: project.closed,
      dataIssue: project.data_issue,
      unknownPhaseLabel: project.unknown_phase_label,
    };
  }

  /** Sectie 14: gemiddelde/mediaan doorlooptijd per fase, berekend over de historiek. */
  async getDurationStats() {
    const res = await this.pool.query(`
      SELECT
        phase_code,
        AVG(EXTRACT(EPOCH FROM (COALESCE(completed_at, now()) - entered_at)) / 86400.0)
          FILTER (WHERE entered_at IS NOT NULL) AS avg_days,
        PERCENTILE_CONT(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (COALESCE(completed_at, now()) - entered_at)) / 86400.0
        ) FILTER (WHERE entered_at IS NOT NULL) AS median_days,
        COUNT(*) FILTER (WHERE done = FALSE) AS active_count,
        MAX(EXTRACT(EPOCH FROM (now() - entered_at)) / 86400.0) FILTER (WHERE done = FALSE) AS oldest_days
      FROM project_phase_history
      GROUP BY phase_code
    `);

    return PHASES.map((ph) => {
      const row = res.rows.find((r) => r.phase_code === ph.code);
      return {
        code: ph.code,
        avg: row && row.avg_days != null ? Number(row.avg_days) : null,
        median: row && row.median_days != null ? Number(row.median_days) : null,
        active: row ? Number(row.active_count) : 0,
        oldest: row && row.oldest_days != null ? Math.round(Number(row.oldest_days)) : null,
      };
    });
  }

  async getAttentionThresholdDays() {
    return this.settingsRepo.getAttentionThresholdDays();
  }

  async setAttentionThresholdDays(days) {
    return this.settingsRepo.setAttentionThresholdDays(days);
  }

  async getPhaseAliases() {
    return this.settingsRepo.getPhaseAliases();
  }

  async addPhaseAlias(alias, code) {
    return this.settingsRepo.addPhaseAlias(alias, code);
  }
}

function toDateStr(d) {
  if (!d) return null;
  const date = new Date(d);
  return date.toISOString().slice(0, 10);
}

function formatDuration(seconds) {
  if (seconds == null) return '-';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}u${String(m).padStart(2, '0')}`;
}

module.exports = LiveDataProvider;
