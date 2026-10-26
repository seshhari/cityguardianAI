import fs from 'node:fs/promises';
import path from 'node:path';
import axios from 'axios';
import { fileURLToPath } from 'node:url';
import { buildZoneSummaries } from './dataFusion.js';
import { listFloodIncidents, listRescueTeams, validateRouteSafety } from './rescueDispatchService.js';
import { calculateRoadRoutes } from './routingService.js';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const now = () => new Date().toISOString();
const HIGH_RISK_THRESHOLD = Number(process.env.HIGH_RISK_THRESHOLD || 70);
const CRITICAL_RISK_THRESHOLD = Number(process.env.CRITICAL_RISK_THRESHOLD || 85);
const DANGEROUS_WATER_DEPTH_METERS = Number(process.env.DANGEROUS_WATER_DEPTH_METERS || 0.5);
const CRITICAL_BLOCKED_ROADS_THRESHOLD = Number(process.env.CRITICAL_BLOCKED_ROADS_THRESHOLD || 2);
const ROAD_DATA_MAX_AGE_MS = Number(process.env.ROAD_CONDITION_MAX_AGE_MS || 15 * 60 * 1000);
const SMS_GATEWAY_URL = process.env.SMS_GATEWAY_URL || '';

const shelters = [
  {
    id: 'DEMO-SH-001',
    name: 'Guayaquil Civic Centre Shelter (training)',
    coordinates: { latitude: -2.1894, longitude: -79.8891 },
    capacity: 120,
    occupied: 42,
    facilities: ['first aid (demo)', 'accessible entrance (demo)', 'water (demo)'],
    status: 'OPEN',
    lastVerifiedAt: null,
    isDemoData: true,
    source: 'DEMO DATA — capacity and facilities are not verified.',
  },
  {
    id: 'DEMO-SH-002',
    name: 'Kennedy North Shelter (training)',
    coordinates: { latitude: -2.166, longitude: -79.897 },
    capacity: 80,
    occupied: 24,
    facilities: ['first aid (demo)', 'sanitation (demo)'],
    status: 'OPEN',
    lastVerifiedAt: null,
    isDemoData: true,
    source: 'DEMO DATA — capacity and facilities are not verified.',
  },
];
const roadClosures = [];
const evacuationOrders = [];
const smsMessages = [];
let smsSequence = 0;

function validateCoordinates(coordinates) {
  return coordinates
    && Number.isFinite(Number(coordinates.latitude))
    && Number(coordinates.latitude) >= -90
    && Number(coordinates.latitude) <= 90
    && Number.isFinite(Number(coordinates.longitude))
    && Number(coordinates.longitude) >= -180
    && Number(coordinates.longitude) <= 180;
}

function isFresh(timestamp, maxAgeMs = ROAD_DATA_MAX_AGE_MS) {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) && parsed <= Date.now() && Date.now() - parsed <= maxAgeMs;
}

function usableShelter(shelter) {
  return shelter.status === 'OPEN'
    && Number.isFinite(shelter.capacity)
    && Number.isFinite(shelter.occupied)
    && shelter.capacity > shelter.occupied
    && !shelter.isDemoData
    && isFresh(shelter.lastVerifiedAt);
}

function edgeTouchesClosure(edge, activeHazards) {
  const edgeCoordinates = Array.isArray(edge.geometry)
    ? edge.geometry
    : edge.geometry?.coordinates;
  const edgeGeometry = edge.geometry?.type
    ? edge.geometry
    : Array.isArray(edgeCoordinates)
      ? { type: 'LineString', coordinates: edgeCoordinates }
      : null;
  return activeHazards.some((road) => (
    road.roadSegmentId === edge.id
    || (edge.name && road.name.toLowerCase() === edge.name.toLowerCase())
    || (edgeGeometry && road.geometry && routeIntersectsGeometry(edgeGeometry, road.geometry))
  ));
}

