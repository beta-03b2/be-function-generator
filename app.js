'use strict';

// ============================================================
// CONSTANTS & STATE
// ============================================================
const DB_NAME  = 'BEFuncGen3';
const DB_VER   = 1;
const DB_STORE = 'projects';
const ENG_VER_KEY = 'befg_eng_default';
const ICON_PATH = 'icons/';

let db = null;
let projects = [];
let currentProjectId = null;
let currentTab = 'info';

function getProj() {
  return projects.find(p => p.id === currentProjectId) || null;
}

// ============================================================
// INDEXED DB
// ============================================================
function initDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(DB_STORE, { keyPath: 'id' });
    };
    req.onsuccess = e => { db = e.target.result; res(); };
    req.onerror   = e => rej(e);
  });
}

function dbPut(proj) {
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(proj);
    tx.oncomplete = res;
    tx.onerror    = rej;
  });
}

function dbDelete(id) {
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(id);
    tx.oncomplete = res;
    tx.onerror    = rej;
  });
}

function dbGetAll() {
  return new Promise((res, rej) => {
    const tx  = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).getAll();
    req.onsuccess = e => res(e.target.result || []);
    req.onerror   = rej;
  });
}

// ============================================================
// LOCAL STORAGE — engine version default
// ============================================================
function loadDefaultEngVer() {
  try {
    const v = JSON.parse(localStorage.getItem(ENG_VER_KEY));
    if (Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number')) return v;
  } catch (_) {}
  return [1, 26, 30];
}

function saveDefaultEngVer(v) {
  localStorage.setItem(ENG_VER_KEY, JSON.stringify(v));
}

// ============================================================
// PROJECT FACTORY
// ============================================================
function makeProject(name) {
  return {
    id: 'p' + Date.now() + Math.random().toString(36).slice(2, 6),
    name:          name || '新規プロジェクト',
    desc:          '',
    icon:          null,
    version:       [1, 0, 0],
    engineVersion: loadDefaultEngVer(),
    functions:     [],
    folders:       [],
    uuid1:         uuid4(),
    uuid2:         uuid4(),
    createdAt:     Date.now(),
    updatedAt:     Date.now(),
  };
}

function uuid4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

async function persist() {
  const p = getProj();
  if (!p) return;
  p.updatedAt = Date.now();
  await dbPut(p);
}

// ============================================================
// UTILITY HELPERS
// ============================================================
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeName(s) {
  return String(s || '').replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, '_');
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Icon helper — returns an <img> wrapped in .icon span
function iconEl(name, size = 14, tint = 'muted') {
  const span = document.createElement('span');
  span.className = `icon icon-${tint}`;
  span.style.cssText = `width:${size}px;height:${size}px;`;
  const img = document.createElement('img');
  img.src    = `${ICON_PATH}${name}.svg`;
  img.width  = size;
  img.height = size;
  img.alt    = '';
  span.appendChild(img);
  return span;
}

// ============================================================
// TOAST
// ============================================================
function toast(msg, type = 'ok') {
  const iconMap = { ok: 'check', err: 'alert', inf: 'info' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.appendChild(iconEl(iconMap[type] || 'check', 14));
  const t = document.createElement('span');
  t.textContent = msg;
  el.appendChild(t);
  document.getElementById('toast-wrap').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ============================================================
// MODAL SYSTEM
// ============================================================
function openModal(html, opts = {}) {
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.innerHTML = `<div class="modal${opts.sm ? ' sm' : ''}">${html}</div>`;
  document.body.appendChild(bd);

  if (!opts.noClose) {
    bd.addEventListener('click', e => { if (e.target === bd) closeModal(bd); });
    const x = bd.querySelector('.modal-close');
    if (x) x.addEventListener('click', () => closeModal(bd));
  }
  // Focus first input
  setTimeout(() => {
    const first = bd.querySelector('input:not([type=hidden]),textarea,select');
    if (first) first.focus();
  }, 60);

  return bd;
}

function closeModal(bd) {
  if (bd && bd.parentNode) bd.remove();
}

function confirmDlg(msg, onYes, opts = {}) {
  const bd = openModal(`
    <div class="modal-header">
      <h2>${opts.title || '確認'}</h2>
      <button class="modal-close" aria-label="閉じる">
        <span class="icon icon-muted" style="width:14px;height:14px;"><img src="${ICON_PATH}close.svg" width="14" height="14" alt=""></span>
      </button>
    </div>
    <div class="modal-body">
      <p class="confirm-text">${msg}</p>
    </div>
    <div class="modal-footer">
      <button class="btn-ghost" id="c-no">キャンセル</button>
      <button class="btn-danger" id="c-yes">${opts.yes || '削除'}</button>
    </div>`, { sm: true });
  bd.querySelector('#c-no').onclick  = () => closeModal(bd);
  bd.querySelector('#c-yes').onclick = () => { closeModal(bd); onYes(); };
}

// ============================================================
// HASH ROUTING
// ============================================================
// Format: #project/{id}/{tab}  or  # (home)
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  if (!h) return { page: 'home' };
  const parts = h.split('/');
  if (parts[0] === 'project' && parts[1]) {
    return { page: 'project', id: parts[1], tab: parts[2] || 'info' };
  }
  return { page: 'home' };
}

function pushHash(page, id, tab) {
  const hash = page === 'home' ? '#' : `#project/${id}/${tab || 'info'}`;
  history.pushState(null, '', hash);
}

function replaceHash(page, id, tab) {
  const hash = page === 'home' ? '#' : `#project/${id}/${tab || 'info'}`;
  history.replaceState(null, '', hash);
}

window.addEventListener('popstate', () => {
  const r = parseHash();
  if (r.page === 'project') {
    _openProject(r.id, r.tab);
  } else {
    _showHome();
  }
});

// ============================================================
// SIDEBAR
// ============================================================
const $sidebar = document.getElementById('sidebar');
const $overlay = document.getElementById('overlay');

document.getElementById('hamburger').addEventListener('click', () => {
  $sidebar.classList.toggle('open');
  $overlay.classList.toggle('show');
});
$overlay.addEventListener('click', closeSidebar);

function closeSidebar() {
  $sidebar.classList.remove('open');
  $overlay.classList.remove('show');
}

function renderSidebar() {
  const list = document.getElementById('project-list');
  list.innerHTML = '';

  if (!projects.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:10px 12px;font-size:12px;color:var(--text3);';
    empty.textContent = 'プロジェクトなし';
    list.appendChild(empty);
    return;
  }

  [...projects].reverse().forEach(p => {
    const item = document.createElement('div');
    item.className = 'project-item' + (p.id === currentProjectId ? ' active' : '');
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');

    // icon area
    const iconWrap = document.createElement('div');
    iconWrap.className = 'project-item-icon';
    if (p.icon) {
      const img = document.createElement('img');
      img.src = p.icon; img.className = 'pack-img'; img.alt = '';
      iconWrap.appendChild(img);
    } else {
      iconWrap.appendChild(iconEl('pack-default', 16, 'muted'));
    }

    const info = document.createElement('div');
    info.className = 'project-item-info';
    info.innerHTML = `
      <div class="project-item-name">${esc(p.name)}</div>
      <div class="project-item-meta">${(p.functions || []).length} 関数</div>`;

    const delBtn = document.createElement('button');
    delBtn.className = 'project-item-del';
    delBtn.title = '削除';
    delBtn.setAttribute('aria-label', `${p.name}を削除`);
    delBtn.appendChild(iconEl('trash', 13, 'red'));

    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      confirmDlg(`「${esc(p.name)}」を削除しますか？`, async () => {
        projects = projects.filter(x => x.id !== p.id);
        await dbDelete(p.id);
        if (currentProjectId === p.id) { pushHash('home'); _showHome(); }
        renderSidebar();
        renderHomeProjects();
        toast('削除しました', 'inf');
      }, { title: 'プロジェクト削除', yes: '削除する' });
    });

    const go = () => {
      pushHash('project', p.id, 'info');
      _openProject(p.id, 'info');
      closeSidebar();
    };
    item.addEventListener('click', go);
    item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') go(); });

    item.appendChild(iconWrap);
    item.appendChild(info);
    item.appendChild(delBtn);
    list.appendChild(item);
  });
}

