import { executionPrompt } from './execution-prompt.mjs';
import { autoRefresh } from './auto-refresh.mjs';

const requestedView = new URLSearchParams(location.search).get('line');
const state = { tasks: [], tags: [], phases: { L: [], G: [], P: [], R: [] }, view: ['inbox', 'L', 'G', 'P', 'R'].includes(requestedView) ? requestedView : 'inbox', query: '', current: null, dragId: null };
const board = document.querySelector('#board');
const taskDialog = document.querySelector('#task-dialog');
const taskForm = document.querySelector('#task-form');
const promptDialog = document.querySelector('#prompt-dialog');
const tagsDialog = document.querySelector('#tags-dialog');
const lineNames = { L: '发行', G: '增长', P: '产品', R: '研究' };
let tagCreationPending = false;
const energySavingButton = document.querySelector('#energy-saving');
const energySavingKey = 'light-dashboard.board.energySaving';
let energySaving = false;
try { energySaving = localStorage.getItem(energySavingKey) === 'true'; } catch { /* Storage may be unavailable. */ }
function renderEnergySaving() {
  energySavingButton.setAttribute('aria-checked', String(energySaving));
  document.querySelector('#energy-saving-state').textContent = energySaving ? '开' : '关';
}
renderEnergySaving();
energySavingButton.addEventListener('click', () => {
  energySaving = !energySaving;
  renderEnergySaving();
  try { localStorage.setItem(energySavingKey, String(energySaving)); }
  catch { toast('设置仅在当前页面生效，浏览器未允许保存偏好'); }
});

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) } });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(value.error?.message ?? `请求失败（${response.status}）`);
    error.code = value.error?.code;
    throw error;
  }
  return value;
}

