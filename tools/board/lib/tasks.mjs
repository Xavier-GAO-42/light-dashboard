import { randomBytes } from 'node:crypto';
import { open, readFile, readdir, rename, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';

export const STATUSES = ['todo', 'review', 'done'];
export const TASK_ID_RE = /^t-\d{8}-[a-z0-9]{4}$/;
export const FIELD_ORDER = ['id', 'title', 'status', 'owner', 'stream', 'due', 'created', 'completed'];

export class BoardError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const fail = (code, message) => { throw new BoardError(code, message); };
const tasksRoot = (root) => path.join(path.resolve(root), 'docs', 'tasks');
const activeRoot = (root) => path.join(tasksRoot(root), 'active');
const archiveRoot = (root) => path.join(tasksRoot(root), 'archive');

function singleLine(value, name, { optional = false } = {}) {
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) fail('INVALID_FIELD', `${name} 必须是非空单行文本`);
  return value.trim();
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function parseScalar(raw) {
  const value = raw.trim();
  if (value.startsWith('"')) {
    try { return JSON.parse(value); } catch { fail('INVALID_YAML', `无法解析字段值：${value}`); }
  }
  return value;
}

export function parseTask(text) {
  const normalized = String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) fail('INVALID_TASK', '缺少 YAML frontmatter');
  const end = normalized.indexOf('\n---\n', 4);
  if (end < 0) fail('INVALID_TASK', 'frontmatter 未闭合');
  const task = {};
  for (const line of normalized.slice(4, end).split('\n')) {
    if (!line.trim()) continue;
    const match = /^([a-z][a-zA-Z0-9_-]*):(?:\s*(.*))$/.exec(line);
    if (!match) fail('INVALID_YAML', `不支持的 frontmatter 行：${line}`);
    if (Object.hasOwn(task, match[1])) fail('INVALID_YAML', `字段重复：${match[1]}`);
    task[match[1]] = parseScalar(match[2]);
  }
  task.body = normalized.slice(end + 5);
  return task;
}

