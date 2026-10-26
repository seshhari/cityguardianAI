import axios from 'axios';
import { calculateRoadRoutes } from './routingService.js';

function readPositiveSetting(name, fallback) {
  const value = process.env[name] == null ? fallback : Number(process.env[name]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return value;
}

function readRiskThreshold(name, fallback) {
  const value = process.env[name] == null ? fallback : Number(process.env[name]);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${name} must be between 0 and 100.`);
  }
  return value;
}

function readWeight(name, fallback) {
  const value = process.env[name] == null ? fallback : Number(process.env[name]);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number.`);
  }
  return value;
}

const TEAM_LOCATION_MAX_AGE_MS = readPositiveSetting('TEAM_LOCATION_MAX_AGE_MS', 5 * 60 * 1000);
const ROAD_CONDITION_MAX_AGE_MS = readPositiveSetting('ROAD_CONDITION_MAX_AGE_MS', 15 * 60 * 1000);
const HIGH_RISK_THRESHOLD = readRiskThreshold('HIGH_RISK_THRESHOLD', 70);
const CRITICAL_RISK_THRESHOLD = readRiskThreshold('CRITICAL_RISK_THRESHOLD', 85);
const ETA_WEIGHT = readWeight('DISPATCH_ETA_WEIGHT', 0.8);
const WORKLOAD_WEIGHT = readWeight('DISPATCH_WORKLOAD_WEIGHT', 0.2);
if (CRITICAL_RISK_THRESHOLD < HIGH_RISK_THRESHOLD) {
  throw new Error('CRITICAL_RISK_THRESHOLD must be greater than or equal to HIGH_RISK_THRESHOLD.');
}
if (ETA_WEIGHT + WORKLOAD_WEIGHT === 0) {
  throw new Error('At least one dispatch ranking weight must be greater than zero.');
}
const ROAD_CONDITIONS_URL = process.env.ROAD_CONDITIONS_URL;

const now = () => new Date().toISOString();

const teams = [
  {
    id: 'R-01',
    name: 'Malecón Boat Rescue',
    location: { latitude: -2.1900, longitude: -79.8830 },
    baseStation: 'Las Peñas Response Base',
    availability: 'AVAILABLE',
    type: 'boat rescue',
    equipment: ['rescue boat', 'life jackets', 'radio'],
    capacity: 8,
    workload: 0,
  },
  {
    id: 'R-02',
    name: 'Urdesa Water Rescue',
    location: { latitude: -2.166, longitude: -79.907 },
    baseStation: 'Urdesa Response Base',
    availability: 'AVAILABLE',
    type: 'water rescue',
    equipment: ['inflatable boat', 'life jackets', 'throw lines', 'radio'],
    capacity: 6,
    workload: 0,
  },
  {
    id: 'R-03',
    name: 'Centro Medical Response',
    location: { latitude: -2.178, longitude: -79.902 },
    baseStation: 'Centro Response Base',
    availability: 'AVAILABLE',
    type: 'medical response',
    equipment: ['first aid', 'medical kit', 'radio'],
    capacity: 4,
    workload: 0,
  },
  {
    id: 'R-04',
    name: 'Samborondón Evacuation Support',
    location: { latitude: -2.126, longitude: -79.876 },
    baseStation: 'Samborondón Response Base',
    availability: 'BUSY',
    type: 'evacuation support',
    equipment: ['rescue boat', 'life jackets', 'radio', 'evacuation vehicle'],
    capacity: 10,
    workload: 1,
  },
].map((team) => ({
  ...team,
  lastLocationUpdate: now(),
  locationSource: 'DEMO DATA',
  currentAssignment: null,
  currentDestination: null,
  isDemoData: true,
}));

const incidents = [
  {
    id: 'DEMO-INC-001',
    location: 'Estero Salado (training scenario)',
    coordinates: { latitude: -2.170, longitude: -79.910 },
    riskScore: 88,
    severity: 'CRITICAL',
    estimatedWaterDepthMeters: null,
    reportedAt: now(),
    lastVerifiedAt: null,
    roadAccessibility: 'UNKNOWN',
    status: 'NEEDS_VERIFICATION',
    peopleRequiringAssistance: null,
    verificationStatus: 'UNVERIFIED',
    source: 'DEMO DATA — training scenario, not a reported flood',
    isDemoData: true,
  },
];

