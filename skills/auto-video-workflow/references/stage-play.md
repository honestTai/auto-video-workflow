# 舞台剧片型：主持人 + 场景 + 画中画

账号有固定主持人 / IP 角色时用这个片型（`strategy.md` 会写明）。它和「世界画布」是两套语法，**一条片子只用一套**。

| | 世界画布（`motion-lib-guide.md`） | 舞台剧（这份） |
|---|---|---|
| 画面 | 一块深色画布，镜头在内容之间走 | 一个个场景，角色站在场景里演 |
| 换分镜 | 镜头推过去 | 硬切；换场景时用马赛克 |
| 根元素 | `data-world="snake"` | `data-mode="stage"`，不写 `data-world` |
| 适合 | 没有角色、以截图和数据为主 | 有角色、要演类比和小剧场 |

可运行的样板：`references/recipes-stage/index.html`（先 `node SKILL/scripts/init-project.mjs SKILL/references/recipes-stage`，再浏览器打开 `index.html?play`）。

## 0. 先想清楚：这是一场戏，不是一页页幻灯片

舞台剧最容易做坏的样子：**场景压暗当背景，上面盖一块大面板，面板里列几行字，角色站在旁边念**。这就是换了皮的 PPT。`check.mjs` 会直接报错。

| 幻灯片的做法（错） | 一场戏的做法（对） |
|---|---|
| 一块大面板盖住半个画面，里面 3–5 行说明 | 场景亮着；信息是场景里的**小道具**：一块牌子、一个大数字、一个气泡，一次只立一样 |
| 榜单 / 对比做成表格或进度条 | 只立最关键的**两个数字**，一大一小，念到哪个出哪个 |
| 每个分镜换一套版式，角色跟着换 | 同一个场景连着用 3–4 个分镜，角色一直在台上，只换道具 |
| 换人说话 = 这个人消失、那个人出现 | 上一个说话的人留在台上听，新说话的人提前半拍冒出来 |
| 全片只有「角色 + 内容」一种景别 | 每 8–12 秒切一次别的景别：脸部特写、全屏插画、全屏录屏 |

观众在**听**口播，画面上的字只是提示。一屏不超过 30 个字（字幕不算）。

**画风：像素风，但字要大。** 根元素用 `theme-pixel`：牌子、大数字、面板、章节条会自动变成像素字体 + 米色底 + 黑边硬阴影。像素字体只在大字号下清楚，所以道具的字号不要改小（牌子 60px、数字 192px、标签 48px，都是库里的默认值）；字幕保持普通黑体。场景背景也用像素风来画。

## 1. 铁律（带「查」字的 `check.mjs` 会查，报 ✗ 必须改）

1. **不盖大面板**（查）。任何实心色块不能盖住超过 1/4 的画面。信息用 `.fx-sign` / `.fx-score` / `.fx-bubble` 这类小道具立在场景里；确实要给一张截图或一段原文，放进设备屏（`device`）。
2. **一屏不超过 30 个字**（查）。超了就删到只剩关键词和数字，或拆成两个分镜。
3. **场景要亮着**（查）。只有弹出信息窗口（`device window`）的那两三秒可以压暗背景，其余时间不许压暗、不许盖半透明黑底。
4. **每 3 秒画面必须变一次**（查）。变化 = 换姿势、立一个道具、小演员动一下、切特写或插画。
5. **换分镜只用硬切和马赛克**（查）。同一个场景里：不写 `data-in`。换场景（一般也是换章节）：`data-in="mosaic"`。
6. **同一个场景至少连着用 2–3 个分镜。** 连续分镜的 `backdrop` 写同一张图，库会把它们当成同一个地方（背景不重置、角色不下台）。全片 4–6 个场景。
7. **每句话换一次姿势**（一句 = 一行字幕），和道具在同一个时间点变。
8. **每 8–12 秒切一次别的景别**：`closeup`（脸部特写，不需要素材）、`cutaway`（全屏插画或录屏）。提问、反转、吐槽、被震惊的那一句，优先给特写。

