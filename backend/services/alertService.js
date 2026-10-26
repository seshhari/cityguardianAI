const alerts = [];

function createAlert(zone) {
  const alertId = `alert-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
  const severity = zone.risk.classification === 'Critical' ? 'critical' : 'warning';

  return {
    id: alertId,
    zone: zone.name,
    severity,
    factors: Object.entries(zone.risk.factors)
      .filter(([, value]) => value > 50)
      .map(([key, value]) => ({ key, value })),
    timestamp: new Date().toISOString(),
    acknowledged: false,
  };
}

export function generateAlerts(zones) {
  const generated = [];

  zones.forEach((zone) => {
    if (zone.risk.classification !== 'Safe') {
      const newAlert = createAlert(zone);
      generated.push(newAlert);
      alerts.push(newAlert);
    }
  });

  return generated;
}

export function getAlertFeed() {
  return alerts;
}

export function acknowledgeAlert(alertId) {
  const target = alerts.find((item) => item.id === alertId);
  if (!target) {
    return { acknowledged: false, message: 'Alert not found.' };
  }

  target.acknowledged = true;
  return { acknowledged: true, alertId };
}

export function getUnreadAlertCount() {
  return alerts.filter((alert) => !alert.acknowledged).length;
}