function formatScalar(value) {
  const text = String(value);
  return !text || /:\s|^\s|\s$|^[#\[{'"]/.test(text) ? JSON.stringify(text) : text;
}

export function serializeTask(task) {
  const lines = ['---'];
  for (const field of FIELD_ORDER) if (task[field] !== undefined) lines.push(`${field}: ${formatScalar(task[field])}`);
  lines.push('---', task.body ?? '');
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

function validate(task, { archived = false } = {}) {
  for (const field of ['id', 'title', 'status', 'created']) if (!task[field]) fail('INVALID_TASK', `缺少必填字段 ${field}`);
  if (!TASK_ID_RE.test(task.id)) fail('INVALID_ID', `id 格式无效：${task.id}`);
  singleLine(task.title, 'title');
  if (!STATUSES.includes(task.status)) fail('INVALID_STATUS', `status 无效：${task.status}`);
  for (const field of ['owner', 'stream']) if (task[field] !== undefined) singleLine(task[field], field);
  for (const field of ['due', 'created', 'completed']) if (task[field] !== undefined && !validDate(task[field])) fail('INVALID_DATE', `${field} 必须是有效的 YYYY-MM-DD`);
  for (const field of Object.keys(task)) if (field !== 'body' && !FIELD_ORDER.includes(field)) fail('UNKNOWN_FIELD', `未知字段：${field}`);
  if (archived && (task.status !== 'done' || !task.completed)) fail('INVALID_ARCHIVE', 'archive 中的任务必须是 done 且包含 completed');
  if (!archived && (task.status === 'done' || task.completed)) fail('INVALID_ACTIVE', 'active 中的任务不能是 done 或包含 completed');
  return task;
}

async function markdownFiles(directory) {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => path.join(directory, entry.name));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function loadAll(root) {
  const files = [
    ...(await markdownFiles(activeRoot(root))).map((filePath) => ({ filePath, archived: false })),
    ...(await markdownFiles(archiveRoot(root))).map((filePath) => ({ filePath, archived: true })),
  ];
  const tasks = [];
  for (const item of files) {
    const task = validate(parseTask(await readFile(item.filePath, 'utf8')), item);
    tasks.push({ ...task, ...item, relativePath: path.relative(path.resolve(root), item.filePath).replaceAll('\\', '/') });
  }
  return tasks.sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
}

async function atomicWrite(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  const handle = await open(temporary, 'wx');
  try { await handle.writeFile(content, 'utf8'); } finally { await handle.close(); }
  await rename(temporary, filePath);
}

async function withLock(root, action) {
  const directory = tasksRoot(root);
  const lockPath = path.join(directory, '.board.lock');
  await mkdir(directory, { recursive: true });
  let handle;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { handle = await open(lockPath, 'wx'); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  if (!handle) fail('BOARD_BUSY', '任务目录正被其他写操作占用');
  try { return await action(); }
  finally { await handle.close(); await unlink(lockPath).catch(() => {}); }
}

async function uniqueTask(root, id) {
  const matches = (await loadAll(root)).filter((task) => task.id === id);
  if (!matches.length) fail('NOT_FOUND', `任务不存在：${id}`);
  if (matches.length > 1) fail('DUPLICATE_ID', `任务 id 重复：${id}`);
  return matches[0];
}

function newId(date = today()) {
  return `t-${date.replaceAll('-', '')}-${randomBytes(3).toString('hex').slice(0, 4)}`;
}

export async function addTask(root, input) {
  return withLock(root, async () => {
    const created = today();
    let id;
    const existing = new Set((await loadAll(root)).map((task) => task.id));
    do { id = newId(created); } while (existing.has(id));
    const task = {
      id,
      title: singleLine(input.title, 'title'),
      status: 'todo',
      ...(input.owner ? { owner: singleLine(input.owner, 'owner') } : {}),
      ...(input.stream ? { stream: singleLine(input.stream, 'stream') } : {}),
      ...(input.due ? { due: input.due } : {}),
      created,
      body: `## Prompt\n${input.body?.trim() ? `\n${input.body.trim()}\n` : ''}`,
    };
    validate(task);
    const filePath = path.join(activeRoot(root), `${id}.md`);
    await atomicWrite(filePath, serializeTask(task));
    return { ...task, filePath, archived: false, relativePath: path.relative(path.resolve(root), filePath).replaceAll('\\', '/') };
  });
}

function appendSection(body, heading, text) {
  const base = String(body ?? '').replace(/\s+$/, '');
  return `${base}\n\n## ${heading}\n\n${singleLine(text, heading)}\n`;
}

export async function completeTask(root, id, feedback) {
  return withLock(root, async () => {
    const task = await uniqueTask(root, id);
    if (task.archived || task.status !== 'todo') fail('INVALID_TRANSITION', '只有 todo 任务可以提交审核');
    const next = { ...task, status: 'review', body: appendSection(task.body, '结果', feedback) };
    delete next.filePath; delete next.relativePath; delete next.archived;
    await atomicWrite(task.filePath, serializeTask(next));
    return next;
  });
}

export async function rejectTask(root, id, reason) {
  return withLock(root, async () => {
    const task = await uniqueTask(root, id);
    if (task.archived || task.status !== 'review') fail('INVALID_TRANSITION', '只有 review 任务可以打回');
    const next = { ...task, status: 'todo', body: appendSection(task.body, '打回', reason) };
    delete next.filePath; delete next.relativePath; delete next.archived;
    await atomicWrite(task.filePath, serializeTask(next));
    return next;
  });
}

export async function approveTask(root, id) {
  return withLock(root, async () => {
    const task = await uniqueTask(root, id);
    if (task.archived || task.status !== 'review') fail('INVALID_TRANSITION', '只有 review 任务可以归档');
    const next = { ...task, status: 'done', completed: today() };
    delete next.filePath; delete next.relativePath; delete next.archived;
    const destination = path.join(archiveRoot(root), `${id}.md`);
    await atomicWrite(destination, serializeTask(next));
    await unlink(task.filePath);
    return next;
  });
}
