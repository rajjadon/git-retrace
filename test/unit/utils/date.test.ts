import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAge, formatAbsolute } from '../../../src/utils/date';

// formatAbsolute renders in the local calendar; pin TZ so the test is deterministic on any host/CI.
process.env.TZ = 'UTC';

test('formatAge: reports relative distance with a suffix, using an injected "now"', () => {
  const now = new Date('2024-02-04T10:00:00Z');
  const threeDaysAgo = new Date('2024-02-01T10:00:00Z');
  assert.equal(formatAge(threeDaysAgo, now), '3 days ago');
});

test('formatAge: handles future dates too', () => {
  const now = new Date('2024-02-01T10:00:00Z');
  const inTwoDays = new Date('2024-02-03T10:00:00Z');
  assert.equal(formatAge(inTwoDays, now), 'in 2 days');
});

test('formatAbsolute: formats using the given date-fns pattern', () => {
  const date = new Date('2024-02-01T10:00:00Z');
  assert.equal(formatAbsolute(date, 'yyyy-MM-dd'), '2024-02-01');
});
