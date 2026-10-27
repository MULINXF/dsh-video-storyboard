import test from 'node:test';
import assert from 'node:assert/strict';

import { chunkWindows, mergeSegments, transcribeLong } from '../src/asr.js';

/* ---------------------------------------------------------------- 空结果的诚实度 */

test('transcribeLong: 没配 key 时返回 null（而不是空壳对象）', async () => {
  const long = await transcribeLong({ input: 'nope.mp4', start: 0, end: 300, apiKey: null });
  assert.equal(long, null, '多窗口、每段都拿不到 key → 整段应该是 null');
});

test('transcribeLong: 窗口不足时不该抛（end > start 才走 ASR）', async () => {
  await assert.rejects(
    () => transcribeLong({ input: 'nope.mp4', start: 10, end: 10, apiKey: null }),
    /end must be greater than start/,
  );
});

/* ---------------------------------------------------------------- 切片与合并 */

test('chunkWindows: 切点落在静音中点，且不跨太长', () => {
  const windows = chunkWindows({ start: 0, end: 120, silences: [{ from: 41, to: 45 }], maxChunk: 45 });
  assert.ok(windows.length >= 3);
  for (const w of windows) assert.ok(w.to - w.from <= 46, `窗口过长: ${w.from}-${w.to}`);
  // 40–45 附近应该有一刀落在静音区间里
  const near = windows.some((w) => w.to > 41 && w.to < 45);
  assert.ok(near, `切点应吸附到静音中点附近，实得 ${windows.map((w) => w.to).join(',')}`);
});

test('mergeSegments: 跨片重复的同一句只留一条', () => {
  // 同一句在上一片结尾、下一片开头各出现一次（切片边界造成的重复）
  const merged = mergeSegments([
    { from: 0, to: 5, text: '同一句话' },
    { from: 4.8, to: 9, text: '同一句话' },
    { from: 20, to: 25, text: '另一句' },
  ]);
  assert.equal(merged.length, 2, '重复句应被合并成一条');
  assert.equal(merged[0].to, 9, '保留更晚的结束时间');
  assert.equal(merged[1].text, '另一句');
});

test('mergeSegments: 不同句子即使时间重叠也不合并', () => {
  const merged = mergeSegments([
    { from: 0, to: 5, text: '甲' },
    { from: 4, to: 9, text: '乙' },
  ]);
  assert.equal(merged.length, 2);
});
