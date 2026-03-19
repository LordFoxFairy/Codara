# Codara CLI

`src/cli` 是 Codara 的终端宿主层。

它的职责不是重新实现 agent runtime，而是把已经存在的运行时能力组织成一套可交互的终端体验。更直接一点说：

- `src/engine`、`src/capability`、`src/infra` 负责底层能力
- `src/cli` 负责把这些能力接进终端，变成用户能直接操作的 CLI

所以理解这部分代码时，最重要的前提是：

**CLI 是宿主，不是第二套 runtime。**

---

## 设计目标

当前 CLI 的设计目标，可以概括成 4 条：

1. 复用共享 runtime，而不是在 CLI 里复制 session / agent / pause / tool 语义。
2. 把终端交互拆成清楚的层次，避免所有逻辑都堆在一个 Ink 组件里。
3. 让输入、转录、审批、面板这些 UI 能各自演进，不互相牵扯。
4. 保持 CLI 作为一个“宿主壳”的边界，宿主只负责接线、展示和少量宿主动作。

这也是为什么你会看到这里同时有：

- `app/` 这样的宿主层
- `composer/` 这样的输入模型层
- `transcript/` 这样的投影层
- `hooks/` 这样的局部 UI 状态层
- `components/` 这样的纯渲染层

这些都不是重复分层，而是在避免终端应用最常见的问题：

**功能一多，所有状态和行为都回流到一个巨大的页面文件里。**

---

## 当前整体结构

```text
src/cli/
  main.tsx
  headless.ts
  cli-args.ts
  README.md

  app/
  composer/
  components/
  hooks/
  transcript/
  utils/
```

先用一句话概括每个目录：

- `app/`：宿主层、接线层、执行流 helper
- `composer/`：输入框编辑模型
- `components/`：终端渲染组件
- `hooks/`：局部 UI 状态和输入监听
- `transcript/`：把 runtime 数据投影成 CLI 可显示模型
- `utils/`：格式化、主题等共享基础件

下面按层详细说明。

---

## 入口层

### `main.tsx`

文件：[main.tsx](/C:/Users/天皓/Desktop/Codara/src/cli/main.tsx)

职责：

- 解析命令行参数
- 创建或恢复 Codara runtime
- 决定进入交互模式还是 headless 模式
- 注入宿主级动作，例如打开文件、重开会话
- 挂载 Ink 应用

为什么它必须是入口层单独存在：

- 避免在 React 组件内部创建 runtime
- 让宿主能力和 UI 能力分开
- 方便后续替换启动方式，而不影响 CLI 主界面

### `headless.ts`

文件：[headless.ts](/C:/Users/天皓/Desktop/Codara/src/cli/headless.ts)

职责：

- 处理非交互模式执行
- 输出纯文本或 JSON 结果

它和交互式 CLI 分开是合理的，因为：

- headless 更像脚本接口
- interactive 更像完整终端应用
- 两者共享 runtime，但不共享界面模型

### `cli-args.ts`

文件：[cli-args.ts](/C:/Users/天皓/Desktop/Codara/src/cli/cli-args.ts)

职责：

- 把原始 `argv` 解析成统一结构

这是一个很小但很重要的边界：

- 参数规则不应该散在 `main.tsx`
- 也不应该掺进 UI 层

---

## 宿主层与接线层

这一层在 `app/`。

它不是“纯组件目录”，而是 CLI 真正的宿主层。这里的核心问题不是“怎么渲染一行文本”，而是：

**怎么把运行时、输入、审批、转录、面板、宿主动作接成一个终端产品。**

### `shell-app.tsx`

文件：[shell-app.tsx](/C:/Users/天皓/Desktop/Codara/src/cli/app/shell-app.tsx)

这是交互式 CLI 的顶层宿主壳。

它现在主要做这几件事：

- 调用 [use-cli-controller.ts](/C:/Users/天皓/Desktop/Codara/src/cli/app/use-cli-controller.ts) 拿到 CLI 顶层状态
- 调用各种局部 hook，组装 prompt surface、team panel、session picker、transcript
- 决定当前前台显示哪一块内容
- 挂上 prompt 输入监听和 HIL 输入监听
- 把所有组件拼成最终终端界面

