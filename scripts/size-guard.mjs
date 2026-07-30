// 打包体积守卫：构建后检查 dist 产物 gzip 体积，超阈值则失败。
// 用法：node scripts/size-guard.mjs
// 设计：Cloudflare 国内访问慢、对体积敏感，故严控首屏 gzip 预算。
import { readdir, readFile } from 'node:fs/promises';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { join } from 'node:path';

const gzipSize = promisify(gzip);
const ROOT = new URL('../dist/', import.meta.url).pathname;

// 体积预算（gzip 后字节）。
// 首屏 = 入口 index.js + react-vendor.js + index.css + index.html
// 阈值在当前最优值基础上预留约 8% 余量，避免误报，同时拦截明显回退。
const BUDGET = {
  firstLoadGzip: 100 * 1024, // 首屏 gzip 总预算 ≈ 100KB（当前 ~92KB）
  chunks: {
    'index-*.js': 38 * 1024, // 主包 gzip（当前 ~35KB）
    'react-vendor-*.js': 47 * 1024, // React 运行时 gzip（当前 ~45KB）
    'index-*.css': 10 * 1024, // 样式 gzip（当前 ~9KB）
  },
};

/** 递归收集 dist 下所有文件 */
async function collectFiles(dir, acc = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) await collectFiles(full, acc);
    else acc.push(full);
  }
  return acc;
}

/** 计算 gzip 体积 */
async function gzLen(buf) {
  const out = await gzipSize(buf, { level: 9 });
  return out.length;
}

/** glob 简易匹配：pattern 含 * 时按前/后缀匹配 */
function match(name, pattern) {
  if (!pattern.includes('*')) return name === pattern;
  const [pre, post] = pattern.split('*');
  return name.startsWith(pre) && name.endsWith(post);
}

function fmt(n) {
  return n > 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;
}

async function main() {
  let files;
  try {
    files = await collectFiles(ROOT);
  } catch {
    console.error('✖ dist/ 不存在，请先执行 npm run build');
    process.exit(2);
  }

  const rows = [];
  for (const f of files) {
    const buf = await readFile(f);
    const base = f.replace(ROOT, '');
    const raw = buf.length;
    const gz = await gzLen(buf);
    rows.push({ file: base, raw, gz });
  }

  rows.sort((a, b) => b.gz - a.gz);

  // 首屏预算：入口 js + react-vendor js + 入口 css + index.html
  const firstLoad = rows.filter((r) =>
    /^assets\/index-.*\.js$/.test(r.file) ||
    /^assets\/react-vendor-.*\.js$/.test(r.file) ||
    /^assets\/index-.*\.css$/.test(r.file) ||
    r.file === 'index.html',
  );
  const firstLoadGz = firstLoad.reduce((s, r) => s + r.gz, 0);

  console.log('📦 打包体积报告（gzip）\n');
  console.log('文件                                    gzip        原始');
  console.log('─'.repeat(64));
  for (const r of rows) {
    console.log(`${r.file.padEnd(40)} ${fmt(r.gz).padStart(10)} ${fmt(r.raw).padStart(10)}`);
  }
  console.log('─'.repeat(64));
  console.log(`首屏 gzip 合计: ${fmt(firstLoadGz)} / 预算 ${fmt(BUDGET.firstLoadGzip)}`);
  console.log();

  let failed = false;

  // 首屏预算
  if (firstLoadGz > BUDGET.firstLoadGzip) {
    console.error(`✖ 首屏 gzip 超预算: ${fmt(firstLoadGz)} > ${fmt(BUDGET.firstLoadGzip)}`);
    failed = true;
  } else {
    console.log(`✓ 首屏 gzip 达标（余量 ${fmt(BUDGET.firstLoadGzip - firstLoadGz)}）`);
  }

  // 单 chunk 预算
  for (const [pattern, cap] of Object.entries(BUDGET.chunks)) {
    const hit = rows.filter((r) => match(r.file, `assets/${pattern}`) || match(r.file, pattern));
    if (hit.length === 0) {
      console.error(`✖ 未找到匹配 ${pattern} 的产物，体积守卫无法生效`);
      failed = true;
      continue;
    }
    for (const r of hit) {
      if (r.gz > cap) {
        console.error(`✖ ${r.file} gzip 超预算: ${fmt(r.gz)} > ${fmt(cap)}`);
        failed = true;
      } else {
        console.log(`✓ ${r.file} 达标（${fmt(r.gz)} / ${fmt(cap)}，余量 ${fmt(cap - r.gz)}）`);
      }
    }
  }

  if (failed) {
    console.error('\n❌ 体积守卫失败：请优化产物体积或确认改动是否引入了体积回退。');
    process.exit(1);
  }
  console.log('\n✅ 体积守卫通过。');
}

main();
