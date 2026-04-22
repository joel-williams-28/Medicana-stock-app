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

// Query outgoing transfer transactions since the snapshot was generated.
// Each executed transfer creates an 'out' transaction at the source location.
// Result is used by both reconcileTransfers and reconcilePharmacySupplies —
// fetching once and sharing avoids a second round-trip.
async function fetchExecutedTransferRows(snapshotGeneratedAt, queryFn) {
  const result = await queryFn(`
    SELECT batch_id::text AS batch_id,
           location_id AS source_loc,
           medication_id
    FROM transactions
    WHERE type = 'out'
      AND reason LIKE 'Transfer to %'
      AND occurred_at >= $1
  `, [snapshotGeneratedAt]);
  return result.rows;
}

// Build a frequency map from executed transfer rows (same batch+source+med
// could appear multiple times for multi-step movements).
function buildExecutedCountMap(rows) {
  const executed = {};
  for (const row of rows) {
    const key = `${row.batch_id}|${row.source_loc}|${row.medication_id}`;
    executed[key] = (executed[key] || 0) + 1;
  }
  return executed;
}

// Reconcile cached transfers against executed transfers — filter out transfers
// already executed. Uses the transactions table (written inside the DB
// transaction, guaranteed to exist) rather than activity_log (written after
// commit with silent error handling).
function reconcileTransfersSync(transfers, executedRows) {
  if (!transfers || transfers.length === 0) return transfers;
  if (executedRows.length === 0) return transfers;

  const executed = buildExecutedCountMap(executedRows);
  return transfers.filter(t => {
    const key = `${t.batchId}|${t.sourceLoc}|${t.medicationId}`;
    if (executed[key] && executed[key] > 0) {
      executed[key]--;
      return false; // Already executed — filter out
    }
    return true;
  });
}

