/** Size-bounded in-memory cache whose entries expire; evicts the oldest entry when full. */
export class TtlCache<K, V> {
  readonly #entries = new Map<K, { value: V; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: K): V | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V): void {
    this.#entries.delete(key);
    if (this.#entries.size >= this.maxEntries) {
      const oldest = this.#entries.keys().next();
      if (!oldest.done) this.#entries.delete(oldest.value);
    }
    this.#entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  delete(key: K): void {
    this.#entries.delete(key);
  }
}
