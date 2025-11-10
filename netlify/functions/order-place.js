// netlify/functions/order-place.js
// Creates a new medication order request in the database
const db = require('./_db');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ success: false, message: 'Method not allowed' })
    };
  }

  try {
    const {
      medicationId,
      userId,
      quantity,
      urgency,
      notes,
      pharmacistEmail
    } = JSON.parse(event.body || '{}');

    // Validate required fields
    if (!medicationId || !quantity || !urgency || !pharmacistEmail) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          message: 'Missing required fields: medicationId, quantity, urgency, pharmacistEmail'
        })
      };
    }

    // Validate quantity is positive
    if (quantity <= 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          message: 'Quantity must be greater than zero'
        })
      };
    }

    // Validate urgency value
    const validUrgencies = ['urgent', 'routine', 'non-urgent'];
    if (!validUrgencies.includes(urgency)) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          success: false,
          message: 'Invalid urgency value. Must be: urgent, routine, or non-urgent'
        })
      };
    }

    // Insert the order into the database
    const result = await db.query(
      `INSERT INTO orders
       (medication_id, user_id, quantity, urgency, notes, pharmacist_email, status, ordered_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())
       RETURNING id, medication_id, user_id, quantity, urgency, notes, pharmacist_email, status, ordered_at, created_at`,
      [medicationId, userId || null, quantity, urgency, notes || '', pharmacistEmail]
    );

    const order = result.rows[0];

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        order: {
          id: order.id,
          medicationId: order.medication_id,
          userId: order.user_id,
          quantity: order.quantity,
          urgency: order.urgency,
          notes: order.notes,
          pharmacistEmail: order.pharmacist_email,
          status: order.status,
          orderedAt: order.ordered_at,
          createdAt: order.created_at
        }
      })
    };
  } catch (e) {
    console.error('order-place error:', e);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        message: 'Server error while placing order.'
      })
    };
  }
};
