# s03: Tool System

`s00 > s01 > s02 > [ s03 ] s04 > s05 > s06 > s07 > s08 > s09 > s10`

> *"Dispatch Map — 加工具不改循环，注册即扩展"*
>
> **Harness 层**: 工具分发 — 扩展 Agent 能触达的边界。

## 问题

只有 `bash` 时，所有操作都走 shell。`cat` 截断不可预测，`sed` 遇到特殊字符就崩，每次 bash 调用都是不受约束的安全面。

专用工具（`read_file`、`write_file`）可以在工具层面做路径沙箱、内容验证、权限控制。

**关键洞察：加工具不需要改循环。**

## 解决方案

```
+--------+      +-------+      +------------------+
|  User  | ---> |  LLM  | ---> | Tool Dispatch    |
| prompt |      |       |      | {                |
+--------+      +---+---+      |   bash: runBash  |
                    ^           |   read: runRead  |
                    |           |   write: runWrite|
                    +-----------+   edit: runEdit  |
                    tool_result | }                |
                                +------------------+

Dispatch Map 是一个字典：{tool_name: handler_function}
一次查找替代任何 if/elif 链。
```

## 工作原理

### 1. 每个工具有一个处理函数

路径沙箱防止逃逸工作区：

```typescript
function safePath(p: string): string {
  const resolved = path.resolve(WORKDIR, p);
  if (!resolved.startsWith(WORKDIR)) {
    throw new Error(`Path escapes workspace: ${p}`);
  }
  return resolved;
}

function runRead(args: { path: string; limit?: number }): string {
  const filePath = safePath(args.path);
  const text = fs.readFileSync(filePath, "utf-8");
  const lines = text.split("\n");

  if (args.limit && args.limit < lines.length) {
    return lines.slice(0, args.limit).join("\n");
  }

  return text.slice(0, 50000); // 硬截断
}
```

### 2. Dispatch Map 将工具名映射到处理函数

```typescript
const TOOL_HANDLERS: Record<string, (args: any) => string> = {
  bash: (args) => runBash(args.command),
  read_file: (args) => runRead(args),
  write_file: (args) => runWrite(args.path, args.content),
  edit_file: (args) => runEdit(args.path, args.old_text, args.new_text),
};
```

### 3. 循环中按名称查找处理函数

循环体本身与 s01 完全一致：

```typescript
for (const block of response.content) {
  if (block.type === "tool_use") {
    const handler = TOOL_HANDLERS[block.name];
    const output = handler
      ? handler(block.input)
      : `Unknown tool: ${block.name}`;

    results.push({
      type: "tool_result",
      tool_use_id: block.id,
      content: output,
    });
  }
}
```

**加工具 = 加 handler + 加 schema。循环永远不变。**

## 工具设计原则

### 原子化

每个工具做一件事。`read_file` 只读，`write_file` 只写，`edit_file` 只改。

```typescript
// ✓ 好 — 原子化
read_file({ path: "config.json" });
edit_file({ path: "config.json", old_text: "debug: false", new_text: "debug: true" });

// ✗ 坏 — 多职责
modify_file({ path: "config.json", operation: "replace", ... });
```

### 可组合

复杂操作通过组合完成，不是单个工具的复杂参数。

```typescript
// ✓ 好 — 组合
read_file({ path: "data.json" });
// Agent 处理 JSON
write_file({ path: "output.json", content: processed });

// ✗ 坏 — 单工具复杂化
transform_json({ input: "data.json", output: "output.json", transform: "..." });
```

### 描述清晰

工具的 schema 是 Agent 的唯一文档。描述要精确。

```typescript
{
  name: "read_file",
  description: "Read file content. Returns up to 50k chars. Use limit for large files.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path relative to workspace" },
      limit: { type: "number", description: "Max lines to read (optional)" },
    },
    required: ["path"],
  },
}
```

## Bash — 最强工具

为什么 Bash 是一切的开始？

```typescript
function runBash(command: string): string {
  const result = execSync(command, {
    cwd: WORKDIR,
    encoding: "utf-8",
    timeout: 30000,
    maxBuffer: 1024 * 1024, // 1MB
  });
  return result.slice(0, 50000);
}
```

**Bash 是通用接口：**
- 文件操作：`ls`、`find`、`grep`
- 版本控制：`git status`、`git diff`
- 构建测试：`npm test`、`cargo build`
- 系统信息：`ps`、`df`、`env`

专用工具是优化，Bash 是兜底。

## 变更内容

| 组件           | 之前 (s02)         | 之后 (s03)                     |
|----------------|--------------------|--------------------------------|
| Tools          | 1 (仅 bash)        | 4 (bash, read, write, edit)    |
| Dispatch       | 硬编码 bash 调用   | `TOOL_HANDLERS` 字典           |
| 路径安全       | 无                 | `safePath()` 沙箱              |
| Agent loop     | 不变               | 不变                           |

## 关键洞察

- **Dispatch Map 是扩展的唯一机制** — 不需要修改循环代码
- **工具是 Agent 的手** — 设计工具就是设计 Agent 的能力边界
- **Bash 是最后的防线** — 专用工具覆盖不了的，Bash 兜底
- **沙箱是工具层的责任** — 不是循环的责任

---

**加工具不改循环。这是可扩展性的基石。**
