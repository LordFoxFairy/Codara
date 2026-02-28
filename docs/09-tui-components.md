# TUI 组件与渲染管线

> [← 上一篇: 记忆系统](./08-memory-system.md) | [目录](./README.md) | [下一篇: UI 交互设计 →](./10-ui-interaction-design.md)

本文档覆盖 `src/tui/` 中的所有组件、主题系统、markdown 渲染管线，以及它们如何组合成终端界面。

---

## 组件层级

```
App (根组件 — src/tui/App.tsx)
│
├── ThemeProvider (上下文包装器)
│   │
│   ├── StatusBar (顶部状态栏 — 无边框，紧凑单行)
│   ├── Separator (分隔线 ─────)
│   │
│   └── 内容区域 (flexGrow=1, justifyContent="flex-end")
│       ├── MessageStream (消息流列表)
│       ├── StreamingText (实时 token 流)
│       ├── PermissionDialog (条件显示 — 工具审批)
│       ├── QuestionDialog (条件显示 — 用户问题)
│       ├── Separator (分隔线 ─────)
│       └── InputArea (底部输入区 — ❯ 提示符，无边框)
```

根布局是一个垂直 `Box`，高度为 `height={rows}`（通过 resize 监听器跟踪）。StatusBar 位于顶部，单行无边框。下方以分隔线隔开，内容区域使用 `flex-end` 向下对齐，`overflowY="hidden"` 防止 ink 渲染溢出。

---

## 入口点 (index.tsx)

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

## 主题系统 (theme.ts)

**文件**: `src/tui/theme.ts` (225 行)

### 可用主题

六套主题，分三组：

| 主题 | 适用环境 | 色彩空间 |
|------|---------|---------|
| `dark` | 深色终端 | 24 位 hex (`#RRGGBB`) |
| `light` | 浅色终端 | 24 位 hex |
| `dark-ansi` | 基础 16 色终端 | ANSI 命名颜色 |
| `light-ansi` | 基础 16 色浅色终端 | ANSI 命名颜色 |
| `dark-daltonized` | 色盲用户，深色 | 蓝/橙替代绿/红 |
| `light-daltonized` | 色盲用户，浅色 | 蓝/橙替代绿/红 |

### 语义化颜色 Token (ThemeColors)

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

### API

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

## Markdown 渲染器 (markdown.ts)

**文件**: `src/tui/markdown.ts` (207 行)

### 管线

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

### 块级 Token

| Token 类型 | 渲染方式 |
|-----------|---------|
| `heading` | `#` 前缀（按深度重复），accent 颜色 + 粗体 |
| `paragraph` | 子 token 的行内渲染 |
| `code` | 语言标签（灰色） + 语法高亮 + `boxWrap()` 边框包裹 |
| `list` | 有序（`1.`, `2.`）或无序（`•`），accent 颜色标记 |
| `blockquote` | 每行前缀 `│ `（边框色），内容斜体次要文本 |
| `hr` | 水平线：`─` 重复至 `min(columns, 80) - 4` 字符 |
| `space` | 换行 |

### 行内 Token

| Token 类型 | 渲染方式 |
|-----------|---------|
| `strong` | `chalk.bold()` |
| `em` | `chalk.italic()` |
| `del` | `chalk.strikethrough()` |
| `link` | 下划线文本（accent） + URL 括号（灰色） |
| `codespan` | accent 颜色文本包裹在反引号中，HTML 实体已解码 |
| `text` | 主题文本颜色，HTML 实体已解码 |

### 代码语法高亮

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

### boxWrap 代码块边框

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

## App.tsx — 根组件

**文件**: `src/tui/App.tsx`

### 状态管理

| 状态 | 类型 | 用途 |
|------|------|------|
| `messages` | `RenderMessage[]` | 所有显示的消息（用户、助手、工具、系统） |
| `isRunning` | `boolean` | 代理是否正在执行 |
| `status` | `StatusData` | 模型名、成本、token 数、轮次、权限模式 |
| `pendingPerm` | `object \| null` | 活跃的权限对话框状态 + resolve 回调 |
| `pendingQuestion` | `object \| null` | 活跃的问题对话框状态 + resolve 回调 |
| `streamingText` | `string \| null` | 当前流式文本缓冲（独立于 messages） |
| `rows` | `number` | 终端高度，通过 resize 监听器跟踪 |

