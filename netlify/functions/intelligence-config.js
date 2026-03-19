// netlify/functions/intelligence-config.js
// GET/POST for intelligence configuration (primarily go-live date)
const db = require('./_db');

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
      return db.json(200, { success: true, config });
    }

    if (event.httpMethod === 'POST') {
      const { key, value } = JSON.parse(event.body || '{}');

      if (!key) {
        return db.fail(400, 'Missing required field: key');
      }

      // Only allow known config keys
      const allowedKeys = ['go_live_date'];
      if (!allowedKeys.includes(key)) {
        return db.fail(400, `Unknown config key: ${key}`);
      }

      await db.query(
        `INSERT INTO intelligence_config (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key)
         DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, value || '']
      );

      return db.ok({ key, value });
    }

    return db.methodNotAllowed();
  } catch (e) {
    return db.serverError('intelligence-config', e);
  }
};
