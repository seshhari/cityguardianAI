const DEFAULT_THRESHOLDS = {
  safeMax: 39,
  warningMax: 69,
};

function clamp(value, min, max) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return min;
  return Math.min(Math.max(numericValue, min), max);
}

function sanitizeNumber(value) {
  if (value === null || value === undefined) {
    return Number.NaN;
  }

  if (typeof value === 'string' && value.trim() === '') {
    return Number.NaN;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : Number.NaN;
}

function normalizeToScale(value, min, max) {
  const numericValue = sanitizeNumber(value);
  if (Number.isNaN(numericValue)) {
    return 0;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return numericValue <= min ? 0 : 100;
  }

  if (numericValue <= min) return 0;
  if (numericValue >= max) return 100;
  return ((numericValue - min) / (max - min)) * 100;
}

function classifyRisk(score, thresholds = DEFAULT_THRESHOLDS) {
  if (score <= thresholds.safeMax) return 'Safe';
  if (score <= thresholds.warningMax) return 'Warning';
  return 'Critical';
}

function buildRiskExplanation(factors, score, classification) {
  const strongest = Object.entries(factors).sort((a, b) => b[1] - a[1])[0];
  const dominantLabel = strongest ? strongest[0] : 'overall conditions';
  const messages = {
    Safe: 'Conditions remain within the demonstration safe range for this zone.',
    Warning: `Elevated ${dominantLabel.toLowerCase()} conditions are pushing this zone into the warning band.`,
    Critical: `Several indicators are elevated, and ${dominantLabel.toLowerCase()} is driving the zone into critical risk.`,
  };

  return `${messages[classification]} Risk score ${score.toFixed(1)}/100.`;
}

export function assessRisk(metrics = {}, thresholds = DEFAULT_THRESHOLDS) {
  if (!metrics || typeof metrics !== 'object') {
    metrics = {};
  }

  const safeMetrics = {
    rainfall: sanitizeNumber(metrics.rainfall),
    waterLevel: sanitizeNumber(metrics.waterLevel),
    drainageRestriction: sanitizeNumber(metrics.drainageRestriction),
    soilMoisture: sanitizeNumber(metrics.soilMoisture),
  };

  const rainfallRisk = normalizeToScale(safeMetrics.rainfall, 0, 120);
  const waterLevelRisk = normalizeToScale(safeMetrics.waterLevel, 0, 2.8);
  const drainageRisk = normalizeToScale(safeMetrics.drainageRestriction, 0, 100);
  const soilRisk = normalizeToScale(safeMetrics.soilMoisture, 0, 100);

  const score = clamp(
    rainfallRisk * 0.35 +
      waterLevelRisk * 0.3 +
      drainageRisk * 0.2 +
      soilRisk * 0.15,
    0,
    100,
  );

  const classification = classifyRisk(score, thresholds);

  const factors = {
    rainfallRisk: Number(rainfallRisk.toFixed(1)),
    waterLevelRisk: Number(waterLevelRisk.toFixed(1)),
    drainageRisk: Number(drainageRisk.toFixed(1)),
    soilSaturationRisk: Number(soilRisk.toFixed(1)),
  };

  return {
    score: Number(score.toFixed(1)),
    classification,
    thresholds,
    factors,
    explanation: buildRiskExplanation(factors, score, classification),
    warnings: Object.entries(metrics)
      .filter(([, value]) => Number.isNaN(sanitizeNumber(value)))
      .map(([key]) => `${key} missing or invalid`),
  };
}

export { DEFAULT_THRESHOLDS };
