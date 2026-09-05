import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const FIELD_ORDER = [
  'id', 'title', 'line', 'phase', 'priority', 'status', 'owner', 'track',
  'tags', 'due', 'created', 'completed', 'source',
];
export const TASK_ID_RE = /^t-\d{8}-[a-z0-9]{4}$/;
export const LINES = ['L', 'G', 'P', 'R'];
export const STATUSES = ['todo', 'review', 'done'];

export function taskMatchesQuery(task, query) {
  const needle = String(query ?? '').trim().toLocaleLowerCase();
  if (!needle) return true;
  const haystack = [task.title, task.body, task.owner, task.track, ...(task.tags ?? [])]
    .filter((value) => value !== undefined && value !== null)
    .join(' ')
    .toLocaleLowerCase();
  return haystack.includes(needle);
}

export class BoardError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'BoardError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status) {
  throw new BoardError(code, message, status);
}

function splitInlineList(value) {
  const inner = value.slice(1, -1).trim();
  if (!inner) return [];
  const items = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  for (let i = 0; i <= inner.length; i += 1) {
    const char = inner[i];
    if (i === inner.length || (char === ',' && !quoted)) {
      const raw = inner.slice(start, i).trim();
      if (!raw) fail('INVALID_FRONTMATTER', '列表中不能有空项');
      items.push(parseScalar(raw));
      start = i + 1;
      continue;
    }
    if (escaped) {
      escaped = false;
    } else if (char === '\\' && quoted) {
      escaped = true;
    } else if (char === '"') {
      quoted = !quoted;
    }
  }
  if (quoted) fail('INVALID_FRONTMATTER', '列表中的引号未闭合');
  return items.map((item) => String(item));
}

function parseScalar(value) {
  if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed !== 'string') fail('INVALID_FRONTMATTER', `不是字符串：${value}`);
      return parsed;
    } catch (error) {
      if (error instanceof BoardError) throw error;
      fail('INVALID_FRONTMATTER', `双引号值无效：${value}`);
    }
  }
  if (value.startsWith('[')) {
    if (!value.endsWith(']')) fail('INVALID_FRONTMATTER', `列表未闭合：${value}`);
    return splitInlineList(value);
  }
  if (value.includes(': ') || /^[#{"']/.test(value)) {
    fail('INVALID_FRONTMATTER', `该值按规格必须使用双引号：${value}`);
  }
  return value;
}

