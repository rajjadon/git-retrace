import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LruCache } from '../../../../src/core/cache/LruCache';

test('LruCache: get/set/has/delete basics', () => {
  const cache = new LruCache<string, number>(2);
  assert.equal(cache.has('a'), false);
  cache.set('a', 1);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.has('a'), true);
  cache.delete('a');
  assert.equal(cache.has('a'), false);
});

test('LruCache: evicts the least-recently-used entry when full', () => {
  const cache = new LruCache<string, number>(2);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3); // evicts 'a' — it was inserted first and never re-touched
  assert.equal(cache.has('a'), false);
  assert.equal(cache.has('b'), true);
  assert.equal(cache.has('c'), true);
  assert.equal(cache.size, 2);
});

test('LruCache: get() refreshes recency, protecting the entry from eviction', () => {
  const cache = new LruCache<string, number>(2);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.get('a'); // 'a' is now most-recently-used; 'b' becomes least-recently-used
  cache.set('c', 3); // evicts 'b', not 'a'
  assert.equal(cache.has('a'), true);
  assert.equal(cache.has('b'), false);
  assert.equal(cache.has('c'), true);
});

test('LruCache: set() on an existing key refreshes recency and overwrites the value', () => {
  const cache = new LruCache<string, number>(2);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('a', 10); // refreshes 'a', so 'b' is now least-recently-used
  cache.set('c', 3); // evicts 'b'
  assert.equal(cache.get('a'), 10);
  assert.equal(cache.has('b'), false);
});

test('LruCache: deleteWhere removes only matching keys', () => {
  const cache = new LruCache<string, number>(10);
  cache.set('repo1:file.ts:HEAD', 1);
  cache.set('repo1:other.ts:HEAD', 2);
  cache.set('repo2:file.ts:HEAD', 3);
  cache.deleteWhere((key) => key.startsWith('repo1:'));
  assert.equal(cache.has('repo1:file.ts:HEAD'), false);
  assert.equal(cache.has('repo1:other.ts:HEAD'), false);
  assert.equal(cache.has('repo2:file.ts:HEAD'), true);
});

test('LruCache: clear() empties the cache', () => {
  const cache = new LruCache<string, number>(2);
  cache.set('a', 1);
  cache.clear();
  assert.equal(cache.size, 0);
});

test('LruCache: rejects non-positive maxSize', () => {
  assert.throws(() => new LruCache<string, number>(0));
});
