---
name: auto-video-workflow
description: 给一个主题（或从配置的关键词里自动选题），全自动做出一条 1080p 60fps 的口播讲解视频并发布到抖音：复盘本号播放与5秒跳出数据 → 搜集抖音与全网资料 → 写口播文案和发布信息 → 豆包语音配音并锁定时间轴 → 用 motion-lib 动效库按分镜配方写画面并通过机器自检 → 加 BGM 混音渲染成片 → 生成封面 → 通过 douyin-video-mcp 发布。当用户说"做一期关于 ×× 的视频发抖音 / 自动出片 / 全自动做视频 / 从关键词里选题做视频 / 用 motion-lib 做口播视频并发布"时使用。
---

# 全自动出片 + 发布

用户给一个主题，你一口气做完七步，最后交付：成片 MP4、封面、已发布的抖音作品链接。

## 工作方式：不停顿，一次跑完

风格、文案、选曲、封面都由你自己决定，**中途不要停下来问用户**，发布前也不用再确认——用户叫你做这件事就是要你发出去。
只在这几种情况停下来说明原因：

- 缺必要的配置：豆包语音密钥、motion-lib、抖音账号凭证（怎么配见 `references/setup.md`）。
- 抖音凭证失效、触发验证码或二次验证：让用户在浏览器里处理后重新采集凭证。
- 已绑定的抖音账号和配置里指定的账号名对不上。
- 用户明确说了「只出片不发布」（做到第 6 步为止）或「dry-run」（第 7 步用 `dry_run=true`，只校验不上传）。

其他问题（某个脚本报错、`check.mjs` 报 ✗、截图有瑕疵、配音某个词读错）自己修好再继续。

约定：下文的 `SKILL` 指本文件所在目录，`<工程>` 指 `videos/<slug>/`。

## 第 1 步：加载配置，复盘本号数据，搜集资料

**配置。** 依次找 `profile.json` 和 `strategy.md`：先看仓库根目录的 `.local/`，再看 `~/.config/auto-video-workflow/`。都没有就按通用流程走。

- `profile.json`：`account`（要发布到的抖音账号名）、`keywords`（选题关键词池）、`visibility`（0 公开 / 1 仅自己可见 / 2 好友可见，缺省 0）、`allow_download`、`voices`（默认音色）、`motion_lib`（动效库路径）、`review_analytics`（出片前是否拉取本号播放数据复盘，缺省 `true`）、`analytics_limit`（复盘最近几条作品，缺省 `10`）。
- `strategy.md`：用户自己的附加创作要求。**它的要求优先于本文件和 `references/` 里的通用写法**，写文案和发布信息时照做，但不要把它的内容写进任何会入库的文件。

**复盘本号播放数据。** 只要账号凭证已就绪且未显式关闭（`review_analytics !== false`），先读 `references/analytics.md`，调 `douyin-video-mcp` 的 `get_account_analytics`（未挂载 MCP 时用 `mcp/.venv/bin/python mcp/douyin_cli.py analytics --limit 10`）拉取本号近期作品的播放量、**2 秒跳出率**、**5 秒跳出率（`bounce_rate_5s`）**、完播率、平均播放时长与互动吸粉率；必要时对表现最好和跳出最高的代表作调 `get_video_diagnosis` 看同级对比与流量来源。把短板原因和本期针对性改法记下来，写进第 2 步的 `<工程>/script.md` 顶部，并在开头前 5 秒钩子、分镜节奏和收尾互动里兑现。

**选题。** 用户给了主题就用它。没给就从 `keywords` 里选：每个关键词各搜一轮（抖音一天内最新 + 全网最近动态），结合本号历史高留存题材挑当下最有信息增量的切入点。

**资料。** 两条通道都要走：

