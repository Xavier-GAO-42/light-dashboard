# Light Dashboard Collaboration Protocol

[简体中文](AGENTS.md) · [English](AGENTS.en.md)

Goal: let multiple agents share facts, avoid overwriting one another, and deliver work under streaming human supervision without a central coordination service.

## One source of truth

Tasks exist only as Markdown files under `docs/tasks/`. Do not create a database, status page, master task list, or private progress ledger. The web page and CLI are only interfaces to these files.

## Starting work

These rules apply both to a primary executor receiving a request directly and to an agent receiving a delegated task. A human does not need to create the task or copy a special prompt first.

Before modifying anything:

1. If a task id exists, run `node tools/board/task.mjs show <id>`.
2. Otherwise run `list`, reuse an obvious matching task, or run `add --title "Verifiable outcome"`.
3. Write `## Plan` in your own Task MD, including scope, expected files, and verification.
4. Inspect current Git status and the target-file diff. Existing changes may belong to someone else; preserve them.

When execution starts, scope changes, verification fails, or work becomes blocked, update `## Plan` / `## Progress` in the same Task MD. Progress reported only in chat is not shared state.

Read-only questions do not require tasks. Each primary executor maintains only its own Task MD. A temporary sub-agent without its own task id reports back to the primary executor, who writes the result into the original task. Do not add `doing`, `start`, heartbeat, or lock fields.

### Main board and worktrees

All local executors should share the main workspace's `docs/tasks/`. Do not maintain a separate task copy inside every worktree. Code may be isolated in a worktree, but plans and results continue to update the main board:

```powershell
node tools/board/task.mjs show <id> --root "absolute path to main workspace"
```

Edit the `filePath` returned by `show`. The main workspace can be derived from the parent of `git rev-parse --path-format=absolute --git-common-dir`. Separate clones use their own main workspace and exchange task records through Git.

## Free-form streams

There are no fixed lanes. A task may include an optional free-form field:

```yaml
stream: product/frontend
```

Agents may create any number or depth of names, such as `research`, `research/memory`, or `release/week-1`, or omit `stream` entirely. It is only a grouping and communication hint; it does not determine authorization, priority, or directory placement.

Do not create a new state machine for grouping. Collaboration safety comes from explicit task and file ownership: one task per file and one owner per shared file at a time.

## Model roles

One field-tested default split is:

- **Fable 5 / coordinating agent:** handles ambiguous requirements, prioritization, decomposition, file ownership, supervision, and review.
- **GPT-6 / executing agent:** handles well-bounded, high-volume implementation and evidence-heavy verification.
- **Lightweight models:** handle search, organization, and low-risk mechanical checks.

The coordinator should not spend most of its context on mechanical execution, and the executor should not silently decide ambiguous product direction. These are defaults, not permanent identities. Models may rotate roles; handoff relies on Task MD, Git state, and current evidence, never chat memory.

## Execution and handoff

- Record start, scope changes, failures, blockers, and material results under `## Progress`.
- Do not treat “working on it” in chat as team state. The next agent resumes from Task MD and Git.
- Non-overlapping tasks may run in parallel. Overlapping file or fact ownership must serialize and hand off.
- Before starting, name the files you expect to modify. If an active task overlaps, coordinate order instead of merging two simultaneous edits after the fact.
- Uncommitted changes in a shared workspace may belong to someone else. Modify only your local scope; do not reset, check out over, or replace a current file with an old copy.
- An agent's completion claim is not evidence. Verification must map to the task contract and include commands, results, or inspectable artifacts.

Fable, GPT-6, and other models may act as coordinator or executor. Complex work can be split into tasks with disjoint file boundaries. Complete small work directly; do not delegate merely to demonstrate delegation.

## Contract for large delegations

A prompt for a sub-agent or independent execution thread must specify:

1. One concrete final outcome.
2. Files or directories it may modify.
3. Files, state, and external systems it must not touch.
4. Verifiable acceptance criteria, including exact commands and expected results.
5. Task id, main workspace location, and how results return to the shared record.

Mechanical outcomes delegate best. Do not blindly delegate work that requires interpreting ambiguous goals, choosing architecture, changing control documents, using credentials, incurring cost, publishing externally, or deleting data.

One execution task may use sub-agents, but modifications to shared files must remain serialized inside that task. Sub-agents return concise results and evidence; the primary executor validates and writes back instead of copying entire conversations into Task MD.

## Supervision cadence

- Wait instead of polling frequently. Let the execution thread notify the coordinator on completion, failure, or required human input.
- Steer only when there is new evidence, a blocker, or drift. Do not interrupt work merely to appear supervisory.
- When the executor becomes idle, audit each acceptance criterion independently. Follow up only for missing evidence, and accept only when the evidence is complete.
- Never auto-approve permission requests. Preserve task state and record the blocker when human authority is required.

## Evidence discipline

- `exit 0`, a polished report, a static count, or an agent's self-report does not automatically prove acceptance.
- Current code, current runtime behavior, and primary sources outrank old chats, screenshots, historical evidence, and archived tasks.
- Match verification depth to risk. A small change gets focused checks; authorization, deletion, recovery, migration, concurrency, and persistent state require stronger evidence.
- On failure, record the visible symptom, underlying mechanism, repair scope, verification boundary, and remaining risk. Do not hide root causes behind new states or fallbacks.

## Git and integration

- Keep one long-lived integration branch by default, usually `main`. Use a `task/<task-id>` worktree or short-lived branch when isolation is useful.
- Commit only files owned by the current task and include the task id in the commit message. Task MD in the main workspace and code in a task branch may be committed separately.
- After necessary verification, the integrating agent may merge a worktree task without treating human `approve` as a merge prerequisite.
- Merge and task acceptance are different. The task still enters `review`, and a human decides whether to archive it. Merge also does not authorize public deployment, data deletion, or another external action.

## Completion and human review

There are only three states:

```text
todo → review → done
       ↘ reject → todo
```

After implementation and verification:

```powershell
node tools/board/task.mjs done <id> --feedback "Result and verification evidence"
node tools/board/task.mjs show <id>
npm run board:check
```

Confirm `review`. A human runs `approve` to move the file into `archive/`, or `reject --reason "Reason"` to return it to `todo`. Results and rejections append to history; they never overwrite it.

Write `review` before committing your code, tests, and Task MD. Do not report completion only in chat, and do not leave `done` for a human to execute on your behalf. If incomplete, keep `todo` and record the blocker.

## Implementation principles

- Every fact has one owner. Ask who owns the fact and whether existing structure can derive it before adding fields or protocol.
- Web pages, CLIs, and reports are projections. Do not let a projection become a second source of truth.
- Prefer removing duplicate state and obsolete paths. Do not hide root causes with keyword heuristics, hidden review, automatic workflow patches, or extra fallbacks.
- Failure of an auxiliary feature must not invalidate a completed primary result that already has evidence.

## Authority boundaries

Agents may autonomously perform reversible local edits, task delegation, focused verification, documentation updates, and local commits. Push only under the repository's existing authorization. Deleting user data, handling secrets, incurring external cost, publishing publicly, or taking another irreversible action requires explicit authority. The task protocol never expands permissions.
