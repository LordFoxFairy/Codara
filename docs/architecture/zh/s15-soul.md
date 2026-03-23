---
title: 第16章：Soul — 人格系统
---

# 第16章：Soul — 人格系统

> **给 agent 注入灵魂**：从"冷冰冰的工具"到"有温度的助手"，通过配置实现个性化。

---

## 为什么需要 Soul

**通用 agent 的问题**：
- 所有人用的都是同一个 agent
- 没有个性，没有记忆，没有偏好
- 无法适应不同用户的需求

**Soul 的价值**：
```
通用 agent：标准化，千人一面
个性化 agent：定制化，千人千面
```

**核心差异**：
- 通用 agent 是**产品**
- 个性化 agent 是**伙伴**

---

## 核心机制

### 1. Identity — 身份配置

定义 agent 的基本身份：

```typescript
interface AgentIdentity {
  name: string;           // agent 名字
  role: string;           // 角色定位
  personality: string;    // 性格描述
  language: string;       // 默认语言
  timezone: string;       // 时区
}

const identity: AgentIdentity = {
  name: "小助手",
  role: "个人 AI 助理",
  personality: "友好、专业、高效",
  language: "zh-CN",
  timezone: "Asia/Shanghai",
};
```

**注入到 System Prompt**：
```typescript
const systemPrompt = `
你是 ${identity.name}，一个${identity.role}。
你的性格是：${identity.personality}。
请用${identity.language}回复用户。
`;
```

### 2. Active Hours — 活跃时段

控制 agent 何时主动工作：

```typescript
interface ActiveHours {
  enabled: boolean;
  timezone: string;
  schedule: {
    monday: { start: "09:00", end: "18:00" };
    tuesday: { start: "09:00", end: "18:00" };
    // ...
  };
}

function isWithinActiveHours(now: Date, config: ActiveHours): boolean {
  if (!config.enabled) return true;

  const day = now.toLocaleDateString("en-US", {
    weekday: "lowercase",
    timeZone: config.timezone,
  });

  const time = now.toLocaleTimeString("en-US", {
    hour12: false,
    timeZone: config.timezone,
  });

  const schedule = config.schedule[day];
  return time >= schedule.start && time <= schedule.end;
}
```

**应用场景**：
- Heartbeat 只在活跃时段唤醒
- Cron 任务只在活跃时段执行
- 避免深夜打扰用户

### 3. Visibility — 可见性控制

控制 agent 输出的详细程度：

```typescript
interface VisibilityConfig {
  showThinking: boolean;      // 是否显示思考过程
  showToolCalls: boolean;     // 是否显示工具调用
  showIntermediateSteps: boolean;  // 是否显示中间步骤
}

function filterOutput(
  output: AgentOutput,
  config: VisibilityConfig
): string {
  let result = output.text;

  if (!config.showThinking) {
    result = result.replace(/<thinking>.*?<\/thinking>/gs, "");
  }

  if (!config.showToolCalls) {
    result = result.replace(/\[Tool: .*?\]/g, "");
  }

  return result;
}
```

**可见性级别**：
- **Verbose**：显示所有细节（调试用）
- **Normal**：显示主要步骤（默认）
- **Quiet**：只显示最终结果（生产用）

### 4. Preferences — 偏好设置

用户的个性化偏好：

```typescript
interface UserPreferences {
  codeStyle: "verbose" | "concise";
  responseLength: "short" | "medium" | "long";
  formality: "casual" | "professional";
  emojiUsage: "none" | "minimal" | "frequent";
}

const preferences: UserPreferences = {
  codeStyle: "concise",
  responseLength: "medium",
  formality: "casual",
  emojiUsage: "minimal",
};
```

**注入到 System Prompt**：
```typescript
const systemPrompt = `
用户偏好：
- 代码风格：${preferences.codeStyle}
- 回复长度：${preferences.responseLength}
- 正式程度：${preferences.formality}
- Emoji 使用：${preferences.emojiUsage}

请根据用户偏好调整你的回复风格。
`;
```

---

## 设计权衡

| 维度 | 选择 | 原因 |
|------|------|------|
| **配置方式** | JSON 文件 | 简单直观，易于编辑 |
| **活跃时段** | 时区感知 | 支持全球用户 |
| **可见性** | 三级控制 | 平衡信息量和可读性 |
| **偏好注入** | System Prompt | 简单有效，无需修改代码 |

**为什么用 JSON 文件**：
- 用户可以直接编辑
- 无需重启进程
- 支持版本控制

**为什么时区感知**：
- 用户可能在不同时区
- 避免深夜打扰
- 支持全球化部署

---

## 配置文件结构

```
~/.openclaw/agents/{agentId}/
├── config.json          # 主配置
├── identity.json        # 身份配置
├── preferences.json     # 偏好设置
├── memory/              # 记忆目录
├── cron.json            # 定时任务
└── sessions/            # 会话历史
```

