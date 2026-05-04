export interface ProcessedUpdatesStore {
  has(updateId: number): Promise<boolean>;
  mark(updateId: number): Promise<void>;
}

export class MemoryProcessedUpdatesStore implements ProcessedUpdatesStore {
  private readonly seen = new Map<number, number>();

  constructor(
    private readonly ttlMs = 24 * 60 * 60 * 1_000,
    private readonly maxSize = 10_000
  ) {}

  async has(updateId: number): Promise<boolean> {
    this.evictExpired();
    return this.seen.has(updateId);
  }

  async mark(updateId: number): Promise<void> {
    this.evictExpired();
    this.seen.set(updateId, Date.now());

    if (this.seen.size <= this.maxSize) {
      return;
    }

    const oldest = this.seen.keys().next().value;

    if (typeof oldest === 'number') {
      this.seen.delete(oldest);
    }
  }

  private evictExpired() {
    const cutoff = Date.now() - this.ttlMs;

    for (const [updateId, createdAt] of this.seen.entries()) {
      if (createdAt < cutoff) {
        this.seen.delete(updateId);
      }
    }
  }
}