### 事件分发

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

### 流式文本架构

流式文本有意与 `messages` 数组分离，避免每个 token delta 都重渲染整个 `MessageStream`（涉及 markdown 解析）。流程：

1. `text_delta` 事件追加到 `streamingTextRef` 并更新 `streamingText` 状态
2. `StreamingText` 组件渲染原始文本 + 闪烁光标
3. 当非文本事件到来（或轮次结束），`flushStreamingText()` 将累积文本作为 `assistant` 消息移入 `messages`，触发一次 markdown 渲染

### 内置斜杠命令

| 命令 | 行为 |
|------|------|
| `/clear` | 清空 messages |
| `/help` | 显示帮助信息 |
| `/compact` | 调用 `agent.compactNow()`，显示前后 token 数 |
| `/quit`, `/exit` | 退出程序 |

### 全局快捷键

| 快捷键 | 上下文 | 行为 |
|--------|--------|------|
| `Esc` | 运行中，无对话框 | 通过 `AbortController` 中断当前执行 |
| `Ctrl+C` | 任何时候 | 退出应用 |
| `Shift+Tab` | 空闲，无对话框 | 循环权限模式 `default` → `acceptEdits` → `plan` |

### 布局结构

```tsx
<ThemeProvider theme={initialTheme}>
  <Box flexDirection="column" height={rows}>
    <StatusBar ... />
    <Separator />
    <Box flexDirection="column" flexGrow={1}
         justifyContent="flex-end" overflowY="hidden">
      <MessageStream ... />
      <StreamingText ... />
      {pendingPerm && <PermissionDialog ... />}
      {pendingQuestion && <QuestionDialog ... />}
      <Separator />
      <InputArea ... />
    </Box>
  </Box>
</ThemeProvider>
```

内容区域使用 `justifyContent="flex-end"` 使内容锚定在底部向上增长。`InputArea` 在 `isRunning` 或对话框活跃时被禁用。

---

## StatusBar.tsx — 状态栏

**文件**: `src/tui/StatusBar.tsx`

**Claude Code 风格**：无边框，纯文本单行，管道符分隔。

### 各段

| 段 | 颜色 | 示例 |
|----|------|------|
| 品牌名 | `theme.brand`（粗体） | `CodeTerm` |
| 模型名 | `theme.secondaryText` | `claude-sonnet-4` |
| 成本 | `theme.warning` | `$0.0312` |
| Token 数 | `theme.secondaryText` | `1.2k` |
| 轮次数 | `theme.secondaryText` | `T5` |
| 权限模式 | 可变（见下表） | `suggest` |
| 运行中 Spinner | `theme.spinner` | braille 动画 |

### 权限模式颜色

| 模式值 | 显示标签 | 颜色 |
|--------|---------|------|
| `default` | `suggest` | `theme.info` |
| `acceptEdits` | `auto-edit` | `theme.autoAccept` |
| `plan` | `plan` | `theme.accent` |
| `dontAsk` | `auto` | `theme.success` |
| `bypassPermissions` | `YOLO` | `theme.warning` |

---

## MessageStream.tsx — 消息流

**文件**: `src/tui/MessageStream.tsx`

### RenderMessage 类型

```typescript
type RenderMessage =
  | { role: "user"; content: string; id?: string }
  | { role: "assistant"; content: string; id?: string }
  | { role: "tool"; tool: string; input: Record<string, unknown>;
      output?: string; status: "running" | "done" | "error";
      isError?: boolean; callId?: string; id?: string }
  | { role: "system"; content: string; id?: string };
```

### 按角色渲染

| 角色 | 渲染方式 |
|------|---------|
| `user` | accent 粗体 `❯ ` 前缀 + 纯文本内容 |
| `assistant` | 完整 markdown 渲染，通过 `renderMarkdown(content, theme)` |
| `tool` | 委托给 `<ToolBlock>` 组件（无边框，紧凑风格） |
| `system` | 灰色斜体文本 |

