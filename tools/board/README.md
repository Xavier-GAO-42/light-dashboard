# 最小工具层

工具层只做两件事：安全地修改 Task MD，以及把它们投影成一个本地只读网页。没有数据库、前端框架、账号、固定业务线或远程服务。

## CLI

```text
node tools/board/task.mjs list [--status todo|review|done] [--stream name] [--owner name] [--json]
node tools/board/task.mjs show <id>
node tools/board/task.mjs add --title "…" [--owner name] [--stream any/name] [--due YYYY-MM-DD] [--body-file path]
node tools/board/task.mjs done <id> --feedback "结果与证据"
node tools/board/task.mjs reject <id> --reason "打回原因"
node tools/board/task.mjs approve <id>
```

所有命令可加 `--root <仓库根>`。写操作用一个短暂的 `.board.lock` 串行，并通过临时文件 + rename 原子落盘。锁不保存业务状态。

## 网页

```powershell
npm run board
```

打开 `http://127.0.0.1:4790`。网页只有读取、搜索、按自由 stream 过滤、查看正文和复制执行 Prompt；所有修改都回到 Markdown，因此不存在第二个写入协议。

## 检查

```powershell
npm run board:check
```

检查器验证必填字段、id 与文件名、状态与目录、日期、未知字段和重复 id。