// ============================================================
// HOME SCREEN
// ============================================================
function renderHomeProjects() {
  const grid = document.getElementById('home-projects-grid');
  const sec  = document.getElementById('home-projects-section');
  const emp  = document.getElementById('home-empty');
  grid.innerHTML = '';

  if (!projects.length) {
    sec.classList.add('hidden');
    emp.classList.remove('hidden');
    return;
  }

  sec.classList.remove('hidden');
  emp.classList.add('hidden');

  [...projects].reverse().forEach(p => {
    const card = document.createElement('div');
    card.className = 'project-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');

    // icon
    const iconWrap = document.createElement('div');
    iconWrap.className = 'project-card-icon';
    if (p.icon) {
      const img = document.createElement('img');
      img.src = p.icon; img.className = 'pack-img'; img.alt = '';
      iconWrap.appendChild(img);
    } else {
      iconWrap.appendChild(iconEl('pack-default', 20, 'muted'));
    }

    const headerInfo = document.createElement('div');
    headerInfo.innerHTML = `
      <div class="project-card-name">${esc(p.name)}</div>
      <div class="project-card-ver">v${p.version.join('.')} · engine ${p.engineVersion.join('.')}</div>`;

    const header = document.createElement('div');
    header.className = 'project-card-header';
    header.appendChild(iconWrap);
    header.appendChild(headerInfo);

    card.appendChild(header);

    if (p.desc) {
      const desc = document.createElement('div');
      desc.className = 'project-card-desc';
      desc.textContent = p.desc;
      card.appendChild(desc);
    }

    const footer = document.createElement('div');
    footer.className = 'project-card-footer';

    const meta = document.createElement('div');
    meta.className = 'project-card-meta';
    meta.textContent = `${(p.functions || []).length} 関数 · ${new Date(p.updatedAt).toLocaleDateString('ja-JP')}`;

    const delBtn = document.createElement('button');
    delBtn.className = 'card-del-btn';
    delBtn.title = '削除';
    delBtn.appendChild(iconEl('trash', 13, 'red'));
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      confirmDlg(`「${esc(p.name)}」を削除しますか？`, async () => {
        projects = projects.filter(x => x.id !== p.id);
        await dbDelete(p.id);
        renderHomeProjects();
        renderSidebar();
        toast('削除しました', 'inf');
      }, { title: 'プロジェクト削除', yes: '削除する' });
    });

    footer.appendChild(meta);
    footer.appendChild(delBtn);
    card.appendChild(footer);

    const go = () => {
      pushHash('project', p.id, 'info');
      _openProject(p.id, 'info');
    };
    card.addEventListener('click', e => { if (!e.target.closest('.card-del-btn')) go(); });
    card.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });

    grid.appendChild(card);
  });
}

