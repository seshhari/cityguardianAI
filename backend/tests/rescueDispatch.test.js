import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRoadRoutes } from '../services/routingService.js';
import {
  createFloodIncident,
  createRescueAssignment,
  isTeamEligible,
  listRescueTeams,
  parseRoadConditionResult,
  rankRescueCandidates,
} from '../services/rescueDispatchService.js';

test('road-condition results must be complete and fresh before a route can be verified safe', () => {
  const checkedAt = new Date().toISOString();

  assert.equal(parseRoadConditionResult({
    coverageComplete: true,
    checkedAt,
    hazards: [],
  }).status, 'VERIFIED_SAFE');

  assert.equal(parseRoadConditionResult({
    coverageComplete: false,
    checkedAt,
    hazards: [],
  }).status, 'UNVERIFIED');

  assert.equal(parseRoadConditionResult({
    coverageComplete: true,
    checkedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    hazards: [],
  }).status, 'UNVERIFIED');
});

test('a route crossing a reported closure or flood segment is not feasible', () => {
  const result = parseRoadConditionResult({
    coverageComplete: true,
    checkedAt: new Date().toISOString(),
    hazards: [
      { id: 'closure-1', name: 'Closed bridge', status: 'UNSAFE_BRIDGE', intersectsRoute: true },
    ],
  });

  assert.equal(result.status, 'UNSAFE');
  assert.equal(result.verified, false);
  assert.equal(result.excludedRoadSegments[0].id, 'closure-1');
});

test('routing does not invent a route when OpenRouteService is unavailable', async () => {
  const originalKey = process.env.ORS_API_KEY;
  delete process.env.ORS_API_KEY;

  try {
    const result = await calculateRoadRoutes(
      { latitude: -2.170, longitude: -79.910 },
      { latitude: -2.170998, longitude: -79.922359 },
    );
    assert.deepEqual(result.routes, []);
    assert.equal(result.source, 'UNAVAILABLE');
    assert.match(result.error, /No road route was generated/);
  } finally {
    if (originalKey === undefined) delete process.env.ORS_API_KEY;
    else process.env.ORS_API_KEY = originalKey;
  }
});

test('training-scenario incidents cannot be assigned to real rescue teams', async () => {
  await assert.rejects(
    createRescueAssignment({ incidentId: 'DEMO-INC-001', teamId: 'R-01' }),
    /Demo scenarios cannot be assigned/,
  );
});

test('a farther team with a verified feasible road route outranks a blocked closer team', () => {
  const incident = { isDemoData: false, verificationStatus: 'VERIFIED' };
  const { ranked, recommendedTeam } = rankRescueCandidates([
    {
      team: { id: 'near', name: 'Near but blocked', isDemoData: false },
      feasible: false,
      route: { durationMinutes: 4 },
      workload: 0,
    },
    {
      team: { id: 'far', name: 'Farther and safe', isDemoData: false },
      feasible: true,
      route: { durationMinutes: 18 },
      workload: 1,
    },
  ], incident);

  assert.equal(ranked[0].team.id, 'far');
  assert.equal(recommendedTeam.teamId, 'far');
});

test('no safe route, unavailable teams, or stale GPS cannot produce an eligible recommendation', () => {
  const incident = { severity: 'CRITICAL', peopleRequiringAssistance: 2 };
  const sampleTeam = listRescueTeams()[0];

  assert.equal(isTeamEligible({ ...sampleTeam, availability: 'BUSY' }, incident), false);
  assert.equal(isTeamEligible({
    ...sampleTeam,
    lastLocationUpdate: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  }, incident), false);
  assert.equal(rankRescueCandidates([{
    team: { id: 'R-X', isDemoData: false },
    feasible: false,
    route: { durationMinutes: 3 },
    workload: 0,
  }], { isDemoData: false, verificationStatus: 'VERIFIED' }).recommendedTeam, null);
});

test('incident reports validate geographic coordinates and preserve unverified state', () => {
  assert.throws(
    () => createFloodIncident({
      location: 'Test location',
      coordinates: { latitude: 120, longitude: 80 },
      riskScore: 80,
      severity: 'HIGH',
    }),
    /Valid incident latitude and longitude/,
  );

  const incident = createFloodIncident({
    location: 'Operator reported location',
    coordinates: { latitude: -2.17, longitude: -79.92 },
    riskScore: 80,
    severity: 'HIGH',
  });
  assert.equal(incident.isDemoData, false);
  assert.equal(incident.verificationStatus, 'UNVERIFIED');
  assert.equal(incident.status, 'REPORTED');
});
