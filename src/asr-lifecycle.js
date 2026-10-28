/**
 * asr-lifecycle.js — 让本地 ASR 服务"用完就走"。
 *
 * 背景（2026-10-28，三次死机）：本地 ASR 服务常驻要吃约 6.8 GB 提交额度。
 * 这台 16 GB 的机器上，它和 Premiere / 大项目同时存在就会把提交上限撞穿，
 * 表现为 dwm 崩 0xc00001ad、桌面黑屏、整机卡死。
 *
 * 插件**不会**自己去拉起别人的服务 —— 除非用户在 `~/.dsh/asr.json` 里显式写了 `manage.start`。
 * 一旦写了，就按下面的契约办：
 *
 *   1. 转录前：端点活着 → 什么都不做（owned=false，不碰别人的进程）
 *   2. 端点死了 → 跑 manage.start，等它 ready（最多 waitMs）
 *   3. 本次运行结束 → 只有"是我们拉起来的"才安排停止；到点前又有请求就取消停止
 *
 * 关键设计：**只杀自己拉起来的那个**。别人（另一个插件、你自己开的窗口）启动的实例，
 * 我们无权杀 —— 杀了会把正在用它的任务打断。
 */

const SHELL_EXE = 'cmd.exe';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 从 asr.json 的配置里取出生命周期设置（没有就返回 null，表示不托管） */
export function lifecycleConfig(config = {}) {
  const m = config?.manage;
  if (!m || typeof m !== 'object' || !m.start) return null;
  return {
    start: String(m.start),
    stop: m.stop ? String(m.stop) : null,
    waitMs: Number.isFinite(m.waitMs) ? m.waitMs : 120_000,
    idleMs: Number.isFinite(m.idleMs) ? m.idleMs : 120_000,
    healthPath: typeof m.healthPath === 'string' ? m.healthPath : '/health',
  };
}

/** 端点是否已经在应答（/health 不通就退到 /v1/models，兼容不支持 /health 的服务） */
export async function probeEndpoint(baseUrl, { fetchImpl = fetch, timeoutMs = 1500, healthPath = '/health' } = {}) {
  const root = String(baseUrl ?? '').replace(/\/v1\/?$/, '').replace(/\/$/, '');
  if (!root) return false;
  for (const path of [healthPath, '/v1/models']) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetchImpl(`${root}${path}`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) return true;
    } catch {
      /* 换下一个探测点 */
    }
  }
  return false;
}

/* 只保留一个"待停止"的定时器：连续几次调用应该共用一个实例，而不是起了又杀 */
let pendingStop = null;
let ownedChild = null;

/** 取消即将发生的停止（同一会话里连续调用时，不该把服务杀了重开） */
export function keepAlive() {
  if (pendingStop) {
    clearTimeout(pendingStop);
    pendingStop = null;
  }
}

/**
 * 确保 ASR 可用。返回 { owned, started }：
 *  - owned=true 表示**这个进程是我们拉起来的**，运行结束可以停
 *  - owned=false 表示它本来就在跑，不碰
 */
export async function ensureAsr({
  baseUrl, config, env = process.env, spawnImpl, fetchImpl = fetch, log = () => {},
} = {}) {
  const life = lifecycleConfig(config);
  const alive = await probeEndpoint(baseUrl, { fetchImpl, healthPath: life?.healthPath });
  if (alive) {
    keepAlive();
    return { owned: false, started: false };
  }
  if (!life) return { owned: false, started: false, reason: 'no manage.start configured' };

  log(`starting local ASR: ${life.start}`);
  // Windows 上直接 spawn 一个 .cmd，进程会跟着父进程一起死（实测：node 退出后 python 也退了，
  // 下一次转写就拿到 asr-failed）。用 `start "" /b` 脱离当前控制台 + detached + unref 才能活下来。
  const isBatch = /\.(cmd|bat)$/i.test(life.start);
  const child = process.platform === 'win32' && isBatch
    ? spawnImpl(SHELL_EXE, ['/c', 'start', '', '/b', life.start], {
      detached: true, stdio: 'ignore', windowsHide: true, env,
    })
    : spawnImpl(life.start, [], {
      shell: true, detached: true, stdio: 'ignore', windowsHide: true, env,
    });
  child.unref?.();
  ownedChild = child;

  const deadline = Date.now() + life.waitMs;
  while (Date.now() < deadline) {
    await sleep(1000);
    if (await probeEndpoint(baseUrl, { fetchImpl, healthPath: life.healthPath })) {
      log('local ASR is ready');
      keepAlive();
      return { owned: true, started: true, pid: child.pid };
    }
  }
  return { owned: true, started: true, pid: child.pid, timedOut: true };
}

/**
 * 运行结束后安排停止。只有 owned 的实例才会被停。
 * 到点前如果又来了请求（keepAlive），这次停止会被取消。
 */
export function scheduleStop({ owned, config, killImpl } = {}) {
  if (!owned) return false;
  const life = lifecycleConfig(config);
  if (!life) return false;
  keepAlive();
  const pid = ownedChild?.pid;
  pendingStop = setTimeout(() => {
    pendingStop = null;
    try {
      if (killImpl) killImpl(pid, life);
      else if (pid) {
        // Windows 要连子进程一起杀（start.cmd 会再起 python）；其它平台发 SIGTERM
        if (process.platform === 'win32') {
          process.kill(pid);
          // detached 的 shell 子进程不会跟着死，补一刀 taskkill /T
          import('node:child_process').then(({ execFile }) => {
            execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => {});
          }).catch(() => {});
        } else {
          process.kill(pid, 'SIGTERM');
        }
      }
    } catch {
      /* 已经不在了 */
    }
    ownedChild = null;
  }, life.idleMs);
  pendingStop.unref?.();
  return true;
}

/** 测试用：清掉内部状态 */
export function __resetLifecycle() {
  keepAlive();
  ownedChild = null;
}

export function __pendingPid() {
  return ownedChild?.pid ?? null;
}
