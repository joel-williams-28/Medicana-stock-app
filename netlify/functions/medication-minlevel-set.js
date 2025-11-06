// netlify/functions/medication-minlevel-set.js
// Updates the minimum level (in boxes) for a medication
const db = require('./_db');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      body: JSON.stringify({ success: false, message: 'Method not allowed' }) 
    };
  }

  try {
    const { medicationId, minLevel } = JSON.parse(event.body || '{}');

    if (!medicationId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false, 
          message: 'Missing required field: medicationId' 
        })
      };
    }

    // Convert minLevel to integer boxes
    const minBoxes = Number.isFinite(Number(minLevel)) ? Math.floor(Number(minLevel)) : 0;

    // Try min_level_boxes first, fall back to min_level if column doesn't exist yet
    try {
      await db.query('UPDATE medications SET min_level_boxes = $1 WHERE id = $2', [minBoxes, medicationId]);
      console.log('medication-minlevel-set: Updated min_level_boxes to', minBoxes, 'for medication', medicationId);
    } catch (dbError) {
      // If min_level_boxes column doesn't exist, try with min_level (for backward compatibility during migration)
      if (dbError.message && dbError.message.includes('min_level_boxes')) {
        console.warn('medication-minlevel-set: min_level_boxes column not found, trying min_level instead');
        await db.query('UPDATE medications SET min_level = $1 WHERE id = $2', [minBoxes, medicationId]);
        console.log('medication-minlevel-set: Updated min_level (fallback) to', minBoxes, 'for medication', medicationId);
      } else {
        throw dbError;
      }
    }

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

