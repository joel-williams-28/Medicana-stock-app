// netlify/functions/stock-transfer.js
// Handles transfers of stock between two locations
// Security: medication_id is derived from batch_id on the server, not trusted from client
const db = require('./_db');
const { logActivity } = require('./_activity-log');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return db.methodNotAllowed();

  try {
    const tdb = db.forTenant(event);
    if (!tdb) return db.tenantNotFound();

    const body = db.parseBody(event);
    console.log('[stock-transfer] body:', JSON.stringify(body));

    // IDs: accept as-is (string or number) — let PostgreSQL handle type coercion
    const userId = body.userId;
    const batchId = body.batchId;
    const sourceLocationId = body.sourceLocationId;
    const targetLocationId = body.targetLocationId;
    const quantity = Number(body.quantity);
    const reason = body.reason;
    const medicationName = body.medicationName;
    const batchCode = body.batchCode;

    // Pipeline context (optional — passed by intelligence pipeline execution)
    const pipelineContext = {};
    if (body.pipelineStep) pipelineContext.pipelineStep = body.pipelineStep;
    if (body.sourceStockBoxes != null) pipelineContext.sourceStockBoxes = body.sourceStockBoxes;
    if (body.targetStockBoxes != null) pipelineContext.targetStockBoxes = body.targetStockBoxes;
    if (body.sourceMinLevel != null) pipelineContext.sourceMinLevel = body.sourceMinLevel;
    if (body.targetMinLevel != null) pipelineContext.targetMinLevel = body.targetMinLevel;
    if (body.quantityBoxes != null) pipelineContext.quantityBoxes = body.quantityBoxes;

    const missing = [];
    if (!userId && userId !== 0) missing.push('userId');
    if (!batchId && batchId !== 0) missing.push('batchId');
    if (!sourceLocationId && sourceLocationId !== 0) missing.push('sourceLocationId');
    if (!targetLocationId && targetLocationId !== 0) missing.push('targetLocationId');
    if (isNaN(quantity)) missing.push('quantity');

    if (missing.length > 0) {
      console.log('[stock-transfer] Validation failed. Missing:', missing, 'Raw body:', body);
      return db.fail(400, `Missing or invalid fields: ${missing.join(', ')}`);
    }

    if (quantity <= 0 || !Number.isInteger(quantity)) {
      return db.fail(400, 'Quantity must be a positive integer');
    }

    await tdb.query('BEGIN');

    try {
      // Security: Derive medication_id from batch_id
      const batchQuery = await tdb.query(
        'SELECT medication_id FROM batches WHERE id = $1',
        [batchId]
      );

      if (batchQuery.rows.length === 0) {
        await tdb.query('ROLLBACK');
        return db.fail(400, 'Batch not found');
      }

      const medicationId = batchQuery.rows[0].medication_id;

      // Get location display names for clean transaction notes
      const locationsQuery = await tdb.query(
        'SELECT id, display_name FROM locations WHERE id IN ($1, $2)',
        [sourceLocationId, targetLocationId]
      );

      const locationMap = {};
      locationsQuery.rows.forEach(row => { locationMap[row.id] = row.display_name; });

      const sourceLocationName = locationMap[sourceLocationId] || sourceLocationId;
      const targetLocationName = locationMap[targetLocationId] || targetLocationId;

      // Check source has enough stock
      const checkSource = await tdb.query(
        'SELECT on_hand FROM inventory WHERE location_id = $1 AND batch_id = $2',
        [sourceLocationId, batchId]
      );

      if (checkSource.rows.length === 0) {
        await tdb.query('ROLLBACK');
        return db.fail(400, 'Source location does not have this batch in inventory');
      }

      if (checkSource.rows[0].on_hand < quantity) {
        await tdb.query('ROLLBACK');
        return db.fail(400, 'Not enough stock at source');
      }

      // Decrease stock at source
      await tdb.query(
        'UPDATE inventory SET on_hand = on_hand - $1 WHERE location_id = $2 AND batch_id = $3',
        [quantity, sourceLocationId, batchId]
      );

      // Record outgoing transaction
      await tdb.query(
        `INSERT INTO transactions
         (batch_id, location_id, medication_id, user_id, delta, type, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [batchId, sourceLocationId, medicationId, userId, -quantity, 'out', `Transfer to ${targetLocationName}`]
      );

      // Ensure target inventory row exists, then increase stock
      await tdb.query(
        `INSERT INTO inventory (location_id, batch_id, on_hand)
         VALUES ($1, $2, 0)
         ON CONFLICT (location_id, batch_id) DO NOTHING`,
        [targetLocationId, batchId]
      );

      await tdb.query(
        'UPDATE inventory SET on_hand = on_hand + $1 WHERE location_id = $2 AND batch_id = $3',
        [quantity, targetLocationId, batchId]
      );

      // Record incoming transaction
      await tdb.query(
        `INSERT INTO transactions
         (batch_id, location_id, medication_id, user_id, delta, type, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [batchId, targetLocationId, medicationId, userId, quantity, 'in', `Transfer from ${sourceLocationName}`]
      );

      await tdb.query('COMMIT');

      // Skip activity log for bulk operations (bulk summary is logged separately by the frontend)
      if (!body.skipActivityLog) {
        // Use distinct action type for pharmacy supplies vs regular transfers
        const isPharmacySupply = pipelineContext.pipelineStep === 'pharmacy_supply';

        await logActivity({
          userId,
          actionType: isPharmacySupply ? 'pharmacy_supply' : 'stock_transfer',
          entityType: 'medication',
          entityId: medicationId,
          locationId: sourceLocationId,
          details: {
            medicationName: medicationName || null,
            batchId,
            batchCode: batchCode || null,
          delta: quantity,
          sourceLocationId,
          sourceLocationName,
          targetLocationId,
          targetLocationName,
          reason: reason || '',
          ...pipelineContext
        },
        queryFn: tdb.query
        });
      }

      return db.ok();
    } catch (err) {
      await tdb.query('ROLLBACK');
      throw err;
    }
  } catch (e) {
    return db.serverError('stock-transfer', e);
  }
};
