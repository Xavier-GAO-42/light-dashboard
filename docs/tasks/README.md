# Task MD：完整协议

## 目录

```text
docs/tasks/
  active/       todo 和 review
  archive/      done
```

目录只表达“是否已归档”。业务分组不使用目录，避免不同 Agent 移动文件时制造冲突。

## 最小文件

```markdown
---
id: t-20260905-a1b2
title: 交付一个可验证结果
status: todo
owner: gpt-6
stream: frontend
due: 2026-09-12
created: 2026-09-05
---

## Prompt

任务要求与验收边界。

## 计划

预计修改范围和验证方式。

## 进展

执行中的真实状态。
```

只有 `id`、`title`、`status`、`created` 必填。`owner`、`stream`、`due` 可选。YAML 值都是单行文本；不使用嵌套、数组、锚点或多行标量。

`stream` 可以是任意文本，也可以省略。它可以有任意数量，斜杠只是名字的一部分，例如 `research/memory`。不要把 stream 当成权限或工作流。

## 为什么正文很重要

frontmatter 只保存少量机械事实，真实协作发生在正文：

- `## Prompt`：原始要求和验收边界。
- `## 计划`：当前方法、文件所有权和验证路线。
- `## 进展`：范围变化、失败、阻碍与关键证据。
- `## 结果`：每次提交审核时由 CLI 追加。
- `## 打回`：每次人类打回时由 CLI 追加。

同一标题可以出现多次，形成追加式交付历史。不要覆盖旧结果来伪装一次成功。

## 生命周期

```text
add       创建 active/*.md，status: todo
done      追加结果，status: review
reject    追加打回，status: todo
approve   status: done，写 completed，移动到 archive/
```

网页只读并自动刷新。Agent 直接编辑 Task MD 或使用 CLI，人类看到的就是这些文件的当前投影。
