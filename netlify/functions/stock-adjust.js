// netlify/functions/stock-adjust.js
// Adjusts stock level (stock in, stock out, removal, transfer, etc.)
// Security: medication_id is derived from batch_id on the server, not trusted from client
const db = require('./_db');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      body: JSON.stringify({ success: false, message: 'Method not allowed' }) 
    };
  }

  try {
    const { userId, locationId, batchId, delta, reason } = JSON.parse(event.body || '{}');

    // Validate required fields (medicationId is no longer required from client)
    if (!userId || !locationId || !batchId || delta === undefined || delta === null) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false, 
          message: 'Missing required fields: userId, locationId, batchId, delta' 
        })
      };
    }

    // Begin transaction
    await db.query('BEGIN');

    try {
      // Security: Derive medication_id from batch_id (do not trust client-provided medicationId)
      const batchQuery = await db.query(
        'SELECT medication_id FROM batches WHERE id = $1',
        [batchId]
      );

      if (batchQuery.rows.length === 0) {
        await db.query('ROLLBACK');
        return {
          statusCode: 400,
          body: JSON.stringify({ 
            success: false, 
            message: 'Batch not found' 
          })
        };
      }

      const medicationId = batchQuery.rows[0].medication_id;

      // Ensure inventory row exists
      const checkInv = await db.query(
        'SELECT on_hand FROM inventory WHERE location_id = $1 AND batch_id = $2',
        [locationId, batchId]
      );

      if (checkInv.rows.length === 0) {
        // Insert new inventory row
        await db.query(
          'INSERT INTO inventory (location_id, batch_id, on_hand) VALUES ($1, $2, $3)',
          [locationId, batchId, delta]
        );
      } else {
        // Update existing inventory
        const newQuantity = checkInv.rows[0].on_hand + delta;
        
        // Prevent negative stock
        if (newQuantity < 0) {
          await db.query('ROLLBACK');
          return {
            statusCode: 400,
            body: JSON.stringify({ 
              success: false, 
              message: 'Insufficient stock. Cannot reduce below zero.' 
            })
          };
        }

        await db.query(
          'UPDATE inventory SET on_hand = on_hand + $1 WHERE location_id = $2 AND batch_id = $3',
          [delta, locationId, batchId]
        );
      }

      // Insert transaction record (using server-derived medication_id)
      await db.query(
        `INSERT INTO transactions 
         (user_id, medication_id, location_id, batch_id, delta, reason, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [userId, medicationId, locationId, batchId, delta, reason || '']
      );

      // Commit transaction
      await db.query('COMMIT');

      return {
        statusCode: 200,
        body: JSON.stringify({ success: true })
      };
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }
  } catch (e) {
    console.error('stock-adjust error:', e);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: 'Server error.' })
    };
  }
};
