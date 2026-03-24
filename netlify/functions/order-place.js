// netlify/functions/order-place.js
// Creates a new medication order request in the database
const db = require('./_db');
const { logActivity } = require('./_activity-log');

const VALID_URGENCIES = ['urgent', 'routine', 'non-urgent'];

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return db.methodNotAllowed();

  try {
    const tdb = db.forTenant(event);
    if (!tdb) return db.tenantNotFound();

    const {
      medicationId,
      userId,
      quantity,
      urgency,
      notes,
      pharmacistEmail,
      medicationName
    } = JSON.parse(event.body || '{}');

    if (!medicationId || !quantity || !urgency || !pharmacistEmail) {
      return db.fail(400, 'Missing required fields: medicationId, quantity, urgency, pharmacistEmail');
    }

    if (quantity <= 0) {
      return db.fail(400, 'Quantity must be greater than zero');
    }

    if (!VALID_URGENCIES.includes(urgency)) {
      return db.fail(400, 'Invalid urgency value. Must be: urgent, routine, or non-urgent');
    }

    const result = await tdb.query(
      `INSERT INTO orders
       (medication_id, user_id, quantity, urgency, notes, pharmacist_email, status, ordered_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())
       RETURNING id, medication_id, user_id, quantity, urgency, notes, pharmacist_email, status, ordered_at, created_at`,
      [medicationId, userId || null, quantity, urgency, notes || '', pharmacistEmail]
    );

    const order = result.rows[0];

    await logActivity({
      userId: userId || null,
      actionType: 'order_placed',
      entityType: 'medication',
      entityId: medicationId,
      details: {
        medicationName: medicationName || null,
        orderId: order.id,
        quantity,
        urgency,
        notes: notes || null,
        pharmacistEmail
      },
      queryFn: tdb.query
    });

    return db.ok({
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
    });
  } catch (e) {
    return db.serverError('order-place', e);
  }
};