function routeIntersectsGeometry(routeGeometry, hazardGeometry) {
  const routeLines = routeGeometry?.type === 'LineString'
    ? [routeGeometry.coordinates]
    : routeGeometry?.type === 'MultiLineString'
      ? routeGeometry.coordinates
      : [];
  const hazardLines = hazardGeometry?.type === 'LineString'
    ? [hazardGeometry.coordinates]
    : hazardGeometry?.type === 'MultiLineString'
      ? hazardGeometry.coordinates
      : [];
  const orientation = (p, q, r) => Math.sign(
    (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]),
  );
  return routeLines.some((routeLine) => hazardLines.some((hazardLine) => (
    routeLine.some((point, index) => index > 0 && hazardLine.some((hazardPoint, hazardIndex) => {
      if (hazardIndex === 0) return false;
      const a = routeLine[index - 1];
      const b = point;
      const c = hazardLine[hazardIndex - 1];
      const d = hazardPoint;
      return orientation(a, b, c) !== orientation(a, b, d)
        && orientation(c, d, a) !== orientation(c, d, b);
    }))
  )));
}

async function validateEvacuationRoute(route) {
  const activeHazards = roadClosures.filter((road) => (
    road.verified && road.status !== 'OPEN' && isFresh(road.lastVerifiedAt)
  ));
  const missingGeometry = activeHazards.filter((road) => !road.geometry);
  const intersecting = activeHazards.filter((road) => road.geometry
    && routeIntersectsGeometry(route.geometry, road.geometry));
  if (intersecting.length) {
    return {
      status: 'UNSAFE',
      verified: false,
      checkedAt: now(),
      excludedRoadSegments: intersecting.map((road) => ({
        id: road.id,
        name: road.name,
        status: road.status,
        geometry: road.geometry,
      })),
      reason: 'Route crosses an operator-verified blocked or hazardous road segment.',
    };
  }
  const providerResult = await validateRouteSafety(route);
  if (missingGeometry.length && providerResult.status === 'VERIFIED_SAFE') {
    return {
      status: 'UNVERIFIED',
      verified: false,
      checkedAt: providerResult.checkedAt,
      excludedRoadSegments: missingGeometry.map((road) => ({
        id: road.id,
        name: road.name,
        status: road.status,
      })),
      reason: 'A verified road closure has no geometry, so route intersection cannot be ruled out.',
    };
  }
  return providerResult;
}

function verifiedIncident(incident) {
  return !incident.isDemoData && incident.verificationStatus === 'VERIFIED';
}

function detectEvacuationState() {
  const allIncidents = listFloodIncidents();
  const realIncidents = allIncidents.filter(verifiedIncident);
  const verifiedClosures = roadClosures.filter((road) => (
    road.status === 'CLOSED'
    && road.severity === 'CRITICAL'
    && road.verified === true
    && isFresh(road.lastVerifiedAt)
  ));
  const criticalIncidents = realIncidents.filter((incident) => (
    incident.riskScore >= CRITICAL_RISK_THRESHOLD
    || (incident.estimatedWaterDepthMeters ?? 0) >= DANGEROUS_WATER_DEPTH_METERS
  ));
  const highIncidents = realIncidents.filter((incident) => incident.riskScore >= HIGH_RISK_THRESHOLD);

  let status = 'CLEAR';
  let reasons = [];
  if (criticalIncidents.length || verifiedClosures.length >= CRITICAL_BLOCKED_ROADS_THRESHOLD) {
    status = 'EMERGENCY';
    if (criticalIncidents.length) reasons.push('Verified critical flood severity or dangerous water depth.');
    if (verifiedClosures.length >= CRITICAL_BLOCKED_ROADS_THRESHOLD) reasons.push('Multiple verified critical road closures.');
  } else if (highIncidents.length || verifiedClosures.length > 0) {
    status = 'EVACUATE';
    if (highIncidents.length) reasons.push('Verified flood incident exceeds the high-risk threshold.');
    if (verifiedClosures.length) reasons.push('Verified critical road closure reported.');
  } else {
    const demoHighZones = buildZoneSummaries().filter((zone) => zone.risk.score >= HIGH_RISK_THRESHOLD);
    if (demoHighZones.length) {
      status = 'WATCH';
      reasons.push('DEMO DATA only: simulated zone indicators exceed the watch threshold; no real flood observation is available.');
    } else {
      reasons.push('No verified evacuation trigger is active.');
    }
  }

  return {
    status,
    reasons,
    affectedIncidents: realIncidents,
    affectedZones: realIncidents.map((incident) => ({
      id: incident.id,
      name: incident.location,
      severity: incident.severity,
      riskScore: incident.riskScore,
      waterDepthMeters: incident.estimatedWaterDepthMeters,
      coordinates: incident.coordinates,
      verificationStatus: incident.verificationStatus,
    })),
    verifiedCriticalBlockedRoadCount: verifiedClosures.length,
    criticalBlockedRoadThreshold: CRITICAL_BLOCKED_ROADS_THRESHOLD,
    generatedAt: now(),
    source: realIncidents.length || verifiedClosures.length ? 'VERIFIED OPERATOR DATA' : 'MIXED; DEMO WATCH DATA LABELLED',
  };
}

