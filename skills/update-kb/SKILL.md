---
name: update-kb
description: 同步 DSH 知识库。当用户说「更新知识库」或要求刷新/同步/重新拉取 DSH 知识库内容时使用。从本地 deepseek-harness 仓库将 docs/、packages/ 与 vendor/ 的 README、仓库顶层文档同步到 /Users/mac/Desktop/dsh知识库/，保持知识库与官方仓库一致。
---

# 更新知识库（update-kb）

用户说「更新知识库」时，按下列步骤执行。目标：把 DSH 官方仓库的最新内容复制进知识库，并刷新索引与汇总。

## 路径常量

- 仓库：`/Users/mac/Desktop/deepseek-harness`
- 知识库：`/Users/mac/Desktop/dsh知识库`

## 步骤

### 1. 拉取仓库最新内容

```bash
cd /Users/mac/Desktop/deepseek-harness && git fetch origin && git pull --rebase origin HEAD 2>&1 || true
```

若仓库是浅克隆（shallow）或拉取失败，报告错误并停止，不要用旧内容覆盖知识库。

### 2. 同步 docs/

把 `docs/` 下全部文档（md / yaml / yml）镜像到知识库 `docs/`（保留目录结构，删除已不存在的文件）：

```bash
rsync -a --delete \
  --include='*/' --include='*.md' --include='*.yaml' --include='*.yml' --exclude='*' \
  /Users/mac/Desktop/deepseek-harness/docs/ \
  /Users/mac/Desktop/dsh知识库/docs/
```

### 3. 同步 packages/ 与 vendor/ 的 README

每个包目录的 `README.md`（及 `README.zh.md`）复制到知识库对应路径（保留层级）：

```bash
for root in packages vendor; do
  find "/Users/mac/Desktop/deepseek-harness/$root" -name 'README.md' -o -name 'README.zh.md' 2>/dev/null | while IFS= read -r f; do
    rel="${f#/Users/mac/Desktop/deepseek-harness/$root/}"
    dest="/Users/mac/Desktop/dsh知识库/$root/$(dirname "$rel")"
    mkdir -p "$dest"
    cp "$f" "$dest/"
  done
done
```

### 4. 同步仓库顶层文档

```bash
mkdir -p /Users/mac/Desktop/dsh知识库/仓库顶层文档
for f in README.md README.zh.md AGENTS.md CLAUDE.md CONTRIBUTING.md CONTRIBUTING.zh.md BENCHMARK.md THIRD_PARTY_NOTICES.md; do
  [ -f "/Users/mac/Desktop/deepseek-harness/$f" ] && cp "/Users/mac/Desktop/deepseek-harness/$f" /Users/mac/Desktop/dsh知识库/仓库顶层文档/
done
```

### 5. 刷新 INDEX.md

按实际同步结果重写 `/Users/mac/Desktop/dsh知识库/INDEX.md`：
- 统计 `docs/`、`packages/`、`vendor/`、`仓库顶层文档/` 的文件数与总行数；用 `find` + `wc -l` 得到准确数字。
- 保留原索引结构：知识库说明 → 目录 → 各分区统计 → 更新说明。
- 若本次同步有新增/删除的文件，把主要变化写进「最近更新」小节。

### 6. 校验

- 抽查 2-3 个刚同步的文件确实是最新内容（`git log -1 --format=%H -- <file>` 与知识库文件一致，或直接对比内容）。
- 报告：同步了哪些目录、文件计数、是否有失败项。

## 注意事项

- 所有步骤都要在知识库目录外执行 `git`/`rsync` 命令，知识库本身不做版本管理，它只是镜像。
- 不要修改仓库里的任何文件；对知识库只做「复制」，不重写官方文档内容（INDEX.md 除外）。
- 若 rsync 或 find 报错，中止并如实报告，不要静默跳过整段同步。