# Minimal Tool Layer

[简体中文](README.md) · [English](README.en.md)

The tool layer does two things: safely mutate Task MD and project the files into a local read-only web page. It has no database, frontend framework, account system, fixed lanes, or remote service.

## CLI

```text
node tools/board/task.mjs list [--status todo|review|done] [--stream name] [--owner name] [--json]
node tools/board/task.mjs show <id>
node tools/board/task.mjs add --title "…" [--owner name] [--stream any/name] [--due YYYY-MM-DD] [--body-file path]
node tools/board/task.mjs done <id> --feedback "Result and evidence"
node tools/board/task.mjs reject <id> --reason "Reason for rejection"
node tools/board/task.mjs approve <id>
```

Every command accepts `--root <repository-root>`. Writes take a short-lived `.board.lock` and persist with a temporary file plus atomic rename. The lock contains no business state.

## Web page

```powershell
npm run board
```

Open `http://127.0.0.1:4790`. The page can read, search, filter by arbitrary stream, display task bodies, and copy execution prompts. All mutation returns to Markdown, so there is no second write protocol.

## Validation

```powershell
npm run board:check
```

The checker validates required fields, id-to-filename consistency, status-to-directory consistency, dates, unknown fields, and duplicate ids.
