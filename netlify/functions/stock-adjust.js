// netlify/functions/stock-adjust.js
// Adjusts stock level (stock in, stock out, removal, transfer, etc.)
// Security: medication_id is derived from batch_id on the server, not trusted from client
const db = require('./_db');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return db.methodNotAllowed();

  try {
    const { userId, locationId, batchId, delta, reason } = JSON.parse(event.body || '{}');

    if (!userId || !locationId || !batchId || delta === undefined || delta === null) {
      return db.fail(400, 'Missing required fields: userId, locationId, batchId, delta');
    }

    await db.query('BEGIN');

    try {
      // Security: Derive medication_id from batch_id (do not trust client-provided medicationId)
      const batchQuery = await db.query(
        'SELECT medication_id FROM batches WHERE id = $1',
        [batchId]
      );

      if (batchQuery.rows.length === 0) {
        await db.query('ROLLBACK');
        return db.fail(400, 'Batch not found');
      }

      const medicationId = batchQuery.rows[0].medication_id;

      // Ensure inventory row exists
      const checkInv = await db.query(
        'SELECT on_hand FROM inventory WHERE location_id = $1 AND batch_id = $2',
        [locationId, batchId]
      );

      if (checkInv.rows.length === 0) {
        await db.query(
          'INSERT INTO inventory (location_id, batch_id, on_hand) VALUES ($1, $2, $3)',
          [locationId, batchId, delta]
        );
      } else {
        if (checkInv.rows[0].on_hand + delta < 0) {
          await db.query('ROLLBACK');
          return db.fail(400, 'Insufficient stock. Cannot reduce below zero.');
        }

        await db.query(
          'UPDATE inventory SET on_hand = on_hand + $1 WHERE location_id = $2 AND batch_id = $3',
          [delta, locationId, batchId]
        );
      }

      // Insert transaction record
      const transactionType = delta > 0 ? 'in' : 'out';
      await db.query(
        `INSERT INTO transactions
         (batch_id, location_id, medication_id, user_id, delta, type, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [batchId, locationId, medicationId, userId, delta, transactionType, reason || '']
      );

      await db.query('COMMIT');
      return db.ok();
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }
  } catch (e) {
    return db.serverError('stock-adjust', e);
  }
};