const assignments = [];
const auditTrail = [];

function coordinateIsValid(value) {
  return value
    && Number.isFinite(Number(value.latitude))
    && Number(value.latitude) >= -90
    && Number(value.latitude) <= 90
    && Number.isFinite(Number(value.longitude))
    && Number(value.longitude) >= -180
    && Number(value.longitude) <= 180;
}

function locationIsFresh(team, at = Date.now()) {
  const updated = Date.parse(team.lastLocationUpdate);
  return Number.isFinite(updated) && at - updated <= TEAM_LOCATION_MAX_AGE_MS && updated <= at;
}

function incidentMeetsDispatchThreshold(incident) {
  return incident.riskScore >= HIGH_RISK_THRESHOLD;
}

function requiredEquipmentFor(incident) {
  if (incident.severity === 'CRITICAL' || (incident.estimatedWaterDepthMeters ?? 0) >= 0.5) {
    return ['rescue boat', 'life jackets'];
  }
  return ['life jackets'];
}

export function parseRoadConditionResult(result) {
  const checkedAtMs = Date.parse(result?.checkedAt);
  const isFresh = Number.isFinite(checkedAtMs)
    && checkedAtMs <= Date.now()
    && Date.now() - checkedAtMs <= ROAD_CONDITION_MAX_AGE_MS;

  if (result?.coverageComplete !== true || !isFresh || !Array.isArray(result?.hazards)) {
    return {
      status: 'UNVERIFIED',
      verified: false,
      checkedAt: result?.checkedAt || null,
      excludedRoadSegments: [],
      reason: 'Road-condition coverage is incomplete, stale, or malformed.',
    };
  }

  const hazards = result.hazards.filter((hazard) => (
    hazard
    && ['CLOSED', 'FLOODED', 'UNSAFE_BRIDGE'].includes(hazard.status)
    && hazard.intersectsRoute === true
  ));

  if (hazards.length > 0) {
    return {
      status: 'UNSAFE',
      verified: false,
      checkedAt: result.checkedAt,
      excludedRoadSegments: hazards.map(({ id, name, status, geometry }) => ({ id, name, status, geometry: geometry || null })),
      reason: 'The road-condition feed reports one or more unsafe segments on this route.',
    };
  }

  return {
    status: 'VERIFIED_SAFE',
    verified: true,
    checkedAt: result.checkedAt,
    excludedRoadSegments: [],
    reason: 'A fresh, complete road-condition feed reports no blocked segments on this route.',
  };
}

async function checkRouteSafety(route) {
  if (!ROAD_CONDITIONS_URL) {
    return {
      status: 'UNVERIFIED',
      verified: false,
      checkedAt: null,
      excludedRoadSegments: [],
      reason: 'No verified road-condition feed is configured; this road route is not confirmed flood-safe.',
    };
  }

  try {
    const response = await axios.post(
      ROAD_CONDITIONS_URL,
      { geometry: route.geometry, profile: 'driving-car' },
      {
        headers: process.env.ROAD_CONDITIONS_API_KEY
          ? { Authorization: `Bearer ${process.env.ROAD_CONDITIONS_API_KEY}` }
          : undefined,
        timeout: 8000,
      },
    );
    return parseRoadConditionResult(response.data);
  } catch (error) {
    return {
      status: 'UNVERIFIED',
      verified: false,
      checkedAt: null,
      excludedRoadSegments: [],
      reason: `Road-condition verification is unavailable: ${error.response?.status || error.code || 'provider error'}.`,
    };
  }
}

export async function validateRouteSafety(route) {
  return checkRouteSafety(route);
}

function suitabilityFor(team, incident) {
  const required = requiredEquipmentFor(incident);
  const missingEquipment = required.filter((item) => !team.equipment.includes(item)
    && !(item === 'rescue boat' && team.equipment.includes('inflatable boat')));
  const assistanceCount = incident.peopleRequiringAssistance;
  const capacityAvailable = assistanceCount == null || team.capacity >= assistanceCount;
  return {
    suitable: missingEquipment.length === 0 && capacityAvailable,
    requiredEquipment: required,
    missingEquipment,
    capacityAvailable,
  };
}

export function isTeamEligible(team, incident, at = Date.now()) {
  return team.availability === 'AVAILABLE'
    && locationIsFresh(team, at)
    && suitabilityFor(team, incident).suitable
    && coordinateIsValid(team.location);
}

