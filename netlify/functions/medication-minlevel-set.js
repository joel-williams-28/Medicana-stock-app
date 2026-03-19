// netlify/functions/medication-minlevel-set.js
// Updates the minimum level (in boxes) for a medication
// Supports optional locationId for per-location min levels
const db = require('./_db');
const { logActivity } = require('./_activity-log');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return db.methodNotAllowed();

  try {
    const { medicationId, locationId, minLevel, userId, medicationName, oldMinLevel, locationName } = JSON.parse(event.body || '{}');

    if (!medicationId) {
      return db.fail(400, 'Missing required field: medicationId');
    }

    const minBoxes = Number.isFinite(Number(minLevel)) ? Math.floor(Number(minLevel)) : 0;

    if (locationId) {
      // Per-location min level: upsert into location_min_levels
      await db.query(
        `INSERT INTO location_min_levels (medication_id, location_id, min_level_boxes, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (medication_id, location_id)
         DO UPDATE SET min_level_boxes = $3, updated_by = $4, updated_at = NOW()`,
        [medicationId, locationId, minBoxes, userId || null]
      );
    } else {
      // Global fallback: update medications table (existing behaviour)
      const result = await db.query(
        'UPDATE medications SET min_level_boxes = $1 WHERE id = $2 RETURNING id',
        [minBoxes, medicationId]
      );

      if (result.rowCount === 0) {
        return db.fail(404, 'Medication not found');
      }
    }

    await logActivity({
      userId: userId || null,
      actionType: 'min_level_changed',
      entityType: 'medication',
      entityId: medicationId,
      details: {
        medicationName: medicationName || null,
        oldMinLevel: oldMinLevel != null ? oldMinLevel : null,
        newMinLevel: minBoxes,
        locationId: locationId || null,
        locationName: locationName || null
      }
    });

    return db.ok();
  } catch (e) {
    return db.serverError('medication-minlevel-set', e);
  }
};
