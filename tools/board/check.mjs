#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIELD_ORDER, LINES, STATUSES, TASK_ID_RE, loadPhases, loadTags, parseTask } from './lib/tasks.mjs';

async function taskFiles(root) {
  const base = path.join(path.resolve(root), 'docs', 'tasks');
  const files = [];
  const visit = async (directory) => {
    try {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.md')) files.push(path.join(directory, entry.name));
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  };
  for (const directory of ['inbox', ...LINES]) await visit(path.join(base, directory));
  for (const line of LINES) await visit(path.join(base, 'archive', line));
  return files.sort();
}

function relative(root, filePath) {
  return path.relative(path.resolve(root), filePath).replaceAll('\\', '/');
}

function taskProblems(task, context) {
  const issues = [];
  const add = (message) => issues.push(`${context.label}: ${message}`);
  for (const required of ['id', 'title', 'line', 'status', 'created']) {
    if (!Object.hasOwn(task, required) || task[required] === '') add(`缺少必填字段 ${required}`);
  }
  if (task.id && !TASK_ID_RE.test(task.id)) add(`id 格式非法：${task.id}`);
  if (task.id && task.id !== context.fileId) add(`id 与文件名不一致：${task.id} != ${context.fileId}`);
  if (task.title !== undefined && (typeof task.title !== 'string' || !task.title || /[\r\n]/.test(task.title))) add('title 必须是非空单行文本');
  for (const field of ['owner', 'source']) {
    if (task[field] !== undefined && (typeof task[field] !== 'string' || !task[field] || /[\r\n]/.test(task[field]))) add(`${field} 必须是非空单行文本`);
  }
  if (task.line !== undefined && ![...LINES, 'inbox'].includes(task.line)) add(`line 取值非法：${task.line}`);
  if (task.status !== undefined && !STATUSES.includes(task.status)) add(`status 取值非法：${task.status}`);
  if (context.archived && task.status !== 'done') add('archive 目录中的任务 status 必须是 done');
  if (!context.archived && task.status === 'done') add('活动目录中的任务 status 不能是 done');
  if (context.archived && task.line !== context.directoryLine) add(`line 与 archive 目录不一致：${task.line} != ${context.directoryLine}`);
  if (!context.archived && task.line !== context.directoryLine) add(`line 与所在目录不一致：${task.line} != ${context.directoryLine}`);
  if (task.line === 'inbox') {
    if (task.phase !== undefined) add('inbox 任务不能有 phase');
    if (task.priority !== undefined) add('inbox 任务不能有 priority');
    if (task.status !== 'todo') add('inbox 任务 status 必须是 todo');
  } else if (LINES.includes(task.line)) {
    if (!Number.isInteger(task.phase) || task.phase < 0 || task.phase > 9) add('入线任务 phase 必须是 0–9');
    if (!Number.isInteger(task.priority) || task.priority < 1) add('入线任务 priority 必须是正整数');
  }
  if (task.tags !== undefined && (!Array.isArray(task.tags) || task.tags.some((tag) => typeof tag !== 'string' || !tag))) add('tags 必须是非空字符串组成的内联列表');
  if (task.track !== undefined && task.track !== 'all' && !/^[A-F](?:\+[A-F])*$/.test(task.track)) add(`track 取值非法：${task.track}`);
  const validDate = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  };
  for (const field of ['due', 'created', 'completed']) {
    if (task[field] !== undefined && !validDate(task[field])) add(`${field} 必须是有效的 YYYY-MM-DD`);
  }
  if (context.archived && !task.completed) add('归档任务缺少 completed');
  if (!context.archived && task.completed) add('活动任务不能有 completed');
  if (typeof task.body !== 'string') add('正文必须是字符串');
  for (const key of Object.keys(task)) {
    if (key !== 'body' && !FIELD_ORDER.includes(key)) add(`未知字段 ${key}`);
  }
  return issues;
}

