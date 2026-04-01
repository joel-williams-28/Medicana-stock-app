// netlify/functions/supplier-orders-update.js
// Update supplier order status, tracking reference, expected delivery
const db = require('./_db');
const { logActivity } = require('./_activity-log');

const VALID_STATUSES = ['draft', 'sent', 'confirmed', 'dispatched', 'delivered', 'cancelled'];

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return db.methodNotAllowed();

  try {
    const tdb = db.forTenant(event);
    if (!tdb) return db.tenantNotFound();

    const {
      supplierOrderId,
      status,
      supplierReference,
      expectedDelivery,
      notes,
      userId
    } = db.parseBody(event);

    if (!supplierOrderId) {
      return db.fail(400, 'Missing required field: supplierOrderId');
    }

    // Check exists
    const existing = await tdb.query(
      'SELECT id, status, supplier_id FROM supplier_orders WHERE id = $1',
      [supplierOrderId]
    );

    if (existing.rows.length === 0) {
      return db.fail(404, 'Supplier order not found');
    }

    const current = existing.rows[0];

    // Build dynamic update
    const sets = ['updated_at = NOW()'];
    const values = [];
    let paramIdx = 0;

    if (status != null) {
      if (!VALID_STATUSES.includes(status)) {
        return db.fail(400, `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`);
      }
      paramIdx++;
      sets.push(`status = $${paramIdx}`);
      values.push(status);

      // Auto-set timestamp fields based on status transition
      if (status === 'sent' && current.status === 'draft') {
        sets.push('sent_at = NOW()');
      }
      if (status === 'confirmed') {
        sets.push('confirmed_at = NOW()');
      }
      if (status === 'dispatched') {
        sets.push('dispatched_at = NOW()');
      }
      if (status === 'delivered') {
        sets.push('delivered_at = NOW()');
      }
    }

    if (supplierReference !== undefined) {
      paramIdx++;
      sets.push(`supplier_reference = $${paramIdx}`);
      values.push(supplierReference || null);
    }

    if (expectedDelivery !== undefined) {
      paramIdx++;
      sets.push(`expected_delivery = $${paramIdx}`);
      values.push(expectedDelivery || null);
    }

    if (notes !== undefined) {
      paramIdx++;
      sets.push(`notes = $${paramIdx}`);
      values.push(notes || null);
    }

    paramIdx++;
    values.push(supplierOrderId);

    const result = await tdb.query(
      `UPDATE supplier_orders SET ${sets.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      values
    );

    const updated = result.rows[0];

    // If marked as delivered, auto-fulfill all linked pending orders
    if (status === 'delivered') {
      await tdb.query(
        `UPDATE orders SET status = 'fulfilled', fulfilled_at = NOW(), quantity_fulfilled = quantity
         WHERE supplier_order_id = $1 AND status = 'pending'`,
        [supplierOrderId]
      );
    }

    await logActivity({
      userId: userId || null,
      actionType: 'supplier_order_updated',
      entityType: 'supplier_order',
      entityId: String(supplierOrderId),
      details: {
        supplierId: current.supplier_id,
        previousStatus: current.status,
        newStatus: status || current.status,
        supplierReference: supplierReference || null,
        expectedDelivery: expectedDelivery || null
      },
      queryFn: tdb.query
    });

    return db.ok({
      supplierOrder: {
        id: updated.id,
        supplierId: updated.supplier_id,
        status: updated.status,
        supplierReference: updated.supplier_reference,
        expectedDelivery: updated.expected_delivery,
        sentAt: updated.sent_at,
        confirmedAt: updated.confirmed_at,
        dispatchedAt: updated.dispatched_at,
        deliveredAt: updated.delivered_at,
        notes: updated.notes,
        updatedAt: updated.updated_at
      }
    });
  } catch (e) {
    return db.serverError('supplier-orders-update', e);
  }
};