function teamExclusionReason(team, incident) {
  if (team.availability !== 'AVAILABLE') return `Team status is ${team.availability}.`;
  if (!locationIsFresh(team)) return 'Team location is stale or has no valid update timestamp.';
  if (!coordinateIsValid(team.location)) return 'Team GPS coordinates are missing or invalid.';
  const suitability = suitabilityFor(team, incident);
  if (suitability.missingEquipment.length) {
    return `Required equipment missing: ${suitability.missingEquipment.join(', ')}.`;
  }
  if (!suitability.capacityAvailable) return 'Team capacity is below the verified assistance count.';
  return null;
}

export function rankRescueCandidates(candidates, incident) {
  const feasible = candidates.filter((candidate) => candidate.feasible);
  const weightTotal = ETA_WEIGHT + WORKLOAD_WEIGHT;
  const ranked = candidates.map((candidate) => {
    if (!candidate.feasible) return { ...candidate, selectionScore: null };
    const etaScore = 100 / (1 + candidate.route.durationMinutes / 60);
    const workloadScore = 100 / (1 + candidate.workload);
    return {
      ...candidate,
      selectionScore: Number(((etaScore * ETA_WEIGHT + workloadScore * WORKLOAD_WEIGHT) / weightTotal).toFixed(1)),
    };
  }).sort((a, b) => {
    if (a.feasible !== b.feasible) return Number(b.feasible) - Number(a.feasible);
    return (b.selectionScore ?? -1) - (a.selectionScore ?? -1);
  });
  const recommendedTeam = !incident.isDemoData && incident.verificationStatus === 'VERIFIED'
    ? ranked.find((candidate) => candidate.feasible && !candidate.team.isDemoData) || null
    : null;
  return { ranked, recommendedTeam };
}

function buildRecommendationReason(candidate) {
  return `${candidate.team.name} is recommended because it is available, has the required equipment, and has the lowest estimated response time among teams with a fresh location and a verified safe road route.`;
}

export function listRescueTeams({ availableOnly = false } = {}) {
  return teams
    .filter((team) => !availableOnly || team.availability === 'AVAILABLE')
    .map((team) => ({ ...team, locationFresh: locationIsFresh(team) }));
}

export function listFloodIncidents() {
  return incidents.map((incident) => ({
    ...incident,
    dispatchThresholdMet: incidentMeetsDispatchThreshold(incident),
    dispatchBlockedReason: incident.isDemoData
      ? 'Demo scenario only; verify a real incident before dispatch.'
      : incident.verificationStatus !== 'VERIFIED'
        ? 'Incident has not been verified by an authorized operator.'
        : null,
  }));
}

export function createFloodIncident(input) {
  if (!input || typeof input !== 'object') {
    throw Object.assign(new Error('Incident details are required.'), { statusCode: 400 });
  }
  if (!coordinateIsValid(input.coordinates)) {
    throw Object.assign(new Error('Valid incident latitude and longitude are required.'), { statusCode: 400 });
  }
  if (typeof input.location !== 'string' || input.location.trim().length < 2) {
    throw Object.assign(new Error('A location name is required.'), { statusCode: 400 });
  }
  const riskScore = Number(input.riskScore);
  if (!Number.isFinite(riskScore) || riskScore < 0 || riskScore > 100) {
    throw Object.assign(new Error('riskScore must be between 0 and 100.'), { statusCode: 400 });
  }
  const submittedSeverity = String(input.severity || '').toUpperCase();
  if (!['LOW', 'MODERATE', 'HIGH', 'CRITICAL'].includes(submittedSeverity)) {
    throw Object.assign(new Error('A valid incident severity is required.'), { statusCode: 400 });
  }
  const severity = riskScore >= CRITICAL_RISK_THRESHOLD
    ? 'CRITICAL'
    : riskScore >= HIGH_RISK_THRESHOLD
      ? 'HIGH'
      : submittedSeverity;
  const waterDepth = input.estimatedWaterDepthMeters == null || input.estimatedWaterDepthMeters === ''
    ? null
    : Number(input.estimatedWaterDepthMeters);
  const assistanceCount = input.peopleRequiringAssistance == null || input.peopleRequiringAssistance === ''
    ? null
    : Number(input.peopleRequiringAssistance);
  if (waterDepth !== null && (!Number.isFinite(waterDepth) || waterDepth < 0)) {
    throw Object.assign(new Error('estimatedWaterDepthMeters must be a non-negative number.'), { statusCode: 400 });
  }
  if (assistanceCount !== null && (!Number.isInteger(assistanceCount) || assistanceCount < 0)) {
    throw Object.assign(new Error('peopleRequiringAssistance must be a non-negative whole number.'), { statusCode: 400 });
  }

  const timestamp = now();
  const incident = {
    id: `INC-${Date.now()}`,
    location: input.location.trim(),
    coordinates: {
      latitude: Number(input.coordinates.latitude),
      longitude: Number(input.coordinates.longitude),
    },
    riskScore,
    severity,
    estimatedWaterDepthMeters: waterDepth,
    reportedAt: timestamp,
    lastVerifiedAt: null,
    roadAccessibility: 'UNKNOWN',
    status: 'REPORTED',
    peopleRequiringAssistance: assistanceCount,
    verificationStatus: 'UNVERIFIED',
    source: 'OPERATOR-REPORTED',
    isDemoData: false,
  };
  incidents.push(incident);
  auditTrail.push({ at: timestamp, action: 'INCIDENT_REPORTED', incidentId: incident.id });
  return incident;
}

