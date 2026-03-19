// netlify/functions/intelligence-report.js
// Server-side intelligence report generation with full transaction history access
const db = require('./_db');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return db.methodNotAllowed();

  try {
    const params = event.queryStringParameters || {};
    const locationId = params.location_id ? parseInt(params.location_id) : null;

    // 1. Read go-live date from intelligence_config
    let goLiveDate = '';
    try {
      const configResult = await db.query(
        "SELECT value FROM intelligence_config WHERE key = 'go_live_date'"
      );
      if (configResult.rows.length > 0) {
        goLiveDate = configResult.rows[0].value || '';
      }
    } catch (e) {
      // Table may not exist yet — treat as not configured
      goLiveDate = '';
    }

    // 2. Calculate weeks of data since go-live
    let weeksOfData = 0;
    let maturityLevel = 'not_configured';

    if (goLiveDate) {
      const goLive = new Date(goLiveDate);
      const now = new Date();
      const diffMs = now - goLive;
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      weeksOfData = Math.floor(diffDays / 7);

      if (diffDays < 0) {
        maturityLevel = 'not_configured'; // Go-live date is in the future
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

    // 3. Get current stock levels and min levels for relevant medications
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

    const stockResult = await db.query(stockQuery, locationId ? [locationId] : []);

    // 4. If not configured or collecting, return early with basic data
    if (maturityLevel === 'not_configured' || maturityLevel === 'collecting') {
      const medications = stockResult.rows.map(row => ({
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

    // 5. Query weekly transaction aggregates (up to 12 weeks back)
    const weeksToAnalyze = Math.min(weeksOfData, 12);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (weeksToAnalyze * 7));

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

    const txResult = await db.query(txQuery, locationId ? [locationId, startDate] : [startDate]);

    // Build lookup: { "medId|locId" => [{ weekStart, totalOut, totalIn }] }
    const usageByMedLoc = {};
    for (const row of txResult.rows) {
      const key = `${row.medication_id}|${row.location_id}`;
      if (!usageByMedLoc[key]) usageByMedLoc[key] = [];
      usageByMedLoc[key].push({
        weekStart: row.week_start.toISOString().slice(0, 10),
        totalOut: Number(row.total_out),
        totalIn: Number(row.total_in)
      });
    }

    // 6. Get items_per_box for each medication (most common value)
    const ipbResult = await db.query(`
      SELECT medication_id, items_per_box
      FROM batches
      WHERE items_per_box IS NOT NULL AND items_per_box > 0
      ORDER BY medication_id
    `);
    const itemsPerBoxByMed = {};
    for (const row of ipbResult.rows) {
      // Use the first (or most common) items_per_box for each medication
      if (!itemsPerBoxByMed[row.medication_id]) {
        itemsPerBoxByMed[row.medication_id] = row.items_per_box;
      }
    }

    // 7. Generate recommendations for each medication+location
    const medications = stockResult.rows.map(row => {
      const key = `${row.medication_id}|${row.location_id}`;
      const weeklyUsage = usageByMedLoc[key] || [];
      const dataPoints = weeklyUsage.length;
      const itemsPerBox = itemsPerBoxByMed[row.medication_id] || 1;

      // Average weekly usage (in items)
      const totalOutAllWeeks = weeklyUsage.reduce((sum, w) => sum + w.totalOut, 0);
      const avgWeeklyUsageItems = dataPoints > 0 ? totalOutAllWeeks / Math.max(dataPoints, 1) : 0;
      const avgWeeklyUsageBoxes = itemsPerBox > 0 ? avgWeeklyUsageItems / itemsPerBox : 0;

      // Trend: linear slope of weekly out-totals
      let usageTrend = 'insufficient_data';
      let slope = 0;
      if (dataPoints >= 2) {
        // Simple linear regression on totalOut values
        const outValues = weeklyUsage.map(w => w.totalOut);
        const n = outValues.length;
        const xMean = (n - 1) / 2;
        const yMean = outValues.reduce((a, b) => a + b, 0) / n;
        let numerator = 0, denominator = 0;
        for (let i = 0; i < n; i++) {
          numerator += (i - xMean) * (outValues[i] - yMean);
          denominator += (i - xMean) * (i - xMean);
        }
        slope = denominator !== 0 ? numerator / denominator : 0;

        // Classify trend relative to average
        const slopePercent = yMean > 0 ? Math.abs(slope) / yMean : 0;
        if (slopePercent < 0.1) {
          usageTrend = 'stable';
        } else if (slope > 0) {
          usageTrend = 'increasing';
        } else {
          usageTrend = 'decreasing';
        }
      } else if (dataPoints === 1) {
        usageTrend = 'stable';
      }

      // Confidence: scales with data points, maxes at 8 weeks
      const confidence = Math.min(1.0, dataPoints / 8);
      const currentMinLevel = Number(row.current_min_level);
      const currentBoxes = Number(row.current_boxes);

      // Recommended min level (in boxes)
      let suggestedMinLevel = currentMinLevel;
      let action = 'maintain';
      let reason = 'Stock levels are appropriate for current usage patterns.';

      if (dataPoints >= 1) {
        // Base: 1.5 weeks of average usage as buffer
        let base = Math.ceil(avgWeeklyUsageBoxes * 1.5);

        // Trend adjustment: if increasing, add extra buffer
        if (usageTrend === 'increasing' && itemsPerBox > 0) {
          const slopeInBoxes = slope / itemsPerBox;
          base += Math.ceil(Math.abs(slopeInBoxes) * 0.5);
        }

        // Low stock detection: check if current stock is frequently below min level
        // Use weeks where usage exceeded a reasonable threshold
        const highUsageWeeks = weeklyUsage.filter(w => {
          const usageBoxes = itemsPerBox > 0 ? w.totalOut / itemsPerBox : 0;
          return usageBoxes > currentMinLevel * 0.8;
        }).length;
        const lowStockRate = dataPoints > 0 ? highUsageWeeks / dataPoints : 0;

        if (lowStockRate > 0.3) {
          base = Math.ceil(base * 1.25);
        }

        // Floor at 1 box if there's any usage, 0 if truly no usage
        if (avgWeeklyUsageItems > 0) {
          suggestedMinLevel = Math.max(1, base);
        } else {
          suggestedMinLevel = 0;
        }

        // Determine action
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
          // Only suggest decrease if no recent high-usage weeks
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
        recommendation: {
          action,
          currentMinLevel,
          suggestedMinLevel,
          confidence: Math.round(confidence * 100) / 100,
          reason,
          weeklyDataPoints: dataPoints
        }
      };
    });

    // 8. For "All Locations" — add aggregated min level data
    let aggregated = null;
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
    }

    return db.json(200, {
      success: true,
      goLiveDate,
      weeksOfData,
      maturityLevel,
      medications,
      aggregated
    });
  } catch (e) {
    return db.serverError('intelligence-report', e);
  }
};
