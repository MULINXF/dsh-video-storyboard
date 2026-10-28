/**
 * definition.js — WorldDefinition。
 *
 * `create()` 会被装配层在构造所有可用定义时跑一遍，所以它必须是纯的：
 * 不建目录、不发请求、不读密钥。
 */

import { DEFAULTS, ID, LABEL } from './config.js';
import { DESCRIBE } from './tools.js';
import { VideoStoryboardWorld } from './world.js';

export const videoStoryboardDefinition = {
  id: ID,
  label: LABEL,
  defaults: () => structuredClone(DEFAULTS),
  describe: {
    tools: DESCRIBE.tools ?? [],
    events: [],
  },
  /**
   * 静态自检：只检查"这个东西就算跑起来也一定不行"的情况。
   * 不去探测 ffmpeg —— preflight 阶段跑子进程会拖慢宿主启动，
   * 而且 ffmpeg 缺失时 handler 里的错误信息已经能说清楚。
   */
  preflight() {
    if (typeof fetch !== 'function' || typeof FormData !== 'function') {
      throw new Error('视频分镜需要 Node 22+ 的全局 fetch / FormData');
    }
    const nodeMajor = Number(process.versions.node.split('.')[0]);
    if (!(nodeMajor >= 22)) {
      throw new Error(`视频分镜需要 Node 22+，当前是 ${process.versions.node}`);
    }
  },
  create(ctx) {
    return new VideoStoryboardWorld({
      cfg: ctx?.cfg,
      dataDir: ctx?.dataDir,
      botDir: ctx?.botDir,
      packageDir: ctx?.packageDir,
    });
  },
};

export default videoStoryboardDefinition;
