import test from 'node:test';
import assert from 'node:assert/strict';

import { __pendingPid, __resetLifecycle, ensureAsr, keepAlive, lifecycleConfig, probeEndpoint, scheduleStop } from '../src/asr-lifecycle.js';

test('lifecycleConfig: 没配 manage.start 就不托管', () => {
  assert.equal(lifecycleConfig({}), null);
  assert.equal(lifecycleConfig({ manage: {} }), null);
  const c = lifecycleConfig({ manage: { start: 'x.cmd' } });
  assert.equal(c.start, 'x.cmd');
  assert.equal(c.idleMs, 120_000);
});

test('probeEndpoint: /health 不通时退到 /v1/models', async () => {
  const calls = [];
  const fake = async (url) => {
    calls.push(url);
    if (url.endsWith('/health')) throw new Error('ECONNREFUSED');
    return { ok: true };
  };
  assert.equal(await probeEndpoint('http://127.0.0.1:8000/v1', { fetchImpl: fake }), true);
  assert.deepEqual(calls, ['http://127.0.0.1:8000/health', 'http://127.0.0.1:8000/v1/models']);
});

test('probeEndpoint: 两个都不通就是不可用', async () => {
  const fake = async () => { throw new Error('down'); };
  assert.equal(await probeEndpoint('http://127.0.0.1:8000/v1', { fetchImpl: fake }), false);
});

test('ensureAsr: 端点已经在跑 → 不启动、不算自己拥有', async () => {
  __resetLifecycle();
  let spawned = 0;
  const r = await ensureAsr({
    baseUrl: 'http://127.0.0.1:8000/v1',
    config: { manage: { start: 'x.cmd' } },
    fetchImpl: async () => ({ ok: true }),
    spawnImpl: () => { spawned += 1; return { pid: 1, unref() {} }; },
  });
  assert.equal(r.owned, false);
  assert.equal(spawned, 0, '别人已经在跑，不该再起一个');
});

test('ensureAsr: 端点死了 → 启动，并在 ready 后返回 owned=true', async () => {
  __resetLifecycle();
  let spawned = 0;
  let alive = false;
  const r = await ensureAsr({
    baseUrl: 'http://127.0.0.1:8000/v1',
    config: { manage: { start: 'x.cmd', waitMs: 5000 } },
    fetchImpl: async () => { if (!alive) throw new Error('down'); return { ok: true }; },
    spawnImpl: () => { spawned += 1; alive = true; return { pid: 4242, unref() {} }; },
  });
  assert.equal(spawned, 1);
  assert.equal(r.owned, true);
});

test('scheduleStop: 只停自己拥有的那个，别人启动的一律不碰', () => {
  __resetLifecycle();
  let killed = 0;
  assert.equal(scheduleStop({ owned: false, config: { manage: { start: 'x' } }, killImpl: () => { killed += 1; } }), false);
  assert.equal(scheduleStop({ owned: true, config: {}, killImpl: () => { killed += 1; } }), false, '没配置就不托管');
  assert.equal(killed, 0);
});

test('scheduleStop: 到点才停；中途 keepAlive 会取消', async () => {
  __resetLifecycle();
  let killed = 0;
  const ok = scheduleStop({
    owned: true,
    config: { manage: { start: 'x', idleMs: 30 } },
    killImpl: () => { killed += 1; },
  });
  assert.equal(ok, true);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(killed, 1, '空闲到点应该停');

  scheduleStop({ owned: true, config: { manage: { start: 'x', idleMs: 30 } }, killImpl: () => { killed += 1; } });
  keepAlive();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(killed, 1, 'keepAlive 之后不该再停');
});
