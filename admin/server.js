// 🍊 橘子窝 · 内容管理后台服务
// 本机运行：node admin/server.js   →  http://localhost:4322
// 功能：文章的增删改查、目录（分类）管理、一键发布到 GitHub
// 安全：只绑定 127.0.0.1，路径段白名单校验，拒绝目录穿越
import express from 'express';
import matter from 'gray-matter';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import { exec, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'src', 'content', 'blog');
const PORT = 4322;

const app = express();
app.use(express.json({ limit: '50mb' })); // 允许较大的文章（含 base64 图片）

// 请求日志：记录所有非 GET 请求（便于排查意外的写入来源）
app.use((req, _res, next) => {
  if (req.method !== 'GET') {
    console.log(`[${new Date().toLocaleString('zh-CN')}] ${req.method} ${req.originalUrl}`);
    console.log(`    body: ${JSON.stringify(req.body ?? {})}`);
  }
  next();
});

// ---------- 工具函数 ----------

// 单个路径段只允许：中文、字母、数字、- _ （不含 / 和 \）
const SEGMENT_RE = /^[一-龥A-Za-z0-9_-]+$/;

function badRequest(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}

// 校验一段相对路径（如 生活/我的文章，允许斜杠），逐段白名单检查，返回安全路径
function safePath(input, label) {
  if (typeof input !== 'string' || input.trim() === '') throw badRequest(`${label}不能为空`);
  const segments = input.split('/').filter(Boolean);
  if (segments.length === 0) throw badRequest(`${label}不能为空`);
  for (const s of segments) {
    if (s === '.' || s === '..' || s.includes('\\') || !SEGMENT_RE.test(s)) {
      throw badRequest(`${label}「${input}」不合法：只能包含中文、字母、数字、- 和 _`);
    }
  }
  return segments.join('/');
}

// 校验单个路径段（目录名 / 文件名）：拒绝斜杠与点号，只允许中文、字母、数字、- _
function safeSegment(input, label) {
  const s = typeof input === 'string' ? input.trim() : '';
  if (!s) throw badRequest(`${label}不能为空`);
  if (s.includes('/') || s.includes('\\') || s.includes('.') || !SEGMENT_RE.test(s)) {
    throw badRequest(`${label}「${s}」不合法：只能包含中文、字母、数字、- 和 _，且不能含斜杠或点号`);
  }
  return s;
}

// 日期 → YYYY-MM-DD 字符串（gray-matter 会把 date 解析成 Date 对象）
function toDateString(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 生成 Markdown 文件内容（frontmatter + 正文）
function buildFileContent({ title, description, date, tags, pinned, hidden, body }) {
  const data = {};
  if (title) data.title = String(title).trim();
  if (description) data.description = String(description).trim();
  if (date) data.date = String(date).trim();
  const tagList = Array.isArray(tags)
    ? tags.map((t) => String(t).trim()).filter(Boolean)
    : [];
  if (tagList.length) data.tags = tagList;
  if (pinned) data.pinned = true;
  if (hidden) data.hidden = true;
  return matter.stringify(body || '', data);
}

// 递归列出内容目录下所有 .md 的相对路径
function listMarkdownFiles() {
  const result = [];
  function walk(dir, prefix) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(path.join(dir, ent.name), rel);
      else if (ent.isFile() && ent.name.endsWith('.md')) result.push(rel);
    }
  }
  if (fs.existsSync(CONTENT_DIR)) walk(CONTENT_DIR, '');
  return result;
}

// 读取并解析一篇文章（rel 为含 .md 的相对路径）
function readPost(rel) {
  const full = path.join(CONTENT_DIR, rel);
  const raw = fs.readFileSync(full, 'utf-8');
  const { data, content } = matter(raw);
  const seg = rel.split('/');
  const dir = seg.length > 1 ? seg.slice(0, -1).join('/') : '';
  const slug = seg[seg.length - 1].replace(/\.md$/, '');
  return {
    path: seg.length > 1 ? `${dir}/${slug}` : slug, // 不含 .md，作为唯一标识
    dir,
    slug,
    title: data.title || '',
    description: data.description || '',
    date: toDateString(data.date),
    tags: Array.isArray(data.tags) ? data.tags : [],
    pinned: !!data.pinned,
    hidden: !!data.hidden,
    body: (content || '').trim(),
  };
}

