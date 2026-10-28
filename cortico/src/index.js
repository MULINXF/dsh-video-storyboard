/**
 * index.js — 扩展入口。默认导出必须是 WorldDefinition。
 *
 * `cortico.kind = world` / `api = 6` 写在 package.json 里，keywords 里必须有 `cortico-world`
 * （Coopanion 的 Extensions 页就是按这个关键词扫 npm 的）。
 */

import definition, { videoStoryboardDefinition } from './definition.js';

export default definition;
export { videoStoryboardDefinition };
export { VideoStoryboardWorld } from './world.js';
export { DEFAULTS, ID, LABEL } from './config.js';
