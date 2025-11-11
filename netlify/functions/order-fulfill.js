// netlify/functions/order-fulfill.js
// Marks an order as fulfilled when stock arrives
const db = require('./_db');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ success: false, message: 'Method not allowed' })
    };
  }

  try {
    const { orderId } = JSON.parse(event.body || '{}');

    // Validate required fields
    if (!orderId) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          message: 'Missing required field: orderId'
        })
      };
    }

    // Check if order exists and is pending
    const checkResult = await db.query(
      'SELECT id, status FROM orders WHERE id = $1',
      [orderId]
    );

    if (checkResult.rows.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          success: false,
          message: 'Order not found'
        })
      };
    }

    if (checkResult.rows[0].status !== 'pending') {
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          message: `Order is already ${checkResult.rows[0].status}`
        })
      };
    }

    // Update order status to fulfilled
    const result = await db.query(
      `UPDATE orders
       SET status = 'fulfilled', fulfilled_at = NOW()
       WHERE id = $1
       RETURNING id, medication_id, status, fulfilled_at`,
      [orderId]
    );

    const order = result.rows[0];

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        order: {
          id: order.id,
          medicationId: order.medication_id,
          status: order.status,
          fulfilledAt: order.fulfilled_at
        }
      })
    };
  } catch (e) {
    console.error('order-fulfill error:', e);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        message: 'Server error while fulfilling order.'
      })
    };
  }
};