function toast(message, error = false) {
  const node = document.querySelector('#toast');
  node.textContent = message;
  node.className = error ? 'show error' : 'show';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.className = ''; }, 2800);
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Local browser policies can deny the Clipboard API; fall back to selection copy.
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.cssText = 'position:fixed;left:-9999px;opacity:0';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('浏览器拒绝了剪贴板访问');
}

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function inlineMarkdown(text) {
  let safe = escapeHtml(text);
  safe = safe.replace(/`([^`]+)`/g, '<code>$1</code>');
  safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  safe = safe.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return safe;
}

function markdown(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let inCode = false;
  let code = [];
  let list = null;
  const closeList = () => { if (list) { html.push(`</${list}>`); list = null; } };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^```/.test(line)) {
      closeList();
      if (inCode) { html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`); code = []; }
      inCode = !inCode;
      continue;
    }
    if (inCode) { code.push(line); continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      closeList();
      const table = [line];
      while (index + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[index + 1])) table.push(lines[++index]);
      html.push(`<pre><code>${escapeHtml(table.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) { closeList(); const level = heading[1].length; html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`); continue; }
    const item = /^\s*([-*]|\d+\.)\s+(.+)$/.exec(line);
    if (item) {
      const kind = item[1].endsWith('.') ? 'ol' : 'ul';
      if (list !== kind) { closeList(); list = kind; html.push(`<${kind}>`); }
      html.push(`<li>${inlineMarkdown(item[2])}</li>`);
      continue;
    }
    closeList();
    if (line.trim()) html.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  closeList();
  if (inCode) html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  return html.join('');
}

function summary(body) {
  const plain = String(body ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!??\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>`~-]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return plain.length > 100 ? `${plain.slice(0, 100)}…` : plain;
}

function matches(task) {
  if (!state.query) return true;
  const haystack = [task.title, task.prompt, ...(task.history ?? []).map((entry) => entry.text), task.owner, task.track, ...(task.tags ?? [])].join(' ').toLocaleLowerCase();
  return haystack.includes(state.query);
}

function tagHtml(name, interactive = false, line = state.view) {
  const tag = state.tags.find((item) => item.line === line && item.name === name);
  const style = `--tag-color:${escapeHtml(tag?.color ?? '#8791a0')}`;
  if (interactive) return `<button type="button" class="tag tag-filter" data-tag="${escapeHtml(name)}" style="${style}" draggable="false">${escapeHtml(name)}</button>`;
  return `<span class="tag" style="${style}">${escapeHtml(name)}</span>`;
}

function card(task, draggable = false) {
  const excerpt = summary(task.prompt);
  const rounds = (task.history ?? []).length;
  const overdue = task.due && task.status !== 'done' && task.due < new Date().toISOString().slice(0, 10);
  return `<article class="task-card" data-id="${task.id}" draggable="${draggable}">
    <div class="task-card-head">
      <h3>${escapeHtml(task.title)}</h3>
      ${task.status === 'todo' && task.line !== 'inbox' ? `<button type="button" class="copy-task-prompt" data-task-id="${escapeHtml(task.id)}" draggable="false" aria-label="复制任务 ${escapeHtml(task.id)} 的 AI 执行 Prompt">复制 Prompt</button>` : ''}
    </div>
    ${excerpt ? `<p class="summary">${escapeHtml(excerpt)}</p>` : ''}
    <div class="meta">${(task.tags ?? []).map((name) => tagHtml(name, true, task.line)).join('')}${rounds ? `<span class="rounds" title="完成与打回记录共 ${rounds} 条">记录 · ${rounds}</span>` : ''}${task.owner ? `<span>负责 · ${escapeHtml(task.owner)}</span>` : ''}${task.due ? `<span class="${overdue ? 'overdue' : ''}">截止 · ${escapeHtml(task.due)}</span>` : ''}</div>
  </article>`;
}

function phaseInfo(line, phase) {
  return state.phases[line]?.find((item) => item.phase === phase) ?? { phase, due: '', minimum: '' };
}

function taskSort(a, b) { return (a.phase ?? -1) - (b.phase ?? -1) || (a.priority ?? 0) - (b.priority ?? 0) || a.id.localeCompare(b.id); }

function renderLine(line) {
  const active = state.tasks.filter((task) => !task.archived && task.line === line && matches(task));
  const todos = active.filter((task) => task.status === 'todo').sort(taskSort);
  const reviews = active.filter((task) => task.status === 'review').sort(taskSort);
  if (line === 'inbox') {
    board.innerHTML = `<div class="columns inbox"><section class="column"><h2 class="column-title">提醒 <span class="count">${todos.length}</span></h2><p class="hint">这里放的是提醒不是任务：归哪条线拿不准、等人类拍板、还没成形的观察。要做的事直接建到 L / G / P / R。</p><div class="card-list" data-line="inbox">${todos.map((task) => card(task, true)).join('') || '<div class="empty">没有待处理的提醒</div>'}</div></section></div>`;
    return;
  }
  const configured = state.phases[line].map((item) => item.phase);
  const present = todos.map((task) => task.phase);
  const phases = [...new Set([...configured, ...present])].sort((a, b) => a - b);
  const groups = phases.map((phase) => {
    const info = phaseInfo(line, phase);
    const tasks = todos.filter((task) => task.phase === phase);
    return `<section class="phase-group"><h3 class="phase-title">${line}${phase}${info.due ? ` <small>· 截止 ${escapeHtml(info.due)}</small>` : ''}</h3><div class="card-list" data-line="${line}" data-phase="${phase}">${tasks.map((task) => card(task, true)).join('') || '<div class="empty">暂无任务</div>'}</div></section>`;
  }).join('');
  board.innerHTML = `<div class="columns"><section class="column"><h2 class="column-title">待完成 <span class="count">${todos.length}</span></h2>${groups || '<div class="empty">没有可用阶段或待完成任务</div>'}</section><section class="column review-stack"><h2 class="column-title">待审核 <span class="count">${reviews.length}</span></h2>${reviews.map((task) => card(task)).join('') || '<div class="empty">暂无待审核任务</div>'}</section></div>`;
}

function renderArchive() {
  board.innerHTML = `<div class="archive-grid">${Object.keys(lineNames).map((line) => {
    const tasks = state.tasks.filter((task) => task.archived && task.line === line && matches(task)).sort((a, b) => String(b.completed).localeCompare(String(a.completed)));
    return `<section class="archive-column"><h2 class="column-title">${line} · ${lineNames[line]} <span class="count">${tasks.length}</span></h2>${tasks.map((task) => card(task)).join('') || '<div class="empty">暂无归档</div>'}</section>`;
  }).join('')}</div>`;
}

function updateTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    const view = tab.dataset.view;
    tab.classList.toggle('active', view === state.view);
    const count = view === 'archive'
      ? state.tasks.filter((task) => task.archived).length
      : state.tasks.filter((task) => !task.archived && task.line === view).length;
    tab.querySelector('span').textContent = count;
  });
}

