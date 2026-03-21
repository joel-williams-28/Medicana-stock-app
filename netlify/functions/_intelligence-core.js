// netlify/functions/_intelligence-core.js
// Shared intelligence logic used by both intelligence-report.js and draft-orders-generate.js
const db = require('./_db');

/**
 * Get go-live date and maturity info from intelligence_config
 */
async function getMaturityInfo() {
  let goLiveDate = '';
  try {
    const configResult = await db.query(
      "SELECT value FROM intelligence_config WHERE key = 'go_live_date'"
    );
    if (configResult.rows.length > 0) {
      goLiveDate = configResult.rows[0].value || '';
    }
  } catch (e) {
    goLiveDate = '';
  }

  let weeksOfData = 0;
  let maturityLevel = 'not_configured';

  if (goLiveDate) {
    const goLive = new Date(goLiveDate);
    const now = new Date();
    const diffMs = now - goLive;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    weeksOfData = Math.floor(diffDays / 7);

    if (diffDays < 0) {
      maturityLevel = 'not_configured';
      weeksOfData = 0;
    } else if (weeksOfData < 1) {
      maturityLevel = 'collecting';
    } else if (weeksOfData <= 3) {
      maturityLevel = 'learning';
    } else if (weeksOfData <= 8) {
      maturityLevel = 'confident';
    } else {
      maturityLevel = 'mature';
    }
  }

  return { goLiveDate, weeksOfData, maturityLevel };
}

/**
 * Get current stock levels and min levels per medication+location
 */
async function getStockLevels(locationId) {
  const stockQuery = locationId
    ? `SELECT
         m.id AS medication_id,
         CASE WHEN m.strength IS NULL OR m.strength = 'N/A' THEN m.name
              ELSE m.name || ' ' || m.strength END AS medication_name,
         m.form AS type,
         l.id AS location_id,
         l.display_name AS location_name,
         COALESCE(lml.min_level_boxes, m.min_level_boxes) AS current_min_level,
         COALESCE(SUM(CASE WHEN b.items_per_box > 0 THEN FLOOR(i.on_hand::DECIMAL / b.items_per_box::DECIMAL) ELSE 0 END), 0) AS current_boxes,
         COALESCE(SUM(i.on_hand), 0) AS current_quantity
       FROM medications m
       JOIN batches b ON b.medication_id = m.id
       JOIN inventory i ON i.batch_id = b.id
       JOIN locations l ON l.id = i.location_id
       LEFT JOIN location_min_levels lml ON lml.medication_id = m.id AND lml.location_id = i.location_id
       WHERE m.is_active = true AND i.location_id = $1 AND i.on_hand > 0
       GROUP BY m.id, m.name, m.strength, m.form, m.min_level_boxes, l.id, l.display_name, lml.min_level_boxes
       ORDER BY m.name`
    : `SELECT
         m.id AS medication_id,
         CASE WHEN m.strength IS NULL OR m.strength = 'N/A' THEN m.name
              ELSE m.name || ' ' || m.strength END AS medication_name,
         m.form AS type,
         l.id AS location_id,
         l.display_name AS location_name,
         COALESCE(lml.min_level_boxes, m.min_level_boxes) AS current_min_level,
         COALESCE(SUM(CASE WHEN b.items_per_box > 0 THEN FLOOR(i.on_hand::DECIMAL / b.items_per_box::DECIMAL) ELSE 0 END), 0) AS current_boxes,
         COALESCE(SUM(i.on_hand), 0) AS current_quantity
       FROM medications m
       JOIN batches b ON b.medication_id = m.id
       JOIN inventory i ON i.batch_id = b.id
       JOIN locations l ON l.id = i.location_id
       LEFT JOIN location_min_levels lml ON lml.medication_id = m.id AND lml.location_id = i.location_id
       WHERE m.is_active = true AND i.on_hand > 0
       GROUP BY m.id, m.name, m.strength, m.form, m.min_level_boxes, l.id, l.display_name, lml.min_level_boxes
       ORDER BY m.name, l.display_name`;

  const result = await db.query(stockQuery, locationId ? [locationId] : []);
  return result.rows;
}

