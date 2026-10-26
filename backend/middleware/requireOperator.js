import { timingSafeEqual } from 'node:crypto';

export function requireOperator(req, res, next) {
  const expectedToken = process.env.DISPATCH_OPERATOR_TOKEN;
  if (!expectedToken) {
    return res.status(503).json({
      error: 'Dispatch actions are disabled until DISPATCH_OPERATOR_TOKEN is configured.',
    });
  }

  const authorization = req.get('authorization') || '';
  const suppliedToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';
  const expected = Buffer.from(expectedToken);
  const supplied = Buffer.from(suppliedToken);
  const valid = expected.length === supplied.length && timingSafeEqual(expected, supplied);

  if (!valid) {
    return res.status(403).json({ error: 'Authorized operator confirmation is required.' });
  }

  req.operatorId = 'authorized-operator';
  return next();
}
