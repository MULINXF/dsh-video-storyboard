import test from 'node:test';
import assert from 'node:assert/strict';

import { displayAspect, endEdge, normalizeRotation, parseRational, uprightSize } from '../src/probe.js';

test('parseRational: 常见帧率字符串', () => {
  assert.equal(parseRational('25/1'), 25);
  assert.ok(Math.abs(parseRational('30000/1001') - 29.97) < 0.01);
  assert.equal(parseRational('60'), 60);
  assert.equal(parseRational('0/1'), null);
  assert.equal(parseRational(''), null);
  assert.equal(parseRational(undefined), null);
});

test('parseRational: 支持 ffprobe 的 SAR 冒号格式', () => {
  assert.ok(Math.abs(parseRational('32:27') - 32 / 27) < 1e-9);
  assert.ok(Math.abs(parseRational('4:3') - 4 / 3) < 1e-9);
});

test('displayAspect: 非方形像素计入显示比例', () => {
  assert.ok(Math.abs(displayAspect(720, 480, 32 / 27) - 16 / 9) < 1e-9);
  assert.ok(Math.abs(displayAspect(1920, 1080, 1) - 16 / 9) < 1e-9);
  assert.equal(displayAspect(0, 0, 1), 16 / 9);
});

test('normalizeRotation: 归一化到 (-180, 180]', () => {
  assert.equal(normalizeRotation(90), 90);
  assert.equal(normalizeRotation(-90), -90);
  assert.equal(normalizeRotation(270), -90);
  assert.equal(normalizeRotation(180), 180);
  assert.equal(normalizeRotation(-180), 180);
  assert.equal(normalizeRotation(undefined), 0);
});

test('uprightSize: 旋转 90/270 时交换宽高', () => {
  assert.deepEqual(uprightSize(1920, 1080, 0), { width: 1920, height: 1080 });
  assert.deepEqual(uprightSize(1920, 1080, 90), { width: 1080, height: 1920 });
  assert.deepEqual(uprightSize(1920, 1080, -90), { width: 1080, height: 1920 });
  assert.deepEqual(uprightSize(1920, 1080, 180), { width: 1920, height: 1080 });
});

test('endEdge: 帧率越高避让越小，且永远大于 0', () => {
  assert.ok(endEdge(25) > 0 && endEdge(25) < 0.1);
  assert.ok(endEdge(60) < endEdge(25));
  assert.ok(endEdge(25) >= 1 / 25, '至少留出一个完整帧');
  assert.ok(endEdge(0) > 0, 'fps 缺失时也要有兜底');
});