/**
 * Get weekly transaction aggregates for usage analysis
 */
async function getWeeklyUsageData(locationId, weeksBack) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (weeksBack * 7));

  const txQuery = locationId
    ? `SELECT
         t.medication_id,
         t.location_id,
         date_trunc('week', t.occurred_at)::date AS week_start,
         COALESCE(SUM(CASE WHEN t.delta < 0 THEN ABS(t.delta) ELSE 0 END), 0) AS total_out,
         COALESCE(SUM(CASE WHEN t.delta > 0 THEN t.delta ELSE 0 END), 0) AS total_in
       FROM transactions t
       WHERE t.medication_id IS NOT NULL
         AND t.location_id = $1
         AND t.occurred_at >= $2
       GROUP BY t.medication_id, t.location_id, date_trunc('week', t.occurred_at)
       ORDER BY t.medication_id, t.location_id, week_start`
    : `SELECT
         t.medication_id,
         t.location_id,
         date_trunc('week', t.occurred_at)::date AS week_start,
         COALESCE(SUM(CASE WHEN t.delta < 0 THEN ABS(t.delta) ELSE 0 END), 0) AS total_out,
         COALESCE(SUM(CASE WHEN t.delta > 0 THEN t.delta ELSE 0 END), 0) AS total_in
       FROM transactions t
       WHERE t.medication_id IS NOT NULL
         AND t.occurred_at >= $1
       GROUP BY t.medication_id, t.location_id, date_trunc('week', t.occurred_at)
       ORDER BY t.medication_id, t.location_id, week_start`;

  const result = await db.query(txQuery, locationId ? [locationId, startDate] : [startDate]);

  // Build lookup: { "medId|locId" => [{ weekStart, totalOut, totalIn }] }
  const usageByMedLoc = {};
  for (const row of result.rows) {
    const key = `${row.medication_id}|${row.location_id}`;
    if (!usageByMedLoc[key]) usageByMedLoc[key] = [];
    usageByMedLoc[key].push({
      weekStart: row.week_start.toISOString().slice(0, 10),
      totalOut: Number(row.total_out),
      totalIn: Number(row.total_in)
    });
  }
  return usageByMedLoc;
}

/**
 * Get items_per_box for each medication (first known value)
 */
async function getItemsPerBoxMap() {
  const result = await db.query(`
    SELECT medication_id, items_per_box
    FROM batches
    WHERE items_per_box IS NOT NULL AND items_per_box > 0
    ORDER BY medication_id
  `);
  const itemsPerBoxByMed = {};
  for (const row of result.rows) {
    if (!itemsPerBoxByMed[row.medication_id]) {
      itemsPerBoxByMed[row.medication_id] = row.items_per_box;
    }
  }
  return itemsPerBoxByMed;
}

/**
 * Calculate trend from weekly usage data using linear regression
 * Returns { usageTrend, slope }
 */
function calculateTrend(weeklyUsage) {
  const dataPoints = weeklyUsage.length;

  if (dataPoints < 2) {
    return { usageTrend: dataPoints === 1 ? 'stable' : 'insufficient_data', slope: 0 };
  }

  const outValues = weeklyUsage.map(w => w.totalOut);
  const n = outValues.length;
  const xMean = (n - 1) / 2;
  const yMean = outValues.reduce((a, b) => a + b, 0) / n;
  let numerator = 0, denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (i - xMean) * (outValues[i] - yMean);
    denominator += (i - xMean) * (i - xMean);
  }
  const slope = denominator !== 0 ? numerator / denominator : 0;

  const slopePercent = yMean > 0 ? Math.abs(slope) / yMean : 0;
  let usageTrend;
  if (slopePercent < 0.1) {
    usageTrend = 'stable';
  } else if (slope > 0) {
    usageTrend = 'increasing';
  } else {
    usageTrend = 'decreasing';
  }

  return { usageTrend, slope };
}

