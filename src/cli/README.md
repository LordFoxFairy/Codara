# CLI UI 架构说明

## 目标

`src/cli` 是 Codara 的终端交互层。

它只负责三件事：

1. 渲染欢迎页、消息流和输入区
2. 把终端输入转换成对 `createCodara(...)` 的调用
3. 在不修改 `src/core` 的前提下，承接 CLI 本地需要的状态与兼容逻辑

这层不是运行时内核，也不负责重新实现 `agent loop`、`tools`、`skills`。

## 当前目录结构

- `main.tsx`
  - CLI 入口
  - 启动前做本地 `.codara` 配置兜底
  - 调用 `render(<CodaraCliApp />)`
- `app/`
  - 页面组装层
  - 当前主要文件是 `shell-app.tsx`
- `components/`
  - 纯展示组件
  - 不直接处理会话协议，不直接改状态
- `hooks/`
  - 输入映射、闪烁逻辑、shell 状态协调
- `adapters/`
  - 把 CLI 与 `createCodara(...)`、chunk 处理、session metadata 隔离开
- `state/`
  - Composer 的纯状态模型和类型定义

## 当前分层职责

### 1. 入口层

`main.tsx` 只做两件事：

1. 调用 `ensureCliCodaraPath()` 处理本地配置兜底
2. 启动 Ink 应用

入口层不承载展示逻辑，也不承载输入逻辑。

### 2. 组装层

`app/shell-app.tsx` 负责把下面这些区域拼起来：

- `Header`
- `WelcomeState` / `Transcript`
- `PromptFrame`
- `Footer`

它同时把输入动作和 `useShellState()` 的状态接上，但不直接处理会话流细节。

### 3. 展示层

`components/` 里的组件只做渲染：

- `header.tsx`
- `welcome-state.tsx`
- `transcript.tsx`
- `prompt-frame.tsx`
- `footer.tsx`
- `robot-mark.tsx`

展示层的原则是：

- 不直接读 `createCodara(...)`
- 不直接解析 stream chunk
- 不直接维护输入状态

### 4. 交互层

`hooks/` 当前承担三类职责：

- `use-prompt-input.ts`
  - 监听按键并分发动作
- `prompt-input-action.ts`
  - 把终端按键归一成稳定动作
- `use-blinking-cursor.ts`
  - 处理光标闪烁与交互后的稳定显示
- `use-terminal-width.ts`
  - 只给字符宽度相关内容使用
- `use-shell-state.ts`
  - 汇总 Composer 状态、消息列表和运行状态

这里是 CLI 的主要行为层。

### 5. 会话适配层

`adapters/` 的作用是把 UI 与真实会话调用隔开：

- `agent-session.ts`
  - 创建 CLI 会话
  - 处理启动消息、消息 id 和 chunk 输出工具
- `bootstrap-config.ts`
  - 处理本地 `.codara` 配置兜底
- `session-meta.ts`
  - 管理欢迎页展示的固定 session 信息

这层的价值是：

- UI 不直接依赖底层 chunk 结构
- 将来换会话来源时，不需要重写组件

### 6. 状态模型层

`state/` 目前主要是 Composer 的纯状态函数：

- 文本内容
- 光标位置
- 左右上下移动
- 行首行尾
- 换行
- 退格删除

这是现在 CLI 最关键的一层之一。

## 当前设计判断

### 对的部分

1. 输入区按 Composer 设计，而不是普通 input
2. 会话协议被隔离到 `adapters/`
3. 交互映射被收敛到 `prompt-input-action.ts`
4. 展示层没有反向污染 `src/core`
5. Composer 的主要编辑逻辑有独立测试覆盖

### 当前取舍

1. 由于 Ink 当前会把不少终端送来的 `DEL(127)` 解析成 `delete`
2. 在当前 CLI 里，优先保证 `Backspace` 行为正确
3. 暂不保留独立的前向删除交互

这是一个务实取舍，不是理想输入模型。当前阶段优先主交互稳定。

### 当前还不做的事

1. 不在 CLI 层引入新的会话系统
2. 不在 CLI 层重写 `core` 行为
3. 不做复杂编辑器功能，例如选择、复制块、历史搜索
4. 不为了“像浏览器 textarea”继续堆叠过多终端兼容逻辑

## 响应式边界

欢迎页遵守两条规则：

1. `Header / Welcome / Footer`
   - 交给 Ink 布局引擎
2. `PromptFrame` 的字符分隔线
   - 由 `useTerminalWidth()` 驱动

宽度断点在 `layout-mode.ts` 中维护：

- `wide`：`>= 90`
- `compact`：`60 ~ 89`
- `minimal`：`< 60`

## Composer 当前交互

- `Enter`：发送
- `Alt + Enter` / `Shift + Enter` / `Ctrl + J`：换行
- `Left / Right`：左右移动光标
- `Up / Down`：跨行移动光标
- `Home / End`：当前行首 / 行尾
- `Backspace`：删除光标前字符

同时具备：

- 有限可视窗口
- 真实光标行渲染
- 光标闪烁与交互后的稳定显示

## 本地配置兜底

CLI 启动时会按这个顺序检查配置：

1. `CODARA_PATH`
2. `~/.codara/config.json`
3. 仓库内 `./.codara/config.json`

如果前两者都没有，但仓库内存在 `.codara/config.json`，CLI 会把 `CODARA_PATH` 指到当前仓库。

## 后续建议

当前 CLI 架构不需要重构，下一步更合适的是继续打磨：

1. 欢迎页视觉
2. Composer 的界面提示
3. 会话交互体验

而不是继续增加新的层级或重新拆目录。
