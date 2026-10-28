/**
 * config.js — 这个 World 的身份与默认值。
 *
 * 注意 `enabled` 恒为 false：能不能启用由部署方（Coopanion）决定，World 定义里不该替用户做主。
 */

export const ID = 'video-storyboard';
export const LABEL = '视频分镜';

export const DEFAULTS = Object.freeze({
  enabled: false,
  /** 0 = 交给管线自动决定（按时长与切点密度） */
  defaultCells: 0,
  defaultSheets: 0,
});
