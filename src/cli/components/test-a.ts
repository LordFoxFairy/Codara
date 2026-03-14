// test-a.ts - 测试组件 A

export interface TestAConfig {
  id: string;
  name: string;
  enabled: boolean;
}

export class TestA {
  private config: TestAConfig;

  constructor(config: TestAConfig) {
    this.config = config;
  }

  greet(): string {
    return `Hello from TestA! ID: ${this.config.id}, Name: ${this.config.name}`;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }
}

// 示例使用
const testA = new TestA({
  id: '001',
  name: 'Component A',
  enabled: true
});

console.log(testA.greet());
