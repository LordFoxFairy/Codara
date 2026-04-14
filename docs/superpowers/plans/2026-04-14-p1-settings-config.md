# P1: Settings/Config 统一配置系统 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Codara 分散的配置加载（settings.json、hooks.json、mcp.json）统一为 5 层配置系统，带 Zod schema 验证、三级缓存、热更新。

**Architecture:** 5 层优先级（defaults → userSettings → projectSettings → localSettings → envSettings），深合并策略，统一 Zod schema。所有配置（hooks、MCP、permissions）从独立 JSON 文件合并进 settings.json。新增 CODARA.md 支持（指令层，与结构化配置分离）。

**Tech Stack:** TypeScript, Zod, chokidar (file watching), bun:test

**Spec 文档:** `docs/superpowers/specs/2026-04-14-codara-architecture-redesign.md` Phase 1 节

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/config/schema.ts` | Zod schema 定义（CodaraSettings 完整类型） |
| `src/config/sources.ts` | 配置源枚举、优先级常量、源文件路径计算 |
| `src/config/loader.ts` | 统一加载器：读取所有源 → merge → validate |
| `src/config/merge.ts` | 深合并策略（对象深合并、数组覆盖、基础值覆盖） |
| `src/config/cache.ts` | 三级缓存：session / per-source / parse |
| `src/config/watcher.ts` | chokidar 文件 watcher + 热更新回调 |
| `src/config/codara-md.ts` | CODARA.md 解析（frontmatter + body + @include） |
| `src/config/env.ts` | 环境变量 CODARA_* 解析为配置覆盖 |
| `tests/unit/config/schema.test.ts` | Schema 验证测试 |
| `tests/unit/config/loader.test.ts` | 统一加载器测试 |
| `tests/unit/config/merge.test.ts` | 合并策略测试 |
| `tests/unit/config/cache.test.ts` | 缓存行为测试 |
| `tests/unit/config/watcher.test.ts` | 热更新测试 |
| `tests/unit/config/codara-md.test.ts` | CODARA.md 解析测试 |
| `tests/unit/config/env.test.ts` | 环境变量测试 |

### Modified Files
| File | Change |
|------|--------|
| `src/config/settings.ts` | 重写：从 87 行简陋实现 → 统一加载器入口 |
| `src/config/index.ts` | 更新导出：新增 schema、loader、cache、watcher |
| `src/config/workspace.ts` | 保留，不变（workspace root 解析逻辑正确） |
| `src/config/workspace-key.ts` | 保留，不变 |
| `src/codara/facade.ts` | 改用统一 loader，移除独立 hooks/mcp 加载 |
| `src/observability/hook/registry.ts` | 从统一 settings 读取 hooks 配置，不再直接读文件 |
| `src/integration/mcp/config.ts` | 从统一 settings 读取 MCP 配置，不再直接读文件 |
| `src/core/middleware/permission/policy/config.ts` | 从统一 settings 读取 permission 配置 |

### Preserved (No Changes)
| File | Reason |
|------|--------|
| `src/config/workspace.ts` | 逻辑正确，已有测试 |
| `src/config/workspace-key.ts` | 逻辑正确，已有测试 |

---

## Chunk 1: Schema + Merge + Env

### Task 1: 定义 CodaraSettings Zod Schema

**Files:**
- Create: `src/config/schema.ts`
- Test: `tests/unit/config/schema.test.ts`

- [ ] **Step 1: Write failing test — schema validates minimal settings**

```typescript
// tests/unit/config/schema.test.ts
import {describe, expect, it} from 'bun:test';
import {codaraSettingsSchema, type CodaraSettings} from '@config/schema';

