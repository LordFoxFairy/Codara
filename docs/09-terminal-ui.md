# 终端界面设计

> [← 上一篇: 记忆与上下文](./08-memory-system.md) | [目录](./README.md)

---

## 1. 全局布局架构

### 1.1 三区布局模型

Codara 采用**底部锚定**布局，全部内容从底部向上生长：

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│                                                         │
│              (terminal scrollback zone)                 │
│         已完成的消息进入终端原生滚动缓冲区                  │
│         用户可通过终端原生滚动回看历史                      │
│                                                         │
│                                                         │
├─────────────── 动态渲染区 (ink managed) ─────────────────┤
│                                                         │
│  ┌─ Message Zone ─────────────────────────────────────┐ │
│  │  最近的消息（assistant / tool / system）             │ │
│  │  使用 <Static> 将已完成消息推入 scrollback           │ │
│  │  仅保留当前 turn 的活跃内容在动态区                   │ │
│  └────────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ StreamingText ────────────────────────────────────┐ │
│  │  实时流式文本 + 闪烁光标 ▊                           │ │
│  └────────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ Dialog Zone (条件渲染) ───────────────────────────┐ │
│  │  PermissionDialog / QuestionDialog / ConfirmDialog  │ │
│  │  弹窗出现时 InputArea 变为 disabled 状态             │ │
│  └────────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ InputArea ────────────────────────────────────────┐ │
│  │  > 用户输入...                                      │ │
│  └────────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ StatusBar (底部固定) ─────────────────────────────┐ │
│  │  model │ $cost │ tokens │ turns │ mode │ spinner    │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 1.2 布局规则

| 规则 | 说明 |
|------|------|
| **StatusBar 固定在最底部** | 全局信息面板，始终可见，不随内容滚动 |
| **InputArea 紧贴 StatusBar 上方** | 输入框不固定在屏幕某处，而是紧贴内容流底部 |
| **Dialog 出现在 InputArea 正上方** | 权限审批、问题选择等弹窗插入在输入区与消息区之间 |
| **Messages 自然流动** | 已完成消息通过 `<Static>` 推入终端 scrollback，用户可原生滚动回看 |
| **StreamingText 紧贴最后一条消息** | 流式输出不悬浮，而是跟随消息流自然延伸 |

### 1.3 组件层级

```
App (根组件 — src/tui/App.tsx)
│
├── ThemeProvider (上下文包装器)
│   │
│   ├── 内容区域 (flexGrow=1, justifyContent="flex-end")
│   │   ├── MessageStream (消息流列表)
│   │   ├── StreamingText (实时 token 流)
│   │   ├── PermissionDialog (条件显示 — 工具审批)
│   │   ├── QuestionDialog (条件显示 — 用户问题)
│   │   ├── Separator (分隔线 ─────)
│   │   └── InputArea (底部输入区 — ❯ 提示符，无边框)
│   │
│   └── StatusBar (底部状态栏 — 固定)
```

### 1.4 Flexbox 实现

```tsx
<Box flexDirection="column" height={rows}>
  {/* 弹性内容区 — 占满 StatusBar 以外的全部空间 */}
  <Box flexDirection="column" flexGrow={1} justifyContent="flex-end" overflowY="hidden">
    {/* 已完成消息 → <Static> 推入终端 scrollback */}
    <Static items={completedMessages}>
      {(msg) => <MessageBlock key={msg.id} message={msg} />}
    </Static>

    {/* 当前 turn 的活跃消息 */}
    <ActiveMessages messages={currentTurnMessages} />

    {/* 流式文本 */}
    <StreamingText text={streamingText} />

    {/* 弹窗区 (条件渲染) */}
    {dialog && <DialogRenderer dialog={dialog} />}

    {/* 输入区 */}
    <InputArea />
  </Box>

  {/* 底部固定状态栏 */}
  <StatusBar />
</Box>
```

内容区域使用 `justifyContent="flex-end"` 使内容锚定在底部向上增长。`InputArea` 在 `isRunning` 或对话框活跃时被禁用。`overflowY="hidden"` 防止 ink 渲染溢出。

### 1.5 入口点 (index.tsx)

**文件**: `src/tui/index.tsx`

```typescript
export function startTUI(agent: AgentLoop, theme: ThemeName = "dark") {
  const { waitUntilExit } = render(
    <App agent={agent} initialTheme={theme} />,
  );
  return waitUntilExit;
}
```

通过 ink 的 `render()` 渲染 `<App>` 组件，返回 `waitUntilExit` promise，调用方等待此 promise 直到用户退出。

---

## 2. 主题系统

**文件**: `src/tui/theme.ts` (225 行)

### 2.1 可用主题

六套主题，分三组：

| 主题 | 适用环境 | 色彩空间 |
|------|---------|---------|
| `dark` | 深色终端 | 24 位 hex (`#RRGGBB`) |
| `light` | 浅色终端 | 24 位 hex |
| `dark-ansi` | 基础 16 色终端 | ANSI 命名颜色 |
| `light-ansi` | 基础 16 色浅色终端 | ANSI 命名颜色 |
| `dark-daltonized` | 色盲用户，深色 | 蓝/橙替代绿/红 |
| `light-daltonized` | 色盲用户，浅色 | 蓝/橙替代绿/红 |

### 2.2 语义化颜色 Token (ThemeColors)

`ThemeColors` 接口定义约 22 个语义化 token：

| 类别 | Token | 用途 |
|------|-------|------|
| **文本** | `text`, `secondaryText`, `mutedText` | 主要、次要、灰色文本 |
| **状态** | `success`, `error`, `warning`, `info` | 语义化状态颜色 |
| **品牌** | `accent`, `brand` | 强调色、品牌色（spinner/标题） |
| **边框** | `border`, `activeBorder`, `toolBorder`, `inputBorder`, `bashBorder` | 各种边框上下文 |
| **工具** | `toolTitle` | ToolBlock 标题文本颜色 |
| **权限** | `permissionBorder`, `permissionText`, `autoAccept` | 权限对话框样式 |
| **Diff** | `diffAdd`, `diffRemove`, `diffContext` | 内联 diff 预览颜色 |
| **Spinner** | `spinner`, `spinnerShimmer` | Spinner 动画颜色 |

### 2.3 API

**`ThemeProvider`** — React 上下文 Provider：
```typescript
<ThemeProvider theme="dark">{children}</ThemeProvider>
```

**`useTheme()`** — 从任何组件获取当前 `ThemeColors`：
```typescript
const theme = useTheme();
```

**`themeColor(hexOrName)`** — 返回对应颜色的 chalk 实例，支持 hex 和 ANSI 名称：
```typescript
themeColor("#818CF8")("some text");  // hex
themeColor("magenta")("some text");  // ANSI
```

**`hexToRgbSafe(color)`** — 将颜色转为 `"R;G;B"` 格式，用于原始 ANSI 转义序列。

---

## 3. 组件规范

### 3.1 StatusBar — 状态栏

**文件**: `src/tui/StatusBar.tsx`
**位置**: 屏幕最底部，固定不动
**高度**: 1 行 + 边框 = 3 行