**config.json 示例**：
```json
{
  "identity": {
    "name": "小助手",
    "role": "个人 AI 助理",
    "personality": "友好、专业、高效",
    "language": "zh-CN",
    "timezone": "Asia/Shanghai"
  },
  "activeHours": {
    "enabled": true,
    "timezone": "Asia/Shanghai",
    "schedule": {
      "monday": { "start": "09:00", "end": "18:00" },
      "tuesday": { "start": "09:00", "end": "18:00" },
      "wednesday": { "start": "09:00", "end": "18:00" },
      "thursday": { "start": "09:00", "end": "18:00" },
      "friday": { "start": "09:00", "end": "18:00" },
      "saturday": { "start": "10:00", "end": "16:00" },
      "sunday": { "start": "10:00", "end": "16:00" }
    }
  },
  "visibility": {
    "showThinking": false,
    "showToolCalls": true,
    "showIntermediateSteps": false
  },
  "preferences": {
    "codeStyle": "concise",
    "responseLength": "medium",
    "formality": "casual",
    "emojiUsage": "minimal"
  }
}
```

---

## 实现细节

### 1. 配置热重载

```typescript
class AgentConfig {
  private config: Config;
  private watcher: FSWatcher;

  constructor(configPath: string) {
    this.config = this.loadConfig(configPath);
    this.watcher = chokidar.watch(configPath);

    this.watcher.on("change", () => {
      this.config = this.loadConfig(configPath);
      this.emit("config-changed", this.config);
    });
  }

  get(): Config {
    return this.config;
  }
}
```

**热重载优势**：
- 无需重启进程
- 立即生效
- 方便调试

### 2. System Prompt 生成

```typescript
function buildSystemPrompt(config: AgentConfig): string {
  const { identity, preferences } = config;

  return `
你是 ${identity.name}，一个${identity.role}。

# 性格
${identity.personality}

# 用户偏好
- 代码风格：${preferences.codeStyle}
- 回复长度：${preferences.responseLength}
- 正式程度：${preferences.formality}
- Emoji 使用：${preferences.emojiUsage}

# 指令
1. 请用${identity.language}回复用户
2. 根据用户偏好调整回复风格
3. 保持友好、专业、高效的态度
`.trim();
}
```

### 3. 活跃时段检查

```typescript
function shouldRunHeartbeat(config: AgentConfig): boolean {
  const { activeHours } = config;

  if (!activeHours.enabled) return true;

  const now = new Date();
  return isWithinActiveHours(now, activeHours);
}

// 在 Heartbeat 中使用
setInterval(() => {
  if (shouldRunHeartbeat(config)) {
    runHeartbeat();
  }
}, 30_000);
```

---

## 使用场景

### 1. 个人助理

```json
{
  "identity": {
    "name": "小助手",
    "role": "个人 AI 助理",
    "personality": "友好、耐心、细心"
  },
  "activeHours": {
    "enabled": true,
    "schedule": {
      "monday": { "start": "08:00", "end": "22:00" }
    }
  }
}
```

### 2. 团队协作

```json
{
  "identity": {
    "name": "团队助手",
    "role": "技术支持专家",
    "personality": "专业、高效、严谨"
  },
  "activeHours": {
    "enabled": true,
    "schedule": {
      "monday": { "start": "09:00", "end": "18:00" }
    }
  },
  "preferences": {
    "formality": "professional"
  }
}
```

### 3. 学习伙伴

```json
{
  "identity": {
    "name": "学习助手",
    "role": "编程导师",
    "personality": "耐心、鼓励、启发"
  },
  "preferences": {
    "codeStyle": "verbose",
    "responseLength": "long",
    "emojiUsage": "frequent"
  }
}
```

---

## 总结

Soul 让 agent 从"冷冰冰的工具"变成"有温度的助手"：

1. **Identity**：定义 agent 的基本身份
2. **Active Hours**：控制活跃时段，避免打扰
3. **Visibility**：控制输出详细程度
4. **Preferences**：用户个性化偏好

**关键洞察**：
- 配置即个性，无需修改代码
- 时区感知支持全球化
- 热重载提升开发体验

---

## 全景回顾

至此，我们完成了从"被动临时会话"到"主动常驻助手"的完整演进：

```
┌─────────────────────────────────────────┐
│      Agent Core (s00-s10)               │
│  Loop · Context · Tool · Skill          │
│  SubAgent · Task · Team · Autonomous    │
└──────────────┬──────────────────────────┘
               │
┌──────────────┴──────────────────────────┐
│      Harness Layer (s11-s15)            │
│  ┌────────────┐    ┌────────────┐       │
│  │ Heartbeat  │───▶│   Cron     │       │
│  │ 定时唤醒    │    │ 任务调度    │       │
│  └────────────┘    └────────────┘       │
│  ┌────────────┐    ┌────────────┐       │
│  │ IM Channels│───▶│   Memory   │       │
│  │ 多渠道接入  │    │ 长期记忆    │       │
│  └────────────┘    └────────────┘       │
│  ┌────────────┐                         │
│  │   Soul     │                         │
│  │ 人格系统    │                         │
│  └────────────┘                         │
└─────────────────────────────────────────┘
```

**五大 Harness 机制**：
1. **Heartbeat**：每 30 秒唤醒，检查待办
2. **Cron**：精确调度，定时执行
3. **IM Channels**：13+ 平台，全渠道接入
4. **Memory**：向量检索，长期记忆
5. **Soul**：个性配置，千人千面

**从临时工具到常驻助手**：
- Agent Core 提供执行能力
- Harness Layer 提供常驻能力
- 两者结合，实现真正的"AI 助手"
