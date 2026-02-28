# CodeTerm UI 交互设计规范

> [← 上一篇: TUI 组件](./09-tui-components.md) | [目录](./README.md)

> 本文档定义 CodeTerm 终端 UI 的布局架构、组件形态、交互模式和视觉规范。
> 所有 TUI 组件开发必须遵循本规范。

---

## 1. 全局布局架构

### 1.1 三区布局模型

CodeTerm 采用**底部锚定**布局，全部内容从底部向上生长：

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

### 1.3 Flexbox 实现

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

---

## 2. 组件形态规范

### 2.1 StatusBar — 底部全局信息栏

**位置**: 屏幕最底部，固定不动
**高度**: 1 行 + 边框 = 3 行

```
╭─────────────────────────────────────────────────────────────────────╮
│  CodeTerm │ claude-sonnet-4 │ $0.03 │ 1.2k │ T5 │ suggest │ ⣾     │
╰─────────────────────────────────────────────────────────────────────╯
```

**信息段（从左到右）**:

| 段 | 内容 | 颜色 | 示例 |
|----|------|------|------|
| Brand | 产品名 | `theme.brand` | `CodeTerm` |
| Model | 当前模型名 | `theme.secondaryText` | `claude-sonnet-4` |
| Cost | 累计花费 | `theme.warning` | `$0.03` |
| Tokens | token 用量 | `theme.mutedText` | `1.2k` |
| Turns | 对话轮次 | `theme.mutedText` | `T5` |
| Mode | 权限模式 | 按模式变色（见下） | `suggest` |
| Spinner | 运行中指示 | `theme.spinner` | `⣾` |

**权限模式颜色**:
- `default` (suggest) → `theme.info` 蓝色
- `acceptEdits` (auto-edit) → `theme.autoAccept` 青色
- `plan` → `theme.accent` 紫色
- `bypassPermissions` (YOLO) → `theme.warning` 黄色
- `dontAsk` (auto) → `theme.success` 绿色

**运行状态**:
- 空闲时: 不显示 spinner
- 运行中: 显示 braille spinner
- 窄终端时: 按优先级省略段（Turns → Tokens → Cost）

### 2.2 InputArea — 输入区

**位置**: StatusBar 正上方，紧贴消息流底部
**高度**: 1 行 + 边框 = 3 行（单行模式）

#### 状态 A: 空闲可输入

```
╭─────────────────────────────────────────────────────────────────────╮
│  > 在此输入消息...                                                  │
╰─────────────────────────────────────────────────────────────────────╯
```

- 边框: `theme.activeBorder`（高亮）
- 提示符: `>` + `theme.accent` 颜色
- 占位符: `theme.mutedText` 淡色
- 快捷键: `↑↓` 历史浏览, `Enter` 提交, `Shift+Tab` 切换模式

#### 状态 B: Agent 运行中

```
╭─────────────────────────────────────────────────────────────────────╮
│  ✦ Working...                                         Esc to stop  │
╰─────────────────────────────────────────────────────────────────────╯
```

- 边框: `theme.border`（默认/淡色）
- 左侧: star spinner + "Working..."
- 右侧: `Esc to stop` 提示（仅在无弹窗时显示）
- 输入被禁用

#### 状态 C: 弹窗激活（InputArea 被遮蔽）

```
╭─────────────────────────────────────────────────────────────────────╮
│  ⏳ Waiting for your decision...                                    │
╰─────────────────────────────────────────────────────────────────────╯
```

- 边框: `theme.border`（默认/淡色）
- 显示等待提示
- 输入被禁用

### 2.3 Dialog Zone — 弹窗区

弹窗出现在 InputArea **正上方**，有多种形态：

#### 形态 1: PermissionDialog — 权限审批

最常见的弹窗，紧凑 2-3 行布局：

```
╭──────────────────────────────────────────────────────────────────────╮
│  ⚡ Bash: npm test --filter auth                                     │
│  Allow? [Y] Yes  [N] No  [A] Always  [S] Session        [Esc] Deny  │
╰──────────────────────────────────────────────────────────────────────╯
```

