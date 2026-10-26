import {
  calculateTeamRoute,
  createFloodIncident,
  createRescueAssignment,
  dispatchConfiguration,
  getAssignments,
  getDispatchAuditTrail,
  getRescueOptions,
  listFloodIncidents,
  listRescueTeams,
  registerRescueTeam,
  updateAssignmentStatus,
  updateTeamLocation,
  updateRescueTeam,
  verifyFloodIncident,
} from '../services/rescueDispatchService.js';

function sendServiceError(res, error) {
  return res.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : 'Dispatch service failed.',
  });
}

function incidentMeetsThreshold(incident) {
  return incident.riskScore >= dispatchConfiguration.highRiskThreshold;
}

function getIncidentRecommendation(incidentId) {
  return getRescueOptions(incidentId);
}

export function getRescueTeams(req, res) {
  res.json({
    teams: listRescueTeams(),
    source: 'DEMO DATA — simulated teams; not live GPS positions',
    configuration: dispatchConfiguration,
  });
}

export function getAvailableRescueTeams(req, res) {
  res.json({
    teams: listRescueTeams({ availableOnly: true }),
    source: 'DEMO DATA — simulated teams; not live GPS positions',
  });
}

export function createRescueTeam(req, res) {
  try {
    return res.status(201).json({ team: registerRescueTeam(req.body) });
  } catch (error) {
    return sendServiceError(res, error);
  }
}

export function patchRescueTeam(req, res) {
  try {
    return res.json({ team: updateRescueTeam(req.params.teamId, req.body || {}) });
  } catch (error) {
    return sendServiceError(res, error);
  }
}

export function getFloodIncidents(req, res) {
  res.json({
    incidents: listFloodIncidents(),
    thresholds: dispatchConfiguration,
    source: 'Demo training incidents are explicitly marked and cannot be dispatched.',
  });
}

export async function getIncidentRescueOptions(req, res) {
  try {
    return res.json(await getRescueOptions(req.params.incidentId));
  } catch (error) {
    return sendServiceError(res, error);
  }
}

export async function calculateRoute(req, res) {
  const { teamId, incidentId } = req.body || {};
  if (typeof teamId !== 'string' || typeof incidentId !== 'string') {
    return res.status(400).json({ error: 'teamId and incidentId are required.' });
  }
  try {
    return res.json(await calculateTeamRoute(teamId, incidentId));
  } catch (error) {
    return sendServiceError(res, error);
  }
}

export async function reportFloodIncident(req, res) {
  try {
    const incident = createFloodIncident(req.body);
    const dispatchRecommendation = incidentMeetsThreshold(incident)
      ? await getIncidentRecommendation(incident.id)
      : null;
    return res.status(201).json({ incident, dispatchRecommendation });
  } catch (error) {
    return sendServiceError(res, error);
  }
}

export async function verifyIncident(req, res) {
  try {
    const incident = verifyFloodIncident(req.params.incidentId, req.body || {});
    const dispatchRecommendation = await getIncidentRecommendation(incident.id);
    return res.json({ incident, dispatchRecommendation });
  } catch (error) {
    return sendServiceError(res, error);
  }
}

export function updateLocation(req, res) {
  try {
    return res.json({ team: updateTeamLocation(req.params.teamId, req.body || {}) });
  } catch (error) {
    return sendServiceError(res, error);
  }
}

export async function createAssignment(req, res) {
  const { incidentId, teamId, confirmation } = req.body || {};
  if (confirmation !== true) {
    return res.status(400).json({ error: 'Explicit operator confirmation is required.' });
  }
  if (typeof incidentId !== 'string' || typeof teamId !== 'string') {
    return res.status(400).json({ error: 'incidentId and teamId are required.' });
  }
  try {
    return res.status(201).json({
      assignment: await createRescueAssignment({ incidentId, teamId, operatorId: req.operatorId }),
    });
  } catch (error) {
    return sendServiceError(res, error);
  }
}

export async function updateAssignment(req, res) {
  const { status, confirmation } = req.body || {};
  if (confirmation !== true) {
    return res.status(400).json({ error: 'Explicit operator confirmation is required.' });
  }
  try {
    return res.json({
      assignment: await updateAssignmentStatus(req.params.assignmentId, {
        status,
        operatorId: req.operatorId,
      }),
    });
  } catch (error) {
    return sendServiceError(res, error);
  }
}

export function getRescueAssignments(req, res) {
  res.json({ assignments: getAssignments() });
}

export function getDispatchAudit(req, res) {
  res.json({
    auditTrail: getDispatchAuditTrail(),
    persistence: 'In-memory demo audit trail; entries reset when the backend restarts.',
  });
}
