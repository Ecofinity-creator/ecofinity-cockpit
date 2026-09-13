/**
 * Deals-endpoints. Een "gewonnen deal" is in Teamleader een deal waarvan de fase
 * tot de pipeline-fase "won" (status) behoort. We filteren op status i.p.v. op een
 * specifieke deal-fase-titel, omdat die per pipeline anders genoemd kan zijn.
 */
/**
 * Een sideloaded relatie (bv. deal.lead.customer) verwijst naar { type, id }; de effectieve
 * naam zit in de `included`-sectie van de respons, geïndexeerd per objecttype. We houden hier
 * rekening met twee mogelijke vormen (een vlakke lijst, of een object per type — de exacte vorm
 * bleek niet overal identiek gedocumenteerd) zodat dit hoe dan ook robuust blijft.
 */
function resolveCustomerName(deal, included) {
  const ref = deal.lead && deal.lead.customer;
  if (!ref) return deal.title;

  let candidates = [];
  if (Array.isArray(included)) {
    candidates = included;
  } else if (included && typeof included === 'object') {
    candidates = Object.entries(included).flatMap(([type, arr]) => (arr || []).map((item) => ({ ...item, type: item.type || type })));
  }

  const match = candidates.find((item) => item.id === ref.id);
  if (!match) return deal.title;

  return (
    match.name ||
    match.company_name ||
    [match.first_name, match.last_name].filter(Boolean).join(' ').trim() ||
    deal.title
  );
}

class DealsApi {
  constructor(client) {
    this.client = client;
  }

  /** Alle gewonnen deals. Filteren op "sinds wanneer gewijzigd" gebeurt bewust NIET hier via
   * een server-side filter — Teamleader's API negeert onbekende filtersleutels stilzwijgend en
   * geeft dan de volledige, ongefilterde set terug (bevestigd gedrag), en 'updated_since' bleek
   * geen erkende filter voor deals.list te zijn. De incrementele filtering gebeurt daarom
   * client-side in syncEngine.js, op basis van het 'updated_at'-veld dat elke deal meekrijgt.
   */
  async listWonDeals() {
    const filter = { status: ['won'] }; // status-filter MOET een array zijn, bevestigd in de API-referentie

    // Sorteren kan bij deals enkel op 'created_at' of 'weighted_value' — 'closed_at' bestaat niet
    // als sorteerveld (al gebruiken we closed_at wel als besteldatum-veld op de deal zelf).
    return this.client.listAll('deals', {
      filter,
      sort: [{ field: 'created_at', order: 'desc' }],
    });
  }

  async getDeal(id) {
    const res = await this.client.call('deals.info', { id, include: 'lead.customer' });
    const deal = res.data;
    return { ...deal, _resolvedCustomerName: resolveCustomerName(deal, res.included) };
  }
}

module.exports = DealsApi;