**危险级别分色**:

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

**Edit 工具特殊形态** — 带 diff 预览：

```
╭── theme.warning ──────────────────────────────────────────────╮
│  ⚡ Edit: src/auth.ts                                         │
│    - const token = jwt.sign(payload, secret);                 │
│    + const token = jwt.sign(payload, secret, { expiresIn });  │
│  Allow? [Y] Yes  [N] No  [A] Always  [S] Session             │
╰───────────────────────────────────────────────────────────────╯
```

**Write 工具特殊形态** — 显示首行+行数：

```
╭── theme.warning ──────────────────────────────────────────────╮
│  ⚡ Write: src/config.ts (42 lines)                           │
│    + import { z } from "zod";                                 │
│  Allow? [Y] Yes  [N] No  [A] Always  [S] Session             │
╰───────────────────────────────────────────────────────────────╯
```

**交互规则**:
- 快捷键: `Y` = allow_once, `N` = deny, `A` = always_allow, `S` = allow_session, `Esc` = deny
- Tab/Arrow 在按钮间导航, Enter 确认焦点按钮
- 200ms 防抖防止误触发
- 焦点按钮使用 `inverse` + `bold` 高亮

#### 形态 2: QuestionDialog — 问题选择

**单选模式**:

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

**多选模式**:

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

**带预览的单选模式** (选项有 markdown 内容时):

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

**交互规则**:
- Tab/Arrow: 在选项间导航
- Enter: 单选模式下选择当前项
- Space: 多选模式下切换当前项
- Enter (多选): 提交所有选中项
- "Other" 选项: 选中后展开 TextInput，Esc 退出编辑
- 多问题时: 显示 `[1/3]` 进度，逐个回答

#### 形态 3: ConfirmDialog — 确认弹窗 (简化版)

用于简单的 Yes/No 确认：

```
╭── theme.warning ──────────────────────────────────────────────╮
│  ⚠ This will delete 47 files. Continue?                       │
│  [Y] Yes  [N] No                                  [Esc] No   │
╰───────────────────────────────────────────────────────────────╯
```

### 2.4 MessageStream — 消息流

#### 消息类型与渲染

**用户消息**:
```
  > 请帮我重构 auth 模块
```
- 前缀: `>` + `theme.info` 蓝色 bold
- 内容: `theme.text`

**助手消息** (markdown 渲染后):
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

**工具消息** (ToolBlock):
```
  ╭──────────────────────────────────────────────────────────╮
  │  ✔ Read  src/auth/validate.ts                            │
  │                                                          │
  │  export function validateToken(token: string) {          │
  │    const decoded = jwt.decode(token);                    │
  │    ...                                                   │
  │    (42 lines total)                                      │
  ╰──────────────────────────────────────────────────────────╯
```

**系统消息**:
```
  Mode switched to: auto-edit
```
- `theme.mutedText` 斜体
- 不加前缀

#### ToolBlock 生命周期

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

**工具标题格式**:

| 工具 | 标题格式 | 示例 |
|------|---------|------|
| Bash | `{icon} Bash  {command}` | `✦ Bash  npm test` |
| Read | `{icon} Read  {file_path}` | `✔ Read  src/auth.ts` |
| Write | `{icon} Write  {file_path} ({lines} lines)` | `✔ Write  src/config.ts (42 lines)` |
| Edit | `{icon} Edit  {file_path}` | `✔ Edit  src/auth.ts` |
| Glob | `{icon} Glob  {pattern}` | `✔ Glob  src/**/*.ts` |
| Grep | `{icon} Grep  {pattern} in {path}` | `✔ Grep  "validateToken" in src/` |
| Task | `{icon} Task  {agent_name}` | `✦ Task  explore-agent` |
| WebSearch | `{icon} WebSearch  {query}` | `✔ WebSearch  "React 19 features"` |

**输出截断规则**:
- 保留前 10 行 + 后 10 行
- 中间显示 `... ({n} lines omitted) ...`
- 单行超过终端宽度时由终端自动换行
- 空输出不渲染输出区域

