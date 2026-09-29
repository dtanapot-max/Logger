/* Logger: browser-only, zero dependencies. Load with <script defer src="logger.js">. */
(function (global) {
  'use strict';

  const levels = { error: 'ERR', warn: 'WARN', info: 'INFO', success: 'SUCC', debug: 'DBG' };
  const defaults = { max: 200, height: 240, open: false, persist: false, key: 'logger', snapshot: null };
  let options = { ...defaults };
  let entries = [];
  let active = 'all';
  let opened = false;
  let height = 240;
  let mode = 'standby';
  let ui = null;
  let events, observer, frame = 0, saveTimer = 0, copyTimer = 0, copyId = 0;
  let previousSpace = '', previousPriority = '';

  // Take a JSON-safe snapshot now, so later changes to an object cannot alter a log.
  function json(value, indent) {
    const seen = new WeakSet();
    try {
      return JSON.stringify(value, function (key, item) {
        if (typeof item === 'bigint') return `${item}n`;
        if (typeof item === 'function' || typeof item === 'symbol') return String(item);
        if (item && typeof item === 'object') {
          if (seen.has(item)) return '[Repeated/Circular]';
          seen.add(item);
          if (item instanceof Error) return { name: item.name, message: item.message, stack: item.stack };
        }
        return item;
      }, indent) ?? 'null';
    } catch (_) {
      return '"[Unserializable]"';
    }
  }

  function text(value) {
    try { return typeof value === 'object' ? json(value) : String(value ?? ''); }
    catch (_) { return '[Unprintable]'; }
  }

  function limit(value, fallback, min, max) {
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.round(Math.min(max, Math.max(min, value))) : fallback;
  }

  function node(tag, cls, content) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (content !== undefined) el.textContent = content;
    return el;
  }

  function button(label, title) {
    const el = node('button', 'log-btn', label);
    el.type = 'button';
    el.title = title;
    el.setAttribute('aria-label', title);
    return el;
  }

  function listen(target, type, handler) {
    target.addEventListener(type, handler, { signal: events.signal });
  }

  function valid(entry) {
    return entry && typeof entry === 'object'
      && Object.hasOwn(levels, entry.level)
      && typeof entry.time === 'string' && Number.isFinite(Date.parse(entry.time))
      && typeof entry.category === 'string' && typeof entry.message === 'string';
  }

  function restore() {
    if (!options.persist) return;
    try {
      const saved = JSON.parse(localStorage.getItem(options.key));
      if (!saved || typeof saved !== 'object') return;
      if (Array.isArray(saved.entries)) {
        const logs = saved.entries.filter(valid).map(e => ({
          time: e.time, category: e.category, level: e.level, message: e.message, meta: e.meta ?? null
        }));
        entries = logs.concat(entries).slice(-options.max);
      }
      if (saved.filter === 'all' || Object.hasOwn(levels, saved.filter)) active = saved.filter;
      if (typeof saved.open === 'boolean') opened = saved.open;
      height = limit(saved.height, height, 60, 1200);
    } catch (_) { /* Storage may be disabled or contain invalid JSON. */ }
  }

  function persist() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (!options.persist) return;
    try {
      localStorage.setItem(options.key, json({ entries, filter: active, open: opened, height }));
    } catch (_) { /* Logging still works if storage is blocked or full. */ }
  }

  function saveSoon() {
    if (options.persist) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(persist, 200);
    }
  }

  function syncSpace() {
    if (!ui) return;
    const size = `${Math.ceil(ui.dock.getBoundingClientRect().height)}px`;
    ui.space.style.height = size;
    document.documentElement.style.setProperty('--log-space', size);
  }

  function maxHeight() {
    const viewport = global.visualViewport ? global.visualViewport.height : global.innerHeight;
    return Math.max(0, Math.floor(viewport * 0.75 - (ui ? ui.bar.offsetHeight + ui.handle.offsetHeight : 60)));
  }

  function layout() {
    if (!ui) return;
    const max = maxHeight();
    height = Math.min(max, Math.max(Math.min(60, max), height));
    ui.body.hidden = !opened;
    ui.body.style.height = `${height}px`;
    ui.toggle.textContent = opened ? '[ย่อ]' : '[ขยาย]';
    ui.toggle.setAttribute('aria-label', opened ? 'ย่อรายการ log' : 'ขยายรายการ log');
    ui.toggle.setAttribute('aria-expanded', String(opened));
    ui.handle.setAttribute('aria-valuemin', String(opened ? Math.min(60, max) : 0));
    ui.handle.setAttribute('aria-valuemax', String(max));
    ui.handle.setAttribute('aria-valuenow', String(opened ? height : 0));
    ui.handle.setAttribute('aria-valuetext', opened ? `${height} พิกเซล` : 'พับเก็บ');
    syncSpace();
  }

  function row(entry) {
    const el = node('div', 'log-entry');
    el.dataset.level = entry.level;
    const time = node('time', 'log-time', new Date(entry.time).toLocaleTimeString('en-GB', { hour12: false }));
    time.dateTime = entry.time;
    time.title = entry.time;
    el.append(time, node('span', 'log-level', levels[entry.level]),
      node('span', 'log-cat', entry.category), node('span', 'log-msg', entry.message));
    if (entry.meta !== null) el.append(node('code', 'log-meta', json(entry.meta)));
    return el;
  }

  function render() {
    cancelAnimationFrame(frame);
    frame = 0;
    if (!ui) return;
    const follow = ui.body.scrollHeight - ui.body.scrollTop - ui.body.clientHeight < 32;
    const oldTop = ui.body.scrollTop;
    const counts = { all: entries.length, error: 0, warn: 0, info: 0, success: 0, debug: 0 };
    const fragment = document.createDocumentFragment();
    let visible = 0;
    for (const entry of entries) {
      counts[entry.level]++;
      if (active === 'all' || active === entry.level) {
        fragment.append(row(entry));
        visible++;
      }
    }
    if (!visible) fragment.append(node('p', 'log-empty', 'ยังไม่มีรายการในตัวกรองนี้'));
    ui.stream.replaceChildren(fragment);
    for (const [level, control] of Object.entries(ui.filters)) {
      control.count.textContent = counts[level];
      control.btn.setAttribute('aria-pressed', String(active === level));
    }
    ui.body.scrollTop = follow ? ui.body.scrollHeight : oldTop;
  }

  function schedule() {
    if (ui && !frame) frame = requestAnimationFrame(render);
    saveSoon();
  }

  function log(category, level, message, meta = null) {
    level = text(level).toLowerCase();
    if (!Object.hasOwn(levels, level)) level = 'info';
    entries.push({
      time: new Date().toISOString(), category: text(category).trim().toUpperCase() || 'APP',
      level, message: text(message), meta: JSON.parse(json(meta))
    });
    if (entries.length > options.max) entries.splice(0, entries.length - options.max);
    schedule();
  }

  function filter(level) {
    level = text(level).toLowerCase();
    active = Object.hasOwn(levels, level) ? level : 'all';
    if (ui) { ui.body.scrollTop = 0; render(); }
    saveSoon();
  }

  function toggle(value) {
    opened = typeof value === 'boolean' ? value : !opened;
    if (ui && !opened && ui.body.contains(document.activeElement)) ui.toggle.focus();
    layout();
    if (ui && opened) ui.body.scrollTop = ui.body.scrollHeight;
    saveSoon();
  }

  function clear() {
    entries = [];
    if (ui) {
      ui.copyBox.hidden = true;
      ui.copyBox.value = '';
      ui.copyBtn.textContent = '⧉ AI';
      ui.note.textContent = '';
      render();
    }
    clearTimeout(copyTimer);
    copyId++;
    persist(); // Also replaces any pending save, so cleared entries cannot return.
  }

  function setMode(value) {
    value = text(value).toLowerCase();
    mode = ['online', 'offline', 'standby'].includes(value) ? value : 'standby';
    if (ui) {
      ui.dot.dataset.mode = mode;
      ui.dot.title = `สถานะ: ${mode}`;
      ui.dot.setAttribute('aria-label', `สถานะ: ${mode}`);
    }
  }

  function data() { return JSON.parse(json(entries)); }

  function exportLogs() {
    let snapshot = null;
    if (typeof options.snapshot === 'function') {
      try { snapshot = options.snapshot(); }
      catch (error) { snapshot = { error: text(error) }; }
    }
    return json({ time: new Date().toISOString(), filter: active, snapshot, logs: entries }, 2);
  }

  async function copy() {
    const target = ui;
    const id = ++copyId;
    const payload = `### Logger diagnostics\n\n\`\`\`json\n${exportLogs()}\n\`\`\``;
    try {
      await navigator.clipboard.writeText(payload);
      if (ui === target && ui && id === copyId) {
        ui.note.textContent = 'คัดลอกแล้ว';
        ui.copyBox.hidden = true;
        ui.copyBtn.textContent = 'คัดลอกแล้ว';
        clearTimeout(copyTimer);
        copyTimer = setTimeout(() => {
          if (ui === target) ui.copyBtn.textContent = '⧉ AI';
        }, 1800);
      }
      return true;
    } catch (_) {
      if (ui === target && ui && id === copyId) {
        clearTimeout(copyTimer);
        ui.copyBtn.textContent = '⧉ AI';
        ui.note.textContent = 'เลือกข้อความแล้ว — กด Ctrl/Cmd+C หรือแตะค้างเพื่อคัดลอก';
        ui.copyBox.value = payload;
        ui.copyBox.hidden = false;
        toggle(true);
        ui.copyBox.focus();
        ui.copyBox.select();
        ui.body.scrollTop = 0;
      }
      return false;
    }
  }

  function resize() {
    let drag = null;
    listen(ui.handle, 'pointerdown', e => {
      if (!e.isPrimary || e.button !== 0) return;
      e.preventDefault();
      toggle(true);
      drag = { y: e.clientY, height, id: e.pointerId };
      ui.handle.setPointerCapture(e.pointerId);
    });
    listen(ui.handle, 'pointermove', e => {
      if (!drag || drag.id !== e.pointerId) return;
      height = drag.height + drag.y - e.clientY;
      layout();
    });
    function finish(e) {
      if (!drag || drag.id !== e.pointerId) return;
      drag = null;
      saveSoon();
    }
    listen(ui.handle, 'pointerup', finish);
    listen(ui.handle, 'pointercancel', finish);
    listen(ui.handle, 'lostpointercapture', finish);
    listen(ui.handle, 'keydown', e => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' '].includes(e.key)) return;
      e.preventDefault();
      if (e.key === 'Enter' || e.key === ' ') return toggle();
      opened = true;
      if (e.key === 'Home') height = 60;
      else if (e.key === 'End') height = maxHeight();
      else height += e.key === 'ArrowUp' ? 24 : -24;
      layout();
      saveSoon();
    });
  }

  function init(config = {}) {
    if (ui) return api; // One dock and one set of listeners per page.
    if (!document.body) throw new Error('Logger.init(): call after the body exists, or use defer.');
    options = { ...defaults, ...config };
    options.max = limit(options.max, defaults.max, 1, 2000);
    options.key = typeof options.key === 'string' && options.key ? options.key : defaults.key;
    options.persist = options.persist === true;
    active = 'all';
    opened = options.open === true;
    height = limit(options.height, defaults.height, 60, 1200);
    restore();
    entries = entries.slice(-options.max);
    events = new AbortController();

    const dock = node('aside', 'log-dock');
    dock.setAttribute('aria-label', 'Logger');
    const handle = node('div', 'log-handle');
    handle.tabIndex = 0;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-label', 'ปรับความสูง log ใช้ลูกศรขึ้นหรือลง');
    handle.setAttribute('aria-orientation', 'horizontal');
    handle.title = 'ลากเพื่อปรับความสูง / ลูกศรขึ้นลง / Enter เพื่อย่อหรือขยาย';
    const bar = node('div', 'log-bar');
    const dot = node('span', 'log-dot');
    dot.setAttribute('role', 'img');
    const filters = node('div', 'log-filters');
    filters.setAttribute('role', 'group');
    filters.setAttribute('aria-label', 'กรองระดับ log');
    const controls = {};
    for (const [level, label] of Object.entries({ all: 'ALL', ...levels })) {
      const btn = button(`${label} `, `กรอง ${label}`);
      // Visible label includes the count for screen readers as well.
      btn.removeAttribute('aria-label');
      btn.dataset.level = level;
      const count = node('span', 'log-count', '0');
      btn.append(count);
      filters.append(btn);
      controls[level] = { btn, count };
      listen(btn, 'click', () => filter(level));
    }
    const actions = node('div', 'log-actions');
    const copyBtn = button('⧉ AI', 'คัดลอก log ทั้งหมดเป็น JSON สำหรับ AI');
    copyBtn.classList.add('log-copy-btn');
    const clearBtn = button('ล้าง', 'ล้าง log ทั้งหมด');
    const toggleBtn = button('[ขยาย]', 'ขยายรายการ log');
    actions.append(copyBtn, clearBtn, toggleBtn);
    bar.append(dot, filters, actions);

    const body = node('div', 'log-body');
    body.tabIndex = 0;
    body.setAttribute('role', 'region');
    body.setAttribute('aria-label', 'รายการ log');
    // An instance-specific ID avoids collisions with the host page.
    body.id = `log-${global.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
    handle.setAttribute('aria-controls', body.id);
    toggleBtn.setAttribute('aria-controls', body.id);
    const note = node('p', 'log-note');
    note.setAttribute('role', 'status');
    const copyBox = node('textarea', 'log-copy');
    copyBox.readOnly = true;
    copyBox.hidden = true;
    copyBox.setAttribute('aria-label', 'ข้อความ log สำหรับคัดลอกด้วยตนเอง');
    const stream = node('div', 'log-stream');
    body.append(note, copyBox, stream);
    dock.append(handle, bar, body);
    const space = node('div', 'log-space');
    space.setAttribute('aria-hidden', 'true');
    ui = { dock, handle, bar, dot, filters: controls, body, stream, note, copyBox, copyBtn, space, toggle: toggleBtn };
    previousSpace = document.documentElement.style.getPropertyValue('--log-space');
    previousPriority = document.documentElement.style.getPropertyPriority('--log-space');
    document.body.append(space, dock);
    listen(copyBtn, 'click', copy);
    listen(clearBtn, 'click', clear);
    listen(toggleBtn, 'click', () => toggle());
    listen(dock, 'keydown', e => {
      if (e.key === 'Escape' && opened) { e.preventDefault(); toggle(false); }
    });
    listen(global, 'resize', layout);
    if (global.visualViewport) listen(global.visualViewport, 'resize', layout);
    listen(global, 'pagehide', persist);
    listen(document, 'visibilitychange', () => { if (document.hidden) persist(); });
    if (global.ResizeObserver) {
      observer = new ResizeObserver(syncSpace);
      observer.observe(dock);
    }
    resize();
    setMode(mode);
    layout();
    render();
    return api;
  }

  function destroy() {
    if (!ui) return;
    persist();
    events.abort();
    observer?.disconnect();
    observer = null;
    cancelAnimationFrame(frame);
    clearTimeout(copyTimer);
    frame = 0;
    copyId++;
    ui.dock.remove();
    ui.space.remove();
    ui = null;
    entries = [];
    options = { ...defaults };
    if (previousSpace) document.documentElement.style.setProperty('--log-space', previousSpace, previousPriority);
    else document.documentElement.style.removeProperty('--log-space');
  }

  const api = { init, log, filter, toggle, clear, setMode, data, export: exportLogs, copy, destroy };
  for (const level of Object.keys(levels)) {
    api[level] = (category, message, meta) => log(category, level, message, meta);
  }
  global.Logger = Object.freeze(api);
})(window);