function quoteScalar(value) {
  const text = String(value);
  if (text.includes(': ') || /^[#\[{"']/.test(text)) return JSON.stringify(text);
  return text;
}

function serializeValue(value) {
  if (Array.isArray(value)) return `[${value.map(quoteScalar).join(', ')}]`;
  return quoteScalar(value);
}

export function parseTask(text) {
  if (typeof text !== 'string') fail('INVALID_FRONTMATTER', '任务内容必须是字符串');
  const opening = /^---\r?\n/.exec(text);
  if (!opening) fail('INVALID_FRONTMATTER', '缺少 frontmatter 起始分隔线');
  const remainder = text.slice(opening[0].length);
  const closing = /\r?\n---\r?\n/.exec(remainder);
  if (!closing) fail('INVALID_FRONTMATTER', '缺少 frontmatter 结束分隔线');
  const frontmatter = remainder.slice(0, closing.index).replace(/\r\n/g, '\n');
  const body = remainder.slice(closing.index + closing[0].length);
  const task = { body };
  for (const line of frontmatter.split('\n')) {
    if (!line.trim()) fail('INVALID_FRONTMATTER', 'frontmatter 中不能有空行');
    const match = /^([a-z][a-z0-9_]*):(?: (.*))?$/.exec(line);
    if (!match) fail('INVALID_FRONTMATTER', `无法解析 frontmatter 行：${line}`);
    const [, key, raw = ''] = match;
    if (!FIELD_ORDER.includes(key)) fail('INVALID_FRONTMATTER', `未知字段：${key}`);
    if (Object.hasOwn(task, key)) fail('INVALID_FRONTMATTER', `字段重复：${key}`);
    let value = parseScalar(raw);
    if (key === 'phase' || key === 'priority') {
      if (!/^\d+$/.test(String(value))) fail('INVALID_FRONTMATTER', `${key} 必须是整数`);
      value = Number(value);
    }
    if (key === 'tags' && !Array.isArray(value)) fail('INVALID_FRONTMATTER', 'tags 必须是内联列表');
    if (key !== 'tags' && Array.isArray(value)) fail('INVALID_FRONTMATTER', `${key} 不能是列表`);
    task[key] = value;
  }
  return task;
}

export function serializeTask(task) {
  const lines = ['---'];
  for (const field of FIELD_ORDER) {
    if (!Object.hasOwn(task, field) || task[field] === undefined || task[field] === null || task[field] === '') continue;
    lines.push(`${field}: ${serializeValue(task[field])}`);
  }
  lines.push('---');
  return `${lines.join('\n')}\n${task.body ?? ''}`;
}

function tasksRoot(root) {
  return path.join(path.resolve(root), 'docs', 'tasks');
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
  const base = tasksRoot(root);
  const files = [];
  for (const directory of ['inbox', ...LINES]) files.push(...await markdownFiles(path.join(base, directory)));
  for (const line of LINES) files.push(...await markdownFiles(path.join(base, 'archive', line)));
  const tasks = [];
  for (const filePath of files.sort()) {
    const task = parseTask(await readFile(filePath, 'utf8'));
    tasks.push({ ...task, filePath, archived: filePath.includes(`${path.sep}archive${path.sep}`) });
  }
  return tasks;
}

export async function loadTags(root) {
  const filePath = path.join(tasksRoot(root), 'tags.json');
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    if (!parsed || !Array.isArray(parsed.tags)) fail('INVALID_TAGS', 'tags.json 必须包含 tags 数组');
    return parsed.tags.map((tag) => ({ line: tag.line, name: tag.name, color: tag.color, order: tag.order }));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    if (error instanceof BoardError) throw error;
    if (error instanceof SyntaxError) fail('INVALID_TAGS', `tags.json 不是有效 JSON：${error.message}`);
    throw error;
  }
}

const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const LOCK_STALE_MS = 20000;
const LOCK_TIMEOUT_MS = 15000;
const LOCK_POLL_MS = 25;

function delay(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// Windows briefly denies rename while another process, an indexer or a virus
// scanner still holds the destination; the write itself already succeeded.
async function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      if (attempt >= 4 || !RENAME_RETRY_CODES.has(error.code)) throw error;
      await delay(20 * (attempt + 1));
    }
  }
}

