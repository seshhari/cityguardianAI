import { assessRisk } from './riskEngine.js';
import { getDemoZones, generateSensorsForZones } from './sensorSimulator.js';

export function buildZoneSummaries() {
  const zones = getDemoZones();
  const sensors = generateSensorsForZones();

  return zones.map((zone, index) => {
    const relevantSensors = sensors.filter((sensor) => sensor.zoneId === zone.id);
    const metrics = {
      rainfall: relevantSensors.find((s) => s.type === 'rainfall')?.value ?? 0,
      waterLevel: relevantSensors.find((s) => s.type === 'water-level')?.value ?? 0,
      drainageRestriction: relevantSensors.find((s) => s.type === 'drainage-restriction')?.value ?? 0,
      soilMoisture: relevantSensors.find((s) => s.type === 'soil-moisture')?.value ?? 0,
      humidity: relevantSensors.find((s) => s.type === 'humidity')?.value ?? 0,
    };

    const risk = assessRisk(metrics);

    return {
      id: zone.id,
      name: zone.name,
      city: zone.city,
      coordinates: zone.coordinates,
      feature: zone.feature,
      altitude: zone.altitude,
      lastUpdated: new Date().toISOString(),
      risk,
      sensors: relevantSensors,
      weather: {
        temperature: 28.6 + index,
        humidity: metrics.humidity,
        condition: risk.classification === 'Safe' ? 'Mild conditions' : 'Elevated risk',
      },
    };
  });
}
