const { PHASES } = require('../../phases/phaseModel');

class ProjectsRepo {
  constructor(pool) {
    this.pool = pool;
  }

  async markDealWithoutProject(dealId) {
    await this.pool.query(`UPDATE deals SET has_linked_project = FALSE WHERE deal_id = $1`, [dealId]);
    await this.pool.query(`DELETE FROM projects WHERE deal_id = $1`, [dealId]);
  }

  async upsertProjectSnapshot({
    dealId,
    projectId,
    projectTitle,
    phaseHistory,
    unknownPhaseLabel,
    currentPhaseCode,
    closed,
    dataIssue,
  }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(`UPDATE deals SET has_linked_project = TRUE WHERE deal_id = $1`, [dealId]);

      await client.query(
        `INSERT INTO projects (project_id, deal_id, project_title, current_phase_code, closed, data_issue, unknown_phase_label, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now())
         ON CONFLICT (project_id) DO UPDATE SET
           project_title = EXCLUDED.project_title,
           current_phase_code = EXCLUDED.current_phase_code,
           closed = EXCLUDED.closed,
           data_issue = EXCLUDED.data_issue,
           unknown_phase_label = EXCLUDED.unknown_phase_label,
           synced_at = now()`,
        [projectId, dealId, projectTitle, currentPhaseCode, closed, dataIssue, unknownPhaseLabel]
      );

      for (const phase of PHASES) {
        const h = phaseHistory[phase.code];
        if (!h) continue;
        await client.query(
          `INSERT INTO project_phase_history
             (project_id, phase_code, done, completed_at, planned_ends_on, time_estimated_seconds, time_registered_seconds)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (project_id, phase_code) DO UPDATE SET
             done = EXCLUDED.done,
             completed_at = EXCLUDED.completed_at,
             planned_ends_on = EXCLUDED.planned_ends_on,
             time_estimated_seconds = EXCLUDED.time_estimated_seconds,
             time_registered_seconds = EXCLUDED.time_registered_seconds`,
          [projectId, phase.code, h.done, h.completedAt, h.plannedEndsOn, h.timeEstimated, h.timeRegistered]
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Sectie 6/12: bestelprioriteit = volgorde van dealClosedAt, over ALLE deals heen (ook gesloten dossiers behouden hun historische rang). */
  async recomputePriorityByDealClosedAt() {
    await this.pool.query(`
      WITH ranked AS (
        SELECT deal_id, ROW_NUMBER() OVER (ORDER BY deal_closed_at ASC) AS rnk
        FROM deals
      )
      UPDATE deals d SET priority_rank = ranked.rnk
      FROM ranked WHERE ranked.deal_id = d.deal_id
    `);
  }

  async findDealIdByProjectId(projectId) {
    const res = await this.pool.query(`SELECT deal_id FROM projects WHERE project_id = $1`, [projectId]);
    return res.rows[0] ? res.rows[0].deal_id : null;
  }

  async setHold(projectId, reason, note) {
    await this.pool.query(`UPDATE projects SET hold_reason = $2, hold_note = $3 WHERE project_id = $1`, [
      projectId,
      reason,
      note,
    ]);
  }

  async clearHold(projectId) {
    await this.pool.query(`UPDATE projects SET hold_reason = NULL, hold_note = NULL WHERE project_id = $1`, [projectId]);
  }
}

module.exports = ProjectsRepo;