function getOfflineGraphFile() {
  const configured = process.env.OFFLINE_ROAD_GRAPH_PATH;
  if (!configured) return null;
  return path.isAbsolute(configured) ? configured : path.resolve(moduleDirectory, '..', '..', configured);
}

function distanceMeters(a, b) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const deltaLat = radians(b.latitude - a.latitude);
  const deltaLon = radians(b.longitude - a.longitude);
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const haversine = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function nearestGraphNode(graph, coordinates) {
  return graph.nodes.reduce((nearest, node) => {
    const distance = distanceMeters(coordinates, node);
    return !nearest || distance < nearest.distance
      ? { node, distance }
      : nearest;
  }, null);
}

export async function calculateOfflineRoutes(start, destination, transportMode = 'vehicle') {
  const graphFile = getOfflineGraphFile();
  if (!graphFile) return { routes: [], source: 'UNAVAILABLE', error: 'No offline road graph is configured.' };

  let graph;
  try {
    graph = JSON.parse(await fs.readFile(graphFile, 'utf8'));
  } catch (error) {
    return {
      routes: [],
      source: 'UNAVAILABLE',
      error: `Configured offline road graph could not be read: ${error.message}`,
    };
  }

  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || !graph.checkedAt || !isFresh(graph.checkedAt)) {
    return {
      routes: [],
      source: 'UNAVAILABLE',
      error: 'Offline road graph is malformed or stale.',
    };
  }
  if (graph.coverageComplete !== true || graph.city !== 'Guayaquil') {
    return {
      routes: [],
      source: 'UNAVAILABLE',
      error: 'Offline road graph must declare complete Guayaquil coverage.',
    };
  }

  const nodes = new Map(graph.nodes.filter((node) => typeof node.id === 'string' && validateCoordinates(node))
    .map((node) => [node.id, node]));
  const activeHazards = roadClosures.filter((road) => (
    road.verified && road.status !== 'OPEN' && isFresh(road.lastVerifiedAt)
  ));
  if (activeHazards.some((road) => !road.geometry && !road.roadSegmentId)) {
    return {
      routes: [],
      source: 'OFFLINE GRAPH',
      error: 'NO VERIFIED SAFE ROUTE: an active road hazard has no segment geometry or road ID for offline exclusion.',
    };
  }
  const adjacency = new Map([...nodes.keys()].map((id) => [id, []]));
  for (const edge of graph.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to) || edge.verified !== true
      || edge.status !== 'OPEN' || !isFresh(edge.checkedAt || graph.checkedAt)) continue;
    if (edgeTouchesClosure(edge, activeHazards)) continue;
    if (transportMode === 'vehicle' && edge.vehicleAccessible === false) continue;
    if (transportMode === 'walking' && edge.walkingAccessible === false) continue;
    const distance = Number(edge.distanceMeters);
    const duration = Number(edge.durationSeconds);
    if (!Number.isFinite(distance) || distance <= 0 || !Number.isFinite(duration) || duration <= 0) continue;
    adjacency.get(edge.from).push({ ...edge, distance, duration });
    if (edge.bidirectional !== false) {
      adjacency.get(edge.to).push({
        ...edge,
        from: edge.to,
        to: edge.from,
        distance,
        duration,
        geometry: Array.isArray(edge.geometry) ? [...edge.geometry].reverse() : edge.geometry,
      });
    }
  }

  const graphNodes = [...nodes.values()];
  const nearestStart = nearestGraphNode({ nodes: graphNodes }, start);
  const nearestEnd = nearestGraphNode({ nodes: graphNodes }, destination);
  if (!nearestStart || !nearestEnd || nearestStart.distance > 1000 || nearestEnd.distance > 1000) {
    return { routes: [], source: 'OFFLINE GRAPH', error: 'No covered offline road nodes are near both endpoints.' };
  }

  const distances = new Map([[nearestStart.node.id, 0]]);
  const previous = new Map();
  const unvisited = new Set(nodes.keys());
  while (unvisited.size) {
    let current = null;
    let currentCost = Number.POSITIVE_INFINITY;
    for (const id of unvisited) {
      const cost = distances.get(id) ?? Number.POSITIVE_INFINITY;
      if (cost < currentCost) {
        current = id;
        currentCost = cost;
      }
    }
    if (current === null || currentCost === Number.POSITIVE_INFINITY) break;
    if (current === nearestEnd.node.id) break;
    unvisited.delete(current);
    for (const edge of adjacency.get(current) || []) {
      const nextCost = currentCost + edge.duration;
      if (nextCost < (distances.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
        distances.set(edge.to, nextCost);
        previous.set(edge.to, { from: current, edge });
      }
    }
  }
  if (!distances.has(nearestEnd.node.id)) {
    return { routes: [], source: 'OFFLINE GRAPH', error: 'NO VERIFIED SAFE ROUTE in the cached road graph.' };
  }

  const pathEdges = [];
  let cursor = nearestEnd.node.id;
  while (cursor !== nearestStart.node.id) {
    const previousStep = previous.get(cursor);
    if (!previousStep) return { routes: [], source: 'OFFLINE GRAPH', error: 'Cached route reconstruction failed.' };
    pathEdges.unshift(previousStep.edge);
    cursor = previousStep.from;
  }
  const coordinates = [
    [nearestStart.node.longitude, nearestStart.node.latitude],
    ...pathEdges.flatMap((edge) => {
      const edgeCoordinates = Array.isArray(edge.geometry)
        ? edge.geometry
        : edge.geometry?.coordinates;
      return edgeCoordinates || [[nodes.get(edge.to).longitude, nodes.get(edge.to).latitude]];
    }),
    [nearestEnd.node.longitude, nearestEnd.node.latitude],
  ];
  const distance = pathEdges.reduce((sum, edge) => sum + edge.distance, 0);
  const duration = pathEdges.reduce((sum, edge) => sum + edge.duration, 0);
  return {
    routes: [{
      id: 'offline-route-1',
      distanceKm: Number((distance / 1000).toFixed(2)),
      durationMinutes: Number((duration / 60).toFixed(1)),
      geometry: { type: 'LineString', coordinates },
      directions: pathEdges.map((edge, index) => ({
        step: index + 1,
        instruction: edge.instruction || `Continue along ${edge.name || 'the verified road segment'}`,
        distanceMeters: Math.round(edge.distance),
        durationSeconds: Math.round(edge.duration),
        roadName: edge.name || null,
      })),
      safety: {
        status: 'VERIFIED_SAFE',
        verified: true,
        checkedAt: graph.checkedAt,
        excludedRoadSegments: [],
        reason: 'Route uses only fresh, verified OPEN edges from the complete cached Guayaquil graph.',
      },
    }],
    source: 'OFFLINE VERIFIED ROAD GRAPH',
    generatedAt: now(),
  };
}