现在对 `shell-app.tsx` 的要求是：

- 它应该主要负责“组装”
- 它不应该继续长成第二个 controller

所以这轮架构收口之后，一些原本挤在这里的逻辑已经抽走了，例如：

- team panel 显示状态
- prompt surface 逻辑

### `use-cli-controller.ts`

文件：[use-cli-controller.ts](/C:/Users/天皓/Desktop/Codara/src/cli/app/use-cli-controller.ts)

这是当前 CLI 的主控制器。

它现在的职责已经比较清楚了：

- 持有 CLI 顶层共享状态
- 调用 prompt / HIL / slash command 执行 helper
- 串起各个局部 UI 状态 hook
- 向 `shell-app.tsx` 暴露一套稳定的控制接口

它当前管理的核心状态包括：

- `composer`
- `notices`
- `activeTurn`
- `hilReview`
- `coreMessages`
- `runtimeEvents`
- `runState`
- `sessionState`
- `commandOutput`

从架构角度说，它现在更像一个真正的“接线控制器”了，而不是以前那种“所有逻辑都往里塞”的大杂烩。

但也要说明白：

- 它仍然是 CLI 里最重的文件
- 不过现在剩下的内容，大多都属于它应该持有的顶层状态和执行接线

### `view-state.ts`

文件：[view-state.ts](/C:/Users/天皓/Desktop/Codara/src/cli/app/view-state.ts)

职责：

- 定义 CLI 自己的视图状态类型

例如：

- `CliRunState`
- `CliNotice`
- `CliActiveTurn`
- `CliHilReviewState`

这个文件的价值在于：

**CLI 不直接把底层 runtime 类型拿来满天飞，而是建立自己的 UI 侧状态语言。**

这会让边界更清楚，也方便后续替换显示策略。

---

## 执行流 helper 层

这一层也放在 `app/`，但它们的角色和 `shell-app.tsx`、`use-cli-controller.ts` 不一样。

这些文件的共同特征是：

- 不负责最终渲染
- 不负责全局状态持有
- 专门收“某一整段有顺序的执行链”

换句话说，它们的工作是：

**把 controller 里本来会展开写的一长段流程，单独收口。**

### `prompt-execution.ts`

文件：[prompt-execution.ts](/C:/Users/天皓/Desktop/Codara/src/cli/app/prompt-execution.ts)

职责：

- 规范 prompt 的 trim / skip 规则
- 决定走 slash command 还是 agent prompt
- 处理 prompt 提交前后的 run state 和错误恢复

### `hil-execution.ts`

文件：[hil-execution.ts](/C:/Users/天皓/Desktop/Codara/src/cli/app/hil-execution.ts)

职责：

- 处理 HIL action 提交流程
- 处理 form 校验没过时的回退
- 处理 resume 流式输出
- 处理 refresh 后的 pause 同步和 run state 收尾

### `command-host-action.ts`

文件：[command-host-action.ts](/C:/Users/天皓/Desktop/Codara/src/cli/app/command-host-action.ts)

职责：

- 处理 slash command 执行结果里属于宿主层的动作

典型动作包括：

- `show_session_picker`
- `resume_session`
- `open_file`
- `enter_team`
- `leave_team`

这层抽出来之后，`runSlashCommand` 本身更聚焦，不再自己到处写分支。

### `draft-submission.ts`

文件：[draft-submission.ts](/C:/Users/天皓/Desktop/Codara/src/cli/app/draft-submission.ts)

职责：

- 解释 prompt 草稿到底属于哪种提交

例如：

- 普通 prompt
- `@team ...` 转换成 team command
- 空草稿直接跳过

### `streaming-active-turn.ts`

文件：[streaming-active-turn.ts](/C:/Users/天皓/Desktop/Codara/src/cli/app/streaming-active-turn.ts)

职责：

- 管流式输出期间 `activeTurn` 的更新规则

例如：

- 创建 turn
- 合并 thinking 文本
- 合并 token 使用量
- 追加回复文本
- 没有任何输出时补 fallback

### `controller-lifecycle.ts`

文件：[controller-lifecycle.ts](/C:/Users/天皓/Desktop/Codara/src/cli/app/controller-lifecycle.ts)

