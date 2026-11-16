import { randomUUID } from 'node:crypto';
import type { HookRequest } from './types.js';

/** Default maximum number of captured requests kept in memory. */
export const MAX_STORED_HOOKS = 200;

/** Fields needed to add an entry; `id` and `receivedAt` are assigned by the store. */
export type NewHookRequest = Omit<HookRequest, 'id' | 'receivedAt'>;

/**
 * In-memory ring buffer of captured webhook requests.
 *
 * Entries are stored newest-first; once the capacity is exceeded the oldest
 * entries are evicted, so memory usage stays bounded no matter how many
 * webhooks arrive.
 */
export class HookStore {
  private readonly entries: HookRequest[] = [];
  private readonly capacity: number;

  public constructor(capacity: number = MAX_STORED_HOOKS) {
    this.capacity = Math.max(1, Math.floor(capacity));
  }

  /**
   * Store a new request and return the stored entry (with generated id and timestamp).
   * Evicts the oldest entries when the capacity is exceeded.
   */
  public add(input: NewHookRequest): HookRequest {
    const entry: HookRequest = {
      id: randomUUID(),
      receivedAt: new Date().toISOString(),
      ...input,
    };
    this.entries.unshift(entry);
    if (this.entries.length > this.capacity) {
      this.entries.length = this.capacity;
    }
    return entry;
  }

  /** All stored entries, newest first. */
  public list(): HookRequest[] {
    return [...this.entries];
  }

  /** Find a single entry by id, or `undefined` when it is not stored (anymore). */
  public get(id: string): HookRequest | undefined {
    return this.entries.find((entry) => entry.id === id);
  }

  /** Remove all entries; returns how many were dropped. */
  public clear(): number {
    const removed = this.entries.length;
    this.entries.length = 0;
    return removed;
  }

  /** Number of entries currently stored. */
  public get size(): number {
    return this.entries.length;
  }
}