```
╭─────────────────────────────────────────────────────────────────────╮
│  Codara │ claude-sonnet-4 │ $0.03 │ 1.2k │ T5 │ suggest │ ⣾     │
╰─────────────────────────────────────────────────────────────────────╯
```

#### 信息段（从左到右）

| 段 | 内容 | 颜色 | 示例 |
|----|------|------|------|
| Brand | 产品名 | `theme.brand`（粗体） | `Codara` |
| Model | 当前模型名 | `theme.secondaryText` | `claude-sonnet-4` |
| Cost | 累计花费 | `theme.warning` | `$0.03` |
| Tokens | token 用量 | `theme.mutedText` | `1.2k` |
| Turns | 对话轮次 | `theme.mutedText` | `T5` |
| Mode | 权限模式 | 按模式变色（见下） | `suggest` |
| Spinner | 运行中指示 | `theme.spinner` | `⣾` |

#### 权限模式颜色

| 模式值 | 显示标签 | 颜色 |
|--------|---------|------|
| `default` | `suggest` | `theme.info` 蓝色 |
| `acceptEdits` | `auto-edit` | `theme.autoAccept` 青色 |
| `plan` | `plan` | `theme.accent` 紫色 |
| `dontAsk` | `auto` | `theme.success` 绿色 |
| `bypassPermissions` | `YOLO` | `theme.warning` 黄色 |

#### 运行状态与响应式行为

- 空闲时: 不显示 spinner
- 运行中: 显示 braille spinner
- 窄终端时: 按优先级省略段（Turns → Tokens → Cost）

---

### 3.2 InputArea — 输入区

**文件**: `src/tui/InputArea.tsx`
**位置**: StatusBar 正上方，紧贴消息流底部
**风格**: 无边框，❯ 提示符

#### 状态 A: 空闲可输入

```
╭─────────────────────────────────────────────────────────────────────╮
│  > 在此输入消息...                                                  │
╰─────────────────────────────────────────────────────────────────────╯
```

- 边框: `theme.activeBorder`（高亮）
- 提示符: accent 粗体 `❯ `
- 占位符: `"Type a message or /help…"`（`theme.mutedText` 淡色）
- 快捷键: `↑↓` 历史浏览, `Enter` 提交, `Shift+Tab` 切换模式

#### 状态 B: Agent 运行中

```
╭─────────────────────────────────────────────────────────────────────╮
│  ✦ Working...                                         Esc to stop  │
╰─────────────────────────────────────────────────────────────────────╯
```

- 边框: `theme.border`（默认/淡色）
- 左侧: star spinner + "Working…" 标签
- 右侧: `Esc to interrupt` 提示（`showInterruptHint` 为 true 时，仅无弹窗时显示）
- 输入禁用

#### 状态 C: 弹窗激活（InputArea 被遮蔽）

```
╭─────────────────────────────────────────────────────────────────────╮
│  ⏳ Waiting for your decision...                                    │
╰─────────────────────────────────────────────────────────────────────╯
```

- 边框: `theme.border`（默认/淡色）
- 显示等待提示
- 输入禁用

#### 命令历史

组件内维护历史栈：
- `上箭头`：向后导航（最近优先）
- `下箭头`：向前导航；在索引 0 时清空输入（标准 shell 行为）
- 提交时：将输入压入历史，重置索引为 -1
- 最多保存 100 条历史

---

### 3.3 MessageStream — 消息流

**文件**: `src/tui/MessageStream.tsx`

#### RenderMessage 类型

```typescript
type RenderMessage =
  | { role: "user"; content: string; id?: string }
  | { role: "assistant"; content: string; id?: string }
  | { role: "tool"; tool: string; input: Record<string, unknown>;
      output?: string; status: "running" | "done" | "error";
      isError?: boolean; callId?: string; id?: string }
  | { role: "system"; content: string; id?: string };
```

#### 按角色渲染

| 角色 | 渲染方式 | 视觉示例 |
|------|---------|---------|
| `user` | accent 粗体 `❯ ` 前缀 + 纯文本内容 | `> 请帮我重构 auth 模块` |
| `assistant` | 完整 markdown 渲染，通过 `renderMarkdown(content, theme)` | 标题 accent bold，代码块 box-wrapped + 语法高亮 |
| `tool` | 委托给 `<ToolBlock>` 组件（无边框，紧凑风格） | 见 3.5 节 |
| `system` | `theme.mutedText` 灰色斜体文本，不加前缀 | `Mode switched to: auto-edit` |

#### 助手消息 Markdown 渲染示例

```
  好的，我来分析一下 auth 模块的结构。

  ## 当前问题

  1. 认证逻辑分散在多个文件中
  2. Token 验证没有统一的错误处理

  ```typescript
  ┌──────────────────────────────────────────────────────────┐
  │ // 建议的重构方案                                        │
  │ export class AuthService {                               │
  │   async validate(token: string): Promise<AuthResult> {   │
  │     // ...                                               │
  │   }                                                      │
  │ }                                                        │
  └──────────────────────────────────────────────────────────┘
  ```
```

- 标题: `theme.accent` bold
- 列表标记: `theme.accent`
- 代码块: box-wrapped + 语法高亮
- 链接: `theme.accent` underline + `theme.mutedText` URL
- 行内代码: `theme.accent` + 反引号包裹

#### 虚拟窗口

为防止 ink 渲染溢出，只显示最近的消息：

```typescript
const maxVisible = Math.max((rows ?? 24) - 6, 10);
```

#### "Thinking..." Spinner

Star spinner + "Thinking..." 标签在以下条件显示：
- 代理运行中 (`isRunning`)
- 无对话框 (`!hasDialog`)
- 无流式文本 (`!hasStreamingText`)
- 最后一条可见消息不是工具消息

#### 性能

- 使用 `React.memo` 包装，防止不必要的重渲染
- 消息 ID（来自 App 的自增计数器）用作 React key

---

### 3.4 StreamingText — 流式文本

**文件**: `src/tui/StreamingText.tsx`

渲染原始文本（不走 markdown），带闪烁光标用于实时流式输出。

| 属性 | 类型 | 说明 |
|------|------|------|
| `text` | `string \| null` | 当前流式缓冲；`null` = 隐藏 |

#### 渲染规则

- 使用 `theme.text` 颜色（与助手消息一致）
- 末尾显示闪烁光标 `▊`（accent 颜色，500ms 间隔切换可见性）
- 不做 markdown 渲染（避免每帧重新 parse）
- 紧贴最后一条消息，无额外间距
- flush 后推入 MessageStream 并做完整 markdown 渲染

```
  I'll analyze the authentication module. The main issues are:
  1. Token validation is scattered across multiple files▊
```

#### 性能优化

- `text` 为 `null` 时返回 `null`（组件不渲染）
- 闪烁定时器依赖 `hasText`（boolean），而非 `text`（string），避免每个 delta 重启定时器

---

### 3.5 ToolBlock — 工具调用渲染

**文件**: `src/tui/ToolBlock.tsx`
**风格**: 无边框卡片，紧凑的树形结构渲染

#### 生命周期状态