职责：

- 管 controller 需要的生命周期同步

包括：

- `hilReviewRef` 同步
- runtime event 订阅
- 初始 hydrate
- 首条 prompt 自动发送
- dispose 清理

这层单独抽出来之后，controller 本体不用再自己铺很多 `useEffect`。

### `hil-auto-actions.ts`

文件：[hil-auto-actions.ts](/C:/Users/天皓/Desktop/Codara/src/cli/app/hil-auto-actions.ts)

职责：

- 管自动 HIL action 的排队、领取、延迟触发

要求是：

- 每个 pause 只能自动处理一次
- 不能重复消费同一个 auto action
- 定时触发逻辑不能写在 controller 主体里

### `hil-review-controls.ts`

文件：[hil-review-controls.ts](/C:/Users/天皓/Desktop/Codara/src/cli/app/hil-review-controls.ts)

职责：

- 管 HIL review 里的本地交互行为

包括：

- tab 切换
- focus 切换
- draft 编辑
- permission 快捷动作
- reject feedback 提交

这层本质上已经偏 UI 状态控制了，但因为它紧贴 HIL review 语义，仍然放在 `app/` 是合理的。

### `hil-review.ts`

文件：[hil-review.ts](/C:/Users/天皓/Desktop/Codara/src/cli/app/hil-review.ts)

职责：

- 把底层 pause request 适配成 CLI review state
- 处理 HIL form、action、permission stage 的转换规则
- 构造 resume payload

这是 HIL 的语义适配层。

它解决的问题是：

- runtime 的 pause 语义很通用
- CLI 的审批体验是终端产品语义

两者之间需要翻译层，`hil-review.ts` 就在做这件事。

### `layout-mode.ts`

文件：[layout-mode.ts](/C:/Users/天皓/Desktop/Codara/src/cli/app/layout-mode.ts)

职责：

- 定义 `wide / compact / minimal` 三档布局
- 统一终端宽度断点

这个文件虽然小，但价值很明确：

- 终端布局判断不应该散在每个组件里

---

## 输入模型层

这一层在 `composer/`。

### `composer/state.ts`

文件：[state.ts](/C:/Users/天皓/Desktop/Codara/src/cli/composer/state.ts)

职责：

- 定义 prompt 输入框的纯编辑模型

它负责的事情很纯：

- 插入文本
- 删除文本
- 换行
- 光标左右上下移动
- `Home` / `End`

这层设计是当前 CLI 里很健康的一块，因为：

- 它是纯函数
- 它不依赖 Ink
- 它不依赖 runtime
- 它很容易测

### `composer/types.ts`

文件：[types.ts](/C:/Users/天皓/Desktop/Codara/src/cli/composer/types.ts)

职责：

- 定义 composer 状态结构

这层和上面的 `state.ts` 一起，构成了输入框最底层的编辑模型。

---

## 局部 UI 状态与输入 hook 层

这一层在 `hooks/`。

它的定位很明确：

- 不持有整个 CLI 的主状态
- 只服务某一块 UI 或某一类输入行为

### 输入监听相关

#### `use-prompt-input.ts`

文件：[use-prompt-input.ts](/C:/Users/天皓/Desktop/Codara/src/cli/hooks/use-prompt-input.ts)

职责：

- 监听 prompt 区按键
- 把按键翻译成语义动作

#### `prompt-input-action.ts`

文件：[prompt-input-action.ts](/C:/Users/天皓/Desktop/Codara/src/cli/hooks/prompt-input-action.ts)

职责：

- 统一 prompt 输入区的按键映射规则

#### `use-hil-input.ts`

文件：[use-hil-input.ts](/C:/Users/天皓/Desktop/Codara/src/cli/hooks/use-hil-input.ts)

职责：

- 监听 HIL review 阶段的按键
- 处理普通审批流和 permission review 流的输入差异

### 局部状态相关

#### `use-cli-composer-state.ts`

文件：[use-cli-composer-state.ts](/C:/Users/天皓/Desktop/Codara/src/cli/hooks/use-cli-composer-state.ts)

职责：

- 持有 prompt 编辑器本地状态
- 对外暴露光标和文本编辑回调

#### `use-command-output-state.ts`

