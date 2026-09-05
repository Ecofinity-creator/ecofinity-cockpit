/**
 * De 7 vaste Ecofinity-projectfasen, rechtstreeks overgenomen uit Teamleader.
 * Volgorde is betekenisvol: dit IS de lifecycle (sectie 2 van de spec).
 *
 * BELANGRIJK: dit bestand introduceert nooit een alternatieve fasenstructuur.
 * Het enige wat hier gebeurt is: (1) Teamleader-fasenamen tolerant herkennen,
 * en (2) op basis daarvan de huidige fase van een project afleiden.
 */
const PHASES = [
  { code: '01', label: 'Bij bestelling' },
  { code: '02', label: 'Materiaal bestellen' },
  { code: '03', label: 'Materialen in afwachting van levering' },
  { code: '04', label: 'Uitvoering in te plannen' },
  { code: '05', label: 'Uitvoering ingepland' },
  { code: '06', label: 'Uitvoering afgewerkt' },
  { code: '07', label: 'Administratie afgewerkt' },
];

function phaseByCode(code) {
  return PHASES.find((p) => p.code === code) || null;
}

function phaseIndex(code) {
  return PHASES.findIndex((p) => p.code === code);
}

/** Normaliseert een Teamleader-fasenaam voor tolerante matching (hoofdletters/spaties). */
function normalizeLabel(label) {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Zoekt de interne fasecode die hoort bij een ruwe Teamleader-fasenaam (milestone/projectGroup titel).
 * Gebruikt eerst de default 1-op-1 mapping, en nadien eventuele aliassen die in de settings
 * geconfigureerd zijn (sectie 5: "Voorzie in Settings een configuratiepagina").
 *
 * @param {string} rawLabel - de exacte titel zoals ze in Teamleader staat
 * @param {Array<{alias:string, code:string}>} configuredAliases - uit phaseMappingStore
 * @returns {string|null} interne fasecode ('01'..'07'), of null als onbekend
 */
function resolvePhaseCode(rawLabel, configuredAliases = []) {
  const normalized = normalizeLabel(rawLabel);

  const exact = PHASES.find((p) => normalizeLabel(p.label) === normalized);
  if (exact) return exact.code;

  const aliasHit = configuredAliases.find((a) => normalizeLabel(a.alias) === normalized);
  if (aliasHit) return aliasHit.code;

  return null; // onbekende fase — NIET negeren, apart flaggen (sectie 5)
}

/**
 * deriveCurrentProjectPhase — de centrale functie uit sectie 4 van de spec.
 *
 * Input: een genormaliseerd project-record met:
 *   - phaseHistory: { '01': {done:bool, completedAt:Date|null}, ... '07': {...} }
 *   - teamleaderActivePhaseCode: de fasecode die Teamleader zélf als actief/lopend markeert
 *     (bv. het open/actieve project-group of milestone), of null als dat niet af te leiden is.
 *   - hasUnknownPhase: {label} als Teamleader een fase gebruikt die niet herkend/gealiast is.
 *   - hasLinkedProject: bool
 *
 * Output: { currentPhaseCode, closed, inconsistent, dataIssue }
 *
 * Regels (spec sectie 4):
 *  1. Doorloop de 7 fasen in vaste volgorde.
 *  2. Volledig afgewerkte fasen = voltooid.
 *  3. De eerste niet-voltooide fase is normaal de actuele fase.
 *  4. Als Teamleader expliciet een latere fase actief meldt, gebruik die.
 *  5. Bij inconsistenties: NIET stilzwijgend corrigeren — flaggen.
 */
function deriveCurrentProjectPhase(input) {
  if (!input.hasLinkedProject) {
    return { currentPhaseCode: null, closed: false, inconsistent: false, dataIssue: null, unknown: false };
  }
  if (input.hasUnknownPhase) {
    return {
      currentPhaseCode: null,
      closed: false,
      inconsistent: false,
      dataIssue: null,
      unknown: true,
      unknownLabel: input.hasUnknownPhase.label,
    };
  }

  const history = input.phaseHistory || {};
  const seqIdx = PHASES.findIndex((ph) => !(history[ph.code] && history[ph.code].done));

  if (seqIdx === -1) {
    // Regel 2: alles voltooid -> project volledig afgewerkt, verdwijnt uit actieve wachtrij
    return { currentPhaseCode: '07', closed: true, inconsistent: false, dataIssue: null, unknown: false };
  }

  const seqCode = PHASES[seqIdx].code; // Regel 3
  const explicit = input.teamleaderActivePhaseCode;

  if (explicit && explicit !== seqCode) {
    const explicitIdx = phaseIndex(explicit);
    if (explicitIdx > seqIdx) {
      // Regel 4 + Regel 5: latere fase actief, eerdere fase niet afgevinkt -> inconsistentie
      return {
        currentPhaseCode: explicit,
        closed: false,
        inconsistent: true,
        dataIssue:
          `${phaseByCode(seqCode).label} staat niet als afgerond in Teamleader, ` +
          `terwijl ${phaseByCode(explicit).label} al actief staat.`,
        unknown: false,
      };
    }
    // expliciete fase ligt vóór de sequentiële -> vertrouw de sequentie (data-achterstand in Teamleader-veld)
  }

  return { currentPhaseCode: seqCode, closed: false, inconsistent: false, dataIssue: null, unknown: false };
}

module.exports = { PHASES, phaseByCode, phaseIndex, normalizeLabel, resolvePhaseCode, deriveCurrentProjectPhase };