- 抖音：调 `douyin-video-mcp` 的 `search_videos`，同一个关键词搜两次——`sort_type="1"`（最多点赞，看爆款的标题和话题标签怎么写）和 `sort_type="2", publish_time="7"`（一周内最新，看这个题最近讲到哪了）。需要细看某条对标视频时用 `get_video_info`，必要时 `download_video` 下载下来分析。
- X 与全网：用你自带的联网搜索，找这个主题的一手信息——官方公告、作者原话、最新数据、真实案例和争议点。

事实、数字、引用逐条记下出处。**查不到出处的不写，不编数据。**

**素材。** 画面要靠真素材撑起来，不能全是文字卡片。每条要引用的事实，顺手把出处页面截下来（工程建好之后执行，见第 2 步）：

```bash
node SKILL/scripts/shot.mjs <工程> https://出处网址 --name 起个英文名
```

截图存到 `<工程>/assets/shots/`，**每张都要打开看一眼**（有没有登录墙、弹窗、空白页）。一条 60–90 秒的片子至少准备 4 张能用的截图。

## 第 2 步：写口播文案和发布信息

先读 `references/copywriting.md`。

```bash
node SKILL/scripts/init-project.mjs <slug> --topic "主题"     # slug 用英文小写加连字符
```

工程建在当前目录的 `videos/<slug>/` 下，motion-lib 的运行时会同步到工程的 `lib/`。然后写两个文件：

**`<工程>/script.md`**：资料与出处、口播全文、发布信息。

**`<工程>/project.json`**：

```json
{
  "slug": "mcp-overload",
  "topic": "别再给 AI 瞎装 MCP",
  "theme": "theme-studio",
  "voices": { "host": "音色 id", "guest": "另一个音色 id" },
  "publish": {
    "title": "别再给你的 AI 瞎装 MCP 了",
    "desc": "装得越多，AI 反而越慢。\n① 为什么会变慢\n② 该留哪几个\n③ 怎么自己写一个",
    "tags": ["AI", "MCP", "AI工具"],
    "cover": { "lead": "装得越多越慢的", "title": "MCP 避坑指南", "tag": "三条铁律" }
  },
  "scenes": [
    { "id": "S01", "say": "你的 AI 是不是也这样？一口气塞了{三十六个 MCP}，结果越用越慢。" },
    { "id": "S02", "speaker": "guest", "say": "等等，装得多不是功能更全吗？" }
  ]
}
```

- 口播 60–90 秒，约 300–450 字，8–16 个分镜；开头 3–5 秒直接抛结果、反常识或硬数字。
- 一个逗号一行字幕，每行 6–16 字。每个分镜用 `{花括号}` 标 1–2 个重点词。
- 单人讲解不用写 `speaker` 和 `voices`；双人或多人对话给每句写 `speaker`，在 `voices` 里给每个角色配不同音色。
- `publish.title` 不超过 20 个字符；`tags` 3–5 个；`cover` 三要素按 `copywriting.md` 写。
- 加载到了 `strategy.md` 就把它的要求自然地融进文案和简介。

## 第 3 步：配音，锁定时间轴

**配音必须在写画面之前。** 画面的每个分镜多长，由配音的真实时长决定。

```bash
node SKILL/scripts/tts.mjs <工程>
```

默认用豆包语音、1.1 倍节奏。它会生成 `audio/voice.wav`，把每个分镜的 `start` / `end` / `duration` 和逐行字幕 `lines` 写回 `project.json`，并生成 `timing.js`（含逐字时间戳对齐的字幕 `subtitles`、分镜时间 `scenes`，以及按真实人声波形计算的 20fps 口型序列 `mouth`）。终端会打印每个分镜的 `data-d`。

某个词读得不对：给那个分镜加 `"tts": "按想要的读法写的整句"`（`say` 仍用于字幕），重跑即可，没改的分镜会复用缓存。

## 第 4 步：填分镜表，写画面，自检

**先定片型**（一条片子只用一种）：

