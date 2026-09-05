#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BoardError, TASK_ID_RE, addTask, approveTask, completeTask, createTag,
  deleteTag, deleteTask, loadAll, loadPhases, loadTags, moveTask, rejectTask,
  renameTag, reorder, reorderTags, taskHistory, taskPrompt, unarchiveTask, updateTag, updateTask,
} from './lib/tasks.mjs';

const BOARD_DIR = path.dirname(fileURLToPath(import.meta.url));
const BODY_LIMIT = 1024 * 1024;

function json(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  const declared = Number(request.headers['content-length'] ?? 0);
  if (declared > BODY_LIMIT) throw new BoardError('BODY_TOO_LARGE', '请求体不能超过 1 MB', 413);
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new BoardError('BODY_TOO_LARGE', '请求体不能超过 1 MB', 413);
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('必须是对象');
    return value;
  } catch (error) {
    throw new BoardError('INVALID_JSON', `请求体不是有效 JSON 对象：${error.message}`, 400);
  }
}

function taskId(raw) {
  const id = decodeURIComponent(raw);
  if (!TASK_ID_RE.test(id)) throw new BoardError('INVALID_ID', '任务 id 格式无效', 400);
  return id;
}

async function api(request, response, root, pathname) {
  const method = request.method;
  if (method === 'GET' && pathname === '/api/state') {
    // The board needs the Prompt and the «完成 → 审核» history separately, and
    // together they are the whole body — so the raw body is not sent as well.
    const tasks = (await loadAll(root)).map(({ body, ...task }) => ({
      ...task, prompt: taskPrompt(body), history: taskHistory(body),
    }));
    return json(response, 200, { tasks, tags: await loadTags(root), phases: await loadPhases(root) });
  }
  if (method === 'POST' && pathname === '/api/tasks') return json(response, 201, await addTask(root, await readJson(request)));
  if (method === 'POST' && pathname === '/api/reorder') {
    const body = await readJson(request);
    return json(response, 200, await reorder(root, body.line, body.phase, body.ids));
  }
  if (method === 'POST' && pathname === '/api/tags') {
    const body = await readJson(request);
    return json(response, 201, await createTag(root, body.line, body.name, body.color));
  }
  if (method === 'POST' && pathname === '/api/tags/reorder') {
    const body = await readJson(request);
    return json(response, 200, await reorderTags(root, body.line, body.names));
  }

  let match = /^\/api\/tasks\/([^/]+)(?:\/(move|complete|approve|reject|unarchive))?$/.exec(pathname);
  if (match) {
    const id = taskId(match[1]);
    const action = match[2];
    if (!action && method === 'PATCH') return json(response, 200, await updateTask(root, id, await readJson(request)));
    if (!action && method === 'DELETE') return json(response, 200, await deleteTask(root, id));
    if (method === 'POST' && action === 'move') {
      const body = await readJson(request);
      return json(response, 200, await moveTask(root, id, body.line, body.phase));
    }
    if (method === 'POST' && action === 'complete') {
      const body = await readJson(request);
      return json(response, 200, await completeTask(root, id, body.feedback));
    }
    if (method === 'POST' && action === 'approve') return json(response, 200, await approveTask(root, id));
    if (method === 'POST' && action === 'reject') {
      const body = await readJson(request);
      return json(response, 200, await rejectTask(root, id, body.reason));
    }
    if (method === 'POST' && action === 'unarchive') return json(response, 200, await unarchiveTask(root, id));
  }

  match = /^\/api\/tags\/([^/]+)$/.exec(pathname);
  if (match) {
    const name = decodeURIComponent(match[1]);
    if (method === 'PATCH') {
      const body = await readJson(request);
      const { line, ...patch } = body;
      let result;
      if (Object.hasOwn(body, 'name') && body.name !== name) {
        result = await renameTag(root, line, name, body.name);
        if (Object.hasOwn(body, 'color')) result = await updateTag(root, line, body.name, { color: body.color });
      } else result = await updateTag(root, line, name, patch);
      return json(response, 200, result);
    }
    if (method === 'DELETE') {
      const body = await readJson(request);
      return json(response, 200, await deleteTag(root, body.line, name));
    }
  }
  throw new BoardError('NOT_FOUND', 'API 路径不存在', 404);
}

async function staticFile(response, pathname) {
  const files = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/board.js': 'board.js',
    '/board.css': 'board.css',
    '/execution-prompt.mjs': 'execution-prompt.mjs',
    '/auto-refresh.mjs': 'auto-refresh.mjs',
  };
  const name = files[pathname];
  if (!name) return false;
  const filePath = path.join(BOARD_DIR, name);
  await stat(filePath);
  const type = name.endsWith('.html') ? 'text/html' : /\.m?js$/.test(name) ? 'text/javascript' : 'text/css';
  response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
  createReadStream(filePath).pipe(response);
  return true;
}

export function createBoardServer({ root = process.cwd() } = {}) {
  const resolvedRoot = path.resolve(root);
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'POST' && url.pathname === '/actions/delete-tag') {
        const line = url.searchParams.get('line');
        const name = url.searchParams.get('name');
        await deleteTag(resolvedRoot, line, name);
        response.writeHead(303, { Location: `/?line=${encodeURIComponent(line)}`, 'Cache-Control': 'no-store' });
        response.end();
        return;
      }
      if (url.pathname.startsWith('/api/')) return await api(request, response, resolvedRoot, url.pathname);
      if (request.method !== 'GET' || !await staticFile(response, url.pathname)) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not found');
      }
    } catch (error) {
      const status = error.status && error.status >= 400 && error.status < 500 ? error.status : 500;
      if (status === 500) console.error(error);
      json(response, status, { error: { code: error.code ?? 'INTERNAL_ERROR', message: status === 500 ? '服务器内部错误' : error.message } });
    }
  });
}

function options(args) {
  let port = 4790;
  let root = process.cwd();
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--port') {
      port = Number(args[++index]);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port 必须是 0–65535');
    } else if (args[index] === '--root') {
      root = args[++index];
      if (!root) throw new Error('--root 缺少路径');
    } else {
      throw new Error(`未知参数：${args[index]}`);
    }
  }
  return { port, root };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { port, root } = options(process.argv.slice(2));
    const server = createBoardServer({ root });
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      console.log(`Light Dashboard：http://127.0.0.1:${address.port}`);
      console.log(`数据根目录：${path.resolve(root)}`);
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
