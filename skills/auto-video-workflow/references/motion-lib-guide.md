# motion-lib 画面手册

> 这份手册讲的是**世界画布**片型。账号有固定主持人 / IP 角色、要做「主持人 + 场景 + 画中画」的舞台剧片型时，读 `references/stage-play.md`；语法、动效写法和铁律两边通用。

[motion-lib](https://github.com/honestTai/motion-lib) 是「HTML → 视频」的声明式动效库：在普通 DOM 元素上写
`data-fx="动效名@秒数"`，由 HyperFrames 逐帧渲染成 1080p 60fps 的 MP4。工程里的 `lib/` 是它的运行时拷贝。

**写画面只做三件事：挑配方 → 换内容 → 跑 `check.mjs`。**
配方在 `references/recipes/index.html`（可运行的样板，11 种常见分镜），说明在 `references/scene-recipes.md`。
不要从空白页开始自己设计版式。

## 1. 世界画布：全片只有一块画布

旧写法是「一个分镜一页，轮流显示」，成片像翻 PPT。现在统一用世界画布：

- 所有分镜（`<section class="scene">`）是**同一块大画布上的机位**，全片一个底色。
- 换分镜 = 镜头斜着推到下一个机位（0.8 秒，先往后拉一点再推进）。**不用写 `data-in`**。
- 镜头停在机位上时也在缓慢往前推，画面不会死。

```html
<div id="root" class="theme-studio" data-composition-id="main" data-width="1920" data-height="1080" data-fps="60"
     data-world="snake" data-cols="4" data-wall="账号名或主题词">
  <section class="scene" data-scene="S01" data-d="5.02"> … </section>
  <section class="scene" data-scene="S02" data-d="6.40"> … </section>
  <section class="scene overlay" data-t="0" data-d="全片秒数"> 常驻层：进度线、主持人 </section>
</div>
```

| 根元素属性 | 值 | 说明 |
|---|---|---|
| `data-world` | `snake`（默认用这个） | 机位蛇形排开，每行 `data-cols` 个 |
| | `row` | 一字排开，镜头一路往右 |
| | `depth` | 沿纵深排开，镜头一路往里穿（适合时间线、层层深入的内容） |
| `data-cols` | `4` | 每行几个机位 |
| `data-wall` | 文字 | 背景上一层很淡的字墙，写账号名或本期主题词 |

分镜上可以写的：`data-in="cam-jump"`（硬切，只在换大章节时用，全片不超过 2 次）。其他转场名在世界画布里不能用。

镜头动效（写在分镜或元素的 `data-fx` 里）：

| 动效 | 用法 | 什么时候用 |
|---|---|---|
| `cam-wide@0` + `cam-home@0.9` | 写在**第 1 个分镜**的 `<section>` 上 | 全片从「整块画布的总览」开场，再推进第一个机位 |
| `cam-wide@-2.4` | 写在**最后 1 个分镜**的 `<section>` 上 | 结尾镜头拉远，回看全片 |
| `cam-look@t` … `cam-home@t` | 写在要看的元素上 | 念到截图里的某一处时推过去，讲完拉回 |

## 2. 五条铁律（前四条 `check.mjs` 会查，查到就必须改）

1. **先摆后讲。** 主素材（图、卡片、图表、标题）从分镜开头就在画面里，**不要给它写按口播时间出现的入场动效**。
   口播时间点只用来触发强调：`wake`（点亮）、`zoom-here`（原位放大）、`cam-look`（镜头推过去）、`box` / `marker`（圈出来、划线）、`count`（数字滚动）。
   错误写法：`<div class="card" data-fx="pop-in@3.2">`（3.2 秒前画面是空的）。
   正确写法：`<div class="fx-tile" data-fx="wake@3.2">`（一开始就在、暗着，3.2 秒点亮）。
2. **字号不小于 32px。** 大标题 76px 起，卡片标题 52px，正文 38px。横屏视频在手机竖屏里会缩小 5 倍，小于 32px 的字等于不存在。
3. **一屏一个重点。** 除了左上角的标题，画面里的字不超过 15 个。内容多就拆成两个分镜。重点要占画面 1/4 以上。
4. **换分镜只靠镜头。** 不写 `data-in`（或只写 `cam-jump`）。
5. **每 3 个分镜至少 1 张真素材**（官网截图、榜单、公告、实测画面），并且占画面 40% 以上。截图用 `shot.mjs` 抓。全是文字卡片的片子没有冲击力。

另外三条靠自觉：

- **一个强调色。** 全片只用 `--fx-accent` 一个强调色（默认橙色，可在 `#root` 上改）。好 / 坏对比可以用 `--fx-good` / `--fx-bad`。不要每个分镜换背景色。
- **不用 emoji 当图标。** 不同机器渲染出来不一样。用数字编号（①②③）、文字标签或图片。
- **角色跟着内容走。** 账号有固定主持人 / IP 角色时，角色住在常驻层里，讲到哪个元素就用 `call` 把它叫到哪个元素旁边（见 2.5 节），不要全程钉在角落。

## 2.5 角色：跟着内容走，不要钉在角落

账号有固定主持人 / IP 角色时（素材和角色定义由本机私有配置提供，`strategy.md` 里会写清楚有哪些角色、各有哪些姿势），角色由 `lib/fx-puppet.js` 驱动：会自己眨眼、呼吸、摆头、对口型，不用为这些写任何东西。**你要决定的只有一件事：每句话角色站在哪。**

规则：**讲到画面里的哪个元素，角色就去到那个元素旁边。** 在被讲的元素上写 `call`：

```html
<div class="abs shot" style="…" data-fx="call@0.2(who=host)"><img src="assets/shots/pricing.png"></div>
<div class="fx-tile" data-fx="wake@2.6 call@2.6(who=host)">…</div>          <!-- 念到这张卡，角色换到这张卡上面 -->
```

| 写法 | 效果 | 什么时候用 |
|---|---|---|
| `call@t(who=host)` | 角色在原地蹲下，从这个元素的**上沿**探出来 | 默认用这个。元素上方要有 300px 以上的空位，否则会自动换位置或改站到旁边 |
| `call@t(who=host,at=left)` / `at=right` | 角色站到元素的左边 / 右边（脚踩画面底边） | 元素很高、上面没地方时；R01 大数字旁边 |
| `call@t(who=host,pose=think)` | 过去的同时换姿势 | 姿势名以 `strategy.md` 为准 |
| `dismiss@t(who=host)` | 角色蹲下离场 | 要让观众专心看一张大图、一段演示时 |
| `pup-emote@t(who=guest,kind=sweat)` | 头顶弹出情绪符号：`question` `exclaim` `sweat` `anger` `sparkle` `idea` `heart` `zap` `dots` | 反应、吐槽、恍然大悟。**不要用 emoji** |

- `who` 是角色名（`host` / `guest` 等，以 `strategy.md` 为准）。
- **一个分镜里至少让说话的角色换一次位置**（跟着口播从一个元素走到下一个元素）。全程站在同一个地方就是「钉在角落」，观众会腻。
- 没写 `call` 的分镜，说话的角色会自动去到该分镜的主素材旁边，其他角色离场；所以不写也不会出错，写了更生动。
- 需要几个角色同台对话（抬杠、吐槽）的分镜，按 `strategy.md` 里的写法切到同台模式；这种分镜把内容放在上半屏（y 300–560），下半屏留给角色。
- 角色会挡住它身后的东西：`call` 的目标不要选正在被读的文字块正上方有标题的位置，自检截图里看一眼有没有挡字。

没有角色的账号跳过这一节。

## 3. 和配音对齐

- **一个分镜一个 `<section class="scene">`**，顺序和 `project.json` 的 `scenes` 一一对应，写上 `data-scene="S01"`。
- **`data-d` 必须等于 `tts.mjs` 打印的真实秒数**（精确到 0.01）。`check.mjs` 和 `render.mjs` 都会逐个核对。
- 字幕不要手抄：`FX.subtitles(AVW_TIMING.subtitles, { style: 'studio' })`。口播文本里用 `{花括号}` 标的重点词会自动染成强调色。
- 元素上的 `@秒数` 是**相对所在分镜开头**的秒数。想让某个元素在念到某句话时被强调：
  用 `project.json` 里该分镜 `lines[i].start` 减去该分镜的 `start`。
- 常驻层 `<section class="scene overlay" data-t="0" data-d="全片秒数">` 里的 `@秒数` 是**全片的绝对秒数**。
- 改了口播文本 → 重跑 `tts.mjs` → 按新打印的秒数更新 `data-d`。

## 4. `data-fx` 语法

`data-fx="[目标:]名字@时间(参数=值,参数=值)"`，同一个元素可以串多个，用空格分隔。**括号里不能有空格，参数值里不能有逗号。**

```html
<b  data-fx="count@0.6 marker@1.6">7,000</b>
<div data-fx="wake@2.4 zoom-here@4.0(s=1.5,hold=1.6)">…</div>
<ul data-fx="each:wake@1(stagger=1.8)"><li>第一条</li><li>第二条</li><li>第三条</li></ul>
```

| 组成 | 写法 | 含义 |
|---|---|---|
| 时间 | `@1.2` | 分镜开始后 1.2 秒 |
| | `@+0.3` | 比同一元素上的前一个动效晚 0.3 秒 |
| | `@-0.4` | 分镜结束前 0.4 秒 |
| 目标 | 省略 | 元素自己 |
| | `each:` | 每个直接子元素，按 `stagger` 依次触发 |
| | `chars:` `words:` `lines:` | 拆成单字 / 单词 / 行逐个动 |

**动效名只能用这份手册和 motion-lib `README.md`「动效目录」里有的。** 写错的名字页面不会报错、只是不动；`check.mjs` 会查出来并提示相近的名字。

## 5. 常用动效

### 强调（念到时触发，最常用）

| 动效 | 效果 |
|---|---|
| `wake@t` | 元素一开始就在但是暗的，念到时点亮 |
| `zoom-here@t(s=1.5,hold=1.6)` | 在原位放大，同组其他元素淡到 30%；`hold` 秒后自动收回 |
| `cam-look@t` / `cam-home@t` | 镜头推到这个元素上 / 拉回 |
| `box@t` | 沿元素外沿画一圈框（圈截图里的重点） |
| `marker@t` / `underline@t` | 荧光笔 / 下划线 |
| `count@t(from=0)` | 数字滚动到元素里写的那个数 |
| `pulse@t` / `shake@t` | 轻跳一下 / 抖一下（否定、警告） |
| `push-back@t` | 把这一层整体往后推（缩小、变虚、变暗），给新出现的内容让位 |
| `bg-tint@t(color=#33245e)` | 背景整块换色；`color=reset` 换回来 |

### 图片组

| 组件 + 动效 | 效果 | 用在 |
|---|---|---|
| `data-make="fan"` + `pick@t(i=2)` | 扇形排开，讲到谁谁抬起放大 | 3–6 张图挨个点评 |
| `data-make="slices"` + `slice-to@t` | 新图切成 5 条从下往上长出来 | 一长串同类图快速过 |
| `data-make="tunnel"` + `fly@t(to=6)` | 镜头往里飞，图一张张迎面过来 | 作品集、时间线 |
| `data-make="helix"` + `helix-spin@t` | 图围成圆筒，镜头绕着转 | 「有这么多」的数量感 |
| `data-make="flipboard"` + `flip-to@t(i=2)` | 展板一块块翻上来 | 图 + 说明成对出现 |
| `each:deal-in@0` | 一张接一张沿弧线飞到位 | 一组图的出场（这是少数可以写在 `@0` 的入场） |
| `skeleton@0` | 先出灰色骨架，再一块块填上内容 | 复杂界面、仪表盘 |
| `drop-gather@0(keep=3)` | 一堆图落下、收拢，只留要讲的几张 | 「从很多里挑几个」 |

### 流程、图表、包装

| 组件 + 动效 | 效果 |
|---|---|
| `data-make="road"` + `road-walk@t(i=2)` | 流程铺成一条路，走到哪步哪步亮（3–5 步） |
| `data-make="bars"` + `each:grow-y@0.3` | 柱状图；`data-values`、`data-labels`、`data-hi`（高亮第几根，从 1 数） |
| `data-make="bignum"` + `bignum@0` | 章节卡：大数字 + 章节名 |
| `data-make="segments"` + `segment@t(i=2)` | 顶部分段进度线（放常驻层） |
| `depth@0` + `rack-focus@t(to=far)` | 子元素写 `data-depth="near\|mid\|far"`，焦点在哪层哪层清楚 |

### 入场（只给次要的、后出现的小元素用）

`rise-in` `scale-in` `blur-rise-in` `stamp-in`（盖章，结论词）。主素材不要用入场动效，见铁律 1。

## 6. 现成的版式类（`theme-studio`）

| 类 | 是什么 | 字号 |
|---|---|---|
| `.fx-head` | 分镜左上角的标题区：`<div class="fx-head"><i>小标签</i><h2>大标题<em>强调词</em></h2></div>` | 34 / 76 |
| `.fx-big` | 一个超大的数字或结论词：`<div class="fx-big"><em>20</em><small>倍</small></div>` | 380 |
| `.fx-tile` | 卡片：`<div class="fx-tile"><h3>标题</h3><b class="n">$3</b><p>说明</p></div>`；加 `.win` 描金边，加 `.bad` 数字变红 | 52 / 210 / 38 |
| `.shot` | 截图框：`<div class="abs shot" style="left:…;top:…;width:…;height:…"><img src="…"></div>` | — |
| `.fx-frame` | 带四个角标的取景框（演示区的边框） | — |
| `.t-title` `.t-h2` `.t-h3` `.t-body` | 104 / 72 / 48 / 40 的文字 | |
| `.accent` `.muted` | 强调色 / 次要灰 | |
| `.abs` `.row` `.col` `.center` `.layer` | 绝对定位 / 横排 / 竖排 / 居中 / 整屏层 | |

定位一律用 `class="abs"` 加明确的 `left / top / width / height`，不要靠内容自己撑开。

## 7. 布局安全区（1920×1080）

| 区域 | 范围 | 规则 |
|---|---|---|
| 进度线 | y 0–80 | 不放内容 |
| 标题区 | y 110–290 | `.fx-head` 在这里 |
| 主内容 | y 300–880 | 图、卡片、图表都放在这个范围内 |
| 字幕带 | y 910–1060 | **主内容不要低于 y=880** |
| 左右边距 | 各 96px | |
| 主持人 | 常驻层，一般在左下或右下角 | 这一侧的主内容往另一边让 |

## 8. 确定性（违反了会静止、闪烁或每次渲染不一样）

1. 不用 CSS `animation` / `transition` / `@keyframes`。
2. 不用 `setTimeout` / `setInterval` / `requestAnimationFrame`。
3. 随机一律用 `FX.rand(seed)`，不用 `Math.random()`。

库里没有的动效，在 `FX.build({ extra(tl, at) { tl.to('#id', { … }, at('S03', 1.2)); } })` 里直接操作主时间线。

## 9. 其他皮肤和模块（特殊题材才用）

默认用 `theme-studio`。只有题材明显更适合别的风格时才换，换了也照样写 `data-world`：

| 皮肤 | 视觉 | 字幕样式 |
|---|---|---|
| `theme-studio`（默认） | 深色画布 + 一个强调色 | `studio` |
| `theme-white3d` | **白底立体（纯白无影棚）**：高浮起卡片/真厚度 3D 样机 + 柔光落地影 | `pill` / `studio` |
| `theme-white3d desk` | **白底立体（白格牌桌）**：随镜头视差移动的建筑方格桌面 + 扑克/包装盒/爆炸分层 | `pill` / `studio` |
| `theme-gold` | 黑金电影感 | `plain` |
| `theme-violet` | 白紫科技 | `pill` |
| `theme-pixel` | 像素复古 | `bar` |
| `theme-paper` | 剪纸拼贴 | `paper` |
| `theme-space` | 深空粒子 | `plain` |

可选模块（用到才加载，顺序不能错）：

```html
<script src="lib/vendor/gsap.min.js"></script>
<script src="lib/vendor/three-fx.min.js"></script>     <!-- 真 3D 需要，放在 fx.js 前 -->
<script src="lib/fx.js"></script>
<script src="lib/fx-world.js"></script>                <!-- 世界画布（必加） -->
<script src="lib/fx-desk3d.js"></script>               <!-- 白底立体（配 theme-white3d）：phone3d / card3d / box3d / layers3d / deck3d / wall3d / flap3d -->
<script src="lib/fx-particles.js"></script>            <!-- 2D 粒子：<div class="layer" data-make="space" data-fx="starfield@0"> -->
<script src="lib/fx-3d.js"></script>                   <!-- 3D 场景：<div class="layer" data-make="stage3d" data-fx="stars3d@0"> -->
```

### 9.1 白底立体全系组件与动效速查（`theme-white3d` + `fx-desk3d.js`，18 组件 · 30 动效 · `card-wipe` 转场）

完整可运行样板见 `motion-lib/examples/white3d/index.html`：

| 组件 / 类 | 用法 | 搭配动效 / 转场 |
|---|---|---|
| `data-make="letterdeck"` | 单字扑克牌阵排大标题（`data-text="知识讲解类博主\|要迎来{大洗牌}了"`） | `letter-shuffle@t` |
| `data-make="sleeve3d"` | 立体外盒开口滑出整摞厚牌（`data-no="01"`、`data-title="第一批"`） | `sleeve-draw@t` |
| `data-make="card3d"` | 双面纸叠厚边扑克或拍立得展卡（`data-polaroid="01\|标题\|副标"`、`data-facedown="1"`、`data-progress="1"`） | `flip-3d@t` / `pose-3d@t` / `polaroid-eject@t` |
| `data-make="carousel3d"` | 底部手牌托底 + 台面拍立得连切轮播（内放多张 `<img data-title="…">`） | `carousel-next@t(steps=2)` |
| `data-make="deck3d"` | 桌面厚牌堆与弧道（`data-count="10"`、`data-layout="horseshoe\|arc"`） | `deal-arc@0` / `deck-gather@t` |
| 任意多卡容器 | 多宫格牌阵越级弹起放大 / 3D 卡片螺旋风暴 | `grid-hero@t(i=2)` / `card-storm@0` |
| `data-make="box3d"` | 真六面体立体盒（`data-depth="46"`、`data-color="#2563eb"`、`data-side="BATCH 02"`） | `box-drop@0` / `each:box-drop@0` |
| `data-make="slabs3d"` | 3D 厚石碑多米诺阵列（`data-labels="资本,MCN,流量"`，配 `desk-invert`） | `slab-shatter@t` + `desk-invert@0` |
| `data-make="coins3d"` | 3D 立体筹码 / 金币组（`data-count="5"`、`data-symbol="$"`） | `coin-drop@0` |
| `data-make="layers3d"` | 三维爆炸分层架构台（子元素从底到顶写 `data-label`、`data-sub`、`data-color`） | `layer-explode@0` + `layer-focus@t(i=2)` |
| `data-make="timeline3d"` | 立面面板后仰 56° 变 3D 剪辑时间轴轨道（内放多张视频缩略 `<img>`） | `board-lay@t` |
| `data-make="paperstack"` | 白纸复印叠厚 + 新鲜感衰减进度条（`data-sheets="8"`） | `stack-print@t(to=62)` |
| `data-make="callouts3d"` | 四角取景框锁定 + 多分支水平引线组（`data-items="你本人,面孔,声音"`） | `lock-callouts@t` |
| `data-make="youarehere"` | 「YOU ARE HERE」全片分段路标游标卡 | `pin-move@t(from=0.2,to=0.75)` |
| `data-make="wall3d"` | 白底 3D 倾斜悬浮卡片矩阵（`data-cols="4"`） | `wall-pull@0` |
| `data-make="phone3d"` | 真厚度圆角金属框 3D 竖屏手机（`data-tilt="-16,5,0"`、`data-color="graphite\|silver\|blue"`） | `pose-3d@t` / `rig-focus@t(i=2)` / `phone-split@0` / `phone-wave@0` / `screen-pop@t` / `each:bubble-pop3d@t` |
| `data-make="flap3d"` | 立体机械翻牌计数器（`data-value="1,000+"`） | `flap-to@t(to=10_000+)` |
| `data-make="calgrid3d"` | 30 天日历翻牌打卡矩阵 + 顶部涨粉计数器联动（`data-days="30"`） | `cal-flip@t(to=18862)` |
| `data-make="ctabar"` | 白底高浮起交互胶囊（`data-kind="send\|follow"`） | `cta-click@t` |
| 转场 `data-in="card-wipe"` | **3D 巨卡贴脸擦镜转场**（世界画布与普通模式通用，大章节切换用） | 写在后一个 `<section class="scene" data-in="card-wipe">` |

粒子和 3D 只当某一个分镜的主视觉用（比如开场），不要当全片的背景装饰。当主视觉用时给那个容器加 `data-lint="content"`，否则 `check.mjs` 会把全屏画布当成背景、报「画面是空的」。

## 10. 常见问题

| 现象 | 原因和改法 |
|---|---|
| `check.mjs` 报「没有这个动效」 | 名字写错了，按它提示的相近名字改；提示里没有合适的就去 motion-lib `README.md` 查 |
| `check.mjs` 报「到位时画面是空的」 | 主素材写了晚出现的入场动效。删掉入场动效，改成 `wake@同样的时间` |
| `check.mjs` 报「字太小」 | 把那段字放大到 32px 以上；放不下就删字或拆分镜 |
| `check.mjs` 报「页面没有跑起来」 | 脚本报错了：浏览器打开 `index.html?play` 看控制台 |
| 某个动效没动 | 触发秒数超过了分镜的 `data-d`，或者写在了错的元素上（`pick` 要写在 `data-make="fan"` 的元素上，其他组件同理） |
| 图片组挤成一团 | 图没写宽高。`fan` `tunnel` `helix` 里的每张图都要写死 `width` / `height` |
| 成片底部少一截、字幕没了 | 没走 `lib/chrome-tall.sh`；用 `render.mjs` 渲染会自动带上 |
| 3D 黑屏 | 脚本加载顺序不对（见第 9 节） |
