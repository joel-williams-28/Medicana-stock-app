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
    const tdb = db.forTenant(event);
    if (!tdb) return db.tenantNotFound();

    const { userId, locationId } = db.parseBody(event);

    // Fetch maturity, stock levels, items-per-box, and existing drafts/orders
    // in parallel — all four are independent reads. Weekly usage depends on
    // maturity so we bump it to a second phase, but the initial fan-out is the
    // dominant slice of latency.
    const [
      { weeksOfData, maturityLevel },
      stockRows,
      itemsPerBoxByMed,
      existingResult
    ] = await Promise.all([
      getMaturityInfo(tdb.query),
      getStockLevels(locationId || null, tdb.query),
      getItemsPerBoxMap(tdb.query),
      tdb.query(`
        SELECT DISTINCT medication_id, 'draft' AS source FROM draft_orders WHERE status = 'pending_review'
        UNION
        SELECT DISTINCT medication_id, 'order' AS source FROM orders WHERE status = 'pending'
      `)
    ]);

    // Get usage data (if mature enough)
    const weeksToAnalyze = Math.min(Math.max(weeksOfData, 1), 12);
    const usageByMedLoc = (maturityLevel !== 'not_configured' && maturityLevel !== 'collecting')
      ? await getWeeklyUsageData(locationId || null, weeksToAnalyze, tdb.query)
      : {};

    // Aggregate stock rows by medication_id (sum boxes across all locations)
    // This prevents duplicate drafts when a medication exists at multiple locations
    const medMap = new Map();
    for (const row of stockRows) {
      const medId = row.medication_id;
      if (!medMap.has(medId)) {
        medMap.set(medId, {
          medication_id: medId,
          medication_name: row.medication_name,
          type: row.type,
          total_boxes: 0,
          max_min_level: 0,
          location_keys: []  // for aggregating usage data
        });
      }
      const agg = medMap.get(medId);
      agg.total_boxes += Number(row.current_boxes);
      // Use the highest min level across locations (or the global one)
      const minLevel = Number(row.current_min_level);
      if (minLevel > agg.max_min_level) agg.max_min_level = minLevel;
      // Track location keys for usage aggregation
      agg.location_keys.push(`${medId}|${row.location_id}`);
    }

    // Split the existing-drafts/orders rows (already fetched above) into two
    // lookup sets. Walking the rows once avoids two .filter+.map passes.
    const draftedMedIds = new Set();
    const orderedMedIds = new Set();
    for (const row of existingResult.rows) {
      if (row.source === 'draft') draftedMedIds.add(row.medication_id);
      else if (row.source === 'order') orderedMedIds.add(row.medication_id);
    }

    // Generate batch reference
    const batchRef = crypto.randomUUID();

    const drafts = [];
    let skippedDrafted = 0;
    let skippedOrdered = 0;

    for (const [medId, agg] of medMap) {
      const currentBoxes = agg.total_boxes;
      const currentMinLevel = agg.max_min_level;

      // Only generate drafts for medications below minimum
      if (currentMinLevel <= 0 || currentBoxes >= currentMinLevel) continue;

      // Skip if already has a pending draft for this medication
      if (draftedMedIds.has(medId)) {
        skippedDrafted++;
        continue;
      }

      // Skip if already has a pending order
      if (orderedMedIds.has(medId)) {
        skippedOrdered++;
        continue;
      }

      // Aggregate usage data across all locations for this medication
      let combinedUsage = [];
      for (const locKey of agg.location_keys) {
        const locUsage = usageByMedLoc[locKey] || [];
        if (combinedUsage.length === 0) {
          combinedUsage = locUsage.map(w => ({ ...w }));
        } else {
          for (let i = 0; i < locUsage.length; i++) {
            if (i < combinedUsage.length) {
              combinedUsage[i].total_used = (combinedUsage[i].total_used || 0) + (locUsage[i].total_used || 0);
            } else {
              combinedUsage.push({ ...locUsage[i] });
            }
          }
        }
      }

      // Analyze with aggregated intelligence data
      const itemsPerBox = itemsPerBoxByMed[medId] || 1;
      const analysis = analyzeMedication(
        { current_boxes: currentBoxes, current_min_level: currentMinLevel },
        combinedUsage,
        itemsPerBox
      );

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

      // Trend boost: increasing usage bumps routine -> urgent
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

      // Insert with location_id as NULL (org-wide order)
      const insertResult = await tdb.query(
        `INSERT INTO draft_orders
         (medication_id, location_id, current_stock_boxes, min_level_boxes,
          suggested_quantity, urgency, intelligence_snapshot, source,
          status, generated_by, batch_ref)
         VALUES ($1, NULL, $2, $3, $4, $5, $6, 'auto', 'pending_review', $7, $8)
         RETURNING id, generated_at`,
        [
          medId,
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
        medicationId: medId,
        medicationName: agg.medication_name,
        type: agg.type,
        locationId: null,
        locationName: 'All Locations',
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
        },
        queryFn: tdb.query
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
