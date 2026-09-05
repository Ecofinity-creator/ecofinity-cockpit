class DealsRepo {
  constructor(pool) {
    this.pool = pool;
  }

  async upsertDeal({ dealId, customer, title, dealClosedAt }) {
    await this.pool.query(
      `INSERT INTO deals (deal_id, customer, title, deal_closed_at, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (deal_id) DO UPDATE SET
         customer = EXCLUDED.customer,
         title = EXCLUDED.title,
         deal_closed_at = EXCLUDED.deal_closed_at,
         updated_at = now()`,
      [dealId, customer, title, dealClosedAt]
    );
  }
}

module.exports = DealsRepo;
