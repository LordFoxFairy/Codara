# s04: Skill Loading

`s00 > s01 > s02 > s03 > [ s04 ] s05 > s06 > s07 > s08 > s09 > s10`

> *"两层注入 — System Prompt 放索引，Tool Result 放内容"*
>
> **Harness 层**: 按需知识 — 模型开口要时才给的领域专长。

## 问题

你希望 Agent 遵循特定领域的工作流：git 约定、测试模式、代码审查清单。全塞进 System Prompt 太浪费 — 10 个技能，每个 2000 token，就是 20,000 token，大部分跟当前任务毫无关系。

而且违反了 s02 的原则：**System Prompt 必须静态**。

## 解决方案

```
System Prompt (Layer 1 — 永远存在):
+--------------------------------------+
| You are a coding agent.              |
| Skills available:                    |
|   - git: Git workflow helpers        |  ~100 tokens/skill
|   - test: Testing best practices     |
+--------------------------------------+

当模型调用 load_skill("git"):
+--------------------------------------+
| tool_result (Layer 2 — 按需):        |
| <skill name="git">                   |
|   Full git workflow instructions...  |  ~2000 tokens
|   Step 1: ...                        |
| </skill>                             |
+--------------------------------------+
```

第一层：System Prompt 中放技能名称（低成本）。
第二层：tool_result 中按需放完整内容。

## 工作原理

### 1. 每个技能是一个目录，包含 `SKILL.md` 文件

```
skills/
  git/
    SKILL.md       # ---
                   # name: git
                   # description: Git workflow helpers
                   # ---
                   # ## Git Workflow
                   # 1. Always create feature branch
                   # 2. ...

  test/
    SKILL.md       # ---
                   # name: test
                   # description: Testing best practices
                   # ---
                   # ## Test Strategy
                   # ...
```

### 2. SkillLoader 递归扫描 `SKILL.md` 文件

```typescript
class SkillLoader {
  private skills: Map<string, { meta: any; body: string }> = new Map();

  constructor(skillsDir: string) {
    const files = glob.sync(`${skillsDir}/**/SKILL.md`);
    for (const file of files) {
      const text = fs.readFileSync(file, "utf-8");
      const { meta, body } = this.parseFrontmatter(text);
      const name = meta.name || path.basename(path.dirname(file));
      this.skills.set(name, { meta, body });
    }
  }

  getDescriptions(): string {
    const lines = [];
    for (const [name, skill] of this.skills) {
      const desc = skill.meta.description || "";
      lines.push(`  - ${name}: ${desc}`);
    }
    return lines.join("\n");
  }

  getContent(name: string): string {
    const skill = this.skills.get(name);
    if (!skill) {
      return `Error: Unknown skill '${name}'.`;
    }
    return `<skill name="${name}">\n${skill.body}\n</skill>`;
  }
}
```

### 3. 第一层写入 System Prompt，第二层是工具

```typescript
const SKILL_LOADER = new SkillLoader("./skills");

const SYSTEM_PROMPT = `You are a coding agent at ${WORKDIR}.
Skills available:
${SKILL_LOADER.getDescriptions()}`;

const TOOL_HANDLERS = {
  // ...base tools...
  load_skill: (args: { name: string }) => SKILL_LOADER.getContent(args.name),
};
```

模型知道有哪些技能（便宜），需要时再加载完整内容（贵）。

## 技能设计原则

### 可发现

技能描述要让 Agent 知道什么时候用。

```markdown
---
name: git
description: Git workflow helpers — branch naming, commit messages, PR checklist
---
```

### 自包含

技能内容要完整，不依赖外部文档。

```markdown
## Git Workflow

1. **Branch naming**: `feature/<author>/<description>`
2. **Commit messages**: `type(scope): description`
3. **PR checklist**:
   - [ ] Tests pass
   - [ ] No console.log
   - [ ] Updated docs
```

### 可执行

技能是行动指南，不是理论文档。

```markdown
## Code Review Checklist

Run these checks before submitting:

1. `npm run lint` — no errors
2. `npm test` — all pass
3. `git diff main` — review your changes
4. Check for TODO/FIXME comments
```

## 变更内容

| 组件           | 之前 (s03)       | 之后 (s04)                     |
|----------------|------------------|--------------------------------|
| Tools          | 4                | 5 (+load_skill)                |
| System Prompt  | 静态字符串       | + 技能描述列表                 |
| 知识库         | 无               | skills/\*/SKILL.md 文件        |
| 注入方式       | 无               | 两层（System Prompt + result） |

## 关键洞察

- **索引 vs 内容分离** — System Prompt 只放索引，保持静态
- **按需加载是性能优化** — 不是所有知识都需要前置
- **技能是领域专长** — 不是通用知识，是特定工作流
- **Agent 自己决定何时加载** — 不是 Harness 强制注入

---

**知识不是越多越好。用到什么，加载什么。**
