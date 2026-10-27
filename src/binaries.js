/**
 * binaries.js — 解析 ffmpeg / ffprobe 可执行文件。
 *
 * 优先级：
 *  1. 显式环境变量（部署方覆盖，测试也用它）
 *  2. DSH 自己的 $DSH_HOME/bin（把媒体依赖放在 DSH 内，不污染系统 PATH）
 *  3. PATH 上的 ffmpeg / ffprobe
 *
 * 找不到任何一份时仍返回裸命令名，让原有的 ffmpeg 报错原样暴露。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function dshBundled(name) {
  const home = process.env.DSH_HOME;
  if (!home) return null;
  const suffix = process.platform === 'win32' ? '.exe' : '';
  for (const candidate of [join(home, 'bin', name + suffix), join(home, 'bin', name)]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export const DEFAULT_FFMPEG = process.env.DSH_FFMPEG_PATH
  || process.env.FFMPEG_PATH
  || dshBundled('ffmpeg')
  || 'ffmpeg';

export const DEFAULT_FFPROBE = process.env.DSH_FFPROBE_PATH
  || process.env.FFPROBE_PATH
  || dshBundled('ffprobe')
  || 'ffprobe';