### 2.5 StreamingText — 流式文本

**渲染规则**:
- 使用 `theme.text` 颜色（与助手消息一致）
- 末尾显示闪烁光标 `▊`（500ms 间隔切换可见性）
- 不做 markdown 渲染（避免每帧重新 parse）
- 紧贴最后一条消息，无额外间距
- flush 后推入 MessageStream 并做完整 markdown 渲染

```
  I'll analyze the authentication module. The main issues are:
  1. Token validation is scattered across multiple files▊
```

### 2.6 Spinner — 动画指示器

两种类型:

| 类型 | 帧 | 间隔 | 用途 |
|------|-----|------|------|
| `star` | `✦ ✶ ✳ ✵ ❋ ✿` | 120ms | InputArea "Working...", Thinking |
| `braille` | `⣾ ⣽ ⣻ ⢿ ⡿ ⣟ ⣯ ⣷` | 80ms | StatusBar 运行指示, ToolBlock running |

---

## 3. 交互模式

### 3.1 键盘快捷键总表

| 快捷键 | 上下文 | 行为 |
|--------|--------|------|
| `Enter` | 输入框 | 提交消息 |
| `↑` / `↓` | 输入框 | 浏览命令历史 |
| `Shift+Tab` | 空闲时 | 循环权限模式: default → acceptEdits → plan → default |
| `Esc` | Agent 运行中 | 中断当前执行 |
| `Ctrl+C` | 任何时候 | 退出 CodeTerm |
| `Y` | 权限弹窗 | Allow once |
| `N` | 权限弹窗 | Deny |
| `A` | 权限弹窗 | Always allow |
| `S` | 权限弹窗 | Allow for session |
| `Esc` | 权限弹窗 | Deny |
| `Tab` / `↑↓` | 弹窗中 | 导航选项 |
| `Enter` | 弹窗中 | 确认选择 |
| `Space` | 多选弹窗 | 切换选中状态 |

### 3.2 状态机

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

### 3.3 消息流转生命周期

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

---

## 4. 视觉规范

### 4.1 间距规则

| 元素 | 间距 |
|------|------|
| 消息之间 | `marginBottom={1}` (1 空行) |
| ToolBlock 内部输出 | `marginLeft={2}` `marginTop={1}` |
| 弹窗内部 | `paddingX={2}` `paddingY={1}` |
| InputArea 内部 | `paddingX={1}` |
| StatusBar 内部 | `paddingX={1}` |
| 弹窗与 InputArea 之间 | 无额外间距（自然紧贴） |

### 4.2 边框规范

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

### 4.3 图标规范

| 图标 | 含义 | 使用场景 |
|------|------|---------|
| `⚡` | 权限请求 | PermissionDialog 标题 |
| `⚠️` | 危险操作 | 危险权限请求 |
| `✦` | 运行中 (star spinner) | ToolBlock running, InputArea working |
| `⣾` | 运行中 (braille spinner) | StatusBar |
| `✔` | 完成 | ToolBlock done |
| `✘` | 错误 | ToolBlock error |
| `>` | 用户输入 | InputArea, 用户消息前缀 |
| `▊` | 光标 | StreamingText 闪烁光标 |
| `↳` | 子 agent | agent_spawned/completed 系统消息 |
| `⊘` | 拒绝/中断 | tool_denied, done(非 complete) |
| `⟳` | 压缩 | compact_start/end |
| `•` | 列表项 | Markdown 无序列表 |
| `●` / `○` | 单选 | QuestionDialog 单选选中/未选 |
| `■` / `□` | 多选 | QuestionDialog 多选选中/未选 |

### 4.4 截断规则

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

## 5. `<Static>` 消息滚动方案

### 5.1 核心思路

将**已完成的完整 turn**（包含该 turn 所有的 assistant 文本、tool 调用、系统消息）推入 `<Static>`，使其进入终端原生 scrollback 缓冲区。仅保留**当前活跃 turn** 的内容在 ink 动态渲染区。

