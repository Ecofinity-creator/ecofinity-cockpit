const express = require('express');
const { PHASES } = require('../phases/phaseModel');
const { daysInPhase, daysSinceOrder, deadlineStatus, hasIssue, phaseLabelOf } = require('./viewHelpers');

function buildCockpitRouter(dataProvider) {
  const router = express.Router();

  // Eén samengestelde payload — dekt dashboard, bestelwachtrij, planningswachtrij en kanban
  // in één call, zodat de frontend niet 4 losse round-trips hoeft te doen bij het opstarten.
  router.get('/cockpit-data', async (req, res, next) => {
    try {
      const [projects, durationStats, threshold, aliases] = await Promise.all([
        dataProvider.listProjects(),
        dataProvider.getDurationStats(),
        dataProvider.getAttentionThresholdDays(),
        dataProvider.getPhaseAliases(),
      ]);

      const now = dataProvider.getReferenceDate ? dataProvider.getReferenceDate() : new Date();
      const enriched = projects.map((p) => ({
        ...p,
        daysInPhase: daysInPhase(p, now),
        daysSinceOrder: daysSinceOrder(p, now),
        deadlineStatus: deadlineStatus(p, threshold, now),
        hasIssue: hasIssue(p),
        phaseLabel: phaseLabelOf(p),
      }));

      res.json({
        phases: PHASES,
        projects: enriched,
        durationStats,
        config: { attentionThresholdDays: threshold },
        phaseAliases: aliases,
        generatedAt: now.toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/projects/:dealId', async (req, res, next) => {
    try {
      const p = await dataProvider.getProject(req.params.dealId);
      if (!p) return res.status(404).json({ error: 'Deal/project niet gevonden' });

      const threshold = await dataProvider.getAttentionThresholdDays();
      const now = dataProvider.getReferenceDate ? dataProvider.getReferenceDate() : new Date();
      res.json({
        ...p,
        daysInPhase: daysInPhase(p, now),
        daysSinceOrder: daysSinceOrder(p, now),
        deadlineStatus: deadlineStatus(p, threshold, now),
        hasIssue: hasIssue(p),
        phaseLabel: phaseLabelOf(p),
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/settings/phase-mapping', async (req, res, next) => {
    try {
      const aliases = await dataProvider.getPhaseAliases();
      res.json({ phases: PHASES, aliases });
    } catch (err) {
      next(err);
    }
  });

  router.post('/settings/phase-mapping', async (req, res, next) => {
    try {
      const { alias, code } = req.body;
      if (!alias || !PHASES.some((p) => p.code === code)) {
        return res.status(400).json({ error: 'Ongeldige alias of fasecode' });
      }
      await dataProvider.addPhaseAlias(alias, code);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.get('/settings/deadline-threshold', async (req, res, next) => {
    try {
      res.json({ attentionThresholdDays: await dataProvider.getAttentionThresholdDays() });
    } catch (err) {
      next(err);
    }
  });

  router.put('/settings/deadline-threshold', async (req, res, next) => {
    try {
      const days = parseInt(req.body.attentionThresholdDays, 10);
      if (!(days > 0 && days <= 30)) return res.status(400).json({ error: 'Waarde moet tussen 1 en 30 liggen' });
      await dataProvider.setAttentionThresholdDays(days);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = buildCockpitRouter;
