# 版本发布与 release 分支管理流程

> 分类：runbooks
> 适用范围：全局（所有版本发布与 release 分支修复）
> 关键词：release, 版本, version, SemVer, 语义化版本, 分支, branch, tag, 标签, 发布, 回合, backport, cherry-pick, main, x.x.x
> 最后更新：2026-10-03

## 背景

`main` 是持续集成的开发分支，而线下装置需要一个**固定、可追溯、可独立修复**的版本快照。本流程规定：

1. 每次在 `main` 上确认完成 / 发布一个版本时，从 `main` 拉出对应的 `release/x.x.x` 分支并打标签；
2. 发布后的修复发生在对应 `release` 分支上，并逐条评估是否需要回合（backport）到 `main`，避免主线丢失修复，也避免把现场专用补丁污染主线。

## 内容

### 规则（硬约束）

1. **版本只在 `main` 确认完成 / 发布时产生**：每个版本（含 patch）都从当时的 `main` 切出，命名 `release/x.y.z`；首个版本固定为 `release/0.0.0`。
2. **版本号遵循 [SemVer 语义化版本](https://semver.org/lang-CN/)**：
   - `major`（x）：不兼容的大改动 / 重要里程碑；
   - `minor`（y）：向后兼容的新功能；
   - `patch`（z）：向后兼容的缺陷修复与小调整。
   - 0.x 阶段为初始开发期，API 与内容不稳定，`major` 保持 0。AI 依据自上个标签以来的提交（`feat` / `fix` / 破坏性改动分布）提议版本号，**由用户确认后执行**。
3. **切分支同时打附注标签**：标签名 `vx.y.z`，与分支版本号严格对应（如 `release/0.0.0` ↔ `v0.0.0`），打在切出点提交上；标签标记原始发布点，**不移动、不重打**。
4. **`release` 分支只接收该版本的修复**，不做新功能；日常新功能继续在 `main` 上开发。
5. **回合必须评估 + 经用户同意**：`release` 分支上的每一个修复提交，都要判断 `main` 是否需要；需要回合时，向用户列出提交清单与影响面，**获得明确同意后**才执行 `cherry-pick`；判定不需要时，也要向用户说明理由。
6. **分支与标签的推送沿用 [Git 提交规范](../conventions/git-commit.md)**：用户明确说「推送 / push」之前，分支与标签只保留在本地。
7. 提交信息同样遵循 [Git 提交规范](../conventions/git-commit.md)（Conventional Commits + 目的 / 影响面）。

### 流程 A：发布新版本（从 main 切 release）

**前置条件**

- 用户明确表示某个版本「确认完成 / 发布」；
- 当前位于 `main`，工作区干净（`git status` 无未提交改动）；
- 该版本的改动均已提交。

**操作步骤**

1. 确定版本号：
   - 首个版本：直接使用 `0.0.0`；
   - 后续版本：查看 `git log <上一标签>..HEAD --oneline`，按 SemVer 规则提议 `x.y.z`，报用户确认。
2. 切出发布分支并打标签：

   ```bash
   git checkout main
   git checkout -b release/x.y.z
   git tag -a vx.y.z -m "release x.y.z"
   ```

3. 切回 `main` 继续日常开发：`git checkout main`。
4. 仅在用户明确要求推送时执行：`git push origin release/x.y.z` 与 `git push origin vx.y.z`。

**验证方式**

- `git branch --list 'release/*'` 能看到新分支；
- `git tag -n` 能看到 `vx.y.z` 及标签说明；
- `git log --oneline --graph --all` 中标签位于 `main` 与 `release/x.y.z` 的共同切出点。

### 流程 B：在 release 分支修复并评估回合 main

**前置条件**

- 已存在对应的 `release/x.y.z` 分支；
- 改动是针对该已发布版本的修复（现场问题、缺陷修正），不是新功能。

**操作步骤**

1. `git checkout release/x.y.z`，完成修复并按提交规范提交，记录提交 SHA（多个修复则分别提交）。
2. 评估 `main` 是否需要该修复，对照检查：
   - **需要回合**：同一问题在 `main` 上仍然存在，且修复在主线仍适用；
   - **不需要回合**：`main` 上相关代码已重构 / 删除，或修复依赖现场专用配置、主线无此场景；
   - **拿不准**：列出差异与分析，由用户裁定，不擅自决定。
3. 判定需要回合时，向用户说明：待回合的提交 SHA 清单、修复内容、对 `main` 的潜在冲突与影响面；**用户明确同意后**执行：

   ```bash
   git checkout main
   git cherry-pick <提交SHA>          # 多个提交按时间先后依次 cherry-pick
   ```

4. 判定不需要回合时，仅保留在 `release` 分支，并在汇报中写明理由。
5. 回合到 `main` 的修复随 `main` 下一次发布自然带出（下次版本号在发布时按流程 A 重新评估），不单独为回合动作发版。
6. 是否推送由用户明确指示。

**验证方式**

- `git log main --oneline` 中能看到回合的提交（cherry-pick 会生成新 SHA，提交信息保留原内容）；
- 对照修复涉及的代码，确认 `main` 上改动生效；
- `git log --oneline --graph --all` 可看清「release 修复 → 回合 main」的走向。

## 示例

首次发布（版本 0.0.0）：

```bash
git checkout main
git status                # 确认工作区干净
git checkout -b release/0.0.0
git tag -a v0.0.0 -m "release 0.0.0"
git checkout main
```

在 `release/0.0.0` 上修复并回合：

```bash
git checkout release/0.0.0
# 修复、提交后得到 SHA abc1234
git checkout main
git cherry-pick abc1234   # 须先获得用户同意
```

## 失败处理

- **cherry-pick 冲突**：进程停在冲突状态时，列出冲突文件与双方差异，与用户确认解决方式，不擅自选边；解决后 `git cherry-pick --continue`，放弃则 `git cherry-pick --abort` 回到回合前状态。
- **版本号定错 / 分支切错**：标签或分支**尚未推送**前，可 `git tag -d vx.y.z`、`git branch -D release/x.y.z` 删除后按流程重建；**已推送**的不强制覆盖远程，先与用户协商处理方案。
- **误在 release 分支做了新功能**：停止继续开发，原则上应将该功能回合到 `main`；经用户同意后 cherry-pick，`release` 分支恢复为只接收修复。
- **工作区不干净无法切分支**：先提交或 `git stash` 暂存，禁止携带未提交改动跨分支操作。

## 关联

- 上游 / 依赖：[git-commit.md](../conventions/git-commit.md)（提交信息格式、单一主题、未明确不推送）
- 下游 / 影响面：约束仓库内全部版本发布、release 分支修复与回合 main 的操作
- 相关文档：暂无
