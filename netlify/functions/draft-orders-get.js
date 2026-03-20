// netlify/functions/draft-orders-get.js
// Retrieves draft orders for the Purchase Orders review tab
const db = require('./_db');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return db.methodNotAllowed();

  try {
    const params = event.queryStringParameters || {};
    const status = params.status || 'pending_review';

    // Ensure table exists
    // Ensure draft_orders table exists (idempotent, no FKs to avoid type issues)
    // NOTE: medication_id and location_id are TEXT to match medications.id and locations.id
    await db.query(`
      CREATE TABLE IF NOT EXISTS draft_orders (
        id SERIAL PRIMARY KEY,
        medication_id TEXT NOT NULL,
        location_id TEXT,
        current_stock_boxes NUMERIC(10,2) NOT NULL DEFAULT 0,
        min_level_boxes INTEGER NOT NULL DEFAULT 0,
        suggested_quantity INTEGER NOT NULL,
        approved_quantity INTEGER,
        urgency VARCHAR(20) NOT NULL DEFAULT 'routine',
        intelligence_snapshot JSONB,
        source VARCHAR(20) NOT NULL DEFAULT 'auto',
        status VARCHAR(20) NOT NULL DEFAULT 'pending_review',
        generated_by INTEGER,
        approved_by INTEGER,
        generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        approved_at TIMESTAMP WITH TIME ZONE,
        rejected_at TIMESTAMP WITH TIME ZONE,
        order_id INTEGER,
        batch_ref UUID NOT NULL,
        notes TEXT
      )
    `).catch(() => {});

    const result = await db.query(`
      SELECT
        d.id,
        d.medication_id,
        CASE WHEN m.strength IS NULL OR m.strength = 'N/A' THEN m.name
             ELSE m.name || ' ' || m.strength END AS medication_name,
        m.form AS medication_form,
        d.location_id,
        l.display_name AS location_name,
        d.current_stock_boxes,
        d.min_level_boxes,
        d.suggested_quantity,
        d.approved_quantity,
        d.urgency,
        d.intelligence_snapshot,
        d.source,
        d.status,
        d.generated_by,
        u.full_name AS generated_by_name,
        d.generated_at,
        d.batch_ref
      FROM draft_orders d
      LEFT JOIN medications m ON m.id = d.medication_id
      LEFT JOIN locations l ON l.id = d.location_id
      LEFT JOIN users u ON u.id = d.generated_by
      WHERE d.status = $1
      ORDER BY
        CASE d.urgency WHEN 'urgent' THEN 0 WHEN 'routine' THEN 1 ELSE 2 END,
        m.name
    `, [status]);

    const drafts = result.rows.map(row => ({
      id: row.id,
      medicationId: row.medication_id,
      medicationName: row.medication_name || 'Unknown',
      medicationForm: row.medication_form || '',
      locationId: row.location_id,
      locationName: row.location_name || '',
      currentStockBoxes: Number(row.current_stock_boxes),
      minLevelBoxes: Number(row.min_level_boxes),
      suggestedQuantity: row.suggested_quantity,
      approvedQuantity: row.approved_quantity,
      urgency: row.urgency,
      intelligenceSnapshot: row.intelligence_snapshot || {},
      source: row.source,
      status: row.status,
      generatedByName: row.generated_by_name || 'System',
      generatedAt: row.generated_at ? row.generated_at.toISOString() : null,
      batchRef: row.batch_ref
    }));

    // Summary
    const urgent = drafts.filter(d => d.urgency === 'urgent').length;
    const routine = drafts.filter(d => d.urgency === 'routine').length;

    return db.ok({
      drafts,
      summary: {
        total: drafts.length,
        urgent,
        routine,
        generatedAt: drafts.length > 0 ? drafts[0].generatedAt : null
      }
    });
  } catch (e) {
    return db.serverError('draft-orders-get', e);
  }
};