function bindCards() {
  board.querySelectorAll('.task-card').forEach((node) => {
    node.addEventListener('click', () => openTask(node.dataset.id));
    const copyButton = node.querySelector('.copy-task-prompt');
    copyButton?.addEventListener('pointerdown', (event) => event.stopPropagation());
    copyButton?.addEventListener('dragstart', (event) => { event.preventDefault(); event.stopPropagation(); });
    copyButton?.addEventListener('click', async (event) => {
      event.stopPropagation();
      const task = state.tasks.find((item) => item.id === copyButton.dataset.taskId);
      if (!task) return;
      try {
        const useEnergySaving = energySaving;
        await copyText(executionPrompt(task, { energySaving: useEnergySaving }));
        toast(`已复制 ${task.id} 的执行 Prompt${useEnergySaving ? '（节能模式）' : ''}`);
      } catch (error) {
        toast(error.message, true);
      }
    });
    node.querySelectorAll('.tag-filter').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const tag = button.dataset.tag;
        applySearch(state.query === tag.toLocaleLowerCase() ? '' : tag, true);
      });
    });
    node.addEventListener('dragstart', (event) => {
      state.dragId = node.dataset.id;
      node.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', node.dataset.id);
    });
    node.addEventListener('dragend', () => { state.dragId = null; node.classList.remove('dragging'); document.querySelectorAll('.drag-target').forEach((item) => item.classList.remove('drag-target')); });
    node.addEventListener('dragover', (event) => {
      if (!state.dragId) return;
      event.preventDefault();
      const list = node.closest('.card-list');
      const dragging = document.querySelector('.task-card.dragging');
      if (dragging && dragging !== node && list === dragging.closest('.card-list')) {
        const after = event.clientY > node.getBoundingClientRect().top + node.offsetHeight / 2;
        list.insertBefore(dragging, after ? node.nextSibling : node);
      }
    });
  });
  board.querySelectorAll('.card-list').forEach((list) => {
    list.addEventListener('dragover', (event) => { if (state.dragId) { event.preventDefault(); list.classList.add('drag-target'); } });
    list.addEventListener('dragleave', (event) => { if (!list.contains(event.relatedTarget)) list.classList.remove('drag-target'); });
    list.addEventListener('drop', async (event) => {
      event.preventDefault();
      const task = state.tasks.find((item) => item.id === state.dragId);
      if (!task) return;
      const line = list.dataset.line;
      const phase = list.dataset.phase === undefined ? undefined : Number(list.dataset.phase);
      try {
        if (task.line !== line || task.phase !== phase) await request(`/api/tasks/${task.id}/move`, { method: 'POST', body: JSON.stringify({ line, phase }) });
        else if (line === 'inbox') await refresh();
        else {
          const ids = [...list.querySelectorAll('.task-card')].map((item) => item.dataset.id);
          await request('/api/reorder', { method: 'POST', body: JSON.stringify({ line, phase, ids }) });
        }
        await refresh();
      } catch (error) { toast(error.message, true); await refresh(); }
    });
  });
}

