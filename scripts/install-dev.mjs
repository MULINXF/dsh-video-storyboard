#!/usr/bin/env node
/**
 * install-dev — 把本包同步进 DSH 的 desktop/web profile（开发用），并注册为 bundle。
 *
 *   node scripts/install-dev.mjs            # 安装 / 同步
 *   node scripts/install-dev.mjs --remove   # 卸载（还原 package.json）
 *   node scripts/install-dev.mjs --check    # 只检查当前状态，不改动
 *
 * 为什么要手动做这件事：desktop profile 由 Electron 应用独占管理，
 * `dsh plugin --profile desktop ...` 会被拒绝（"managed exclusively by the Electron application"）。
 *
 * 为什么是复制而不是软链：Node 解析裸包名（`@deepseek-ai/dsh-tools`）时用的是真实路径，
 * 软链会让它从源码目录向上找、找不到宿主的包。复制到 profile 的 node_modules 里，
 * 解析链才是 profiles/<profile>/node_modules → profiles/node_modules。
 */

import { cp, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const HERE = dirname(dirname(fileURLToPath(import.meta.url)));
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const hasProfile = (name) => existsSync(join(DSH_HOME, 'profiles', name));
const PROFILE = process.env.DSH_PROFILE
  || (hasProfile('desktop') ? 'desktop' : hasProfile('web') ? 'web' : 'desktop');
const PROFILE_DIR = join(DSH_HOME, 'profiles', PROFILE);
const TARGET = join(PROFILE_DIR, 'node_modules', 'dsh-video-storyboard');
const PKG_NAME = 'dsh-video-storyboard';
const SKIP = new Set(['node_modules', '.git', 'test']);

/** 插件运行时用裸包名 import('@deepseek-ai/dsh-tools')，安装前必须能解析。 */
function findHostTools() {
  const candidates = [
    process.env.DSH_TOOLS_PATH,
    join(PROFILE_DIR, 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'),
    join(DSH_HOME, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'),
  ].filter(Boolean);
  for (const path of candidates) if (existsSync(path)) return path;
  try {
    return createRequire(join(PROFILE_DIR, 'package.json')).resolve('@deepseek-ai/dsh-tools');
  } catch {
    return null;
  }
}

const mode = process.argv.includes('--remove') ? 'remove'
  : process.argv.includes('--check') ? 'check' : 'install';

if (!existsSync(PROFILE_DIR)) {
  console.error(`profile 不存在：${PROFILE_DIR}`);
  process.exit(2);
}
const pkgPath = join(PROFILE_DIR, 'package.json');
const backupGlob = `package.json.bak-`;   // 首次安装会留一份

async function readJson(path) {
  const text = await readFile(path, 'utf8');
  return JSON.parse(text.replace(/^\uFEFF/, ''));
}

async function patchProfile({ add }) {
  const pkg = await readJson(pkgPath);
  pkg.dsh ??= {};
  pkg.dsh.profile ??= {};
  pkg.dsh.profile.bundles ??= [];
  const bundles = pkg.dsh.profile.bundles;
  const hasDep = Object.hasOwn(pkg.dependencies ?? {}, PKG_NAME);

  if (add) {
    if (!hasDep) {
      const backup = join(PROFILE_DIR, `${backupGlob}${new Date().toISOString().replace(/[:.]/g, '-')}-preinstall`);
      await writeFile(backup, await readFile(pkgPath), 'utf8');
      console.log(`已备份 package.json → ${backup}`);
    }
    pkg.dependencies = { ...(pkg.dependencies ?? {}), [PKG_NAME]: `file:${HERE.replace(/\\/g, '/')}` };
    if (!bundles.includes(PKG_NAME)) pkg.dsh.profile.bundles = [...bundles, PKG_NAME];
  } else {
    if (pkg.dependencies) delete pkg.dependencies[PKG_NAME];
    if (pkg.dsh?.profile?.bundles) {
      pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter((b) => b !== PKG_NAME);
    }
  }
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

async function syncFiles() {
  await rm(TARGET, { recursive: true, force: true });
  await cp(HERE, TARGET, {
    recursive: true,
    filter: (src) => !SKIP.has(src.split(/[\\/]/).pop()),
  });
}

async function report() {
  const installed = existsSync(TARGET);
  const pkg = await readJson(pkgPath);
  const registered = (pkg.dsh?.profile?.bundles ?? []).includes(PKG_NAME);
  const dep = pkg.dependencies?.[PKG_NAME] ?? null;
  const hostTools = findHostTools();
  console.log(`profile      : ${PROFILE_DIR}`);
  console.log(`node_modules : ${installed ? '已安装' : '未安装'}  ${TARGET}`);
  console.log(`bundles 注册 : ${registered ? '是' : '否'}`);
  console.log(`dependencies : ${dep ?? '无'}`);
  console.log(`dsh-tools    : ${hostTools ?? '未找到（插件 apply() 会失败）'}`);
  return { installed, registered, dep, hostTools };
}

function printHostToolsHint() {
  console.error('\n找不到 @deepseek-ai/dsh-tools。插件运行时执行 import(\'@deepseek-ai/dsh-tools\')，');
  console.error('因此必须先让它在 profile 下可解析，或设置 DSH_TOOLS_PATH：');
  console.error(`  $env:DSH_TOOLS_PATH='<DSH>\\node_modules\\@deepseek-ai\\dsh-tools\\lib\\index.js'`);
  console.error('然后重启 DSH。');
}

if (mode === 'check') {
  const state = await report();
  if (!state.hostTools) printHostToolsHint();
  process.exit(state.hostTools ? 0 : 3);
}

if (mode === 'remove') {
  await rm(TARGET, { recursive: true, force: true });
  await patchProfile({ add: false });
  console.log('已卸载。重启 DSH 生效（tool 会消失）。');
  await report();
  process.exit(0);
}

await syncFiles();
await patchProfile({ add: true });
const state = await report();
if (!state.hostTools) printHostToolsHint();
console.log('\n完成。重启 DSH 后生效（插件树在进程启动时组合）。');
if (!state.hostTools) process.exit(3);
