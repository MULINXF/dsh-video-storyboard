# dsh-video-storyboard

> 让 AI 真正"看过"一段视频：**一张分镜图 + 一份带时间码的文本清单**，模型据此回答"第 3 分钟发生了什么""这句话对应哪一格"。
>
> English: [README.en.md](README.en.md)

---

## 它解决什么问题

多模态模型看视频有两种笨办法：

- **逐帧抽图** —— 10 分钟片子按 1 fps 抽就是 600 张图，token 直接爆。
- **只喂字幕** —— 画面里的信息（构图、动作、场景变化）全丢。

本插件走第三条：**把画面压成一张宫格图**（384 token 封顶），旁边配一份**按时间对齐的文本清单**（每格起止时间 + 这一格里的台词 + 切了几刀）。

模型得到的是"这 90 秒里发生了什么、大概在第几秒"，需要细节时再用 `video_zoom` 放大某一段。

## 三个工具

| 工具 | 干什么 | 何时用 |
|---|---|---|
| `video_probe` | 只读容器头：多长、分辨率、帧率、有没有音轨/字幕、已分析过没有 | **第一次接触一部片子时先调它**，不花图片 token |
| `video_storyboard` | 出宫格图 + 文本清单 | 主体功能 |
| `video_zoom` | 只看某一段（更小的时间窗、更密的格） | 清单看完觉得某段重要，再放大 |
| `video_locate` | **纯文本**：一句话 → 时间码 | 知道说了什么、不知道在第几分钟 |

## 安装

**从零开始的完整步骤（含依赖、自检、排错）见 [docs/INSTALL.zh.md](docs/INSTALL.zh.md)。**

三句话版本：

```bash
winget install Gyan.FFmpeg          # 必须：ffmpeg + ffprobe
pip install --user -U yt-dlp        # 只有贴 B 站/YouTube 链接才需要
node scripts/install-dev.mjs        # 装插件，然后重启 DSH
```

| 依赖 | 必须吗 | 不装会怎样 |
|---|---|---|
| ffmpeg + ffprobe | **必须** | 第一步就报错 |
| yt-dlp | 可选 | 本地文件照常能用，贴链接不行 |
| ASR 服务 | 可选 | 能出图，但清单里没有台词 |

插件**不打包** ffmpeg 和 yt-dlp，只调用你自己装的那份。找不到时会给出安装指引，不会静默失败。

## 怎么用

### 贴一个链接

```
https://www.bilibili.com/video/BV1xx411c7mD
```

插件会自己下载、缓存，然后用本地文件的那套流程跑。竖屏、DASH、多分P 都处理了。

### 本地文件

```bash
node bin/storyboard.mjs film.mp4 --cells 9 --out film.png
node bin/storyboard.mjs film.mp4 --batch 300 --out film.png   # 长片按 5 分钟切窗
node bin/asr-check.mjs film.mp4 --from 100 --seconds 12        # 只测 ASR
```

## 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `input` | — | 本地路径或 http(s) 链接 |
| `from` / `to` | 全片 | 只看这一段 |
| `cells` | 自动 | 格数；不给就按 motion / 字每秒 / 响度 推 |
| `sheets` | 1 | 切成几张图（长片用） |
| `scanGap` | 0.35 | 粗扫时两刀最短间隔（秒）。快闪素材调小 |
| `pick` | `sharp` | 取帧策略：`sharp` 3 候选选最锐 / `mid` 段中点 / `thumb` 段内最典型 |
| `burn` | `index` | 烧格号；`none` 关掉 |
| `minGap` | 1.2 | 格子合并的最小间隔 |
| `transcript` | `auto` | `auto` / `off` |
| `transcriptFile` | — | 直接喂已有的 SRT/JSON，跳过 ASR |
| `detail` | `med` | 每格台词预算：`low` 60 / `med` 120 / `high` 400 字 |
| `cellRange` | — | 分页看文本清单 |

## 输出长什么样

一张图 + 一段文本：

