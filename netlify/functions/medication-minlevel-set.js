// netlify/functions/medication-minlevel-set.js
// Updates the minimum level (in boxes) for a medication at a specific location
const db = require('./_db');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ success: false, message: 'Method not allowed' })
    };
  }

  try {
    const { medicationId, locationId, minLevel } = JSON.parse(event.body || '{}');

    if (!medicationId || !locationId) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          message: 'Missing required fields: medicationId and locationId'
        })
      };
    }

    // Convert minLevel to integer boxes
    const minBoxes = Number.isFinite(Number(minLevel)) ? Math.floor(Number(minLevel)) : 0;

    // Insert or update the per-location minimum level
    const result = await db.query(
      `INSERT INTO location_min_levels (location_id, medication_id, min_level_boxes)
       VALUES ($1, $2, $3)
       ON CONFLICT (location_id, medication_id)
       DO UPDATE SET min_level_boxes = $3
       RETURNING location_id, medication_id`,
      [locationId, medicationId, minBoxes]
    );

    if (result.rowCount === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          success: false,
          message: 'Failed to update minimum level'
        })
      };
    }

    console.log('medication-minlevel-set: Updated min_level_boxes to', minBoxes, 'for medication', medicationId, 'at location', locationId);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    };
  } catch (e) {
    console.error('medication-minlevel-set error:', e);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: 'Server error.' })
    };
  }
};