async function atomicWrite(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(tempPath, content, { encoding: 'utf8', flag: 'wx' });
    await renameWithRetry(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

// A task changes directory by rename, never by write-then-unlink: at every
// instant exactly one file carries the id, so a crash can never leave two.
async function moveFile(from, to) {
  if (from === to) return;
  await mkdir(path.dirname(to), { recursive: true });
  await renameWithRetry(from, to);
}

function lockFile(root) {
  return path.join(tasksRoot(root), '.board.lock');
}

async function lockAgeMs(file) {
  try {
    return Date.now() - (await stat(file)).mtimeMs;
  } catch {
    return null;
  }
}

// Every write is a read-modify-write over several files, and one approve or
// move rewrites the whole phase group. The lock file is the only cross-process
// mutex available without a dependency; it holds no state and is deleted on
// release, so docs/tasks/*.md stays the single truth.
async function acquireLock(root) {
  const file = lockFile(root);
  await mkdir(path.dirname(file), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      await writeFile(file, `${process.pid} ${new Date().toISOString()}\n`, { encoding: 'utf8', flag: 'wx' });
      return file;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const age = await lockAgeMs(file);
      if (age === null) continue;
      if (age > LOCK_STALE_MS) {
        await unlink(file).catch(() => {});
        continue;
      }
      if (Date.now() > deadline) fail('LOCKED', '任务目录正被另一个写入者占用，请稍后重试', 409);
      await delay(LOCK_POLL_MS);
    }
  }
}

async function withLock(root, run) {
  const file = await acquireLock(root);
  try {
    return await run();
  } finally {
    await unlink(file).catch(() => {});
  }
}

// Wraps an unlocked writer. Never call one wrapped function from inside
// another: the lock is not reentrant.
function locked(fn) {
  return (root, ...rest) => withLock(root, () => fn(root, ...rest));
}

export async function saveTags(root, tags) {
  await atomicWrite(path.join(tasksRoot(root), 'tags.json'), `${JSON.stringify({ tags }, null, 2)}\n`);
}

export async function loadPhases(root) {
  const result = { L: [], G: [], P: [], R: [] };
  let text;
  try {
    text = await readFile(path.join(tasksRoot(root), 'LINES.md'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return result;
    throw error;
  }
  for (const rawLine of text.replace(/\r\n/g, '\n').split('\n')) {
    const cells = rawLine.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 3) continue;
    const match = /^([LGPR])(\d)$/.exec(cells[0]);
    if (!match || !/^\d{4}-\d{2}-\d{2}$/.test(cells[1])) continue;
    result[match[1]].push({ phase: Number(match[2]), due: cells[1], minimum: cells.slice(2).join(' | ') });
  }
  return result;
}

function isoDate(date = new Date()) {
  if (typeof date === 'string') {
    if (!validDate(date)) fail('INVALID_DATE', `日期格式无效：${date}`);
    return date;
  }
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) fail('INVALID_DATE', '日期无效');
  return date.toISOString().slice(0, 10);
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function newId(date = new Date(), existingIds = []) {
  const compact = isoDate(date).replaceAll('-', '');
  const used = existingIds instanceof Set ? existingIds : new Set(existingIds);
  for (let attempt = 0; attempt < 1024; attempt += 1) {
    const bytes = randomBytes(4);
    let suffix = '';
    for (const byte of bytes) suffix += (byte % 36).toString(36);
    const id = `t-${compact}-${suffix}`;
    if (!used.has(id)) return id;
  }
  fail('ID_COLLISION', '无法生成不冲突的任务 id', 409);
}

function plainTask(task) {
  const result = {};
  for (const field of FIELD_ORDER) if (Object.hasOwn(task, field)) result[field] = task[field];
  result.body = task.body ?? '';
  return result;
}

function taskFile(root, task, archived = false) {
  const base = tasksRoot(root);
  return archived
    ? path.join(base, 'archive', task.line, `${task.id}.md`)
    : path.join(base, task.line, `${task.id}.md`);
}

function validateText(field, value, required = false) {
  if ((value === undefined || value === null || value === '') && !required) return;
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) fail('INVALID_FIELD', `${field} 必须是非空单行文本`);
}

function validateDateField(field, value) {
  if (value === undefined) return;
  if (!validDate(value)) {
    fail('INVALID_FIELD', `${field} 必须是 YYYY-MM-DD`);
  }
}

async function validateTask(root, task, { archived = false, tags = null, phases = null } = {}) {
  if (!TASK_ID_RE.test(task.id ?? '')) fail('INVALID_ID', 'id 格式无效');
  validateText('title', task.title, true);
  if (![...LINES, 'inbox'].includes(task.line)) fail('INVALID_LINE', `line 无效：${task.line}`);
  if (!STATUSES.includes(task.status)) fail('INVALID_STATUS', `status 无效：${task.status}`);
  if (archived && task.status !== 'done') fail('INVALID_STATUS', '归档目录中的任务必须是 done');
  if (!archived && task.status === 'done') fail('INVALID_STATUS', '活动目录中的任务不能是 done');
  if (task.line === 'inbox') {
    if (task.phase !== undefined || task.priority !== undefined) fail('INVALID_FIELD', 'inbox 任务不能有 phase 或 priority');
    if (archived) fail('INVALID_LINE', 'inbox 任务不能归档');
    if (task.status !== 'todo') fail('INVALID_STATE', 'inbox 只接受待完成任务');
  } else {
    if (!Number.isInteger(task.phase) || task.phase < 0 || task.phase > 9) fail('INVALID_PHASE', '入线任务 phase 必须是 0–9');
    if (!Number.isInteger(task.priority) || task.priority < 1) fail('INVALID_PRIORITY', '入线任务 priority 必须是正整数');
  }
  validateText('owner', task.owner);
  validateText('track', task.track);
  validateText('source', task.source);
  if (task.track !== undefined && task.track !== 'all' && !/^[A-F](?:\+[A-F])*$/.test(task.track)) fail('INVALID_FIELD', 'track 必须是 A–F、组合值或 all');
  if (!Array.isArray(task.tags ?? [])) fail('INVALID_TAGS', 'tags 必须是数组');
  if ((task.tags ?? []).some((tag) => typeof tag !== 'string' || !tag)) fail('INVALID_TAGS', '标签名必须是非空字符串');
  validateDateField('due', task.due);
  validateDateField('created', task.created);
  validateDateField('completed', task.completed);
  if (!task.created) fail('INVALID_FIELD', 'created 为必填字段');
  if (archived && !task.completed) fail('INVALID_FIELD', '归档任务必须有 completed');
  if (typeof (task.body ?? '') !== 'string') fail('INVALID_FIELD', '正文必须是字符串');
  if (tags === null) tags = await loadTags(root);
  const names = new Set(tags.filter((tag) => tag.line === task.line).map((tag) => tag.name));
  for (const tag of task.tags ?? []) if (!names.has(tag)) fail('UNKNOWN_TAG', `标签不存在：${tag}`);
  if (task.line !== 'inbox' && task.phase !== 9) {
    if (phases === null) phases = await loadPhases(root);
    if (phases[task.line].length && !phases[task.line].some((item) => item.phase === task.phase)) {
      fail('UNKNOWN_PHASE', `${task.line}${task.phase} 不在 LINES.md 中`);
    }
  }
}

function findTask(tasks, id) {
  const matches = tasks.filter((task) => task.id === id);
  if (!matches.length) fail('NOT_FOUND', `任务不存在：${id}`, 404);
  if (matches.length > 1) fail('DUPLICATE_ID', `任务 id 重复：${id}`, 409);
  return matches[0];
}

const HISTORY_HEADING_RE = /^## (?:结果|打回|反馈)\s*$/m;

// The «## 结果 / ## 打回» chain grows for the life of a task: every completion
// and every rejection appends one more entry, and none is ever overwritten.
// This is the only parser for it — the board renders what it returns.
export function taskHistory(body) {
  const text = String(body ?? '').replace(/\r\n/g, '\n');
  const marks = [];
  const re = /^## (结果|打回|反馈)[ \t]*$/gm;
  for (let match = re.exec(text); match; match = re.exec(text)) {
    marks.push({ title: match[1], start: match.index, end: re.lastIndex });
  }
  return marks.map((mark, index) => ({
    title: mark.title,
    text: text.slice(mark.end, index + 1 < marks.length ? marks[index + 1].start : text.length).trim(),
  }));
}

export function taskPrompt(body) {
  const text = String(body ?? '');
  const history = HISTORY_HEADING_RE.exec(text);
  const content = text.slice(0, history ? history.index : text.length);
  // A model may put its plan before Prompt. It is still part of the task MD.
  return content.replace(/^## Prompt[ \t]*\r?$/m, '').trim();
}

function withTaskPrompt(body, prompt) {
  const text = String(body ?? '');
  const heading = /^## Prompt\s*$/m.exec(text);
  const searchFrom = heading ? heading.index + heading[0].length : 0;
  const history = HISTORY_HEADING_RE.exec(text.slice(searchFrom));
  const suffix = history ? text.slice(searchFrom + history.index).trimStart() : '';
  const section = `## Prompt\n\n${String(prompt ?? '').trim()}`.trimEnd();
  return `${section}${suffix ? `\n\n${suffix}` : ''}\n`;
}

function groupTasks(tasks, line, phase, exceptId = null) {
  return tasks
    .filter((task) => !task.archived && task.line === line && task.phase === phase && task.id !== exceptId)
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

async function writeTask(task, filePath = task.filePath) {
  await atomicWrite(filePath, serializeTask(plainTask(task)));
}

async function rewritePriorities(tasks) {
  const changed = [];
  tasks.forEach((task, index) => {
    const priority = index + 1;
    if (task.priority !== priority) changed.push({ ...task, priority });
  });
  for (const task of changed) await writeTask(task);
}

async function addTaskUnlocked(root, input) {
  const tasks = await loadAll(root);
  const tags = await loadTags(root);
  const phases = await loadPhases(root);
  const created = input.created ?? isoDate();
  const line = input.line ?? 'inbox';
  const task = {
    id: input.id ?? newId(created, tasks.map((item) => item.id)),
    title: input.title,
    line,
    status: 'todo',
    ...(input.owner ? { owner: input.owner } : {}),
    ...(input.track ? { track: input.track } : {}),
    ...(input.tags !== undefined ? { tags: input.tags } : {}),
    ...(input.due ? { due: input.due } : {}),
    created,
    ...(input.source ? { source: input.source } : {}),
    body: withTaskPrompt('', input.prompt ?? input.body ?? ''),
  };
  if (line !== 'inbox') {
    task.phase = Number(input.phase);
    task.priority = groupTasks(tasks, line, task.phase).length + 1;
  }
  await validateTask(root, task, { tags, phases });
  const filePath = taskFile(root, task);
  if (tasks.some((item) => item.id === task.id)) fail('DUPLICATE_ID', `任务 id 已存在：${task.id}`, 409);
  await writeTask(task, filePath);
  return { ...task, filePath, archived: false };
}

async function updateTaskUnlocked(root, id, patch) {
  const tasks = await loadAll(root);
  const current = findTask(tasks, id);
  const allowed = new Set(['title', 'owner', 'track', 'tags', 'due', 'source', 'prompt', 'body']);
  for (const key of Object.keys(patch)) if (!allowed.has(key)) fail('INVALID_FIELD', `不能直接修改字段：${key}`);
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'prompt' || key === 'body') continue;
    if (['owner', 'track', 'due', 'source'].includes(key) && (value === '' || value === null)) delete next[key];
    else next[key] = value;
  }
  if (Object.hasOwn(patch, 'prompt') || Object.hasOwn(patch, 'body')) {
    next.body = withTaskPrompt(current.body, patch.prompt ?? patch.body);
  }
  await validateTask(root, next, { archived: current.archived });
  await writeTask(next);
  return next;
}

async function moveTaskUnlocked(root, id, line, phase) {
  const tasks = await loadAll(root);
  const current = findTask(tasks, id);
  if (current.archived) fail('INVALID_STATE', '归档任务不能移动，请先取消归档');
  if (![...LINES, 'inbox'].includes(line)) fail('INVALID_LINE', `line 无效：${line}`);
  const targetPhase = line === 'inbox' ? undefined : Number(phase);
  const tags = await loadTags(root);
  const allowedTags = new Set(tags.filter((tag) => tag.line === line).map((tag) => tag.name));
  const next = { ...current, line, tags: (current.tags ?? []).filter((tag) => allowedTags.has(tag)) };
  if (line === 'inbox') {
    delete next.phase;
    delete next.priority;
  } else {
    next.phase = targetPhase;
    next.priority = groupTasks(tasks, line, targetPhase, id).length + 1;
  }
  await validateTask(root, next);
  const oldGroup = current.line === 'inbox' ? [] : groupTasks(tasks, current.line, current.phase, id);
  const destination = taskFile(root, next);
  await writeTask(next, current.filePath);
  await moveFile(current.filePath, destination);
  await rewritePriorities(oldGroup);
  return { ...next, filePath: destination, archived: false };
}

async function reorderUnlocked(root, line, phase, ids) {
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length) fail('INVALID_ORDER', 'ids 必须是无重复数组');
  if (!LINES.includes(line)) fail('INVALID_LINE', '只有 L/G/P/R 的阶段组可以排序');
  if (!Number.isInteger(Number(phase)) || Number(phase) < 0 || Number(phase) > 9) fail('INVALID_PHASE', 'phase 必须是 0–9');
  const tasks = await loadAll(root);
  const targetPhase = Number(phase);
  const group = groupTasks(tasks, line, targetPhase);
  const expected = new Set(group.map((task) => task.id));
  if (ids.length !== group.length || ids.some((id) => !expected.has(id))) fail('INVALID_ORDER', 'ids 必须完整覆盖目标组');
  const byId = new Map(group.map((task) => [task.id, task]));
  const ordered = ids.map((id) => byId.get(id));
  await rewritePriorities(ordered);
  return ordered.map((task, index) => ({ ...task, priority: index + 1 }));
}

