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

  /** Alle gewonnen deals, optioneel enkel de sinds de vorige sync gewijzigde (incrementele sync). */
  async listWonDeals({ updatedSince } = {}) {
    const filter = { status: ['won'] }; // status-filter MOET een array zijn, bevestigd in de API-referentie
    if (updatedSince) filter.updated_since = updatedSince;

    // Sorteren kan bij deals enkel op 'created_at' of 'weighted_value' — 'closed_at' bestaat niet
    // als sorteerveld (al gebruiken we closed_at wel als besteldatum-veld op de deal zelf).
    // Sideloading is hier niet nodig (enkel de ID's worden gebruikt om de wachtrij te vullen);
    // de klantnaam wordt per deal opgehaald via getDeal().
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
