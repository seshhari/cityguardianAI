import express from 'express';
import { requireOperator } from '../middleware/requireOperator.js';
import {
  activateEvacuation,
  createRoadCondition,
  createShelter,
  createSmsBatch,
  getEvacuationOverviewRoute,
  getEvacuationRoute,
  getSmsQueue,
  patchShelter,
  retrySms,
} from '../controllers/evacuationController.js';
import {
  calculateRoute,
  createAssignment,
  createRescueTeam,
  getAvailableRescueTeams,
  getDispatchAudit,
  getFloodIncidents,
  getIncidentRescueOptions,
  getRescueAssignments,
  getRescueTeams,
  reportFloodIncident,
  patchRescueTeam,
  updateAssignment,
  updateLocation,
  verifyIncident,
} from '../controllers/rescueController.js';
import {
  getHealth,
  getWeather,
  getZones,
  getSensors,
  getRisk,
  listAlerts,
  acknowledgeAlertRoute,
  getRoutes,
  getAnalytics,
  getDemoConfig,
} from '../controllers/floodController.js';

const router = express.Router();

router.get('/health', getHealth);
router.get('/weather', getWeather);
router.get('/zones', getZones);
router.get('/sensors', getSensors);
router.get('/risk', getRisk);
router.get('/alerts', listAlerts);
router.post('/alerts/acknowledge', acknowledgeAlertRoute);
router.post('/routes', getRoutes);
router.get('/rescue-teams', getRescueTeams);
router.get('/rescue-teams/available', getAvailableRescueTeams);
router.post('/rescue-teams', requireOperator, createRescueTeam);
router.patch('/rescue-teams/:teamId', requireOperator, patchRescueTeam);
router.patch('/rescue-teams/:teamId/location', requireOperator, updateLocation);
router.get('/flood-incidents', getFloodIncidents);
router.post('/flood-incidents', requireOperator, reportFloodIncident);
router.get('/flood-incidents/:incidentId/rescue-options', getIncidentRescueOptions);
router.patch('/flood-incidents/:incidentId/verification', requireOperator, verifyIncident);
router.post('/routes/calculate', calculateRoute);
router.post('/rescue-assignments', requireOperator, createAssignment);
router.patch('/rescue-assignments/:assignmentId/status', requireOperator, updateAssignment);
router.get('/rescue-assignments', getRescueAssignments);
router.get('/dispatch-audit', getDispatchAudit);
router.get('/evacuation/overview', getEvacuationOverviewRoute);
router.post('/evacuation/routes', getEvacuationRoute);
router.post('/evacuation/activate', requireOperator, activateEvacuation);
router.post('/evacuation/shelters', requireOperator, createShelter);
router.patch('/evacuation/shelters/:shelterId', requireOperator, patchShelter);
router.post('/evacuation/road-conditions', requireOperator, createRoadCondition);
router.get('/evacuation/sms', requireOperator, getSmsQueue);
router.post('/evacuation/sms', requireOperator, createSmsBatch);
router.post('/evacuation/sms/:messageId/retry', requireOperator, retrySms);
router.get('/analytics', getAnalytics);
router.get('/config', getDemoConfig);

export default router;