function appendHistory(body, title, text) {
  const normalized = withTaskPrompt(body, taskPrompt(body)).trimEnd();
  return `${normalized}\n\n## ${title}\n\n${text.trim()}\n`;
}

async function completeTaskUnlocked(root, id, feedback) {
  validateText('feedback', feedback, true);
  const tasks = await loadAll(root);
  const current = findTask(tasks, id);
  if (current.archived || current.status !== 'todo') fail('INVALID_STATE', '只有待完成任务可以提交审核', 409);
  if (current.line === 'inbox') fail('INVALID_STATE', 'inbox 任务必须先移入一条线', 409);
  const next = { ...current, status: 'review', body: appendHistory(current.body, '结果', feedback) };
  await validateTask(root, next);
  await writeTask(next);
  return next;
}

async function approveTaskUnlocked(root, id, date = new Date()) {
  const tasks = await loadAll(root);
  const current = findTask(tasks, id);
  if (current.archived || current.status !== 'review') fail('INVALID_STATE', '只有待审核任务可以通过', 409);
  const next = { ...current, status: 'done', completed: isoDate(date) };
  await validateTask(root, next, { archived: true });
  const destination = taskFile(root, next, true);
  const oldGroup = groupTasks(tasks, current.line, current.phase, id);
  await writeTask(next, current.filePath);
  await moveFile(current.filePath, destination);
  await rewritePriorities(oldGroup);
  return { ...next, filePath: destination, archived: true };
}

