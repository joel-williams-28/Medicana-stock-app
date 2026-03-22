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

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return db.methodNotAllowed();

  try {
    const params = event.queryStringParameters || {};
    const locationId = params.location_id || null;
    const forceRegenerate = params.force === 'true';

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
          return db.json(200, {
            success: true,
            ...row.snapshot,
            lastPipelineRun: row.generated_at.toISOString(),
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
      const batchInventory = await getBatchInventory();
      pipeline = runOptimisationPipeline(medications, batchInventory, pendingOrderMap);

      // Save pipeline snapshot to database for cross-device access
      const snapshotData = { goLiveDate, weeksOfData, maturityLevel, medications, aggregated, pipeline };
      lastPipelineRun = new Date().toISOString();
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
      } catch (_) { /* non-critical */ }
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
      lastPipelineRun
    });
  } catch (e) {
    return db.serverError('intelligence-report', e);
  }
};