// ============================================================
// NEW PROJECT DIALOG
// ============================================================
function openNewProjectDlg() {
  const bd = openModal(`
    <div class="modal-header">
      <h2>新規プロジェクト</h2>
      <button class="modal-close" aria-label="閉じる">
        <span class="icon icon-muted" style="width:14px;height:14px;"><img src="${ICON_PATH}close.svg" width="14" height="14" alt=""></span>
      </button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label" for="np-name">プロジェクト名<span class="req">*</span></label>
        <input type="text" class="form-input" id="np-name" placeholder="My Behavior Pack" autocomplete="off">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-ghost" id="np-cancel">キャンセル</button>
      <button class="btn-primary" id="np-ok">
        <span class="icon icon-text" style="width:13px;height:13px;"><img src="${ICON_PATH}plus.svg" width="13" height="13" alt=""></span>
        作成
      </button>
    </div>`, { sm: true });

  const inp = bd.querySelector('#np-name');
  bd.querySelector('#np-cancel').onclick = () => closeModal(bd);

  const doCreate = async () => {
    const name = inp.value.trim();
    if (!name) { toast('プロジェクト名を入力してください', 'err'); return; }
    const p = makeProject(name);
    projects.push(p);
    await dbPut(p);
    closeModal(bd);
    closeSidebar();
    renderSidebar();
    renderHomeProjects();
    pushHash('project', p.id, 'info');
    _openProject(p.id, 'info');
    toast('プロジェクトを作成しました');
  };

  bd.querySelector('#np-ok').onclick = doCreate;
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') doCreate(); });
}

document.getElementById('home-new-btn').addEventListener('click', openNewProjectDlg);
document.getElementById('sidebar-new-btn').addEventListener('click', openNewProjectDlg);

// ============================================================
// SHOW HOME / OPEN PROJECT
// ============================================================
function _showHome() {
  currentProjectId = null;

  document.getElementById('home-screen').classList.add('visible');
  document.getElementById('home-screen').style.display = '';
  document.getElementById('editor-screen').classList.remove('visible');
  document.getElementById('editor-screen').style.display = 'none';

  // topbar
  document.getElementById('topbar-app-name').classList.remove('hidden');
  document.getElementById('topbar-home-btn').classList.add('hidden');
  document.getElementById('topbar-sep').classList.add('hidden');
  document.getElementById('topbar-proj-name').classList.add('hidden');

  renderSidebar();
}

function _openProject(id, tab) {
  const p = projects.find(x => x.id === id);
  if (!p) { _showHome(); replaceHash('home'); return; }

  currentProjectId = id;

  document.getElementById('home-screen').classList.remove('visible');
  document.getElementById('home-screen').style.display = 'none';
  document.getElementById('editor-screen').classList.add('visible');
  document.getElementById('editor-screen').style.display = 'flex';

  // topbar breadcrumb
  document.getElementById('topbar-app-name').classList.add('hidden');
  document.getElementById('topbar-home-btn').classList.remove('hidden');
  document.getElementById('topbar-sep').classList.remove('hidden');
  const pnEl = document.getElementById('topbar-proj-name');
  pnEl.classList.remove('hidden');
  pnEl.textContent = p.name;

  loadFormFromProject(p);
  renderSidebar();
  switchTab(tab || 'info', false);
}

document.getElementById('topbar-home-btn').addEventListener('click', () => {
  pushHash('home');
  _showHome();
});

