# 零依赖任务看板

这个目录提供一个 Node.js 内置模块实现的本地网页和 CLI。两者都直接读写 `docs/tasks/`；看板只监听 `127.0.0.1`，不需要数据库、账号或云服务。

## 启动

```powershell
npm run board
node tools/board/server.mjs --port 4790 --root D:\path\to\repo
```

默认地址是 `http://127.0.0.1:4790`。页面支持搜索、建任务、编辑、拖动排序、标签、提交审核、打回、归档与每 2 秒自动刷新。任务卡上的“复制 Prompt”会生成带任务 id 的通用执行指令；节能模式会额外建议把边界清楚的重活交给 GPT-6。

## CLI

```text
node tools/board/task.mjs list [--line P] [--phase 0] [--status todo|review|done] [--json]
node tools/board/task.mjs show <id>
node tools/board/task.mjs add --line P --phase 0 --title "…" [--owner gpt-6] [--tags a,b]
node tools/board/task.mjs set <id> [--title …] [--owner …] [--track …] [--due …] [--body-file …]
node tools/board/task.mjs move <id> --line L --phase 0 [--priority N]
node tools/board/task.mjs done <id> --feedback "结果与证据"
node tools/board/task.mjs reject <id> --reason "打回原因"
node tools/board/task.mjs approve <id>
node tools/board/task.mjs unarchive <id>
node tools/board/task.mjs delete <id> --yes
```

所有命令可加 `--root <仓库根>`。完整数据协议见 [`../../docs/tasks/README.md`](../../docs/tasks/README.md)。

## 检查

```powershell
npm run board:check
```

检查器验证 frontmatter、目录与状态、id 唯一性、阶段优先级、标签引用和归档位置。没有任务时输出“无任务”并成功退出。
