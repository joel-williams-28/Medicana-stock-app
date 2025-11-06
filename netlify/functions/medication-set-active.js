// netlify/functions/medication-set-active.js
// Sets the is_active status of a medication (for soft-delete)
const db = require('./_db');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      body: JSON.stringify({ success: false, message: 'Method not allowed' }) 
    };
  }

  try {
    const { medicationId, isActive } = JSON.parse(event.body || '{}');

    if (!medicationId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false, 
          message: 'Missing required field: medicationId' 
        })
      };
    }

    if (typeof isActive !== 'boolean') {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false, 
          message: 'Missing or invalid field: isActive (must be boolean)' 
        })
      };
    }

    // Update medication is_active status
    const query = `
      UPDATE medications 
      SET is_active = $1
      WHERE id = $2
    `;

    await db.query(query, [isActive, medicationId]);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    };
  } catch (e) {
    console.error('medication-set-active error:', e);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: 'Server error.' })
    };
  }
};

