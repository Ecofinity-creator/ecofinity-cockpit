const { phaseByCode } = require('../phases/phaseModel');

function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

function daysInPhase(p, now = new Date()) {
  if (!p.phaseEnteredDate) return null;
  return daysBetween(new Date(p.phaseEnteredDate), now);
}

function daysSinceOrder(p, now = new Date()) {
  return daysBetween(new Date(p.dealClosedAt), now);
}

/** Sectie 9: deadline-alerts t.o.v. de configureerbare drempel. */
function deadlineStatus(p, thresholdDays, now = new Date()) {
  const dl = p.deadlines && p.deadlines[p.currentPhaseCode];
  if (!dl) return null;
  const diff = daysBetween(now, new Date(dl));
  if (diff > thresholdDays) return { cls: 'ok', text: 'Normaal', diff };
  if (diff > 0) return { cls: 'warn', text: `Aandacht — nog ${diff} d.`, diff };
  if (diff === 0) return { cls: 'due', text: 'Dringend — vandaag', diff };
  return { cls: 'late', text: `Te laat — ${Math.abs(diff)} d. overschreden`, diff };
}

function hasIssue(p) {
  return !!(p.hold || p.dataIssue || p.unknownPhaseLabel || p.missingProject || (p.currentPhaseCode === '05' && !p.installation));
}

function phaseLabelOf(p) {
  if (p.missingProject) return 'Geen Teamleader-project gekoppeld';
  if (p.unknownPhaseLabel) return p.unknownPhaseLabel;
  const ph = phaseByCode(p.currentPhaseCode);
  return ph ? ph.label : '—';
}

module.exports = { daysBetween, daysInPhase, daysSinceOrder, deadlineStatus, hasIssue, phaseLabelOf };