「先摆后讲、字号 ≥ 32px」照旧。

## 2. 页面骨架

```html
<link rel="stylesheet" href="lib/fx.css" />
<script src="lib/vendor/gsap.min.js"></script>
<script src="lib/fx.js"></script>
<script src="lib/fx-world.js"></script>      <!-- 只用它的 wake / push-back / zoom-here；不写 data-world 就不会启用世界画布 -->
<script src="lib/fx-puppet.js"></script>     <!-- 角色 -->
<script src="lib/fx-stage.js"></script>      <!-- 场景、画中画、小演员 -->
<script src="timing.js"></script>

<div id="root" class="theme-pixel" data-composition-id="main" data-width="1920" data-height="1080" data-fps="60" data-mode="stage">

  <!-- 同一个场景的第 1 个分镜 -->
  <section class="scene" data-scene="S03" data-d="7.06"
           data-fx="closeup@0(who=host,dur=1.1,pose=think,kind=question,color=blue) pup-pose@1.3(who=host,pose=wave) pup-pose@4.8(who=host,pose=point)">
    <div data-make="backdrop" data-src="assets/stage/classroom.jpg"></div>
    <div class="fx-sign" style="left:900px;top:150px" data-fx="drop-bounce@1.3">综合智商榜</div>
    <div class="fx-score" style="left:820px;top:300px">
      <div class="win"  data-fx="pop-in@2.3"><b data-fx="count@2.35(from=40)">65</b><span>甲 · 全球第一</span></div>
      <div class="lose" data-fx="pop-in@4.8 shake@5.0"><b>62</b><span>乙</span></div>
    </div>
  </section>

  <!-- 同一个场景接着讲：backdrop 写同一张图，不写 data-in -->
  <section class="scene" data-scene="S04" data-d="6.73" data-fx="…">
    <div data-make="backdrop" data-src="assets/stage/classroom.jpg"></div>
    …
  </section>

  <section class="scene overlay" data-t="0" data-d="全片秒数">
    <!-- 章节条：每章 2–6 个字；chapter 的时间是全片的绝对秒数（每章第一个分镜的开始时间） -->
    <div data-make="chapters" class="big" data-labels="开场,第二章,第三章,第四章,结尾" data-fx="chapter@0(i=1,dur=0.01) chapter@20.9(i=2) …"></div>
    <div data-make="actor" data-name="host" data-src="…" data-poses="…" data-eyes="…" data-neck="…" data-home="-10,0,640"></div>
  </section>
</div>
```

- 角色放在常驻层，是**半身大立绘站在画面下方的一角**（尺寸 600–680）。说话、眨眼、呼吸是自动的。
- **道具放在角色没占的地方**：角色在左下角时放右边 2/3（x 640–1820）；在右下角时放左边 2/3（x 100–1210）；两边都有角色时放中间上半屏（x 560–1360，y 110–580）。账号的角色脚本如果提供了自动避让的容器（`strategy.md` 会写），优先用它。
- 背景不用自己写慢推：库会在换到新场景时让背景「落位」，之后一直缓慢推进。
- 账号的角色由私有配置提供时，按 `strategy.md` 写的方式接入（一般是加载角色脚本并调用它的初始化函数，代替上面的 `data-make="actor"` 和 `FX.build()`）。

## 3. 零件速查

### 场景和切换

| 要做什么 | 写法 |
|---|---|
| 场景背景 | `<div data-make="backdrop" data-src="assets/stage/xxx.jpg">`；没有图时 `data-kind="field\|room\|city\|night"` 用程序画的像素场景顶上 |
| 换场景 | 后一个分镜写 `data-in="mosaic"` |
| 钻进屏幕 | 设备上写 `dive@分镜最后0.5秒`，下一个分镜的 `backdrop` 用屏幕里最后那张图 |