// ============================================================
// TABS
// ============================================================
function switchTab(tab, updateURL = true) {
  currentTab = tab;

  document.querySelectorAll('.editor-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
  document.getElementById('tab-' + tab).classList.remove('hidden');

  if (updateURL && currentProjectId) {
    replaceHash('project', currentProjectId, tab);
  }

  updatePreview();
  if (tab === 'functions') renderFunctionsList();
  if (tab === 'export')    renderExportTree();
}

document.querySelectorAll('.editor-tab').forEach(t => {
  t.addEventListener('click', () => switchTab(t.dataset.tab));
});

// ============================================================
// FORM ↔ PROJECT
// ============================================================
function loadFormFromProject(p) {
  document.getElementById('proj-name').value  = p.name || '';
  document.getElementById('proj-desc').value  = p.desc || '';
  document.getElementById('ver-major').value  = p.version[0];
  document.getElementById('ver-minor').value  = p.version[1];
  document.getElementById('ver-patch').value  = p.version[2];
  document.getElementById('eng-major').value  = p.engineVersion[0];
  document.getElementById('eng-minor').value  = p.engineVersion[1];
  document.getElementById('eng-patch').value  = p.engineVersion[2];

  const box = document.getElementById('icon-preview-box');
  const defaultIcon = document.getElementById('icon-default-icon');
  const existingPackImg = box.querySelector('img.pack-img');
  if (existingPackImg) existingPackImg.remove();

  if (p.icon) {
    const img = document.createElement('img');
    img.src = p.icon; img.className = 'pack-img'; img.alt = 'パックアイコン';
    defaultIcon.classList.add('hidden');
    box.appendChild(img);
  } else {
    defaultIcon.classList.remove('hidden');
  }
}

function readFormToProject() {
  const p = getProj();
  if (!p) return;

  p.name = document.getElementById('proj-name').value.trim() || '新規プロジェクト';
  p.desc = document.getElementById('proj-desc').value.trim();
  p.version = [
    parseInt(document.getElementById('ver-major').value) || 1,
    parseInt(document.getElementById('ver-minor').value) || 0,
    parseInt(document.getElementById('ver-patch').value) || 0,
  ];
  p.engineVersion = [
    parseInt(document.getElementById('eng-major').value) || 1,
    parseInt(document.getElementById('eng-minor').value) || 26,
    parseInt(document.getElementById('eng-patch').value) || 30,
  ];

  saveDefaultEngVer(p.engineVersion);

  document.getElementById('topbar-proj-name').textContent = p.name;
  renderSidebar();
}

const autoSave = debounce(async () => {
  readFormToProject();
  await persist();
  updatePreview();
}, 400);

document.getElementById('proj-name').addEventListener('input', autoSave);
document.getElementById('proj-desc').addEventListener('input', autoSave);

// Version segment keyboard navigation
function setupVersionSegs(ids) {
  ids.forEach((id, i) => {
    const el = document.getElementById(id);
    el.addEventListener('focus', () => el.select());
    el.addEventListener('input', () => {
      const v = parseInt(el.value);
      const mn = parseInt(el.min) || 0;
      const mx = parseInt(el.max) || 99;
      el.value = isNaN(v) ? mn : Math.max(mn, Math.min(mx, v));
      autoSave();
    });
    el.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
        if (i < ids.length - 1) {
          e.preventDefault();
          const next = document.getElementById(ids[i + 1]);
          next.focus(); next.select();
        }
      }
      if (e.key === 'Backspace' && el.value === '' && i > 0) {
        e.preventDefault();
        document.getElementById(ids[i - 1]).focus();
      }
    });
  });
}
setupVersionSegs(['ver-major', 'ver-minor', 'ver-patch']);
setupVersionSegs(['eng-major', 'eng-minor', 'eng-patch']);

// Icon upload
document.getElementById('icon-select-btn').addEventListener('click', () => {
  document.getElementById('icon-file').click();
});
document.getElementById('icon-preview-box').addEventListener('click', () => {
  document.getElementById('icon-file').click();
});
document.getElementById('icon-preview-box').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') document.getElementById('icon-file').click();
});

document.getElementById('icon-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async ev => {
    const p = getProj();
    if (!p) return;
    p.icon = ev.target.result;

    const box = document.getElementById('icon-preview-box');
    const defIcon = document.getElementById('icon-default-icon');
    const old = box.querySelector('img.pack-img');
    if (old) old.remove();
    const img = document.createElement('img');
    img.src = p.icon; img.className = 'pack-img'; img.alt = 'パックアイコン';
    defIcon.classList.add('hidden');
    box.appendChild(img);

    await persist();
    updatePreview();
    renderSidebar();
  };
  reader.readAsDataURL(file);
});

// ============================================================
// PREVIEW PANEL
// ============================================================
function updatePreview() {
  const p = getProj();
  if (!p) return;

  const fnEl  = document.getElementById('preview-filename');
  const codeEl = document.getElementById('preview-code');

  if (currentTab === 'functions') {
    fnEl.textContent = 'functions/tick.json';
    const tickFns = (p.functions || []).filter(f => f.tick);
    const obj = {
      values: tickFns.map(fn => {
        const fld = (p.folders || []).find(f => f.id === fn.folder);
        return fld ? `${fld.name}/${fn.name}` : fn.name;
      })
    };
    codeEl.innerHTML = renderJsonLines(JSON.stringify(obj, null, 2));
  } else {
    fnEl.textContent = 'manifest.json';
    codeEl.innerHTML = renderJsonLines(JSON.stringify(buildManifest(p), null, 2));
  }
}

function buildManifest(p) {
  return {
    format_version: 2,
    header: {
      name:              p.name || 'My Pack',
      description:       p.desc || '',
      uuid:              p.uuid1,
      version:           p.version,
      min_engine_version: p.engineVersion,
    },
    modules: [{
      type:    'data',
      uuid:    p.uuid2,
      version: p.version,
    }],
  };
}

function renderJsonLines(jsonStr) {
  return jsonStr.split('\n').map((line, i) =>
    `<div class="code-line"><span class="code-ln">${i + 1}</span><span class="code-c">${colorJson(line)}</span></div>`
  ).join('');
}

function colorJson(line) {
  return esc(line)
    .replace(/(&quot;)((?:[^&]|&amp;|&lt;|&gt;)*)(&quot;)(\s*:)/g, '<span class="j-key">$1$2$3</span><span class="j-pun">$4</span>')
    .replace(/:\s*(&quot;)((?:[^&]|&amp;|&lt;|&gt;)*)(&quot;)/g,   ': <span class="j-str">$1$2$3</span>')
    .replace(/:\s*(\d+(?:\.\d+)?)/g,                                ': <span class="j-num">$1</span>')
    .replace(/:\s*(true|false)/g,                                    ': <span class="j-bool">$1</span>')
    .replace(/:\s*(null)/g,                                          ': <span class="j-null">$1</span>')
    .replace(/([{}\[\],])/g,                                         '<span class="j-pun">$1</span>');
}

