/**
 * tools.js — 工具声明**只有一份**，从 describe.json 读。
 *
 * 为什么这么绕：框架只核对「实例给出的工具名都在 describe.tools 里」，描述或参数写岔了
 * 它看不出来。如果这里手抄一份 spec，两边迟早漂移，而且是那种"能跑但提示词是旧的"的漂移。
 * 直接读同一个文件，物理上不存在第二份。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const DESCRIBE = JSON.parse(readFileSync(join(here, '..', 'describe.json'), 'utf8'));
export const TOOL_SPECS = DESCRIBE.tools ?? [];
