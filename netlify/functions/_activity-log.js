// netlify/functions/_activity-log.js
// Shared helper for writing to the activity_log table.
// Import this in any Netlify function that needs to record an audit event.
const db = require('./_db');

async function logActivity({ userId, actionType, entityType, entityId, locationId, details }) {
  try {
    await db.query(
      `INSERT INTO activity_log (user_id, action_type, entity_type, entity_id, location_id, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userId || null,
        actionType,
        entityType || null,
        entityId != null ? String(entityId) : null,
        locationId || null,
        JSON.stringify(details || {})
      ]
    );
  } catch (err) {
    // Activity logging should never break the main operation
    console.error('Activity log write failed:', err.message);
  }
}

module.exports = { logActivity };
