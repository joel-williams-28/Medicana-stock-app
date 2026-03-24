// netlify/functions/stock-adjust.js
// Adjusts stock level (stock in, stock out, removal, transfer, etc.)
// Security: medication_id is derived from batch_id on the server, not trusted from client
const db = require('./_db');
const { logActivity } = require('./_activity-log');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return db.methodNotAllowed();

  try {
    const tdb = db.forTenant(event);
    if (!tdb) return db.tenantNotFound();

    const body = db.parseBody(event);
    console.log('[stock-adjust] body:', JSON.stringify(body));

    // IDs: accept as-is (string or number) — let PostgreSQL handle type coercion
    const userId = body.userId;
    const locationId = body.locationId;
    const batchId = body.batchId;
    const delta = (body.delta !== undefined && body.delta !== null) ? Number(body.delta) : undefined;
    const reason = body.reason;
    const medicationName = body.medicationName;
    const batchCode = body.batchCode;

    const missing = [];
    if (!userId && userId !== 0) missing.push('userId');
    if (!locationId && locationId !== 0) missing.push('locationId');
    if (!batchId && batchId !== 0) missing.push('batchId');
    if (delta === undefined || isNaN(delta)) missing.push('delta');

    if (missing.length > 0) {
      console.log('[stock-adjust] Validation failed. Missing:', missing, 'Raw body:', body);
      return db.fail(400, `Missing required fields: ${missing.join(', ')}`);
    }

    await tdb.query('BEGIN');

    try {
      // Security: Derive medication_id from batch_id (do not trust client-provided medicationId)
      const batchQuery = await tdb.query(
        'SELECT medication_id FROM batches WHERE id = $1',
        [batchId]
      );

      if (batchQuery.rows.length === 0) {
        await tdb.query('ROLLBACK');
        return db.fail(400, 'Batch not found');
      }

      const medicationId = batchQuery.rows[0].medication_id;

      // Ensure inventory row exists
      const checkInv = await tdb.query(
        'SELECT on_hand FROM inventory WHERE location_id = $1 AND batch_id = $2',
        [locationId, batchId]
      );

      if (checkInv.rows.length === 0) {
        await tdb.query(
          'INSERT INTO inventory (location_id, batch_id, on_hand) VALUES ($1, $2, $3)',
          [locationId, batchId, delta]
        );
      } else {
        if (checkInv.rows[0].on_hand + delta < 0) {
          await tdb.query('ROLLBACK');
          return db.fail(400, 'Insufficient stock. Cannot reduce below zero.');
        }

        await tdb.query(
          'UPDATE inventory SET on_hand = on_hand + $1 WHERE location_id = $2 AND batch_id = $3',
          [delta, locationId, batchId]
        );
      }

      // Insert transaction record
      const transactionType = delta > 0 ? 'in' : 'out';
      await tdb.query(
        `INSERT INTO transactions
         (batch_id, location_id, medication_id, user_id, delta, type, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [batchId, locationId, medicationId, userId, delta, transactionType, reason || '']
      );

      await tdb.query('COMMIT');

      const isBatchRemoval = (reason || '').startsWith('Batch removed');
      await logActivity({
        userId,
        actionType: isBatchRemoval ? 'batch_removed' : (delta > 0 ? 'stock_in' : 'stock_out'),
        entityType: 'medication',
        entityId: medicationId,
        locationId,
        details: {
          medicationName: medicationName || null,
          batchId,
          batchCode: batchCode || null,
          delta,
          reason: reason || ''
        },
        queryFn: tdb.query
      });

      return db.ok();
    } catch (err) {
      await tdb.query('ROLLBACK');
      throw err;
    }
  } catch (e) {
    return db.serverError('stock-adjust', e);
  }
};