- **舞台剧**：账号有固定主持人 / IP 角色时用（`strategy.md` 会写明）。主持人半身常驻前景，背景是一个个场景，信息用画中画给。**读 `references/stage-play.md`，按它的骨架、分镜表和素材清单做**，样板在 `references/recipes-stage/index.html`。下面第 1、2 小步换成它里面对应的做法，第 3、4 小步（自检、截图）不变。
- **世界画布**：没有角色、以截图和数据为主时用。读 `references/motion-lib-guide.md` 和 `references/scene-recipes.md`，按下面的步骤做。

**写画面是「挑配方、填内容」，不是从空白页开始设计。**

1. **填分镜表。** 在 `<工程>/script.md` 里加一节「分镜表」，每个分镜一行：时长、这句在讲什么、用哪个配方（R01–R11）、主素材、念到哪句触发什么。
   格式和四条检查规则见 `scene-recipes.md` 第 1 节。表没填完不要写代码。
2. **写 `<工程>/index.html`。** `init-project.mjs` 生成的页面已经是世界画布的骨架（`data-world` + `theme-studio`）：
   - 一个分镜一个 `<section class="scene" data-scene="S01" data-d="…">`，顺序和 `scenes` 一一对应，`data-d` 用第 3 步打印的真实秒数。
   - 每个分镜的内容从 `references/recipes/index.html` 里**整段复制对应的配方**，再按 `scene-recipes.md` 第 3 节改文字、图片和时间。
   - **不写 `data-in`**：换分镜默认就是镜头走过去。第 1 个分镜加 `cam-wide@0 cam-home@0.9`，最后 1 个分镜加 `cam-wide@-2.4`。
   - 常驻层里的进度线：`data-n` 改成章节数，每章第一个分镜的开始秒数写一个 `segment@秒数(i=第几章)`；常驻层的 `data-d` 改成全片秒数。
   - 账号有固定主持人 / IP 角色时（`strategy.md` 里会写）：角色会自己眨眼、呼吸、对口型；你要做的是让它**跟着内容走**——讲到哪个元素，就在那个元素上写 `call@秒数(who=角色名)`，不要让角色全程待在同一个地方（见 `motion-lib-guide.md` 2.5 节）。
3. **机器自检，必须通过。**

```bash
node SKILL/scripts/check.mjs <工程>
```

   它会查：动效名写错、用了动效却没加载它所在的模块、触发时间超出分镜、**连续几秒画面没有变化**、字小于 32px、镜头到位时空屏、画面太空、文字出画或重叠、真素材太少、时长和配音对不上。
   **有「✗」就按提示改，改完重跑，直到没有 ✗。**「!」是建议，能改就改。不要跳过这一步直接截图或渲染。
4. **截图，用眼睛看。**

```bash
node SKILL/scripts/snap.mjs <工程>
```

   **必须打开这两张图：**
   - `<工程>/snapshots/sheet.jpg`：每个分镜两帧，左边是镜头刚到位时、右边是后段。左边不能是空的或只有一行标题；右边文字没有溢出重叠、字幕没有压住主内容。
   - `<工程>/snapshots/phone.jpg`：每一格就是手机上看到的大小。**不放大的情况下，每一格的主文字都要能一眼读出来**，读不出来就删字、放大。

   有问题就改 `index.html`，从第 3 小步重新来，直到两张图都干净。

## 第 5 步：配 BGM，渲染成片

```bash
node SKILL/scripts/bgm.mjs list                              # 看本机曲库
node SKILL/scripts/bgm.mjs mix <工程> --track "曲名关键词"     # 按内容情绪选一首
node SKILL/scripts/render.mjs <工程>
```

- 选曲看标签和 BPM：干货快节奏选轻快的，深度解读选沉稳的；优先无人声的曲子。混音会把人声定在 -16 LUFS、垫乐 -24 LUFS，人声出现时自动压低，片尾淡出。
- 曲库是空的就跳过 `mix`，成片用纯人声。
- `render.mjs` 会先核对每个分镜的 `data-d` 和配音是否对得上，再渲染 1920×1080 60fps 的画面（自动通过 `lib/chrome-tall.sh` 启动 Chrome，避免底部字幕被截），合上音轨输出 `<工程>/renders/<slug>.mp4`，最后用 ffprobe 核对分辨率、帧率、时长和音轨。报错就按提示修。