// ============================================================
// RESIZE HANDLE
// ============================================================
(function initResize() {
  const handle = document.getElementById('resize-handle');
  const left   = document.getElementById('panel-left');
  const right  = document.getElementById('panel-right');
  const body   = document.getElementById('editor-body');

  let dragging = false;
  let startX   = 0;
  let startLW  = 0;

  function startDrag(cx) {
    dragging = true;
    startX   = cx;
    startLW  = left.offsetWidth;
    handle.classList.add('active');
    document.body.style.cursor     = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function moveDrag(cx) {
    if (!dragging) return;
    const total  = body.offsetWidth - handle.offsetWidth;
    const newLW  = Math.max(180, Math.min(total - 150, startLW + (cx - startX)));
    left.style.width  = newLW + 'px';
    left.style.flex   = 'none';
    right.style.width = (total - newLW) + 'px';
    right.style.flex  = 'none';
  }

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('active');
    document.body.style.cursor     = '';
    document.body.style.userSelect = '';
  }

  handle.addEventListener('mousedown',  e => startDrag(e.clientX));
  handle.addEventListener('touchstart', e => startDrag(e.touches[0].clientX), { passive: true });
  document.addEventListener('mousemove',  e => moveDrag(e.clientX));
  document.addEventListener('touchmove',  e => moveDrag(e.touches[0].clientX), { passive: true });
  document.addEventListener('mouseup',   endDrag);
  document.addEventListener('touchend',  endDrag);
})();

// ============================================================
// FUNCTIONS LIST
// ============================================================
function renderFunctionsList() {
  const p = getProj();
  if (!p) return;

  const list  = document.getElementById('functions-list');
  const empty = document.getElementById('func-empty');
  list.innerHTML = '';

  const hasAnything =
    (p.folders && p.folders.length > 0) ||
    (p.functions && p.functions.some(f => !f.folder));

  empty.classList.toggle('hidden', hasAnything);

  (p.folders   || []).forEach(fld => list.appendChild(makeFolderEl(fld, p)));
  (p.functions || []).filter(f => !f.folder).forEach(fn => list.appendChild(makeFuncEl(fn, p)));
  list.appendChild(empty);
}

function makeFolderEl(folder, p) {
  const el = document.createElement('div');
  el.className = 'folder-item';

  const children = (p.functions || []).filter(f => f.folder === folder.id);
  const isOpen   = folder.open !== false;

  // header
  const hdr = document.createElement('div');
  hdr.className = 'folder-header';

  const arrow = document.createElement('span');
  arrow.className = 'folder-arrow' + (isOpen ? ' open' : '');
  arrow.appendChild(iconEl('chevron-right', 12, 'muted'));

  const folderIcon = iconEl('folder', 14, 'muted');

  const nameEl = document.createElement('span');
  nameEl.className   = 'folder-name';
  nameEl.textContent = folder.name + '/';

  const countEl = document.createElement('span');
  countEl.className   = 'folder-count';
  countEl.textContent = children.length;

  const acts = document.createElement('div');
  acts.className = 'folder-acts';

  const renBtn = document.createElement('button');
  renBtn.className = 'icon-btn';
  renBtn.title = '名前を変更';
  renBtn.appendChild(iconEl('edit', 13, 'muted'));

  const delBtn = document.createElement('button');
  delBtn.className = 'icon-btn danger';
  delBtn.title = '削除';
  delBtn.appendChild(iconEl('trash', 13, 'muted'));

  acts.appendChild(renBtn);
  acts.appendChild(delBtn);
  hdr.appendChild(arrow);
  hdr.appendChild(folderIcon);
  hdr.appendChild(nameEl);
  hdr.appendChild(countEl);
  hdr.appendChild(acts);

  // children container
  const childrenEl = document.createElement('div');
  childrenEl.className = 'folder-children' + (isOpen ? '' : ' closed');

  if (children.length === 0) {
    const hint = document.createElement('div');
    hint.className   = 'folder-empty-hint';
    hint.textContent = '（空のフォルダ）';
    childrenEl.appendChild(hint);
  } else {
    children.forEach(fn => childrenEl.appendChild(makeFuncEl(fn, p)));
  }

  // toggle
  hdr.addEventListener('click', e => {
    if (e.target.closest('.folder-acts')) return;
    folder.open = !folder.open;
    arrow.classList.toggle('open', folder.open);
    childrenEl.classList.toggle('closed', !folder.open);
    persist();
  });

  // rename
  renBtn.addEventListener('click', e => { e.stopPropagation(); openRenameFolderDlg(folder); });

  // delete
  delBtn.addEventListener('click', e => {
    e.stopPropagation();
    const cnt = children.length;
    if (cnt > 0) {
      confirmDlg(
        `「${esc(folder.name)}」を削除しますか？<br>フォルダ内に <strong>${cnt} 個の関数</strong> があります。まとめて削除しますか？`,
        async () => {
          const pp = getProj();
          pp.functions = (pp.functions || []).filter(f => f.folder !== folder.id);
          pp.folders   = (pp.folders   || []).filter(f => f.id     !== folder.id);
          await persist();
          renderFunctionsList();
          updatePreview();
          toast('フォルダを削除しました', 'inf');
        },
        { title: 'フォルダ削除', yes: 'すべて削除' }
      );
    } else {
      confirmDlg(`「${esc(folder.name)}」を削除しますか？`, async () => {
        const pp = getProj();
        pp.folders = (pp.folders || []).filter(f => f.id !== folder.id);
        await persist();
        renderFunctionsList();
        toast('フォルダを削除しました', 'inf');
      }, { title: 'フォルダ削除', yes: '削除する' });
    }
  });

  el.appendChild(hdr);
  el.appendChild(childrenEl);
  return el;
}

