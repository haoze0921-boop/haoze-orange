// 🍊 一次性迁移：把历史文章里 base64 内嵌的图片提取为 public/images/ 文件
// 用法：node scripts/extract-base64-images.mjs
// 说明：新上传图片已走 /api/upload 落盘，此脚本只处理历史遗留的 data:image 数据。
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'src', 'content', 'blog');
const IMAGES_DIR = path.join(ROOT, 'public', 'images');

// 读取 astro.config.mjs 的 base（站点子路径），图片 URL 必须带此前缀，否则线上 404
function readBase() {
  try {
    const raw = readFileSync(path.join(ROOT, 'astro.config.mjs'), 'utf-8');
    const m = raw.match(/base:\s*['"]([^'"]*)['"]/);
    return m ? m[1].replace(/\/+$/, '') : '';
  } catch {
    return '';
  }
}

function listMd(dir, prefix = '') {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...listMd(path.join(dir, ent.name), rel));
    else if (ent.isFile() && ent.name.endsWith('.md')) out.push(rel);
  }
  return out;
}

const BASE = readBase();
const files = listMd(CONTENT_DIR);
let totalFiles = 0;
let savedBytes = 0;

for (const rel of files) {
  const full = path.join(CONTENT_DIR, rel);
  const raw = readFileSync(full, 'utf-8');
  // 匹配 <img ... src="data:image/...;base64,..."> （只替换带引号的 src）
  const re = /(<img[^>]*\bsrc=")(data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+))(")/g;
  let m;
  let changed = false;
  let next = raw;
  let i = 0;
  while ((m = re.exec(raw)) !== null) {
    const [, prefix, , extRaw, b64] = m;
    const ext = extRaw === 'jpeg' ? 'jpg' : extRaw;
    const buf = Buffer.from(b64, 'base64');
    if (!buf.length) continue;
    const month = new Date().toISOString().slice(0, 7); // 按当前月份归档
    const dir = path.join(IMAGES_DIR, month);
    mkdirSync(dir, { recursive: true });
    const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${++i}.${ext}`;
    const file = path.join(dir, name);
    writeFileSync(file, buf);
    // 提示：若图片体积仍大，可手动压缩（如转 WebP/JPEG q82）后替换同名文件
    const url = `${BASE}/images/${month}/${name}`;
    // 只替换这一处（用字符串拼接而非全局 replace，避免替换错位）
    const dataPart = m[0];
    next = next.replace(dataPart, `${prefix}${url}"`);
    changed = true;
    totalFiles++;
    savedBytes += buf.length;
    console.log(`  ${rel} → ${url} (${Math.round(buf.length / 1024)}KB)`);
  }
  if (changed) writeFileSync(full, next, 'utf-8');
}

console.log('-------------------------------------------');
console.log(`共迁移 ${totalFiles} 张图片，节省 ${Math.round(savedBytes / 1024)}KB 内嵌数据`);
console.log('图片 URL 前缀:', BASE || '(无 base，站点部署在根路径)');