async function rejectTaskUnlocked(root, id, reason) {
  validateText('reason', reason, true);
  const tasks = await loadAll(root);
  const current = findTask(tasks, id);
  if (current.archived || current.status !== 'review') fail('INVALID_STATE', '只有待审核任务可以打回', 409);
  const next = { ...current, status: 'todo', body: appendHistory(current.body, '打回', reason) };
  await validateTask(root, next);
  await writeTask(next);
  return next;
}

async function unarchiveTaskUnlocked(root, id) {
  const tasks = await loadAll(root);
  const current = findTask(tasks, id);
  if (!current.archived || current.status !== 'done') fail('INVALID_STATE', '只有已归档任务可以取消归档', 409);
  const next = { ...current, status: 'review', priority: groupTasks(tasks, current.line, current.phase).length + 1 };
  delete next.completed;
  await validateTask(root, next);
  const destination = taskFile(root, next);
  await writeTask(next, current.filePath);
  await moveFile(current.filePath, destination);
  return { ...next, filePath: destination, archived: false };
}

async function deleteTaskUnlocked(root, id) {
  const tasks = await loadAll(root);
  const current = findTask(tasks, id);
  const oldGroup = current.archived || current.line === 'inbox' ? [] : groupTasks(tasks, current.line, current.phase, id);
  await unlink(current.filePath);
  await rewritePriorities(oldGroup);
  return current;
}

