# s03: Tool System

> *"Dispatch Map — 加工具不改循环，注册即扩展"*

## 问题

只有 `bash` 时，所有操作都走 shell。但 shell 是无约束的：
- `cat` 截断不可预测
- `sed` 遇到特殊字符就崩
- 每次 bash 调用都是不受约束的安全面

专用工具可以在工具层面做路径沙箱、内容验证、权限控制。

**关键洞察：加工具不需要改循环。**

## 核心设计

```
+--------+      +-------+      +------------------+
|  User  | ---> |  LLM  | ---> | Tool Dispatch    |
| prompt |      |       |      | {                |
+--------+      +---+---+      |   bash: handler  |
                    ^           |   read: handler  |
                    |           |   write: handler |
                    +-----------+ }                |
                    tool_result +------------------+
```

**Dispatch Map 是一个字典：** `{tool_name: handler_function}`

一次查找替代任何 if/elif 链。

## 工具设计原则

### 1. 原子化

每个工具做一件事。

```python
# ✓ 好 — 原子化
read_file(path)
edit_file(path, old_text, new_text)

# ✗ 坏 — 多职责
modify_file(path, operation, ...)
```

### 2. 可组合

复杂操作通过组合完成，不是单个工具的复杂参数。

```python
# ✓ 好 — 组合
data = read_file("data.json")
processed = Agent.process(data)
write_file("output.json", processed)

# ✗ 坏 — 单工具复杂化
transform_json(input, output, transform)
```

### 3. 描述清晰

工具的 schema 是 Agent 的唯一文档。

```python
{
  "name": "read_file",
  "description": "Read file content. Returns up to 50k chars.",
  "parameters": {
    "path": "File path relative to workspace",
    "limit": "Max lines to read (optional)"
  }
}
```

## Bash — 最强工具

为什么 Bash 是一切的开始？

**Bash 是通用接口：**
- 文件操作：`ls`、`find`、`grep`
- 版本控制：`git status`、`git diff`
- 构建测试：`npm test`、`cargo build`
- 系统信息：`ps`、`df`、`env`

专用工具是优化，Bash 是兜底。

## 伪代码

```python
TOOL_HANDLERS = {
    "bash": lambda cmd: run_bash(cmd),
    "read": lambda path: read_file(path),
    "write": lambda path, content: write_file(path, content),
}

for tool_call in response.tool_calls:
    handler = TOOL_HANDLERS[tool_call.name]
    result = handler(**tool_call.args)
```

7 行。工具扩展就是字典扩展。

## 设计权衡

| 选择 | 优点 | 缺点 |
|------|------|------|
| Dispatch Map | 加工具不改循环，扩展性强 | 工具间无法共享状态 |
| 原子化工具 | 职责清晰，易测试 | 复杂操作需要多次调用 |
| Bash 兜底 | 覆盖所有场景 | 安全风险高，需要沙箱 |
| 路径沙箱 | 防止逃逸工作区 | 限制了工具的灵活性 |

## 关键洞察

- **Dispatch Map 是扩展的唯一机制** — 不需要修改循环代码
- **工具是 Agent 的手** — 设计工具就是设计 Agent 的能力边界
- **Bash 是最后的防线** — 专用工具覆盖不了的，Bash 兜底
- **沙箱是工具层的责任** — 不是循环的责任

---

**加工具不改循环。这是可扩展性的基石。**
