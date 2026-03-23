# 第15章：Memory — 持久化记忆系统

> **让 agent 记住一切**：从"健忘的临时工"到"记忆深刻的老朋友"，通过向量检索实现长期记忆。

---

## 为什么需要 Memory

**上下文窗口的局限**：
- Claude 3.5 Sonnet：200K tokens ≈ 150K 英文单词
- 看似很大，但几天的对话就会填满
- 超出窗口的内容会被遗忘

**Memory 的价值**：
```
临时会话：只记得最近 200K tokens
常驻助手：记得所有历史对话 + 文档 + 笔记
```

**核心差异**：
- 上下文窗口是**短期记忆**（RAM）
- Memory 是**长期记忆**（硬盘）

---

## 核心机制

### 1. Embedding — 向量化

将文本转换为向量：

```typescript
async function embed(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;  // 1536 维向量
}
```

**为什么需要向量化**：
- 文本无法直接比较相似度
- 向量可以计算余弦相似度
- 支持语义搜索（不只是关键词匹配）

**向量维度**：
```
text-embedding-3-small:  1536 维
text-embedding-3-large:  3072 维
voyage-large-2:          1536 维
```

维度越高，表达能力越强，但存储和计算成本也越高。

### 2. Vector Store — 向量存储

使用 SQLite + sqlite-vec 存储向量：

```sql
CREATE TABLE chunks_vec (
  id INTEGER PRIMARY KEY,
  chunk_id TEXT UNIQUE,
  embedding BLOB,  -- 向量数据
  metadata TEXT    -- JSON: {file, line, timestamp}
);

CREATE INDEX idx_embedding ON chunks_vec USING vec(embedding);
```

**为什么用 SQLite**：
- 轻量级，无需独立数据库服务
- sqlite-vec 扩展支持向量索引
- 性能足够（百万级向量）

**向量索引**：
- 使用 HNSW（Hierarchical Navigable Small World）算法
- 近似最近邻搜索，时间复杂度 O(log N)
- 精度 vs 速度可调

### 3. Hybrid Search — 混合搜索

结合向量搜索和关键词搜索：

```typescript
async function hybridSearch(query: string, k: number) {
  // 1. 向量搜索
  const vectorResults = await searchVector(query, k * 2);

  // 2. 关键词搜索（BM25）
  const keywordResults = await searchKeyword(query, k * 2);

  // 3. 合并结果（RRF: Reciprocal Rank Fusion）
  const merged = mergeResults(vectorResults, keywordResults);

  return merged.slice(0, k);
}
```

**为什么需要混合搜索**：
- 向量搜索：语义相似，但可能漏掉精确匹配
- 关键词搜索：精确匹配，但无法理解语义
- 混合搜索：两者互补，召回率更高

**RRF 算法**：
```typescript
function mergeResults(vec: Result[], kw: Result[]): Result[] {
  const scores = new Map<string, number>();

  vec.forEach((r, i) => {
    scores.set(r.id, (scores.get(r.id) || 0) + 1 / (60 + i));
  });

  kw.forEach((r, i) => {
    scores.set(r.id, (scores.get(r.id) || 0) + 1 / (60 + i));
  });

  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => findById(id));
}
```

### 4. Temporal Decay — 时间衰减

越新的记忆权重越高：

```typescript
function applyTemporalDecay(
  score: number,
  timestamp: number,
  now: number
): number {
  const ageInDays = (now - timestamp) / (24 * 60 * 60 * 1000);
  const decay = Math.exp(-ageInDays / 30);  // 30 天半衰期
  return score * (0.5 + 0.5 * decay);
}
```

**衰减曲线**：
```
t = 0 天:   权重 = 1.0
t = 30 天:  权重 = 0.82
t = 90 天:  权重 = 0.55
t = 365 天: 权重 = 0.50
```

**为什么需要时间衰减**：
- 最近的对话更相关
- 避免旧信息干扰
- 模拟人类记忆遗忘曲线

---

## 设计权衡

| 维度 | 选择 | 原因 |
|------|------|------|
| **向量模型** | text-embedding-3-small | 性价比高，1536 维足够 |
| **存储引擎** | SQLite + sqlite-vec | 轻量级，无需独立服务 |
| **搜索策略** | 混合搜索（向量 + BM25） | 召回率高，精度好 |
| **时间衰减** | 30 天半衰期 | 平衡新旧信息 |
| **分块大小** | 512 tokens | 平衡粒度和上下文 |