export function verifyFloodIncident(incidentId, { verified, verificationNote }) {
  const incident = incidents.find((item) => item.id === incidentId);
  if (!incident) throw Object.assign(new Error('Incident not found.'), { statusCode: 404 });
  if (incident.isDemoData) {
    throw Object.assign(new Error('Demo incidents cannot be converted into verified real incidents.'), { statusCode: 409 });
  }
  if (verified !== true || typeof verificationNote !== 'string' || verificationNote.trim().length < 5) {
    throw Object.assign(new Error('Operator verification and a verification note are required.'), { statusCode: 400 });
  }
  incident.verificationStatus = 'VERIFIED';
  incident.lastVerifiedAt = now();
  incident.verificationNote = verificationNote.trim();
  incident.status = 'VERIFIED';
  auditTrail.push({ at: incident.lastVerifiedAt, action: 'INCIDENT_VERIFIED', incidentId });
  return incident;
}

export function updateTeamLocation(teamId, { coordinates }) {
  const team = teams.find((item) => item.id === teamId);
  if (!team) throw Object.assign(new Error('Rescue team not found.'), { statusCode: 404 });
  if (team.isDemoData) {
    throw Object.assign(new Error('Demo team records cannot be converted into live teams; register a verified team first.'), { statusCode: 409 });
  }
  if (!coordinateIsValid(coordinates)) {
    throw Object.assign(new Error('Valid latitude and longitude are required.'), { statusCode: 400 });
  }
  team.location = {
    latitude: Number(coordinates.latitude),
    longitude: Number(coordinates.longitude),
  };
  team.lastLocationUpdate = now();
  team.locationSource = 'AUTHORIZED OPERATOR UPDATE';
  auditTrail.push({ at: team.lastLocationUpdate, action: 'TEAM_LOCATION_UPDATED', teamId });
  return { ...team, locationFresh: true };
}

export function registerRescueTeam(input) {
  if (!input || typeof input !== 'object') {
    throw Object.assign(new Error('Rescue team details are required.'), { statusCode: 400 });
  }
  if (typeof input.name !== 'string' || input.name.trim().length < 2
    || typeof input.baseStation !== 'string' || input.baseStation.trim().length < 2) {
    throw Object.assign(new Error('Team name and base station are required.'), { statusCode: 400 });
  }
  if (!coordinateIsValid(input.location)) {
    throw Object.assign(new Error('Valid team latitude and longitude are required.'), { statusCode: 400 });
  }
  const capacity = Number(input.capacity);
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw Object.assign(new Error('Team capacity must be a positive whole number.'), { statusCode: 400 });
  }
  const equipment = Array.isArray(input.equipment)
    ? input.equipment.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const validTypes = ['boat rescue', 'water rescue', 'medical response', 'evacuation support'];
  const type = String(input.type || '').toLowerCase();
  if (!validTypes.includes(type) || equipment.length === 0) {
    throw Object.assign(new Error('A supported team type and at least one equipment item are required.'), { statusCode: 400 });
  }
  const timestamp = now();
  const team = {
    id: `R-${Date.now()}`,
    name: input.name.trim(),
    location: { latitude: Number(input.location.latitude), longitude: Number(input.location.longitude) },
    baseStation: input.baseStation.trim(),
    availability: 'AVAILABLE',
    type,
    equipment,
    capacity,
    workload: 0,
    lastLocationUpdate: timestamp,
    locationSource: 'AUTHORIZED OPERATOR ENTRY',
    currentAssignment: null,
    currentDestination: null,
    isDemoData: false,
  };
  teams.push(team);
  auditTrail.push({ at: timestamp, action: 'TEAM_REGISTERED', teamId: team.id });
  return { ...team };
}

