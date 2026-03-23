# 第7章：SubAgent — 隔离上下文的第一步

## 为什么需要 SubAgent

单 Agent 走到这一步,最先撞上的不是"能力不够",而是"上下文越来越脏"。

很多工作不需要把完整过程留在主会话里：

- 去读一批文件,只为确认一个事实
- 跑一轮验证,只要最终结论
- 做一次独立探索,再回一个摘要

这类工作如果都留在父上下文里,主线很快会被淹没。

**实际成本：**

假设父 Agent 已经跑了 20 轮,上下文 40k tokens。现在要做一个探索任务,需要 10 轮对话：

```
如果在父上下文里做：
第21轮: 40k + 2k = 42k tokens
第22轮: 42k + 2k = 44k tokens
...
第30轮: 58k tokens
总计: 42k + 44k + ... + 58k = 500k tokens
```

如果用 SubAgent 隔离：

```
父上下文保持 40k tokens
子上下文从 0 开始：
第1轮: 2k tokens
第2轮: 4k tokens
...
第10轮: 20k tokens
总计: 2k + 4k + ... + 20k = 110k tokens
```

**成本差距：4.5 倍。**

## SubAgent 的核心价值

**不是并行,而是隔离。**

```typescript
async function runSubAgent(task: string) {
    const subMessages = [
        { role: "user", content: task }
    ];

    while (true) {
        const response = await model(subMessages, tools);
        if (response.stop_reason !== "tool_use") break;
        // 子会话独立运行
    }

    return response.content; // 只返回结果
}
```

做法很直接：

- 给子 Agent 一份独立上下文
- 让它在自己的会话里完成工作
- 最后只把结果带回父 Agent

**把噪声留在子会话,把结论带回主会话。**

### 隔离的本质：进程边界的类比

SubAgent 的隔离类似操作系统的进程隔离：

```
父进程（父 Agent）：
- 有自己的地址空间（上下文）
- 创建子进程时传递参数（任务描述）
- 等待子进程返回（结果摘要）
- 不关心子进程的内部状态（中间过程）

子进程（子 Agent）：
- 独立地址空间（独立上下文）
- 执行完毕后退出（会话结束）
- 只通过返回值通信（结构化结果）
```

**关键差异：** 进程隔离是强制的（硬件 MMU），SubAgent 隔离是设计的（架构约束）。

## 为什么不共享全文

如果父会话的完整历史直接继承给每个子 Agent,会立刻出现三个问题：

### 1. 成本高

假设父上下文 50k tokens,启动 5 个子 Agent：

```
如果全量继承：
每个子 Agent 初始成本 = 50k tokens
5 个子 Agent = 250k tokens（仅初始化）

如果裁剪上下文：
每个子 Agent 初始成本 = 2k tokens（任务描述）
5 个子 Agent = 10k tokens
```

**成本差距：25 倍。**

### 2. 焦点散

子 Agent 的任务是"检查文件 A 是否存在函数 foo",但父上下文里有：

- 30 轮关于数据库设计的讨论
- 15 轮关于 UI 布局的调整
- 10 轮关于测试策略的争论

这些信息会：

- 干扰模型的注意力分配
- 增加推理延迟（更多 tokens 要处理）
- 降低任务完成质量（信噪比下降）

**实测数据：** 在 50k tokens 上下文中执行简单任务,模型的首 token 延迟比 2k tokens 上下文慢 3-5 倍。

### 3. 信息污染

父上下文中可能有：

```
用户："我觉得函数 foo 应该重构"
助手："好的,我会重构 foo"
```

子 Agent 的任务只是"检查 foo 是否存在",但继承了父上下文后,可能会：

- 误以为需要重构 foo
- 在报告中提到重构建议
- 偏离原始任务目标

**原则：** 给子 Agent 的上下文应该是任务相关的最小集合。

所以更合理的默认是：

- 父 Agent 给子 Agent 一份裁剪后的任务上下文
- 子 Agent 完成后只回结构化结果或摘要
- 完整子 transcript 作为二级信息按需查看

## 摘要压缩的信息损失

子 Agent 完成后,只返回摘要而不是完整 transcript,会有信息损失：

**损失的信息：**

```
子 Agent 完整过程：
1. 读取文件 A（3000 行）
2. 搜索函数 foo
3. 发现 foo 在第 1234 行
4. 检查 foo 的参数
5. 发现参数类型不匹配
6. 返回结论

摘要：
"文件 A 的第 1234 行存在函数 foo,但参数类型不匹配"
```

**丢失的细节：**