function makeFuncEl(fn, p) {
  const el = document.createElement('div');
  el.className = 'func-item';

  const lineCount = (fn.body || '').split('\n').filter(l => l.trim()).length;

  const ico = iconEl('function', 13, 'blue');

  const info = document.createElement('div');
  info.className = 'func-item-info';
  info.innerHTML = `
    <div class="func-item-name">${esc(fn.name)}.mcfunction</div>
    <div class="func-item-meta">${lineCount} 行のコマンド</div>`;

  const acts = document.createElement('div');
  acts.className = 'func-item-acts';

  const editBtn = document.createElement('button');
  editBtn.className = 'icon-btn';
  editBtn.title = '編集';
  editBtn.appendChild(iconEl('edit', 13, 'muted'));

  const delBtn = document.createElement('button');
  delBtn.className = 'icon-btn danger';
  delBtn.title = '削除';
  delBtn.appendChild(iconEl('trash', 13, 'muted'));

  acts.appendChild(editBtn);
  acts.appendChild(delBtn);

  el.appendChild(ico);
  el.appendChild(info);

  if (fn.tick) {
    const badge = document.createElement('span');
    badge.className = 'tick-badge';
    badge.appendChild(iconEl('clock', 11, 'accent'));
    const label = document.createElement('span');
    label.textContent = '常に実行';
    badge.appendChild(label);
    el.appendChild(badge);
  }

  el.appendChild(acts);

  const open = () => openFuncEditor(fn.id);
  el.addEventListener('click', e => { if (!e.target.closest('.func-item-acts')) open(); });
  editBtn.addEventListener('click', open);
  delBtn.addEventListener('click', () => {
    confirmDlg(`「${esc(fn.name)}.mcfunction」を削除しますか？`, async () => {
      const pp = getProj();
      pp.functions = pp.functions.filter(f => f.id !== fn.id);
      await persist();
      renderFunctionsList();
      updatePreview();
      toast('関数を削除しました', 'inf');
    }, { title: '関数削除', yes: '削除する' });
  });

  return el;
}

// ============================================================
// ADD FOLDER DIALOG
// ============================================================
document.getElementById('add-folder-btn').addEventListener('click', () => {
  const bd = openModal(`
    <div class="modal-header">
      <h2>フォルダを追加</h2>
      <button class="modal-close"><span class="icon icon-muted" style="width:14px;height:14px;"><img src="${ICON_PATH}close.svg" width="14" height="14" alt=""></span></button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label" for="nf-name">フォルダ名<span class="req">*</span></label>
        <input type="text" class="form-input" id="nf-name" placeholder="my_folder" autocomplete="off">
        <div style="font-size:11px;color:var(--text3);margin-top:5px;font-family:'JetBrains Mono',monospace;">
          functions/<em>フォルダ名</em>/ に作成されます
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-ghost" id="nf-cancel">キャンセル</button>
      <button class="btn-primary" id="nf-ok">
        <span class="icon icon-text" style="width:13px;height:13px;"><img src="${ICON_PATH}plus.svg" width="13" height="13" alt=""></span>
        作成
      </button>
    </div>`, { sm: true });

  const inp = bd.querySelector('#nf-name');
  bd.querySelector('#nf-cancel').onclick = () => closeModal(bd);

  const go = async () => {
    const name = sanitizeName(inp.value.trim());
    if (!name) { toast('フォルダ名を入力してください', 'err'); return; }
    const pp = getProj();
    if ((pp.folders || []).some(f => f.name === name)) {
      toast('同名のフォルダがすでに存在します', 'err'); return;
    }
    if (!pp.folders) pp.folders = [];
    pp.folders.push({ id: 'fld' + Date.now(), name, open: true });
    await persist();
    closeModal(bd);
    renderFunctionsList();
    toast('フォルダを追加しました');
  };

  bd.querySelector('#nf-ok').onclick = go;
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
});

