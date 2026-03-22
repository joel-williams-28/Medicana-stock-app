// netlify/functions/intelligence-orders-create.js
// Creates real orders from intelligence pipeline recommendations
const db = require('./_db');
const { logActivity } = require('./_activity-log');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return db.methodNotAllowed();

  try {
    const { orders, userId, pharmacistEmail } = db.parseBody(event);

    if (!orders || !Array.isArray(orders) || orders.length === 0) {
      return db.fail(400, 'orders array is required and must not be empty');
    }
    if (!pharmacistEmail) {
      return db.fail(400, 'pharmacistEmail is required');
    }

    // Get items_per_box for quantity conversion
    const ipbResult = await db.query(`
      SELECT medication_id, items_per_box
      FROM batches
      WHERE items_per_box IS NOT NULL AND items_per_box > 0
      ORDER BY medication_id
    `);
    const itemsPerBoxByMed = {};
    for (const row of ipbResult.rows) {
      if (!itemsPerBoxByMed[row.medication_id]) {
        itemsPerBoxByMed[row.medication_id] = row.items_per_box;
      }
    }

    const createdOrders = [];

    for (const item of orders) {
      const { medicationId, medicationName, locationId, quantityBoxes, urgency } = item;
      if (!medicationId || !quantityBoxes || quantityBoxes <= 0) continue;

      const itemsPerBox = itemsPerBoxByMed[medicationId] || 1;
      const quantityInItems = quantityBoxes * itemsPerBox;

      // Create real order in the orders table
      const orderResult = await db.query(
        `INSERT INTO orders
         (medication_id, user_id, quantity, urgency, notes, pharmacist_email, status, ordered_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())
         RETURNING id, ordered_at`,
        [
          medicationId,
          userId || null,
          quantityInItems,
          urgency || 'routine',
          `Intelligence pipeline order for Pharmacy${item.supplyDestinations?.length > 0 ? ' | Supplies: ' + item.supplyDestinations.map(d => d.locationName).join(', ') : ''}`,
          pharmacistEmail
        ]
      );

      const order = orderResult.rows[0];

      // Log activity with full pipeline context
      await logActivity({
        userId: userId || null,
        actionType: 'order_placed',
        entityType: 'order',
        entityId: String(order.id),
        locationId: locationId || null,
        details: {
          medicationName: medicationName || 'Unknown',
          quantityBoxes,
          quantityInItems,
          urgency: urgency || 'routine',
          source: 'intelligence_pipeline',
          currentSimulatedBoxes: item.currentSimulatedBoxes != null ? Number(item.currentSimulatedBoxes) : null,
          pharmacyDerivedMin: item.pharmacyDerivedMin != null ? Number(item.pharmacyDerivedMin) : null,
          supplyDestinations: item.supplyDestinations || []
        }
      });

      createdOrders.push({
        orderId: order.id,
        medicationId,
        medicationName: medicationName || 'Unknown',
        quantityBoxes,
        quantityItems: quantityInItems,
        urgency: urgency || 'routine',
        currentStock: item.currentSimulatedBoxes != null ? Number(item.currentSimulatedBoxes) : 0,
        minLevel: item.pharmacyDerivedMin != null ? Number(item.pharmacyDerivedMin) : (item.suggestedMinLevel != null ? Number(item.suggestedMinLevel) : 0),
        supplyDestinations: item.supplyDestinations || [],
        orderedAt: order.ordered_at
      });
    }

    if (createdOrders.length === 0) {
      return db.fail(400, 'No valid orders to create');
    }

    // Log bulk activity
    await logActivity({
      userId: userId || null,
      actionType: 'bulk_order_approved',
      entityType: 'orders',
      details: {
        count: createdOrders.length,
        totalBoxes: createdOrders.reduce((sum, o) => sum + o.quantityBoxes, 0),
        pharmacistEmail,
        source: 'intelligence_pipeline'
      }
    });

    // Generate consolidated email content
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    const urgentItems = createdOrders.filter(o => o.urgency === 'urgent');
    const routineItems = createdOrders.filter(o => o.urgency === 'routine');
    const nonUrgentItems = createdOrders.filter(o => o.urgency === 'non-urgent');

    const formatItem = (o, idx) => {
      let line = `${idx + 1}. ${o.medicationName} - ${o.quantityBoxes} ${o.quantityBoxes === 1 ? 'box' : 'boxes'} (${o.quantityItems} items) - Current Stock: ${o.currentStock} boxes`;
      if (o.supplyDestinations && o.supplyDestinations.length > 0) {
        line += `\n   Supplies: ${o.supplyDestinations.map(d => `${d.locationName} (avg ${d.avgWeeklyUsage} boxes/wk)`).join(', ')}`;
      }
      return line;
    };

    let body = `Dear Pharmacist,\n\nPlease find below the consolidated stock order for ${createdOrders.length} medication${createdOrders.length !== 1 ? 's' : ''}.\n\n`;
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

    const totalBoxes = createdOrders.reduce((sum, o) => sum + o.quantityBoxes, 0);
    body += `Total: ${createdOrders.length} medication${createdOrders.length !== 1 ? 's' : ''}, ${totalBoxes} boxes\n\n`;
    body += `Approved: ${dateStr} ${timeStr}\n\n`;
    body += `Please process this order at your earliest convenience.`;

    const subject = `STOCK ORDER - ${createdOrders.length} Medication${createdOrders.length !== 1 ? 's' : ''} - ${dateStr}`;

    return db.ok({
      approvedCount: createdOrders.length,
      orders: createdOrders,
      emailContent: {
        to: pharmacistEmail,
        subject,
        body
      }
    });
  } catch (e) {
    return db.serverError('intelligence-orders-create', e);
  }
};
