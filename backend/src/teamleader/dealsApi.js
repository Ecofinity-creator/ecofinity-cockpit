/**
 * Deals-endpoints. Een "gewonnen deal" is in Teamleader een deal waarvan de fase
 * tot de pipeline-fase "won" (status) behoort. We filteren op status i.p.v. op een
 * specifieke deal-fase-titel, omdat die per pipeline anders genoemd kan zijn.
 */
class DealsApi {
  constructor(client) {
    this.client = client;
  }

  /** Alle gewonnen deals, optioneel enkel de sinds de vorige sync gewijzigde (incrementele sync). */
  async listWonDeals({ updatedSince } = {}) {
    const filter = { status: ['won'] }; // status-filter MOET een array zijn, bevestigd in de API-referentie
    if (updatedSince) filter.updated_since = updatedSince;

    // sideload het gekoppelde project (indien Teamleader dit als relatie op de deal blootstelt)
    // en de customer, zodat we niet voor elke deal een extra call moeten doen.
    // Sorteren kan bij deals enkel op 'created_at' of 'weighted_value' — 'closed_at' bestaat niet
    // als sorteerveld (al gebruiken we closed_at wel als besteldatum-veld op de deal zelf).
    return this.client.listAll('deals', {
      filter,
      sort: [{ field: 'created_at', order: 'desc' }],
      include: 'lead.customer',
    });
  }

  async getDeal(id) {
    const res = await this.client.call('deals.info', { id });
    return res.data;
  }
}

module.exports = DealsApi;