// ============================================================
// RENAME FOLDER DIALOG
// ============================================================
function openRenameFolderDlg(folder) {
  const bd = openModal(`
    <div class="modal-header">
      <h2>フォルダ名を変更</h2>
      <button class="modal-close"><span class="icon icon-muted" style="width:14px;height:14px;"><img src="${ICON_PATH}close.svg" width="14" height="14" alt=""></span></button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label" for="rnf-inp">新しい名前</label>
        <input type="text" class="form-input" id="rnf-inp" value="${esc(folder.name)}" autocomplete="off">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-ghost" id="rnf-cancel">キャンセル</button>
      <button class="btn-primary" id="rnf-ok">保存</button>
    </div>`, { sm: true });

  const inp = bd.querySelector('#rnf-inp');
  bd.querySelector('#rnf-cancel').onclick = () => closeModal(bd);

  const go = async () => {
    const name = sanitizeName(inp.value.trim());
    if (!name) { toast('名前を入力してください', 'err'); return; }
    const pp = getProj();
    if ((pp.folders || []).some(f => f.name === name && f.id !== folder.id)) {
      toast('同名のフォルダがすでに存在します', 'err'); return;
    }
    folder.name = name;
    await persist();
    closeModal(bd);
    renderFunctionsList();
    toast('フォルダ名を変更しました');
  };

  bd.querySelector('#rnf-ok').onclick = go;
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}

// ============================================================
// FUNCTION EDITOR MODAL
// ============================================================
document.getElementById('add-func-btn').addEventListener('click', () => openFuncEditor(null));