/**
 * Analyze a single medication+location and produce recommendation data
 */
function analyzeMedication(row, weeklyUsage, itemsPerBox) {
  const dataPoints = weeklyUsage.length;
  const currentMinLevel = Number(row.current_min_level);
  const currentBoxes = Number(row.current_boxes);

  // Average weekly usage
  const totalOutAllWeeks = weeklyUsage.reduce((sum, w) => sum + w.totalOut, 0);
  const avgWeeklyUsageItems = dataPoints > 0 ? totalOutAllWeeks / Math.max(dataPoints, 1) : 0;
  const avgWeeklyUsageBoxes = itemsPerBox > 0 ? avgWeeklyUsageItems / itemsPerBox : 0;

  // Trend
  const { usageTrend, slope } = calculateTrend(weeklyUsage);

  // Confidence
  const confidence = Math.min(1.0, dataPoints / 8);

  // Recommended min level
  let suggestedMinLevel = currentMinLevel;
  let action = 'maintain';
  let reason = 'Stock levels are appropriate for current usage patterns.';

  if (dataPoints >= 1) {
    let base = Math.ceil(avgWeeklyUsageBoxes * 1.5);

    if (usageTrend === 'increasing' && itemsPerBox > 0) {
      const slopeInBoxes = slope / itemsPerBox;
      base += Math.ceil(Math.abs(slopeInBoxes) * 0.5);
    }

    const highUsageWeeks = weeklyUsage.filter(w => {
      const usageBoxes = itemsPerBox > 0 ? w.totalOut / itemsPerBox : 0;
      return usageBoxes > currentMinLevel * 0.8;
    }).length;
    const lowStockRate = dataPoints > 0 ? highUsageWeeks / dataPoints : 0;

    if (lowStockRate > 0.3) {
      base = Math.ceil(base * 1.25);
    }

    if (avgWeeklyUsageItems > 0) {
      suggestedMinLevel = Math.max(1, base);
    } else {
      suggestedMinLevel = 0;
    }

    if (currentBoxes < currentMinLevel && currentMinLevel > 0) {
      action = 'order';
      reason = `Currently below minimum level (${currentBoxes} of ${currentMinLevel} boxes). Order needed.`;
    } else if (suggestedMinLevel > currentMinLevel * 1.2 && currentMinLevel > 0) {
      action = 'increase';
      const pctIncrease = Math.round(((suggestedMinLevel - currentMinLevel) / currentMinLevel) * 100);
      reason = `Usage patterns suggest minimum level should be ${suggestedMinLevel} boxes (+${pctIncrease}%). Average weekly usage: ${Math.round(avgWeeklyUsageBoxes * 10) / 10} boxes/week.`;
      if (usageTrend === 'increasing') {
        reason += ' Usage trend is increasing.';
      }
    } else if (currentMinLevel > 0 && suggestedMinLevel < currentMinLevel * 0.8) {
      const recentHighUsage = weeklyUsage.slice(-4).some(w => {
        const usageBoxes = itemsPerBox > 0 ? w.totalOut / itemsPerBox : 0;
        return usageBoxes > currentMinLevel * 0.6;
      });
      if (!recentHighUsage) {
        action = 'decrease';
        const pctDecrease = Math.round(((currentMinLevel - suggestedMinLevel) / currentMinLevel) * 100);
        reason = `Low weekly usage (avg ${Math.round(avgWeeklyUsageBoxes * 10) / 10} boxes/week). Current minimum of ${currentMinLevel} boxes may be too high. Suggest reducing by ${pctDecrease}%.`;
      }
    } else if (currentMinLevel === 0 && suggestedMinLevel > 0) {
      action = 'increase';
      reason = `No minimum level set. Based on average usage of ${Math.round(avgWeeklyUsageBoxes * 10) / 10} boxes/week, suggest setting minimum to ${suggestedMinLevel} boxes.`;
    }
  }

  // If ordering but min level is too high, re-evaluate: might not need to order at all
  let secondaryAction = null;
  if (action === 'order' && dataPoints >= 1 && currentMinLevel > 0 && suggestedMinLevel < currentMinLevel * 0.8) {
    const recentHighUsage = weeklyUsage.slice(-4).some(w => {
      const usageBoxes = itemsPerBox > 0 ? w.totalOut / itemsPerBox : 0;
      return usageBoxes > currentMinLevel * 0.6;
    });
    if (!recentHighUsage) {
      const pctDecrease = Math.round(((currentMinLevel - suggestedMinLevel) / currentMinLevel) * 100);
      if (currentBoxes >= suggestedMinLevel) {
        // Current stock already meets/exceeds the suggested min — no order needed, just reduce min level
        action = 'decrease';
        reason = `Low weekly usage (avg ${Math.round(avgWeeklyUsageBoxes * 10) / 10} boxes/week). Current minimum of ${currentMinLevel} boxes is too high. Current stock of ${currentBoxes} boxes already exceeds suggested minimum. Suggest reducing by ${pctDecrease}%.`;
      } else {
        // Genuine order still needed, but to reach the lower suggested min, not the inflated current min
        secondaryAction = {
          action: 'decrease',
          suggestedMinLevel,
          reason: `Minimum level of ${currentMinLevel} boxes appears high for current usage (avg ${Math.round(avgWeeklyUsageBoxes * 10) / 10} boxes/week). Consider reducing to ${suggestedMinLevel} ${suggestedMinLevel === 1 ? 'box' : 'boxes'} (-${pctDecrease}%).`
        };
      }
    }
  }

  // Projected stock-out date
  let projectedStockoutDate = null;
  const currentQuantity = Number(row.current_quantity);
  if (avgWeeklyUsageItems > 0 && currentQuantity > 0) {
    const weeksUntilStockout = currentQuantity / avgWeeklyUsageItems;
    if (weeksUntilStockout < 8) {
      const stockoutDate = new Date();
      stockoutDate.setDate(stockoutDate.getDate() + Math.floor(weeksUntilStockout * 7));
      projectedStockoutDate = stockoutDate.toISOString().slice(0, 10);
    }
  }

  // Excess boxes for decrease recommendations
  const excessBoxes = (action === 'decrease' || (secondaryAction && secondaryAction.action === 'decrease'))
    ? Math.max(0, currentMinLevel - suggestedMinLevel)
    : 0;

  return {
    medicationId: row.medication_id,
    medicationName: row.medication_name,
    type: row.type,
    locationId: row.location_id,
    locationName: row.location_name,
    currentBoxes,
    currentQuantity,
    currentMinLevel,
    weeklyUsage,
    avgWeeklyUsage: Math.round(avgWeeklyUsageBoxes * 10) / 10,
    usageTrend,
    slope,
    itemsPerBox,
    projectedStockoutDate,
    recommendation: {
      action,
      currentMinLevel,
      suggestedMinLevel,
      confidence: Math.round(confidence * 100) / 100,
      reason,
      weeklyDataPoints: dataPoints,
      secondaryAction,
      excessBoxes
    }
  };
}