### 5.2 消息分类

```typescript
// 已完成的消息 → <Static> (终端原生 scrollback)
const completedMessages = messages.filter(m => m.turnComplete);

// 当前 turn 活跃消息 → 动态渲染
const activeMessages = messages.filter(m => !m.turnComplete);
```

### 5.3 Turn 完成判定

一个 turn 在以下条件之一满足时标记为 complete:
1. 收到 `done` 事件
2. 用户提交了新的输入（前一个 turn 的所有消息标记为 complete）
3. 收到 `interrupted` 事件

### 5.4 优势

| 方面 | 之前 (slice window) | 之后 (Static) |
|------|---------------------|----------------|
| 历史回看 | 丢失，只看到最近 N 条 | 终端原生滚动，全部可回看 |
| 渲染负担 | 每帧渲染全部可见消息 | 只渲染当前 turn |
| 视觉连续性 | 消息突然消失 | 自然滚出视口 |
| 内存 | 全部 messages 在 React state | 已完成的被 ink 静态化 |

---

## 6. 响应式行为

### 6.1 终端尺寸适应

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

### 6.2 窄终端适应（< 60 columns）

- StatusBar: 省略 Turns → Tokens → Cost 段
- ToolBlock: 标题截断更激进
- PermissionDialog: 按钮缩写 `[Y] [N] [A] [S]`（去掉 label）
- QuestionDialog: 描述文字折行

### 6.3 矮终端适应（< 15 rows）

- 弹窗和 InputArea 压缩到最小高度
- StreamingText 限制最大显示行数
- 系统消息合并/省略

---

## 7. 斜杠命令 UI

| 命令 | 行为 | 反馈 |
|------|------|------|
| `/clear` | 清空消息列表 | 静默清除 |
| `/compact` | 触发上下文压缩 | 系统消息: `⟳ Triggering manual compaction...` → `Compaction complete: N → M tokens` |
| `/help` | 显示帮助信息 | 系统消息: 命令列表 + 快捷键列表 + 技能列表 |
| `/quit` `/exit` | 退出 CodeTerm | 直接退出 |
| `/<skill>` | 运行自定义技能 | 作为用户消息发送给 agent |

---

## 8. 变更映射

本规范对应的组件文件变更:

| 规范章节 | 影响文件 | 变更类型 |
|---------|---------|---------|
| 1. 全局布局 | `App.tsx` | 重构: StatusBar 移到底部, 引入 `<Static>` |
| 2.1 StatusBar | `StatusBar.tsx` | 位置移到底部, 响应式段省略 |
| 2.2 InputArea | `InputArea.tsx` | 状态 C (弹窗等待) 新增 |
| 2.3 Dialog Zone | `PermissionDialog.tsx` | 危险级别分色 |
| 2.4 MessageStream | `MessageStream.tsx` | `<Static>` 集成, 移除 slice window |
| 2.5 StreamingText | `StreamingText.tsx` | 已完成 (仅需确认 theme 颜色) |
| 2.6 Spinner | `Spinner.tsx` | 无变更 |
| 5. Static 方案 | `App.tsx`, `MessageStream.tsx` | 核心重构 |

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
  │  CodeTerm │ claude-sonnet-4 │ $0.05 │ 2.1k │ T3     │
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
  │  CodeTerm │ claude-sonnet-4 │ $0.02 │ 0.8k │ T1 │⣾ │
  ╰──────────────────────────────────────────────────────╯
```

### 空闲等待输入

```
  > 你好

  你好！我是 CodeTerm，一个终端 AI 编程助手。有什么可以帮你的？

  ╭──────────────────────────────────────────────────────╮  ← InputArea (active)
  │  > |                                                 │
  ╰──────────────────────────────────────────────────────╯

  ╭──────────────────────────────────────────────────────╮  ← StatusBar
  │  CodeTerm │ claude-sonnet-4 │ $0.01 │ 0.3k │ T1     │
  ╰──────────────────────────────────────────────────────╯
```
