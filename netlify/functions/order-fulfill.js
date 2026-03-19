// netlify/functions/order-fulfill.js
// Marks an order as fulfilled when stock arrives
const db = require('./_db');
const { logActivity } = require('./_activity-log');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return db.methodNotAllowed();

  try {
    const { orderId, userId, medicationName } = JSON.parse(event.body || '{}');

    if (!orderId) {
      return db.fail(400, 'Missing required field: orderId');
    }

    const checkResult = await db.query(
      'SELECT id, status FROM orders WHERE id = $1',
      [orderId]
    );

    if (checkResult.rows.length === 0) {
      return db.fail(404, 'Order not found');
    }

    if (checkResult.rows[0].status !== 'pending') {
      return db.fail(400, `Order is already ${checkResult.rows[0].status}`);
    }

    const result = await db.query(
      `UPDATE orders
       SET status = 'fulfilled', fulfilled_at = NOW()
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
      }
    });

    return db.ok({
      order: {
        id: order.id,
        medicationId: order.medication_id,
        status: order.status,
        fulfilledAt: order.fulfilled_at
      }
    });
  } catch (e) {
    return db.serverError('order-fulfill', e);
  }
};
