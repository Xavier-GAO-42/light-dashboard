const LINE_FEEDBACK = {
  P: '说明产品、用户或代码行为的实际变化；无变化也注明。',
  L: '说明发布、部署或运维现场的实际变化；无变化也注明。',
};

export function executionPrompt(task, { energySaving = false } = {}) {
  const feedback = LINE_FEEDBACK[task.line] ?? '说明对实际对象的影响。';
  const prompt = `执行看板任务 ${task.id}，遵循 AGENTS.md。
在本机主工作区运行 node tools/board/task.mjs show ${task.id}，读取 filePath 指向的任务，不重复建任务；修改前写“## 计划”，执行中持续写回同一主看板 MD。其他目录调用 CLI 时加 --root "主工作区绝对路径"。
实现并聚焦验证后运行 node tools/board/task.mjs done ${task.id} --feedback "结果与验证证据"，再 show 确认 status: review，运行 npm run board:check，最后按仓库规则提交。未完成保留 todo 并记录阻碍；不要自行归档。
反馈说人话：${feedback}`;
  return energySaving
    ? `${prompt}\n\n节能模式：将边界明确的执行工作委派给子 Agent；重活优先交给 GPT-6。Fable 5 或当前主 Agent 负责拆分、协调与验收，只传必要上下文、接收简短结果和验证证据，避免重复读写与同文件并行修改。小任务直接完成，避免委派开销；按 AGENTS.md 使用可用执行通道。`
    : prompt;
}
