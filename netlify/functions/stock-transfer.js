// netlify/functions/stock-transfer.js
// Handles transfers of stock between two locations
// Security: medication_id is derived from batch_id on the server, not trusted from client
const db = require('./_db');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return db.methodNotAllowed();

  try {
    const {
      userId,
      batchId,
      sourceLocationId,
      targetLocationId,
      quantity,
      reason
    } = JSON.parse(event.body || '{}');

    if (!userId || !batchId || !sourceLocationId || !targetLocationId || !quantity) {
      return db.fail(400, 'Missing or invalid fields');
    }

    if (typeof quantity !== 'number' || quantity <= 0 || !Number.isInteger(quantity)) {
      return db.fail(400, 'Quantity must be a positive integer');
    }

    await db.query('BEGIN');

    try {
      // Security: Derive medication_id from batch_id
      const batchQuery = await db.query(
        'SELECT medication_id FROM batches WHERE id = $1',
        [batchId]
      );

      if (batchQuery.rows.length === 0) {
        await db.query('ROLLBACK');
        return db.fail(400, 'Batch not found');
      }

      const medicationId = batchQuery.rows[0].medication_id;

      // Get location display names for clean transaction notes
      const locationsQuery = await db.query(
        'SELECT id, display_name FROM locations WHERE id IN ($1, $2)',
        [sourceLocationId, targetLocationId]
      );

      const locationMap = {};
      locationsQuery.rows.forEach(row => { locationMap[row.id] = row.display_name; });

      const sourceLocationName = locationMap[sourceLocationId] || sourceLocationId;
      const targetLocationName = locationMap[targetLocationId] || targetLocationId;

      // Check source has enough stock
      const checkSource = await db.query(
        'SELECT on_hand FROM inventory WHERE location_id = $1 AND batch_id = $2',
        [sourceLocationId, batchId]
      );

      if (checkSource.rows.length === 0) {
        await db.query('ROLLBACK');
        return db.fail(400, 'Source location does not have this batch in inventory');
      }

      if (checkSource.rows[0].on_hand < quantity) {
        await db.query('ROLLBACK');
        return db.fail(400, 'Not enough stock at source');
      }

      // Decrease stock at source
      await db.query(
        'UPDATE inventory SET on_hand = on_hand - $1 WHERE location_id = $2 AND batch_id = $3',
        [quantity, sourceLocationId, batchId]
      );

      // Record outgoing transaction
      await db.query(
        `INSERT INTO transactions
         (batch_id, location_id, medication_id, user_id, delta, type, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [batchId, sourceLocationId, medicationId, userId, -quantity, 'out', `Transfer to ${targetLocationName}`]
      );

      // Ensure target inventory row exists, then increase stock
      await db.query(
        `INSERT INTO inventory (location_id, batch_id, on_hand)
         VALUES ($1, $2, 0)
         ON CONFLICT (location_id, batch_id) DO NOTHING`,
        [targetLocationId, batchId]
      );

      await db.query(
        'UPDATE inventory SET on_hand = on_hand + $1 WHERE location_id = $2 AND batch_id = $3',
        [quantity, targetLocationId, batchId]
      );

      // Record incoming transaction
      await db.query(
        `INSERT INTO transactions
         (batch_id, location_id, medication_id, user_id, delta, type, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [batchId, targetLocationId, medicationId, userId, quantity, 'in', `Transfer from ${sourceLocationName}`]
      );

      await db.query('COMMIT');
      return db.ok();
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }
  } catch (e) {
    return db.serverError('stock-transfer', e);
  }
};
