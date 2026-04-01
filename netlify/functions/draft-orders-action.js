// netlify/functions/draft-orders-action.js
// Handles approve/reject actions on draft orders
const db = require('./_db');
const { logActivity } = require('./_activity-log');
const { routeAndBatchOrders } = require('./_supplier-router');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return db.methodNotAllowed();

  try {
    const tdb = db.forTenant(event);
    if (!tdb) return db.tenantNotFound();

    const {
      action,       // 'approve' | 'reject' | 'approve-all'
      draftIds,     // array of draft IDs (ignored for approve-all)
      userId,
      pharmacistEmail,
      adjustments   // optional { draftId: newQuantity }
    } = db.parseBody(event);

    if (!action) {
      return db.fail(400, 'Missing required field: action');
    }

    if (!['approve', 'reject', 'approve-all'].includes(action)) {
      return db.fail(400, 'Invalid action. Must be: approve, reject, or approve-all');
    }

    // --- REJECT ---
    if (action === 'reject') {
      if (!draftIds || draftIds.length === 0) {
        return db.fail(400, 'Missing required field: draftIds');
      }

      const result = await tdb.query(
        `WITH rejected AS (
           UPDATE draft_orders
           SET status = 'rejected', rejected_at = NOW(), approved_by = $1
           WHERE id = ANY($2) AND status = 'pending_review'
           RETURNING id, medication_id
         )
         SELECT r.id, r.medication_id,
           CASE WHEN m.strength IS NULL OR m.strength = 'N/A' THEN m.name
                ELSE m.name || ' ' || m.strength END AS medication_name
         FROM rejected r
         LEFT JOIN medications m ON m.id = r.medication_id`,
        [userId || null, draftIds]
      );

      for (const row of result.rows) {
        await logActivity({
          userId: userId || null,
          actionType: 'draft_rejected',
          entityType: 'draft_order',
          entityId: row.id,
          details: { draftId: row.id, medicationId: row.medication_id, medicationName: row.medication_name },
          queryFn: tdb.query
        });
      }

      return db.ok({
        rejectedCount: result.rows.length
      });
    }

    // --- APPROVE / APPROVE-ALL ---
    if (!pharmacistEmail) {
      return db.fail(400, 'Missing required field: pharmacistEmail');
    }
    const email = pharmacistEmail;

    // Get drafts to approve
    let draftsToApprove;
    if (action === 'approve-all') {
      const result = await tdb.query(
        `SELECT d.*,
           CASE WHEN m.strength IS NULL OR m.strength = 'N/A' THEN m.name
                ELSE m.name || ' ' || m.strength END AS medication_name,
           m.form AS medication_form
         FROM draft_orders d
         LEFT JOIN medications m ON m.id = d.medication_id
         WHERE d.status = 'pending_review'
         ORDER BY CASE d.urgency WHEN 'urgent' THEN 0 WHEN 'routine' THEN 1 ELSE 2 END, m.name`
      );
      draftsToApprove = result.rows;
    } else {
      if (!draftIds || draftIds.length === 0) {
        return db.fail(400, 'Missing required field: draftIds');
      }
      const result = await tdb.query(
        `SELECT d.*,
           CASE WHEN m.strength IS NULL OR m.strength = 'N/A' THEN m.name
                ELSE m.name || ' ' || m.strength END AS medication_name,
           m.form AS medication_form
         FROM draft_orders d
         LEFT JOIN medications m ON m.id = d.medication_id
         WHERE d.id = ANY($1) AND d.status = 'pending_review'
         ORDER BY CASE d.urgency WHEN 'urgent' THEN 0 WHEN 'routine' THEN 1 ELSE 2 END, m.name`,
        [draftIds]
      );
      draftsToApprove = result.rows;
    }

    if (draftsToApprove.length === 0) {
      return db.fail(404, 'No pending draft orders found to approve');
    }

    // Get items_per_box for quantity conversion (filtered to relevant medications only)
    const medIds = draftsToApprove.map(d => d.medication_id);
    const ipbResult = await tdb.query(`
      SELECT DISTINCT ON (medication_id) medication_id, items_per_box
      FROM batches
      WHERE medication_id = ANY($1) AND items_per_box IS NOT NULL AND items_per_box > 0
      ORDER BY medication_id
    `, [medIds]);
    const itemsPerBoxByMed = {};
    for (const row of ipbResult.rows) {
      itemsPerBoxByMed[row.medication_id] = row.items_per_box;
    }

    const approvedOrders = [];
    const adj = adjustments || {};

    // Wrap all approvals in a transaction for atomicity
    await tdb.query('BEGIN');
    try {
      for (const draft of draftsToApprove) {
        // Determine final quantity (boxes)
        const finalBoxes = adj[draft.id] != null ? Number(adj[draft.id]) : draft.suggested_quantity;
        if (finalBoxes <= 0) continue;

        // Convert to items for the orders table
        const itemsPerBox = itemsPerBoxByMed[draft.medication_id] || 1;
        const quantityInItems = finalBoxes * itemsPerBox;

        // Create real order
        const orderResult = await tdb.query(
          `INSERT INTO orders
           (medication_id, user_id, quantity, urgency, notes, pharmacist_email, status, ordered_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())
           RETURNING id, ordered_at`,
          [
            draft.medication_id,
            userId || null,
            quantityInItems,
            draft.urgency,
            `Auto-generated from draft order #${draft.id}`,
            email
          ]
        );

        const order = orderResult.rows[0];

        // Update draft
        await tdb.query(
          `UPDATE draft_orders
           SET status = 'approved', approved_quantity = $1, approved_by = $2,
               approved_at = NOW(), order_id = $3
           WHERE id = $4`,
          [finalBoxes, userId || null, order.id, draft.id]
        );

        // Log activity
        await logActivity({
          userId: userId || null,
          actionType: 'draft_approved',
          entityType: 'draft_order',
          entityId: draft.id,
          details: {
            draftId: draft.id,
            medicationName: draft.medication_name,
            suggestedQuantity: draft.suggested_quantity,
            approvedQuantity: finalBoxes,
            quantityInItems,
            orderId: order.id
          },
          queryFn: tdb.query
        });

        approvedOrders.push({
          orderId: order.id,
          draftId: draft.id,
          medicationId: draft.medication_id,
          medicationName: draft.medication_name || 'Unknown',
          medicationForm: draft.medication_form || '',
          quantityBoxes: finalBoxes,
          quantityItems: quantityInItems,
          urgency: draft.urgency,
          currentStock: Number(draft.current_stock_boxes),
          minLevel: Number(draft.min_level_boxes),
          orderedAt: order.ordered_at
        });
      }
      await tdb.query('COMMIT');
    } catch (err) {
      await tdb.query('ROLLBACK');
      throw err;
    }

    // Log bulk approval
    if (approvedOrders.length > 0) {
      await logActivity({
        userId: userId || null,
        actionType: 'bulk_order_approved',
        entityType: 'draft_orders',
        details: {
          count: approvedOrders.length,
          totalBoxes: approvedOrders.reduce((sum, o) => sum + o.quantityBoxes, 0),
          pharmacistEmail: email
        },
        queryFn: tdb.query
      });
    }

    // Generate consolidated email content
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    const urgentItems = approvedOrders.filter(o => o.urgency === 'urgent');
    const routineItems = approvedOrders.filter(o => o.urgency === 'routine');
    const nonUrgentItems = approvedOrders.filter(o => o.urgency === 'non-urgent');

    const formatItem = (o, idx) =>
      `${idx + 1}. ${o.medicationName} - ${o.quantityBoxes} ${o.quantityBoxes === 1 ? 'box' : 'boxes'} (${o.quantityItems} items) - Current Stock: ${o.currentStock} boxes`;

    let body = `Dear Pharmacist,\n\nPlease find below the consolidated stock order for ${approvedOrders.length} medication${approvedOrders.length !== 1 ? 's' : ''}.\n\n`;
    body += `CONSOLIDATED STOCK ORDER\n========================\n\n`;

    if (urgentItems.length > 0) {
      body += `URGENT ITEMS:\n`;
      body += urgentItems.map(formatItem).join('\n');
      body += '\n\n';
    }

    if (routineItems.length > 0) {
      body += `ROUTINE ITEMS:\n`;
      body += routineItems.map(formatItem).join('\n');
      body += '\n\n';
    }

    if (nonUrgentItems.length > 0) {
      body += `NON-URGENT ITEMS:\n`;
      body += nonUrgentItems.map(formatItem).join('\n');
      body += '\n\n';
    }

    const totalBoxes = approvedOrders.reduce((sum, o) => sum + o.quantityBoxes, 0);
    body += `Total: ${approvedOrders.length} medication${approvedOrders.length !== 1 ? 's' : ''}, ${totalBoxes} boxes\n\n`;
    body += `Approved: ${dateStr} ${timeStr}\n\n`;
    body += `Please process this order at your earliest convenience.`;

    const subject = `STOCK ORDER - ${approvedOrders.length} Medication${approvedOrders.length !== 1 ? 's' : ''} - ${dateStr}`;

    // Route orders to suppliers (non-blocking — falls back gracefully if supplier tables don't exist yet)
    let supplierBatches = [];
    let unassignedOrderIds = [];
    try {
      const orderIds = approvedOrders.map(o => o.orderId);
      const routing = await routeAndBatchOrders(orderIds, userId, tdb.query);
      supplierBatches = routing.supplierBatches;
      unassignedOrderIds = routing.unassignedOrderIds;
    } catch (routeErr) {
      console.error('Supplier routing (non-fatal):', routeErr.message);
    }

    return db.ok({
      approvedCount: approvedOrders.length,
      orders: approvedOrders,
      emailContent: {
        to: email,
        subject,
        body
      },
      supplierBatches,
      unassignedOrderIds
    });
  } catch (e) {
    return db.serverError('draft-orders-action', e);
  }
};