export function getEvacuationOverview() {
  const state = detectEvacuationState();
  const zones = buildZoneSummaries().map((zone) => ({
    ...zone,
    dataSource: 'DEMO DATA — simulated risk inputs, not an observed flood',
    isDemoData: true,
  }));
  const rescueTeams = listRescueTeams();
  const availableRescueTeams = rescueTeams.filter((team) => team.availability === 'AVAILABLE').length;
  const availableShelters = shelters.filter(usableShelter).length;
  const activeOrders = evacuationOrders.filter((order) => order.status === 'ACTIVE');

  return {
    ...state,
    zones,
    shelters: shelters.map((shelter) => ({
      ...shelter,
      availableCapacity: Math.max(0, shelter.capacity - shelter.occupied),
      isCurrentlyUsable: usableShelter(shelter),
    })),
    rescueTeams,
    roadClosures: roadClosures.map((road) => ({ ...road })),
    metrics: {
      affectedPopulation: null,
      activeEvacuationOrders: activeOrders.length,
      availableShelters,
      verifiedBlockedRoads: roadClosures.filter((road) => road.verified && isFresh(road.lastVerifiedAt)).length,
      availableRescueTeams,
    },
    offlineGraphConfigured: Boolean(getOfflineGraphFile()),
    offlineGraphPath: getOfflineGraphFile(),
  };
}