function render() {
  updateTabs();
  if (state.view === 'archive') renderArchive(); else renderLine(state.view);
  bindCards();
}

let refreshVersion = 0;
let lastSnapshot = '';
const refreshPaused = () => document.hidden || Boolean(state.dragId) || Boolean(document.querySelector('dialog[open]'));

async function refresh({ background = false } = {}) {
  const version = ++refreshVersion;
  const value = await request('/api/state');
  if (version !== refreshVersion || (background && refreshPaused())) return;
  const snapshot = JSON.stringify(value);
  if (background && snapshot === lastSnapshot) return;
  lastSnapshot = snapshot;
  state.tasks = value.tasks;
  state.tags = [...value.tags].sort((a, b) => a.order - b.order);
  state.phases = value.phases;
  render();
}

autoRefresh({
  refresh: () => refresh({ background: true }),
  paused: refreshPaused,
});

function phaseChoices(line, selected) {
  const configured = (state.phases[line] ?? []).map((item) => item.phase);
  const values = [...new Set([...(configured.length ? configured : [0]), 9, ...(selected === undefined ? [] : [selected])])].sort((a, b) => a - b);
  const input = taskForm.elements.phase;
  input.setAttribute('list', 'phase-options');
  let datalist = document.querySelector('#phase-options');
  if (!datalist) { datalist = document.createElement('datalist'); datalist.id = 'phase-options'; input.after(datalist); }
  datalist.innerHTML = values.map((phase) => `<option value="${phase}">${line}${phase}</option>`).join('');
  input.disabled = line === 'inbox';
  input.required = line !== 'inbox';
  if (line === 'inbox') input.value = '';
  else if (selected !== undefined) input.value = selected;
  else input.value = values[0] ?? 0;
}

function fillTagChoices(selected = []) {
  const line = taskForm.elements.line.value;
  const tags = state.tags.filter((tag) => tag.line === line).sort((a, b) => a.order - b.order);
  document.querySelector('#task-tags').innerHTML = tags.map((tag) => `<label><input type="checkbox" name="tags" value="${escapeHtml(tag.name)}" ${selected.includes(tag.name) ? 'checked' : ''}>${tagHtml(tag.name, false, line)}</label>`).join('') || '<span class="hint">这条线还没有标签</span>';
}

// «完成 → 审核» is an append-only chain: 结果 → 打回 → 结果 → … A task can carry
// any number of rounds, so the newest one is open and the earlier ones fold away.
function renderHistory(task) {
  const section = document.querySelector('#task-history');
  const list = document.querySelector('#history-list');
  // A board server started before this code shipped answers /api/state without
  // `history`, and the section would silently stay empty. Say so instead.
  if (task && task.history === undefined) {
    section.hidden = false;
    document.querySelector('#history-count').textContent = '';
    list.innerHTML = '<li class="empty">看板服务还在运行改动前的代码，读不出记录。停掉它再重新 npm run board 即可。</li>';
    return;
  }
  const entries = task?.history ?? [];
  section.hidden = entries.length === 0;
  document.querySelector('#history-count').textContent = entries.length ? `${entries.length} 条` : '';
  list.innerHTML = entries.map((entry, index) => `<li class="history-entry ${entry.title === '打回' ? 'rejected' : 'result'}">
    <details ${index === entries.length - 1 ? 'open' : ''}>
      <summary><span class="history-index">#${index + 1}</span> ${escapeHtml(entry.title)}</summary>
      <div class="history-body">${markdown(entry.text)}</div>
    </details>
  </li>`).join('');
}

