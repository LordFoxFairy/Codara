# 第3章：Tool System — 加工具不改循环

## 从一个工具到工具系统

s00 说了：一个 bash 工具就够了。

但实际系统会有很多工具：

```python
tools = [
    {"name": "bash", ...},
    {"name": "read_file", ...},
    {"name": "write_file", ...},
    {"name": "edit_file", ...},
    {"name": "grep", ...},
]
```

问题来了：**怎么加工具，才不会把循环搞乱？**

## 糟糕的做法

把工具逻辑塞进循环：

```python
while True:
    response = model(messages, tools)

    for call in response.tool_calls:
        if call.name == "bash":
            result = run_bash(call.args)
        elif call.name == "read_file":
            result = read_file(call.args)
        elif call.name == "write_file":
            result = write_file(call.args)
        # 每加一个工具，这里就多一个 elif
```

每加一个工具，循环就要改一次。

## 正确的做法

用 Dispatch Map：

```python
TOOLS = {
    "bash": run_bash,
    "read_file": read_file,
    "write_file": write_file,
}

while True:
    response = model(messages, tools)

    for call in response.tool_calls:
        handler = TOOLS[call.name]
        result = handler(call.args)
```

加工具只需要：

```python
TOOLS["new_tool"] = new_handler
```

循环不用改。

## 为什么需要专用工具

bash 能做所有事，为什么还要 `read_file`、`write_file`？

**1. 更好的错误处理**

```bash
# bash: 文件太大会截断，模型不知道
cat 10GB_file.txt

# read_file: 明确告诉模型
read_file("10GB_file.txt")
# 返回：Error: File too large (10GB), use limit parameter
```

**2. 更好的权限控制**

```bash
# bash: 可以执行任何命令
rm -rf /

# 专用工具: 只能在工作区内
write_file("/etc/passwd", "...")  # 拒绝
```

**3. 更清晰的语义**

```python
# 模型看到工具列表，知道能做什么
tools = [
    {"name": "read_file", "description": "Read a file"},
    {"name": "edit_file", "description": "Edit a file"},
]

# 而不是
tools = [
    {"name": "bash", "description": "Run any command"}
]
```

## 工具设计原则

**原子化**

一个工具做一件事：

```python
# ✓ 好
read_file(path)
edit_file(path, old, new)

# ✗ 坏
file_operation(path, operation, ...)
```

**可组合**

复杂操作通过组合完成：

```python
# 读取 → 分析 → 修改 → 写入
content = read_file("config.json")
new_content = model.analyze(content)
write_file("config.json", new_content)
```

**边界内建**

权限、校验在工具层：

```python
def write_file(path, content):
    if not is_in_workspace(path):
        raise PermissionError("Path outside workspace")
    if needs_approval(path):
        if not ask_user_approval():
            raise PermissionError("User denied")
    # 执行写入
```

不在循环里做权限判断。

---

**Dispatch Map 让工具系统可扩展。专用工具让它更安全、更可靠。**
