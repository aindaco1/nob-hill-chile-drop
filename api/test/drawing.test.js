import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBelow, prepareDrawing, drawingSummary } from '../src/drawing.js';

test('random ranks reject biased high values and accept the next unbiased value', () => {
  let calls = 0;
  assert.equal(randomBelow(3, array => { array[0] = calls++ === 0 ? 0xffffffff : 5; }), 2);
  assert.equal(calls, 2);
});

test('all groups receive exactly one position; selection stops at first group that will not fit', () => {
  const entries = [{ id: 'a', group_size: 2 }, { id: 'b', group_size: 4 }, { id: 'c', group_size: 1 }];
  // Explicit draws choose i at each Fisher-Yates step, keeping [a,b,c].
  const draws = [2, 1];
  const result = prepareDrawing(entries, 5, array => { array[0] = draws.shift(); });
  assert.deepEqual(result.map(row => row.status), ['selected', 'waitlisted', 'waitlisted']);
  assert.equal(drawingSummary(result, 5).unusedCapacity, 3);
  assert.deepEqual(entries.map(row => row.id), ['a', 'b', 'c']);
});

test('each possible random rank is reachable once across all choices in a three-order shuffle', () => {
  const permutations = new Set();
  for (let first = 0; first < 3; first++) for (let second = 0; second < 2; second++) {
    const draws = [first, second];
    const result = prepareDrawing([1, 2, 3].map(id => ({ id, group_size: id })), 2000, array => { array[0] = draws.shift(); });
    permutations.add(result.map(row => row.entryId).join(','));
  }
  assert.equal(permutations.size, 6);
});

test('capacity never splits a group or exceeds the limit', () => {
  for (let capacity = 1; capacity <= 2000; capacity += 29) {
    const rows = prepareDrawing([1, 1000, 2000, 17, 5].map((group_size, id) => ({ id, group_size })), capacity);
    assert.ok(drawingSummary(rows, capacity).selectedPeople <= capacity);
    const firstWaiting = rows.findIndex(row => row.status === 'waitlisted');
    if (firstWaiting !== -1) assert.ok(rows.slice(firstWaiting).every(row => row.status === 'waitlisted'));
  }
});