function openTask(id = null) {
  const task = id ? state.tasks.find((item) => item.id === id) : null;
  state.current = task ?? null;
  taskForm.reset();
  document.querySelector('#task-dialog-title').textContent = task ? task.title : '新建任务';
  taskForm.elements.title.value = task?.title ?? '';
  taskForm.elements.line.value = task?.line ?? (state.view === 'archive' ? 'P' : state.view);
  phaseChoices(taskForm.elements.line.value, task?.phase);
  taskForm.elements.owner.value = task?.owner ?? '';
  taskForm.elements.track.value = task?.track ?? '';
  taskForm.elements.due.value = task?.due ?? '';
  taskForm.elements.body.value = task?.prompt ?? '';
  fillTagChoices(task?.tags ?? []);
  const archived = task?.archived;
  [...taskForm.elements].forEach((input) => { if (input.name) input.disabled = Boolean(archived); });
  document.querySelector('#save-task').hidden = Boolean(archived);
  document.querySelector('#delete-task').hidden = !task;
  const action = document.querySelector('#state-action');
  const reject = document.querySelector('#reject-task');
  action.hidden = !task || task.line === 'inbox';
  reject.hidden = true;
  syncInboxNote();
  if (task?.status === 'todo') action.textContent = '完成（写结果）';
  if (task?.status === 'review') { action.textContent = '通过'; reject.hidden = false; }
  if (task?.status === 'done') action.textContent = '取消归档';
  renderHistory(task);
  taskDialog.showModal();
}

function promptFor(title, label) {
  document.querySelector('#prompt-title').textContent = title;
  document.querySelector('#prompt-label').textContent = label;
  document.querySelector('#prompt-value').value = '';
  promptDialog.showModal();
  return new Promise((resolve) => {
    const form = document.querySelector('#prompt-form');
    const finish = (value) => { form.removeEventListener('submit', submit); promptDialog.removeEventListener('close', close); resolve(value); };
    const submit = (event) => { event.preventDefault(); const value = document.querySelector('#prompt-value').value.trim(); if (value) { promptDialog.close(); finish(value); } };
    const close = () => finish(null);
    form.addEventListener('submit', submit);
    promptDialog.addEventListener('close', close, { once: true });
  });
}

function syncInboxNote() {
  document.querySelector('#inbox-note').hidden = taskForm.elements.line.value !== 'inbox';
}

taskForm.elements.line.addEventListener('change', () => {
  phaseChoices(taskForm.elements.line.value);
  fillTagChoices();
  syncInboxNote();
});
taskForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(taskForm);
  const line = data.get('line');
  const phase = line === 'inbox' ? undefined : Number(data.get('phase'));
  const common = { title: data.get('title'), owner: data.get('owner'), track: data.get('track'), due: data.get('due'), tags: data.getAll('tags'), prompt: data.get('body') };
  try {
    if (!state.current) await request('/api/tasks', { method: 'POST', body: JSON.stringify({ ...common, line, phase }) });
    else {
      if (state.current.line !== line || state.current.phase !== phase) await request(`/api/tasks/${state.current.id}/move`, { method: 'POST', body: JSON.stringify({ line, phase }) });
      await request(`/api/tasks/${state.current.id}`, { method: 'PATCH', body: JSON.stringify(common) });
    }
    taskDialog.close();
    await refresh();
    toast('已保存');
  } catch (error) { toast(error.message, true); }
});

document.querySelector('#state-action').addEventListener('click', async () => {
  const task = state.current;
  if (!task) return;
  try {
    if (task.status === 'todo') {
      const feedback = await promptFor('完成任务', '写明完成结果、证据与遗留');
      if (!feedback) return;
      await request(`/api/tasks/${task.id}/complete`, { method: 'POST', body: JSON.stringify({ feedback }) });
    } else if (task.status === 'review') await request(`/api/tasks/${task.id}/approve`, { method: 'POST', body: '{}' });
    else await request(`/api/tasks/${task.id}/unarchive`, { method: 'POST', body: '{}' });
    taskDialog.close(); await refresh(); toast('状态已更新');
  } catch (error) { toast(error.message, true); }
});