function validateTag(line, name, color) {
  if (![...LINES, 'inbox'].includes(line)) fail('INVALID_LINE', `line 无效：${line}`);
  validateText('标签名', name, true);
  if (name.includes(',')) fail('INVALID_TAG', '标签名不能包含逗号');
  if (color !== undefined && (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color))) fail('INVALID_TAG', '标签颜色必须是六位十六进制色值');
}

async function createTagUnlocked(root, line, name, color) {
  validateTag(line, name, color);
  const tags = await loadTags(root);
  const lineTags = tags.filter((tag) => tag.line === line);
  if (lineTags.some((tag) => tag.name === name)) fail('DUPLICATE_TAG', `${line} 线标签已存在：${name}`, 409);
  const tag = { line, name, color, order: lineTags.length + 1 };
  await saveTags(root, [...tags, tag]);
  return tag;
}

async function renameTagUnlocked(root, line, oldName, newName) {
  validateTag(line, newName);
  const tags = await loadTags(root);
  const index = tags.findIndex((tag) => tag.line === line && tag.name === oldName);
  if (index === -1) fail('NOT_FOUND', `标签不存在：${oldName}`, 404);
  if (tags.some((tag) => tag.line === line && tag.name === newName)) fail('DUPLICATE_TAG', `${line} 线标签已存在：${newName}`, 409);
  const tasks = await loadAll(root);
  const nextTags = tags.map((tag) => tag.line === line && tag.name === oldName ? { ...tag, name: newName } : tag);
  const changed = tasks
    .filter((task) => task.line === line && (task.tags ?? []).includes(oldName))
    .map((task) => ({ ...task, tags: task.tags.map((name) => name === oldName ? newName : name) }));
  for (const task of changed) await validateTask(root, task, { archived: task.archived, tags: nextTags });
  for (const task of changed) await writeTask(task);
  await saveTags(root, nextTags);
  return nextTags[index];
}

