// Fisher–Yates with rejection sampling avoids modulo bias in random ranks.
export function randomBelow(maximum, random = crypto.getRandomValues.bind(crypto)) {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 0x100000000) throw new RangeError('Invalid random bound');
  const limit = Math.floor(0x100000000 / maximum) * maximum;
  const buffer = new Uint32Array(1);
  do { random(buffer); } while (buffer[0] >= limit);
  return buffer[0] % maximum;
}

export function prepareDrawing(entries, capacity, random) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 2000) throw new RangeError('Invalid capacity');
  const shuffled = entries.map(entry => ({ ...entry }));
  if (shuffled.some(entry => !Number.isInteger(entry.group_size) || entry.group_size < 1 || entry.group_size > 2000)) throw new RangeError('Invalid group');
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = randomBelow(i + 1, random);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  let used = 0;
  let stopped = false;
  return shuffled.map((entry, index) => {
    if (used + entry.group_size > capacity) stopped = true;
    const status = stopped ? 'waitlisted' : 'selected';
    if (!stopped) used += entry.group_size;
    return { entryId: entry.id, rank: index + 1, status, groupSize: entry.group_size };
  });
}

export function drawingSummary(results, capacity) {
  const selected = results.filter(entry => entry.status === 'selected');
  const selectedPeople = selected.reduce((sum, entry) => sum + entry.groupSize, 0);
  return {
    capacity,
    eligibleOrders: results.length,
    selectedOrders: selected.length,
    selectedPeople,
    waitlistedOrders: results.length - selected.length,
    waitlistedPeople: results.filter(entry => entry.status === 'waitlisted').reduce((sum, entry) => sum + entry.groupSize, 0),
    unusedCapacity: capacity - selectedPeople
  };
}
