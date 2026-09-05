#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BoardError, addTask, approveTask, completeTask, createTag, deleteTask, loadAll,
  loadTags, moveTask, rejectTask, renameTag, reorder, unarchiveTask, updateTask,
} from './lib/tasks.mjs';

function parseArgs(args) {
  const positionals = [];
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (!item.startsWith('--')) {
      positionals.push(item);
      continue;
    }
    const name = item.slice(2);
    if (['json', 'yes'].includes(name)) {
      flags[name] = true;
      continue;
    }
    if (index + 1 >= args.length || args[index + 1].startsWith('--')) throw new BoardError('INVALID_ARGUMENT', `--${name} 缺少值`);
    flags[name] = args[++index];
  }
  return { positionals, flags };
}

function required(flags, name) {
  if (!Object.hasOwn(flags, name) || flags[name] === '') throw new BoardError('INVALID_ARGUMENT', `缺少 --${name}`);
  return flags[name];
}

// Each line takes tasks directly; inbox is the reminder box, not a staging area.
// Making --line explicit stops «I lack the permission» from becoming the default.
function requiredLine(flags) {
  if (!flags.line) throw new BoardError('INVALID_ARGUMENT', '缺少 --line：任务直接建到 L / G / P / R 中它所属的那条线；只有归属拿不准、或它还算不上一个任务时才用 inbox');
  return flags.line;
}

function csv(value) {
  if (value === undefined) return undefined;
  return value === '' ? [] : value.split(',').map((item) => item.trim()).filter(Boolean);
}

async function fileOption(flags, direct, file) {
  if (flags[direct] !== undefined && flags[file] !== undefined) throw new BoardError('INVALID_ARGUMENT', `--${direct} 与 --${file} 不能同时使用`);
  if (flags[file] !== undefined) return readFile(path.resolve(flags[file]), 'utf8');
  return flags[direct];
}

function width(value, size) {
  const text = String(value ?? '');
  return text.length > size ? `${text.slice(0, size - 1)}…` : text.padEnd(size);
}

function printTable(tasks) {
  console.log(['id'.padEnd(20), '线/阶段/优先级'.padEnd(12), 'status'.padEnd(8), 'owner'.padEnd(10), 'due'.padEnd(10), 'title'].join('  '));
  for (const task of tasks) {
    const place = task.line === 'inbox' ? 'inbox' : `${task.line}${task.phase}/${task.priority}`;
    console.log([width(task.id, 20), width(place, 12), width(task.status, 8), width(task.owner, 10), width(task.due, 10), task.title].join('  '));
  }
}