| 状态 | 图标 | 边框/前缀颜色 | 输出 |
|------|------|-------------|------|
| `running` | braille spinner / star spinner | `theme.toolBorder`（Bash 用 `theme.bashBorder`） | 不显示 |
| `done` | `✓` / `✔`（绿色） | `theme.success` 绿色 | 缩进显示（非空时） |
| `error` | `✗` / `✘`（红色） | `theme.error` 红色 | 缩进显示（红色） |

#### 渲染结构（无边框风格）

```
╭─⏺ Bash: npm test           （运行中）
╭─✓ Read: src/index.tsx       （完成，无输出）
╰─done
╭─✓ Bash: git diff            （完成，有输出）
╰─M  src/app.ts
   A  src/utils.ts
╭─✗ Grep: pattern not found   （错误）
╰─Error: no matches
```

#### 带边框风格

```
状态: running
╭── theme.toolBorder (或 bashBorder) ──────────────────────╮
│  ✦ Bash  npm test --filter auth                          │
╰──────────────────────────────────────────────────────────╯

状态: done
╭── theme.success (绿色) ─────────────────────────────────╮
│  ✔ Bash  npm test --filter auth                          │
│                                                          │
│  PASS  src/auth/__tests__/validate.test.ts               │
│    ✓ validates valid JWT (3ms)                            │
│    ✓ rejects expired token (1ms)                         │
│  ... (8 lines omitted) ...                               │
│  Tests: 12 passed, 12 total                              │
╰──────────────────────────────────────────────────────────╯

状态: error
╭── theme.error (红色) ────────────────────────────────────╮
│  ✘ Bash  npm test --filter auth                          │
│                                                          │
│  FAIL  src/auth/__tests__/validate.test.ts               │
│    ✗ validates valid JWT                                  │
│      Expected: true                                      │
│      Received: false                                     │
╰──────────────────────────────────────────────────────────╯
```

#### 标题生成 (getToolTitle)

| 工具 | 格式 | 示例 |
|------|------|------|
| `Bash` | `Bash: {command}` | `Bash: npm test` |
| `Read` | `Read: {file_path}` | `Read: src/auth.ts` |
| `Write` | `Write: {file_path} ({N} lines)` | `Write: src/config.ts (42 lines)` |
| `Edit` | `Edit: {file_path} ({old}→{new} lines)` | `Edit: src/auth.ts (3→5 lines)` |
| `Glob` | `Glob: {pattern}` | `Glob: src/**/*.ts` |
| `Grep` | `Grep: {pattern} in {path}` | `Grep: "validateToken" in src/` |
| `Task` | `Task: {description}` | `Task: explore-agent` |

#### 渐进式输出更新

工具执行时，ToolBlock 不是一次性显示全部输出，而是**渐进式更新**：

**阶段 1：开始执行**
```
╭── ✦ Read  src/auth.ts ────────────────────────────────╮
│  Reading file...                                      │  ← 状态信息
╰───────────────────────────────────────────────────────╯
```

**阶段 2：执行中（可选）**
```
╭── ✦ Read  src/auth.ts ────────────────────────────────╮
│  Reading... 1024 bytes                                │  ← 进度更新
╰───────────────────────────────────────────────────────╯
```

**阶段 3：完成**
```
╭── ✔ Read  src/auth.ts ────────────────────────────────╮
│  200 lines read                                       │  ← 总结信息
╰───────────────────────────────────────────────────────╯
```

**关键特性**：
- **原地更新**：同一个 ToolBlock 滚动更新，不创建新块
- **只显示几行**：通常 1-3 行，不显示完整输出
- **总结优先**：完成后显示总结（如"200 lines read"），而不是文件内容
- **Main vs Subagent**：
  - Main Agent：可能显示更多细节（如前 10 行 + 后 10 行）
  - Subagent：只显示总结信息（如"200 lines read"）

**长输出截断示例**：

```
╭── ✔ Bash  npm test ───────────────────────────────────╮
│  PASS  src/auth/__tests__/validate.test.ts            │
│    ✓ validates valid JWT (3ms)                        │
│    ✓ rejects expired token (1ms)                      │
│  ... (8 lines omitted) ...                            │  ← 中间省略
│  Tests: 12 passed, 12 total                           │
╰───────────────────────────────────────────────────────╯
```
| `WebSearch` | `WebSearch: {query}` | `WebSearch: "React 19 features"` |
| 其他 | 工具名 | `CustomTool` |

#### 输出截断 (smartTruncate)

当输出超过限制行数时：
- 保留前 10 行 + 后 10 行
- 中间显示 `... ({N} lines omitted) ...`
- 单行超过终端宽度时由终端自动换行
- 空输出完全不渲染

---

### 3.6 PermissionDialog — 权限对话框

**文件**: `src/tui/PermissionDialog.tsx` (191 行)

紧凑的内联权限栏，当工具需要审批时显示在 InputArea 上方。保留圆角边框。

#### 四种权限选择

| 选择 | 快捷键 | 标签 | 含义 |
|------|--------|------|------|
| `allow_once` | `Y` | Yes | 仅允许此次调用 |
| `deny` | `N` | No | 拒绝此次调用 |
| `always_allow` | `A` | Always | 始终允许此工具 |
| `allow_session` | `S` | Session | 本次会话允许 |

`Esc` 是快速拒绝的快捷键。

#### 危险级别分色

```
# 安全操作 (Read, Glob, Grep)
╭── theme.info (蓝色边框) ──────────────────────────────────────╮
│  ⚡ Read: src/utils/auth.ts                                   │
│  Allow? [Y] Yes  [N] No  [A] Always  [S] Session             │
╰───────────────────────────────────────────────────────────────╯

# 修改操作 (Edit, Write)
╭── theme.warning (黄色边框) ───────────────────────────────────╮
│  ⚡ Edit: src/utils/auth.ts                                   │
│    - return decoded.valid;                                    │
│    + return decoded.valid && decoded.exp > now();             │
│  Allow? [Y] Yes  [N] No  [A] Always  [S] Session             │
╰───────────────────────────────────────────────────────────────╯

# 危险操作 (Bash with rm, chmod, git push, etc.)
╭── theme.error (红色边框) ─────────────────────────────────────╮
│  ⚠️ Bash: rm -rf node_modules && git push --force             │
│  Allow? [Y] Yes  [N] No  [A] Always  [S] Session             │
╰───────────────────────────────────────────────────────────────╯
```

#### Diff 预览

**Edit 工具** — 显示旧/新内容的首行对比：
```
╭── theme.warning ──────────────────────────────────────────────╮
│  ⚡ Edit: src/auth.ts                                         │
│    - const token = jwt.sign(payload, secret);                 │
│    + const token = jwt.sign(payload, secret, { expiresIn });  │
│  Allow? [Y] Yes  [N] No  [A] Always  [S] Session             │
╰───────────────────────────────────────────────────────────────╯
```

**Write 工具** — 显示首行 + 行数：
```
╭── theme.warning ──────────────────────────────────────────────╮
│  ⚡ Write: src/config.ts (42 lines)                           │
│    + import { z } from "zod";                                 │
│  Allow? [Y] Yes  [N] No  [A] Always  [S] Session             │
╰───────────────────────────────────────────────────────────────╯
```

#### 200ms 防抖

