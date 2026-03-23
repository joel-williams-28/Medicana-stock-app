// netlify/functions/intelligence-config.js
// GET/POST for intelligence configuration (primarily go-live date)
const db = require('./_db');
const { logActivity } = require('./_activity-log');

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      // Return all config values
      let config = {};
      try {
        const result = await db.query('SELECT key, value FROM intelligence_config');
        for (const row of result.rows) {
          config[row.key] = row.value;
        }
      } catch (e) {
        // Table may not exist yet
        config = { go_live_date: '' };
      }
      return db.ok({ config });
    }

    if (event.httpMethod === 'POST') {
      const { key, value, userId } = JSON.parse(event.body || '{}');

      if (!key) {
        return db.fail(400, 'Missing required field: key');
      }

      // Only allow known config keys
      const allowedKeys = ['go_live_date', 'last_pipeline_run', 'pipeline_lock_until'];
      if (!allowedKeys.includes(key)) {
        return db.fail(400, `Unknown config key: ${key}`);
      }

      // Fetch current value for audit trail
      let oldValue = null;
      try {
        const current = await db.query('SELECT value FROM intelligence_config WHERE key = $1', [key]);
        if (current.rows.length > 0) oldValue = current.rows[0].value;
      } catch (_) { /* table may not exist yet */ }

      await db.query(
        `INSERT INTO intelligence_config (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key)
         DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, value || '']
      );

      await logActivity({
        userId: userId || null,
        actionType: 'config_changed',
        entityType: 'config',
        entityId: key,
        details: { key, oldValue, newValue: value || '' }
      });

      return db.ok({ key, value });
    }

    return db.methodNotAllowed();
  } catch (e) {
    return db.serverError('intelligence-config', e);
  }
};
