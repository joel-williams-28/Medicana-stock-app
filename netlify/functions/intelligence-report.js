// netlify/functions/intelligence-report.js
// Server-side intelligence report generation with full transaction history access
// Supports pipeline snapshot caching with 7-day cooldown
const db = require('./_db');
const { logActivity } = require('./_activity-log');
const {
  getMaturityInfo,
  getStockLevels,
  getWeeklyUsageData,
  getItemsPerBoxMap,
  analyzeMedication,
  getBatchInventory,
  runOptimisationPipeline
} = require('./_intelligence-core');

// Reconcile cached transfers against activity_log — filter out transfers already executed.
async function reconcileTransfers(transfers, snapshotGeneratedAt, queryFn) {
  if (!transfers || transfers.length === 0) return transfers;

  const result = await queryFn(`
    SELECT details->>'batchId' AS batch_id,
           details->>'sourceLocationId' AS source_loc,
           details->>'targetLocationId' AS target_loc,
           entity_id AS medication_id
    FROM activity_log
    WHERE action_type = 'stock_transfer'
      AND details->>'pipelineStep' = 'redistribute'
      AND occurred_at >= $1
  `, [snapshotGeneratedAt]);

  if (result.rows.length === 0) return transfers;

  // Build a set of executed transfer keys for fast lookup
  const executed = new Set();
  for (const row of result.rows) {
    executed.add(`${row.batch_id}|${row.source_loc}|${row.target_loc}|${row.medication_id}`);
  }

  return transfers.filter(t => {
    const key = `${t.batchId}|${t.sourceLoc}|${t.targetLoc}|${t.medicationId}`;
    return !executed.has(key);
  });
}

// Reconcile cached pharmacy supplies against activity_log — filter out supplies already executed.
async function reconcilePharmacySupplies(supplies, snapshotGeneratedAt, queryFn) {
  if (!supplies || supplies.length === 0) return supplies;

  const result = await queryFn(`
    SELECT details->>'batchId' AS batch_id,
           details->>'sourceLocationId' AS source_loc,
           details->>'targetLocationId' AS target_loc,
           entity_id AS medication_id
    FROM activity_log
    WHERE action_type = 'stock_transfer'
      AND details->>'pipelineStep' = 'pharmacy_supply'
      AND occurred_at >= $1
  `, [snapshotGeneratedAt]);

  if (result.rows.length === 0) return supplies;

  const executed = new Set();
  for (const row of result.rows) {
    executed.add(`${row.batch_id}|${row.source_loc}|${row.target_loc}|${row.medication_id}`);
  }

  return supplies.filter(s => {
    const key = `${s.batchId}|${s.sourceLoc}|${s.targetLoc}|${s.medicationId}`;
    return !executed.has(key);
  });
}

// Reconcile cached orders against orders table — filter out orders already created.
async function reconcileOrders(orders, snapshotGeneratedAt, queryFn) {
  if (!orders || orders.length === 0) return orders;

  const result = await queryFn(`
    SELECT medication_id
    FROM orders
    WHERE notes LIKE 'Intelligence pipeline order%'
      AND created_at >= $1
  `, [snapshotGeneratedAt]);

  if (result.rows.length === 0) return orders;

  const orderedMedIds = new Set(result.rows.map(r => r.medication_id));

  return orders.filter(o => !orderedMedIds.has(o.medicationId));
}