文件：[use-command-output-state.ts](/C:/Users/天皓/Desktop/Codara/src/cli/hooks/use-command-output-state.ts)

职责：

- 管 command output 面板的显示状态和滚动状态

#### `use-cli-prompt-surface.ts`

文件：[use-cli-prompt-surface.ts](/C:/Users/天皓/Desktop/Codara/src/cli/hooks/use-cli-prompt-surface.ts)

职责：

- 管 prompt 区当前该显示什么

例如：

- 要不要显示 prompt frame
- completion 是否打开
- command output 是否抢前台
- 当前 placeholder 应该是什么

#### `use-team-panel-state.ts`

文件：[use-team-panel-state.ts](/C:/Users/天皓/Desktop/Codara/src/cli/hooks/use-team-panel-state.ts)

职责：

- 生成 team panel 显示数据
- 管 panel 内部的成员选择

#### 其他局部 hook

包括：

- [use-active-tasks.ts](/C:/Users/天皓/Desktop/Codara/src/cli/hooks/use-active-tasks.ts)
- [use-active-teams.ts](/C:/Users/天皓/Desktop/Codara/src/cli/hooks/use-active-teams.ts)
- [use-command-completion.ts](/C:/Users/天皓/Desktop/Codara/src/cli/hooks/use-command-completion.ts)
- [use-session-picker.ts](/C:/Users/天皓/Desktop/Codara/src/cli/hooks/use-session-picker.ts)
- [use-solidified-transcript.ts](/C:/Users/天皓/Desktop/Codara/src/cli/hooks/use-solidified-transcript.ts)
- [use-status-indicator.ts](/C:/Users/天皓/Desktop/Codara/src/cli/hooks/use-status-indicator.ts)
- [use-terminal-width.ts](/C:/Users/天皓/Desktop/Codara/src/cli/hooks/use-terminal-width.ts)

它们的共同特点是：

- 把“局部但复杂”的 UI 派生逻辑从顶层组件里拿走

---

## transcript 投影层

这一层在 `transcript/`。

### `transcript/model.ts`

文件：[model.ts](/C:/Users/天皓/Desktop/Codara/src/cli/transcript/model.ts)

职责：

- 把 runtime 消息、tool call、runtime event、notice、activeTurn 转成 CLI 可渲染模型

这是 CLI 里非常重要的一层。

因为终端最终显示的不是原始底层结构，而是经过投影后的显示模型。

这一层的价值在于：

- UI 不必直接理解底层 message 结构
- tool 结果、task 事件、runtime step 都能统一转译
- transcript 组件可以更专注渲染，而不是边渲染边解释语义

### `diff-compute.ts`

文件：[diff-compute.ts](/C:/Users/天皓/Desktop/Codara/src/cli/transcript/diff-compute.ts)

职责：

- 为 diff 视图提供辅助计算

---

## 渲染层

这一层在 `components/`。

拆分方式不是按技术类型，而是按终端 UI 区域。
这是合理的，因为 CLI 的维护视角更像在维护一套界面，而不是在维护一个 DOM 页面。

### `components/chrome/`

职责：

- 顶部状态栏
- 底部提示
- 活动线
- command output 面板
- task panel
- team panel

代表文件：

- [header.tsx](/C:/Users/天皓/Desktop/Codara/src/cli/components/chrome/header.tsx)
- [footer.tsx](/C:/Users/天皓/Desktop/Codara/src/cli/components/chrome/footer.tsx)
- [activity-line.tsx](/C:/Users/天皓/Desktop/Codara/src/cli/components/chrome/activity-line.tsx)
- [command-output-panel.tsx](/C:/Users/天皓/Desktop/Codara/src/cli/components/chrome/command-output-panel.tsx)
- [task-panel.tsx](/C:/Users/天皓/Desktop/Codara/src/cli/components/chrome/task-panel.tsx)
- [team-panel.tsx](/C:/Users/天皓/Desktop/Codara/src/cli/components/chrome/team-panel.tsx)

### `components/conversation/`

职责：

- 渲染 transcript 主体
- 渲染欢迎态
- 渲染 diff / markdown
- 渲染 HIL panel
- 渲染 session picker

代表文件：

