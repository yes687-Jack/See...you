# AGENT.md — AI 知识库总入口

> 本文件是 AI 助手理解和协助本项目的**唯一入口**。
> 定位：**纯路由索引**——只做导航与路由登记，不在本文件沉淀具体知识。
> 所有细节知识写入被路由的文档；任何新增知识文档，必须回本文件登记路由。

## 项目简介

- 项目名称：**see-you-h5**（《看见...你》）
- 一句话定位：_（待补充）_
- 技术栈：Vite + 原生 JavaScript + three.js 0.128，构建产物为可离线运行的静态 H5

## 知识地图

| 我想了解 / 执行… | 路由到 |
|---|---|
| 系统架构、模块划分、数据流、关键机制 | [.ai_knowledge/architecture/](./.ai_knowledge/architecture/README.md) |
| 编码规范、硬约束、禁止事项 | [.ai_knowledge/conventions/](./.ai_knowledge/conventions/README.md) |
| 操作手册：构建、发布、排障 SOP | [.ai_knowledge/runbooks/](./.ai_knowledge/runbooks/README.md) |
| 术语表、名词约定 | [.ai_knowledge/glossary/](./.ai_knowledge/glossary/README.md) |
| **新增 / 修改知识库中的知识** | **[skills/add-knowledge/SKILL.md](./skills/add-knowledge/SKILL.md)**（先查重、再定位、必登记路由） |
| 使用某项 AI 技能（skill） | [skills/](./skills/README.md) → `skills/<技能名>/SKILL.md` |
| 了解某个功能模块的局部知识 | 该模块目录下的 `AGENT.md`（见下方模块入口） |

## 模块入口

功能模块可在**自己的目录内**配置模块级 `AGENT.md` 作为局部路由入口，格式从 [.ai_knowledge/templates/module-agent.md](./.ai_knowledge/templates/module-agent.md) 复制。模块级入口只路由模块内部知识；跨模块的公共知识一律放入 `.ai_knowledge/`。

| 模块 | 入口 | 说明 |
|---|---|---|
| _（待补充，如 `src/three`）_ | `src/<module>/AGENT.md` | |

## 扩展知识的路由规则

> 任何新增或修改知识的操作，**必须先执行** [add-knowledge 引导流程](./skills/add-knowledge/SKILL.md)：查重 → 按影响面定位 → 登记路由 → 统一模板填充 → 校验。

1. **公共知识** → 按类型放入 `.ai_knowledge/<分类>/`，新建文档使用 [知识文档模板](./.ai_knowledge/templates/knowledge-doc.md)，并在该分类的 `README.md` 索引表登记。
2. **技能** → 在 `skills/` 下新建 `<技能名>/SKILL.md`（从 `skills/_template/` 复制），并在 `skills/README.md` 登记。
3. **模块知识** → 仅模块内有效的知识下沉到功能层级：`src/<模块>/AGENT.md` 作路由入口，正文放 `src/<模块>/docs/`；只覆盖子层级的继续下沉，共用后上移到 `.ai_knowledge/`。新建模块入口需从模板复制并在本文件「模块入口」表登记。
4. **登记义务**：新增 / 重命名 / 删除知识文档后，同步更新本文件及上级索引中的路由，确保从本入口可达。