export function updateRescueTeam(teamId, updates) {
  const team = teams.find((item) => item.id === teamId);
  if (!team) throw Object.assign(new Error('Rescue team not found.'), { statusCode: 404 });
  if (team.isDemoData) {
    throw Object.assign(new Error('Demo team records are read-only; register a verified team to manage it.'), { statusCode: 409 });
  }
  const allowedAvailability = ['AVAILABLE', 'BUSY', 'OFFLINE'];
  if (updates.availability != null) {
    if (!allowedAvailability.includes(updates.availability)) {
      throw Object.assign(new Error('Availability must be AVAILABLE, BUSY, or OFFLINE.'), { statusCode: 400 });
    }
    if (team.currentAssignment) {
      throw Object.assign(new Error('An assigned team availability is controlled by its assignment status.'), { statusCode: 409 });
    }
    team.availability = updates.availability;
  }
  if (updates.equipment != null) {
    if (!Array.isArray(updates.equipment) || !updates.equipment.length
      || updates.equipment.some((item) => typeof item !== 'string' || !item.trim())) {
      throw Object.assign(new Error('equipment must be a non-empty array of strings.'), { statusCode: 400 });
    }
    team.equipment = updates.equipment.map((item) => item.trim());
  }
  if (updates.capacity != null) {
    const capacity = Number(updates.capacity);
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw Object.assign(new Error('Team capacity must be a positive whole number.'), { statusCode: 400 });
    }
    team.capacity = capacity;
  }
  const timestamp = now();
  auditTrail.push({ at: timestamp, action: 'TEAM_PROFILE_UPDATED', teamId });
  return { ...team };
}