export function updateShelter(shelterId, updates) {
  const shelter = shelters.find((item) => item.id === shelterId);
  if (!shelter) throw Object.assign(new Error('Shelter not found.'), { statusCode: 404 });
  if (shelter.isDemoData) {
    throw Object.assign(new Error('Demo shelters are read-only; register a verified shelter first.'), { statusCode: 409 });
  }
  if (updates.status != null && !['OPEN', 'FULL', 'CLOSED', 'INACCESSIBLE'].includes(updates.status)) {
    throw Object.assign(new Error('Invalid shelter status.'), { statusCode: 400 });
  }
  if (updates.capacity != null && (!Number.isInteger(Number(updates.capacity)) || Number(updates.capacity) < 0)) {
    throw Object.assign(new Error('Capacity must be a non-negative whole number.'), { statusCode: 400 });
  }
  if (updates.occupied != null && (!Number.isInteger(Number(updates.occupied)) || Number(updates.occupied) < 0)) {
    throw Object.assign(new Error('Occupied capacity must be a non-negative whole number.'), { statusCode: 400 });
  }
  if (updates.facilities != null && (!Array.isArray(updates.facilities) || updates.facilities.some((item) => typeof item !== 'string'))) {
    throw Object.assign(new Error('facilities must be an array of strings.'), { statusCode: 400 });
  }
  if (updates.status != null) shelter.status = updates.status;
  if (updates.capacity != null) shelter.capacity = Number(updates.capacity);
  if (updates.occupied != null) shelter.occupied = Number(updates.occupied);
  if (updates.facilities != null) shelter.facilities = updates.facilities;
  shelter.lastVerifiedAt = now();
  return { ...shelter, availableCapacity: Math.max(0, shelter.capacity - shelter.occupied) };
}

export async function registerShelter(input) {
  if (!input || typeof input.name !== 'string' || input.name.trim().length < 2
    || !validateCoordinates(input.coordinates)) {
    throw Object.assign(new Error('Shelter name and valid coordinates are required.'), { statusCode: 400 });
  }
  const capacity = Number(input.capacity);
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw Object.assign(new Error('Shelter capacity must be a positive whole number.'), { statusCode: 400 });
  }
  const shelter = {
    id: `SH-${Date.now()}`,
    name: input.name.trim(),
    coordinates: { latitude: Number(input.coordinates.latitude), longitude: Number(input.coordinates.longitude) },
    capacity,
    occupied: 0,
    facilities: Array.isArray(input.facilities) ? input.facilities.filter((item) => typeof item === 'string') : [],
    status: 'OPEN',
    lastVerifiedAt: now(),
    isDemoData: false,
    source: 'OPERATOR-VERIFIED',
  };
  shelters.push(shelter);
  return { ...shelter, availableCapacity: capacity };
}