## 第 6 步：封面

封面用你自带的生图能力来画，画面要来自这条视频的真实内容：

```bash
# 从成片里抽一两帧最有代表性的画面当参考图（时间点自己挑）
ffmpeg -y -ss 12 -i <工程>/renders/<slug>.mp4 -frames:v 1 <工程>/cover/ref-1.jpg
```

以参考帧为依据，生成一张 3:4 竖版封面海报：`publish.cover` 的三处文字（引导小字、主标题、印章）是画面里仅有的文字，主标题要大、要醒目，配色和成片的皮肤一致。生成后存到 `<工程>/cover/`，再裁成标准尺寸：

```bash
ffmpeg -y -i <工程>/cover/poster.png -vf "scale=1080:1440:force_original_aspect_ratio=increase,crop=1080:1440" <工程>/cover/cover-3x4.png
```

**打开封面逐字核对**：只能出现那三处文字，不能有错字、多字、少字。有错就重新生成，最多重试两次。

没有生图能力，或重试后文字仍然不对：不要卡住，直接用成片里最有代表性的一帧当封面（把上面抽帧命令的输出改成 `cover/cover-3x4.png` 并按同样方式裁切），在最后的汇报里说明。

## 第 7 步：发布

1. 调 `account_status`：`runtime_status` 要是 `saved`；`profile.json` 里写了 `account` 的话，绑定的账号名要和它一致。不满足就停下来告诉用户。
2. 调 `publish_video`：

| 参数 | 值 |
|---|---|
| `video` | `<工程>/renders/<slug>.mp4` 的绝对路径 |
| `cover` | `<工程>/cover/cover-3x4.png` 的绝对路径 |
| `title` / `desc` / `tags` | `project.json` 的 `publish` |
| `visibility` | `profile.json` 的 `visibility`，没有就 0 |
| `dry_run` | 用户要求 dry-run 时为 `true` |

当前会话没有挂载这个 MCP 时，用命令行，效果一样：

```bash
mcp/.venv/bin/python mcp/douyin_cli.py publish --video <成片> --cover <封面> --title "标题" --desc "简介" --tags "AI,MCP"
```

3. 返回 `status: "published"` 才算发布成功。返回 `failed` 时，登录或验证类的错误停下来请用户处理；其他错误把原始报错如实告诉用户，不要反复重试上传。

## 最后的汇报

一次说清楚：

- 选题和一句话结论，用到的主要出处
- 用了哪些配方、几张真素材，BGM 是哪首
- `check.mjs` 最后一次的结果（还剩哪些「!」没改、为什么）
- 成片路径（时长、分辨率）和封面路径
- 发布的标题、简介、标签
- 发布到的账号和作品链接（dry-run 或只出片时说明没有发布）
- 过程中降级处理的地方（比如没有曲库用了纯人声、封面用的是成片截帧）

## 参考

| 文件 | 什么时候读 |
|---|---|
| `references/analytics.md` | 出片前拉取本号播放数据、分析 2s/5s 跳出率与完播短板时 |
| `references/copywriting.md` | 写文案、标题、简介、标签、封面文字之前 |
| `references/motion-lib-guide.md` | 写 `index.html` 之前：世界画布、五条铁律、动效速查 |
| `references/scene-recipes.md` | 写 `index.html` 之前：分镜表怎么填、11 个配方怎么选怎么改 |
| `references/recipes/index.html` | 写每个分镜时：从这里整段复制配方代码 |
| `references/stage-play.md` | 舞台剧片型（有主持人 / IP 角色）：骨架、节奏铁律、零件速查、分镜表、素材清单 |
| `references/recipes-stage/index.html` | 舞台剧片型的可运行样板 |
| `references/setup.md` | 缺配置、第一次使用、凭证失效时 |
