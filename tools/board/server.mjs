#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAll } from './lib/tasks.mjs';

const DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

export function createBoardServer({ root = process.cwd() } = {}) {
  const resolvedRoot = path.resolve(root);
  return http.createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
      if (request.method === 'GET' && pathname === '/api/tasks') {
        const tasks = (await loadAll(resolvedRoot)).map(({ filePath, ...task }) => task);
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ tasks }));
        return;
      }
      if (request.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        createReadStream(path.join(DIRECTORY, 'index.html')).pipe(response);
        return;
      }
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    } catch (error) {
      console.error(error);
      response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ error: '无法读取 Task MD' }));
    }
  });
}

function options(args) {
  let port = 4790;
  let root = process.cwd();
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--port') port = Number(args[++index]);
    else if (args[index] === '--root') root = args[++index];
    else throw new Error(`未知参数：${args[index]}`);
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port 必须是 0–65535');
  return { port, root };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { port, root } = options(process.argv.slice(2));
    const server = createBoardServer({ root });
    server.listen(port, '127.0.0.1', () => console.log(`Light Dashboard：http://127.0.0.1:${server.address().port}`));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
