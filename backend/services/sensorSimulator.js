const baseSensors = [
  { id: 'R-101', type: 'rainfall', unit: 'mm/hr', metric: 'rainfall' },
  { id: 'W-201', type: 'water-level', unit: 'm', metric: 'waterLevel' },
  { id: 'S-301', type: 'soil-moisture', unit: '%', metric: 'soilMoisture' },
  { id: 'D-401', type: 'drainage-restriction', unit: '%', metric: 'drainageRestriction' },
  { id: 'H-501', type: 'humidity', unit: '%', metric: 'humidity' },
];

export function getDemoZones() {
  return [
    {
      id: 'zone-1',
      name: 'Centro Guayaquil Basin',
      city: 'Guayaquil',
      coordinates: { latitude: -2.170998, longitude: -79.922359 },
      boundary: 'demo',
      feature: 'Low-lying commercial district',
      altitude: '4 m',
    },
    {
      id: 'zone-2',
      name: 'Urdesa / Estero Salado',
      city: 'Guayaquil',
      coordinates: { latitude: -2.1665, longitude: -79.9075 },
      boundary: 'demo',
      feature: 'Dense residential and drainage channel',
      altitude: '5 m',
    },
    {
      id: 'zone-3',
      name: 'North Industrial Corridor',
      city: 'Guayaquil',
      coordinates: { latitude: -2.145, longitude: -79.914 },
      boundary: 'demo',
      feature: 'Industrial runoff and stormwater pooling',
      altitude: '7 m',
    },
  ];
}

function createReading(sensor, zoneIndex, now) {
  const base = {
    sensorId: sensor.id,
    zoneId: `zone-${zoneIndex + 1}`,
    type: sensor.type,
    value: 0,
    unit: sensor.unit,
    timestamp: now.toISOString(),
    source: 'DEMO DATA',
  };

  const patterns = {
    rainfall: [18, 35, 62, 88, 44],
    'water-level': [0.5, 1.1, 1.5, 2.1, 1.8],
    'soil-moisture': [42, 58, 64, 78, 70],
    'drainage-restriction': [25, 38, 56, 74, 66],
    humidity: [55, 62, 68, 79, 74],
  };

  base.value = patterns[sensor.type][zoneIndex % patterns[sensor.type].length];
  return base;
}

export function generateSensorsForZones() {
  const now = new Date();
  const zones = getDemoZones();

  return zones.flatMap((zone, zoneIndex) =>
    baseSensors.map((sensor) => createReading(sensor, zoneIndex, now)),
  );
}

export function getDemoWeatherSnapshot(city = 'Guayaquil') {
  return {
    city,
    weatherSummary: 'Light rain with cloud cover',
    temperature: 28.6,
    humidity: 76,
    windSpeed: 16.4,
    rainfall: 34,
    condition: 'Rain',
    description: 'Demonstration weather data',
    lastUpdated: new Date().toISOString(),
    source: 'DEMO DATA',
  };
}
