/**
 * Teamleader heeft TWEE projectmodules naast elkaar (sinds juli 2023):
 *   - Legacy Projects: `projects`, `milestones`
 *   - Nieuwe Projects (v2): `projects-v2/projects`, `projects-v2/projectGroups`
 * Een account gebruikt het één of het ander; welke, is per account op te vragen via
 * `accounts/projects-v2-status` (bevestigd endpoint, toegevoegd augustus 2024).
 *
 * Ecofinity's "Werkoverzicht" (fase + geregistreerde/geschatte tijd + opleverdatum) komt
 * overeen met hoe fasen/groepen in beide modules gemodelleerd worden; deze wrapper
 * normaliseert het verschil zodat de rest van het systeem er niets van hoeft te weten.
 */
class ProjectsApi {
  constructor(client) {
    this.client = client;
    this._moduleVersion = null; // 'legacy' | 'v2', gecached na eerste check
  }

  async detectModuleVersion() {
    if (this._moduleVersion) return this._moduleVersion;
    try {
      const res = await this.client.call('accounts.projects-v2-status', {});
      this._moduleVersion = res.data && res.data.enabled ? 'v2' : 'legacy';
    } catch (err) {
      // Als het endpoint (nog) niet beschikbaar is voor dit account, val terug op legacy.
      this._moduleVersion = 'legacy';
    }
    return this._moduleVersion;
  }

  /**
   * Haalt één project op met zijn fasen (milestones of projectGroups), genormaliseerd naar:
   * { id, title, phases: [{ id, title, plannedEndsOn, timeEstimated, timeRegistered, closed, startedOn }] }
   */
  async getProjectWithPhases(projectId) {
    const version = await this.detectModuleVersion();
    if (version === 'v2') return this._getProjectV2(projectId);
    return this._getProjectLegacy(projectId);
  }

  async _getProjectLegacy(projectId) {
    const projectRes = await this.client.call('projects.info', { id: projectId });
    const project = projectRes.data;

    const milestones = await this.client.listAll('milestones', { filter: { project_id: projectId } });

    // LET OP: `budget`/`actuals` zijn bevestigd aanwezig op milestones.info/.list (Teamleader
    // changelog maart 2020: "We added actuals and budget to projects.list, projects.info,
    // milestones.list, and milestones.info"), maar de exacte veldnamen hieronder zijn een
    // best-effort mapping. Verifieer bij de eerste live call het echte JSON-schema
    // (bv. via een test-call met Postman) en pas deze mapping zo nodig aan.
    const phases = milestones
      .sort((a, b) => new Date(a.starts_on || 0) - new Date(b.starts_on || 0))
      .map((m) => ({
        id: m.id,
        title: m.name || m.title,
        plannedEndsOn: m.due_on || null,
        timeEstimated: (m.budget && m.budget.time_estimated) || null,
        timeRegistered: (m.actuals && m.actuals.time_tracked) || null,
        closed: m.status === 'closed',
        startedOn: m.starts_on || null,
      }));

    return { id: project.id, title: project.title, phases };
  }

  async _getProjectV2(projectId) {
    const projectRes = await this.client.call('projects-v2/projects.info', { id: projectId });
    const project = projectRes.data;

    const groups = await this.client.listAll('projects-v2/projectGroups', { filter: { project_id: projectId } });

    // LET OP: net als bij de legacy-mapping hierboven — `planned_end_date`, `time_estimated`
    // en `time_tracked` zijn plausibele veldnamen op basis van de projects-v2 changelog
    // (die time_estimated/amount_unbilled op projects-v2/projects.list bevestigt), maar
    // verifieer tegen een echte projectGroups.list-respons voordat dit in productie gaat.
    const phases = groups
      .sort((a, b) => (a.order_number || 0) - (b.order_number || 0))
      .map((g) => ({
        id: g.id,
        title: g.title,
        plannedEndsOn: g.planned_end_date || g.due_on || null,
        timeEstimated: g.time_estimated || null,
        timeRegistered: g.time_tracked || null,
        closed: !!g.closed || g.status === 'closed',
        startedOn: g.planned_start_date || null,
      }));

    return { id: project.id, title: project.title, phases };
  }
}

module.exports = ProjectsApi;
