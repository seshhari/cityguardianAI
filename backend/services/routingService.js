import axios from 'axios';

function normalizeRoute(route, index) {
  const steps = route.properties?.segments?.flatMap((segment) => segment.steps || []) || [];
  const summary = route.properties?.summary || route.summary;
  return {
    id: `ors-route-${index + 1}`,
    distanceKm: Number((summary.distance / 1000).toFixed(2)),
    durationMinutes: Number((summary.duration / 60).toFixed(1)),
    geometry: route.geometry,
    directions: steps.map((step, stepIndex) => ({
      step: stepIndex + 1,
      instruction: step.instruction,
      distanceMeters: Math.round(step.distance),
      durationSeconds: Math.round(step.duration),
      roadName: step.name || null,
    })),
  };
}

export async function calculateRoadRoutes(start, destination, { transportMode = 'vehicle' } = {}) {
  const apiKey = process.env.ORS_API_KEY;

  if (!apiKey) {
    return {
      routes: [],
      source: 'UNAVAILABLE',
      error: 'OpenRouteService API key is not configured. No road route was generated.',
    };
  }
  const profile = transportMode === 'walking' ? 'foot-walking' : 'driving-car';
  const directionsUrl = `https://api.openrouteservice.org/v2/directions/${profile}/geojson`;

  try {
    const response = await axios.post(
      directionsUrl,
      {
        coordinates: [
          [Number(start.longitude), Number(start.latitude)],
          [Number(destination.longitude), Number(destination.latitude)],
        ],
        instructions: true,
        alternative_routes: {
          target_count: 3,
          share_factor: 0.6,
          weight_factor: 1.4,
        },
      },
      {
        headers: {
          Authorization: apiKey,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      },
    );

    const routes = response.data?.features;
    if (!Array.isArray(routes) || routes.length === 0) {
      return {
        routes: [],
        source: 'OpenRouteService API',
        error: 'OpenRouteService returned no road-network route.',
      };
    }

    return {
      routes: routes.map(normalizeRoute),
      source: 'OpenRouteService API',
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      routes: [],
      source: 'UNAVAILABLE',
      error: `Road-network routing failed: ${error.response?.data?.error?.message || error.message}`,
    };
  }
}

export async function requestRoute(start, destination) {
  const result = await calculateRoadRoutes(start, destination);
  const route = result.routes[0];
  if (!route) {
    return {
      routeId: null,
      summary: { distance: null, duration: null },
      geometry: null,
      source: result.source,
      warning: result.error || 'No road-network route is available. No fallback route was fabricated.',
    };
  }

  return {
    routeId: route.id,
    summary: {
      distance: route.distanceKm,
      duration: route.durationMinutes,
    },
    geometry: route.geometry,
    directions: route.directions,
    alternatives: result.routes.slice(1),
    source: result.source,
    warning: 'Road-network route calculated, but it has not been verified against current flood or closure conditions.',
  };
}