对话框出现后的前 200ms 忽略所有按键，防止用户正在打字时误操作。

#### 导航

- `Tab` / 方向键：移动焦点
- `Enter`：提交聚焦按钮
- 快捷键（`Y/N/A/S`）：直接执行
- 聚焦按钮使用 `inverse` + `bold` 样式

---

### 3.7 QuestionDialog — 问题对话框

**文件**: `src/tui/QuestionDialog.tsx` (308 行)

处理 `ask_user` 事件，支持单选和多选问题流。

#### 单选模式

```
╭──────────────────────────────────────────────────────────────────────╮
│  Authentication                                          [1/3]      │
│  Which authentication method should we use?                         │
│                                                                     │
│  ● JWT tokens (Recommended)                                         │
│    Stateless, scalable, standard for APIs                           │
│  ○ Session cookies                                                  │
│    Server-side sessions, simpler but stateful                       │
│  ○ OAuth 2.0                                                        │
│    Federated identity, complex setup                                │
│  ○ Other...                                                         │
│                                                                     │
│  Tab/↑↓ navigate · Enter select                                     │
╰──────────────────────────────────────────────────────────────────────╯
```

- `●`（选中）/ `○`（未选中）
- `Tab/↑↓` 导航，`Enter` 选择
- 底部自动有 "Other" 选项供自由输入
- 多问题时: 显示 `[1/3]` 进度，逐个回答

#### 多选模式

```
╭──────────────────────────────────────────────────────────────────────╮
│  Features                                                [2/3]      │
│  Which features do you want to enable?                              │
│                                                                     │
│  ■ TypeScript strict mode                                           │
│  ■ ESLint integration                                               │
│  □ Prettier formatting                                              │
│  □ Husky pre-commit hooks                                           │
│  □ Other...                                                         │
│                                                                     │
│  Tab/↑↓ navigate · Space toggle · Enter submit                      │
╰──────────────────────────────────────────────────────────────────────╯
```

- `■`（选中）/ `□`（未选中）
- `Tab/↑↓` 导航，`Space` 切换，`Enter` 提交
- 选中项以逗号分隔连接

#### Markdown 预览面板

当选项有 `markdown` 属性时，单选模式使用左右分栏布局：左列选项，右列预览。

```
╭──────────────────────────────────────────────────────────────────────╮
│  Layout                                                             │
│  Which layout approach?                                             │
│                                                                     │
│  ● Approach A        │  ┌──────────────┐                            │
│  ○ Approach B        │  │ Header       │                            │
│  ○ Approach C        │  │ ┌──────────┐ │                            │
│                      │  │ │ Content  │ │                            │
│                      │  │ └──────────┘ │                            │
│                      │  │ Footer       │                            │
│                      │  └──────────────┘                            │
│                                                                     │
│  Tab/↑↓ navigate · Enter select                                     │
╰──────────────────────────────────────────────────────────────────────╯
```

#### 交互规则

- Tab/Arrow: 在选项间导航
- Enter: 单选模式下选择当前项
- Space: 多选模式下切换当前项
- Enter (多选): 提交所有选中项
- "Other" 选项: 选中后展开 TextInput，Esc 退出编辑

---

### 3.8 ConfirmDialog — 确认对话框

用于计划审批、危险操作确认等需要明确 Yes/No 决策的场景。

```
╭──────────────────────────────────────────────────────────────────────╮
│  Plan Approval                                                       │
│  The agent has prepared an implementation plan.                      │
│  Do you want to proceed?                                             │
│                                                                      │
│  [Y] Approve   [N] Reject with feedback                             │
╰──────────────────────────────────────────────────────────────────────╯
```

- `Y`：批准，代理继续执行
- `N`：拒绝，展开 TextInput 输入反馈理由
- 用于 Plan 模式退出审批、worktree 清理确认等

---

### 3.9 Spinner — 动画指示器

**文件**: `src/tui/Spinner.tsx` (41 行)

两种类型:

| 类型 | 帧序列 | 间隔 | 用途 |
|------|--------|------|------|
| `star` | `✦ ✶ ✳ ✵ ❋ ✿` | 120ms | InputArea "Working..."、MessageStream "Thinking..." |
| `braille` | `⣾ ⣽ ⣻ ⢿ ⡿ ⣟ ⣯ ⣷` | 80ms | StatusBar 运行指示器、ToolBlock 运行状态 |

---

### 3.10 TodoWrite 与 Task 进度渲染

**文件**: `src/tui/ProgressIndicator.tsx` (假设)

Codara 提供两种任务跟踪机制，TUI 对它们的渲染方式不同：

#### TodoWrite — 轻量级进度条

**定位**: 单代理内部的执行中进度跟踪，内存存储，会话级生命周期。

**渲染位置**: 作为系统消息插入到消息流中，显示在代理输出的上下文位置。

**视觉样式**:

```
╭─ Progress ────────────────────────────────────────────────╮
│  ⬡ 分析项目结构                                            │
│  ◉ 重写工具文档          ← 当前进行中                       │
│  ⬡ 更新导航链接                                            │
│  ✓ 创建任务列表                                            │
╰───────────────────────────────────────────────────────────╯
```

**状态图标**:
- `⬡` (空心六边形): `pending` — 待处理
- `◉` (实心圆): `in_progress` — 进行中（accent 颜色 + 粗体）
- `✓` (对勾): `completed` — 已完成（success 颜色）

**更新机制**:
- 代理调用 `TodoWrite` 工具时，TUI 收到 `todo_update` 事件
- 如果已存在 TODO 进度框，原地更新内容
- 如果不存在，插入新的系统消息渲染进度框
- 进度框保持在消息流中，不会消失，用户可回看历史进度

**典型场景**: 代理处理复杂任务时，将工作分步可视化，让用户了解当前执行阶段。

#### Task* — 持久化任务列表

**定位**: 跨代理共享的持久化任务管理，磁盘存储（`~/.codara/tasks/`），支持依赖管理和多代理协作。

**渲染位置**: 不自动渲染到消息流。用户或代理调用 `TaskList` 工具时，作为工具输出显示。

**视觉样式**:

```
╭── ✔ TaskList ─────────────────────────────────────────────╮
│  #1 [in_progress] 重构权限系统文档 (owner: main-agent)     │
│  #2 [pending] 添加 TUI 测试用例 (blocked by: #1)           │
│  #3 [completed] 设计插件架构 (owner: researcher)           │
│  #4 [pending] 实现 worktree 隔离                           │
╰───────────────────────────────────────────────────────────╯
```

**状态标签**:
- `[pending]`: 待处理（灰色）
- `[in_progress]`: 进行中（accent 颜色 + 粗体）
- `[completed]`: 已完成（success 颜色）
- `[deleted]`: 已删除（不显示）

**依赖关系显示**:
- `(blocked by: #1, #2)`: 前置任务未完成，当前任务被阻塞
- `(blocks: #3, #4)`: 当前任务完成后才能开始的下游任务

**负责人显示**:
- `(owner: agent-name)`: 任务已分配给特定代理
- 无 owner 标签: 任务未分配，可被认领

**更新机制**:
- Task* 工具（TaskCreate/TaskUpdate）的输出作为普通工具结果渲染
- 不会自动刷新或推送更新到 TUI
- 代理需要主动调用 `TaskList` 查看最新状态