export function reportRoadClosure(input) {
  if (!input || typeof input.name !== 'string' || input.name.trim().length < 2
    || !['CLOSED', 'FLOODED', 'UNSAFE_BRIDGE', 'OPEN'].includes(input.status)
    || !['LOW', 'MODERATE', 'HIGH', 'CRITICAL'].includes(input.severity)
    || input.verified !== true) {
    throw Object.assign(new Error('Road name, status, severity, and explicit operator verification are required.'), { statusCode: 400 });
  }
  if (input.geometry && !['LineString', 'MultiLineString'].includes(input.geometry.type)) {
    throw Object.assign(new Error('Road geometry must be a GeoJSON LineString or MultiLineString.'), { statusCode: 400 });
  }
  const road = {
    id: `ROAD-${Date.now()}`,
    name: input.name.trim(),
    status: input.status,
    severity: input.severity,
    geometry: input.geometry || null,
    verified: true,
    lastVerifiedAt: now(),
    source: 'OPERATOR-VERIFIED',
    isDemoData: false,
  };
  roadClosures.push(road);
  return { ...road, evacuationState: detectEvacuationState() };
}

export async function calculateEvacuationRoutes({ zoneId, shelterId, transportMode = 'vehicle' }) {
  if (!['vehicle', 'walking'].includes(transportMode)) {
    throw Object.assign(new Error('transportMode must be vehicle or walking.'), { statusCode: 400 });
  }
  const overview = getEvacuationOverview();
  const zone = overview.zones.find((item) => item.id === zoneId)
    || overview.affectedZones.find((item) => item.id === zoneId);
  if (!zone) throw Object.assign(new Error('Affected zone or incident not found.'), { statusCode: 404 });
  const candidateShelters = overview.shelters.filter((shelter) => (
    shelter.isCurrentlyUsable && (!shelterId || shelter.id === shelterId)
  ));
  if (!candidateShelters.length) {
    return {
      zone,
      routes: [],
      recommendedRoute: null,
      status: 'NO_VERIFIED_SAFE_ROUTE',
      message: 'NO VERIFIED SAFE ROUTE — contact local emergency services and the emergency control room.',
      source: 'UNAVAILABLE',
      generatedAt: now(),
    };
  }

  const options = await Promise.all(candidateShelters.map(async (shelter) => {
    const roadResult = await calculateRoadRoutes(zone.coordinates, shelter.coordinates, { transportMode });
    let routes = await Promise.all((roadResult.routes || []).map(async (route) => ({
      ...route,
      safety: await validateEvacuationRoute(route),
      shelter,
      provider: roadResult.source,
    })));
    if (!routes.some((route) => route.safety?.status === 'VERIFIED_SAFE')) {
      const offline = await calculateOfflineRoutes(zone.coordinates, shelter.coordinates, transportMode);
      routes = [
        ...routes,
        ...offline.routes.map((route) => ({ ...route, shelter, provider: offline.source })),
      ];
    }
    return routes;
  }));
  const allRoutes = options.flat();
  const safeRoutes = allRoutes.filter((route) => route.safety?.status === 'VERIFIED_SAFE')
    .sort((a, b) => {
      if (a.shelter.availableCapacity !== b.shelter.availableCapacity) {
        return b.shelter.availableCapacity - a.shelter.availableCapacity;
      }
      if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
      return a.durationMinutes - b.durationMinutes;
    });
  const recommendedRoute = safeRoutes[0] || null;
  return {
    zone,
    routes: allRoutes,
    recommendedRoute,
    status: recommendedRoute ? 'VERIFIED_ROUTE_AVAILABLE' : 'NO_VERIFIED_SAFE_ROUTE',
    message: recommendedRoute
      ? 'Route verified against the configured current road-condition source.'
      : 'NO VERIFIED SAFE ROUTE — contact local emergency services and the emergency control room.',
    source: allRoutes[0]?.provider || 'UNAVAILABLE',
    roadConditionCheckedAt: recommendedRoute?.safety?.checkedAt || null,
    generatedAt: now(),
  };
}

export function activateEvacuationMode({ confirmation, operatorId }) {
  if (confirmation !== true) {
    throw Object.assign(new Error('Explicit operator confirmation is required.'), { statusCode: 400 });
  }
  const state = detectEvacuationState();
  if (!['EVACUATE', 'EMERGENCY'].includes(state.status)) {
    throw Object.assign(new Error(`Evacuation activation blocked: current state is ${state.status}.`), { statusCode: 409 });
  }
  const order = {
    id: `EVAC-${Date.now()}`,
    status: 'ACTIVE',
    evacuationStatus: state.status,
    affectedIncidentIds: state.affectedZones.map((incident) => incident.id),
    reasons: state.reasons,
    createdAt: now(),
    operatorId,
  };
  evacuationOrders.push(order);
  return { ...order };
}

