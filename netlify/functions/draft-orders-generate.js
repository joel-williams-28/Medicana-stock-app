// netlify/functions/draft-orders-generate.js
// Auto-generates draft purchase orders based on intelligence recommendations
const crypto = require('crypto');
const db = require('./_db');
const { logActivity } = require('./_activity-log');
const {
  getMaturityInfo,
  getStockLevels,
  getWeeklyUsageData,
  getItemsPerBoxMap,
  analyzeMedication
} = require('./_intelligence-core');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return db.methodNotAllowed();

  try {
    const { userId, locationId } = db.parseBody(event);

    // Ensure draft_orders table exists (idempotent)
    await db.query(`
      CREATE TABLE IF NOT EXISTS draft_orders (
        id SERIAL PRIMARY KEY,
        medication_id INTEGER NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
        location_id INTEGER,
        current_stock_boxes NUMERIC(10,2) NOT NULL DEFAULT 0,
        min_level_boxes INTEGER NOT NULL DEFAULT 0,
        suggested_quantity INTEGER NOT NULL CHECK (suggested_quantity > 0),
        approved_quantity INTEGER,
        urgency VARCHAR(20) NOT NULL DEFAULT 'routine'
          CHECK (urgency IN ('urgent', 'routine', 'non-urgent')),
        intelligence_snapshot JSONB,
        source VARCHAR(20) NOT NULL DEFAULT 'auto'
          CHECK (source IN ('auto', 'manual')),
        status VARCHAR(20) NOT NULL DEFAULT 'pending_review'
          CHECK (status IN ('pending_review', 'approved', 'rejected')),
        generated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        approved_at TIMESTAMP WITH TIME ZONE,
        rejected_at TIMESTAMP WITH TIME ZONE,
        order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
        batch_ref UUID NOT NULL,
        notes TEXT
      )
    `).catch(() => {});

    // Get maturity info
    const { weeksOfData, maturityLevel } = await getMaturityInfo();

    // Get stock levels
    const stockRows = await getStockLevels(locationId || null);

    // Get usage data (if mature enough)
    const weeksToAnalyze = Math.min(Math.max(weeksOfData, 1), 12);
    const usageByMedLoc = (maturityLevel !== 'not_configured' && maturityLevel !== 'collecting')
      ? await getWeeklyUsageData(locationId || null, weeksToAnalyze)
      : {};

    // Get items per box
    const itemsPerBoxByMed = await getItemsPerBoxMap();

    // Get existing pending drafts and pending orders to avoid duplicates
    const existingDrafts = await db.query(
      `SELECT medication_id, location_id FROM draft_orders WHERE status = 'pending_review'`
    );
    const draftKeys = new Set(existingDrafts.rows.map(r => `${r.medication_id}|${r.location_id}`));

    const existingOrders = await db.query(
      `SELECT medication_id FROM orders WHERE status = 'pending'`
    );
    const orderedMedIds = new Set(existingOrders.rows.map(r => r.medication_id));

    // Generate batch reference
    const batchRef = crypto.randomUUID();

    const drafts = [];
    let skippedDrafted = 0;
    let skippedOrdered = 0;

    for (const row of stockRows) {
      const currentBoxes = Number(row.current_boxes);
      const currentMinLevel = Number(row.current_min_level);

      // Only generate drafts for medications below minimum
      if (currentMinLevel <= 0 || currentBoxes >= currentMinLevel) continue;

      const key = `${row.medication_id}|${row.location_id}`;

      // Skip if already has a pending draft
      if (draftKeys.has(key)) {
        skippedDrafted++;
        continue;
      }

      // Skip if already has a pending order
      if (orderedMedIds.has(row.medication_id)) {
        skippedOrdered++;
        continue;
      }

      // Analyze with intelligence data
      const weeklyUsage = usageByMedLoc[key] || [];
      const itemsPerBox = itemsPerBoxByMed[row.medication_id] || 1;
      const analysis = analyzeMedication(row, weeklyUsage, itemsPerBox);

      // Calculate suggested order quantity (in boxes)
      let suggestedQuantity = currentMinLevel - currentBoxes;

      // Add trend buffer for increasing usage
      if (analysis.usageTrend === 'increasing' && analysis.slope > 0 && itemsPerBox > 0) {
        const slopeInBoxes = analysis.slope / itemsPerBox;
        suggestedQuantity += Math.ceil(Math.abs(slopeInBoxes) * 0.5);
      }

      suggestedQuantity = Math.max(1, suggestedQuantity);

      // Auto-calculate urgency with trend boost
      let urgency;
      if (currentBoxes === 0 || currentBoxes <= currentMinLevel * 0.5) {
        urgency = 'urgent';
      } else {
        urgency = 'routine';
      }

      // Trend boost: increasing usage bumps routine → urgent
      if (analysis.usageTrend === 'increasing' && urgency === 'routine') {
        urgency = 'urgent';
      }

      const intelligenceSnapshot = {
        avgWeeklyUsage: analysis.avgWeeklyUsage,
        usageTrend: analysis.usageTrend,
        confidence: analysis.recommendation.confidence,
        reason: analysis.recommendation.reason,
        weeklyDataPoints: analysis.recommendation.weeklyDataPoints,
        suggestedMinLevel: analysis.recommendation.suggestedMinLevel
      };

      const insertResult = await db.query(
        `INSERT INTO draft_orders
         (medication_id, location_id, current_stock_boxes, min_level_boxes,
          suggested_quantity, urgency, intelligence_snapshot, source,
          status, generated_by, batch_ref)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'auto', 'pending_review', $8, $9)
         RETURNING id, generated_at`,
        [
          row.medication_id,
          row.location_id,
          currentBoxes,
          currentMinLevel,
          suggestedQuantity,
          urgency,
          JSON.stringify(intelligenceSnapshot),
          userId || null,
          batchRef
        ]
      );

      const draft = insertResult.rows[0];
      drafts.push({
        id: draft.id,
        medicationId: row.medication_id,
        medicationName: row.medication_name,
        type: row.type,
        locationId: row.location_id,
        locationName: row.location_name,
        currentStockBoxes: currentBoxes,
        minLevelBoxes: currentMinLevel,
        suggestedQuantity,
        urgency,
        intelligenceSnapshot,
        status: 'pending_review',
        generatedAt: draft.generated_at
      });
    }

    // Log activity
    if (drafts.length > 0) {
      await logActivity({
        userId: userId || null,
        actionType: 'drafts_generated',
        entityType: 'draft_orders',
        details: {
          count: drafts.length,
          batchRef,
          locationId: locationId || 'all',
          skippedAlreadyDrafted: skippedDrafted,
          skippedAlreadyOrdered: skippedOrdered
        }
      });
    }

    return db.ok({
      batchRef,
      drafts,
      skipped: {
        alreadyDrafted: skippedDrafted,
        alreadyOrdered: skippedOrdered
      },
      maturityLevel
    });
  } catch (e) {
    return db.serverError('draft-orders-generate', e);
  }
};