**Main Agent vs Subagent 渲染差异**:

| 维度 | Main Agent | Subagent |
|------|-----------|----------|
| **Task 列表** | 作为工具输出显示 | **突出显示**，是主要内容 |
| **工具输出** | 显示详细内容 | 只显示总结信息（1-3 行） |
| **目的** | 完整执行过程 | 清晰展示主线任务流程 |

**Subagent 简化示例**:

```
[Subagent: explore-agent]

╭── ✔ TaskList ─────────────────────────────────────────╮
│  #1 [in_progress] Analyze codebase (owner: me)       │  ← 任务列表突出
│  #2 [pending] Write documentation                    │
╰───────────────────────────────────────────────────────╯

╭── ✦ Glob  src/**/*.ts ────────────────────────────────╮
│  Found 42 files                                       │  ← 只显示总结
╰───────────────────────────────────────────────────────╯

╭── ✔ TaskUpdate ───────────────────────────────────────╮
│  Task #1 marked as completed                          │
╰───────────────────────────────────────────────────────╯
```

**典型场景**: 主代理创建任务列表，生成从代理后，从代理通过 `TaskList` 发现可用任务，用 `TaskUpdate` 认领并更新状态。用户主要通过 Task 列表跟踪 Subagent 进度，而不是被详细输出淹没。

#### 对比总结

| 维度 | TodoWrite | Task* |
|------|-----------|-------|
| **TUI 渲染** | 自动插入系统消息，显示进度框 | 作为工具输出显示，不自动刷新 |
| **渲染触发** | `todo_update` 事件 | `TaskList` 工具调用 |
| **视觉位置** | 消息流中，跟随代理输出 | 工具输出框中 |
| **更新方式** | 原地更新（同一进度框） | 每次 TaskList 生成新输出 |
| **持久性** | 会话级，关闭后消失 | 磁盘持久化，跨会话保留 |
| **典型用户** | 单代理内部进度可视化 | 多代理任务协调与分派 |

---

## 4. 交互模式

### 4.1 键盘快捷键总表

| 快捷键 | 上下文 | 行为 |
|--------|--------|------|
| `Enter` | 输入框 | 提交消息 |
| `↑` / `↓` | 输入框 | 浏览命令历史 |
| `Shift+Tab` | 空闲时 | 循环权限模式: default → acceptEdits → plan → default |
| `Esc` | Agent 运行中 | 通过 `AbortController` 中断当前执行 |
| `Ctrl+C` | 任何时候 | 退出 Codara |
| `Y` | 权限弹窗 | Allow once |
| `N` | 权限弹窗 | Deny |
| `A` | 权限弹窗 | Always allow |
| `S` | 权限弹窗 | Allow for session |
| `Esc` | 权限弹窗 | Deny |
| `Tab` / `↑↓` | 弹窗中 | 导航选项 |
| `Enter` | 弹窗中 | 确认选择 |
| `Space` | 多选弹窗 | 切换选中状态 |

### 4.2 状态机

```
                    ┌──────────┐
                    │   IDLE   │ ← 用户可输入
                    └────┬─────┘
                         │ Enter (提交消息)
                         ▼
                    ┌──────────┐
            ┌───── │ RUNNING  │ ← Agent 执行中
            │      └────┬─────┘
            │           │
            │    ┌──────┼──────────────┐
            │    │      │              │
            │    ▼      ▼              ▼
            │  ┌────┐ ┌──────┐  ┌───────────┐
            │  │PERM│ │QUEST │  │ STREAMING │
            │  │DIAL│ │DIAL  │  │   TEXT    │
            │  └──┬─┘ └──┬───┘  └─────┬─────┘
            │     │      │            │
            │     └──────┼────────────┘
            │            │ resolve / flush
            │            ▼
            │      ┌──────────┐
            │      │ RUNNING  │ ← 继续执行
            │      └────┬─────┘
            │           │ done event
            ▼           ▼
       ┌──────────┐
       │   IDLE   │ ← 等待下一次输入
       └──────────┘
```

### 4.3 消息流转生命周期

```
用户输入
  │
  ▼
text_delta events ──→ StreamingText (实时显示)
  │
  ▼ (非 text_delta 事件到来)
flush StreamingText ──→ 作为 assistant 消息追加到 MessageStream
  │
  ▼
tool_start ──→ ToolBlock (status: running)
  │
  ▼
[可能] permission_request ──→ PermissionDialog
  │                             │
  │                      resolve (Y/N/A/S)
  │                             │
  ▼                             ▼
tool_end ──→ 更新 ToolBlock (status: done/error)
  │
  ▼
[可能] 更多 text_delta / tool_start ...
  │
  ▼
done event ──→ flush 残余 StreamingText, 显示终止原因 (如有)
  │
  ▼
回到 IDLE
```

### 4.4 斜杠命令

| 命令 | 行为 | 反馈 |
|------|------|------|
| `/clear` | 清空消息列表 | 静默清除 |
| `/compact` | 触发上下文压缩 | 系统消息: `⟳ Triggering manual compaction...` → `Compaction complete: N → M tokens` |
| `/help` | 显示帮助信息 | 系统消息: 命令列表 + 快捷键列表 + 技能列表 |
| `/quit` `/exit` | 退出 Codara | 直接退出 |
| `/<skill>` | 运行自定义技能 | 作为用户消息发送给 agent |

---

## 5. 视觉规范

### 5.1 间距规则

| 元素 | 间距 |
|------|------|
| 消息之间 | `marginBottom={1}` (1 空行) |
| ToolBlock 内部输出 | `marginLeft={2}` `marginTop={1}` |
| 弹窗内部 | `paddingX={2}` `paddingY={1}` |
| InputArea 内部 | `paddingX={1}` |
| StatusBar 内部 | `paddingX={1}` |
| 弹窗与 InputArea 之间 | 无额外间距（自然紧贴） |

### 5.2 边框规范

所有边框使用 `borderStyle="round"` (圆角)。

| 组件 | 边框颜色 | 条件 |
|------|---------|------|
| StatusBar | `theme.border` | 始终 |
| InputArea (空闲) | `theme.activeBorder` | 可输入时高亮 |
| InputArea (禁用) | `theme.border` | 运行中/弹窗时 |
| ToolBlock (运行中) | `theme.toolBorder` / `theme.bashBorder` | Bash 用 amber |
| ToolBlock (完成) | `theme.success` | 绿色 |
| ToolBlock (错误) | `theme.error` | 红色 |
| PermissionDialog (安全) | `theme.info` | Read/Glob/Grep |
| PermissionDialog (修改) | `theme.warning` | Edit/Write |
| PermissionDialog (危险) | `theme.error` | Bash(rm/chmod/push...) |
| QuestionDialog | `theme.permissionBorder` | 始终 |

### 5.3 图标规范

