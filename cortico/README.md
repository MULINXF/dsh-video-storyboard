# 视频分镜 · Coopanion 扩展（**未发布**）

> ## 状态：写好了，但不发布
>
> npm 上已经有 [`cortico-world-video-storyboard`](https://www.npmjs.com/package/cortico-world-video-storyboard)
> （作者 huahuahuaze，思路源自本项目）覆盖了同样的需求，而且功能比这份更全。
> 两个包做同一件事只会让装的人困惑，所以这份代码**留在这里备查**，不占用包名。
>
> 它随时可以发 —— 改个名字、`npm publish` 就行。适合"严格跟上游同步"的场景：
> 它依赖 `dsh-video-storyboard`，主包修了什么这里就跟着变（见下面[对比](#和-cortico-world-video-storyboard-的关系)）。
>
> ## ⚠️ 也没在真实 Coopanion 里测试过
>
> 业务逻辑本地验证通过（见[已验证项](#已经本地验证过的在-node-里直接调不经过-coopanion)），
> 但"框架怎么调用这个扩展"这一层没跑过。真要发之前，先找个装 Coopanion 的人验一遍。

给 Coopanion 桌宠看视频用：把一个视频压成**一张可寻址的宫格图**，每格带编号、对应精确时间、
挂那一段的台词，底部还有一条与画面同时间轴的音频包络。模型因此可以「引用第 5 格」，
而不是被动接受一段别人写好的摘要。

它**不是**视频摘要器 —— 它给的是索引，让模型自己去指。

## 装

前置：

1. **FFmpeg**（ffmpeg + ffprobe）在 PATH 上，或用 `DSH_FFMPEG_PATH` 指过去
2. **Node 22+**（Coopanion 自带的就行）

然后：

- 打开桌宠 → 设置 → 高级模式 → **Extensions** 页
- 搜 `cortico-world-video-storyboard`
- 安装 → **重启进程** → 在 **World Overview** 里启用

也可以直接：

```sh
npm i cortico-world-video-storyboard
```

装完把目录放进 Coopanion 的 `extensions/`（它自己装的话不用管这步）。

## 用

对 Coo 说人话就行：

> 帮我看看 `D:/videos/ep04.mp4` 这个视频讲了什么
> 这个视频第 3 分钟在干嘛
> 把这部片子每 5 分钟给我一张图

模型会调 `video_storyboard`，拿到一张宫格 + 一份文字索引。

长片不要一次读完 —— 它会按窗口切着读。

## 它做什么、不做什么

| 做 | 不做 |
|---|---|
| 把画面切成段、每段取最清晰的一帧 | 不生成摘要，不替你判断"讲了什么" |
| 给你每格的精确时间区间 | 不播放音频，不把声音转成文字（除非配了识别后端） |
| 把台词按时间贴到格子上 | 不改写、不润色台词 |
| 画一条响度/静音/切点的包络条 | 不做人脸识别、不做内容审核 |

## 和 `cortico-world-video-storyboard` 的关系

**2026-10-27 晚上，已经有人做了一个同目标的扩展**：`cortico-world-video-storyboard`（作者 huahuahuaze），
描述里写着"思路移植自 dsh-video-storyboard（SAOS-3624）"。

两个东西定位不同，不是谁替代谁：

| | `cortico-world-video-storyboard` | 本包 |
|---|---|---|
| 实现方式 | 独立 TypeScript 重写，零依赖 | **依赖主包** `dsh-video-storyboard` |
| 主包修 bug | 不会跟着变（代码已复制，分叉了） | 装新版就跟上 |
| 功能范围 | **更全**：配置页、Windows 自动下 ffmpeg/yt-dlp、多图分段、外挂字幕、可选本地 ASR | 更窄：一个工具，假设 ffmpeg 已在 PATH |
| 独有能力 | 配置界面、自动装机依赖、15 分钟长片的多图策略 | `frame@` 实际抽帧时刻、格内 `[m:ss.s]` 断点标记、两级取流、源能力探测 |
| 测试 | 未知 | 主包 282 项 |

**只想尽快用起来 → 装它更省事**，它会自己下 ffmpeg。

**在意"和上游同步" → 用本包**。我们没有复制一行代码，装的就是主包本身；主包改了什么，这里跟着变。

如果你已经在用那个包，没必要换 —— 除非你遇到了"上游修了但这边没修"的问题。

## 已知未验证项

### 已经本地验证过的（在 Node 里直接调，不经过 Coopanion）

```
id      : video-storyboard
preflight: ok
tools() : [ 'video_storyboard[read]' ]
空参数   : correctly failed（不会静默出一张黑图）
真实视频 : 90 秒片子 → 1.8 s 出图
blobs   : mime=image/png, 701496 bytes, Buffer=true, PNG magic=true
```

也就是说：**业务层是通的**——参数清洗、调管线、拼清单、把真 PNG 塞进 `blobs`，这些都验证过。

### 仍然没验证的（只能在 Coopanion 里试）

按风险从高到低：

1. **框架调 handler 的签名** —— 参考实现是 `handler: async (args) => ...`，我照抄。
   如果实际传的是 `(args, ctx)` 或别的形状，`args` 会读不到，表现为"工具说 input 是空的"。
2. **`blobs` 的字段要求** —— 我给的是 `{ bytes: Buffer, mime: 'image/png', name, fallbackText }`。
   如果 `bytes` 必须是无符号数组、或 `mime` 要别的写法，图就进不了上下文
   （**这是最影响体验的失败模式**：工具跑成功了，但桌宠说看不到图）。
3. **`describe.json` 里 `prompts[].key`** —— 我用了 `worlds.videoStoryboard.envPrompt`。
   如果框架按 `worlds.<id>.envPrompt` 硬匹配，而我的 id 是 `video-storyboard`（带横线），可能对不上。
   这**只影响那段"怎么用"的说明会不会进提示词**，工具本身照常可用。
4. **`api: 6` 的版本差异** —— 按当前仓库看到的写法。旧版 Coopanion 可能不认。
5. **`create(ctx)` 的字段** —— 只用了 `cfg/dataDir/botDir/packageDir`，当前版本其实都没用上
   （不需要持久化）。多传少传应该不致命，但没验证。

如果第 1 或第 2 条不对，症状就是**工具能调、但看不到图**。这两处都很好改，贴日志就行。

## 隐私

- 画面在**本机**解码，不上传任何帧。
- 只有你显式给了一条 http(s) 链接时才会联网（走 yt-dlp 下载）。
- 不收集任何统计。

## 许可

MIT。它依赖的 [dsh-video-storyboard](https://github.com/SAOS-3624/dsh-video-storyboard) 也是 MIT。
Coopanion 本体是 AGPL-3.0 —— 本扩展**只通过公开的扩展接口调用它，不修改它的任何文件**。