### 虚拟窗口

为防止 ink 渲染溢出，只显示最近的消息：

```typescript
const maxVisible = Math.max((rows ?? 24) - 6, 10);
```

### 性能

- 使用 `React.memo` 包装，防止不必要的重渲染
- 消息 ID（来自 App 的自增计数器）用作 React key

### "Thinking…" Spinner

Star spinner + "Thinking…" 标签在以下条件显示：
- 代理运行中 (`isRunning`)
- 无对话框 (`!hasDialog`)
- 无流式文本 (`!hasStreamingText`)
- 最后一条可见消息不是工具消息

---

## StreamingText.tsx — 流式文本

**文件**: `src/tui/StreamingText.tsx`

渲染原始文本（不走 markdown），带闪烁光标用于实时流式输出。

| 属性 | 类型 | 说明 |
|------|------|------|
| `text` | `string \| null` | 当前流式缓冲；`null` = 隐藏 |

### 行为

- `text` 为 `null` 时返回 `null`（组件不渲染）
- 使用 `theme.text` 颜色显示文本
- 末尾追加闪烁光标 `▊`（accent 颜色），每 500ms 切换可见性
- 闪烁定时器依赖 `hasText`（boolean），而非 `text`（string），避免每个 delta 重启定时器

---

## InputArea.tsx — 输入区域

**文件**: `src/tui/InputArea.tsx`

**Claude Code 风格**：无边框，❯ 提示符。

### 两种视觉状态

**空闲（活跃输入）**：
- accent 粗体 `❯ ` 提示符
- `ink-text-input` 文本输入
- 占位文本：`"Type a message or /help…"`

**运行中（代理活跃）**：
- Star spinner + "Working…" 标签
- 右侧 "Esc to interrupt" 提示（`showInterruptHint` 为 true 时）
- 输入禁用

### 命令历史

组件内维护历史栈：
- `上箭头`：向后导航（最近优先）
- `下箭头`：向前导航；在索引 0 时清空输入（标准 shell 行为）
- 提交时：将输入压入历史，重置索引为 -1
- 最多保存 100 条历史

---

## ToolBlock.tsx — 工具调用渲染

**文件**: `src/tui/ToolBlock.tsx`

**Claude Code 风格**：无边框卡片，紧凑的树形结构渲染。

### 生命周期状态

| 状态 | 图标 | 前缀颜色 | 输出 |
|------|------|---------|------|
| `running` | braille spinner | `toolBorder`（Bash 用 `bashBorder`） | 不显示 |
| `done` | `✓`（绿色） | `theme.success` | 缩进显示（非空时） |
| `error` | `✗`（红色） | `theme.error` | 缩进显示（红色） |

### 渲染结构

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

### 标题生成 (getToolTitle)

| 工具 | 格式 | 示例 |
|------|------|------|
| `Bash` | `Bash: {command}` | `Bash: npm test` |
| `Read` | `Read: {file_path}` | `Read: src/auth.ts` |
| `Write` | `Write: {file_path} ({N} lines)` | `Write: src/config.ts (42 lines)` |
| `Edit` | `Edit: {file_path} ({old}→{new} lines)` | `Edit: src/auth.ts (3→5 lines)` |
| `Glob` | `Glob: {pattern}` | `Glob: src/**/*.ts` |
| `Grep` | `Grep: {pattern}` | `Grep: validateToken` |
| `Task` | `Task: {description}` | `Task: explore-agent` |
| 其他 | 工具名 | `CustomTool` |

### 输出截断 (smartTruncate)

当输出超过 `maxLines` 行（默认 8 行）时，保留：
- 前 60% 行
- `… ({N} lines omitted)` 提示
- 尾部行

空输出完全不渲染。

---

## PermissionDialog.tsx — 权限对话框

**文件**: `src/tui/PermissionDialog.tsx` (191 行)

紧凑的内联权限栏，当工具需要审批时显示在 InputArea 上方。保留圆角边框。