| 图标 | 含义 | 使用场景 |
|------|------|---------|
| `⚡` | 权限请求 | PermissionDialog 标题 |
| `⚠️` | 危险操作 | 危险权限请求 |
| `✦` | 运行中 (star spinner) | ToolBlock running, InputArea working |
| `⣾` | 运行中 (braille spinner) | StatusBar |
| `✔` / `✓` | 完成 | ToolBlock done |
| `✘` / `✗` | 错误 | ToolBlock error |
| `>` / `❯` | 用户输入 | InputArea, 用户消息前缀 |
| `▊` | 光标 | StreamingText 闪烁光标 |
| `↳` | 子 agent | agent_spawned/completed 系统消息 |
| `⊘` | 拒绝/中断 | tool_denied, done(非 complete) |
| `⟳` | 压缩 | compact_start/end |
| `•` | 列表项 | Markdown 无序列表 |
| `●` / `○` | 单选 选中/未选中 | QuestionDialog 单选 |
| `■` / `□` | 多选 选中/未选中 | QuestionDialog 多选 |
| `│` | 引用前缀 | Markdown 块引用 |
| `╭─` / `╰─` | 工具调用结构线 | ToolBlock 标题/输出 |

### 5.4 截断规则

| 内容 | 规则 |
|------|------|
| 工具标题 | `Math.max(columns - 10, 30)` 字符 |
| Bash 命令 | `Math.max(columns - 16, 40)` 字符 |
| 工具输出 | 前 10 行 + 后 10 行，中间 omit |
| Diff 预览行 | 50 字符 |
| 默认参数 JSON | 60 字符 |
| Markdown 代码块宽度 | `Math.min(maxLineWidth, columns - 4)` |
| Markdown 水平线 | `Math.min(columns, 80) - 4` |

---

## 6. `<Static>` 消息滚动方案

### 6.1 核心思路

将**已完成的完整 turn**（包含该 turn 所有的 assistant 文本、tool 调用、系统消息）推入 `<Static>`，使其进入终端原生 scrollback 缓冲区。仅保留**当前活跃 turn** 的内容在 ink 动态渲染区。

### 6.2 消息分类

```typescript
// 已完成的消息 → <Static> (终端原生 scrollback)
const completedMessages = messages.filter(m => m.turnComplete);

// 当前 turn 活跃消息 → 动态渲染
const activeMessages = messages.filter(m => !m.turnComplete);
```

### 6.3 Turn 完成判定

一个 turn 在以下条件之一满足时标记为 complete:
1. 收到 `done` 事件
2. 用户提交了新的输入（前一个 turn 的所有消息标记为 complete）
3. 收到 `interrupted` 事件

### 6.4 优势

| 方面 | 之前 (slice window) | 之后 (Static) |
|------|---------------------|----------------|
| 历史回看 | 丢失，只看到最近 N 条 | 终端原生滚动，全部可回看 |
| 渲染负担 | 每帧渲染全部可见消息 | 只渲染当前 turn |
| 视觉连续性 | 消息突然消失 | 自然滚出视口 |
| 内存 | 全部 messages 在 React state | 已完成的被 ink 静态化 |

---

## 7. 响应式行为

### 7.1 终端尺寸适应

```typescript
// 监听终端 resize
useEffect(() => {
  const onResize = () => {
    setRows(stdout.rows ?? 24);
    setCols(stdout.columns ?? 80);
  };
  stdout.on("resize", onResize);
  return () => stdout.off("resize", onResize);
}, [stdout]);
```

### 7.2 窄终端适应（< 60 columns）

- StatusBar: 省略 Turns → Tokens → Cost 段
- ToolBlock: 标题截断更激进
- PermissionDialog: 按钮缩写 `[Y] [N] [A] [S]`（去掉 label）
- QuestionDialog: 描述文字折行

### 7.3 矮终端适应（< 15 rows）

- 弹窗和 InputArea 压缩到最小高度
- StreamingText 限制最大显示行数
- 系统消息合并/省略

---

## 8. Markdown 渲染管线

**文件**: `src/tui/markdown.ts` (207 行)

### 8.1 管线流程

```
Markdown 字符串
    │
    ▼
marked.lexer(md) → Token[]
    │
    ▼
renderTokens(tokens, theme) → 遍历每个 token
    │
    ▼
renderToken(token, theme) → 每个块级元素的 ANSI 格式化字符串
    │
    ▼
最终 ANSI 字符串 (.trim())
```

### 8.2 块级 Token

| Token 类型 | 渲染方式 |
|-----------|---------|
| `heading` | `#` 前缀（按深度重复），accent 颜色 + 粗体 |
| `paragraph` | 子 token 的行内渲染 |
| `code` | 语言标签（灰色） + 语法高亮 + `boxWrap()` 边框包裹 |
| `list` | 有序（`1.`, `2.`）或无序（`•`），accent 颜色标记 |
| `blockquote` | 每行前缀 `│ `（边框色），内容斜体次要文本 |
| `hr` | 水平线：`─` 重复至 `min(columns, 80) - 4` 字符 |
| `space` | 换行 |

### 8.3 行内 Token

| Token 类型 | 渲染方式 |
|-----------|---------|
| `strong` | `chalk.bold()` |
| `em` | `chalk.italic()` |
| `del` | `chalk.strikethrough()` |
| `link` | 下划线文本（accent） + URL 括号（灰色） |
| `codespan` | accent 颜色文本包裹在反引号中，HTML 实体已解码 |
| `text` | 主题文本颜色，HTML 实体已解码 |

### 8.4 代码语法高亮

使用 highlight.js 管线：

```
代码字符串 + 语言
    │
    ▼
hljs.highlight(code, { language }) → 带 <span class="hljs-*"> 的 HTML
    │
    ▼
hljsToAnsi(html, theme) → ANSI 转义序列
```

`hljsToAnsi` 使用**颜色栈**处理嵌套 span：
- 遇到 `<span class="hljs-keyword">`：压入颜色栈，输出 `\x1b[38;2;R;G;Bm`
- 遇到 `</span>`：弹出栈，恢复父颜色（不是完全重置）

### 8.5 boxWrap 代码块边框

```
┌──────────────────────┐
│ code line 1          │
│ code line 2          │
└──────────────────────┘
```

- 宽度：`min(max(maxLineLength, 40), termWidth - 4)`
- 行尾用空格填充以对齐右边框 `│`
- 使用 `stripAnsi()` 测量可见字符宽度

---

## 9. App.tsx 状态管理

**文件**: `src/tui/App.tsx`

### 9.1 状态

| 状态 | 类型 | 用途 |
|------|------|------|
| `messages` | `RenderMessage[]` | 所有显示的消息（用户、助手、工具、系统） |
| `isRunning` | `boolean` | 代理是否正在执行 |
| `status` | `StatusData` | 模型名、成本、token 数、轮次、权限模式 |
| `pendingPerm` | `object \| null` | 活跃的权限对话框状态 + resolve 回调 |
| `pendingQuestion` | `object \| null` | 活跃的问题对话框状态 + resolve 回调 |
| `streamingText` | `string \| null` | 当前流式文本缓冲（独立于 messages） |
| `rows` | `number` | 终端高度，通过 resize 监听器跟踪 |

### 9.2 事件分发

`handleAgentEvent` 回调处理代理循环发出的所有 `AgentEvent` 类型：

