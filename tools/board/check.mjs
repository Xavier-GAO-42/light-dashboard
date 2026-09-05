#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIELD_ORDER, STATUSES, TASK_ID_RE, loadAll } from './lib/tasks.mjs';

function rootArg(args) {
  const index = args.indexOf('--root');
  if (index < 0) return process.cwd();
  if (!args[index + 1]) throw new Error('--root 缺少路径');
  return args[index + 1];
}

export async function checkRoot(root, output = console.log) {
  const tasks = await loadAll(root);
  const issues = [];
  const ids = new Map();
  for (const task of tasks) {
    const label = task.relativePath;
    for (const field of ['id', 'title', 'status', 'created']) if (!task[field]) issues.push(`${label}: 缺少 ${field}`);
    if (!TASK_ID_RE.test(task.id)) issues.push(`${label}: id 格式无效`);
    if (path.basename(task.filePath, '.md') !== task.id) issues.push(`${label}: id 与文件名不一致`);
    if (!STATUSES.includes(task.status)) issues.push(`${label}: status 无效`);
    for (const field of ['title', 'owner', 'stream']) if (task[field] !== undefined && /[\r\n]/.test(task[field])) issues.push(`${label}: ${field} 必须是单行`);
    for (const field of Object.keys(task)) if (!['body', 'filePath', 'relativePath', 'archived', ...FIELD_ORDER].includes(field)) issues.push(`${label}: 未知字段 ${field}`);
    if (!ids.has(task.id)) ids.set(task.id, []);
    ids.get(task.id).push(label);
  }
  for (const [id, files] of ids) if (files.length > 1) issues.push(`${id}: id 重复于 ${files.join(', ')}`);
  for (const issue of issues) output(`- ${issue}`);
  if (!issues.length) output(tasks.length ? `检查通过：${tasks.length} 个任务` : '无任务');
  return { ok: issues.length === 0, issues, count: tasks.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkRoot(rootArg(process.argv.slice(2)))
    .then((result) => { process.exitCode = result.ok ? 0 : 1; })
    .catch((error) => { console.error(`- ${error.message}`); process.exitCode = 1; });
}
