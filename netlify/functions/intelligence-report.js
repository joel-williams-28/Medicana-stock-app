// netlify/functions/intelligence-report.js
// Server-side intelligence report generation with full transaction history access
// Supports pipeline snapshot caching with 7-day cooldown
const db = require('./_db');
const {
  getMaturityInfo,
  getStockLevels,
  getWeeklyUsageData,
  getItemsPerBoxMap,
  analyzeMedication,
  getBatchInventory,
  runOptimisationPipeline
} = require('./_intelligence-core');

// Ensure pipeline_snapshots table exists (auto-create on first use)
let snapshotsTableReady = false;
async function ensureSnapshotsTable() {
  if (snapshotsTableReady) return;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS pipeline_snapshots (
        id SERIAL PRIMARY KEY,
        snapshot JSONB NOT NULL,
        generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        generated_by INT4
      )`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_pipeline_snapshots_generated_at ON pipeline_snapshots (generated_at DESC)`);
    snapshotsTableReady = true;
  } catch (_) { /* non-critical */ }
}

// Reconcile cached adjustments against current DB min levels.
// Filters out adjustments that have already been applied (or manually changed).
async function reconcileAdjustments(adjustments) {
  if (!adjustments || adjustments.length === 0) return adjustments;

  const medIds = adjustments.map(a => a.medicationId);
  const locIds = adjustments.map(a => a.locationId);

  const result = await db.query(`
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
    const params = event.queryStringParameters || {};
    const locationId = params.location_id || null;
    const forceRegenerate = params.force === 'true';
    const saveSnapshot = params.nosave !== 'true'; // Skip snapshot save for Step 1/2/3 internal regeneration
    const useCurrentMinLevels = params.use_current_mins === 'true'; // Use DB min levels instead of suggested

    // Check generation lock status
    let lockedUntil = null;
    try {
      const lockResult = await db.query("SELECT value FROM intelligence_config WHERE key = 'pipeline_lock_until'");
      if (lockResult.rows.length > 0) lockedUntil = lockResult.rows[0].value;
    } catch (_) {}
    const isLocked = lockedUntil && new Date(lockedUntil) > new Date();

    // For org-wide requests (no locationId), check for cached pipeline snapshot
    if (!locationId && !forceRegenerate) {
      try {
        await ensureSnapshotsTable();
        const cached = await db.query(
          `SELECT snapshot, generated_at FROM pipeline_snapshots
           WHERE generated_at > NOW() - INTERVAL '7 days'
           ORDER BY generated_at DESC LIMIT 1`
        );
        if (cached.rows.length > 0) {
          const row = cached.rows[0];
          const snapshot = row.snapshot;

          // Reconcile adjustments against current DB state — filter out
          // adjustments that have already been applied since the snapshot was generated
          if (snapshot.pipeline && snapshot.pipeline.adjustments) {
            snapshot.pipeline.adjustments = await reconcileAdjustments(snapshot.pipeline.adjustments);
            if (snapshot.pipeline.summary) {
              snapshot.pipeline.summary.totalAdjustments = snapshot.pipeline.adjustments.length;
            }
          }

          return db.json(200, {
            success: true,
            ...snapshot,
            lastPipelineRun: row.generated_at.toISOString(),
            lockedUntil: lockedUntil || null,
            fromCache: true
          });
        }
      } catch (_) {
        // Table may not exist yet — fall through to generate
      }
    }

    // 1. Get maturity info
    const { goLiveDate, weeksOfData, maturityLevel } = await getMaturityInfo();

    // 2. Get current stock levels
    const stockRows = await getStockLevels(locationId);

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

      return db.json(200, {
        success: true,
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
    const usageByMedLoc = await getWeeklyUsageData(locationId, weeksToAnalyze);

    // 5. Get items_per_box mapping
    const itemsPerBoxByMed = await getItemsPerBoxMap();

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
      const pendingResult = await db.query(
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
      const batchInventory = await getBatchInventory();
      pipeline = runOptimisationPipeline(medications, batchInventory, pendingOrderMap, useCurrentMinLevels);

      // Save pipeline snapshot to database for cross-device access
      // Skip save for internal regenerations (Step 1 advancement) — only save for
      // initial generation (cooldown expired) or explicit admin "Force Regenerate"
      const snapshotData = { goLiveDate, weeksOfData, maturityLevel, medications, aggregated, pipeline };
      lastPipelineRun = new Date().toISOString();
      if (saveSnapshot) {
        try {
          await ensureSnapshotsTable();
          await db.query(
            `INSERT INTO pipeline_snapshots (snapshot, generated_at)
             VALUES ($1, $2)`,
            [JSON.stringify(snapshotData), lastPipelineRun]
          );
          // Also update intelligence_config for backward compatibility
          await db.query(
            `INSERT INTO intelligence_config (key, value, updated_at)
             VALUES ('last_pipeline_run', $1, NOW())
             ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
            [lastPipelineRun]
          );
          // Set 7-day generation lock
          lockedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
          await db.query(
            `INSERT INTO intelligence_config (key, value, updated_at)
             VALUES ('pipeline_lock_until', $1, NOW())
             ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
            [lockedUntil]
          );
        } catch (_) { /* non-critical */ }
      }
    } else {
      // For location-specific reports, fetch last pipeline run timestamp
      try {
        const lpResult = await db.query("SELECT value FROM intelligence_config WHERE key = 'last_pipeline_run'");
        if (lpResult.rows.length > 0) lastPipelineRun = lpResult.rows[0].value;
      } catch (_) {}
    }

    return db.json(200, {
      success: true,
      goLiveDate,
      weeksOfData,
      maturityLevel,
      medications,
      aggregated,
      pipeline,
      lastPipelineRun,
      lockedUntil: lockedUntil || null
    });
  } catch (e) {
    return db.serverError('intelligence-report', e);
  }
};