| 事件类型 | 行为 |
|---------|------|
| `text_delta` | 追加到 `streamingText`（绕过 messages 数组） |
| `tool_start` | flush 流式文本，添加 `status: "running"` 的工具消息 |
| `tool_end` | 更新匹配的工具消息为 `"done"` 或 `"error"` |
| `permission_request` | flush 流式文本，显示 `PermissionDialog` |
| `ask_user` | flush 流式文本，显示 `QuestionDialog` |
| `status_update` | 更新状态栏数据 |
| `tool_denied` | 添加系统消息，显示拒绝原因 |
| `compact_start` / `compact_end` | 添加系统消息，显示压缩进度 |
| `agent_spawned` / `agent_completed` | 添加系统消息，显示子代理生命周期 |
| `done` | flush 流式文本，非 "complete" 时显示终止原因 |

### 9.3 流式文本架构

流式文本有意与 `messages` 数组分离，避免每个 token delta 都重渲染整个 `MessageStream`（涉及 markdown 解析）。流程：

1. `text_delta` 事件追加到 `streamingTextRef` 并更新 `streamingText` 状态
2. `StreamingText` 组件渲染原始文本 + 闪烁光标
3. 当非文本事件到来（或轮次结束），`flushStreamingText()` 将累积文本作为 `assistant` 消息移入 `messages`，触发一次 markdown 渲染

---

## 10. 渲染注意事项

### 10.1 终端尺寸

- **行数**：通过 React 状态 + `stdout.on("resize")` 监听器跟踪，默认 24
- **列数**：直接从 `process.stdout.columns` 读取（默认 80），不跟踪状态

### 10.2 溢出防护

- 内容区域：`overflowY="hidden"` 防止 ink 渲染超出终端边界
- MessageStream 虚拟窗口：只渲染 `rows - 6` 条消息（最少 10 条）
- ToolBlock 标题截断：`max(columns - 12, 40)` 字符
- 代码块边框宽度：上限 `termWidth - 4`

### 10.3 性能优化

- **StreamingText 分离**：token delta 只更新 `streamingText` 状态，不触动 `messages` 数组，避免每次 delta 重新解析 markdown
- **React.memo on MessageStream**：仅在 messages/isRunning 等核心 prop 变化时重渲染
- **消息 ID**：自增计数器提供稳定的 React key
- **Ref 事件处理器**：`handleAgentEventRef` 确保事件处理器始终引用最新闭包

---

## 附录: ASCII 布局速查

### 完整交互场景 — Agent 执行中遇到权限请求

```
                          ← 终端 scrollback 区域 (历史消息) →

  > 请帮我添加用户认证

  我来帮你实现用户认证功能。首先让我了解一下项目结构。

  ╭── ✔ Read  src/index.ts ────────────────────────────────╮
  │  import express from "express";                        │
  │  const app = express();                                │
  │  ...                                                   │
  ╰────────────────────────────────────────────────────────╯

  好的，我需要安装 jsonwebtoken 包。

  ╭── ⚡ ──────────────────────────────────────────────────╮  ← PermissionDialog
  │  ⚡ Bash: npm install jsonwebtoken @types/jsonwebtoken  │
  │  Allow? [Y] Yes  [N] No  [A] Always  [S] Session       │
  ╰────────────────────────────────────────────────────────╯

  ╭──────────────────────────────────────────────────────╮  ← InputArea (disabled)
  │  ⏳ Waiting for your decision...                      │
  ╰──────────────────────────────────────────────────────╯

  ╭──────────────────────────────────────────────────────╮  ← StatusBar (底部固定)
  │  Codara │ claude-sonnet-4 │ $0.05 │ 2.1k │ T3     │
  ╰──────────────────────────────────────────────────────╯
```

### Agent 正常输出（无弹窗）

```
  > 分析一下这个函数的时间复杂度

  这个函数使用了嵌套循环，让我分析一下：▊           ← StreamingText

  ╭──────────────────────────────────────────────────────╮  ← InputArea (running)
  │  ✦ Working...                         Esc to stop   │
  ╰──────────────────────────────────────────────────────╯

  ╭──────────────────────────────────────────────────────╮  ← StatusBar
  │  Codara │ claude-sonnet-4 │ $0.02 │ 0.8k │ T1 │⣾ │
  ╰──────────────────────────────────────────────────────╯
```

### 空闲等待输入

```
  > 你好

  你好！我是 Codara，一个终端 AI 编程助手。有什么可以帮你的？

  ╭──────────────────────────────────────────────────────╮  ← InputArea (active)
  │  > |                                                 │
  ╰──────────────────────────────────────────────────────╯

  ╭──────────────────────────────────────────────────────╮  ← StatusBar
  │  Codara │ claude-sonnet-4 │ $0.01 │ 0.3k │ T1     │
  ╰──────────────────────────────────────────────────────╯
```

---

## 11. 人在回路机制

### 11.1 概述

Codara 的人在回路（Human-in-the-Loop）交互通过三种对话框实现：

| 对话框类型 | 选项数量 | 用途 | 实现文件 |
|-----------|---------|------|---------|
| **PermissionDialog** | 4 个固定选项 | 工具调用权限审批 | `src/tui/PermissionDialog.tsx` |
| **QuestionDialog** | 2-4 个可配置选项 | AI 驱动的决策询问 | `src/tui/QuestionDialog.tsx` |
| **ConfirmDialog** | 2 个固定选项 | 明确的 Yes/No 决策 | `src/tui/ConfirmDialog.tsx` |

### 11.2 PermissionDialog — 工具权限审批

#### 触发时机

当 Agent 调用工具时，PermissionMiddleware 根据权限模式和规则决定是否需要用户审批：

```typescript
// 触发条件（05-permissions.md 详细说明）
1. 权限模式为 default 且工具不在 always_allow 列表
2. 工具在 always_deny 列表（直接拒绝，不显示对话框）
3. PreToolUse Hook 返回 { allow: false }（优先级最高）
```

#### 四种权限选择

| 选择 | 快捷键 | 效果 | 持久化 |
|------|--------|------|--------|
| `allow_once` | `Y` | 仅允许此次调用 | 否 |
| `deny` | `N` | 拒绝此次调用 | 否 |
| `always_allow` | `A` | 始终允许此工具 | 写入 `settings.json` |
| `allow_session` | `S` | 本次会话允许 | 内存中，会话结束失效 |

#### 事件回调模式

```typescript
// Agent 循环发出 permission_request 事件
type PermissionRequestEvent = {
  type: "permission_request";
  toolName: string;
  toolInput: Record<string, unknown>;
  dangerLevel: "safe" | "modify" | "danger";
  resolve: (decision: PermissionDecision) => void;
};

// App.tsx 处理
const handleAgentEvent = (event: AgentEvent) => {
  if (event.type === "permission_request") {
    setPendingPerm({
      toolName: event.toolName,
      toolInput: event.toolInput,
      dangerLevel: event.dangerLevel,
      resolve: event.resolve,
    });
  }
};

// PermissionDialog 用户选择后
const onDecision = (decision: PermissionDecision) => {
  pendingPerm.resolve(decision);
  setPendingPerm(null);
};
```

#### 与权限系统集成

PermissionDialog 是 PermissionMiddleware 的 UI 层：