document.querySelector('#reject-task').addEventListener('click', async () => {
  const reason = await promptFor('打回任务', '写明打回意见，任务将回到待完成');
  if (!reason) return;
  try { await request(`/api/tasks/${state.current.id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }); taskDialog.close(); await refresh(); toast('已打回'); }
  catch (error) { toast(error.message, true); }
});

document.querySelector('#delete-task').addEventListener('click', async () => {
  if (!state.current || !confirm(`确定永久删除“${state.current.title}”？`)) return;
  try { await request(`/api/tasks/${state.current.id}`, { method: 'DELETE' }); taskDialog.close(); await refresh(); toast('任务已删除'); }
  catch (error) { toast(error.message, true); }
});

document.querySelectorAll('.close-dialog').forEach((button) => button.addEventListener('click', () => taskDialog.close()));
document.querySelectorAll('.close-prompt').forEach((button) => button.addEventListener('click', () => promptDialog.close()));
document.querySelectorAll('.close-tags').forEach((button) => button.addEventListener('click', () => tagsDialog.close()));
document.querySelector('#new-task').addEventListener('click', () => openTask());
document.querySelector('#manage-tags').addEventListener('click', () => {
  document.querySelector('#tags-line').value = ['inbox', 'L', 'G', 'P', 'R'].includes(state.view) ? state.view : 'P';
  renderTags();
  tagsDialog.showModal();
});
document.querySelector('#quick-add-tag').addEventListener('click', async () => {
  const line = taskForm.elements.line.value;
  const name = await promptFor('快速新建标签', `为 ${line} 线输入标签名`);
  if (!name) return;
  const selected = [...taskForm.querySelectorAll('input[name="tags"]:checked')].map((input) => input.value);
  try {
    const tag = await request('/api/tags', { method: 'POST', body: JSON.stringify({ line, name, color: '#5269a8' }) });
    await refresh();
    fillTagChoices([...selected, tag.name]);
    toast(`已为 ${line} 线新建标签“${tag.name}”`);
  } catch (error) { toast(error.message, true); }
});
function applySearch(value, syncInput = false) {
  const input = document.querySelector('#search');
  if (syncInput) input.value = value;
  state.query = String(value ?? '').trim().toLocaleLowerCase();
  document.querySelector('#clear-search').hidden = !state.query;
  render();
}

document.querySelector('#search').addEventListener('input', (event) => applySearch(event.target.value));
document.querySelector('#clear-search').addEventListener('click', () => {
  applySearch('', true);
  document.querySelector('#search').focus();
});
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => { state.view = tab.dataset.view; render(); });
  tab.addEventListener('dragover', (event) => { if (state.dragId && tab.dataset.view !== 'archive') { event.preventDefault(); tab.classList.add('drag-target'); } });
  tab.addEventListener('dragleave', () => tab.classList.remove('drag-target'));
  tab.addEventListener('drop', async (event) => {
    event.preventDefault(); tab.classList.remove('drag-target');
    const line = tab.dataset.view;
    if (!state.dragId || line === 'archive') return;
    const phase = line === 'inbox' ? undefined : (state.phases[line]?.[0]?.phase ?? 0);
    try { await request(`/api/tasks/${state.dragId}/move`, { method: 'POST', body: JSON.stringify({ line, phase }) }); state.view = line; await refresh(); }
    catch (error) { toast(error.message, true); await refresh(); }
  });
});

function renderTags() {
  const list = document.querySelector('#tag-list');
  const line = document.querySelector('#tags-line').value;
  const tags = state.tags.filter((tag) => tag.line === line).sort((a, b) => a.order - b.order);
  list.innerHTML = tags.map((tag) => {
    const count = state.tasks.filter((task) => task.line === line && (task.tags ?? []).includes(tag.name)).length;
    const action = `/actions/delete-tag?line=${encodeURIComponent(line)}&name=${encodeURIComponent(tag.name)}`;
    return `<div class="tag-row" data-name="${escapeHtml(tag.name)}"><span class="handle" draggable="true" aria-label="拖动标签排序">⋮⋮</span><input class="tag-name" value="${escapeHtml(tag.name)}"><span class="tag-count">${count} 个任务</span><input class="tag-color" type="color" value="${escapeHtml(tag.color)}"><button type="submit" form="tag-delete-form" formaction="${escapeHtml(action)}" class="danger delete-tag" title="同时从 ${count} 个任务中移除">删除</button></div>`;
  }).join('') || '<div class="empty">还没有标签</div>';
  list.querySelectorAll('.tag-row').forEach((row) => {
    const handle = row.querySelector('.handle');
    handle.addEventListener('dragstart', () => row.classList.add('dragging'));
    handle.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', (event) => { event.preventDefault(); const dragging = list.querySelector('.dragging'); if (dragging && dragging !== row) list.insertBefore(dragging, row); });
    row.addEventListener('drop', async (event) => { event.preventDefault(); try { const names = [...list.querySelectorAll('.tag-row')].map((item) => item.dataset.name); await request('/api/tags/reorder', { method: 'POST', body: JSON.stringify({ line, names }) }); await refresh(); renderTags(); } catch (error) { toast(error.message, true); renderTags(); } });
    row.querySelector('.tag-name').addEventListener('change', async (event) => { try { await request(`/api/tags/${encodeURIComponent(row.dataset.name)}`, { method: 'PATCH', body: JSON.stringify({ line, name: event.target.value.trim() }) }); await refresh(); renderTags(); } catch (error) { toast(error.message, true); renderTags(); } });
    row.querySelector('.tag-color').addEventListener('change', async (event) => { try { await request(`/api/tags/${encodeURIComponent(row.dataset.name)}`, { method: 'PATCH', body: JSON.stringify({ line, color: event.target.value }) }); await refresh(); renderTags(); } catch (error) { toast(error.message, true); renderTags(); } });
  });
}

document.querySelector('#tags-line').addEventListener('change', renderTags);

function showCreatedTag(tag) {
  state.tags = [...state.tags.filter((item) => !(item.line === tag.line && item.name === tag.name)), tag];
  renderTags();
}

async function refreshTagsQuietly() {
  try {
    await refresh();
    renderTags();
  } catch (error) {
    // The create request has already succeeded and is shown optimistically.
    // A later read failure must not be reported as a failed create.
    console.warn('标签列表同步失败', error);
  }
}

document.querySelector('#new-tag-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (tagCreationPending) return;
  tagCreationPending = true;
  // currentTarget is only guaranteed while this synchronous event dispatch is
  // running. Keep the form before awaiting the create request.
  const form = event.currentTarget;
  const submitButton = form.querySelector('button[type="submit"], button:not([type])');
  submitButton.disabled = true;
  const data = new FormData(form);
  const line = document.querySelector('#tags-line').value;
  try {
    const tag = await request('/api/tags', { method: 'POST', body: JSON.stringify({ line, name: data.get('name'), color: data.get('color') }) });
    form.reset();
    showCreatedTag(tag);
    toast(`已新建标签“${tag.name}”`);
    await refreshTagsQuietly();
  }
  catch (error) {
    // A duplicate response means this label was already persisted (for example,
    // after a user retried while the first refresh was still pending). Surface
    // that state instead of making it look as though creation failed.
    if (error.code === 'DUPLICATE_TAG') {
      form.reset();
      await refreshTagsQuietly();
      toast('标签已存在，已显示在列表中');
      return;
    }
    toast(error.message, true);
  } finally {
    tagCreationPending = false;
    submitButton.disabled = false;
  }
});

refresh().catch((error) => { board.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; toast(error.message, true); });
