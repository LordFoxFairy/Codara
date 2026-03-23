# 第1章：Bash 工具 — 一切能力的基础

## 为什么从 Bash 开始

给 LLM 一个工具，它就能和真实世界交互。

但给它什么工具？读文件？写文件？运行测试？查 git 历史？

答案是：**只给一个 bash 工具就够了。**

```python
tools = [
    {
        "name": "bash",
        "description": "Execute a bash command",
        "input_schema": {
            "type": "object",
            "properties": {
                "command": {"type": "string"}
            }
        }
    }
]
```

## Bash 能做什么

一个 bash 工具 = 整个操作系统的能力：

- 读文件：`cat package.json`
- 写文件：`echo "content" > file.txt`
- 搜索：`grep -r "pattern" .`
- 运行测试：`npm test`
- Git 操作：`git status`
- 安装依赖：`npm install`
- 查看进程：`ps aux`
- ...

你不需要为每个操作写一个专用工具。bash 是通用接口。

## 为什么专用工具更好

虽然 bash 能做所有事，但实际系统会加专用工具：

```python
tools = [
    {"name": "bash", ...},
    {"name": "read_file", ...},
    {"name": "write_file", ...},
    {"name": "edit_file", ...},
]
```

为什么？

**1. 更好的错误处理**

```bash
# bash: 文件太大会截断，模型不知道
cat large_file.txt

# read_file: 明确告诉模型"文件太大，只返回前 1000 行"
read_file("large_file.txt", limit=1000)
```

**2. 更好的权限控制**

```bash
# bash: 可以执行任何危险命令
rm -rf /

# 专用工具: 只能在工作区内操作
write_file("/etc/passwd", "...") # 拒绝
```

**3. 更好的结构化输出**

```bash
# bash: 返回纯文本，模型要自己解析
git status

# 专用工具: 返回结构化数据
{"modified": ["file1.ts"], "untracked": ["file2.ts"]}
```

## 设计原则

**Bash 是兜底，专用工具是优化。**

- 模型优先用专用工具（更安全、更可靠）
- 专用工具覆盖不了的，用 bash
- 不要试图用专用工具覆盖所有场景

**例子：**

- 读文件 → `read_file`（专用工具）
- 运行测试 → `bash npm test`（bash）
- 查看 CPU 使用率 → `bash top`（bash）

---

**一个 bash 工具就能让 agent 工作。专用工具让它工作得更好。**
