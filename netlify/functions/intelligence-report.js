// netlify/functions/intelligence-report.js
// Server-side intelligence report generation with full transaction history access
const db = require('./_db');
const {
  getMaturityInfo,
  getStockLevels,
  getWeeklyUsageData,
  getItemsPerBoxMap,
  analyzeMedication
} = require('./_intelligence-core');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return db.methodNotAllowed();

  try {
    const params = event.queryStringParameters || {};
    const locationId = params.location_id ? parseInt(params.location_id) : null;

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

    // 7. For "All Locations" — add aggregated min level data
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
