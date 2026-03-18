// netlify/functions/medication-set-active.js
// Sets the is_active status of a medication (for soft-delete)
const db = require('./_db');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return db.methodNotAllowed();

  try {
    const { medicationId, isActive } = JSON.parse(event.body || '{}');

    if (!medicationId) {
      return db.fail(400, 'Missing required field: medicationId');
    }

    if (typeof isActive !== 'boolean') {
      return db.fail(400, 'Missing or invalid field: isActive (must be boolean)');
    }

    await db.query('UPDATE medications SET is_active = $1 WHERE id = $2', [isActive, medicationId]);

    return db.ok();
  } catch (e) {
    return db.serverError('medication-set-active', e);
  }
};
