/**
 * Tracks repeated permission denials to reduce user fatigue.
 * After N denials of the same tool pattern, auto-deny without asking.
 */

export interface DenialRecord {
  toolName: string;
  count: number;
  lastDeniedAt: number;
}

export class DenialTracker {
  private records = new Map<string, DenialRecord>();
  private readonly threshold: number;
  private readonly windowMs: number;

  constructor(options?: { threshold?: number; windowMs?: number }) {
    this.threshold = options?.threshold ?? 3;
    this.windowMs = options?.windowMs ?? 5 * 60 * 1000; // 5 minutes
  }

  /** Record a denial for a tool. Expired records are reset before counting. */
  recordDenial(toolName: string): void {
    const now = Date.now();
    const existing = this.records.get(toolName);

    if (existing && now - existing.lastDeniedAt < this.windowMs) {
      existing.count += 1;
      existing.lastDeniedAt = now;
    } else {
      this.records.set(toolName, { toolName, count: 1, lastDeniedAt: now });
    }
  }

  /** Returns true if the tool has been denied >= threshold times within the window. */
  shouldAutoDeny(toolName: string): boolean {
    const record = this.records.get(toolName);
    if (!record) return false;

    const now = Date.now();
    if (now - record.lastDeniedAt >= this.windowMs) {
      // Window expired — clear the record
      this.records.delete(toolName);
      return false;
    }

    return record.count >= this.threshold;
  }

  /** Reset denial records. If toolName is given, reset only that tool; otherwise reset all. */
  reset(toolName?: string): void {
    if (toolName !== undefined) {
      this.records.delete(toolName);
    } else {
      this.records.clear();
    }
  }
}
