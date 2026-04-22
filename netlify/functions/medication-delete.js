// netlify/functions/medication-delete.js
// Hard-deletes a medication after verifying:
//   1. The requesting user exists and is active
//   2. The user's role is Administrator or Pharmacist (case-insensitive)
//   3. The submitted password matches the user's bcrypt hash
// Returns 409 HAS_DEPENDENCIES if FK constraints block the delete so the
// frontend can fall back to the soft-delete (medication-set-active) flow.
const db = require('./_db');
const bcrypt = require('bcryptjs');
const { logActivity } = require('./_activity-log');

const ALLOWED_ROLES = ['administrator', 'pharmacist'];

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return db.methodNotAllowed();

  try {
    const tdb = db.forTenant(event);
    if (!tdb) return db.tenantNotFound();

    const { medicationId, userId, password, medicationName } = JSON.parse(event.body || '{}');

    if (!medicationId) return db.fail(400, 'Missing required field: medicationId');
    if (!userId) return db.fail(400, 'Missing required field: userId');
    if (!password) return db.fail(400, 'Password confirmation is required.');

    const userResult = await tdb.query(
      'SELECT id, username, password_hash, role, active FROM users WHERE id = $1',
      [userId]
    );
    if (userResult.rows.length === 0) return db.fail(401, 'User not found.');

    const user = userResult.rows[0];
    if (!user.active) return db.fail(401, 'Account is inactive.');

    const roleKey = String(user.role || '').trim().toLowerCase();
    if (!ALLOWED_ROLES.includes(roleKey)) {
      return db.fail(403, 'You do not have permission to delete medications.');
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) return db.fail(401, 'Incorrect password.');

    const medResult = await tdb.query(
      'SELECT id, name FROM medications WHERE id = $1',
      [medicationId]
    );
    if (medResult.rows.length === 0) return db.fail(404, 'Medication not found.');
    const resolvedName = medResult.rows[0].name;

    try {
      await tdb.query('DELETE FROM medications WHERE id = $1', [medicationId]);
    } catch (err) {
      // 23503 = foreign_key_violation (batches/orders/transactions/draft_orders reference this row)
      if (err.code === '23503') {
        return db.fail(409, 'Medication has batches, orders, or transactions and cannot be hard-deleted.', {
          code: 'HAS_DEPENDENCIES'
        });
      }
      throw err;
    }

    await logActivity({
      userId: user.id,
      actionType: 'medication_hard_deleted',
      entityType: 'medication',
      entityId: medicationId,
      details: {
        medicationName: medicationName || resolvedName,
        deletedBy: user.username,
        role: user.role
      },
      queryFn: tdb.query
    });

    return db.ok({ medicationId });
  } catch (e) {
    return db.serverError('medication-delete', e);
  }
};
