/**
 * world.js — 把「视频 → 宫格」这件事接到 Cortico 的工具回执上。
 *
 * 这一层刻意做得很薄：扫描、切分、取帧、拼图、清单全部在主包
 * （`dsh-video-storyboard`）里，这里只负责
 *
 *   参数清洗 → 调 runStoryboard → 把 PNG 塞进 blobs
 *
 * 也就是说，桌宠版和 DSH 版看的是同一份实现。主包修了 bug，这里跟着好。
 *
 * ⚠️ 本文件**没有在真实 Coopanion 里跑过**（见 README）。写的时候按
 * `cortico-world-image` 的 World 契约来（tools() 返回 {name,description,parameters,tags,handler}，
 * handler 返回 {text, blobs?, failed?}），但 API 6 的实际行为未经实测。
 */

import { DETAIL_CHARS, runStoryboard, formatManifest } from 'dsh-video-storyboard/pipeline';
import { TOOL_SPECS } from './tools.js';

/** 参数容错：模型经常把数字写成字符串，把空值写成 null */
const asText = (value) => (typeof value === 'string' ? value.trim() : '');
const asNum = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const asInt = (value, min, max) => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.min(max, Math.max(min, n));
};

export class VideoStoryboardWorld {
  #cfg;

  constructor({ cfg, dataDir, botDir, packageDir } = {}) {
    this.#cfg = cfg ?? {};
    // 留着但暂时没用：将来要在控制台展示历史时用得上
    this.dataDir = dataDir;
    this.botDir = botDir;
    this.packageDir = packageDir;
  }

  tools() {
    return TOOL_SPECS.map(({ name, description, parameters, tags }) => ({
      name,
      description,
      parameters,
      tags,
      handler: async (args) => this.#dispatch(name, args ?? {}),
    }));
  }

  async #dispatch(name, args) {
    switch (name) {
      case 'video_storyboard':
        return this.#storyboard(args);
      default:
        return { text: `[${name} 没执行] 未知工具。`, failed: true };
    }
  }

  async #storyboard(args) {
    const input = asText(args.input);
    if (!input) {
      // 空参数不该静默返回一张黑图 —— 明确说没执行，模型就会改用别的方式回答
      return { text: '[video_storyboard 没执行] input 是空的。要么给一个视频路径，要么别调用这个工具。', failed: true };
    }

    const detail = ['low', 'med', 'high'].includes(args.detail) ? args.detail : 'med';
    const from = Math.max(0, asNum(args.from));
    const to = Math.max(0, asNum(args.to));
    if (to > 0 && to <= from) {
      return { text: `[video_storyboard 没执行] to(${to}) 必须大于 from(${from})。`, failed: true };
    }

    let result;
    try {
      result = await runStoryboard({
        input,
        from,
        to,
        cells: asInt(args.cells, 1, 16),
        sheets: asInt(args.sheets, 1, 4),
        detail,
        transcriptFile: asText(args.transcriptFile) || undefined,
        // 桌宠场景通常是"看一眼就走"，不给人留调试入口，所以保持默认的 sharp 取帧
      });
    } catch (error) {
      return { text: `[video_storyboard 没执行] ${explain(error, input)}`, failed: true };
    }

    if (!result?.sheets?.length) {
      return { text: '[video_storyboard 没执行] 管线没有产出图片（窗口可能太短）。换个窗口再试。', failed: true };
    }

    const text = formatManifest(result, { maxCellChars: DETAIL_CHARS[detail] ?? DETAIL_CHARS.med });
    const blobs = result.sheets.map((sheet) => ({
      bytes: sheet.png,
      mime: 'image/png',
      name: `storyboard-${sheet.sheet}.png`,
      fallbackText: `[分镜图 ${sheet.sheet}｜${sheet.width}x${sheet.height}｜${sheet.cells.length} 格]`,
    }));

    return { text, blobs };
  }
}

/**
 * 把底层错误翻成人话。桌宠的用户往往不知道什么是 ffmpeg，
 * 所以「没装」和「装错了」要分开说。
 */
function explain(error, input) {
  const message = String(error?.message ?? error);

  if (/not found; tried:|ENOENT|spawn ffmpeg|spawn ffprobe/i.test(message)) {
    return '找不到 ffmpeg / ffprobe。这个工具要靠它们解码视频：装上 FFmpeg 并让它出现在 PATH 上，'
      + `或者用 DSH_FFMPEG_PATH 指向它。原始信息：${message.slice(0, 300)}`;
  }
  if (/no such file|ENOENT.*\.mp4|Invalid data found/i.test(message)) {
    return `这个路径读不到视频：${input}。确认文件存在、且是 mp4/mov/mkv/webm 这类容器。`;
  }
  if (/yt-dlp not found/i.test(message)) {
    return '这是一条链接，但机器上没有 yt-dlp。装一个（pip install --user -U yt-dlp）或改用本地文件。';
  }
  if (/cookies file not found/i.test(message)) {
    return `配置里指向的 cookies 文件不存在，也就没法读这条链接。原始信息：${message.slice(0, 200)}`;
  }
  return message.slice(0, 500);
}