export async function checkRoot(root, { output = console.log } = {}) {
  const files = await taskFiles(root);
  if (!files.length) {
    output('无任务');
    return { ok: true, issues: [], count: 0 };
  }
  const issues = [];
  const parsed = [];
  for (const filePath of files) {
    const label = relative(root, filePath);
    try {
      const task = parseTask(await readFile(filePath, 'utf8'));
      const segments = label.split('/');
      const archived = segments.includes('archive');
      const directoryLine = archived ? segments.at(-2) : segments.at(-2);
      const context = { label, archived, directoryLine, fileId: path.basename(filePath, '.md') };
      issues.push(...taskProblems(task, context));
      parsed.push({ ...task, label, archived });
    } catch (error) {
      issues.push(`${label}: ${error.message}`);
    }
  }

  const idFiles = new Map();
  for (const task of parsed) {
    if (!task.id) continue;
    if (!idFiles.has(task.id)) idFiles.set(task.id, []);
    idFiles.get(task.id).push(task.label);
  }
  for (const [id, labels] of idFiles) if (labels.length > 1) issues.push(`id 重复 ${id}: ${labels.join(', ')}`);

  let tags = [];
  try {
    tags = await loadTags(root);
    const names = new Set();
    for (const tag of tags) {
      if (![...LINES, 'inbox'].includes(tag?.line)) issues.push(`tags.json: ${tag?.name ?? '?'} 的 line 无效`);
      if (!tag || typeof tag.name !== 'string' || !tag.name) issues.push('tags.json: 标签缺少 name');
      else if (names.has(`${tag.line}\0${tag.name}`)) issues.push(`tags.json: ${tag.line} 线标签名重复 ${tag.name}`);
      else names.add(`${tag.line}\0${tag.name}`);
      if (!/^#[0-9a-fA-F]{6}$/.test(tag?.color ?? '')) issues.push(`tags.json: ${tag?.name ?? '?'} 的 color 必须是六位十六进制色值`);
      if (!Number.isInteger(tag?.order) || tag.order < 1) issues.push(`tags.json: ${tag?.name ?? '?'} 的 order 必须是正整数`);
    }
    for (const line of ['inbox', ...LINES]) {
      const orders = tags.filter((tag) => tag.line === line).map((tag) => tag.order).sort((a, b) => a - b);
      if (orders.some((order, index) => order !== index + 1)) issues.push(`tags.json: ${line} 线 order 必须连续为 1..n`);
    }
  } catch (error) {
    issues.push(`docs/tasks/tags.json: ${error.message}`);
  }
  const tagNames = new Set(tags.map((tag) => `${tag.line}\0${tag.name}`));
  for (const task of parsed) {
    for (const tag of task.tags ?? []) if (!tagNames.has(`${task.line}\0${tag}`)) issues.push(`${task.label}: 引用了 ${task.line} 线不存在的标签 ${tag}`);
  }

  const phases = await loadPhases(root);
  for (const task of parsed) {
    if (!LINES.includes(task.line) || !Number.isInteger(task.phase) || task.phase === 9) continue;
    if (phases[task.line].length && !phases[task.line].some((item) => item.phase === task.phase)) {
      issues.push(`${task.label}: phase ${task.line}${task.phase} 不在 LINES.md 阶段表中`);
    }
  }

  for (const line of LINES) {
    const phaseNumbers = new Set(parsed.filter((task) => !task.archived && task.line === line && Number.isInteger(task.phase)).map((task) => task.phase));
    for (const phase of phaseNumbers) {
      const group = parsed.filter((task) => !task.archived && task.line === line && task.phase === phase);
      const priorities = group.map((task) => task.priority).filter(Number.isInteger).sort((a, b) => a - b);
      if (priorities.length !== group.length || priorities.some((priority, index) => priority !== index + 1)) {
        issues.push(`${line}${phase}: priority 必须连续唯一为 1..${group.length}，实际为 [${priorities.join(', ')}]`);
      }
    }
  }

  for (const issue of issues) output(`- ${issue}`);
  if (!issues.length) output(`检查通过：${parsed.length} 个任务`);
  return { ok: issues.length === 0, issues, count: parsed.length };
}

function parseRoot(args) {
  const index = args.indexOf('--root');
  if (index === -1) return process.cwd();
  if (!args[index + 1]) throw new Error('--root 缺少路径');
  return args[index + 1];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await checkRoot(parseRoot(process.argv.slice(2)));
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.error(`- ${error.message}`);
    process.exitCode = 1;
  }
}
