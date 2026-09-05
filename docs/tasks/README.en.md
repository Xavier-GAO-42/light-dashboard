# Task MD: Complete Protocol

[简体中文](README.md) · [English](README.en.md)

## Directories

```text
docs/tasks/
  active/       todo and review
  archive/      done
```

Directories express only whether a task has been archived. Business grouping does not use directories, which avoids file moves when agents reorganize work.

## Minimal file

```markdown
---
id: t-20260905-a1b2
title: Deliver one verifiable result
status: todo
owner: gpt-6
stream: product/frontend
due: 2026-09-12
created: 2026-09-05
---

## Prompt

Requirements and acceptance boundary.

## Plan

Expected files and verification approach.

## Progress

Current execution evidence and blockers.
```

Only `id`, `title`, `status`, and `created` are required. `owner`, `stream`, and `due` are optional. YAML values are single-line scalars; the protocol has no nesting, arrays, anchors, or multiline scalars.

`stream` is arbitrary text or may be omitted. Any number of values are allowed, and a slash is simply part of a name such as `research/memory`. A stream is not authorization or workflow.

## Why the body matters

Frontmatter stores a few mechanical facts. Real collaboration lives in the body:

- `## Prompt`: original requirement and acceptance boundary.
- `## Plan`: current approach, file ownership, and verification route.
- `## Progress`: scope changes, failures, blockers, and evidence.
- `## 结果` (`Result`): appended by the CLI for every review submission.
- `## 打回` (`Rejected`): appended by the CLI for every human rejection.

Repeated result and rejection sections form an append-only delivery history. Never overwrite an old result to make a later attempt look like a first-pass success.

## Lifecycle

```text
add       creates active/*.md with status: todo
done      appends a result and sets status: review
reject    appends a rejection and returns to status: todo
approve   sets status: done, writes completed, and moves to archive/
```

The web page is read-only and refreshes automatically. Agents edit Task MD directly or use the CLI; humans see a projection of those same files.