### 四种权限选择

| 选择 | 快捷键 | 标签 | 含义 |
|------|--------|------|------|
| `allow_once` | `Y` | Yes | 仅允许此次调用 |
| `deny` | `N` | No | 拒绝此次调用 |
| `always_allow` | `A` | Always | 始终允许此工具 |
| `allow_session` | `S` | Session | 本次会话允许 |

`Esc` 是快速拒绝的快捷键。

### 200ms 防抖

对话框出现后的前 200ms 忽略所有按键，防止用户正在打字时误操作。

### 导航

- `Tab` / 方向键：移动焦点
- `Enter`：提交聚焦按钮
- 快捷键（`Y/N/A/S`）：直接执行
- 聚焦按钮使用 `inverse` + `bold` 样式

### Diff 预览

Edit 工具显示旧/新内容的首行对比：
```
- return decoded.valid;
+ return decoded.valid && decoded.exp > now();
```

Write 工具显示内容首行：
```
+ import { z } from "zod";
```

---

## QuestionDialog.tsx — 问题对话框

**文件**: `src/tui/QuestionDialog.tsx` (308 行)

处理 `ask_user` 事件，支持单选和多选问题流。

### 单选模式

- `●`（选中）/ `○`（未选中）
- `Tab/↑↓` 导航，`Enter` 选择
- 底部自动有 "Other" 选项供自由输入

### 多选模式

- `■`（选中）/ `□`（未选中）
- `Tab/↑↓` 导航，`Space` 切换，`Enter` 提交
- 选中项以逗号分隔连接

### Markdown 预览面板

当选项有 `markdown` 属性时，单选模式使用左右分栏布局：左列选项，右列预览。

---

## Spinner.tsx — 动画指示器

**文件**: `src/tui/Spinner.tsx` (41 行)

### Star Sparkle

- 帧序列：`· ✢ ✳ ✶ ✻ ✽`
- 间隔：120ms
- 用于：InputArea "Working…"、MessageStream "Thinking…"

### Braille Dots

- 帧序列：`⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏`
- 间隔：80ms
- 用于：StatusBar 运行指示器、ToolBlock 运行状态

---

## 渲染注意事项

### 终端尺寸

- **行数**：通过 React 状态 + `stdout.on("resize")` 监听器跟踪，默认 24
- **列数**：直接从 `process.stdout.columns` 读取（默认 80），不跟踪状态

### 溢出防护

- 内容区域：`overflowY="hidden"` 防止 ink 渲染超出终端边界
- MessageStream 虚拟窗口：只渲染 `rows - 6` 条消息（最少 10 条）
- ToolBlock 标题截断：`max(columns - 12, 40)` 字符
- 代码块边框宽度：上限 `termWidth - 4`

### 性能优化

- **StreamingText 分离**：token delta 只更新 `streamingText` 状态，不触动 `messages` 数组，避免每次 delta 重新解析 markdown
- **React.memo on MessageStream**：仅在 messages/isRunning 等核心 prop 变化时重渲染
- **消息 ID**：自增计数器提供稳定的 React key
- **Ref 事件处理器**：`handleAgentEventRef` 确保事件处理器始终引用最新闭包

---

## 图标参考

| 图标 | 含义 | 使用位置 |
|------|------|---------|
| `❯` | 用户输入提示 | InputArea、用户消息 |
| `✓` | 成功/完成 | ToolBlock（完成） |
| `✗` | 错误/失败 | ToolBlock（错误） |
| `╭─` / `╰─` | 工具调用结构线 | ToolBlock 标题/输出 |
| `⚡` | 权限请求 | PermissionDialog |
| `▊` | 流式光标 | StreamingText |
| `↳` | 子代理 | agent_spawned/completed 系统消息 |
| `•` | 列表项 | Markdown 无序列表 |
| `●` / `○` | 单选 选中/未选中 | QuestionDialog 单选 |
| `■` / `□` | 复选 选中/未选中 | QuestionDialog 多选 |
| `│` | 引用前缀 | Markdown 块引用 |
