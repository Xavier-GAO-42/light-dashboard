# Light Dashboard

**超轻量化多 Agent 协作交付工作站**

[简体中文](README.md) · [English](README.en.md)

## 作者的话

我最近在开发一个体量很大的软件项目，横跨代码开发、宣传发布、自动化研究等多种工作。

为此我在本地电脑上搭了一套无后台、近乎零依赖、以 Markdown 为唯一事实源的超轻量协议：五个 GPT-6 线程和 Fable 共享信息、自主协调，再通过网页按顺序交付，人类全程流式监督。

几个月前，用同样的方法运行 GPT-5.5 集群时，还需要一个“总设计师（塔台）”做中央协调。现在，五个主线程和大量子 Agent 已经能够去中心化地高效合作，摩擦很低。

看到它们自己跑起来时的本人：**核弹瘫坐。**

![Codex 在等待其他任务完成，并通过跨线程消息自主交接](docs/images/01-codex-autonomous-handoff.jpg)

*图 1：Codex 自主通讯、等待并接手其他线程的交付。*

![Fable 挂起监视器，主动等待 Codex 返回最终结果](docs/images/02-fable-waits-for-codex.jpg)

*图 2：Fable 主动等待 Codex 完成，不做无效轮询。*

![大量任务在本地 HTML 看板中并行推进和顺序交付](docs/images/03-task-dashboard-overview.jpg)

*图 3：早期项目中的 Task MD 可视化；本仓库已经去掉图中的固定业务线。*

![Task MD 的计划、进展和多轮结果在网页中展开](docs/images/04-task-md-streaming-details.jpg)

*图 4：Task MD 的 Prompt、计划、进展与结果直接成为监督界面。*

---

Light Dashboard 不是项目管理平台，而是一份很小的多 Agent 协作协议：每个任务是一个 Markdown 文件，Agent 直接读写，人类通过本地网页观察。没有账号、数据库、消息总线和固定组织结构，也没有隐藏状态。

更准确地说，它是一个**协作架构模式和可运行参考实现**，不打算替代 GitHub Issues、Linear 或 Jira。它解决的问题更窄：多个能操作同一代码库的 Agent，如何在没有常驻总调度器的情况下共享工作事实、避免重叠，并把过程持续暴露给人类。

## 第一性原理

### 1. 共享事实必须可见

聊天上下文属于某个线程，不能充当团队状态。Task MD 才是所有 Agent 和人类共同读取、Git 可以追踪的交付事实。

### 2. 协作靠所有权，不靠中央调度

一个任务一个文件，一个文件同一时刻一个负责人。任务互不重叠时 Agent 可以并行；发生重叠就串行或交接。系统不需要“塔台”逐条转发消息。

### 3. 进展就是正文，不是新状态机

执行者在 Task MD 中写 `## 计划`、`## 进展` 和验证证据。人类看到的是实际工作内容，而不是一个可能失真的 `doing` 灯。

### 4. 交付与审核分开

状态只有 `todo → review → done`。Agent 完成工作后提交 `review`，人类通过后才归档。代码是否合并，由具体项目另行约定。

### 5. 网页只是投影

网页每两秒重新读取 Markdown，只负责搜索、分组、查看和复制执行 Prompt。关掉网页，协议照常工作；删除网页，Task MD 仍然完整。

## 最小架构

```text
Agent / Human
      │ 直接读写
      ▼
docs/tasks/active/*.md ──approve──▶ docs/tasks/archive/*.md
      │
      └── 本地只读 HTTP 投影 ──▶ 浏览器流式监督
```

任务只有四个必填字段：`id`、`title`、`status`、`created`。`owner`、`stream`、`due` 都是可选提示，不是权限系统。

`stream` 是任意文本。Agent 可以按当下工作自行创建 `frontend`、`research/model-memory`、`launch-week`，也可以完全不分流。仓库不预设 L / G / P / R，也不限制能有多少条线。

### stream 示例

```yaml
# 任务 A
stream: product/frontend

# 任务 B
stream: research/agent-memory
```

这些值不会创建目录、权限或新工作流，只让网页把相关任务聚在一起。下一个项目可以使用 `client/acme`、`paper/experiments`，或者一个 stream 都不用。

## 为什么现在可行

这不是因为 Markdown 变强了，而是 Agent 变强了。在我的实际工作流里，GPT-5.5 集群仍需要“塔台”频繁解释上下文和安排交接；到 GPT-6 与 Fable 这一代，只要共享事实足够清楚、文件所有权足够明确，它们就能长时间执行、等待其他线程、读取交付并自主继续。

这里的“去中心化”不是分布式系统意义上的无中心共识，而是**不再需要一个人或模型持续转发每一条消息**。Git、文件系统和最终的人类审核依然是明确的协调边界。

## 30 秒开始

需要 Node.js 20+，无需安装依赖。

```powershell
npm run board
```

打开 `http://127.0.0.1:4790`。在另一个终端新建任务：

```powershell
node tools/board/task.mjs add --title "交付一个可验证结果" --owner gpt-6 --stream frontend
```

Agent 工作完成后：

```powershell
node tools/board/task.mjs done <id> --feedback "实现结果与验证证据"
node tools/board/task.mjs show <id>
npm run board:check
```

人类验收后：

```powershell
node tools/board/task.mjs approve <id>
```

协作约定见 [`AGENTS.md`](AGENTS.md)，Claude/Fable 入口见 [`CLAUDE.md`](CLAUDE.md)，Task MD 协议见 [`docs/tasks/README.md`](docs/tasks/README.md)。英文版见 [`README.en.md`](README.en.md)、[`AGENTS.en.md`](AGENTS.en.md) 和 [`CLAUDE.en.md`](CLAUDE.en.md)。

## 适用边界

适合：共享一个本地仓库或能通过 Git 同步、任务可以拆成明确文件边界、希望人类流式监督、又不想部署协作后台的小团队。

不适合：需要跨组织权限控制、强实时一致性、审计合规、复杂依赖排程，或数百人同时操作的团队。本地 `.board.lock` 只解决同一文件系统上的短写入互斥，不是跨机器分布式锁。

## 文件

```text
AGENTS.md                    Agent 通用协作规则
CLAUDE.md                    Fable / Claude 极短入口
docs/tasks/active/           活动任务
docs/tasks/archive/          已验收任务
tools/board/task.mjs         最小 CLI
tools/board/server.mjs       只读本地网页
tools/board/index.html       单文件界面
```