// Reconcile cached pharmacy supplies against executed transfers. Pharmacy
// supplies also use transferStock, creating 'out' transactions at the pharmacy.
function reconcilePharmacySuppliesSync(supplies, executedRows) {
  if (!supplies || supplies.length === 0) return supplies;
  if (executedRows.length === 0) return supplies;

  const executed = buildExecutedCountMap(executedRows);
  return supplies.filter(s => {
    const key = `${s.batchId}|${s.sourceLoc}|${s.medicationId}`;
    if (executed[key] && executed[key] > 0) {
      executed[key]--;
      return false;
    }
    return true;
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
    const updateSnapshotOnly = params.update_snapshot === 'true'; // Update cached snapshot pipeline data in-place
    const useCurrentMinLevels = params.use_current_mins === 'true'; // Use DB min levels instead of suggested

    // Fetch both intelligence_config keys in a single round trip — these were
    // previously two sequential SELECTs on the same tiny key/value table.
    let lockedUntil = null;
    let completionSummary = null;
    try {
      const configResult = await tdb.query(
        "SELECT key, value FROM intelligence_config WHERE key IN ('pipeline_lock_until', 'pipeline_completion_summary')"
      );
      for (const row of configResult.rows) {
        if (row.key === 'pipeline_lock_until') {
          lockedUntil = row.value;
        } else if (row.key === 'pipeline_completion_summary' && row.value) {
          try { completionSummary = JSON.parse(row.value); } catch (_) {}
        }
      }
    } catch (_) {}
    const isLocked = lockedUntil && new Date(lockedUntil) > new Date();
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
          // items that have already been executed since the snapshot was generated.
          // Fetch the three reconciliation datasets in parallel, and share the
          // executed-transfers query between transfer + pharmacy-supply reconciliation
          // (they filtered the same underlying query twice before).
          if (snapshot.pipeline) {
            const generatedAt = row.generated_at;
            const pipe = snapshot.pipeline;
            const needTransferRows = !!(pipe.transfers?.length || pipe.pharmacySupplies?.length);

            const [executedTransferRows, adjustments, orders] = await Promise.all([
              needTransferRows
                ? fetchExecutedTransferRows(generatedAt, tdb.query)
                : Promise.resolve([]),
              pipe.adjustments
                ? reconcileAdjustments(pipe.adjustments, tdb.query)
                : Promise.resolve(pipe.adjustments),
              pipe.orders
                ? reconcileOrders(pipe.orders, generatedAt, tdb.query)
                : Promise.resolve(pipe.orders)
            ]);

            if (pipe.adjustments) {
              pipe.adjustments = adjustments;
              if (pipe.summary) pipe.summary.totalAdjustments = pipe.adjustments.length;
            }

            if (pipe.transfers) {
              pipe.transfers = reconcileTransfersSync(pipe.transfers, executedTransferRows);
              if (pipe.summary) {
                pipe.summary.totalTransfers = pipe.transfers.length;
                pipe.summary.totalBoxesRedistributed = pipe.transfers.reduce((s, t) => s + (t.quantityBoxes || 0), 0);
              }
            }

            if (pipe.pharmacySupplies) {
              pipe.pharmacySupplies = reconcilePharmacySuppliesSync(pipe.pharmacySupplies, executedTransferRows);
              if (pipe.summary) {
                pipe.summary.totalPharmacySupplies = pipe.pharmacySupplies.length;
                pipe.summary.totalBoxesFromPharmacy = pipe.pharmacySupplies.reduce((s, t) => s + (t.quantityBoxes || 0), 0);
              }
            }

            if (pipe.orders) {
              pipe.orders = orders;
              if (pipe.summary) {
                pipe.summary.totalOrderLines = pipe.orders.filter(o => o.orderQuantityBoxes > 0).length;
                pipe.summary.totalBoxesToOrder = pipe.orders.reduce((s, o) => s + (o.orderQuantityBoxes || 0), 0);
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
      } catch (cacheErr) {
        // Table may not exist yet — fall through to generate
        console.error('[intelligence-report] Cache/reconciliation error:', cacheErr.message);
      }
    }

    // 1. Get maturity info + current stock levels in parallel — neither depends
    // on the other, and they're both required whether or not we short-circuit
    // into the "not configured / collecting" branch below.
    const [maturity, stockRows] = await Promise.all([
      getMaturityInfo(tdb.query),
      getStockLevels(locationId, tdb.query)
    ]);
    const { goLiveDate, weeksOfData, maturityLevel } = maturity;

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

    // 4 & 5. Get weekly usage data + items_per_box mapping in parallel —
    // both are needed to produce recommendations and are independent queries.
    const weeksToAnalyze = Math.min(weeksOfData, 12);
    const [usageByMedLoc, itemsPerBoxByMed] = await Promise.all([
      getWeeklyUsageData(locationId, weeksToAnalyze, tdb.query),
      getItemsPerBoxMap(tdb.query)
    ]);

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

      // Fetch pending orders + batch inventory in parallel — both are needed
      // as inputs to the pipeline and are independent read queries.
      const [pendingResult, batchInventory] = await Promise.all([
        tdb.query(
          `SELECT o.medication_id, COUNT(*)::int AS order_count, SUM(o.quantity)::int AS total_quantity_items
           FROM orders o WHERE o.status = 'pending'
           GROUP BY o.medication_id`
        ),
        getBatchInventory(tdb.query)
      ]);

      const pendingOrderMap = {};
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
      pipeline = runOptimisationPipeline(medications, batchInventory, pendingOrderMap, useCurrentMinLevels);

      // Save pipeline snapshot to database for cross-device access
      // Skip save for internal regenerations (Step 1 advancement) — only save for
      // initial generation (cooldown expired) or explicit admin "Force Regenerate"
      const snapshotData = { goLiveDate, weeksOfData, maturityLevel, medications, aggregated, pipeline };
      lastPipelineRun = new Date().toISOString();
      if (saveSnapshot) {
        try {
          // All four writes (snapshot insert, last-run upsert, completion-summary
          // delete, lock upsert) plus the activity log write are independent —
          // fan them out in parallel so the caller sees a single round-trip cost
          // instead of five sequential ones.
          lockedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
          await Promise.all([
            tdb.query(
              `INSERT INTO pipeline_snapshots (snapshot, generated_at)
               VALUES ($1, $2)`,
              [JSON.stringify(snapshotData), lastPipelineRun]
            ),
            tdb.query(
              `INSERT INTO intelligence_config (key, value, updated_at)
               VALUES ('last_pipeline_run', $1, NOW())
               ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
              [lastPipelineRun]
            ),
            tdb.query("DELETE FROM intelligence_config WHERE key = 'pipeline_completion_summary'"),
            tdb.query(
              `INSERT INTO intelligence_config (key, value, updated_at)
               VALUES ('pipeline_lock_until', $1, NOW())
               ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
              [lockedUntil]
            ),
            logActivity({
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
            })
          ]);
          completionSummary = null;
        } catch (saveErr) {
          console.error('[intelligence-report] Snapshot save failed:', saveErr.message);
        }
      } else if (updateSnapshotOnly && !locationId && pipeline) {
        // Mid-workflow regeneration: update the cached snapshot's pipeline data in-place
        // so that hard resets / device switches return the correct pipeline items.
        // Does NOT touch generated_at, lock, completion summary, or activity log.
        try {
          await tdb.query(
            `UPDATE pipeline_snapshots
             SET snapshot = $1
             WHERE id = (SELECT id FROM pipeline_snapshots ORDER BY generated_at DESC LIMIT 1)`,
            [JSON.stringify(snapshotData)]
          );
          console.log('[intelligence-report] Snapshot pipeline data updated in-place');
        } catch (updateErr) {
          console.error('[intelligence-report] Snapshot pipeline update failed:', updateErr.message);
        }
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
