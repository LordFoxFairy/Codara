/**
 * Generic typed event emitter with no dependencies.
 *
 * Designed for the bus layer where a single event type flows through
 * and listeners must never break each other.
 */
export class TypedEmitter<T> {
  private listeners = new Set<(event: T) => void>();

  /** Subscribe to events. Returns an unsubscribe function. */
  on(listener: (event: T) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Emit an event to all listeners. One listener throwing does not affect others. */
  emit(event: T): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Swallow — one listener must not break others.
      }
    }
  }

  /** Remove all listeners. */
  clear(): void {
    this.listeners.clear();
  }
}
