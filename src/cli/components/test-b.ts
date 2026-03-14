// test-b.ts - 测试组件 B

export interface TestBConfig {
  version: string;
  description: string;
  tags: string[];
}

export class TestB {
  private config: TestBConfig;

  constructor(config: TestBConfig) {
    this.config = config;
  }

  getInfo(): string {
    return `TestB v${this.config.version}: ${this.config.description}`;
  }

  getTags(): string[] {
    return this.config.tags;
  }

  addTag(tag: string): void {
    this.config.tags.push(tag);
  }
}

// 示例使用
const testB = new TestB({
  version: '1.0.0',
  description: 'A test component',
  tags: ['test', 'demo', 'typescript']
});

console.log(testB.getInfo());
console.log('Tags:', testB.getTags().join(', '));
