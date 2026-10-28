import test from 'node:test';
import assert from 'node:assert/strict';

import { analyseStack, isFlicker } from '../src/flicker.js';

/** 造一帧：底色 base，前 nPx 个像素填 fill（每个像素 3 通道） */
const frame = (px, base, fill = null) => {
  const b = Buffer.alloc(px * 3, base);
  if (fill) for (let i = 0; i < fill.count; i++) b.fill(fill.value, i * 3, i * 3 + 3);
  return b;
};

test('analyseStack: 少数帧闪烁 + 稳定底 → core 高、flicker 有值、中位数回到底色', () => {
  const px = 100;
  // 6 帧里只有 2 帧带闪烁（占 1/3）—— 这才是中位数能救的情形
  const on = frame(px, 50, { count: 20, value: 200 });
  const off = frame(px, 50);
  const st = analyseStack([on, off, on, off, off, off]);
  assert.equal(st.coreRatio, 0.8, '没有闪的 80 个像素一直在底上');
  assert.ok(st.flickerRatio >= 0.15, `闪的像素要被算出来，实得 ${st.flickerRatio}`);
  assert.equal(st.median[0], 50, '中位数应该回到底色，闪烁被抹掉');
  assert.equal(isFlicker(st), true);
});

test('analyseStack: 闪烁占一半帧时，逐像素中位数落在中间 —— 已知局限', () => {
  // 8 帧采样一个 12Hz 的闪，一个像素大约一半在、一半不在。
  // 这时中位数落在 on/off 之间：底图取不回来，翻转也检测不到。
  // 记住这个边界：要救它必须靠**空间先验**（看邻居），不是靠时间统计。
  const px = 100;
  const on = frame(px, 50, { count: 20, value: 200 });
  const off = frame(px, 50);
  const st = analyseStack([on, off, on, off, on, off, on, off]);
  assert.equal(st.median[0], 125, '中位数落在 on/off 中间（既能看出来也没法直接用）');
  assert.equal(st.flickerRatio, 0, '一帧都不算"翻转"，因为每帧都离中位数很远');
});

test('analyseStack: 整片换画面（快速剪辑）→ core 低，不判闪烁', () => {
  const px = 100;
  const frames = [frame(px, 10), frame(px, 90), frame(px, 170), frame(px, 250)];
  const st = analyseStack(frames);
  assert.ok(st.coreRatio < 0.2, `每帧都不同的画面不该有稳定核，实得 ${st.coreRatio}`);
  assert.equal(isFlicker(st), false);
});

test('analyseStack: 静止画面 → core 接近 1、flicker 为 0，不判闪烁', () => {
  const px = 100;
  const frames = Array.from({ length: 4 }, () => frame(px, 120));
  const st = analyseStack(frames);
  assert.equal(st.coreRatio, 1);
  assert.equal(st.flickerRatio, 0);
  assert.equal(isFlicker(st), false);
});