async function updateTagUnlocked(root, line, name, patch) {
  const tags = await loadTags(root);
  const current = tags.find((tag) => tag.line === line && tag.name === name);
  if (!current) fail('NOT_FOUND', `标签不存在：${name}`, 404);
  if (Object.hasOwn(patch, 'name') && patch.name !== name) return renameTagUnlocked(root, line, name, patch.name);
  for (const key of Object.keys(patch)) if (key !== 'color' && !(key === 'name' && patch.name === name)) fail('INVALID_FIELD', `不能修改标签字段：${key}`);
  if (!Object.hasOwn(patch, 'color')) return current;
  validateTag(line, name, patch.color);
  const next = tags.map((tag) => tag.line === line && tag.name === name ? { ...tag, color: patch.color } : tag);
  await saveTags(root, next);
  return next.find((tag) => tag.line === line && tag.name === name);
}

async function reorderTagsUnlocked(root, line, names) {
  if (!Array.isArray(names) || new Set(names).size !== names.length) fail('INVALID_ORDER', 'names 必须是无重复数组');
  if (![...LINES, 'inbox'].includes(line)) fail('INVALID_LINE', `line 无效：${line}`);
  const tags = await loadTags(root);
  const lineTags = tags.filter((tag) => tag.line === line);
  const expected = new Set(lineTags.map((tag) => tag.name));
  if (names.length !== lineTags.length || names.some((name) => !expected.has(name))) fail('INVALID_ORDER', `names 必须完整覆盖 ${line} 线标签`);
  const order = new Map(names.map((name, index) => [name, index + 1]));
  const next = tags.map((tag) => tag.line === line ? { ...tag, order: order.get(tag.name) } : tag);
  await saveTags(root, next);
  return next.filter((tag) => tag.line === line).sort((a, b) => a.order - b.order);
}

async function deleteTagUnlocked(root, line, name) {
  const tags = await loadTags(root);
  if (!tags.some((tag) => tag.line === line && tag.name === name)) fail('NOT_FOUND', `标签不存在：${name}`, 404);
  const tasks = await loadAll(root);
  const changed = tasks
    .filter((task) => task.line === line && (task.tags ?? []).includes(name))
    .map((task) => ({ ...task, tags: task.tags.filter((tag) => tag !== name) }));
  const kept = tags.filter((tag) => !(tag.line === line && tag.name === name));
  const next = kept.map((tag) => tag.line === line
    ? { ...tag, order: kept.filter((item) => item.line === line && item.order <= tag.order).length }
    : tag);
  for (const task of changed) await validateTask(root, task, { archived: task.archived, tags: next });
  for (const task of changed) await writeTask(task);
  await saveTags(root, next);
  return { line, name, removedFrom: changed.length };
}

// Every writer is serialized by the task-directory lock: one approve or move
// rewrites a whole phase group, so two concurrent writers used to interleave
// and could leave a task duplicated across directories. The unlocked bodies
// stay internal because the lock is not reentrant.
export const addTask = locked(addTaskUnlocked);
export const updateTask = locked(updateTaskUnlocked);
export const moveTask = locked(moveTaskUnlocked);
export const reorder = locked(reorderUnlocked);
export const completeTask = locked(completeTaskUnlocked);
export const approveTask = locked(approveTaskUnlocked);
export const rejectTask = locked(rejectTaskUnlocked);
export const unarchiveTask = locked(unarchiveTaskUnlocked);
export const deleteTask = locked(deleteTaskUnlocked);
export const createTag = locked(createTagUnlocked);
export const renameTag = locked(renameTagUnlocked);
export const updateTag = locked(updateTagUnlocked);
export const reorderTags = locked(reorderTagsUnlocked);
export const deleteTag = locked(deleteTagUnlocked);
