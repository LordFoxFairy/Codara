# 第7章：SubAgent — 隔离上下文的第一步

## 为什么需要 SubAgent

单 Agent 走到这一步，最先撞上的不是"能力不够"，而是"上下文越来越脏"。

很多工作不需要把完整过程留在主会话里：

- 去读一批文件，只为确认一个事实
- 跑一轮验证，只要最终结论
- 做一次独立探索，再回一个摘要

这类工作如果都留在父上下文里，主线很快会被淹没。

## SubAgent 的核心价值

**不是并行，而是隔离。**

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

**把噪声留在子会话，把结论带回主会话。**

## 为什么不共享全文

如果父会话的完整历史直接继承给每个子 Agent，会立刻出现三个问题：

- 成本高
- 焦点散
- 子任务会被无关信息污染

所以更合理的默认是：

- 父 Agent 给子 Agent 一份裁剪后的任务上下文
- 子 Agent 完成后只回结构化结果或摘要
- 完整子 transcript 作为二级信息按需查看

## 为什么它是协作的第一步

因为多 Agent 之前，先要学会"把工作切干净"。

如果连最小的父子隔离都做不好，后面的任务持久化、团队协作、协议、自治，都会建立在混乱上下文之上。

**协作之前，先学会隔离。**

---

**SubAgent 的核心价值不是多开一个模型，而是给某段工作一个独立上下文，把过程噪声隔离出去，只把结果带回主会话。**