/**
 * Get batch-level inventory with expiry dates for FEFO redistribution
 */
async function getBatchInventory() {
  const result = await db.query(`
    SELECT i.location_id, i.batch_id, b.medication_id, b.expiry_date,
           b.items_per_box, b.batch_code, i.on_hand,
           l.display_name AS location_name,
           CASE WHEN m.strength IS NULL OR m.strength = 'N/A' THEN m.name
                ELSE m.name || ' ' || m.strength END AS medication_name
    FROM inventory i
    JOIN batches b ON b.id = i.batch_id
    JOIN locations l ON l.id = i.location_id
    JOIN medications m ON m.id = b.medication_id
    WHERE m.is_active = true AND i.on_hand > 0
    ORDER BY b.medication_id, i.location_id, b.expiry_date ASC
  `);
  return result.rows;
}

/**
 * Run the 3-step stock optimisation pipeline:
 * 1. Recalculate optimal min levels
 * 2. Redistribute stock (FEFO) from surplus to deficit locations
 * 3. Order remaining shortfall
 */
function runOptimisationPipeline(medications, batchInventory) {
  // Step 1: Build min level map from already-analyzed medications
  const minLevelMap = {};
  for (const med of medications) {
    const key = `${med.medicationId}|${med.locationId}`;
    minLevelMap[key] = {
      medicationId: med.medicationId,
      medicationName: med.medicationName,
      locationId: med.locationId,
      locationName: med.locationName,
      currentBoxes: med.currentBoxes,
      currentMinLevel: med.currentMinLevel,
      suggestedMinLevel: med.recommendation.suggestedMinLevel,
      avgWeeklyUsage: med.avgWeeklyUsage,
      itemsPerBox: med.itemsPerBox
    };
  }

  // Step 2: Redistribute stock (FEFO)
  // Group batch inventory by medication → location → batches
  const batchesByMedLoc = {};
  for (const row of batchInventory) {
    const medKey = row.medication_id;
    if (!batchesByMedLoc[medKey]) batchesByMedLoc[medKey] = {};
    const locKey = row.location_id;
    if (!batchesByMedLoc[medKey][locKey]) batchesByMedLoc[medKey][locKey] = [];
    batchesByMedLoc[medKey][locKey].push({
      batchId: row.batch_id,
      batchCode: row.batch_code,
      onHand: Number(row.on_hand),
      expiryDate: row.expiry_date ? row.expiry_date.toISOString ? row.expiry_date.toISOString().slice(0, 10) : String(row.expiry_date).slice(0, 10) : null,
      itemsPerBox: Number(row.items_per_box) || 1,
      locationName: row.location_name,
      medicationName: row.medication_name
    });
  }

  // Build simulated stock (boxes) per medication+location
  const simulatedBoxes = {};
  for (const key in minLevelMap) {
    simulatedBoxes[key] = minLevelMap[key].currentBoxes;
  }

  const transfers = [];

  // Get unique medication IDs that have min level data
  const medicationIds = [...new Set(medications.map(m => m.medicationId))];

  for (const medId of medicationIds) {
    const medLocations = medications.filter(m => m.medicationId === medId);
    if (medLocations.length < 2) continue; // Need at least 2 locations to redistribute

    // Identify surplus and deficit locations using suggested min levels
    const surplusLocs = [];
    const deficitLocs = [];
    for (const loc of medLocations) {
      const key = `${medId}|${loc.locationId}`;
      const suggested = minLevelMap[key].suggestedMinLevel;
      const current = simulatedBoxes[key];
      if (current > suggested) {
        surplusLocs.push({ ...loc, excess: current - suggested });
      } else if (current < suggested) {
        deficitLocs.push({ ...loc, shortfall: suggested - current });
      }
    }

    if (surplusLocs.length === 0 || deficitLocs.length === 0) continue;

    // Sort deficit by highest usage first (they consume soonest-expiring stock fastest)
    deficitLocs.sort((a, b) => b.avgWeeklyUsage - a.avgWeeklyUsage);

    for (const deficit of deficitLocs) {
      const deficitKey = `${medId}|${deficit.locationId}`;
      let remaining = minLevelMap[deficitKey].suggestedMinLevel - simulatedBoxes[deficitKey];
      if (remaining <= 0) continue;

      // Collect all batches from surplus locations, sorted by expiry ASC (FEFO)
      const availableBatches = [];
      for (const surplus of surplusLocs) {
        const surplusKey = `${medId}|${surplus.locationId}`;
        const locBatches = batchesByMedLoc[medId]?.[surplus.locationId] || [];
        for (const batch of locBatches) {
          if (batch.onHand <= 0) continue;
          // Only offer stock that keeps surplus above its suggested min
          availableBatches.push({
            ...batch,
            sourceLocId: surplus.locationId,
            sourceLocName: surplus.locationName,
            surplusKey
          });
        }
      }

      // Sort by expiry date ascending (FEFO — soonest expiry first)
      availableBatches.sort((a, b) => {
        if (!a.expiryDate && !b.expiryDate) return 0;
        if (!a.expiryDate) return 1;
        if (!b.expiryDate) return -1;
        return a.expiryDate.localeCompare(b.expiryDate);
      });

      for (const batch of availableBatches) {
        if (remaining <= 0) break;

        // Check surplus location still has excess
        const surplusSimulated = simulatedBoxes[batch.surplusKey];
        const surplusSuggested = minLevelMap[batch.surplusKey].suggestedMinLevel;
        const surplusExcess = surplusSimulated - surplusSuggested;
        if (surplusExcess <= 0) continue;

        // How many items can we transfer from this batch?
        const ipb = batch.itemsPerBox || 1;
        const batchBoxes = Math.floor(batch.onHand / ipb);
        const transferBoxes = Math.min(batchBoxes, remaining, surplusExcess);
        if (transferBoxes <= 0) continue;

        const transferItems = transferBoxes * ipb;

        transfers.push({
          medicationId: medId,
          medicationName: batch.medicationName,
          sourceLoc: batch.sourceLocId,
          sourceLocName: batch.sourceLocName,
          targetLoc: deficit.locationId,
          targetLocName: deficit.locationName,
          batchId: batch.batchId,
          batchCode: batch.batchCode,
          quantity: transferItems,
          quantityBoxes: transferBoxes,
          expiryDate: batch.expiryDate,
          itemsPerBox: ipb
        });

        // Update simulated inventory
        batch.onHand -= transferItems;
        simulatedBoxes[batch.surplusKey] -= transferBoxes;
        simulatedBoxes[deficitKey] += transferBoxes;
        remaining -= transferBoxes;
      }
    }
  }

  // Step 3: Order remaining shortfall (after simulated redistribution)
  const orders = [];
  for (const key in minLevelMap) {
    const entry = minLevelMap[key];
    const simulated = simulatedBoxes[key];
    const suggested = entry.suggestedMinLevel;
    if (simulated < suggested && suggested > 0) {
      const shortfall = suggested - simulated;
      orders.push({
        medicationId: entry.medicationId,
        medicationName: entry.medicationName,
        locationId: entry.locationId,
        locationName: entry.locationName,
        orderQuantityBoxes: shortfall,
        urgency: simulated === 0 || simulated <= suggested * 0.5 ? 'urgent' : 'routine',
        currentSimulatedBoxes: simulated,
        suggestedMinLevel: suggested
      });
    }
  }

  // Step 4: Min level adjustments
  const adjustments = [];
  for (const key in minLevelMap) {
    const entry = minLevelMap[key];
    if (entry.suggestedMinLevel !== entry.currentMinLevel) {
      adjustments.push({
        medicationId: entry.medicationId,
        medicationName: entry.medicationName,
        locationId: entry.locationId,
        locationName: entry.locationName,
        currentMinLevel: entry.currentMinLevel,
        suggestedMinLevel: entry.suggestedMinLevel,
        direction: entry.suggestedMinLevel > entry.currentMinLevel ? 'increase' : 'decrease',
        changeBoxes: Math.abs(entry.suggestedMinLevel - entry.currentMinLevel)
      });
    }
  }

  return {
    transfers,
    orders,
    adjustments,
    summary: {
      totalTransfers: transfers.length,
      totalOrderLines: orders.length,
      totalAdjustments: adjustments.length,
      totalBoxesRedistributed: transfers.reduce((sum, t) => sum + t.quantityBoxes, 0),
      totalBoxesToOrder: orders.reduce((sum, o) => sum + o.orderQuantityBoxes, 0)
    }
  };
}

module.exports = {
  getMaturityInfo,
  getStockLevels,
  getWeeklyUsageData,
  getItemsPerBoxMap,
  calculateTrend,
  analyzeMedication,
  getBatchInventory,
  runOptimisationPipeline
};