export async function getRescueOptions(incidentId) {
  const incident = incidents.find((item) => item.id === incidentId);
  if (!incident) throw Object.assign(new Error('Incident not found.'), { statusCode: 404 });
  if (!incidentMeetsDispatchThreshold(incident)) {
    return {
      incident,
      candidates: [],
      excludedTeams: teams.map((team) => ({ teamId: team.id, reason: 'Incident is below the configured HIGH risk threshold.' })),
      recommendedTeam: null,
      recommendationStatus: 'BELOW_THRESHOLD',
      dispatchBlockedReason: 'Incident is below the configured HIGH risk threshold.',
      source: incident.isDemoData ? 'DEMO DATA' : 'OPERATOR-REPORTED',
    };
  }

  const eligible = teams.filter((team) => isTeamEligible(team, incident));
  const excludedTeams = teams
    .filter((team) => !eligible.includes(team))
    .map((team) => ({ teamId: team.id, teamName: team.name, reason: teamExclusionReason(team, incident) }));

  const candidates = await Promise.all(eligible.map(async (team) => {
    const suitability = suitabilityFor(team, incident);
    let routeResult;
    try {
      routeResult = await calculateRoadRoutes(team.location, incident.coordinates);
    } catch (error) {
      routeResult = {
        routes: [],
        source: 'UNAVAILABLE',
        error: error.message,
      };
    }

    const routeOptions = await Promise.all((routeResult.routes || []).map(async (route) => {
      const safety = await checkRouteSafety(route);
      return {
        ...route,
        safety,
        feasible: safety.status === 'VERIFIED_SAFE',
      };
    }));
    const bestRoute = routeOptions
      .filter((route) => route.feasible)
      .sort((a, b) => a.durationMinutes - b.durationMinutes)[0] || null;
    const fastestCandidateRoute = routeOptions
      .slice()
      .sort((a, b) => a.durationMinutes - b.durationMinutes)[0] || null;

    return {
      team: { ...team, locationFresh: true },
      routeProvider: routeResult.source,
      routeError: routeResult.error || null,
      alternatives: routeOptions,
      route: bestRoute || fastestCandidateRoute,
      routeSafety: bestRoute ? 'VERIFIED_SAFE' : fastestCandidateRoute?.safety.status || 'UNAVAILABLE',
      feasible: Boolean(bestRoute),
      suitability,
      workload: team.workload,
    };
  }));

  const { ranked, recommendedTeam } = rankRescueCandidates(candidates, incident);

  return {
    incident,
    candidates: ranked,
    excludedTeams,
    recommendedTeam: recommendedTeam
      ? {
        teamId: recommendedTeam.team.id,
        teamName: recommendedTeam.team.name,
        reason: buildRecommendationReason(recommendedTeam),
      }
      : null,
    recommendationStatus: incident.isDemoData
      ? 'DEMO_ONLY'
      : incident.verificationStatus !== 'VERIFIED'
        ? 'AWAITING_VERIFICATION'
        : recommendedTeam
          ? 'READY'
          : 'NO_VERIFIED_SAFE_ROUTE',
    dispatchBlockedReason: incident.isDemoData
      ? 'Demo scenario only; it cannot be assigned or dispatched.'
      : incident.verificationStatus !== 'VERIFIED'
        ? 'Incident must be verified before dispatch.'
        : !recommendedTeam
          ? 'NO VERIFIED SAFE ROUTE — escalate to the emergency control room.'
          : null,
    source: candidates.every((candidate) => candidate.routeProvider === 'OpenRouteService API')
      ? 'OpenRouteService API'
      : 'MIXED OR UNAVAILABLE ROUTE DATA',
    roadConditionSource: ROAD_CONDITIONS_URL ? 'Configured road-condition provider' : 'NOT CONFIGURED',
    roadConditionMaxAgeMinutes: ROAD_CONDITION_MAX_AGE_MS / 60000,
    generatedAt: now(),
  };
}

export async function calculateTeamRoute(teamId, incidentId) {
  const options = await getRescueOptions(incidentId);
  const candidate = options.candidates.find((item) => item.team.id === teamId);
  if (!candidate) {
    throw Object.assign(new Error('Team is unavailable, stale, or lacks required equipment.'), { statusCode: 409 });
  }
  return {
    incident: options.incident,
    team: candidate.team,
    route: candidate.route,
    alternatives: candidate.alternatives,
    distanceKm: candidate.route?.distanceKm ?? null,
    estimatedMinutes: candidate.route?.durationMinutes ?? null,
    directions: candidate.route?.directions ?? [],
    safetyValidation: candidate.route?.safety ?? {
      status: 'UNAVAILABLE',
      verified: false,
      reason: candidate.routeError || 'No road-network route is available.',
    },
    excludedRoadSegments: candidate.route?.safety?.excludedRoadSegments ?? [],
    routeSource: candidate.routeProvider,
    roadConditionSourceTimestamp: candidate.route?.safety?.checkedAt ?? null,
    dispatchBlockedReason: options.dispatchBlockedReason,
  };
}

export async function createRescueAssignment({ incidentId, teamId, operatorId = 'authorized-operator' }) {
  const incident = incidents.find((item) => item.id === incidentId);
  const team = teams.find((item) => item.id === teamId);
  if (!incident) throw Object.assign(new Error('Incident not found.'), { statusCode: 404 });
  if (!team) throw Object.assign(new Error('Rescue team not found.'), { statusCode: 404 });
  if (incident.isDemoData) {
    throw Object.assign(new Error('Demo scenarios cannot be assigned for real-world dispatch.'), { statusCode: 409 });
  }
  if (incident.verificationStatus !== 'VERIFIED') {
    throw Object.assign(new Error('Incident must be verified before assignment.'), { statusCode: 409 });
  }
  if (team.availability !== 'AVAILABLE' || !locationIsFresh(team)) {
    throw Object.assign(new Error('Team must be available and have a fresh location.'), { statusCode: 409 });
  }
  if (team.isDemoData) {
    throw Object.assign(new Error('Demo teams cannot be dispatched to real incidents.'), { statusCode: 409 });
  }
  const routeOptions = await getRescueOptions(incidentId);
  if (!routeOptions.recommendedTeam || routeOptions.recommendedTeam.teamId !== teamId) {
    throw Object.assign(new Error('Assignment requires a current verified-safe route and an eligible team.'), { statusCode: 409 });
  }
  if (assignments.some((item) => item.incidentId === incidentId && !['COMPLETED', 'CANCELLED'].includes(item.status))) {
    throw Object.assign(new Error('Incident already has an active assignment.'), { statusCode: 409 });
  }
  const assignment = {
    id: `ASN-${Date.now()}`,
    incidentId,
    teamId,
    status: 'ASSIGNED',
    createdAt: now(),
    updatedAt: now(),
    operatorId,
    history: [{ status: 'ASSIGNED', at: now(), operatorId }],
  };
  assignments.push(assignment);
  incident.status = 'ASSIGNED';
  team.availability = 'DEPLOYED';
  team.currentAssignment = assignment.id;
  team.currentDestination = incident.coordinates;
  team.workload += 1;
  auditTrail.push({ at: now(), action: 'TEAM_ASSIGNED', incidentId, teamId, assignmentId: assignment.id, operatorId });
  return { ...assignment };
}

