export type DynamicSectionProvider = () => string | undefined | Promise<string | undefined>;

export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = '<!-- DYNAMIC -->';

export class DynamicSectionRegistry {
  private sections = new Map<string, DynamicSectionProvider>();

  register(name: string, provider: DynamicSectionProvider): void {
    this.sections.set(name, provider);
  }

  unregister(name: string): void {
    this.sections.delete(name);
  }

  has(name: string): boolean {
    return this.sections.has(name);
  }

  async resolve(): Promise<string[]> {
    const results: string[] = [];
    for (const [name, provider] of this.sections) {
      try {
        const content = await provider();
        if (content?.trim()) {
          results.push(content.trim());
        }
      } catch {
        // Dynamic sections fail silently — don't crash the agent loop
      }
    }
    return results;
  }

  get size(): number {
    return this.sections.size;
  }
}