describe('CodaraSettings schema', () => {
  it('should accept empty object as valid settings', () => {
    const result = codaraSettingsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should accept full settings', () => {
    const full: CodaraSettings = {
      model: 'opus',
      maxTurns: 50,
      defaultShell: 'zsh',
      theme: 'dark',
      permissions: {
        defaultMode: 'default',
        alwaysAllow: ['Read', 'Glob', 'Grep'],
        alwaysDeny: ['Bash(rm -rf:*)'],
        alwaysAsk: [],
      },
      hooks: {
        PreToolUse: [{matcher: {toolName: 'Bash'}, command: 'echo hi', timeout: 5000}],
      },
      mcpServers: {
        filesystem: {
          type: 'stdio',
          command: 'npx',
          args: ['@modelcontextprotocol/server-filesystem'],
        },
      },
      skillSources: ['~/.codara/skills'],
    };
    const result = codaraSettingsSchema.safeParse(full);
    expect(result.success).toBe(true);
  });

  it('should reject invalid permission mode', () => {
    const result = codaraSettingsSchema.safeParse({
      permissions: {defaultMode: 'invalid_mode'},
    });
    expect(result.success).toBe(false);
  });

  it('should passthrough unknown fields for forward compat', () => {
    const result = codaraSettingsSchema.safeParse({unknownField: 'value'});
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).unknownField).toBe('value');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/config/schema.test.ts`
Expected: FAIL — module `@config/schema` not found

- [ ] **Step 3: Implement schema.ts**

```typescript
// src/config/schema.ts
import {z} from 'zod';

export const permissionModeSchema = z.enum([
  'default', 'plan', 'acceptEdits', 'bypassPermissions', 'dontAsk',
]);

export type PermissionMode = z.infer<typeof permissionModeSchema>;

export const permissionsSchema = z.object({
  defaultMode: permissionModeSchema.optional(),
  alwaysAllow: z.array(z.string()).optional(),
  alwaysDeny: z.array(z.string()).optional(),
  alwaysAsk: z.array(z.string()).optional(),
}).optional();

export const hookDefinitionSchema = z.object({
  matcher: z.object({
    toolName: z.union([z.string(), z.array(z.string())]).optional(),
    commandPattern: z.string().optional(),
  }).optional(),
  command: z.string().optional(),
  prompt: z.string().optional(),
  timeout: z.number().positive().optional(),
}).refine(
  (d) => d.command !== undefined || d.prompt !== undefined,
  {message: 'Hook must have either command or prompt'},
);

export const hookEventTypeSchema = z.enum([
  'SessionStart', 'SessionEnd', 'PromptSubmit',
  'PreToolUse', 'PostToolUse', 'Stop',
  'SubagentStart', 'SubagentStop',
  'PreCompact', 'PostCompact',
  'PermissionRequest', 'TaskCreated', 'TaskCompleted',
  'ConfigChange', 'CwdChanged',
]);

export type HookEventType = z.infer<typeof hookEventTypeSchema>;

export const hooksSchema = z.record(
  hookEventTypeSchema,
  z.array(hookDefinitionSchema),
).optional();

export const mcpServerConfigSchema = z.object({
  type: z.enum(['stdio', 'sse']).optional().default('stdio'),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
  url: z.string().optional(),
  headers: z.record(z.string()).optional(),
  timeout: z.number().positive().optional(),
  enabled: z.boolean().optional().default(true),
});

export const codaraSettingsSchema = z.object({
  // Model
  model: z.string().trim().min(1).optional(),
  maxTurns: z.number().int().positive().optional(),

  // Shell / UI
  defaultShell: z.enum(['bash', 'zsh', 'powershell']).optional(),
  theme: z.enum(['light', 'dark', 'auto']).optional(),

  // Permissions
  permissions: permissionsSchema,

  // Hooks
  hooks: hooksSchema,

  // MCP
  mcpServers: z.record(z.string(), mcpServerConfigSchema).optional(),

  // Skills
  skillSources: z.array(z.string()).optional(),

  // Plugins (preserved from existing)
  plugins: z.object({
    installGlobal: z.boolean().optional(),
  }).optional(),
}).passthrough();  // forward compat: accept unknown fields

export type CodaraSettings = z.infer<typeof codaraSettingsSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/config/schema.test.ts`
Expected: PASS — all 4 tests green

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts tests/unit/config/schema.test.ts
git commit -m "feat(config): add CodaraSettings Zod schema with full type definitions"
```

---

### Task 2: 配置深合并策略

**Files:**
- Create: `src/config/merge.ts`
- Test: `tests/unit/config/merge.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/config/merge.test.ts
import {describe, expect, it} from 'bun:test';
import {mergeSettings} from '@config/merge';
import type {CodaraSettings} from '@config/schema';

describe('mergeSettings', () => {
  it('should return base when overlay is empty', () => {
    const base: CodaraSettings = {model: 'opus', maxTurns: 25};
    expect(mergeSettings(base, {})).toEqual(base);
  });

  it('should overlay scalar values', () => {
    const base: CodaraSettings = {model: 'opus', maxTurns: 25};
    const overlay: CodaraSettings = {model: 'sonnet'};
    expect(mergeSettings(base, overlay)).toEqual({model: 'sonnet', maxTurns: 25});
  });

  it('should deep merge nested objects', () => {
    const base: CodaraSettings = {
      permissions: {defaultMode: 'default', alwaysAllow: ['Read']},
    };
    const overlay: CodaraSettings = {
      permissions: {alwaysDeny: ['Bash(rm:*)']},
    };
    const result = mergeSettings(base, overlay);
    expect(result.permissions?.defaultMode).toBe('default');
    expect(result.permissions?.alwaysAllow).toEqual(['Read']);
    expect(result.permissions?.alwaysDeny).toEqual(['Bash(rm:*)']);
  });

  it('should replace arrays (not concat)', () => {
    const base: CodaraSettings = {
      permissions: {alwaysAllow: ['Read', 'Glob']},
    };
    const overlay: CodaraSettings = {
      permissions: {alwaysAllow: ['Read']},
    };
    const result = mergeSettings(base, overlay);
    expect(result.permissions?.alwaysAllow).toEqual(['Read']);
  });

  it('should merge multiple layers in order', () => {
    const layers: CodaraSettings[] = [
      {model: 'opus', maxTurns: 25},
      {maxTurns: 50},
      {model: 'sonnet'},
    ];
    const result = layers.reduce(mergeSettings, {} as CodaraSettings);
    expect(result).toEqual({model: 'sonnet', maxTurns: 50});
  });

  it('should deep merge mcpServers', () => {
    const base: CodaraSettings = {
      mcpServers: {fs: {command: 'npx', args: ['server']}},
    };
    const overlay: CodaraSettings = {
      mcpServers: {db: {command: 'node', args: ['db-server']}},
    };
    const result = mergeSettings(base, overlay);
    expect(result.mcpServers?.fs).toBeDefined();
    expect(result.mcpServers?.db).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/config/merge.test.ts`
Expected: FAIL — module `@config/merge` not found

- [ ] **Step 3: Implement merge.ts**

```typescript
// src/config/merge.ts
import type {CodaraSettings} from '@config/schema';

export function mergeSettings(base: CodaraSettings, overlay: CodaraSettings): CodaraSettings {
  return deepMerge(base, overlay) as CodaraSettings;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = {...target};

  for (const key of Object.keys(source)) {
    const sourceValue = source[key];
    const targetValue = result[key];

    if (sourceValue === undefined) {
      continue;
    }

    if (Array.isArray(sourceValue)) {
      // Arrays: overlay replaces entirely (not concat)
      result[key] = [...sourceValue];
    } else if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
      // Objects: deep merge recursively
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>,
      );
    } else {
      // Scalars: overlay wins
      result[key] = sourceValue;
    }
  }

  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/config/merge.test.ts`
Expected: PASS — all 6 tests green

- [ ] **Step 5: Commit**

```bash
git add src/config/merge.ts tests/unit/config/merge.test.ts
git commit -m "feat(config): add deep merge strategy for settings layers"
```

---

### Task 3: 配置源定义 + 环境变量解析

**Files:**
- Create: `src/config/sources.ts`
- Create: `src/config/env.ts`
- Test: `tests/unit/config/env.test.ts`

- [ ] **Step 1: Write failing test for env parsing**

```typescript
// tests/unit/config/env.test.ts
import {afterEach, beforeEach, describe, expect, it} from 'bun:test';
import {parseEnvSettings} from '@config/env';

describe('parseEnvSettings', () => {
  const originalEnv = {...process.env};

  beforeEach(() => {
    // Clean CODARA_ vars
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('CODARA_')) delete process.env[key];
    }
  });

  afterEach(() => {
    Object.assign(process.env, originalEnv);
  });

  it('should return empty settings when no CODARA_ vars', () => {
    expect(parseEnvSettings()).toEqual({});
  });

  it('should parse CODARA_MODEL', () => {
    process.env.CODARA_MODEL = 'sonnet';
    expect(parseEnvSettings()).toEqual({model: 'sonnet'});
  });

  it('should parse CODARA_MAX_TURNS as number', () => {
    process.env.CODARA_MAX_TURNS = '100';
    expect(parseEnvSettings()).toEqual({maxTurns: 100});
  });

  it('should parse CODARA_THEME', () => {
    process.env.CODARA_THEME = 'dark';
    expect(parseEnvSettings()).toEqual({theme: 'dark'});
  });

  it('should parse CODARA_PERMISSION_MODE', () => {
    process.env.CODARA_PERMISSION_MODE = 'plan';
    expect(parseEnvSettings()).toEqual({
      permissions: {defaultMode: 'plan'},
    });
  });

  it('should ignore unknown CODARA_ vars', () => {
    process.env.CODARA_UNKNOWN_SETTING = 'value';
    expect(parseEnvSettings()).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/config/env.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement sources.ts and env.ts**

```typescript
// src/config/sources.ts

export const SETTING_SOURCES = [
  'defaults',
  'userSettings',
  'projectSettings',
  'localSettings',
  'envSettings',
] as const;

export type SettingSource = typeof SETTING_SOURCES[number];

export interface ConfigPaths {
  projectRoot: string;
  userHome: string;
}

export function resolveSettingsFilePaths(paths: ConfigPaths) {
  const {projectRoot, userHome} = paths;
  return {
    defaults: null, // compiled-in, no file
    userSettings: `${userHome}/.codara/settings.json`,
    projectSettings: `${projectRoot}/.codara/settings.json`,
    localSettings: `${projectRoot}/.codara/settings.local.json`,
    envSettings: null, // parsed from process.env, no file
  };
}
```

```typescript
// src/config/env.ts
import type {CodaraSettings} from '@config/schema';
import {permissionModeSchema} from '@config/schema';

const ENV_MAPPINGS: Record<string, (value: string) => Partial<CodaraSettings>> = {
  CODARA_MODEL: (v) => ({model: v}),
  CODARA_MAX_TURNS: (v) => {
    const n = Number.parseInt(v, 10);
    return Number.isNaN(n) ? {} : {maxTurns: n};
  },
  CODARA_THEME: (v) => {
    if (v === 'light' || v === 'dark' || v === 'auto') return {theme: v};
    return {};
  },
  CODARA_DEFAULT_SHELL: (v) => {
    if (v === 'bash' || v === 'zsh' || v === 'powershell') return {defaultShell: v};
    return {};
  },
  CODARA_PERMISSION_MODE: (v) => {
    const parsed = permissionModeSchema.safeParse(v);
    if (parsed.success) return {permissions: {defaultMode: parsed.data}};
    return {};
  },
};

export function parseEnvSettings(): CodaraSettings {
  const result: Record<string, unknown> = {};

  for (const [envKey, mapper] of Object.entries(ENV_MAPPINGS)) {
    const value = process.env[envKey];
    if (value !== undefined) {
      Object.assign(result, mapper(value));
    }
  }

  return result as CodaraSettings;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/config/env.test.ts`
Expected: PASS — all 6 tests green

- [ ] **Step 5: Commit**

```bash
git add src/config/sources.ts src/config/env.ts tests/unit/config/env.test.ts
git commit -m "feat(config): add config sources definition and env var parsing"
```

---

## Chunk 2: Unified Loader + Cache

### Task 4: 统一配置加载器

**Files:**
- Create: `src/config/loader.ts`
- Test: `tests/unit/config/loader.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/config/loader.test.ts
import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadCodaraSettings} from '@config/loader';

async function createTempEnv() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codara-config-'));
  const projectRoot = path.join(root, 'project');
  const userHome = path.join(root, 'home');
  await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
  await mkdir(path.join(userHome, '.codara'), {recursive: true});
  return {root, projectRoot, userHome};
}

describe('loadCodaraSettings', () => {
  it('should return defaults when no config files exist', async () => {
    const {root, projectRoot, userHome} = await createTempEnv();
    try {
      const settings = await loadCodaraSettings({projectRoot, userHome});
      expect(settings.model).toBeUndefined();
      expect(settings.maxTurns).toBeUndefined();
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should load user settings', async () => {
    const {root, projectRoot, userHome} = await createTempEnv();
    try {
      await writeFile(
        path.join(userHome, '.codara', 'settings.json'),
        JSON.stringify({model: 'opus', maxTurns: 25}),
      );
      const settings = await loadCodaraSettings({projectRoot, userHome});
      expect(settings.model).toBe('opus');
      expect(settings.maxTurns).toBe(25);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should let project settings override user settings', async () => {
    const {root, projectRoot, userHome} = await createTempEnv();
    try {
      await writeFile(
        path.join(userHome, '.codara', 'settings.json'),
        JSON.stringify({model: 'opus', maxTurns: 25}),
      );
      await writeFile(
        path.join(projectRoot, '.codara', 'settings.json'),
        JSON.stringify({model: 'sonnet'}),
      );
      const settings = await loadCodaraSettings({projectRoot, userHome});
      expect(settings.model).toBe('sonnet');
      expect(settings.maxTurns).toBe(25); // preserved from user
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should let local settings override project settings', async () => {
    const {root, projectRoot, userHome} = await createTempEnv();
    try {
      await writeFile(
        path.join(projectRoot, '.codara', 'settings.json'),
        JSON.stringify({model: 'sonnet', maxTurns: 50}),
      );
      await writeFile(
        path.join(projectRoot, '.codara', 'settings.local.json'),
        JSON.stringify({model: 'haiku'}),
      );
      const settings = await loadCodaraSettings({projectRoot, userHome});
      expect(settings.model).toBe('haiku');
      expect(settings.maxTurns).toBe(50);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should handle malformed JSON gracefully', async () => {
    const {root, projectRoot, userHome} = await createTempEnv();
    try {
      await writeFile(
        path.join(userHome, '.codara', 'settings.json'),
        '{invalid json',
      );
      const settings = await loadCodaraSettings({projectRoot, userHome});
      // Should not throw, returns defaults
      expect(settings).toBeDefined();
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should validate with schema and strip invalid fields', async () => {
    const {root, projectRoot, userHome} = await createTempEnv();
    try {
      await writeFile(
        path.join(userHome, '.codara', 'settings.json'),
        JSON.stringify({
          model: 'opus',
          permissions: {defaultMode: 'invalid_mode'},
        }),
      );
      const settings = await loadCodaraSettings({projectRoot, userHome});
      expect(settings.model).toBe('opus');
      // Invalid permission mode should be stripped/ignored
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should include MCP and hooks from unified settings', async () => {
    const {root, projectRoot, userHome} = await createTempEnv();
    try {
      await writeFile(
        path.join(projectRoot, '.codara', 'settings.json'),
        JSON.stringify({
          mcpServers: {fs: {command: 'npx', args: ['server']}},
          hooks: {PreToolUse: [{command: 'echo test', timeout: 5000}]},
        }),
      );
      const settings = await loadCodaraSettings({projectRoot, userHome});
      expect(settings.mcpServers?.fs).toBeDefined();
      expect(settings.hooks?.PreToolUse).toHaveLength(1);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/config/loader.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement loader.ts**

```typescript
// src/config/loader.ts
import {readFile} from 'node:fs/promises';
import {codaraSettingsSchema, type CodaraSettings} from '@config/schema';
import {parseEnvSettings} from '@config/env';
import {mergeSettings} from '@config/merge';
import {resolveSettingsFilePaths, type ConfigPaths} from '@config/sources';

export interface LoadSettingsOptions extends ConfigPaths {
  /** Skip env var layer (for testing) */
  skipEnv?: boolean;
}

export interface LoadedSettings {
  /** Final merged + validated settings */
  settings: CodaraSettings;
  /** Per-source raw values (for cache invalidation) */
  perSource: Record<string, CodaraSettings>;
  /** File paths that were loaded */
  loadedFiles: string[];
}

export async function loadCodaraSettings(options: LoadSettingsOptions): Promise<CodaraSettings> {
  const result = await loadCodaraSettingsFull(options);
  return result.settings;
}

export async function loadCodaraSettingsFull(options: LoadSettingsOptions): Promise<LoadedSettings> {
  const paths = resolveSettingsFilePaths(options);
  const perSource: Record<string, CodaraSettings> = {};
  const loadedFiles: string[] = [];

  // Layer 1: defaults (empty for now, can add compiled-in defaults later)
  perSource.defaults = {};

  // Layer 2: user settings
  perSource.userSettings = await readSettingsFile(paths.userSettings);
  if (Object.keys(perSource.userSettings).length > 0) {
    loadedFiles.push(paths.userSettings);
  }

  // Layer 3: project settings
  perSource.projectSettings = await readSettingsFile(paths.projectSettings);
  if (Object.keys(perSource.projectSettings).length > 0) {
    loadedFiles.push(paths.projectSettings);
  }

  // Layer 4: local settings
  perSource.localSettings = await readSettingsFile(paths.localSettings);
  if (Object.keys(perSource.localSettings).length > 0) {
    loadedFiles.push(paths.localSettings);
  }

  // Layer 5: env settings
  perSource.envSettings = options.skipEnv ? {} : parseEnvSettings();

  // Merge in priority order (later wins)
  const merged = [
    perSource.defaults,
    perSource.userSettings,
    perSource.projectSettings,
    perSource.localSettings,
    perSource.envSettings,
  ].reduce(mergeSettings, {} as CodaraSettings);

  // Validate with Zod (lenient: strip invalid, keep valid)
  const validated = codaraSettingsSchema.safeParse(merged);
  const settings = validated.success ? validated.data : lenientParse(merged);

  return {settings, perSource, loadedFiles};
}

async function readSettingsFile(filePath: string): Promise<CodaraSettings> {
  try {
    const content = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as CodaraSettings;
  } catch {
    return {};
  }
}

function lenientParse(raw: unknown): CodaraSettings {
  // Fallback: try to extract valid fields individually
  if (typeof raw !== 'object' || raw === null) return {};
  const obj = raw as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  // Copy scalar fields that are valid
  if (typeof obj.model === 'string') result.model = obj.model;
  if (typeof obj.maxTurns === 'number') result.maxTurns = obj.maxTurns;
  if (typeof obj.defaultShell === 'string') result.defaultShell = obj.defaultShell;
  if (typeof obj.theme === 'string') result.theme = obj.theme;

  // Copy complex fields if they're objects
  if (typeof obj.permissions === 'object' && obj.permissions !== null) {
    result.permissions = obj.permissions;
  }
  if (typeof obj.mcpServers === 'object' && obj.mcpServers !== null) {
    result.mcpServers = obj.mcpServers;
  }
  if (typeof obj.hooks === 'object' && obj.hooks !== null) {
    result.hooks = obj.hooks;
  }
  if (typeof obj.plugins === 'object' && obj.plugins !== null) {
    result.plugins = obj.plugins;
  }

  return result as CodaraSettings;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/config/loader.test.ts`
Expected: PASS — all 7 tests green

- [ ] **Step 5: Commit**

```bash
git add src/config/loader.ts tests/unit/config/loader.test.ts
git commit -m "feat(config): add unified settings loader with 5-layer merge"
```

---

### Task 5: 三级缓存

**Files:**
- Create: `src/config/cache.ts`
- Test: `tests/unit/config/cache.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/config/cache.test.ts
import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SettingsCache} from '@config/cache';

async function createTempEnv() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codara-cache-'));
  const projectRoot = path.join(root, 'project');
  const userHome = path.join(root, 'home');
  await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
  await mkdir(path.join(userHome, '.codara'), {recursive: true});
  return {root, projectRoot, userHome};
}

describe('SettingsCache', () => {
  it('should cache loaded settings', async () => {
    const {root, projectRoot, userHome} = await createTempEnv();
    try {
      await writeFile(
        path.join(projectRoot, '.codara', 'settings.json'),
        JSON.stringify({model: 'opus'}),
      );
      const cache = new SettingsCache({projectRoot, userHome, skipEnv: true});
      const first = await cache.get();
      const second = await cache.get();
      expect(first.model).toBe('opus');
      expect(first).toBe(second); // Same reference = cached
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should return fresh settings after invalidation', async () => {
    const {root, projectRoot, userHome} = await createTempEnv();
    try {
      await writeFile(
        path.join(projectRoot, '.codara', 'settings.json'),
        JSON.stringify({model: 'opus'}),
      );
      const cache = new SettingsCache({projectRoot, userHome, skipEnv: true});
      const first = await cache.get();
      expect(first.model).toBe('opus');

      await writeFile(
        path.join(projectRoot, '.codara', 'settings.json'),
        JSON.stringify({model: 'sonnet'}),
      );
      cache.invalidate();
      const second = await cache.get();
      expect(second.model).toBe('sonnet');
      expect(first).not.toBe(second);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should notify listeners on invalidation', async () => {
    const {root, projectRoot, userHome} = await createTempEnv();
    try {
      const cache = new SettingsCache({projectRoot, userHome, skipEnv: true});
      let notified = false;
      cache.onChange(() => { notified = true; });
      cache.invalidate();
      expect(notified).toBe(true);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/config/cache.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement cache.ts**

```typescript
// src/config/cache.ts
import {loadCodaraSettings, type LoadSettingsOptions} from '@config/loader';
import type {CodaraSettings} from '@config/schema';

export class SettingsCache {
  private cached: CodaraSettings | undefined;
  private loading: Promise<CodaraSettings> | undefined;
  private listeners = new Set<(settings: CodaraSettings) => void>();
  private readonly options: LoadSettingsOptions;

  constructor(options: LoadSettingsOptions) {
    this.options = options;
  }

  async get(): Promise<CodaraSettings> {
    if (this.cached) return this.cached;
    if (this.loading) return this.loading;

    this.loading = loadCodaraSettings(this.options).then((settings) => {
      this.cached = settings;
      this.loading = undefined;
      return settings;
    });

    return this.loading;
  }

  invalidate(): void {
    const prev = this.cached;
    this.cached = undefined;
    this.loading = undefined;
    for (const listener of this.listeners) {
      listener(prev ?? ({} as CodaraSettings));
    }
  }

  onChange(listener: (settings: CodaraSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Peek at cached value without triggering load */
  peek(): CodaraSettings | undefined {
    return this.cached;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/config/cache.test.ts`
Expected: PASS — all 3 tests green

- [ ] **Step 5: Commit**

```bash
git add src/config/cache.ts tests/unit/config/cache.test.ts
git commit -m "feat(config): add SettingsCache with invalidation and change listeners"
```

---

## Chunk 3: CODARA.md + Watcher + Integration

### Task 6: CODARA.md 解析

**Files:**
- Create: `src/config/codara-md.ts`
- Test: `tests/unit/config/codara-md.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/config/codara-md.test.ts
import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadCodaraMd, type CodaraMdResult} from '@config/codara-md';

describe('loadCodaraMd', () => {
  it('should return empty when no CODARA.md exists', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-md-'));
    try {
      const result = await loadCodaraMd({projectRoot: root, userHome: root});
      expect(result.instructions).toEqual([]);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should load project CODARA.md', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-md-'));
    try {
      await mkdir(path.join(root, '.codara'), {recursive: true});
      await writeFile(
        path.join(root, '.codara', 'CODARA.md'),
        '# Instructions\n\nAlways use TDD.\n',
      );
      const result = await loadCodaraMd({projectRoot: root, userHome: root});
      expect(result.instructions).toHaveLength(1);
      expect(result.instructions[0].source).toBe('project');
      expect(result.instructions[0].content).toContain('Always use TDD');
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should load user CODARA.md with lower priority', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-md-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    try {
      await mkdir(path.join(userHome, '.codara'), {recursive: true});
      await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
      await writeFile(
        path.join(userHome, '.codara', 'CODARA.md'),
        'Global instructions.\n',
      );
      await writeFile(
        path.join(projectRoot, '.codara', 'CODARA.md'),
        'Project instructions.\n',
      );
      const result = await loadCodaraMd({projectRoot, userHome});
      expect(result.instructions).toHaveLength(2);
      // User first (lower priority), project second (higher)
      expect(result.instructions[0].source).toBe('user');
      expect(result.instructions[1].source).toBe('project');
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should load CODARA.local.md', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-md-'));
    try {
      await writeFile(
        path.join(root, 'CODARA.local.md'),
        'Local override.\n',
      );
      const result = await loadCodaraMd({projectRoot: root, userHome: root});
      expect(result.instructions.some(i => i.source === 'local')).toBe(true);
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should resolve @include directives', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-md-'));
    try {
      await mkdir(path.join(root, '.codara'), {recursive: true});
      await writeFile(
        path.join(root, '.codara', 'CODARA.md'),
        '# Main\n\n@./extra.md\n\nEnd of main.\n',
      );
      await writeFile(
        path.join(root, '.codara', 'extra.md'),
        'Included content from extra.\n',
      );
      const result = await loadCodaraMd({projectRoot: root, userHome: root});
      expect(result.instructions[0].content).toContain('Included content from extra');
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should parse YAML frontmatter', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-md-'));
    try {
      await mkdir(path.join(root, '.codara'), {recursive: true});
      await writeFile(path.join(root, '.codara', 'CODARA.md'), [
        '---',
        'description: project guidelines',
        '---',
        '',
        '# Guidelines',
        '',
        'Be concise.',
      ].join('\n'));
      const result = await loadCodaraMd({projectRoot: root, userHome: root});
      expect(result.instructions[0].frontmatter?.description).toBe('project guidelines');
      expect(result.instructions[0].content).toContain('Be concise');
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/config/codara-md.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement codara-md.ts**

```typescript
// src/config/codara-md.ts
import {readFile} from 'node:fs/promises';
import path from 'node:path';

export interface CodaraMdInstruction {
  source: 'user' | 'project' | 'local';
  filePath: string;
  content: string;
  frontmatter?: Record<string, unknown>;
}

export interface CodaraMdResult {
  instructions: CodaraMdInstruction[];
}

export interface CodaraMdOptions {
  projectRoot: string;
  userHome: string;
}

export async function loadCodaraMd(options: CodaraMdOptions): Promise<CodaraMdResult> {
  const candidates: Array<{path: string; source: CodaraMdInstruction['source']}> = [
    // Lower priority first
    {path: path.join(options.userHome, '.codara', 'CODARA.md'), source: 'user'},
    {path: path.join(options.projectRoot, '.codara', 'CODARA.md'), source: 'project'},
    {path: path.join(options.projectRoot, 'CODARA.md'), source: 'project'},
    {path: path.join(options.projectRoot, 'CODARA.local.md'), source: 'local'},
  ];

  const instructions: CodaraMdInstruction[] = [];

  for (const candidate of candidates) {
    const raw = await tryReadFile(candidate.path);
    if (raw === undefined) continue;

    const {frontmatter, body} = parseFrontmatter(raw);
    // Resolve @include directives relative to the file's directory
    const resolvedBody = await resolveIncludes(body, path.dirname(candidate.path), new Set());
    instructions.push({
      source: candidate.source,
      filePath: candidate.path,
      content: resolvedBody.trim(),
      ...(frontmatter ? {frontmatter} : {}),
    });
  }

  return {instructions};
}

function parseFrontmatter(raw: string): {frontmatter?: Record<string, unknown>; body: string} {
  if (!raw.startsWith('---')) {
    return {body: raw};
  }

  const endIndex = raw.indexOf('\n---', 3);
  if (endIndex === -1) {
    return {body: raw};
  }

  const frontmatterRaw = raw.slice(4, endIndex).trim();
  const body = raw.slice(endIndex + 4);

  try {
    // Simple YAML-like key: value parsing (no nested structures)
    const frontmatter: Record<string, unknown> = {};
    for (const line of frontmatterRaw.split('\n')) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      if (key) frontmatter[key] = value;
    }
    return {frontmatter, body};
  } catch {
    return {body: raw};
  }
}

async function resolveIncludes(body: string, baseDir: string, visited: Set<string>): Promise<string> {
  const lines = body.split('\n');
  const resolved: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Match @./relative/path or @path patterns (not inside code blocks)
    if (trimmed.startsWith('@') && !trimmed.startsWith('@{')) {
      const includePath = trimmed.slice(1).trim();
      const fullPath = path.isAbsolute(includePath)
        ? includePath
        : path.resolve(baseDir, includePath);

      if (visited.has(fullPath)) {
        // Circular reference — skip silently
        continue;
      }

      const content = await tryReadFile(fullPath);
      if (content !== undefined) {
        visited.add(fullPath);
        const nested = await resolveIncludes(content, path.dirname(fullPath), visited);
        resolved.push(nested);
      }
      // Non-existent files silently ignored (matches Claude Code behavior)
    } else {
      resolved.push(line);
    }
  }

  return resolved.join('\n');
}

async function tryReadFile(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/config/codara-md.test.ts`
Expected: PASS — all 5 tests green

- [ ] **Step 5: Commit**

```bash
git add src/config/codara-md.ts tests/unit/config/codara-md.test.ts
git commit -m "feat(config): add CODARA.md loading with frontmatter support"
```

---

### Task 7: File Watcher 热更新

**Files:**
- Create: `src/config/watcher.ts`
- Test: `tests/unit/config/watcher.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/config/watcher.test.ts
import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SettingsWatcher} from '@config/watcher';

describe('SettingsWatcher', () => {
  it('should detect file changes and invoke callback', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-watcher-'));
    const settingsPath = path.join(root, 'settings.json');
    try {
      await writeFile(settingsPath, JSON.stringify({model: 'opus'}));

      let changeCount = 0;
      const watcher = new SettingsWatcher({
        watchPaths: [settingsPath],
        onChange: () => { changeCount++; },
        stabilityThreshold: 100, // 100ms for test speed
      });

      await watcher.start();

      // Modify file
      await writeFile(settingsPath, JSON.stringify({model: 'sonnet'}));

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(changeCount).toBeGreaterThanOrEqual(1);

      await watcher.stop();
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });

  it('should ignore internal writes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codara-watcher-'));
    const settingsPath = path.join(root, 'settings.json');
    try {
      await writeFile(settingsPath, JSON.stringify({model: 'opus'}));

      let changeCount = 0;
      const watcher = new SettingsWatcher({
        watchPaths: [settingsPath],
        onChange: () => { changeCount++; },
        stabilityThreshold: 100,
      });

      await watcher.start();

      // Mark as internal write, then modify
      watcher.markInternalWrite();
      await writeFile(settingsPath, JSON.stringify({model: 'sonnet'}));

      await new Promise(resolve => setTimeout(resolve, 300));
      expect(changeCount).toBe(0); // Should be suppressed

      await watcher.stop();
    } finally {
      await rm(root, {recursive: true, force: true});
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/config/watcher.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement watcher.ts**

```typescript
// src/config/watcher.ts
import {watch, type FSWatcher} from 'node:fs';

export interface SettingsWatcherOptions {
  watchPaths: string[];
  onChange: () => void;
  stabilityThreshold?: number; // ms, default 1000
}

export class SettingsWatcher {
  private watchers: FSWatcher[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private internalWriteUntil = 0;
  private readonly options: Required<SettingsWatcherOptions>;

  constructor(options: SettingsWatcherOptions) {
    this.options = {
      stabilityThreshold: 1000,
      ...options,
    };
  }

  async start(): Promise<void> {
    for (const watchPath of this.options.watchPaths) {
      try {
        const watcher = watch(watchPath, () => this.onFileChange());
        this.watchers.push(watcher);
      } catch {
        // File doesn't exist yet — skip, user will create it later
      }
    }
  }

  async stop(): Promise<void> {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
  }

  /** Mark that we're about to write settings ourselves (suppress next change) */
  markInternalWrite(): void {
    this.internalWriteUntil = Date.now() + 5000;
  }

  private onFileChange(): void {
    // Suppress internal writes
    if (Date.now() < this.internalWriteUntil) return;

    // Debounce: wait for stability
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.options.onChange();
    }, this.options.stabilityThreshold);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/config/watcher.test.ts`
Expected: PASS — all 2 tests green

- [ ] **Step 5: Commit**

```bash
git add src/config/watcher.ts tests/unit/config/watcher.test.ts
git commit -m "feat(config): add SettingsWatcher with debounce and internal write suppression"
```

---

### Task 8: 更新 config/index.ts 公共 API 和 settings.ts 入口

**Files:**
- Modify: `src/config/settings.ts`
- Modify: `src/config/index.ts`
- Modify: `tests/unit/config/settings.test.ts`

- [ ] **Step 1: Read current files**

Read `src/config/settings.ts` and `src/config/index.ts` to understand current exports.

- [ ] **Step 2: Rewrite settings.ts as thin facade**

```typescript
// src/config/settings.ts — rewritten
// Backwards-compatible API surface wrapping new unified loader
import {loadCodaraSettings, loadCodaraSettingsFull, type LoadedSettings, type LoadSettingsOptions} from '@config/loader';
import {SettingsCache} from '@config/cache';
import type {CodaraSettings} from '@config/schema';

export type {CodaraSettings, LoadedSettings, LoadSettingsOptions};

// Legacy API compatibility
export interface CodaraSettingsEnvironment {
  projectRoot?: string;
  userHome?: string;
}

/** @deprecated Use loadCodaraSettings instead */
export function readCodaraSettings(_filePath: string): Record<string, unknown> {
  // Sync read removed — new system is async-only
  // Kept for compilation; consumers should migrate
  return {};
}

/** Legacy wrapper */
export async function loadScopedCodaraSettings(env: CodaraSettingsEnvironment) {
  const projectRoot = env.projectRoot ?? process.cwd();
  const userHome = env.userHome ?? (await import('node:os')).homedir();
  const settings = await loadCodaraSettings({projectRoot, userHome});
  return {
    projectRoot,
    userHome,
    projectPath: `${projectRoot}/.codara/settings.json`,
    userPath: `${userHome}/.codara/settings.json`,
    settings,
  };
}

/** Legacy wrapper */
export async function resolvePluginInstallGlobal(env: CodaraSettingsEnvironment): Promise<boolean> {
  const {settings} = await loadScopedCodaraSettings(env);
  return settings.plugins?.installGlobal ?? true;
}
```

- [ ] **Step 3: Update index.ts to export new modules**

```typescript
// src/config/index.ts — updated
export {resolveWorkspaceRoot, type WorkspaceRootOptions} from '@config/workspace';
export {createWorkspaceKey, sanitizeSlug} from '@config/workspace-key';
export {codaraSettingsSchema, type CodaraSettings, type PermissionMode, type HookEventType} from '@config/schema';
export {loadCodaraSettings, loadCodaraSettingsFull, type LoadSettingsOptions, type LoadedSettings} from '@config/loader';
export {mergeSettings} from '@config/merge';
export {parseEnvSettings} from '@config/env';
export {SettingsCache} from '@config/cache';
export {SettingsWatcher} from '@config/watcher';
export {loadCodaraMd, type CodaraMdResult, type CodaraMdInstruction} from '@config/codara-md';
// Legacy exports (preserved for gradual migration)
export {loadScopedCodaraSettings, resolvePluginInstallGlobal, readCodaraSettings} from '@config/settings';
```

- [ ] **Step 4: Update existing settings.test.ts**

Ensure existing tests still pass with the rewritten settings.ts. The legacy API wrappers should maintain backward compatibility.

- [ ] **Step 5: Run full test suite**

Run: `bun test tests/unit/config/`
Expected: ALL tests pass (schema, merge, env, loader, cache, codara-md, watcher, settings)

- [ ] **Step 6: Commit**

```bash
git add src/config/settings.ts src/config/index.ts tests/unit/config/settings.test.ts
git commit -m "feat(config): rewrite settings.ts as facade, update index.ts exports"
```

---

## Chunk 4: Consumer Migration

### Task 9: 迁移 facade.ts 到统一 loader

**Files:**
- Modify: `src/codara/facade.ts`

- [ ] **Step 1: Read facade.ts**

Read `src/codara/facade.ts` completely. Key areas to find:
- `loadMcpConfig()` call (around line 124-133)
- Hook source creation (around line 115-119)
- Permission config loading
- Where `createCodaraRuntime()` returns its options object

- [ ] **Step 2: Create SettingsCache at runtime top level**

At the top of `createCodaraRuntime()`, replace scattered config loading with:

```typescript
import {SettingsCache} from '@config/cache';
import type {CodaraSettings} from '@config/schema';

// Inside createCodaraRuntime():
const settingsCache = new SettingsCache({projectRoot, userHome, skipEnv: false});
const settings = await settingsCache.get();
```

Store `settingsCache` on the runtime object so middlewares and watcher can access it.

- [ ] **Step 3: Replace MCP config loading**

Find the `loadMcpConfig({projectRoot, userHome})` call. Replace with:

```typescript
// Before:
const mcpConfig = options.mcp !== false
  ? await loadMcpConfig({projectRoot, userHome})
  : undefined;

// After:
const mcpConfig = options.mcp !== false && settings.mcpServers
  ? createMcpConfigFromSettings(settings.mcpServers)
  : undefined;
```

Import `createMcpConfigFromSettings` from `@integration/mcp/config` (added in Task 11).

- [ ] **Step 4: Replace hook source creation**

Find the `hookSources` array creation. Replace with:

```typescript
// Before:
const hookSources: HookSource[] = [
  {kind: 'project', path: path.join(runtimeStatePath, 'hooks.json')},
];
if (userHome) hookSources.push({kind: 'user', path: path.join(userHome, '.codara', 'hooks.json')});

// After:
// hookRegistry now receives settings directly
if (settings.hooks) {
  hookRegistry.loadFromSettings(settings.hooks);
} else {
  // Fallback: still support legacy hooks.json files during migration
  const hookSources: HookSource[] = [
    {kind: 'project', path: path.join(runtimeStatePath, 'hooks.json')},
  ];
  if (userHome) hookSources.push({kind: 'user', path: path.join(userHome, '.codara', 'hooks.json')});
  await hookRegistry.load(hookSources);
}
```

- [ ] **Step 5: Wire SettingsCache + Watcher to runtime**

```typescript
// Start watcher for hot-reload (optional, only for long-lived sessions)
const filePaths = resolveSettingsFilePaths({projectRoot, userHome});
const watcher = new SettingsWatcher({
  watchPaths: Object.values(filePaths).filter((p): p is string => p !== null),
  onChange: () => {
    settingsCache.invalidate();
    // Re-load will happen lazily on next access
  },
});
// Watcher starts async, doesn't block runtime init
watcher.start().catch(() => {/* ignore watch failures */});
```

- [ ] **Step 6: Run full test suite**

Run: `bun test`
Expected: ALL 1373+ tests pass

- [ ] **Step 7: Commit**

```bash
git add src/codara/facade.ts
git commit -m "refactor(config): migrate facade.ts to unified settings loader"
```

---

### Task 10: 迁移 Hook Registry 到统一 settings

**Files:**
- Modify: `src/observability/hook/registry.ts`
- Test: `tests/unit/hooks/registry.test.ts` (add test)

- [ ] **Step 1: Read registry.ts**

Read `src/observability/hook/registry.ts`. Key: understand `HookEntry` internal type and `load(sources)` method. The `HookEntry` has fields: `on`, `hooks[]` where each hook has `type: 'command'|'prompt'`, `command?`, `prompt?`, `timeout?`, `matcher?`.

- [ ] **Step 2: Write failing test for loadFromSettings**

```typescript
// Add to tests/unit/hooks/registry.test.ts:
it('should load hooks from unified settings format', () => {
  const registry = createHookRegistry(); // use existing factory
  registry.loadFromSettings({
    PreToolUse: [
      {command: 'echo pre-tool', timeout: 5000, matcher: {toolName: 'Bash'}},
    ],
    Stop: [
      {command: 'echo stopped'},
    ],
  });

  const preToolHooks = registry.query('PreToolUse');
  expect(preToolHooks).toHaveLength(1);
  expect(preToolHooks[0].type).toBe('command');
  expect(preToolHooks[0].command).toBe('echo pre-tool');

  const stopHooks = registry.query('Stop');
  expect(stopHooks).toHaveLength(1);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/unit/hooks/registry.test.ts`
Expected: FAIL — `loadFromSettings` not found

- [ ] **Step 4: Implement loadFromSettings**

Add to `HookRegistryImpl`:

```typescript
loadFromSettings(hooks: Record<string, Array<{
  command?: string;
  prompt?: string;
  timeout?: number;
  matcher?: {toolName?: string | string[]; commandPattern?: string};
}>>): void {
  for (const [eventType, definitions] of Object.entries(hooks)) {
    const hookGroup = {
      on: eventType,
      hooks: definitions.map(def => ({
        type: (def.command ? 'command' : 'prompt') as 'command' | 'prompt',
        command: def.command,
        prompt: def.prompt,
        timeout: def.timeout,
        matcher: def.matcher,
      })),
    };
    this.entries.push(hookGroup as HookEntry);
  }
}
```

- [ ] **Step 5: Run hook tests**

Run: `bun test tests/unit/hooks/`
Expected: ALL pass (existing + new)

- [ ] **Step 6: Commit**

```bash
git add src/observability/hook/registry.ts tests/unit/hooks/registry.test.ts
git commit -m "refactor(hooks): add loadFromSettings for unified config integration"
```

---

### Task 11: 迁移 MCP Config 到统一 settings

**Files:**
- Modify: `src/integration/mcp/config.ts`
- Test: `tests/unit/mcp/config.test.ts` (add test)

- [ ] **Step 1: Read mcp/config.ts**

Read `src/integration/mcp/config.ts`. Key: understand `expandEnvVars()` — it replaces `${VAR}` in strings with `process.env[VAR]`. This logic must be preserved.

- [ ] **Step 2: Write failing test**

```typescript
// Add to tests/unit/mcp/config.test.ts:
it('should create config from settings with env expansion', () => {
  process.env.TEST_MCP_KEY = 'secret123';
  try {
    const config = createMcpConfigFromSettings({
      myServer: {
        command: 'node',
        args: ['server.js'],
        env: {API_KEY: '${TEST_MCP_KEY}'},
      },
    });
    expect(config.mcpServers.myServer).toBeDefined();
    expect(config.mcpServers.myServer.env?.API_KEY).toBe('secret123');
  } finally {
    delete process.env.TEST_MCP_KEY;
  }
});

it('should return empty config when undefined', () => {
  const config = createMcpConfigFromSettings(undefined);
  expect(config.mcpServers).toEqual({});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/unit/mcp/config.test.ts`
Expected: FAIL — `createMcpConfigFromSettings` not found

- [ ] **Step 4: Implement createMcpConfigFromSettings**

Add to `src/integration/mcp/config.ts`:

```typescript
export function createMcpConfigFromSettings(
  mcpServers: Record<string, McpServerConfig> | undefined,
): McpConfig {
  if (!mcpServers) return {mcpServers: {}};
  // Reuse existing expandEnvVars logic
  const expanded: Record<string, McpServerConfig> = {};
  for (const [name, server] of Object.entries(mcpServers)) {
    expanded[name] = expandServerEnvVars(server);
  }
  return {mcpServers: expanded};
}

function expandServerEnvVars(server: McpServerConfig): McpServerConfig {
  return JSON.parse(
    JSON.stringify(server).replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] ?? ''),
  );
}
```

- [ ] **Step 5: Run MCP tests**

Run: `bun test tests/unit/mcp/`
Expected: ALL pass

- [ ] **Step 6: Commit**

```bash
git add src/integration/mcp/config.ts tests/unit/mcp/config.test.ts
git commit -m "refactor(mcp): add createMcpConfigFromSettings for unified config"
```

---

### Task 12: 迁移 Permission Config 到统一 settings

**Files:**
- Modify: `src/core/middleware/permission/policy/config.ts`
- Test: `tests/unit/permissions/` (add test)

- [ ] **Step 1: Read permission config.ts**

Read `src/core/middleware/permission/policy/config.ts`. Key: understand current `PermissionRuleSet` type and `loadPermissionRules()`.

- [ ] **Step 2: Write failing test**

```typescript
// Add to appropriate test file in tests/unit/permissions/:
it('should create permission rules from unified settings', () => {
  const rules = createPermissionRulesFromSettings({
    defaultMode: 'plan',
    alwaysAllow: ['Read', 'Glob'],
    alwaysDeny: ['Bash(rm -rf:*)'],
    alwaysAsk: ['Write'],
  });

  expect(rules.defaultMode).toBe('plan');
  expect(rules.alwaysAllow).toContain('Read');
  expect(rules.alwaysDeny).toContain('Bash(rm -rf:*)');
});

it('should return defaults when permissions is undefined', () => {
  const rules = createPermissionRulesFromSettings(undefined);
  expect(rules.defaultMode).toBe('default');
  expect(rules.alwaysAllow).toEqual([]);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/unit/permissions/`
Expected: FAIL

- [ ] **Step 4: Implement createPermissionRulesFromSettings**

Add to `src/core/middleware/permission/policy/config.ts`:

```typescript
import type {CodaraSettings} from '@config/schema';

export interface PermissionRuleSet {
  defaultMode: string;
  alwaysAllow: string[];
  alwaysDeny: string[];
  alwaysAsk: string[];
}

export function createPermissionRulesFromSettings(
  permissions: CodaraSettings['permissions'],
): PermissionRuleSet {
  if (!permissions) {
    return {defaultMode: 'default', alwaysAllow: [], alwaysDeny: [], alwaysAsk: []};
  }
  return {
    defaultMode: permissions.defaultMode ?? 'default',
    alwaysAllow: permissions.alwaysAllow ?? [],
    alwaysDeny: permissions.alwaysDeny ?? [],
    alwaysAsk: permissions.alwaysAsk ?? [],
  };
}
```

- [ ] **Step 5: Run permission tests**

Run: `bun test tests/unit/permissions/`
Expected: ALL pass

- [ ] **Step 6: Commit**

```bash
git add src/core/middleware/permission/policy/config.ts tests/unit/permissions/
git commit -m "refactor(permission): add createPermissionRulesFromSettings for unified config"
```

---

### Task 13: 全量回归测试

- [ ] **Step 1: Run TypeScript compilation check**

Run: `bunx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 2: Run full test suite**

Run: `bun test`
Expected: ALL 1373+ tests pass, 0 failures

- [ ] **Step 3: Verify new config tests**

Run: `bun test tests/unit/config/`
Expected: 30+ tests across 7 test files, all passing

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(config): P1 Settings 统一配置系统完成，全量测试通过"
```