export async function queueEvacuationSms({ recipients, message, operatorId }) {
  if (!Array.isArray(recipients) || !recipients.length
    || recipients.length > 1000
    || recipients.some((number) => typeof number !== 'string' || !/^\+[1-9]\d{7,14}$/.test(number))) {
    throw Object.assign(new Error('Provide 1–1000 E.164-format recipient phone numbers.'), { statusCode: 400 });
  }
  if (typeof message !== 'string' || message.trim().length < 1 || message.length > 480) {
    throw Object.assign(new Error('SMS message must contain 1–480 characters.'), { statusCode: 400 });
  }
  const queued = [];
  for (const recipient of recipients) {
    const item = {
      id: `SMS-${++smsSequence}`,
      recipient,
      message: message.trim(),
      status: 'PENDING',
      deliveryMode: SMS_GATEWAY_URL ? 'GATEWAY' : 'SIMULATED',
      queuedAt: now(),
      updatedAt: now(),
      operatorId,
      attemptCount: 0,
    };
    smsMessages.push(item);
    queued.push(item);
  }
  if (SMS_GATEWAY_URL) {
    for (const item of queued) await deliverSms(item);
  }
  return queued.map((item) => ({ ...item }));
}

async function deliverSms(item) {
  if (!SMS_GATEWAY_URL) {
    item.status = 'SIMULATED';
    item.deliveryMode = 'SIMULATED';
    item.updatedAt = now();
    item.error = 'No SMS gateway configured; message was not sent.';
    return item;
  }
  item.attemptCount += 1;
  item.updatedAt = now();
  try {
    const response = await axios.post(SMS_GATEWAY_URL, {
      to: item.recipient,
      message: item.message,
      clientMessageId: item.id,
    }, {
      headers: process.env.SMS_GATEWAY_API_KEY
        ? { Authorization: `Bearer ${process.env.SMS_GATEWAY_API_KEY}` }
        : undefined,
      timeout: 10000,
    });
    if (response.data?.delivered === true || response.data?.status === 'SENT') {
      item.status = 'SENT';
      item.providerMessageId = response.data.messageId || null;
      item.error = null;
    } else {
      item.status = 'PENDING';
      item.error = 'Gateway accepted the request without confirming delivery.';
    }
  } catch (error) {
    item.status = error.code === 'ECONNABORTED' || error.code === 'ERR_NETWORK'
      ? 'PENDING'
      : 'FAILED';
    item.error = `SMS gateway delivery not confirmed: ${error.response?.status || error.code || 'provider error'}.`;
  }
  item.updatedAt = now();
  return item;
}

export async function retryEvacuationSms(messageId) {
  const item = smsMessages.find((message) => message.id === messageId);
  if (!item) throw Object.assign(new Error('SMS message not found.'), { statusCode: 404 });
  if (item.status === 'SENT') {
    throw Object.assign(new Error('SMS has already been confirmed sent.'), { statusCode: 409 });
  }
  if (!SMS_GATEWAY_URL) {
    throw Object.assign(new Error('SMS retry unavailable: no gateway is configured.'), { statusCode: 503 });
  }
  return { ...(await deliverSms(item)) };
}

export function getEvacuationSmsMessages() {
  return smsMessages.map((item) => ({ ...item }));
}

export const evacuationConfiguration = {
  highRiskThreshold: HIGH_RISK_THRESHOLD,
  criticalRiskThreshold: CRITICAL_RISK_THRESHOLD,
  dangerousWaterDepthMeters: DANGEROUS_WATER_DEPTH_METERS,
  criticalBlockedRoadsThreshold: CRITICAL_BLOCKED_ROADS_THRESHOLD,
  roadConditionMaxAgeMinutes: ROAD_DATA_MAX_AGE_MS / 60000,
  smsGatewayConfigured: Boolean(SMS_GATEWAY_URL),
  offlineGraphConfigured: Boolean(getOfflineGraphFile()),
};
