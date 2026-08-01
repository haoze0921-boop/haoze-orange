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
