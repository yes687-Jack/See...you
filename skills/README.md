# skills — AI 技能目录

所有项目级 AI 技能统一安装在本目录下，每个技能一个独立子目录，技能定义文件固定命名为 `SKILL.md`：

```
skills/
  <skill-name>/
    SKILL.md          # 必需：技能定义（YAML frontmatter + Markdown 正文）
    <其他资源文件>     # 可选：脚本、参考文档等，随技能目录内聚存放
```

## 安装新技能

1. 复制模板目录：`skills/_template/` → `skills/<skill-name>/`（用短横线命名，小写英文）。
2. 编辑 `<skill-name>/SKILL.md`：
   - 填写 frontmatter 中的 `name`（与目录名一致）和 `description`（说明做什么、何时触发）。
   - 按正文小节补全使用步骤。
3. 在下方「已安装技能」表登记，并在根 [AGENT.md](../AGENT.md) 的知识地图中可被找到。

## 已安装技能

| 技能 | 说明 |
|---|---|
| [add-knowledge](./add-knowledge/SKILL.md) | 知识库新增 / 修改引导流程：查重 → 按影响面定位 → 登记路由 → 统一模板填充。任何向知识库写入知识的操作都先走此流程 |
