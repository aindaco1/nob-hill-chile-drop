// One calculation for the ticking website and the share-image snapshot.
export function countdown(target, now) {
  if (!Number.isFinite(target) || !Number.isFinite(now)) return null;
  let remaining = Math.max(0, Math.floor((target - now) / 1000));
  const result = { ended: now >= target };
  for (const [unit, divisor] of Object.entries({ days: 86400, hours: 3600, minutes: 60, seconds: 1 })) {
    result[unit] = Math.floor(remaining / divisor);
    remaining %= divisor;
  }
  return result;
}
