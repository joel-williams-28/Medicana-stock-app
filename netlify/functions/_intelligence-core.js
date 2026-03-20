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

  return {
    medicationId: row.medication_id,
    medicationName: row.medication_name,
    type: row.type,
    locationId: row.location_id,
    locationName: row.location_name,
    currentBoxes,
    currentQuantity: Number(row.current_quantity),
    currentMinLevel,
    weeklyUsage,
    avgWeeklyUsage: Math.round(avgWeeklyUsageBoxes * 10) / 10,
    usageTrend,
    slope,
    itemsPerBox,
    recommendation: {
      action,
      currentMinLevel,
      suggestedMinLevel,
      confidence: Math.round(confidence * 100) / 100,
      reason,
      weeklyDataPoints: dataPoints
    }
  };
}

module.exports = {
  getMaturityInfo,
  getStockLevels,
  getWeeklyUsageData,
  getItemsPerBoxMap,
  calculateTrend,
  analyzeMedication
};