- [transcript.tsx](/C:/Users/天皓/Desktop/Codara/src/cli/components/conversation/transcript.tsx)
- [solidified-block.tsx](/C:/Users/天皓/Desktop/Codara/src/cli/components/conversation/solidified-block.tsx)
- [welcome-state.tsx](/C:/Users/天皓/Desktop/Codara/src/cli/components/conversation/welcome-state.tsx)
- [hil-panel.tsx](/C:/Users/天皓/Desktop/Codara/src/cli/components/conversation/hil-panel.tsx)
- [session-picker.tsx](/C:/Users/天皓/Desktop/Codara/src/cli/components/conversation/session-picker.tsx)

### `components/prompt/`

职责：

- 渲染 prompt frame
- 渲染 composer viewport
- 渲染 completion menu

代表文件：

- [prompt-frame.tsx](/C:/Users/天皓/Desktop/Codara/src/cli/components/prompt/prompt-frame.tsx)
- [composer-view.ts](/C:/Users/天皓/Desktop/Codara/src/cli/components/prompt/composer-view.ts)
- [completion-menu.tsx](/C:/Users/天皓/Desktop/Codara/src/cli/components/prompt/completion-menu.tsx)

### `components/permission/`

职责：

- 渲染 permission review 流相关界面

### `components/teams/`

职责：

- 渲染更完整的 team 视图，例如 team detail、job board、成员面板、活动流

这块目前仍有继续收敛空间，因为：

- 当前主壳里更常用的是 `chrome/team-panel.tsx`
- `components/teams/` 更像完整团队页能力储备

---

## 工具与样式基础层

这一层在 `utils/`。

### `format.ts`

文件：[format.ts](/C:/Users/天皓/Desktop/Codara/src/cli/utils/format.ts)

职责：

- 统一格式化一些文本显示

### `theme.ts`

文件：[theme.ts](/C:/Users/天皓/Desktop/Codara/src/cli/utils/theme.ts)

职责：

- 提供 CLI 语义化颜色令牌

这层目前的方向是对的，但还没完全收口。
现在仍然有不少组件写了硬编码颜色，所以主题系统还不算完全闭环。

---

## 当前主数据流

如果只看交互式 CLI，主数据流可以概括成这样：

```text
main.tsx
  -> 创建 Codara runtime
  -> render(shell-app)

shell-app.tsx
  -> useCliController()
  -> useCliPromptSurface()
  -> useTeamPanelState()
  -> useSolidifiedTranscript()
  -> 挂 prompt / HIL 输入监听
  -> 组合 transcript / panel / prompt / footer / status
```

当用户输入一个 prompt 时，主执行链大致是：

```text
键盘输入
  -> use-prompt-input
  -> use-cli-controller.submitDraft / submitText
  -> prompt-execution.ts
  -> runSlashCommand 或 runAgentPrompt
  -> runtime 返回消息 / event
  -> transcript/model.ts 投影
  -> components 渲染
```

当用户进入 HIL 流程时，主执行链大致是：

```text
runtime pause
  -> hil-review.ts 适配成 review state
  -> hil-panel 渲染
  -> use-hil-input 接收按键
  -> hil-review-controls.ts 或 hil-execution.ts
  -> resumePause / refreshCoreState
  -> transcript 更新
```

---

## 当前维护约定

如果后面继续改 CLI，建议遵守下面这些约定。

### 1. 宿主层不要重新发明 runtime

CLI 可以消费 runtime，但不要在 CLI 层复制：

- session owner 语义
- pause 协议
- tool protocol
- model chunk 适配语义

CLI 的工作是接和显示，不是重造。

### 2. 能放局部 hook 的，不要继续堆进 controller

如果一个状态只服务某一块 UI，例如：

- command output 滚动
- prompt 表面显示
- team panel 选择

那它更适合放进 `hooks/`，而不是继续往 controller 里塞。

### 3. 有顺序的执行流，优先抽成 helper

只要逻辑长成了“先做 A，再做 B，再做 C，失败时回滚 D”，就优先考虑抽成 `app/*-execution.ts` 或类似 helper。

这比把整条流程直接摊在 `useCallback` 里更稳。

### 4. transcript 的语义解释，不要回流到组件层

