# Light Dashboard

**超轻量化多Agent协作交付工作站**

Light Dashboard 是一套把人类、Fable 5 与 GPT-6 放在同一条可审计交付链上的极简协作模板。它不用数据库，不维护隐藏状态：任务、计划、进展、审核记录都直接写在 Git 可追踪的 Markdown 文件里；网页和 CLI 只是同一份事实的两个入口。

## 它解决什么

- Fable 5 负责理解需求、拆分边界、协调和验收。
- GPT-6 负责边界清楚的实现、验证与证据整理。
- 人类可以打开本地网页，流式查看 Task MD 中不断更新的计划和进展，并最终审核归档。
- Agent 交接只依赖任务文件与 Git 状态，不依赖某段聊天是否仍在上下文里。

## 开始使用

需要 Node.js 20 或更新版本，无第三方依赖。

```powershell
npm run board
```

浏览器打开 `http://127.0.0.1:4790`。新任务也可以直接用 CLI 创建：

```powershell
node tools/board/task.mjs add --line P --phase 0 --title "实现一个可验收的小功能" --owner gpt-6
node tools/board/task.mjs list
```

协作约定见 [`AGENTS.md`](AGENTS.md)，Claude/Fable 入口见 [`CLAUDE.md`](CLAUDE.md)，Task Markdown 协议见 [`docs/tasks/README.md`](docs/tasks/README.md)，工具命令见 [`tools/board/README.md`](tools/board/README.md)。

## 核心原则

1. `docs/tasks/` 是唯一任务事实；网页、CLI 和 Agent 不另建台账。
2. 修改前写计划，执行中持续写进展，完成后由执行者提交待审核。
3. 人类审核决定归档；代码合并与任务归档是两个动作。
4. 一个文件同一时刻只有一个负责人；并行发生在互不重叠的边界上。
5. 删除数据、公开发布、付费、密钥和其他不可逆操作始终需要明确授权。

## 仓库结构

```text
AGENTS.md                 通用 Agent 协作规则
CLAUDE.md                 Fable / Claude 的短入口 Prompt
docs/tasks/               Markdown 任务与协议
tools/board/              零依赖网页看板和 CLI
package.json              启动与检查命令
```