```
ToolCall 请求
    │
    ▼
PreToolUse Hooks (priority 55) ──→ 可直接拒绝
    │
    ▼
PermissionMiddleware (priority 50)
    │
    ├─→ always_allow / acceptEdits 模式 ──→ 直接通过
    ├─→ always_deny ──→ 直接拒绝
    └─→ 需要审批 ──→ 发出 permission_request 事件
                        │
                        ▼
                   PermissionDialog 显示
                        │
                        ▼
                   用户选择 (Y/N/A/S)
                        │
                        ▼
                   resolve(decision)
                        │
                        ▼
            PermissionMiddleware 根据决策执行/拒绝
```

### 11.3 QuestionDialog — AI 驱动决策询问

#### 触发时机

Agent 通过 `AskUserQuestion` 工具主动询问用户：

```typescript
// Agent 调用 AskUserQuestion 工具
{
  questions: [
    {
      question: "Which authentication method should we use?",
      header: "Auth method",
      options: [
        { label: "JWT tokens", description: "Stateless, scalable..." },
        { label: "Session cookies", description: "Server-side..." },
        { label: "OAuth 2.0", description: "Federated identity..." }
      ],
      multiSelect: false
    }
  ]
}
```

#### 单选 vs 多选

**单选模式** (`multiSelect: false`):
- 用户只能选择一个选项
- `Tab/↑↓` 导航，`Enter` 确认
- 自动添加 "Other..." 选项供自由输入

**多选模式** (`multiSelect: true`):
- 用户可选择多个选项
- `Tab/↑↓` 导航，`Space` 切换，`Enter` 提交
- 选中项以逗号分隔返回

#### Markdown 预览面板

当选项有 `markdown` 属性时，单选模式使用左右分栏布局：

```
╭──────────────────────────────────────────────────────────────────────╮
│  Layout                                                             │
│  Which layout approach?                                             │
│                                                                     │
│  ● Approach A        │  ┌──────────────┐                            │
│  ○ Approach B        │  │ Header       │                            │
│  ○ Approach C        │  │ ┌──────────┐ │                            │
│                      │  │ │ Content  │ │                            │
│                      │  │ └──────────┘ │                            │
│                      │  │ Footer       │                            │
│                      │  └──────────────┘                            │
│                                                                     │
│  Tab/↑↓ navigate · Enter select                                     │
╰──────────────────────────────────────────────────────────────────────╯
```

用于可视化比较不同方案（ASCII 布局图、代码片段、配置示例）。

#### 事件回调模式

```typescript
// Agent 循环发出 ask_user 事件
type AskUserEvent = {
  type: "ask_user";
  questions: Question[];
  resolve: (answers: Record<string, string>) => void;
};

// App.tsx 处理
const handleAgentEvent = (event: AgentEvent) => {
  if (event.type === "ask_user") {
    setPendingQuestion({
      questions: event.questions,
      resolve: event.resolve,
    });
  }
};

// QuestionDialog 用户完成所有问题后
const onComplete = (answers: Record<string, string>) => {
  pendingQuestion.resolve(answers);
  setPendingQuestion(null);
};
```

#### 多问题流程

当 `questions` 数组包含多个问题时，QuestionDialog 逐个显示：

```
Question 1/3 → 用户回答 → Question 2/3 → 用户回答 → Question 3/3 → 提交所有答案
```

右上角显示进度 `[1/3]`，所有问题回答完毕后一次性返回 `answers` 对象。

### 11.4 ConfirmDialog — 明确决策

#### 触发场景

用于需要明确 Yes/No 决策的场景：

1. **Plan 模式退出审批**: Agent 完成计划后请求用户批准
2. **Worktree 清理确认**: 会话结束时询问是否保留 worktree
3. **危险操作二次确认**: 如删除分支、force push 等

#### 两种选择

| 选择 | 快捷键 | 行为 |
|------|--------|------|
| `approve` | `Y` | 批准操作，继续执行 |
| `reject` | `N` | 拒绝操作，展开 TextInput 输入反馈理由 |

#### 反馈输入

当用户选择 `N` 拒绝时，对话框展开为文本输入框：

```
╭──────────────────────────────────────────────────────────────────────╮
│  Plan Approval                                                       │
│  The agent has prepared an implementation plan.                      │
│  Do you want to proceed?                                             │
│                                                                      │
│  Feedback (optional):                                                │
│  > Please add error handling for the API calls|                     │
│                                                                      │
│  Enter to submit · Esc to cancel                                     │
╰──────────────────────────────────────────────────────────────────────╯
```

反馈内容会传递给 Agent，用于调整计划或操作。

#### 事件回调模式

```typescript
// Agent 循环发出 confirm_request 事件
type ConfirmRequestEvent = {
  type: "confirm_request";
  title: string;
  message: string;
  resolve: (result: { approve: boolean; feedback?: string }) => void;
};

// App.tsx 处理
const handleAgentEvent = (event: AgentEvent) => {
  if (event.type === "confirm_request") {
    setPendingConfirm({
      title: event.title,
      message: event.message,
      resolve: event.resolve,
    });
  }
};

// ConfirmDialog 用户决策后
const onDecision = (approve: boolean, feedback?: string) => {
  pendingConfirm.resolve({ approve, feedback });
  setPendingConfirm(null);
};
```

### 11.5 设计原则

#### 一致性

所有对话框遵循统一的交互模式：

- **圆角边框**: `borderStyle="round"`
- **快捷键优先**: 单键快捷键（Y/N/A/S）无需 Ctrl/Alt 修饰
- **Esc 退出**: 所有对话框支持 Esc 快速取消/拒绝
- **200ms 防抖**: 对话框出现后前 200ms 忽略按键，防止误操作

#### 可访问性

- **键盘导航**: Tab/方向键在所有选项间移动
- **视觉反馈**: 聚焦项使用 `inverse` + `bold` 样式
- **状态指示**: 单选 `●/○`，多选 `■/□`，清晰区分选中状态
- **进度提示**: 多问题流程显示 `[1/3]` 进度

#### 用户体验

- **内联显示**: 对话框显示在 InputArea 上方，不遮挡历史消息
- **上下文保留**: 对话框显示时，相关工具调用/问题内容仍可见
- **即时反馈**: 用户选择后立即关闭对话框，无延迟
- **错误恢复**: 拒绝操作不会中断会话，Agent 可调整策略继续

### 11.6 与 Agent 循环集成

人在回路机制是 Agent 循环的同步阻塞点：

```
Agent 执行
    │
    ▼
需要用户输入 (权限/问题/确认)
    │
    ▼
发出事件 (permission_request / ask_user / confirm_request)
    │
    ▼
Agent 循环暂停，等待 resolve() 回调
    │
    ▼
TUI 显示对话框
    │
    ▼
用户交互 (选择/输入)
    │
    ▼
调用 resolve(result)
    │
    ▼
Agent 循环恢复，根据 result 继续执行
```

这种事件回调模式确保：
1. Agent 逻辑与 UI 解耦（Agent 不依赖 TUI 实现）
2. 支持多种 UI 前端（TUI、GUI、Web）
3. 可测试性（Mock resolve 回调即可测试 Agent 逻辑）

---