**为什么 512 tokens**：
- 太小（<256）：上下文不完整
- 太大（>1024）：检索粒度粗
- 512 是经验值，适合大部分场景

**为什么 30 天半衰期**：
- 太短（<7 天）：旧信息被过度压制
- 太长（>90 天）：新信息优势不明显
- 30 天符合人类记忆规律

---

## 实现细节

### 1. 文件监听

自动同步文件变化：

```typescript
const watcher = chokidar.watch(memoryDir, {
  ignored: /(^|[\/\\])\../,  // 忽略隐藏文件
  persistent: true,
});

watcher.on("add", async (path) => {
  await indexFile(path);
});

watcher.on("change", async (path) => {
  await reindexFile(path);
});

watcher.on("unlink", async (path) => {
  await removeFromIndex(path);
});
```

**监听策略**：
- 使用 chokidar 库，跨平台兼容
- 忽略隐藏文件和临时文件
- 增量更新，避免全量重建

### 2. 分块策略

```typescript
function chunkText(text: string, maxTokens: number): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split("\n\n");

  let current = "";
  for (const para of paragraphs) {
    const tokens = countTokens(current + para);
    if (tokens > maxTokens) {
      if (current) chunks.push(current);
      current = para;
    } else {
      current += (current ? "\n\n" : "") + para;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}
```

**分块原则**：
- 按段落分割，保持语义完整
- 避免截断代码块、列表
- 每块独立 embedding

### 3. 批量 Embedding

```typescript
async function batchEmbed(texts: string[]): Promise<number[][]> {
  const BATCH_SIZE = 100;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: batch,
    });
    results.push(...response.data.map((d) => d.embedding));
  }

  return results;
}
```

**批量优化**：
- 每次最多 100 条
- 减少 API 调用次数
- 降低成本和延迟

---

## 使用场景

### 1. 对话历史检索

```typescript
const query = "上次我们讨论的那个 bug 是什么？";
const results = await memory.search(query, 5);

// 注入到 System Prompt
const context = results.map((r) => r.text).join("\n\n");
const systemPrompt = `
相关历史对话：
${context}

请基于以上上下文回答用户问题。
`;
```

### 2. 文档知识库

```typescript
// 索引项目文档
await memory.indexDirectory("./docs");

// 检索相关文档
const query = "如何配置 Heartbeat？";
const results = await memory.search(query, 3);
```

### 3. 个人笔记

```typescript
// 索引笔记目录
await memory.indexDirectory("~/notes");

// 检索笔记
const query = "我之前记录的 React 性能优化技巧";
const results = await memory.search(query, 5);
```

---

## 数学模型

### 1. 余弦相似度

```
similarity(A, B) = (A · B) / (||A|| * ||B||)

其中：
A · B = Σ(A[i] * B[i])
||A|| = sqrt(Σ(A[i]²))
```

取值范围：[-1, 1]
- 1：完全相同
- 0：无关
- -1：完全相反

### 2. BM25 得分

```
score(D, Q) = Σ IDF(q) * (f(q,D) * (k+1)) / (f(q,D) + k * (1 - b + b * |D| / avgdl))

其中：
IDF(q) = log((N - n(q) + 0.5) / (n(q) + 0.5))
f(q,D) = q 在文档 D 中的频率
k = 1.2, b = 0.75（经验参数）
```

### 3. RRF 融合

```
RRF(d) = Σ 1 / (k + rank_i(d))

其中：
k = 60（经验参数）
rank_i(d) = 文档 d 在第 i 个排序中的位置
```

---

## 总结

Memory 让 agent 从"健忘的临时工"变成"记忆深刻的老朋友"：

1. **向量化**：将文本转换为 1536 维向量
2. **混合搜索**：向量 + BM25，召回率高
3. **时间衰减**：30 天半衰期，新信息优先
4. **自动同步**：文件监听，增量更新

**关键洞察**：
- 向量搜索是语义理解的基础
- 混合搜索比单一策略更可靠
- 时间衰减模拟人类记忆规律

下一章将讲解 **Soul**：如何给 agent 注入个性。
