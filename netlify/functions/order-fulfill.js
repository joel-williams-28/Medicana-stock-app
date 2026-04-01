// netlify/functions/order-fulfill.js
// Marks an order as fulfilled (or partially fulfilled) when stock arrives
const db = require('./_db');
const { logActivity } = require('./_activity-log');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return db.methodNotAllowed();

  try {
    const tdb = db.forTenant(event);
    if (!tdb) return db.tenantNotFound();

    const { orderId, userId, medicationName, quantityDelivered } = JSON.parse(event.body || '{}');

    if (!orderId) {
      return db.fail(400, 'Missing required field: orderId');
    }

    const checkResult = await tdb.query(
      'SELECT id, status, quantity, COALESCE(quantity_fulfilled, 0) AS quantity_fulfilled FROM orders WHERE id = $1',
      [orderId]
    );

    if (checkResult.rows.length === 0) {
      return db.fail(404, 'Order not found');
    }

    const existing = checkResult.rows[0];

    if (existing.status !== 'pending') {
      return db.fail(400, `Order is already ${existing.status}`);
    }

    if (quantityDelivered != null && quantityDelivered > 0) {
      // Partial fulfillment mode — increment quantity_fulfilled
      const newFulfilled = existing.quantity_fulfilled + quantityDelivered;
      const isComplete = newFulfilled >= existing.quantity;

      const result = await tdb.query(
        `UPDATE orders
         SET quantity_fulfilled = $2,
             status = CASE WHEN $2 >= quantity THEN 'fulfilled' ELSE status END,
             fulfilled_at = CASE WHEN $2 >= quantity THEN NOW() ELSE fulfilled_at END
         WHERE id = $1
         RETURNING id, medication_id, status, fulfilled_at, quantity, quantity_fulfilled`,
        [orderId, newFulfilled]
      );

      const order = result.rows[0];

      await logActivity({
        userId: userId || null,
        actionType: 'order_fulfilled',
        entityType: 'medication',
        entityId: order.medication_id,
        details: {
          medicationName: medicationName || null,
          orderId: order.id,
          quantityDelivered,
          quantityFulfilled: newFulfilled,
          quantityOrdered: existing.quantity,
          autoFulfilled: true,
          partial: !isComplete
        },
        queryFn: tdb.query
      });

      // Check if supplier_order is fully delivered
      if (isComplete) {
        await checkSupplierOrderCompletion(order.id, tdb.query);
      }

      return db.ok({
        order: {
          id: order.id,
          medicationId: order.medication_id,
          status: order.status,
          fulfilledAt: order.fulfilled_at,
          quantity: order.quantity,
          quantityFulfilled: order.quantity_fulfilled
        }
      });
    } else {
      // Full fulfillment mode (immediate)
      const result = await tdb.query(
        `UPDATE orders
         SET status = 'fulfilled', fulfilled_at = NOW(), quantity_fulfilled = quantity
         WHERE id = $1
         RETURNING id, medication_id, status, fulfilled_at`,
        [orderId]
      );

      const order = result.rows[0];

      await logActivity({
        userId: userId || null,
        actionType: 'order_fulfilled',
        entityType: 'medication',
        entityId: order.medication_id,
        details: {
          medicationName: medicationName || null,
          orderId: order.id
        },
        queryFn: tdb.query
      });

      // Check if supplier_order is fully delivered
      await checkSupplierOrderCompletion(order.id, tdb.query);

      return db.ok({
        order: {
          id: order.id,
          medicationId: order.medication_id,
          status: order.status,
          fulfilledAt: order.fulfilled_at
        }
      });
    }
  } catch (e) {
    return db.serverError('order-fulfill', e);
  }
};

// Auto-update supplier_order to 'delivered' when all linked orders are fulfilled
async function checkSupplierOrderCompletion(orderId, queryFn) {
  try {
    const result = await queryFn(
      `SELECT o.supplier_order_id FROM orders o WHERE o.id = $1 AND o.supplier_order_id IS NOT NULL`,
      [orderId]
    );
    if (result.rows.length === 0) return;

    const soId = result.rows[0].supplier_order_id;

    // Check if all orders in this supplier batch are fulfilled
    const pendingCheck = await queryFn(
      `SELECT COUNT(*) AS pending FROM orders
       WHERE supplier_order_id = $1 AND status != 'fulfilled'`,
      [soId]
    );

    if (Number(pendingCheck.rows[0].pending) === 0) {
      await queryFn(
        `UPDATE supplier_orders SET status = 'delivered', delivered_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status != 'delivered'`,
        [soId]
      );
    }
  } catch (err) {
    console.error('Supplier order completion check (non-fatal):', err.message);
  }
}
