# Claude Code 官方文档参考

本目录存放 Claude Code 官方文档，用于对比和参考。

## 文档来源

Claude Code 官方文档位于：
- GitHub: https://github.com/anthropics/claude-code
- 文档目录: `/docs` 或 `/documentation`

## 如何获取

由于版权原因，请手动下载官方文档：

```bash
# 克隆 Claude Code 仓库
git clone https://github.com/anthropics/claude-code.git /tmp/claude-code

# 复制文档到此目录
cp -r /tmp/claude-code/docs/* ./claude-code-reference/
```

## 关键文档

需要重点参考的文档：

1. **Skills 系统**
   - 文件：`skills.md` 或类似
   - 关注：skill 定义、目录结构、扩展机制

2. **Agent 系统**
   - 文件：`agents.md` 或类似
   - 关注：内置代理类型、自定义代理、解析路径

3. **Middleware/Hooks**
   - 文件：`middleware.md` 或 `hooks.md`
   - 关注：中间件架构、钩子系统

4. **扩展机制**
   - 文件：`extensions.md` 或 `plugins.md`
   - 关注：如何添加自定义功能

## 对比要点

参考 `../design-alignment.md` 了解需要对比的设计要点。
