// 🍊 橘子窝 · 内容管理后台前端逻辑（富文本编辑器版）
// 使用 Quill 富文本编辑器 + marked（把旧 Markdown 转 HTML）
(() => {
  'use strict';

  // ---------- 状态 ----------
  let posts = [];
  let dirs = [];
  let tags = []; // 标签池
  let selectedTags = []; // 当前文章选中的标签
  let siteBase = '/'; // 站点子路径（来自 astro.config 的 base）
  let current = null; // 当前编辑的文章，新建时为 null
  let dirty = false;

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const postListEl = $('post-list');
  const dirListEl = $('dir-list');
  const searchEl = $('search');
  const editorEmpty = $('editor-empty');
  const editorForm = $('editor-form');
  const statusBadge = $('status-badge');
  const editorStatus = $('editor-status');
  const toastEl = $('toast');
  const publishModal = $('publish-modal');
  const publishOutput = $('publish-output');
  const viewLink = $('btn-view');

  // ---------- 工具 ----------
  function toast(msg, isError = false) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('error', isError);
    toastEl.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.add('hidden'), 2600);
  }

  async function api(url, options) {
    const res = await fetch(url, options);
    const isJson = res.headers.get('content-type')?.includes('json');
    const data = isJson ? await res.json() : await res.text();
    if (!res.ok) throw new Error(data.error || data || `请求失败（${res.status}）`);
    return data;
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // 把文章正文转成编辑器 HTML：已是 HTML 直接用，否则用 marked 转
  function bodyToHtml(body) {
    const b = body || '';
    try {
      if (/<[a-z][\s\S]*>/i.test(b)) return b; // 已含 HTML 标签
      if (window.marked && typeof window.marked.parse === 'function') {
        return window.marked.parse(b);
      }
      return '<p>' + escapeHtml(b).replace(/\n/g, '<br>') + '</p>';
    } catch (e) {
      console.error('正文转换失败：', e);
      return '<p>' + escapeHtml(b).replace(/\n/g, '<br>') + '</p>';
    }
  }

  // ---------- Quill 富文本编辑器 ----------
  const Size = Quill.import('attributors/style/size');
  Size.whitelist = ['12px', '14px', '16px', '18px', '24px', '32px'];
  Quill.register(Size, true);

  const quill = new Quill('#f-editor', {
    theme: 'snow',
    placeholder: '在这里写正文，就像用 Word 一样：选中文字 → 点工具栏的加粗、字号、颜色…',
    modules: {
      toolbar: '#f-toolbar',
    },
  });

  quill.on('text-change', () => {
    dirty = true;
    updatePreview();
  });

  // 直接写入内容（比 clipboard.convert 更稳妥），失败也有兜底
  function setEditorHtml(html) {
    try {
      quill.root.innerHTML = html || '';
    } catch (e) {
      console.error('编辑器内容加载失败：', e);
      quill.root.innerHTML = '';
    }
    quill.setSelection(0, 0, 'silent');
    updatePreview();
    dirty = false;
  }

  // 右侧实时预览（模拟博客正文排版）
  function updatePreview() {
    const el = $('f-preview');
    if (el) {
      el.innerHTML = quill.root.innerHTML || '<p style="color:var(--text-muted)">开始输入内容，右侧会实时显示效果</p>';
    }
  }

  // ---------- 图片大小 / 对齐（自定义 image handler + 浮动设置面板） ----------
  const imgPanel = $('img-panel');
  const imgWidth = $('img-width');
  const imgWidthVal = $('img-width-val');
  const imgAlignBtns = Array.from(document.querySelectorAll('.img-align button[data-align]'));
  const imgDelBtn = $('img-del');
  let currentImg = null; // 当前选中的 <img> DOM
  let currentImgRange = null; // 对应的 Quill Range
  let lastSel = null; // 最后一次光标位置（图片库「插入正文」用）

  // 覆盖 Quill 默认图片插入：读本地文件 → base64 → 插入并选中 → 自动弹出设置面板
  quill.getModule('toolbar').addHandler('image', () => {
    const range = quill.getSelection(true);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const index = range && range.index != null ? range.index : quill.getLength();
        quill.insertEmbed(index, 'image', reader.result, 'user');
        quill.setSelection(index, 1, 'silent'); // 选中刚插入的图片 → 自动弹面板
        updatePreview();
      };
      reader.readAsDataURL(file);
    };
    input.click();
  });

  // 监听选区变化：选中的是单张图片时显示设置面板
  // 注意：编辑器失焦（range 为 null）时保留面板，否则点滑块/按钮会让面板消失
  quill.on('selection-change', (range) => {
    lastSel = range;
    if (!range) return;
    if (range.length !== 1) { hideImgPanel(); return; }
    const [leaf] = quill.getLeaf(range.index);
    if (leaf && leaf.domNode && leaf.domNode.tagName === 'IMG') {
      currentImg = leaf.domNode;
      currentImgRange = range;
      showImgPanel();
      syncImgPanel();
    } else {
      hideImgPanel();
    }
  });

  function showImgPanel() {
    if (!currentImg) return;
    const rect = currentImg.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) { imgPanel.classList.add('hidden'); return; }
    imgPanel.classList.remove('hidden');
    requestAnimationFrame(() => positionImgPanel(rect));
  }

  function positionImgPanel(rect) {
    imgPanel.classList.remove('hidden');
    const w = imgPanel.offsetWidth;
    const h = imgPanel.offsetHeight;
    let left = rect.left + rect.width / 2 - w / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = rect.top - h - 10;
    if (top < 8) top = rect.bottom + 10;
    imgPanel.style.left = left + 'px';
    imgPanel.style.top = top + 'px';
  }

  function hideImgPanel() {
    imgPanel.classList.add('hidden');
    currentImg = null;
    currentImgRange = null;
  }

  function syncImgPanel() {
    if (!currentImg) return;
    const w = parseFloat(currentImg.getAttribute('width')) || 100;
    imgWidth.value = w;
    imgWidthVal.textContent = w + '%';
    const p = currentImg.closest('p');
    const alignClass = p
      ? (p.classList.contains('ql-align-right') ? 'right'
        : p.classList.contains('ql-align-center') ? 'center' : 'left')
      : 'left';
    imgAlignBtns.forEach((b) => b.classList.toggle('active', b.dataset.align === alignClass));
  }

  imgWidth.addEventListener('input', () => {
    if (!currentImg) return;
    const v = Number(imgWidth.value);
    imgWidthVal.textContent = v + '%';
    quill.format('width', v + '%', 'user'); // 内置 Image blot → <img width="v%">
    updatePreview();
  });

  imgAlignBtns.forEach((b) => {
    b.addEventListener('click', () => {
      if (!currentImg) return;
      const align = b.dataset.align;
      quill.format('align', align === 'left' ? false : align, 'user'); // 左对齐 = 移除格式
      syncImgPanel();
    });
  });

  imgDelBtn.addEventListener('click', () => {
    if (!currentImg || !currentImgRange) return;
    quill.deleteText(currentImgRange.index, 1, 'user');
    hideImgPanel();
    updatePreview();
  });

  // 编辑区滚动 / 窗口缩放时跟随图片重新定位
  window.addEventListener('scroll', () => {
    if (imgPanel.classList.contains('hidden') || !currentImg) return;
    positionImgPanel(currentImg.getBoundingClientRect());
  }, true);
  window.addEventListener('resize', () => {
    if (imgPanel.classList.contains('hidden') || !currentImg) return;
    positionImgPanel(currentImg.getBoundingClientRect());
  });

  // ---------- 标签页切换（文章 / 图片库 / 站点设置 / 桌宠 / 网站收集） ----------
  function switchPanel(name) {
    ['posts', 'media', 'settings', 'pet', 'links'].forEach((p) => {
      $('panel-' + p).classList.toggle('hidden', p !== name);
    });
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.panel === name));
    if (name === 'posts') showEditor(!!current);
    if (name === 'media') loadMedia();
    if (name === 'settings') loadSettings();
    if (name === 'pet') loadPet();
    if (name === 'links') loadLinks();
  }
  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => switchPanel(t.dataset.panel));
  });

  // ---------- 图片媒体库 ----------
  async function loadMedia() {
    try {
      renderMedia(await api('/api/uploads'));
    } catch (e) {
      toast('加载图片库失败：' + e.message, true);
    }
  }

  function renderMedia(list) {
    const grid = $('media-grid');
    if (!list.length) {
      grid.innerHTML = `<p class="media-empty">还没有图片，点上方「＋ 上传图片」试试。</p>`;
      return;
    }
    grid.innerHTML = list.map((item) => `
      <div class="media-card" data-name="${escapeHtml(item.name)}">
        <img src="${item.url}" alt="${escapeHtml(item.name)}" loading="lazy">
        <div class="media-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
        <div class="media-actions">
          <button class="btn btn-mini" data-act="copy" type="button">复制链接</button>
          <button class="btn btn-mini" data-act="insert" type="button">插入正文</button>
          <button class="btn btn-mini danger" data-act="del" type="button">删除</button>
        </div>
      </div>`).join('');
    grid.querySelectorAll('.media-card').forEach((card) => {
      const name = card.dataset.name;
      card.querySelector('[data-act="copy"]').addEventListener('click', () => copyMediaUrl(name));
      card.querySelector('[data-act="insert"]').addEventListener('click', () => insertMediaIntoPost(item.url));
      card.querySelector('[data-act="del"]').addEventListener('click', () => deleteMedia(name));
    });
  }

  async function copyMediaUrl(name) {
    try {
      const list = await api('/api/uploads');
      const item = list.find((u) => u.name === name);
      if (!item) { toast('图片不存在，可能已被删除', true); return; }
      await navigator.clipboard.writeText(item.url);
      toast('已复制链接，可粘进正文或别处');
    } catch (e) {
      toast('复制失败：' + e.message, true);
    }
  }

  function insertMediaIntoPost(url) {
    if (!current) {
      toast('请先打开或新建一篇文章，再插入图片', true);
      switchPanel('posts');
      return;
    }
    switchPanel('posts');
    const range = lastSel && lastSel.index != null ? lastSel : quill.getSelection();
    const index = range && range.index != null ? range.index : quill.getLength();
    quill.insertEmbed(index, 'image', url, 'user');
    quill.setSelection(index, 1, 'silent');
    updatePreview();
    toast('已插入正文，可选中图片调整宽度和对齐');
  }

  async function deleteMedia(name) {
    if (!confirm(`确定删除图片「${name}」吗？已在文章里引用的图会失效。`)) return;
    try {
      await api('/api/uploads', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      toast('已删除');
      await loadMedia();
    } catch (e) {
      toast(e.message, true);
    }
  }

  $('media-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 45 * 1024 * 1024) { toast('图片太大（超过 45MB）', true); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await api('/api/uploads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: reader.result }),
        });
        toast('上传成功 ✅');
        await loadMedia();
      } catch (err) {
        toast(err.message, true);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // 允许重复选择同一个文件
  });

  // ---------- 站点设置 ----------
  async function loadSettings() {
    try {
      const s = await api('/api/settings');
      $('s-site-title').value = s.siteTitle || '';
      $('s-site-desc').value = s.siteDescription || '';
      $('s-hero-title').value = s.heroTitle || '';
      $('s-hero-subtitle').value = s.heroSubtitle || '';
      $('s-footer-text').value = s.footerText || '';
      $('s-about-body').value = s.aboutBody || '';
      renderNavLinkRows(s.navLinks || []);
    } catch (e) {
      toast('加载设置失败：' + e.message, true);
    }
  }

  function renderNavLinkRows(links) {
    const box = $('s-nav-links');
    box.innerHTML = '';
    const rows = Array.isArray(links) && links.length ? links : [{ href: '', label: '' }];
    rows.forEach((n) => {
      const row = document.createElement('div');
      row.className = 'nav-row';
      row.innerHTML = `
        <input class="field nav-href" placeholder="地址（如 tags、about，或完整网址）" maxlength="80" value="${escapeHtml(n.href || '')}">
        <input class="field nav-label" placeholder="名称（如 标签）" maxlength="20" value="${escapeHtml(n.label || '')}">
        <button class="nav-del" type="button" title="删除此行">×</button>`;
      row.querySelector('.nav-del').addEventListener('click', () => row.remove());
      box.appendChild(row);
    });
  }

  function collectNavRows() {
    return Array.from(document.querySelectorAll('#s-nav-links .nav-row')).map((row) => ({
      href: row.querySelector('.nav-href').value.trim(),
      label: row.querySelector('.nav-label').value.trim(),
    })).filter((n) => n.href || n.label);
  }

  $('btn-add-nav').addEventListener('click', () => renderNavLinkRows([{ href: '', label: '' }, ...collectNavRows()]));

  $('btn-save-settings').addEventListener('click', async () => {
    const body = {
      siteTitle: $('s-site-title').value.trim(),
      siteDescription: $('s-site-desc').value.trim(),
      heroTitle: $('s-hero-title').value.trim(),
      heroSubtitle: $('s-hero-subtitle').value.trim(),
      footerText: $('s-footer-text').value.trim(),
      navLinks: collectNavRows(),
      aboutBody: $('s-about-body').value,
    };
    const btn = $('btn-save-settings');
    btn.disabled = true;
    try {
      await api('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      $('settings-status').textContent = '已保存 ✅（记得点「发布到网上」生效）';
      toast('设置已保存');
    } catch (e) {
      toast(e.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- 桌宠设置 ----------
  function setSel(el, val) {
    if (el) el.value = String(!!val);
  }

  async function loadPet() {
    try {
      const p = await api('/api/pet');
      setSel($('p-enabled'), p.enabled);
      $('p-baseurl').value = p.ai.baseURL || '';
      $('p-apikey').value = p.ai.apiKey || '';
      $('p-model').value = p.ai.model || '';
      $('p-temperature').value = p.ai.temperature;
      $('p-maxtokens').value = p.ai.maxTokens;
      $('p-name').value = p.persona.name || '';
      $('p-systemprompt').value = p.persona.systemPrompt || '';
      setSel($('p-bubble-enabled'), p.bubble.enabled);
      $('p-bubble-messages').value = (p.bubble.messages || []).join('\n');
      $('p-bubble-distance').value = p.bubble.distance;
      $('p-bubble-duration').value = p.bubble.durationMs;
      $('p-tool-search').checked = !!p.tools.searchBlog;
      $('p-tool-time').checked = !!p.tools.currentTime;
      setSel($('p-mcp-enabled'), p.mcpReserved.enabled);
      $('p-mcp-url').value = p.mcpReserved.serverUrl || '';
    } catch (e) {
      toast('加载桌宠设置失败：' + e.message, true);
    }
  }

  $('btn-save-pet').addEventListener('click', async () => {
    const body = {
      enabled: $('p-enabled').value === 'true',
      ai: {
        baseURL: $('p-baseurl').value.trim(),
        apiKey: $('p-apikey').value, // 不 trim，Key 原样保存
        model: $('p-model').value.trim(),
        temperature: Number($('p-temperature').value),
        maxTokens: Number($('p-maxtokens').value),
      },
      persona: {
        name: $('p-name').value.trim(),
        systemPrompt: $('p-systemprompt').value,
      },
      bubble: {
        enabled: $('p-bubble-enabled').value === 'true',
        messages: $('p-bubble-messages').value.split('\n').map((s) => s.trim()).filter(Boolean),
        distance: Number($('p-bubble-distance').value),
        durationMs: Number($('p-bubble-duration').value),
      },
      tools: {
        searchBlog: $('p-tool-search').checked,
        currentTime: $('p-tool-time').checked,
      },
      mcpReserved: {
        enabled: $('p-mcp-enabled').value === 'true',
        serverUrl: $('p-mcp-url').value.trim(),
      },
    };
    const btn = $('btn-save-pet');
    btn.disabled = true;
    try {
      await api('/api/pet', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      $('pet-status').textContent = '已保存 ✅（记得点「发布到网上」生效）';
      toast('桌宠设置已保存');
    } catch (e) {
      toast(e.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- 网站收集 ----------
  function linkRow(it) {
    const row = document.createElement('div');
    row.className = 'link-edit';
    row.innerHTML = `
      <div class="nav-row">
        <input class="field link-name" placeholder="网站名称（必填）" maxlength="60" value="${escapeHtml(it.name || '')}">
        <input class="field link-url" placeholder="网址，如 https://example.com（必填）" maxlength="500" value="${escapeHtml(it.url || '')}">
        <button class="nav-del link-del" type="button" title="删除此网站">×</button>
      </div>
      <input class="field link-desc" placeholder="简介（选填）" maxlength="300" value="${escapeHtml(it.description || '')}">
      <input class="field link-note" placeholder="我的想法（选填）" maxlength="300" value="${escapeHtml(it.note || '')}">
    `;
    row.querySelector('.link-del').addEventListener('click', () => row.remove());
    return row;
  }

  function renderLinks(links) {
    const box = $('links-list');
    box.innerHTML = '';
    const rows = Array.isArray(links) && links.length ? links : [];
    rows.forEach((it) => box.appendChild(linkRow(it)));
    if (!rows.length) {
      box.innerHTML = '<p class="media-empty">还没有网站，点「＋ 新增网站」添加。</p>';
      box.appendChild(linkRow({}));
    }
  }

  function collectLinks() {
    return Array.from(document.querySelectorAll('#links-list .link-edit')).map((row) => ({
      name: row.querySelector('.link-name').value.trim(),
      url: row.querySelector('.link-url').value.trim(),
      description: row.querySelector('.link-desc').value.trim(),
      note: row.querySelector('.link-note').value.trim(),
    })).filter((l) => l.name || l.url);
  }

  async function loadLinks() {
    try {
      const d = await api('/api/links');
      renderLinks(d.links || []);
    } catch (e) {
      toast('加载网站收集失败：' + e.message, true);
    }
  }

  $('btn-add-link').addEventListener('click', () => $('links-list').appendChild(linkRow({})));

  $('btn-save-links').addEventListener('click', async () => {
    const body = { links: collectLinks() };
    const btn = $('btn-save-links');
    btn.disabled = true;
    try {
      await api('/api/links', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      $('links-status').textContent = '已保存 ✅（记得点「发布到网上」生效）';
      toast('网站收集已保存');
    } catch (e) {
      toast(e.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- 加载数据 ----------
  async function loadData() {
    try {
      [posts, dirs, tags] = await Promise.all([api('/api/posts'), api('/api/dirs'), api('/api/tags')]);
    } catch (e) {
      toast('加载文章失败：' + e.message, true);
      posts = [];
      dirs = [];
    }
    renderPostList();
    renderDirs();
    updateStatusBadge();
    if (current) {
      const match = posts.find((p) => p.path === current.path);
      if (match) current = match;
      renderEditorForm();
    }
  }

  function updateStatusBadge() {
    api('/api/status').then((s) => {
      if (s.base) siteBase = s.base;
      const parts = [];
      parts.push(s.devRunning ? '网站:运行中' : '网站:未运行');
      parts.push(s.remote ? '远程:已配置' : '远程:未配置');
      statusBadge.textContent = parts.join(' · ');
      statusBadge.className = 'badge ' + (s.devRunning && s.remote ? 'ok' : 'warn');
    }).catch(() => {
      statusBadge.textContent = '状态获取失败';
      statusBadge.className = 'badge err';
    });
  }

  // ---------- 渲染列表 ----------
  function renderPostList() {
    const kw = searchEl.value.trim().toLowerCase();
    const list = posts.filter((p) => {
      if (!kw) return true;
      return (p.title + ' ' + p.description + ' ' + p.tags.join(' ') + ' ' + p.dir).toLowerCase().includes(kw);
    });
    if (list.length === 0) {
      postListEl.innerHTML = `<div class="post-item" style="color:var(--text-muted)">${kw ? '没有匹配的文章' : '还没有文章，点「＋ 新建文章」开始吧'}</div>`;
      return;
    }
    postListEl.innerHTML = list.map((p) => {
      const active = current && current.path === p.path ? ' active' : '';
      const cat = p.dir || '';
      return `
        <div class="post-item${active}" data-path="${p.path}">
          <div class="post-item-title">${escapeHtml(p.title || '（无标题）')}</div>
          <div class="post-item-meta">
            ${p.pinned ? '<span class="cat-badge pin">📌 置顶</span>' : ''}
            ${p.hidden ? '<span class="cat-badge hide">🔒 隐藏</span>' : ''}
            <span>${p.date || ''}</span>
            ${cat ? `<span class="cat-badge">${escapeHtml(cat)}</span>` : ''}
          </div>
        </div>`;
    }).join('');
    postListEl.querySelectorAll('.post-item[data-path]').forEach((el) => {
      el.addEventListener('click', () => openPost(posts.find((p) => p.path === el.dataset.path)));
    });
  }

  function renderDirs() {
    if (dirs.length === 0) {
      dirListEl.innerHTML = `<span style="color:var(--text-muted);font-size:0.78rem">暂无目录，点「＋ 新建」创建分类</span>`;
      return;
    }
    dirListEl.innerHTML = dirs.map((d) => `
      <span class="dir-chip">
        ${escapeHtml(d.name)}
        <span class="count">${d.count}篇</span>
        <button class="del" data-dir="${escapeHtml(d.name)}" title="删除目录（需为空）">×</button>
      </span>`).join('');
    dirListEl.querySelectorAll('.dir-chip .del').forEach((btn) => {
      btn.addEventListener('click', () => deleteDir(btn.dataset.dir));
    });
    dirListEl.querySelectorAll('.dir-chip').forEach((chip) => {
      const del = chip.querySelector('.del');
      chip.addEventListener('click', (e) => {
        if (e.target === del) return;
        const name = del.dataset.dir;
        searchEl.value = '';
        const filtered = posts.filter((p) => p.dir === name);
        postListEl.innerHTML = filtered.map((p) => `
          <div class="post-item" data-path="${p.path}">
            <div class="post-item-title">${escapeHtml(p.title || '（无标题）')}</div>
            <div class="post-item-meta"><span>${p.date || ''}</span></div>
          </div>`).join('');
        postListEl.querySelectorAll('.post-item[data-path]').forEach((el) => {
          el.addEventListener('click', () => openPost(posts.find((p) => p.path === el.dataset.path)));
        });
      });
    });
  }

  // ---------- 编辑器 ----------
  function showEditor(show) {
    editorEmpty.classList.toggle('hidden', show);
    editorForm.classList.toggle('hidden', !show);
  }

  function renderEditorForm() {
    const dirSel = $('f-dir');
    dirSel.innerHTML = '<option value="">（未分类）</option>' +
      dirs.map((d) => `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`).join('');
    if (current) {
      dirSel.value = current.dir || '';
      $('f-title').value = current.title || '';
      $('f-description').value = current.description || '';
      $('f-date').value = current.date || todayStr();
      selectedTags = (current.tags || []).slice();
      setEditorHtml(bodyToHtml(current.body));
      viewLink.classList.remove('hidden');
      viewLink.href = `http://localhost:4321${siteBase}blog/${current.path}/`;
      editorStatus.textContent = '编辑中：' + current.path;
    } else {
      dirSel.value = '';
      $('f-title').value = '';
      $('f-description').value = '';
      $('f-date').value = todayStr();
      selectedTags = [];
      setEditorHtml('');
      viewLink.classList.add('hidden');
      editorStatus.textContent = '新建文章';
    }
    $('f-pinned').checked = current ? !!current.pinned : false;
    $('f-hidden').checked = current ? !!current.hidden : false;
    renderTagSelector();
    dirty = false;
  }

  function newPost() {
    current = null;
    showEditor(true);
    renderEditorForm();
    $('f-title').focus();
  }

  function openPost(post) {
    current = post;
    showEditor(true);
    renderEditorForm();
  }

  function gatherForm() {
    return {
      title: $('f-title').value.trim(),
      description: $('f-description').value.trim(),
      date: $('f-date').value || todayStr(),
      dir: $('f-dir').value,
      tags: selectedTags.slice(),
      pinned: $('f-pinned').checked,
      hidden: $('f-hidden').checked,
      body: quill.root.innerHTML,
    };
  }

  // ---------- 标签选择器 ----------
  function renderTagSelector() {
    const box = $('f-tags');
    const all = [...new Set([...tags, ...selectedTags])].sort((a, b) => a.localeCompare(b, 'zh'));
    box.innerHTML =
      all.map((t) => {
        const on = selectedTags.includes(t) ? ' selected' : '';
        return `<span class="tag-chip${on}" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</span>`;
      }).join('') +
      '<input id="f-tag-add" class="tag-add-input" placeholder="＋ 新标签" autocomplete="off">';

    box.querySelectorAll('.tag-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const t = chip.dataset.tag;
        const i = selectedTags.indexOf(t);
        if (i >= 0) selectedTags.splice(i, 1);
        else selectedTags.push(t);
        renderTagSelector();
        dirty = true;
      });
    });

    const input = document.getElementById('f-tag-add');
    if (input) {
      input.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const name = input.value.trim();
        if (!name) return;
        try {
          await api('/api/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
          });
          tags = await api('/api/tags');
          if (!selectedTags.includes(name)) selectedTags.push(name);
          renderTagSelector();
          toast('标签「' + name + '」已添加');
        } catch (err) {
          toast(err.message, true);
        }
      });
    }
  }

  // ---------- 保存 / 删除 ----------
  async function save() {
    const f = gatherForm();
    if (!f.title) { toast('请先填写文章标题', true); $('f-title').focus(); return; }
    const plain = quill.getText().trim();
    if (!plain) { toast('正文是空的，写点内容再保存吧', true); return; }
    const btn = $('btn-save');
    btn.disabled = true;
    try {
      let path;
      if (current) {
        const data = await api('/api/posts', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: current.path, slug: current.slug, ...f }),
        });
        path = data.path;
        toast('已保存 ✅');
      } else {
        const slug = prompt('请输入文章文件名（将出现在网址里）：', defaultSlug(f.title));
        if (slug === null) { btn.disabled = false; return; }
        if (!slug.trim()) { toast('文件名不能为空', true); btn.disabled = false; return; }
        const data = await api('/api/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...f, slug: slug.trim() }),
        });
        path = data.path;
        toast('文章已创建 ✅');
      }
      await loadData();
      const saved = posts.find((p) => p.path === path);
      if (saved) { current = saved; renderEditorForm(); }
      dirty = false;
    } catch (e) {
      toast(e.message, true);
    } finally {
      btn.disabled = false;
    }
  }

  function defaultSlug(title) {
    const t = (title || '').replace(/[^一-龥A-Za-z0-9]+/g, '').slice(0, 12);
    return t || 'new-post';
  }

  async function deletePost() {
    if (!current) return;
    if (!confirm(`确定要删除文章「${current.title}」吗？此操作不可恢复。`)) return;
    try {
      await api('/api/posts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: current.path }),
      });
      toast('已删除');
      current = null;
      showEditor(false);
      await loadData();
    } catch (e) {
      toast(e.message, true);
    }
  }

  // ---------- 目录 ----------
  async function newDir() {
    const name = prompt('请输入新的目录名（作为分类名）：');
    if (!name) return;
    try {
      await api('/api/dirs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      toast('目录已创建 ✅');
      await loadData();
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function deleteDir(name) {
    if (!confirm(`确定删除目录「${name}」吗？（只允许删除空目录）`)) return;
    try {
      await api('/api/dirs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      toast('目录已删除');
      await loadData();
    } catch (e) {
      toast(e.message, true);
    }
  }

  // ---------- 发布 ----------
  async function publish() {
    publishModal.classList.remove('hidden');
    publishOutput.textContent = '正在执行 git 提交与推送…';
    const btn = $('btn-publish');
    btn.disabled = true;
    try {
      const res = await fetch('/api/publish', { method: 'POST' });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let text = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += dec.decode(value, { stream: true });
        publishOutput.textContent = text;
        publishOutput.scrollTop = publishOutput.scrollHeight;
      }
    } catch (e) {
      publishOutput.textContent += '\n出错：' + e.message;
    } finally {
      btn.disabled = false;
      updateStatusBadge();
    }
  }

  // ---------- 事件绑定 ----------
  $('btn-new').addEventListener('click', newPost);
  $('btn-save').addEventListener('click', save);
  $('btn-delete').addEventListener('click', deletePost);
  $('btn-refresh').addEventListener('click', () => loadData().then(() => toast('已刷新')));
  $('btn-new-dir').addEventListener('click', newDir);
  $('btn-site').addEventListener('click', () => { window.open('http://localhost:4321' + siteBase, '_blank'); });
  $('btn-publish').addEventListener('click', publish);
  $('btn-publish-close').addEventListener('click', () => publishModal.classList.add('hidden'));
  searchEl.addEventListener('input', renderPostList);
  ['f-title', 'f-description', 'f-date', 'f-dir', 'f-pinned', 'f-hidden'].forEach((id) => {
    $(id).addEventListener('input', () => { dirty = true; });
    $(id).addEventListener('change', () => { dirty = true; });
  });

  window.addEventListener('beforeunload', (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  // 启动
  loadData();
})();