```
<storyboard path="film.png" grid="3x3" size="1920x1080" fps="24.00" duration="90.09s"
            footer="teal bars = loudness, grey blocks = silence, yellow ticks = cut points"
            transcript="asr" cuts="44 (avg 2.0s)">

audio events (7): 00:00.50 +30dB, 00:12.80 -30dB, …
fast cuts: 00:42.80-01:04.80 (22 shots) — video_zoom({ from, to, cells: 6, minGap: 0.4 }) splits these
re-read at one-frame granularity: 00:47.10-01:03.70 18 shots (coarse saw 4)

cell 1 (r1c1) = 00:00.00-00:09.33  cuts 1
    "所以你连他也要忘记吗"
cell 3 (r1c3) = 00:33.29-00:47.08  cuts 10  16 frames (4×4)
    "…"
```

几条设计原则：

- **清单只给原材料，不下结论。** 不说"这是高潮""这里是角色 A"，只给时间、刀数、台词 —— 判断是模型的事。
- **每加一行都要能说出它挡掉了什么误判。** 说不出来就不加。
- **数字不可信时要说出来。** 例如连续运镜被逐帧切碎时，清单会写 `cut count unreliable here`，而不是让模型拿 `cuts=N` 当节奏依据。

## 算法要点

1. **画面差异**：缩到 64×36，逐帧比 HSV，色相按**环形**距离且**按饱和度降权**（灰色的色相没有意义），得到 0–255 的变化分。
2. **切点**：分数超过阈值即一刀。阈值不是固定的 —— 按本片自己的分数分布和时长推。
3. **爆点重判**：对每个 2 秒窗口，用**一帧**的间隔重新判一次。粗扫看不见 0.35 秒以下的刀，而快闪全在那一档。
4. **格位分配**：按"密度积分"等分 —— 每一格承载的信息量相同，快的地方自动分到更短时段。
5. **快闪摊开**：某一格平均镜头短于 1.4 秒（≥0.7 刀/秒）且刀本身够硬时，摊成 k×k 子格（最多 4×4）。

## 实测数字

| 项目 | 数字 |
|---|---|
| 单图 token | 384（9 格，1009×620） |
| 对比逐帧抽图 | 3,072–6,144 |
| 文本清单 | 约 1,500–2,200 字符（`detail` 可调） |
| 90 秒片子端到端 | 约 10 秒（含解码、扫描、取帧、拼图） |
| 快闪重判 | 零额外解码（复用逐帧分数） |
| 切点召回 | 概念 PV 44 刀 / 混剪 178 刀（151 秒）/ 口播 125 刀 |

## 明确不做的

- **不烧时间码进画面** —— 占像素、压缩后先糊，时间在文本里有 0.01 秒精度。
- **不做说话人分离** —— 实测 cam++ 在 1.9 秒短句上把单人素材切成 6 个人。
- **不打包 ffmpeg / yt-dlp** —— 版本和安全都由用户掌握。
- **不把"结论"写进清单** —— 那是模型的工作。

## 已知限制

- 画面小于约 1% 的改动（PPT 上多一行字）在 64×36 上不可见，再聪明的阈值也救不回来。
- 连续运镜密集时，`cuts=N` 会失真（清单会标注）。
- 极暗素材的取帧锐度判断不稳。
- 分格摊开后子帧最小约 100×56，再小就只剩色块。

## 证据与复核

每次 `saveStoryboards` 会同时写一份 `<名字>.evidence.json`：每格的起止时间、取帧时刻、刀数、字数、原文。
清单是给模型读的散文，这份是给人和脚本复核的 —— 想知道"第 5 格真的是 3:29 吗"，对着时间码回看原片即可。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/INSTALL.zh.md](docs/INSTALL.zh.md) | 从零安装：依赖、自检、排错表 |
| [docs/USAGE.zh.md](docs/USAGE.zh.md) | 完整手册：三条安装路径、六个工作流、每个参数 |
| [docs/HISTORY.zh.md](docs/HISTORY.zh.md) | 从 v0.1 到现在，按"被什么打脸"组织 |
| [CHANGELOG.md](CHANGELOG.md) | 逐版本变更 |
| [CREDITS.md](CREDITS.md) | 第三方致谢、社区贡献、测试素材作者 |
| [README.en.md](README.en.md) | English |

## 许可

见 [LICENSE](LICENSE)。