- 文件 A 的完整内容
- 搜索过程中的中间结果
- 参数类型不匹配的具体位置
- 其他可能相关的函数

**何时需要完整 transcript：**

- 调试子 Agent 的行为
- 父 Agent 需要更多细节
- 用户要求查看完整过程

**设计权衡：**

```typescript
interface SubAgentResult {
    summary: string;           // 总是返回
    fullTranscript?: Message[]; // 按需保留
    metadata?: {
        tokensUsed: number;
        duration: number;
        toolCalls: number;
    };
}
```

## 为什么不能递归

SubAgent 可以再启动 SubAgent 吗？技术上可以,但实践中不应该：

### 1. 栈溢出风险

```
父 Agent（深度 0）
  └─ 子 Agent A（深度 1）
      └─ 子 Agent B（深度 2）
          └─ 子 Agent C（深度 3）
              └─ 子 Agent D（深度 4）
                  └─ ...
```

每层都需要：

- 等待下层完成
- 保持自己的上下文
- 维护调用栈

**实际限制：**

- 深度 3 以上,调试变得极其困难
- 深度 5 以上,成本和延迟不可接受
- 深度 10 以上,几乎必然失控

### 2. 成本爆炸

假设每个子 Agent 平均消耗 10k tokens：

```
深度 1: 10k tokens
深度 2: 10k + 10k = 20k tokens
深度 3: 10k + 10k + 10k = 30k tokens
深度 4: 10k + 10k + 10k + 10k = 40k tokens
```

如果每层启动 2 个子 Agent：

```
深度 1: 1 × 10k = 10k tokens
深度 2: 2 × 10k = 20k tokens
深度 3: 4 × 10k = 40k tokens
深度 4: 8 × 10k = 80k tokens
深度 5: 16 × 10k = 160k tokens
```

**指数增长,不可持续。**

### 3. 责任链断裂

```
父 Agent: "去检查文件 A"
  └─ 子 Agent A: "去读取文件 A"
      └─ 子 Agent B: "去打开文件 A"
          └─ 子 Agent C: "文件 A 不存在"
```

当 C 报错时：

- C 不知道为什么要读文件 A
- B 不知道检查的目的是什么
- A 不知道父 Agent 的完整意图

**结果：** 错误处理变得极其困难,每层都在盲目传递信息。

### 4. 正确的替代方案

如果任务确实需要多层分解：

**方案 1：扁平化**

```
父 Agent:
  ├─ 子 Agent A: 任务 1
  ├─ 子 Agent B: 任务 2
  └─ 子 Agent C: 任务 3
```

所有子 Agent 都是父 Agent 的直接子节点,深度固定为 1。

**方案 2：任务队列**

```typescript
const tasks = ["任务1", "任务2", "任务3"];
const results = [];

for (const task of tasks) {
    const result = await runSubAgent(task);
    results.push(result);
}
```

顺序执行,但深度始终为 1。

**方案 3：升级到 Team**

如果任务复杂到需要多层协作,说明 SubAgent 已经不够用,应该升级到 Team 架构（第8章）。

## 为什么它是协作的第一步

因为多 Agent 之前,先要学会"把工作切干净"。

如果连最小的父子隔离都做不好,后面的任务持久化、团队协作、协议、自治,都会建立在混乱上下文之上。

**协作之前,先学会隔离。**

### 隔离能力的层次

```
Level 0: 单 Agent,所有工作在一个上下文
  └─ 问题：上下文污染,成本线性增长

Level 1: SubAgent,父子隔离
  └─ 解决：上下文隔离,成本可控
  └─ 限制：父 Agent 必须等待子 Agent 完成

Level 2: Task 持久化（第8章）
  └─ 解决：异步执行,父 Agent 不阻塞
  └─ 限制：单个 Agent 执行,无协作

Level 3: Team 协作（第8章）
  └─ 解决：多 Agent 并行,任务分配
  └─ 限制：需要协调机制,复杂度高
```

**SubAgent 是 Level 1,是后续所有协作的基础。**

## 三个关键点

**1. 隔离的核心是成本控制**

不是为了并行,而是为了避免父上下文被子任务的噪声污染。成本差距可达 4-5 倍。

**2. 摘要压缩是必须的,但要保留完整 transcript**

摘要用于父 Agent 决策,完整 transcript 用于调试和审计。

**3. 禁止递归,深度固定为 1**

递归会导致栈溢出、成本爆炸、责任链断裂。如果需要多层协作,升级到 Team 架构。

---

**SubAgent 的核心价值不是多开一个模型,而是给某段工作一个独立上下文,把过程噪声隔离出去,只把结果带回主会话。**
