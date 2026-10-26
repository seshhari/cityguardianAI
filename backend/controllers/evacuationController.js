import {
  activateEvacuationMode,
  calculateEvacuationRoutes,
  evacuationConfiguration,
  getEvacuationOverview,
  getEvacuationSmsMessages,
  queueEvacuationSms,
  registerShelter,
  reportRoadClosure,
  retryEvacuationSms,
  updateShelter,
} from '../services/evacuationService.js';

function sendError(res, error) {
  return res.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : 'Evacuation service failed.',
  });
}

export function getEvacuationOverviewRoute(req, res) {
  res.json({ ...getEvacuationOverview(), configuration: evacuationConfiguration });
}

export async function getEvacuationRoute(req, res) {
  const { zoneId, shelterId, transportMode } = req.body || {};
  if (typeof zoneId !== 'string') {
    return res.status(400).json({ error: 'zoneId is required.' });
  }
  try {
    return res.json(await calculateEvacuationRoutes({ zoneId, shelterId, transportMode }));
  } catch (error) {
    return sendError(res, error);
  }
}

export function activateEvacuation(req, res) {
  try {
    return res.status(201).json({
      order: activateEvacuationMode({
        confirmation: req.body?.confirmation,
        operatorId: req.operatorId,
      }),
    });
  } catch (error) {
    return sendError(res, error);
  }
}

export function createShelter(req, res) {
  try {
    return res.status(201).json({ shelter: registerShelter(req.body) });
  } catch (error) {
    return sendError(res, error);
  }
}

export function patchShelter(req, res) {
  try {
    return res.json({ shelter: updateShelter(req.params.shelterId, req.body || {}) });
  } catch (error) {
    return sendError(res, error);
  }
}

export function createRoadCondition(req, res) {
  try {
    return res.status(201).json({ road: reportRoadClosure(req.body) });
  } catch (error) {
    return sendError(res, error);
  }
}

export async function createSmsBatch(req, res) {
  try {
    const messages = await queueEvacuationSms({
      recipients: req.body?.recipients,
      message: req.body?.message,
      operatorId: req.operatorId,
    });
    return res.status(201).json({
      messages,
      deliveryMode: evacuationConfiguration.smsGatewayConfigured ? 'GATEWAY' : 'SIMULATED',
    });
  } catch (error) {
    return sendError(res, error);
  }
}

export async function retrySms(req, res) {
  try {
    return res.json({ message: await retryEvacuationSms(req.params.messageId) });
  } catch (error) {
    return sendError(res, error);
  }
}

export function getSmsQueue(req, res) {
  res.json({
    messages: getEvacuationSmsMessages(),
    gatewayConfigured: evacuationConfiguration.smsGatewayConfigured,
    notice: evacuationConfiguration.smsGatewayConfigured
      ? 'SENT means the configured gateway explicitly confirmed delivery.'
      : 'SIMULATED and PENDING messages have not been sent to mobile networks.',
  });
}
