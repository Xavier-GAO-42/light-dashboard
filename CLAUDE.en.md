# Light Dashboard

@AGENTS.en.md

Read and follow `AGENTS.en.md` completely. A direct change or bug request follows the same lifecycle: if an id exists, `show` it; otherwise `list` and reuse or `add`. Update the same Task MD in the main workspace before and during work. After verification, run `done`, `show` again to confirm `review`, and run `board:check`. Do not report completion only in chat or wait for a human to create the task.

Code may live in a worktree, but Task MD always updates the main board; from another directory, use `--root "absolute path to main workspace"`. Read-only questions need no task. Temporary sub-agents report to the primary executor, who writes back. Preserve uncommitted shared-workspace changes that may belong to others.

There are no fixed lanes. Use any optional `stream` only as a view hint. Fable handles requirements, decomposition, coordination, and acceptance by default; assign bounded heavy execution to GPT-6. Roles may rotate, and handoff relies only on Task MD, Git state, and verification evidence. Parallel work requires disjoint file and fact ownership; overlap must serialize.

Large delegations must state the final outcome, allowed files, forbidden files, verification commands, and expected results. Wait for execution notifications instead of polling. Self-reported completion is not evidence; independently audit every acceptance criterion.

After necessary verification, the integrating agent may merge code, while the task still enters `review` for human `approve`. Merge does not authorize public release. Deleting data, using secrets, incurring cost, publishing, and irreversible actions still require explicit authority.