export async function updateAssignmentStatus(assignmentId, { status, operatorId = 'authorized-operator' }) {
  const assignment = assignments.find((item) => item.id === assignmentId);
  if (!assignment) throw Object.assign(new Error('Assignment not found.'), { statusCode: 404 });
  const transitions = {
    ASSIGNED: ['DISPATCHED', 'CANCELLED'],
    DISPATCHED: ['ARRIVED', 'CANCELLED'],
    ARRIVED: ['COMPLETED'],
    COMPLETED: [],
    CANCELLED: [],
  };
  if (!transitions[assignment.status]?.includes(status)) {
    throw Object.assign(new Error(`Invalid assignment transition: ${assignment.status} to ${status}.`), { statusCode: 409 });
  }
  if (status === 'DISPATCHED') {
    const incident = incidents.find((item) => item.id === assignment.incidentId);
    const team = teams.find((item) => item.id === assignment.teamId);
    if (!incident || !team || !locationIsFresh(team)) {
      throw Object.assign(new Error('Dispatch blocked: incident or team location is unavailable or stale.'), { statusCode: 409 });
    }
    const routeResult = await calculateRoadRoutes(team.location, incident.coordinates);
    const freshSafety = await Promise.all((routeResult.routes || []).map(checkRouteSafety));
    if (!freshSafety.some((result) => result.status === 'VERIFIED_SAFE')) {
      throw Object.assign(new Error('Dispatch blocked: NO VERIFIED SAFE ROUTE on the latest route check.'), { statusCode: 409 });
    }
  }
  const timestamp = now();
  assignment.status = status;
  assignment.updatedAt = timestamp;
  assignment.history.push({ status, at: timestamp, operatorId });
  const incident = incidents.find((item) => item.id === assignment.incidentId);
  const team = teams.find((item) => item.id === assignment.teamId);
  if (incident) incident.status = status;
  if (team && ['COMPLETED', 'CANCELLED'].includes(status)) {
    team.availability = 'AVAILABLE';
    team.currentAssignment = null;
    team.currentDestination = null;
    team.workload = Math.max(0, team.workload - 1);
  }
  auditTrail.push({ at: timestamp, action: `ASSIGNMENT_${status}`, incidentId: assignment.incidentId, teamId: assignment.teamId, assignmentId, operatorId });
  return { ...assignment, history: [...assignment.history] };
}

export function getAssignments() {
  return assignments.map((assignment) => ({ ...assignment, history: [...assignment.history] }));
}

export function getDispatchAuditTrail() {
  return auditTrail.map((entry) => ({ ...entry }));
}

export const dispatchConfiguration = {
  highRiskThreshold: HIGH_RISK_THRESHOLD,
  criticalRiskThreshold: CRITICAL_RISK_THRESHOLD,
  teamLocationMaxAgeMinutes: TEAM_LOCATION_MAX_AGE_MS / 60000,
  roadConditionMaxAgeMinutes: ROAD_CONDITION_MAX_AGE_MS / 60000,
  roadConditionFeedConfigured: Boolean(ROAD_CONDITIONS_URL),
  etaWeight: ETA_WEIGHT,
  workloadWeight: WORKLOAD_WEIGHT,
};