function openFuncEditor(fnId) {
  const p     = getProj();
  if (!p) return;
  const isNew = fnId === null;
  const fn    = isNew
    ? { id: 'fn' + Date.now() + Math.random().toString(36).slice(2, 5), name: '', body: '', tick: false, folder: null }
    : (p.functions || []).find(f => f.id === fnId);
  if (!fn) return;

  // Build folder options HTML
  const folderOptsHtml = (p.folders || []).map(f =>
    `<option value="${esc(f.id)}"${fn.folder === f.id ? ' selected' : ''}>${esc(f.name)}/</option>`
  ).join('');

  const hasFolders = p.folders && p.folders.length > 0;

  const bd = openModal(`
    <div class="modal-header">
      <h2>${isNew ? '関数を追加' : '関数を編集'}</h2>
      <button class="modal-close"><span class="icon icon-muted" style="width:14px;height:14px;"><img src="${ICON_PATH}close.svg" width="14" height="14" alt=""></span></button>
    </div>
    <div class="modal-body">
      <div class="func-meta-row">
        <div class="func-name-grp form-group" style="margin-bottom:0;">
          <label class="form-label" for="fn-name">関数名<span class="req">*</span></label>
          <input type="text" class="form-input" id="fn-name" placeholder="my_function" value="${esc(fn.name)}" autocomplete="off">
          <div class="path-preview" id="fn-path"></div>
        </div>
        ${hasFolders ? `
        <div class="func-folder-grp form-group" style="margin-bottom:0;">
          <label class="form-label" for="fn-folder">フォルダ</label>
          <select class="form-select" id="fn-folder">
            <option value="">— ルート —</option>
            ${folderOptsHtml}
          </select>
        </div>` : ''}
        <div class="func-tick-grp">
          <label class="tick-toggle" for="fn-tick">
            <input type="checkbox" id="fn-tick"${fn.tick ? ' checked' : ''}>
            <div class="tick-rail"></div>
          </label>
          <span class="tick-label">常に実行<br><span style="font-size:10px;color:var(--text3);">(tick.json)</span></span>
        </div>
      </div>

      <div class="form-group" style="margin-top:14px;margin-bottom:0;">
        <label class="form-label">コマンド</label>
        <div class="editor-wrap">
          <div class="editor-topbar">
            <span class="lang-badge">.mcfunction</span>
            <span class="editor-hint">先頭の / はフォーカスを外すと自動削除されます</span>
          </div>
          <div class="editor-scroll" id="fn-scroll">
            <div class="editor-gutter" id="fn-gutter"></div>
            <div class="editor-inner">
              <div class="slash-overlay" id="fn-overlay"></div>
              <textarea class="editor-ta" id="fn-body" spellcheck="false"
                placeholder="say Hello World&#10;give @a diamond 1">${esc(fn.body || '')}</textarea>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-ghost" id="fn-cancel">キャンセル</button>
      <button class="btn-primary" id="fn-save">
        <span class="icon icon-text" style="width:13px;height:13px;"><img src="${ICON_PATH}check.svg" width="13" height="13" alt=""></span>
        ${isNew ? '追加' : '保存'}
      </button>
    </div>`);

  const ta        = bd.querySelector('#fn-body');
  const gutter    = bd.querySelector('#fn-gutter');
  const overlay   = bd.querySelector('#fn-overlay');
  const nameInp   = bd.querySelector('#fn-name');
  const folderSel = bd.querySelector('#fn-folder');
  const pathEl    = bd.querySelector('#fn-path');

  function updateGutterOverlay() {
    const lines = ta.value.split('\n');
    gutter.innerHTML  = lines.map((line, i) => {
      const slash = line.trimStart().startsWith('/');
      return `<span class="gutter-num${slash ? ' slash' : ''}">${i + 1}</span>`;
    }).join('');
    overlay.innerHTML = lines.map(line => {
      const slash = line.trimStart().startsWith('/');
      return `<div class="sol${slash ? ' has-slash' : ''}"></div>`;
    }).join('');
  }

  function syncScroll() {
    gutter.style.marginTop  = -ta.scrollTop + 'px';
    overlay.style.marginTop = -ta.scrollTop + 'px';
  }

  function updatePath() {
    const name = nameInp.value.trim() || '<name>';
    let fldName = '';
    if (folderSel) {
      const fld = (p.folders || []).find(f => f.id === folderSel.value);
      if (fld) fldName = fld.name + '/';
    }
    pathEl.textContent = `functions/${fldName}${name}.mcfunction`;
  }

  updateGutterOverlay();
  updatePath();

  ta.addEventListener('input',  updateGutterOverlay);
  ta.addEventListener('scroll', syncScroll);
  nameInp.addEventListener('input', updatePath);
  if (folderSel) folderSel.addEventListener('change', updatePath);

  // Auto-remove leading slash on blur
  ta.addEventListener('blur', () => {
    const cleaned = ta.value.split('\n').map(line => {
      return line.trimStart().startsWith('/') ? line.replace(/^(\s*)\//, '$1') : line;
    }).join('\n');
    if (cleaned !== ta.value) {
      ta.value = cleaned;
      updateGutterOverlay();
      toast('先頭の / を自動削除しました', 'inf');
    }
  });

  bd.querySelector('#fn-cancel').onclick = () => closeModal(bd);

  bd.querySelector('#fn-save').onclick = async () => {
    const name     = sanitizeName(nameInp.value.trim());
    if (!name) { toast('関数名を入力してください', 'err'); return; }

    const folderId = folderSel ? (folderSel.value || null) : null;
    const dup = (p.functions || []).find(f =>
      f.name === name && f.folder === folderId && f.id !== fn.id
    );
    if (dup) { toast('同じフォルダに同名の関数があります', 'err'); return; }

    fn.name   = name;
    fn.body   = ta.value;
    fn.tick   = bd.querySelector('#fn-tick').checked;
    fn.folder = folderId;

    if (isNew) {
      if (!p.functions) p.functions = [];
      p.functions.push(fn);
    }

    await persist();
    closeModal(bd);
    renderFunctionsList();
    updatePreview();
    toast(isNew ? '関数を追加しました' : '関数を保存しました');
  };
}

// ============================================================
// EXPORT
// ============================================================
function renderExportTree() {
  const p = getProj();
  if (!p) return;
  updatePreview();

  const lines = [];
  lines.push(`${p.name || 'pack'}/`);
  lines.push(`  manifest.json`);
  if (p.icon) lines.push(`  pack_icon.png`);
  lines.push(`  functions/`);
  (p.folders || []).forEach(f => {
    lines.push(`    ${f.name}/`);
    (p.functions || []).filter(fn => fn.folder === f.id).forEach(fn => {
      lines.push(`      ${fn.name}.mcfunction`);
    });
  });
  (p.functions || []).filter(fn => !fn.folder).forEach(fn => {
    lines.push(`    ${fn.name}.mcfunction`);
  });
  if ((p.functions || []).some(f => f.tick)) {
    lines.push(`    tick.json`);
  }
  document.getElementById('export-tree').textContent = lines.join('\n');
}

// Export format radio
document.querySelectorAll('.radio-opt').forEach(opt => {
  opt.addEventListener('click', () => {
    document.querySelectorAll('.radio-opt').forEach(o => o.classList.remove('sel'));
    opt.classList.add('sel');
    opt.querySelector('input').checked = true;
  });
});

document.getElementById('export-btn').addEventListener('click', async () => {
  const p = getProj();
  if (!p) return;
  if (!p.name) { toast('パック名を入力してください', 'err'); return; }

  const fmt = document.querySelector('input[name="export-fmt"]:checked').value;
  const zip = new JSZip();
  const root = zip.folder(p.name);

  root.file('manifest.json', JSON.stringify(buildManifest(p), null, 2));

  if (p.icon) {
    const b64 = p.icon.split(',')[1];
    root.file('pack_icon.png', b64, { base64: true });
  }

  const fnFolder = root.folder('functions');

  (p.folders || []).forEach(f => {
    const sub = fnFolder.folder(f.name);
    (p.functions || []).filter(fn => fn.folder === f.id).forEach(fn => {
      sub.file(fn.name + '.mcfunction', fn.body || '');
    });
  });

  (p.functions || []).filter(fn => !fn.folder).forEach(fn => {
    fnFolder.file(fn.name + '.mcfunction', fn.body || '');
  });

  const tickFns = (p.functions || []).filter(f => f.tick);
  if (tickFns.length > 0) {
    const tickObj = {
      values: tickFns.map(fn => {
        const fld = (p.folders || []).find(f => f.id === fn.folder);
        return fld ? `${fld.name}/${fn.name}` : fn.name;
      }),
    };
    fnFolder.file('tick.json', JSON.stringify(tickObj, null, 2));
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const ext  = fmt === 'mcaddon' ? 'mcaddon' : 'zip';
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${sanitizeName(p.name) || 'pack'}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast(`${ext} をダウンロードしました`);
});

// ============================================================
// INIT
// ============================================================
async function init() {
  await initDB();
  projects = await dbGetAll();

  renderSidebar();
  renderHomeProjects();

  const route = parseHash();
  if (route.page === 'project') {
    const found = projects.find(p => p.id === route.id);
    if (found) {
      _openProject(route.id, route.tab);
    } else {
      _showHome();
      replaceHash('home');
    }
  } else {
    _showHome();
  }
}

init();
