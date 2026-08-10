import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGravatarUrl } from '../../../src/utils/gravatar';

test('buildGravatarUrl: matches Gravatar\'s documented example hash', () => {
  const url = buildGravatarUrl('MyEmailAddress@example.com');
  assert.equal(url, 'https://www.gravatar.com/avatar/0bc83cb571cd1c50ba6f3e8a78ef1346?s=64&d=identicon');
});

test('buildGravatarUrl: trims whitespace and lowercases before hashing', () => {
  const a = buildGravatarUrl('  Raj@Example.com  ');
  const b = buildGravatarUrl('raj@example.com');
  assert.equal(a, b);
});

test('buildGravatarUrl: respects size and default options', () => {
  const url = buildGravatarUrl('raj@example.com', { size: 128, default: 'retro' });
  assert.equal(url, 'https://www.gravatar.com/avatar/451567fb986d4b3f1daf911bcf274a3b?s=128&d=retro');
});
