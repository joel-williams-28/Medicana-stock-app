// netlify/functions/activity-log.js
// GET: Retrieve activity log entries with filtering and cursor-based pagination
// POST: Create a new activity log entry (for frontend-initiated events)
const db = require('./_db');
const { logActivity } = require('./_activity-log');

exports.handler = async (event) => {
  if (event.httpMethod === 'GET') {
    return handleGet(event);
  }
  if (event.httpMethod === 'POST') {
    return handlePost(event);
  }
  return db.methodNotAllowed();
};

async function handleGet(event) {
  try {
    const params = event.queryStringParameters || {};
    const limit = Math.min(parseInt(params.limit) || 50, 200);
    const beforeId = parseInt(params.before_id) || null;
    const userId = parseInt(params.user_id) || null;
    const from = params.from || null;
    const to = params.to || null;
    const actionTypes = params.action_type ? params.action_type.split(',').filter(Boolean) : null;

    const conditions = [];
    const values = [];
    let idx = 1;

    if (actionTypes && actionTypes.length > 0) {
      conditions.push(`al.action_type = ANY($${idx})`);
      values.push(actionTypes);
      idx++;
    }
    if (userId) {
      conditions.push(`al.user_id = $${idx}`);
      values.push(userId);
      idx++;
    }
    if (from) {
      conditions.push(`al.occurred_at >= $${idx}`);
      values.push(from);
      idx++;
    }
    if (to) {
      conditions.push(`al.occurred_at <= $${idx}`);
      values.push(to);
      idx++;
    }
    if (beforeId) {
      conditions.push(`al.id < $${idx}`);
      values.push(beforeId);
      idx++;
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    // Fetch limit + 1 to determine if there are more entries
    values.push(limit + 1);

    const result = await db.query(`
      SELECT
        al.id,
        al.action_type,
        al.entity_type,
        al.entity_id,
        al.location_id,
        l.display_name AS location_name,
        al.details,
        al.occurred_at,
        al.user_id,
        u.username,
        u.full_name AS user_full_name
      FROM activity_log al
      LEFT JOIN users u ON u.id = al.user_id
      LEFT JOIN locations l ON l.id = al.location_id
      ${whereClause}
      ORDER BY al.id DESC
      LIMIT $${idx}
    `, values);

    const hasMore = result.rows.length > limit;
    const entries = result.rows.slice(0, limit).map(row => ({
      id: row.id,
      actionType: row.action_type,
      entityType: row.entity_type,
      entityId: row.entity_id,
      locationId: row.location_id,
      locationName: row.location_name || null,
      details: row.details || {},
      occurredAt: row.occurred_at ? row.occurred_at.toISOString() : new Date().toISOString(),
      userId: row.user_id,
      username: row.username || null,
      userFullName: row.user_full_name || null
    }));

    return db.ok({ entries, hasMore });
  } catch (err) {
    return db.serverError('activity-log-get', err);
  }
}

async function handlePost(event) {
  try {
    const body = JSON.parse(event.body || '{}');
    const { userId, actionType, entityType, entityId, locationId, details } = body;

    if (!actionType) {
      return db.fail(400, 'actionType is required');
    }

    await logActivity({ userId, actionType, entityType, entityId, locationId, details });
    return db.ok({ message: 'Activity logged' });
  } catch (err) {
    return db.serverError('activity-log-post', err);
  }
}