// 检查端口是否在监听
function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const s = net.connect({ port, host }, () => {
      s.destroy();
      resolve(true);
    });
    s.on('error', () => resolve(false));
  });
}

// 从 astro.config.mjs 读取 base（站点子路径，如 '/haoze-orange/'）
function readBaseUrl() {
  try {
    const raw = fs.readFileSync(path.join(ROOT, 'astro.config.mjs'), 'utf-8');
    const m = raw.match(/base:\s*['"]([^'"]*)['"]/);
    return m ? m[1] : '/';
  } catch {
    return '/';
  }
}

// ---------- API：文章 ----------

app.get('/api/posts', (req, res) => {
  try {
    const posts = listMarkdownFiles()
      .map(readPost)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    res.json(posts);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/posts', (req, res) => {
  try {
    const { dir = '', slug, title, description, date, tags = [], pinned = false, hidden = false, body = '' } = req.body || {};
    const safeDir = dir ? safeSegment(dir, '目录') : '';
    const safeSlug = safeSegment(slug, '文件名');
    const rel = safeDir ? `${safeDir}/${safeSlug}.md` : `${safeSlug}.md`;
    const full = path.join(CONTENT_DIR, rel);
    if (fs.existsSync(full)) {
      return res.status(409).json({ error: `文章「${rel}」已存在` });
    }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buildFileContent({ title, description, date, tags, pinned, hidden, body }), 'utf-8');
    res.json({ ok: true, path: rel.replace(/\.md$/, '') });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.put('/api/posts', (req, res) => {
  try {
    const { path: oldPath, dir = '', slug, title, description, date, tags = [], pinned = false, hidden = false, body = '' } = req.body || {};
    const safeOld = safePath(oldPath, '原文件');
    const safeDir = dir ? safeSegment(dir, '目录') : '';
    const safeSlug = safeSegment(slug, '文件名');
    const oldFull = path.join(CONTENT_DIR, `${safeOld}.md`);
    const newRel = safeDir ? `${safeDir}/${safeSlug}.md` : `${safeSlug}.md`;
    const newFull = path.join(CONTENT_DIR, newRel);
    if (!fs.existsSync(oldFull)) {
      return res.status(404).json({ error: '文章不存在，可能已被删除，请刷新列表' });
    }
    fs.mkdirSync(path.dirname(newFull), { recursive: true });
    fs.writeFileSync(newFull, buildFileContent({ title, description, date, tags, pinned, hidden, body }), 'utf-8');
    if (newFull !== oldFull) fs.rmSync(oldFull, { force: true }); // 改名/移动时删除旧文件
    res.json({ ok: true, path: newRel.replace(/\.md$/, '') });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.delete('/api/posts', (req, res) => {
  try {
    const { path: p } = req.body || {};
    const safe = safePath(p, '文章路径');
    const full = path.join(CONTENT_DIR, `${safe}.md`);
    if (!fs.existsSync(full)) return res.status(404).json({ error: '文章不存在' });
    fs.rmSync(full);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---------- API：目录（分类） ----------

app.get('/api/dirs', (req, res) => {
  try {
    // 列出内容目录下的一级文件夹（含空目录），并统计各自文章数
    const list = [];
    if (fs.existsSync(CONTENT_DIR)) {
      for (const ent of fs.readdirSync(CONTENT_DIR, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const folder = path.join(CONTENT_DIR, ent.name);
        let count = 0;
        const countRec = (dir) => {
          for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, f.name);
            if (f.isDirectory()) countRec(full);
            else if (f.isFile() && f.name.endsWith('.md')) count++;
          }
        };
        try {
          countRec(folder);
        } catch {}
        list.push({ name: ent.name, count });
      }
    }
    list.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/dirs', (req, res) => {
  try {
    const { name } = req.body || {};
    if (typeof name !== 'string' || name.trim() === '' || !SEGMENT_RE.test(name)) {
      throw badRequest('目录名只能包含中文、字母、数字、- 和 _');
    }
    const safe = name.trim();
    fs.mkdirSync(path.join(CONTENT_DIR, safe), { recursive: true });
    res.json({ ok: true, name: safe });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.delete('/api/dirs', (req, res) => {
  try {
    const { name } = req.body || {};
    if (typeof name !== 'string' || name.trim() === '' || !SEGMENT_RE.test(name)) {
      throw badRequest('目录名不合法');
    }
    const safe = name.trim();
    const full = path.join(CONTENT_DIR, safe);
    if (!fs.existsSync(full)) return res.status(404).json({ error: '目录不存在' });
    const remaining = fs.readdirSync(full);
    if (remaining.length > 0) {
      return res.status(400).json({ error: '目录不为空（还有文章），请先移动或删除其中的文章' });
    }
    fs.rmdirSync(full);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---------- API：标签 ----------
// 标签池存在 admin/tags.json（供编辑器下拉选择）；博客本身的标签始终从文章自动统计
const TAGS_FILE = path.join(__dirname, 'tags.json');

function readTagPool() {
  try {
    const raw = fs.readFileSync(TAGS_FILE, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data.filter((t) => typeof t === 'string' && t.trim()) : [];
  } catch {
    return [];
  }
}

function writeTagPool(list) {
  fs.writeFileSync(TAGS_FILE, JSON.stringify([...new Set(list.filter((t) => t.trim()))], null, 2), 'utf-8');
}

app.get('/api/tags', (req, res) => {
  try {
    const pool = new Set(readTagPool());
    for (const rel of listMarkdownFiles()) {
      for (const t of readPost(rel).tags) pool.add(t);
    }
    res.json([...pool].sort((a, b) => a.localeCompare(b, 'zh')));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/tags', (req, res) => {
  try {
    const { name } = req.body || {};
    if (typeof name !== 'string' || name.trim() === '' || !SEGMENT_RE.test(name.trim())) {
      throw badRequest('标签只能包含中文、字母、数字、- 和 _');
    }
    const safe = name.trim();
    const pool = readTagPool();
    if (!pool.includes(safe)) pool.push(safe);
    writeTagPool(pool);
    res.json({ ok: true, name: safe });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.delete('/api/tags', (req, res) => {
  try {
    const { name } = req.body || {};
    const safe = String(name || '').trim();
    const pool = readTagPool().filter((t) => t !== safe);
    writeTagPool(pool);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---------- API：站点设置 ----------
// 站点全局配置（站点名/简介/首页文案/页脚/导航/关于页），存 src/site-config.json
const SETTINGS_FILE = path.join(ROOT, 'src', 'site-config.json');

const DEFAULT_SETTINGS = {
  siteTitle: '浩泽的橘子窝',
  siteDescription: '记录生活、学习与思考的小小橘子窝 🍊',
  heroTitle: '🍊 欢迎来到浩泽的橘子窝',
  heroSubtitle: '记录生活、学习与思考的小小橘子窝 🍊',
  footerText: 'Powered By Astro',
  navLinks: [
    { href: 'tags', label: '标签' },
    { href: 'categories', label: '分类' },
    { href: 'search', label: '搜索' },
    { href: 'about', label: '关于' },
  ],
  aboutBody: '<h1>👋 关于</h1>\n<p>你好，欢迎来到「浩泽的橘子窝」。</p>\n<p>这里是浩泽的个人博客，用来记录生活、学习与思考。希望这里的内容能给你带来一点启发，或是一点乐趣。</p>\n<h2>关于博客名</h2>\n<p>「橘子窝」来自橘子 🍊——平凡，但清甜。希望这个小站也能像橘子一样，朴素踏实，却总愿意给别人一点甜。</p>\n<h2>这里会写什么</h2>\n<ul>\n<li>生活随想</li>\n<li>学习笔记</li>\n<li>技术心得</li>\n</ul>\n<h2>关于这个博客</h2>\n<p>使用 <a href="https://astro.build" target="_blank" rel="noopener">Astro</a> 静态站点框架搭建，部署在 GitHub Pages。搭建过程记录在 <a href="{%base%}blog/build-blog-notes">这篇笔记</a> 里。</p>',
};

function readSettings() {
  try {
    const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    return {
      ...DEFAULT_SETTINGS,
      ...data,
      navLinks: Array.isArray(data.navLinks) ? data.navLinks : [...DEFAULT_SETTINGS.navLinks],
    };
  } catch {
    return { ...DEFAULT_SETTINGS, navLinks: [...DEFAULT_SETTINGS.navLinks] };
  }
}

// 逐字段校验与清洗：字符串截断、导航链接过滤非法字符，避免写入脏数据
function sanitizeSettings(input) {
  const b = input && typeof input === 'object' ? input : {};
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const navLinks = Array.isArray(b.navLinks)
    ? b.navLinks
        .filter((n) => n && typeof n === 'object')
        .map((n) => ({
          href: String(n.href || '')
            .trim()
            .replace(/[<>"'`\\]/g, '')
            .replace(/^\s*(javascript|data|vbscript):/i, '')
            .slice(0, 80),
          label: String(n.label || '').trim().replace(/[<>]/g, '').slice(0, 20),
        }))
        .filter((n) => n.href || n.label)
        .slice(0, 12)
    : [...DEFAULT_SETTINGS.navLinks];
  return {
    siteTitle: str(b.siteTitle, 100) || DEFAULT_SETTINGS.siteTitle,
    siteDescription: str(b.siteDescription, 300) || DEFAULT_SETTINGS.siteDescription,
    heroTitle: str(b.heroTitle, 100) || DEFAULT_SETTINGS.heroTitle,
    heroSubtitle: str(b.heroSubtitle, 300) || DEFAULT_SETTINGS.heroSubtitle,
    footerText: str(b.footerText, 200) || DEFAULT_SETTINGS.footerText,
    navLinks,
    aboutBody: typeof b.aboutBody === 'string' ? b.aboutBody : (DEFAULT_SETTINGS.aboutBody || ''),
  };
}

app.get('/api/settings', (_req, res) => {
  try {
    res.json(readSettings());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/settings', (req, res) => {
  try {
    // 部分更新：没传的字段沿用现有配置，避免误清空
    const existing = readSettings();
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const merged = {
      siteTitle: b.siteTitle !== undefined ? b.siteTitle : existing.siteTitle,
      siteDescription: b.siteDescription !== undefined ? b.siteDescription : existing.siteDescription,
      heroTitle: b.heroTitle !== undefined ? b.heroTitle : existing.heroTitle,
      heroSubtitle: b.heroSubtitle !== undefined ? b.heroSubtitle : existing.heroSubtitle,
      footerText: b.footerText !== undefined ? b.footerText : existing.footerText,
      navLinks: b.navLinks !== undefined ? b.navLinks : existing.navLinks,
      aboutBody: b.aboutBody !== undefined ? b.aboutBody : existing.aboutBody,
    };
    const out = sanitizeSettings(merged);
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(out, null, 2), 'utf-8');
    res.json({ ok: true, settings: out });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---------- API：桌宠配置 ----------
// 桌宠 + AI 聊天的配置，存 src/pet-config.json（浏览器直连 AI，Key 会随页面公开）
const PET_CONFIG_FILE = path.join(ROOT, 'src', 'pet-config.json');

const DEFAULT_PET_CONFIG = {
  enabled: true,
  bubble: {
    enabled: true,
    messages: ['你好呀～', '喵～', '🍊 今天也要开心哦', '带我逛逛你的博客吧', '嘿嘿，被你发现啦', '累了，想喝口橙汁～'],
    distance: 130,
    durationMs: 2500,
  },
  ai: {
    baseURL: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    temperature: 0.9,
    maxTokens: 300,
  },
  persona: {
    name: '橘子',
    systemPrompt: '你是「橘子」，浩泽的橘子窝博客的桌宠。你活泼可爱，喜欢用颜文字和 emoji，回答简短有趣，不超过 80 字。',
  },
  tools: { searchBlog: true, currentTime: true },
  mcpReserved: {
    enabled: false,
    serverUrl: '',
    note: '预留：未来可在此配置外部 MCP 服务（需要服务端环境支持，本期未启用）',
  },
};

function readPetConfig() {
  try {
    const data = JSON.parse(fs.readFileSync(PET_CONFIG_FILE, 'utf-8'));
    return {
      ...DEFAULT_PET_CONFIG,
      ...data,
      bubble: { ...DEFAULT_PET_CONFIG.bubble, ...(data.bubble || {}) },
      ai: { ...DEFAULT_PET_CONFIG.ai, ...(data.ai || {}) },
      persona: { ...DEFAULT_PET_CONFIG.persona, ...(data.persona || {}) },
      tools: { ...DEFAULT_PET_CONFIG.tools, ...(data.tools || {}) },
      mcpReserved: { ...DEFAULT_PET_CONFIG.mcpReserved, ...(data.mcpReserved || {}) },
    };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_PET_CONFIG));
  }
}

function sanitizePetConfig(input) {
  const b = input && typeof input === 'object' ? input : {};
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const num = (v, lo, hi, dft) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return dft;
    return Math.min(hi, Math.max(lo, n));
  };
  const bool = (v, dft) => (typeof v === 'boolean' ? v : dft);
  const msgs = Array.isArray(b.bubble && b.bubble.messages)
    ? b.bubble.messages.map((m) => String(m).trim().slice(0, 60)).filter(Boolean).slice(0, 20)
    : [...DEFAULT_PET_CONFIG.bubble.messages];
  return {
    enabled: bool(b.enabled, true),
    bubble: {
      enabled: bool(b.bubble && b.bubble.enabled, true),
      messages: msgs,
      distance: num(b.bubble && b.bubble.distance, 40, 500, 130),
      durationMs: num(b.bubble && b.bubble.durationMs, 500, 20000, 2500),
    },
    ai: {
      baseURL: str(b.ai && b.ai.baseURL, 200) || DEFAULT_PET_CONFIG.ai.baseURL,
      apiKey: typeof (b.ai && b.ai.apiKey) === 'string' ? b.ai.apiKey.slice(0, 300) : '',
      model: str(b.ai && b.ai.model, 100) || DEFAULT_PET_CONFIG.ai.model,
      temperature: num(b.ai && b.ai.temperature, 0, 2, 0.9),
      maxTokens: Math.round(num(b.ai && b.ai.maxTokens, 1, 8000, 300)),
    },
    persona: {
      name: str(b.persona && b.persona.name, 30) || DEFAULT_PET_CONFIG.persona.name,
      systemPrompt: typeof (b.persona && b.persona.systemPrompt) === 'string' ? b.persona.systemPrompt.slice(0, 4000) : '',
    },
    tools: {
      searchBlog: bool(b.tools && b.tools.searchBlog, true),
      currentTime: bool(b.tools && b.tools.currentTime, true),
    },
    mcpReserved: {
      enabled: bool(b.mcpReserved && b.mcpReserved.enabled, false),
      serverUrl: str(b.mcpReserved && b.mcpReserved.serverUrl, 300),
      note: str(b.mcpReserved && b.mcpReserved.note, 300) || DEFAULT_PET_CONFIG.mcpReserved.note,
    },
  };
}

app.get('/api/pet', (_req, res) => {
  try {
    res.json(readPetConfig());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/pet', (req, res) => {
  try {
    // 部分更新：子对象逐字段合并，没传的沿用现有，避免误清空
    const existing = readPetConfig();
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const mergeObj = (cur, inc) => (inc && typeof inc === 'object' ? { ...cur, ...inc } : cur);
    const merged = {
      enabled: b.enabled !== undefined ? b.enabled : existing.enabled,
      bubble: mergeObj(existing.bubble, b.bubble),
      ai: mergeObj(existing.ai, b.ai),
      persona: mergeObj(existing.persona, b.persona),
      tools: mergeObj(existing.tools, b.tools),
      mcpReserved: mergeObj(existing.mcpReserved, b.mcpReserved),
    };
    const out = sanitizePetConfig(merged);
    fs.writeFileSync(PET_CONFIG_FILE, JSON.stringify(out, null, 2), 'utf-8');
    res.json({ ok: true, config: out });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---------- API：网站收集 ----------
// 主页「网站收集」模块的数据，存 src/links-config.json
const LINKS_CONFIG_FILE = path.join(ROOT, 'src', 'links-config.json');
const DEFAULT_LINKS = {
  links: [
    {
      id: 'hullqin-games',
      name: '在线桌游合集',
      url: 'https://game.hullqin.cn/',
      description: '联机桌游合集：UNO、斗地主、五子棋、狼人杀等近 30 款，创建房间分享链接即可开玩。',
      note: '想做的桌游站参考，多人在线玩法的标杆。',
    },
  ],
};

function readLinksConfig() {
  try {
    const data = JSON.parse(fs.readFileSync(LINKS_CONFIG_FILE, 'utf-8'));
    return { links: Array.isArray(data.links) ? data.links : DEFAULT_LINKS.links };
  } catch {
    return { links: [...DEFAULT_LINKS.links] };
  }
}

// 校验清洗：名称/网址必填，网址只允许 http(s)，去掉引号尖括号防注入
function sanitizeLinks(input) {
  const arr = Array.isArray(input && input.links) ? input.links : [];
  const seen = new Set();
  const links = [];
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue;
    const name = String(it.name || '').trim().slice(0, 60);
    let url = String(it.url || '').replace(/[<>"']/g, '').trim().slice(0, 500);
    if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
    const description = String(it.description || '').trim().slice(0, 300);
    const note = String(it.note || '').trim().slice(0, 300);
    if (!name || !url) continue;
    let id = String(it.id || '').trim().slice(0, 40);
    if (!id || seen.has(id)) id = 'link-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    seen.add(id);
    links.push({ id, name, url, description, note });
  }
  return { links: links.slice(0, 50) };
}

app.get('/api/links', (_req, res) => {
  try {
    res.json(readLinksConfig());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/links', (req, res) => {
  try {
    const out = sanitizeLinks(req.body || {});
    fs.writeFileSync(LINKS_CONFIG_FILE, JSON.stringify(out, null, 2), 'utf-8');
    res.json({ ok: true, links: out.links });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---------- API：状态与发布 ----------

app.get('/api/status', async (req, res) => {
  try {
    let branch = '';
    let remote = '';
    try {
      branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT }).toString().trim();
    } catch {}
    try {
      remote = execSync('git remote get-url origin', { cwd: ROOT }).toString().trim();
    } catch {}
    const devRunning = await isPortOpen(4321);
    res.json({ branch, remote, devRunning, base: readBaseUrl() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 一键发布：git add / commit / push，逐行回显
app.post('/api/publish', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  const steps = [
    'git add -A',
    'git commit -m "update: 编辑后台发布更新" --allow-empty',
    'git push',
  ];
  let i = 0;
  function next() {
    if (i >= steps.length) {
      res.write('\n✅ 全部完成！网站正在自动重新构建，稍等 1-2 分钟即可看到更新。\n');
      res.end();
      return;
    }
    const cmd = steps[i++];
    res.write(`\n> ${cmd}\n`);
    exec(cmd, { cwd: ROOT }, (err, stdout, stderr) => {
      if (stdout) res.write(stdout);
      if (stderr) res.write(stderr);
      if (err) {
        res.write('\n❌ 出错了：\n' + friendlyGitError(err, cmd) + '\n');
        res.end();
        return;
      }
      next();
    });
  }
  next();
});

function friendlyGitError(err, cmd) {
  const msg = (err.stderr || err.message || '').toString();
  if (/origin.*not found|No such remote|does not appear|remote origin already exists/i.test(msg)) {
    return '还没有配置 GitHub 远程仓库。请先在 GitHub 建一个仓库，然后执行：\n  git remote add origin <仓库地址>\n配置好后再点一次「发布到网上」。';
  }
  if (/please tell me who you are|user\.email|user\.name/i.test(msg)) {
    return 'git 还没设置你的身份。请执行：\n  git config --global user.name "你的名字"\n  git config --global user.email "你的邮箱"\n设置好后再试。';
  }
  if (/Authentication failed|could not read|403|401/i.test(msg)) {
    return 'GitHub 认证失败。请检查你的 git 是否登录了 GitHub（可在终端执行 git push 看具体提示）。';
  }
  if (cmd === 'git push' && /Everything up-to-date|up to date/i.test(msg)) {
    return '（已经是最新，无需推送）';
  }
  return msg || String(err);
}

// ---------- 静态界面 ----------

// 前端依赖（Quill 富文本编辑器 / marked）静态服务
app.use('/vendor/quill', express.static(path.join(ROOT, 'node_modules', 'quill', 'dist')));
app.use('/vendor/marked', express.static(path.join(ROOT, 'node_modules', 'marked', 'lib')));

app.use(express.static(__dirname));

// 启动后自动打开浏览器
app.listen(PORT, '127.0.0.1', () => {
  console.log('-------------------------------------------');
  console.log('  🍊 橘子窝 · 内容管理后台已启动');
  console.log(`  打开 http://localhost:${PORT} 使用编辑器`);
  console.log(`  博客网站 http://localhost:4321`);
  console.log('  按 Ctrl+C 关闭后台');
  console.log('-------------------------------------------');
  try {
    execSync(`start http://localhost:${PORT}`, { cwd: ROOT, shell: 'cmd.exe' });
  } catch {}
});
