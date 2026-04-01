// netlify/functions/medication-suppliers-set.js
// Assign or update a medication-supplier mapping
const db = require('./_db');
const { logActivity } = require('./_activity-log');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return db.methodNotAllowed();

  try {
    const tdb = db.forTenant(event);
    if (!tdb) return db.tenantNotFound();

    const body = db.parseBody(event);
    const { action } = body;

    // Handle bulk assignment
    if (action === 'bulk-assign') {
      return await handleBulkAssign(tdb, body);
    }

    // Handle delete/unlink
    if (action === 'delete') {
      return await handleDelete(tdb, body);
    }

    // Default: single upsert
    return await handleUpsert(tdb, body);
  } catch (e) {
    return db.serverError('medication-suppliers-set', e);
  }
};

async function handleUpsert(tdb, body) {
  const {
    medicationId,
    supplierId,
    supplierProductCode,
    unitPrice,
    isPreferred,
    leadTimeDays,
    minOrderQuantity,
    notes,
    userId
  } = body;

  if (!medicationId || !supplierId) {
    return db.fail(400, 'Missing required fields: medicationId, supplierId');
  }

  await tdb.query('BEGIN');
  try {
    // If setting as preferred, unset other preferred for this medication
    if (isPreferred) {
      await tdb.query(
        `UPDATE medication_suppliers SET is_preferred = FALSE
         WHERE medication_id = $1 AND supplier_id != $2`,
        [medicationId, supplierId]
      );
    }

    const result = await tdb.query(
      `INSERT INTO medication_suppliers
         (medication_id, supplier_id, supplier_product_code, unit_price, is_preferred, lead_time_days, min_order_quantity, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (medication_id, supplier_id) DO UPDATE SET
         supplier_product_code = EXCLUDED.supplier_product_code,
         unit_price = EXCLUDED.unit_price,
         is_preferred = EXCLUDED.is_preferred,
         lead_time_days = EXCLUDED.lead_time_days,
         min_order_quantity = EXCLUDED.min_order_quantity,
         notes = EXCLUDED.notes,
         updated_at = NOW()
       RETURNING *`,
      [
        medicationId,
        supplierId,
        supplierProductCode || null,
        unitPrice != null ? unitPrice : null,
        isPreferred === true,
        leadTimeDays != null ? leadTimeDays : null,
        minOrderQuantity != null ? minOrderQuantity : null,
        notes || null
      ]
    );

    await tdb.query('COMMIT');

    await logActivity({
      userId: userId || null,
      actionType: 'medication_supplier_linked',
      entityType: 'medication_supplier',
      entityId: medicationId,
      details: {
        medicationId,
        supplierId,
        isPreferred: isPreferred === true,
        supplierProductCode: supplierProductCode || null
      },
      queryFn: tdb.query
    });

    return db.ok({ mapping: result.rows[0] });
  } catch (err) {
    await tdb.query('ROLLBACK');
    throw err;
  }
}

async function handleBulkAssign(tdb, body) {
  const { supplierId, medicationIds, isPreferred, userId } = body;

  if (!supplierId || !medicationIds || !Array.isArray(medicationIds) || medicationIds.length === 0) {
    return db.fail(400, 'Missing required fields: supplierId, medicationIds[]');
  }

  await tdb.query('BEGIN');
  try {
    let assignedCount = 0;
    for (const medId of medicationIds) {
      if (isPreferred) {
        await tdb.query(
          `UPDATE medication_suppliers SET is_preferred = FALSE
           WHERE medication_id = $1 AND supplier_id != $2`,
          [medId, supplierId]
        );
      }

      await tdb.query(
        `INSERT INTO medication_suppliers (medication_id, supplier_id, is_preferred)
         VALUES ($1, $2, $3)
         ON CONFLICT (medication_id, supplier_id) DO UPDATE SET
           is_preferred = EXCLUDED.is_preferred,
           updated_at = NOW()`,
        [medId, supplierId, isPreferred === true]
      );
      assignedCount++;
    }

    await tdb.query('COMMIT');

    await logActivity({
      userId: userId || null,
      actionType: 'medication_supplier_bulk_linked',
      entityType: 'medication_supplier',
      details: { supplierId, count: assignedCount, isPreferred: isPreferred === true },
      queryFn: tdb.query
    });

    return db.ok({ assignedCount });
  } catch (err) {
    await tdb.query('ROLLBACK');
    throw err;
  }
}

async function handleDelete(tdb, body) {
  const { medicationId, supplierId, userId } = body;

  if (!medicationId || !supplierId) {
    return db.fail(400, 'Missing required fields: medicationId, supplierId');
  }

  const result = await tdb.query(
    `DELETE FROM medication_suppliers WHERE medication_id = $1 AND supplier_id = $2 RETURNING *`,
    [medicationId, supplierId]
  );

  if (result.rows.length === 0) {
    return db.fail(404, 'Mapping not found');
  }

  await logActivity({
    userId: userId || null,
    actionType: 'medication_supplier_unlinked',
    entityType: 'medication_supplier',
    entityId: medicationId,
    details: { medicationId, supplierId },
    queryFn: tdb.query
  });

  return db.ok({ deleted: true });
}
