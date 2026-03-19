// netlify/functions/medication-minlevel-set.js
// Updates the minimum level (in boxes) for a medication
const db = require('./_db');
const { logActivity } = require('./_activity-log');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return db.methodNotAllowed();

  try {
    const { medicationId, minLevel, userId, medicationName, oldMinLevel } = JSON.parse(event.body || '{}');

    if (!medicationId) {
      return db.fail(400, 'Missing required field: medicationId');
    }

    const minBoxes = Number.isFinite(Number(minLevel)) ? Math.floor(Number(minLevel)) : 0;

    const result = await db.query(
      'UPDATE medications SET min_level_boxes = $1 WHERE id = $2 RETURNING id',
      [minBoxes, medicationId]
    );

    if (result.rowCount === 0) {
      return db.fail(404, 'Medication not found');
    }

    await logActivity({
      userId: userId || null,
      actionType: 'min_level_changed',
      entityType: 'medication',
      entityId: medicationId,
      details: {
        medicationName: medicationName || null,
        oldMinLevel: oldMinLevel != null ? oldMinLevel : null,
        newMinLevel: minBoxes
      }
    });

    return db.ok();
  } catch (e) {
    return db.serverError('medication-minlevel-set', e);
  }
};
