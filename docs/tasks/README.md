# Task Markdown 协议

任务文件既是工作合同，也是流式监督记录。网页与 CLI 只投影这些文件，不维护数据库或第二份状态。

## 目录

```text
docs/tasks/
  LINES.md
  tags.json
  inbox/
  L/ G/ P/ R/
  archive/L/ archive/G/ archive/P/ archive/R/
```

- `L`：Launch，发布、运维与交付现场。
- `G`：Growth，增长、传播与用户触达。
- `P`：Product，产品、工程与体验。
- `R`：Research，探索、实验与提案。
- `inbox`：还不是正式任务的提醒。

## 文件格式

文件名是 `<id>.md`，例如 `t-20260905-a1b2.md`。

```markdown
---
id: t-20260905-a1b2
title: 一句话说明可验收结果
line: P
phase: 0
priority: 1
status: todo
owner: gpt-6
track: C
tags: [bug]
due: 2026-09-12
created: 2026-09-05
source: 人类需求
---

## Prompt

原始要求与验收边界。

## 计划

当前范围、预计修改文件和验证方式。

## 进展

执行中持续追加或更新的真实状态。
```

必填字段是 `id`、`title`、`line`、`status`、`created`；正式任务还需要 `phase` 与 `priority`。状态只有 `todo`、`review`、`done`。`track` 可用 `A`–`F`、组合如 `C+A` 或 `all` 表示文件所有权轨道。

YAML 只使用简单 `key: value` 和内联列表 `[a, b]`，不使用嵌套、锚点或多行标量。

## 生命周期

```text
新建 → todo
执行完成 → review
人类打回 → todo
人类通过 → done 并移动到 archive/<line>/
```

`done` 会追加一个 `## 结果`；`reject` 会追加一个 `## 打回`。这些历史记录按发生顺序保留。长证据写进任务正文或仓库文件，CLI 的反馈保持单行。

## 流式监督

执行者在真正修改前写计划，在范围变化、验证失败、发现阻碍和取得关键结果时写进展。人类打开本地网页即可看到下一次自动刷新后的内容。不要增加 `doing`、心跳或私有数据库来表示 Agent 是否正在运行；真实进度只来自 Task MD。

## 并发

本机写操作通过 `docs/tasks/.board.lock` 短暂互斥。跨机器协作仍依赖 Git、任务归属和文件边界：一个 id 一个文件，同一文件只由一个负责人修改。