### 景别（每 8–12 秒用一次）

| 要做什么 | 写法 |
|---|---|
| 脸部特写（反应镜头） | 写在 `<section>` 上：`closeup@秒数(who=host,dur=1.1,pose=think,kind=question,color=blue)`。硬切到这个角色的大脸 + 放射线底色，到时间硬切回来。`color`：`orange` `red` `blue` `green` `purple` |
| 全屏插画 | `<img src="assets/cut/xxx.jpg" data-fx="cutaway@秒数(dur=1.8)">`（期间角色自动让位） |
| 全屏录屏、角色继续讲 | `cutaway@秒数(dur=2.4,under=1)` |

### 场景里的道具（代替面板）

| 要做什么 | 写法 |
|---|---|
| 牌子（标题、结论、标签） | `<div class="fx-sign" style="left:…;top:…" data-fx="drop-bounce@秒数">主文字<small>小字</small></div>`；加 `dark` 黑底、`red` 红底（警告、吐槽）、`tilt` 歪一点；里面的 `<b>` 是变色的大数字 / 关键词。结论和吐槽用 `stamp-in`（盖章式）出现 |
| 两个数字对比 | `<div class="fx-score" style="left:…;top:…"><div class="win" data-fx="pop-in@秒数"><b>65</b><span>名字</span></div><div class="lose" data-fx="pop-in@秒数"><b>62</b><span>名字</span></div></div>`；带单位写成 `<b>5<small>分钟</small></b>`；标签不超过 8 个字 |
| 气泡（角色的一句吐槽） | `<div class="fx-bubble" style="left:…;top:…" data-fx="pop-in@秒数">这也太慢了</div>`；加 `right` 尖角在右边 |
| 强调已经立着的道具 | `pulse@秒数` `shake@秒数` `count@秒数(from=0)` `stamp-in@秒数`（盖章式出现） |
| 选择 / 任务面板（小） | `<div … data-make="menu" data-title="任务单" data-items="第一项/第二项" data-fx="pop-in@秒数 choose@秒数(i=1)">`，每项不超过 8 个字 |

### 画中画（给截图、原文、录屏）

| 要做什么 | 写法 |
|---|---|
| 笔记本 / 手机里放内容 | `<div class="abs" style="…" data-make="device" data-kind="laptop\|phone"> <img> <img> … </div>`，换内容 `screen-to@秒数` |
| 实机录屏 | `<div data-frames="assets/pip/名字/f_%03d.jpg" data-n="帧数" data-fx="frames@0(fps=20)">`（放在 device 里就是画中画） |
| 信息窗口（截图 / 一句原文） | `<div … data-make="device" data-kind="window" data-title="来源 · 标题" data-fx="scale-in@秒数(dur=0.25)">`，同一秒给背景写 `push-back@秒数(s=1,blur=3,dim=0.5)`。窗口里放截图，或不超过两行的原文；停 2–3 秒就收掉（`fade-out@秒数`）并 `bring-front@秒数` 把背景亮回来 |
| 圈重点 | 窗口里的文字用 `marker@秒数`；截图用透明定位块 + `box@秒数` |

### 角色

| 要做什么 | 写法 |
|---|---|
| 换姿势 | 写在 `<section>` 上：`pup-pose@秒数(who=host,pose=姿势名)` |
| 情绪符号 | `pup-emote@秒数(who=host,kind=sweat)`：`question` `exclaim` `sweat` `anger` `sparkle` `idea` `heart` `zap` `dots`。一个分镜最多 1–2 次 |
| 临时走到某个道具旁边 | 写在那个道具上：`call@秒数(who=guest,at=right)`；回去 `dismiss@秒数(who=guest)` |
| 小演员走进来 | `<div class="abs" style="left:1940px;top:…;width:200px;height:250px" data-make="mini" data-src="…" data-poses="walk1/walk2" data-tag="名牌" data-fx="mini-walk@0.3(x=-700)">`（只有一张站立图也能用，不写 `data-poses` 即可） |
| 小演员做动作 | `mini-pose@秒数(name=cheer)`、`hop@秒数` |

