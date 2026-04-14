export class StreamBuffer {
  private chunks: string[] = [];
  private listeners = new Set<(text: string) => void>();

  append(chunk: string): void {
    this.chunks.push(chunk);
    for (const listener of this.listeners) {
      try {
        listener(chunk);
      } catch {
        /* ignore */
      }
    }
  }

  getText(): string {
    return this.chunks.join('');
  }

  getLineCount(): number {
    return this.getText().split('\n').length;
  }

  onChunk(listener: (chunk: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.chunks = [];
  }
}
