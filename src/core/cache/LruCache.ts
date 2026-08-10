/** Generic bounded LRU cache. Recency is refreshed on both `get` and `set`. */
export class LruCache<K, V> {
  private readonly store = new Map<K, V>();

  constructor(private readonly maxSize: number) {
    if (maxSize <= 0) {
      throw new RangeError('LruCache maxSize must be > 0');
    }
  }

  get(key: K): V | undefined {
    if (!this.store.has(key)) {
      return undefined;
    }
    const value = this.store.get(key) as V;
    // Re-insert to move this key to the most-recently-used end.
    this.store.delete(key);
    this.store.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxSize) {
      const oldestKey = this.store.keys().next().value as K;
      this.store.delete(oldestKey);
    }
    this.store.set(key, value);
  }

  has(key: K): boolean {
    return this.store.has(key);
  }

  delete(key: K): boolean {
    return this.store.delete(key);
  }

  /** Deletes every entry whose key satisfies `predicate` — used for prefix-based invalidation. */
  deleteWhere(predicate: (key: K) => boolean): void {
    for (const key of this.store.keys()) {
      if (predicate(key)) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
