import test from 'node:test';
import assert from 'node:assert/strict';
import { assessRisk } from '../services/riskEngine.js';
import { getDemoConfig } from '../controllers/floodController.js';

test('assessRisk returns safe classification for low-risk metrics', () => {
  const assessment = assessRisk({
    rainfall: 10,
    waterLevel: 0.4,
    drainageRestriction: 12,
    soilMoisture: 18,
  });

  assert.equal(assessment.classification, 'Safe');
  assert.ok(assessment.score >= 0 && assessment.score <= 100);
});

test('assessRisk returns warning classification for moderate metrics', () => {
  const assessment = assessRisk({
    rainfall: 60,
    waterLevel: 1.2,
    drainageRestriction: 45,
    soilMoisture: 55,
  });

  assert.equal(assessment.classification, 'Warning');
  assert.ok(assessment.score > 39 && assessment.score <= 69);
});

test('assessRisk returns critical classification for high-risk metrics', () => {
  const assessment = assessRisk({
    rainfall: 120,
    waterLevel: 2.6,
    drainageRestriction: 85,
    soilMoisture: 95,
  });

  assert.equal(assessment.classification, 'Critical');
  assert.ok(assessment.score > 69);
});

test('assessRisk clamps missing or invalid metrics to a safe score', () => {
  const assessment = assessRisk({
    rainfall: null,
    waterLevel: undefined,
    drainageRestriction: 'invalid',
    soilMoisture: 10,
  });

  assert.ok(assessment.score >= 0);
  assert.equal(assessment.classification, 'Safe');
});

test('assessRisk treats blank and infinite values as invalid input', () => {
  const assessment = assessRisk({
    rainfall: '',
    waterLevel: '   ',
    drainageRestriction: Number.POSITIVE_INFINITY,
    soilMoisture: 10,
  });

  assert.equal(assessment.classification, 'Safe');
  assert.ok(assessment.warnings.some((warning) => warning.includes('rainfall')));
  assert.ok(assessment.warnings.some((warning) => warning.includes('waterLevel')));
});

test('getDemoConfig reports demo mode only when required APIs are missing', () => {
  const originalOpenWeather = process.env.OPENWEATHER_API_KEY;
  const originalRouteKey = process.env.ORS_API_KEY;

  try {
    delete process.env.OPENWEATHER_API_KEY;
    delete process.env.ORS_API_KEY;
    let config;
    getDemoConfig({ query: {} }, { json: (payload) => { config = payload; } });
    assert.equal(config.demoMode, true);

    process.env.OPENWEATHER_API_KEY = 'demo-weather-key';
    delete process.env.ORS_API_KEY;
    getDemoConfig({ query: {} }, { json: (payload) => { config = payload; } });
    assert.equal(config.demoMode, true);

    process.env.ORS_API_KEY = 'demo-route-key';
    getDemoConfig({ query: {} }, { json: (payload) => { config = payload; } });
    assert.equal(config.demoMode, false);
  } finally {
    if (originalOpenWeather === undefined) delete process.env.OPENWEATHER_API_KEY;
    else process.env.OPENWEATHER_API_KEY = originalOpenWeather;

    if (originalRouteKey === undefined) delete process.env.ORS_API_KEY;
    else process.env.ORS_API_KEY = originalRouteKey;
  }
});
