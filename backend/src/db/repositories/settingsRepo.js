const config = require('../../config');

class SettingsRepo {
  constructor(pool) {
    this.pool = pool;
  }

  async _get(key) {
    const res = await this.pool.query(`SELECT value FROM settings WHERE key = $1`, [key]);
    return res.rows[0] ? res.rows[0].value : null;
  }

  async _set(key, value) {
    await this.pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, JSON.stringify(value)]
    );
  }

  async getOAuthTokens() {
    const v = await this._get('oauth_tokens');
    if (!v) return null;
    return { accessToken: v.accessToken, refreshToken: v.refreshToken, expiresAt: v.expiresAt };
  }

  async saveOAuthTokens({ accessToken, refreshToken, expiresAt }) {
    await this._set('oauth_tokens', { accessToken, refreshToken, expiresAt });
  }

  async getAttentionThresholdDays() {
    const v = await this._get('attention_threshold_days');
    return v == null ? config.defaultAttentionThresholdDays : Number(v);
  }

  async setAttentionThresholdDays(days) {
    await this._set('attention_threshold_days', days);
  }

  async getPhaseAliases() {
    const res = await this.pool.query(`SELECT alias, code FROM phase_aliases`);
    return res.rows;
  }

  async addPhaseAlias(alias, code) {
    await this.pool.query(
      `INSERT INTO phase_aliases (alias, code) VALUES ($1, $2)
       ON CONFLICT (alias) DO UPDATE SET code = EXCLUDED.code`,
      [alias, code]
    );
  }

  async getLastSyncTimestamp() {
    return this._get('last_sync_at');
  }

  async setLastSyncTimestamp(iso) {
    await this._set('last_sync_at', iso);
  }

  async logSyncIssue(dealId, message) {
    await this.pool.query(`INSERT INTO sync_issues (deal_id, message) VALUES ($1, $2)`, [dealId, message]);
  }
}

module.exports = SettingsRepo;