`fx-world.js` 里的 `cam-*` 动效在舞台剧里不能用（没有相机）。

## 4. 分镜表（舞台剧版）

写 `index.html` 之前，在 `script.md` 里填这张表，每行是一句字幕：

| 分镜 | 秒 | 这句在讲什么 | 场景 | 这句立什么道具（≤ 12 字） | 说话角色的姿势 | 景别 |
|---|---|---|---|---|---|---|
| S01 | 0.0 | 抛结果 | 纸底 | 笔记本里放成品录屏 | wave | 中景 |
| S01 | 3.1 | 问「这是什么」 | 同上 | 屏内切到第 2 张 | point | 中景 |
| S02 | 0.0 | 「喂！」 | 发布会舞台（钻进屏幕） | — | cheer | **特写**（0.5s） |
| S02 | 0.6 | 双模齐发 | 同上 | 牌子「Astra」「Sol」 | present | 中景 |
| S02 | 3.6 | 缓存降六成 | 同上 | 黑牌子「缓存读取 -60%」 | explain | 中景 |
| S02 | 5.0 | （同一句的后半） | 同上 | — | — | **插画**：举着水晶撒金币（1.7s） |
| S03 | 0.0 | 「降价有啥用？」 | 同上（不换场景） | — | ask | **特写**（1.1s） |

填完检查：

1. 「这句立什么道具」一栏每格只有**一样东西**，不超过 12 个字。写不下说明这句话该只留关键词。
2. 「场景」一栏连续 2–3 个分镜相同；全片 4–6 个。
3. 「景别」一栏每 8–12 秒至少有一个特写、插画或全屏录屏；提问句、反转句优先给特写。
4. 「说话角色的姿势」相邻两行不重复。

## 5. 素材清单（写画面之前备齐）

用你自带的生图能力生成，存到工程的 `assets/` 下；**生成后每张都打开看一眼**。

| 素材 | 数量 | 规格 | 存放 |
|---|---|---|---|
| 场景背景 | 4–6 张 | 1920×1080，无人物、无文字，同一种画风，**画面中间要有一块相对空、相对暗的区域**（黑板、屏幕、天空、墙面），道具会立在那里 | `assets/stage/` |
| 插画特写 | 每 15–20 秒 1 张 | 1920×1080，无文字，画的是这句话的具体情境，角色用账号的角色设定图做参考保持长相一致 | `assets/cut/` |
| 截图 | 每个引用出处 1 张 | `shot.mjs` 抓 | `assets/shots/` |
| 实机录屏 | 有就用 | 抽成序列帧：`ffmpeg -i 录屏.mp4 -vf fps=20,scale=768:-2 assets/pip/名字/f_%03d.jpg` | `assets/pip/名字/` |

- 生图提示词写清：画面内容、画风、「16:9 横图」「画面里不要出现任何文字」。角色相关的图把角色设定图作为参考图传入。
- 没有生图能力：背景用 `data-kind` 的程序场景，插画用 `closeup` 和录屏代替，并在最后的汇报里说明。
- 角色的姿势和小演员是账号的固定资产，不在每期生成；缺哪个姿势就用现有的最接近的，并在汇报里列出「建议补充的姿势」。

## 6. 自检时额外看的

`check.mjs` 通过后看 `sheet.jpg`，逐帧问自己：**这一帧像动画片里的一个镜头，还是像一页幻灯片？**

- 能看到场景吗？场景被盖住一大半、或者暗得看不清，就是幻灯片。
- 道具是不是一眼能读完？要停下来读的就是字太多。
- 角色有没有挡住道具。
- 连着几帧是不是同一个构图？是的话加一个特写或插画。
- 特写和插画那一帧里没有别的角色叠在上面（`under=1` 的录屏除外）。