// Reconcile cached adjustments against current DB min levels.
// Filters out adjustments that have already been applied (or manually changed).
async function reconcileAdjustments(adjustments, queryFn) {
  if (!adjustments || adjustments.length === 0) return adjustments;

  const medIds = adjustments.map(a => a.medicationId);
  const locIds = adjustments.map(a => a.locationId);

  const result = await queryFn(`
    SELECT t.m_id AS medication_id, t.l_id AS location_id,
           COALESCE(lml.min_level_boxes, m.min_level_boxes, 0) AS current_min_level
    FROM UNNEST($1::text[], $2::text[]) AS t(m_id, l_id)
    JOIN medications m ON m.id = t.m_id
    LEFT JOIN location_min_levels lml
      ON lml.medication_id = t.m_id AND lml.location_id = t.l_id
  `, [medIds, locIds]);

  const currentLevels = {};
  for (const row of result.rows) {
    currentLevels[`${row.medication_id}-${row.location_id}`] = Number(row.current_min_level);
  }

  // Keep only adjustments where the DB still matches the snapshot's currentMinLevel
  // (meaning the adjustment hasn't been applied yet)
  return adjustments.filter(adj => {
    const dbLevel = currentLevels[`${adj.medicationId}-${adj.locationId}`];
    return dbLevel !== undefined && dbLevel === adj.currentMinLevel;
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return db.methodNotAllowed();

  try {
    const tdb = db.forTenant(event);
    if (!tdb) return db.tenantNotFound();

    const params = event.queryStringParameters || {};
    const locationId = params.location_id || null;
    const forceRegenerate = params.force === 'true';
    const saveSnapshot = params.nosave !== 'true'; // Skip snapshot save for Step 1/2/3 internal regeneration
    const useCurrentMinLevels = params.use_current_mins === 'true'; // Use DB min levels instead of suggested

    // Check generation lock status
    let lockedUntil = null;
    try {
      const lockResult = await tdb.query("SELECT value FROM intelligence_config WHERE key = 'pipeline_lock_until'");
      if (lockResult.rows.length > 0) lockedUntil = lockResult.rows[0].value;
    } catch (_) {}
    const isLocked = lockedUntil && new Date(lockedUntil) > new Date();

    // Check for pipeline completion summary
    let completionSummary = null;
    try {
      const csResult = await tdb.query("SELECT value FROM intelligence_config WHERE key = 'pipeline_completion_summary'");
      if (csResult.rows.length > 0 && csResult.rows[0].value) {
        completionSummary = JSON.parse(csResult.rows[0].value);
      }
    } catch (_) {}
    // Only return completion summary while pipeline is locked — once lock expires, clear it
    if (!isLocked && completionSummary) {
      completionSummary = null;
      tdb.query("DELETE FROM intelligence_config WHERE key = 'pipeline_completion_summary'").catch(() => {});
    }

    // For org-wide requests (no locationId), check for cached pipeline snapshot
    if (!locationId && !forceRegenerate) {
      try {
        const cached = await tdb.query(
          `SELECT snapshot, generated_at FROM pipeline_snapshots
           WHERE generated_at > NOW() - INTERVAL '7 days'
           ORDER BY generated_at DESC LIMIT 1`
        );
        if (cached.rows.length > 0) {
          const row = cached.rows[0];
          const snapshot = row.snapshot;

          // Reconcile all pipeline sections against current DB state — filter out
          // items that have already been executed since the snapshot was generated
          if (snapshot.pipeline) {
            const generatedAt = row.generated_at;

            if (snapshot.pipeline.adjustments) {
              snapshot.pipeline.adjustments = await reconcileAdjustments(snapshot.pipeline.adjustments, tdb.query);
              if (snapshot.pipeline.summary) {
                snapshot.pipeline.summary.totalAdjustments = snapshot.pipeline.adjustments.length;
              }
            }

            if (snapshot.pipeline.transfers) {
              snapshot.pipeline.transfers = await reconcileTransfers(snapshot.pipeline.transfers, generatedAt, tdb.query);
              if (snapshot.pipeline.summary) {
                snapshot.pipeline.summary.totalTransfers = snapshot.pipeline.transfers.length;
                snapshot.pipeline.summary.totalBoxesRedistributed = snapshot.pipeline.transfers.reduce((s, t) => s + (t.quantityBoxes || 0), 0);
              }
            }

            if (snapshot.pipeline.pharmacySupplies) {
              snapshot.pipeline.pharmacySupplies = await reconcilePharmacySupplies(snapshot.pipeline.pharmacySupplies, generatedAt, tdb.query);
              if (snapshot.pipeline.summary) {
                snapshot.pipeline.summary.totalPharmacySupplies = snapshot.pipeline.pharmacySupplies.length;
                snapshot.pipeline.summary.totalBoxesFromPharmacy = snapshot.pipeline.pharmacySupplies.reduce((s, t) => s + (t.quantityBoxes || 0), 0);
              }
            }

            if (snapshot.pipeline.orders) {
              snapshot.pipeline.orders = await reconcileOrders(snapshot.pipeline.orders, generatedAt, tdb.query);
              if (snapshot.pipeline.summary) {
                snapshot.pipeline.summary.totalOrderLines = snapshot.pipeline.orders.filter(o => o.orderQuantityBoxes > 0).length;
                snapshot.pipeline.summary.totalBoxesToOrder = snapshot.pipeline.orders.reduce((s, o) => s + (o.orderQuantityBoxes || 0), 0);
              }
            }
          }

          return db.ok({
            ...snapshot,
            lastPipelineRun: row.generated_at.toISOString(),
            lockedUntil: lockedUntil || null,
            completionSummary,
            fromCache: true
          });
        }
      } catch (_) {
        // Table may not exist yet — fall through to generate
      }
    }

    // 1. Get maturity info
    const { goLiveDate, weeksOfData, maturityLevel } = await getMaturityInfo(tdb.query);

    // 2. Get current stock levels
    const stockRows = await getStockLevels(locationId, tdb.query);

    // 3. If not configured or collecting, return early with basic data
    if (maturityLevel === 'not_configured' || maturityLevel === 'collecting') {
      const medications = stockRows.map(row => ({
        medicationId: row.medication_id,
        medicationName: row.medication_name,
        type: row.type,
        locationId: row.location_id,
        locationName: row.location_name,
        currentBoxes: Number(row.current_boxes),
        currentQuantity: Number(row.current_quantity),
        currentMinLevel: Number(row.current_min_level),
        weeklyUsage: [],
        avgWeeklyUsage: 0,
        usageTrend: 'insufficient_data',
        recommendation: {
          action: maturityLevel === 'not_configured' ? 'not_configured' : 'collecting_data',
          currentMinLevel: Number(row.current_min_level),
          suggestedMinLevel: Number(row.current_min_level),
          confidence: 0,
          reason: maturityLevel === 'not_configured'
            ? 'Set a go-live date to begin tracking intelligence data.'
            : 'Collecting data. Recommendations will begin after the first full week.',
          weeklyDataPoints: 0
        }
      }));

      return db.ok({
        goLiveDate,
        weeksOfData,
        maturityLevel,
        daysUntilFirstRecommendation: goLiveDate
          ? Math.max(0, 7 - Math.floor((new Date() - new Date(goLiveDate)) / (1000 * 60 * 60 * 24)))
          : null,
        medications
      });
    }

    // 4. Get weekly usage data
    const weeksToAnalyze = Math.min(weeksOfData, 12);
    const usageByMedLoc = await getWeeklyUsageData(locationId, weeksToAnalyze, tdb.query);

    // 5. Get items_per_box mapping
    const itemsPerBoxByMed = await getItemsPerBoxMap(tdb.query);

    // 6. Generate recommendations for each medication+location
    const medications = stockRows.map(row => {
      const key = `${row.medication_id}|${row.location_id}`;
      const weeklyUsage = usageByMedLoc[key] || [];
      const itemsPerBox = itemsPerBoxByMed[row.medication_id] || 1;
      return analyzeMedication(row, weeklyUsage, itemsPerBox);
    });

    // 7. For "All Locations" — add aggregated min level data and run pipeline
    let aggregated = null;
    let pipeline = null;
    let lastPipelineRun = null;
    if (!locationId) {
      const medGroups = {};
      for (const med of medications) {
        if (!medGroups[med.medicationId]) {
          medGroups[med.medicationId] = {
            medicationId: med.medicationId,
            medicationName: med.medicationName,
            totalMinLevel: 0,
            locationBreakdown: []
          };
        }
        medGroups[med.medicationId].totalMinLevel += med.currentMinLevel;
        medGroups[med.medicationId].locationBreakdown.push({
          locationId: med.locationId,
          locationName: med.locationName,
          minLevel: med.currentMinLevel,
          currentBoxes: med.currentBoxes
        });
      }
      aggregated = Object.values(medGroups);

      // Fetch pending orders BEFORE running the pipeline so it can subtract already-ordered quantities
      let pendingOrderMap = {};
      const pendingResult = await tdb.query(
        `SELECT o.medication_id, COUNT(*)::int AS order_count, SUM(o.quantity)::int AS total_quantity_items
         FROM orders o WHERE o.status = 'pending'
         GROUP BY o.medication_id`
      );
      for (const row of pendingResult.rows) {
        const ipb = itemsPerBoxByMed[row.medication_id] || 1;
        pendingOrderMap[row.medication_id] = {
          count: row.order_count,
          totalQuantityItems: row.total_quantity_items,
          totalQuantityBoxes: Math.floor(row.total_quantity_items / ipb)
        };
      }

      // Run optimisation pipeline (redistribute → order → adjust)
      // When useCurrentMinLevels=true (mid-workflow regeneration after Step 1),
      // use actual DB min levels instead of re-computed suggested levels
      const batchInventory = await getBatchInventory(tdb.query);
      pipeline = runOptimisationPipeline(medications, batchInventory, pendingOrderMap, useCurrentMinLevels);

      // Save pipeline snapshot to database for cross-device access
      // Skip save for internal regenerations (Step 1 advancement) — only save for
      // initial generation (cooldown expired) or explicit admin "Force Regenerate"
      const snapshotData = { goLiveDate, weeksOfData, maturityLevel, medications, aggregated, pipeline };
      lastPipelineRun = new Date().toISOString();
      if (saveSnapshot) {
        try {
          await tdb.query(
            `INSERT INTO pipeline_snapshots (snapshot, generated_at)
             VALUES ($1, $2)`,
            [JSON.stringify(snapshotData), lastPipelineRun]
          );
          // Also update intelligence_config for backward compatibility
          await tdb.query(
            `INSERT INTO intelligence_config (key, value, updated_at)
             VALUES ('last_pipeline_run', $1, NOW())
             ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
            [lastPipelineRun]
          );
          // Clear completion summary on fresh generation
          await tdb.query("DELETE FROM intelligence_config WHERE key = 'pipeline_completion_summary'");
          completionSummary = null;
          // Set 7-day generation lock
          lockedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
          await tdb.query(
            `INSERT INTO intelligence_config (key, value, updated_at)
             VALUES ('pipeline_lock_until', $1, NOW())
             ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
            [lockedUntil]
          );
          // Log pipeline generation event
          await logActivity({
            userId: null,
            actionType: 'pipeline_generated',
            entityType: 'pipeline_snapshot',
            details: {
              medicationCount: medications.length,
              adjustments: pipeline?.summary?.totalAdjustments || 0,
              transfers: pipeline?.summary?.totalTransfers || 0,
              pharmacySupplies: pipeline?.summary?.totalPharmacySupplies || 0,
              orders: pipeline?.summary?.totalOrders || 0,
              forced: forceRegenerate
            },
            queryFn: tdb.query
          });
        } catch (_) { /* non-critical */ }
      }
    } else {
      // For location-specific reports, fetch last pipeline run timestamp
      try {
        const lpResult = await tdb.query("SELECT value FROM intelligence_config WHERE key = 'last_pipeline_run'");
        if (lpResult.rows.length > 0) lastPipelineRun = lpResult.rows[0].value;
      } catch (_) {}
    }

    return db.ok({
      goLiveDate,
      weeksOfData,
      maturityLevel,
      medications,
      aggregated,
      pipeline,
      lastPipelineRun,
      lockedUntil: lockedUntil || null,
      completionSummary
    });
  } catch (e) {
    return db.serverError('intelligence-report', e);
  }
};
