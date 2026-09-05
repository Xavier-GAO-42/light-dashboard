#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { addTask, approveTask, BoardError, completeTask, loadAll, rejectTask } from './lib/tasks.mjs';

function args(raw) {
  const positionals = [];
  const flags = {};
  for (let index = 0; index < raw.length; index += 1) {
    const value = raw[index];
    if (!value.startsWith('--')) { positionals.push(value); continue; }
    const name = value.slice(2);
    if (name === 'json') { flags.json = true; continue; }
    if (!raw[index + 1] || raw[index + 1].startsWith('--')) throw new BoardError('INVALID_ARGUMENT', `--${name} 缺少值`);
    flags[name] = raw[++index];
  }
  return { positionals, flags };
}

function required(flags, name) {
  if (!flags[name]) throw new BoardError('INVALID_ARGUMENT', `缺少 --${name}`);
  return flags[name];
}

function print(tasks) {
  console.log(['id'.padEnd(20), 'status'.padEnd(8), 'stream'.padEnd(22), 'owner'.padEnd(14), 'title'].join('  '));
  for (const task of tasks) console.log([
    task.id.padEnd(20), task.status.padEnd(8), String(task.stream ?? '-').slice(0, 22).padEnd(22),
    String(task.owner ?? '-').slice(0, 14).padEnd(14), task.title,
  ].join('  '));
}

async function run(raw) {
  const { positionals, flags } = args(raw);
  const root = path.resolve(flags.root ?? process.cwd());
  delete flags.root;
  const command = positionals[0];
  if (!command) throw new BoardError('INVALID_ARGUMENT', '缺少命令');

  if (command === 'list') {
    let tasks = await loadAll(root);
    if (flags.status) tasks = tasks.filter((task) => task.status === flags.status);
    if (flags.stream) tasks = tasks.filter((task) => task.stream === flags.stream);
    if (flags.owner) tasks = tasks.filter((task) => task.owner === flags.owner);
    if (flags.json) console.log(JSON.stringify(tasks, null, 2)); else print(tasks);
    return;
  }

  if (command === 'show') {
    const id = positionals[1];
    if (!id) throw new BoardError('INVALID_ARGUMENT', 'show 缺少 id');
    const matches = (await loadAll(root)).filter((task) => task.id === id);
    if (!matches.length) throw new BoardError('NOT_FOUND', `任务不存在：${id}`);
    if (matches.length > 1) throw new BoardError('DUPLICATE_ID', `任务 id 重复：${id}`);
    console.log(JSON.stringify(matches[0], null, 2));
    return;
  }

  if (command === 'add') {
    const body = flags['body-file'] ? await readFile(path.resolve(flags['body-file']), 'utf8') : '';
    const task = await addTask(root, { title: required(flags, 'title'), owner: flags.owner, stream: flags.stream, due: flags.due, body });
    console.log(flags.json ? JSON.stringify(task, null, 2) : task.id);
    return;
  }

  const id = positionals[1];
  if (!id) throw new BoardError('INVALID_ARGUMENT', `${command} 缺少 id`);
  if (command === 'done') console.log(`${id} ${(await completeTask(root, id, required(flags, 'feedback'))).status}`);
  else if (command === 'reject') console.log(`${id} ${(await rejectTask(root, id, required(flags, 'reason'))).status}`);
  else if (command === 'approve') console.log(`${id} ${(await approveTask(root, id)).status}`);
  else throw new BoardError('INVALID_ARGUMENT', `未知命令：${command}`);
}

run(process.argv.slice(2)).catch((error) => {
  console.error(`${error.code ?? 'ERROR'}: ${error.message}`);
  process.exitCode = 1;
});
