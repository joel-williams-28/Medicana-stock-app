// netlify/functions/medication-set-active.js
// Sets the is_active status of a medication (for soft-delete)
const db = require('./_db');
const { logActivity } = require('./_activity-log');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return db.methodNotAllowed();

  try {
    const tdb = db.forTenant(event);
    if (!tdb) return db.tenantNotFound();

    const { medicationId, isActive, userId, medicationName } = JSON.parse(event.body || '{}');

    if (!medicationId) {
      return db.fail(400, 'Missing required field: medicationId');
    }

    if (typeof isActive !== 'boolean') {
      return db.fail(400, 'Missing or invalid field: isActive (must be boolean)');
    }

    await tdb.query('UPDATE medications SET is_active = $1 WHERE id = $2', [isActive, medicationId]);

    await logActivity({
      userId: userId || null,
      actionType: isActive ? 'medication_restored' : 'medication_deleted',
      entityType: 'medication',
      entityId: medicationId,
      details: {
        medicationName: medicationName || null,
        isActive
      },
      queryFn: tdb.query
    });

    return db.ok();
  } catch (e) {
    return db.serverError('medication-set-active', e);
  }
};
