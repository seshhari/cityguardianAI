import { fetchWeather } from '../services/weatherService.js';
import { buildZoneSummaries } from '../services/dataFusion.js';
import { getDemoZones, generateSensorsForZones } from '../services/sensorSimulator.js';
import { requestRoute } from '../services/routingService.js';
import { generateAlerts, getAlertFeed, acknowledgeAlert, getUnreadAlertCount } from '../services/alertService.js';

export async function getHealth(req, res) {
  res.json({
    status: 'ok',
    service: 'City Guardian AI',
    uptimeSeconds: process.uptime(),
    demoMode: !process.env.OPENWEATHER_API_KEY || !process.env.ORS_API_KEY,
    timestamp: new Date().toISOString(),
  });
}

export async function getWeather(req, res) {
  const city = typeof req.query.city === 'string' ? req.query.city : 'Guayaquil';
  const weather = await fetchWeather(city);
  res.json(weather);
}

export async function getZones(req, res) {
  const zones = buildZoneSummaries();
  res.json({
    zones,
    summary: {
      total: zones.length,
      safe: zones.filter((zone) => zone.risk.classification === 'Safe').length,
      warning: zones.filter((zone) => zone.risk.classification === 'Warning').length,
      critical: zones.filter((zone) => zone.risk.classification === 'Critical').length,
    },
  });
}

export function getSensors(req, res) {
  const sensors = generateSensorsForZones();
  res.json({ sensors, source: 'DEMO DATA' });
}

export function getRisk(req, res) {
  const zones = buildZoneSummaries();
  const alerts = generateAlerts(zones);
  res.json({
    zones,
    generatedAlerts: alerts,
    summary: {
      total: zones.length,
      safe: zones.filter((zone) => zone.risk.classification === 'Safe').length,
      warning: zones.filter((zone) => zone.risk.classification === 'Warning').length,
      critical: zones.filter((zone) => zone.risk.classification === 'Critical').length,
    },
  });
}

export function listAlerts(req, res) {
  const alerts = getAlertFeed();
  res.json({
    alerts,
    unreadCount: getUnreadAlertCount(),
  });
}

export function acknowledgeAlertRoute(req, res) {
  const { alertId } = req.body || {};

  if (!alertId || typeof alertId !== 'string') {
    return res.status(400).json({ error: 'A valid alertId is required.' });
  }

  const result = acknowledgeAlert(alertId);
  if (!result.acknowledged) {
    return res.status(404).json({ error: result.message });
  }

  return res.json({ ok: true, ...result });
}

export async function getRoutes(req, res) {
  const { start, destination } = req.body || {};

  if (!start || !destination) {
    return res.status(400).json({ error: 'Both start and destination coordinates are required.' });
  }

  const route = await requestRoute(start, destination);
  return res.json(route);
}

export function getAnalytics(req, res) {
  const zones = buildZoneSummaries();

  res.json({
    summary: {
      monitoredZones: zones.length,
      safeZones: zones.filter((zone) => zone.risk.classification === 'Safe').length,
      warningZones: zones.filter((zone) => zone.risk.classification === 'Warning').length,
      criticalZones: zones.filter((zone) => zone.risk.classification === 'Critical').length,
      activeAlerts: getUnreadAlertCount(),
      latestWeatherUpdate: new Date().toISOString(),
    },
    rainfallTrend: zones.map((zone, index) => ({
      label: `Zone ${index + 1}`,
      rainfall: zone.sensors.find((sensor) => sensor.type === 'rainfall')?.value ?? 0,
    })),
    riskDistribution: [
      { label: 'Safe', value: zones.filter((zone) => zone.risk.classification === 'Safe').length },
      { label: 'Warning', value: zones.filter((zone) => zone.risk.classification === 'Warning').length },
      { label: 'Critical', value: zones.filter((zone) => zone.risk.classification === 'Critical').length },
    ],
    riskHistory: zones.map((zone, index) => ({
      label: `Zone ${index + 1}`,
      score: zone.risk.score,
    })),
    source: 'DEMO DATA',
  });
}

export function getDemoConfig(req, res) {
  const openWeatherConfigured = Boolean(process.env.OPENWEATHER_API_KEY);
  const routeServiceConfigured = Boolean(process.env.ORS_API_KEY);

  res.json({
    openWeatherConfigured,
    routeServiceConfigured,
    demoMode: !openWeatherConfigured || !routeServiceConfigured,
    zones: getDemoZones(),
  });
}