async function run(rawArgs) {
  const { positionals, flags } = parseArgs(rawArgs);
  const root = path.resolve(flags.root ?? process.cwd());
  delete flags.root;
  const command = positionals[0];
  if (!command) throw new BoardError('INVALID_ARGUMENT', '缺少命令');

  if (command === 'list') {
    if (flags.line && !['inbox', 'L', 'G', 'P', 'R'].includes(flags.line)) throw new BoardError('INVALID_ARGUMENT', `line 无效：${flags.line}`);
    if (flags.phase !== undefined && (!Number.isInteger(Number(flags.phase)) || Number(flags.phase) < 0 || Number(flags.phase) > 9)) throw new BoardError('INVALID_ARGUMENT', 'phase 必须是 0–9');
    if (flags.status && !['todo', 'review', 'done'].includes(flags.status)) throw new BoardError('INVALID_ARGUMENT', `status 无效：${flags.status}`);
    let tasks = await loadAll(root);
    if (flags.line) tasks = tasks.filter((task) => task.line === flags.line);
    if (flags.phase !== undefined) tasks = tasks.filter((task) => task.phase === Number(flags.phase));
    if (flags.status) tasks = tasks.filter((task) => task.status === flags.status);
    if (flags.tag) tasks = tasks.filter((task) => (task.tags ?? []).includes(flags.tag));
    tasks.sort((a, b) => a.line.localeCompare(b.line) || (a.phase ?? -1) - (b.phase ?? -1) || (a.priority ?? 0) - (b.priority ?? 0));
    if (flags.json) console.log(JSON.stringify(tasks, null, 2));
    else printTable(tasks);
    return;
  }

  if (command === 'show') {
    const id = positionals[1];
    if (!id) throw new BoardError('INVALID_ARGUMENT', 'show 缺少 id');
    const matches = (await loadAll(root)).filter((item) => item.id === id);
    if (!matches.length) throw new BoardError('NOT_FOUND', `任务不存在：${id}`, 404);
    if (matches.length > 1) throw new BoardError('DUPLICATE_ID', `任务 id 重复：${id}`, 409);
    const [task] = matches;
    console.log(JSON.stringify(task, null, 2));
    return;
  }

  if (command === 'add') {
    const body = await fileOption(flags, 'body', 'body-file');
    const input = {
      title: required(flags, 'title'),
      line: requiredLine(flags),
      ...(flags.phase !== undefined ? { phase: Number(flags.phase) } : {}),
      ...(flags.tags !== undefined ? { tags: csv(flags.tags) } : {}),
      ...(flags.owner ? { owner: flags.owner } : {}), ...(flags.track ? { track: flags.track } : {}),
      ...(flags.due ? { due: flags.due } : {}), ...(flags.source ? { source: flags.source } : {}),
      ...(body !== undefined ? { body } : {}),
    };
    const task = await addTask(root, input);
    if (flags.json) console.log(JSON.stringify(task, null, 2));
    else console.log(task.id);
    return;
  }

  const id = positionals[1];
  if (!id) throw new BoardError('INVALID_ARGUMENT', `${command} 缺少 id`);
  if (command === 'set') {
    const patch = {};
    for (const name of ['title', 'owner', 'track', 'due', 'source']) if (flags[name] !== undefined) patch[name] = flags[name];
    if (flags.tags !== undefined) patch.tags = csv(flags.tags);
    if (flags['body-file'] !== undefined) patch.prompt = await readFile(path.resolve(flags['body-file']), 'utf8');
    const task = await updateTask(root, id, patch);
    console.log(task.id);
    return;
  }
  if (command === 'move') {
    const line = required(flags, 'line');
    let requested;
    if (flags.priority !== undefined) {
      if (line === 'inbox') throw new BoardError('INVALID_ARGUMENT', 'inbox 不能指定 priority');
      requested = Number(flags.priority);
      const targetSize = (await loadAll(root)).filter((item) => !item.archived && item.line === line && item.phase === Number(flags.phase) && item.id !== id).length + 1;
      if (!Number.isInteger(requested) || requested < 1 || requested > targetSize) throw new BoardError('INVALID_ARGUMENT', `priority 必须是 1–${targetSize}`);
    }
    let task = await moveTask(root, id, line, flags.phase);
    if (requested !== undefined) {
      const group = (await loadAll(root)).filter((item) => !item.archived && item.line === line && item.phase === Number(flags.phase)).sort((a, b) => a.priority - b.priority);
      const ids = group.filter((item) => item.id !== id).map((item) => item.id);
      ids.splice(requested - 1, 0, id);
      await reorder(root, line, Number(flags.phase), ids);
      task = (await loadAll(root)).find((item) => item.id === id);
    }
    console.log(`${task.id} ${task.line}${task.phase ?? ''}/${task.priority ?? '-'}`);
    return;
  }
  if (command === 'done') {
    const feedback = await fileOption(flags, 'feedback', 'feedback-file');
    if (feedback === undefined) throw new BoardError('INVALID_ARGUMENT', '缺少 --feedback 或 --feedback-file');
    const task = await completeTask(root, id, feedback);
    console.log(`${task.id} review`);
    return;
  }
  if (command === 'approve') {
    const task = await approveTask(root, id);
    console.log(`${task.id} done`);
    return;
  }
  if (command === 'reject') {
    const task = await rejectTask(root, id, required(flags, 'reason'));
    console.log(`${task.id} todo`);
    return;
  }
  if (command === 'unarchive') {
    const task = await unarchiveTask(root, id);
    console.log(`${task.id} review`);
    return;
  }
  if (command === 'delete') {
    if (!flags.yes) throw new BoardError('CONFIRM_REQUIRED', '删除任务必须加 --yes');
    await deleteTask(root, id);
    console.log(`已删除 ${id}`);
    return;
  }
  throw new BoardError('INVALID_ARGUMENT', `未知命令：${command}`);
}

async function runTag(rawArgs) {
  const { positionals, flags } = parseArgs(rawArgs);
  const root = path.resolve(flags.root ?? process.cwd());
  const action = positionals[1];
  if (action === 'list') {
    let tags = await loadTags(root);
    if (flags.line) tags = tags.filter((tag) => tag.line === flags.line);
    console.log(JSON.stringify(tags.sort((a, b) => a.line.localeCompare(b.line) || a.order - b.order), null, 2));
  } else if (action === 'create') {
    const tag = await createTag(root, required(flags, 'line'), positionals[2], required(flags, 'color'));
    console.log(tag.name);
  } else if (action === 'rename') {
    const tag = await renameTag(root, required(flags, 'line'), positionals[2], positionals[3]);
    console.log(tag.name);
  } else {
    throw new BoardError('INVALID_ARGUMENT', `未知标签命令：${action ?? ''}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args[0] === 'tag') await runTag(args);
    else await run(args);
  } catch (error) {
    console.error(`${error.code ?? 'ERROR'}: ${error.message}`);
    process.exitCode = 1;
  }
}
