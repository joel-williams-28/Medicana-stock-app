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

    // Update min_level_boxes column (ensure this column exists in your database)
    // If the column doesn't exist, you'll need to run: ALTER TABLE medications ADD COLUMN min_level_boxes INTEGER DEFAULT 0;
    const result = await db.query(
      'UPDATE medications SET min_level_boxes = $1 WHERE id = $2 RETURNING id',
      [minBoxes, medicationId]
    );
    
    if (result.rowCount === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ 
          success: false, 
          message: 'Medication not found' 
        })
      };
    }
    
    console.log('medication-minlevel-set: Updated min_level_boxes to', minBoxes, 'for medication', medicationId);

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