如果是：

- tool result 如何显示
- runtime event 是否可见
- activeTurn 和 solidified 历史如何合并

这种逻辑优先放 `transcript/`，不要回流到 `components/`。

### 5. 组件层尽量保持“吃数据就渲染”

组件层不是不能有少量显示逻辑，但不要再让它承担：

- runtime 解释
- 宿主行为分发
- 大段状态拼装

---

## 当前剩余风险

虽然这轮架构收口已经做了不少，但当前 CLI 还不是“完全收工”的状态。

比较值得继续关注的点有：

- [use-solidified-transcript.ts](/C:/Users/天皓/Desktop/Codara/src/cli/hooks/use-solidified-transcript.ts)
  这里仍有 React 正确性风险
- [use-command-completion.ts](/C:/Users/天皓/Desktop/Codara/src/cli/hooks/use-command-completion.ts)
  补全状态机还可以继续收干净
- [theme.ts](/C:/Users/天皓/Desktop/Codara/src/cli/utils/theme.ts)
  样式系统还没完全统一
- `components/teams/` 与 `chrome/team-panel.tsx`
  团队 UI 这两条路线还没有完全收口成一种稳定方案

需要强调的是：

这些问题现在已经不是“主骨架有明显问题”，而是“局部正确性和一致性还可以继续提高”。

---

## 如何快速读懂当前 CLI

如果你第一次看这块代码，建议按这个顺序读：

1. [main.tsx](/C:/Users/天皓/Desktop/Codara/src/cli/main.tsx)
2. [shell-app.tsx](/C:/Users/天皓/Desktop/Codara/src/cli/app/shell-app.tsx)
3. [use-cli-controller.ts](/C:/Users/天皓/Desktop/Codara/src/cli/app/use-cli-controller.ts)
4. [use-cli-prompt-surface.ts](/C:/Users/天皓/Desktop/Codara/src/cli/hooks/use-cli-prompt-surface.ts)
5. [use-cli-composer-state.ts](/C:/Users/天皓/Desktop/Codara/src/cli/hooks/use-cli-composer-state.ts)
6. [prompt-execution.ts](/C:/Users/天皓/Desktop/Codara/src/cli/app/prompt-execution.ts)
7. [hil-execution.ts](/C:/Users/天皓/Desktop/Codara/src/cli/app/hil-execution.ts)
8. [controller-lifecycle.ts](/C:/Users/天皓/Desktop/Codara/src/cli/app/controller-lifecycle.ts)
9. [hil-auto-actions.ts](/C:/Users/天皓/Desktop/Codara/src/cli/app/hil-auto-actions.ts)
10. [transcript/model.ts](/C:/Users/天皓/Desktop/Codara/src/cli/transcript/model.ts)

这样读，能最快看清楚：

- 谁在持状态
- 谁在接线
- 谁在执行
- 谁在渲染

---

## 验证与回归

CLI 相关改动建议至少覆盖下面这些检查：

- `bun test tests\\unit\\cli`
  当前 CLI 单元测试主入口
- `bun run lint:cli`
  只检查 CLI 目录
- `bun run check:fast`
  做更完整的 lint + typecheck 验证

如果改动的是某条局部执行链，也优先补对应定向测试，例如：

- `prompt-execution.test.ts`
- `hil-execution.test.ts`
- `controller-lifecycle.test.ts`
- `hil-auto-actions.test.ts`

---

## 总结

当前 `src/cli` 的核心架构判断可以概括成一句话：

**这已经不是一个把所有逻辑堆进宿主壳的 CLI 原型，而是一套分出宿主层、控制层、局部状态层、投影层和渲染层的终端应用架构。**

它现在最重要的优点有 3 个：

- 没有在 CLI 里重新发明 runtime
- 复杂执行流基本都被收到了独立 helper
- 顶层文件虽然还重，但职责已经比之前清楚很多

它现在最需要继续关注的，也只有 3 类问题：

- 局部 hook 的 React 正确性
- 视觉和主题的一致性
- 个别半成品能力的进一步收口

所以现在再看这套 CLI，不应该再把它理解成“结构混乱”，而应该理解成：

**主骨架已经立住，后面重点是收边和打磨。**
