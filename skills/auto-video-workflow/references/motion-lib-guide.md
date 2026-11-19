# motion-lib 速查手册

[motion-lib](https://github.com/honestTai/motion-lib) 是「HTML → 视频」的声明式动效库：在普通 DOM 元素上写
`data-fx="动效名@秒数"`，由 HyperFrames 逐帧渲染成 1080p 60fps 的 MP4。
这里只列写一条口播视频最常用的部分；**完整的 153 种动效、20 种转场和参数表在 motion-lib 的 `README.md`「动效目录」一节，
用到不熟的动效先去那里查名字和参数，不要凭印象编动效名**（写错的名字不会报错，只是不动）。
工程里的 `lib/` 是 motion-lib 运行时的拷贝，`examples/` 下每套皮肤都有一条完整示例的源码可以参考。

## 1. 选皮肤

在 `#root` 上写一个主题类，整片换肤。按主题调性自己定，不用问用户：

| 内容调性 | 皮肤 | 视觉 | 字幕样式 | 可搭配 |
|---|---|---|---|---|
| AI 工具、产品演示、评测、效率工作流 | `theme-violet` | 白紫科技，亮白/深灰底，电光紫强调 | `pill` | `fx-3d.js` 点缀、界面窗口、图表 |
| 极客科普、轻松口播、游戏感 | `theme-pixel` | 像素复古，米色网点纸，荧光绿/红/黄 | `bar` | 2D/3D 角色主持人、`pixels` 拼字 |
| 深度观点、商业财经、硬核解读、榜单 | `theme-gold` | 黑金电影感，深蓝黑底 + 暗角，流金强调 | `plain` | `fx-particles.js`、`fx-3d.js` |
| 清单科普、人文故事、生活向 | `theme-paper` | 剪纸拼贴，宣纸肌理，朱砂红/石青 | `paper` | `papercut` `hills` `torn` |
| 宇宙、算力、宏大叙事、发布会片头 | `theme-space` | 深空粒子，深蓝渐变，星云青/恒星橙 | `plain` | `fx-particles.js`、`fx-3d.js` |

一条片子只用一套皮肤。单个分镜可以用 `class="scene dark"` / `"scene light"` 切深浅底。

## 2. 页面骨架

`init-project.mjs` 生成的 `index.html` 已经是这个骨架，在里面加分镜即可：

```html
<link rel="stylesheet" href="lib/fx.css" />
<script src="lib/vendor/gsap.min.js"></script>
<script src="lib/fx.js"></script>
<script src="lib/cam-smooth.js"></script>         <!-- 顺滑无限画布摇镜与单镜聚焦镜头 -->
<script src="timing.js"></script>              <!-- tts.mjs 生成：字幕数组 + 分镜时间 -->
...
<div id="root" class="theme-violet" data-composition-id="main" data-width="1920" data-height="1080" data-fps="60">
  <section class="scene dark center" data-scene="S01" data-d="6.42"> … </section>
  <section class="scene light" data-scene="S02" data-d="7.15" data-in="blur-cross(dur=0.5)"> … </section>
</div>
<script>
  FX.subtitles(AVW_TIMING.subtitles, { style: 'pill' });
  FX.build();
</script>
```

可选模块按这个顺序加载（用到才加）：

```html
<script src="lib/vendor/gsap.min.js"></script>
<script src="lib/vendor/three-fx.min.js"></script>     <!-- 真 3D 需要 -->
<script src="lib/vendor/three-vrm.min.js"></script>    <!-- VRM 角色需要 -->
<script src="lib/fx.js"></script>
<script src="lib/fx-particles.js"></script>            <!-- Canvas 2D 粒子 -->
<script src="lib/fx-3d.js"></script>                   <!-- WebGL 3D 场景 -->
<script src="lib/fx-rig.js"></script>                  <!-- 2D 软骨骼角色 -->
<script src="lib/fx-vrm.js"></script>                  <!-- 3D VRM 角色 -->
```

## 3. 和配音对齐（最重要）

- **一个分镜一个 `<section class="scene">`**，顺序和 `project.json` 的 `scenes` 一一对应，写上 `data-scene="S01"`。
- **`data-d` 必须等于 `tts.mjs` 打印的真实秒数**（精确到 0.01）。`render.mjs` 会逐个核对，对不上直接报错。
- 字幕不要手抄：`FX.subtitles(AVW_TIMING.subtitles, …)` 直接用 `timing.js` 里按逐字时间戳生成的数组；
  口播文本里用 `{花括号}` 标的重点词会自动染成主题强调色。
- 元素上的 `@秒数` 是**相对所在分镜开头**的偏移。想让某个元素在念到某句话时出现：
  用 `project.json` 里该分镜 `lines[i].start` 减去分镜的 `start`。
- 改了口播文本 → 重跑 `tts.mjs` → 按新打印的秒数更新 `data-d`。
- 常驻元素（章节条、主持人、角标）放在叠加层：`<section class="scene overlay" data-t="0" data-d="全片秒数">`，
  叠加层不占顺序时长，`render.mjs` 核对时也会跳过它。

## 4. `data-fx` 语法

`data-fx="[目标:]名字@时间(参数)"`，同一个元素可以串多个，用空格分隔：

```html
<h1 data-fx="blur-rise-in@0.2 pulse@1.5 fade-out@-0.3">标题</h1>
<b  data-fx="count@0.6 marker@1.6">7,000</b>
<ul data-fx="each:pop-in@1(stagger=0.1)"><li>芯片</li><li>算力</li><li>大模型</li></ul>
```

| 组成 | 写法 | 含义 |
|---|---|---|
| 时间 | `@1.2` | 分镜开始后 1.2 秒 |
| | `@+0.3` | 比同一元素上的前一个动效晚 0.3 秒 |
| | `@-0.4` | 分镜结束前 0.4 秒（退场用） |
| 目标 | 省略 | 元素自己 |
| | `each:` | 每个直接子元素，自动错峰 |
| | `chars:` `words:` `lines:` | 拆成单字 / 单词 / 行逐个动 |
| 参数 | `dur=0.8` `ease=spring` `stagger=0.1` `order=center` | 时长、缓动、错峰间隔、错峰顺序 |

缓动别名：`out`（默认）`soft` `snap` `sharp` `inout` `in` `spring` `bounce` `elastic` `drop` `linear` `pixel`。

## 5. 常用动效

| 用途 | 动效 |
|---|---|
| 标题入场 | `mask-rise` `blur-rise-in` `zoom-settle` `focus-in` `type` `scramble` |
| 卡片 / 图片入场 | `rise-in` `scale-in` `pop-in` `tilt-in` `flip-in` `wipe-in` `fan-in`（配 `each:`） |
| 结论 / 印章 | `stamp-in` `drop-bounce` |
| 图表生长 | `grow-y`（柱）`grow-x`（条）`draw`（线）`ring` `count`（数字滚动）`fill` |
| 念到时强调 | `pulse` `marker` `underline` `box` `glow` `shake` `spotlight` `callout` |
| 关系 / 流程 | `circuit`（两元素间的电路连线）`step` `chapter` `check` `toggle` |
| 镜头 | `cam-focus` `cam-breathe` `push` `pan` `zoom-to` `zoom-reset` `cam-shake` `drift` `parallax` |
| 退场 | `fade-out` `rise-out` `blur-out` `scale-out` `scatter-out` |
| 转场（写在 `data-in`） | **首选顺滑系列**：`cam-pan`（无限画布无缝摇镜，接镜主元素直接 `@0` 常驻随镜头滑入、次要强调元素再按口播延时弹出，做到 0 空屏衔接）`cam-push`（柔和纵深推镜）`cam-cut`（8 帧动作微溶）`blur-cross`；慎用 `shatter` `halftone` `blinds` `crt-off` 等全屏遮罩转场，避免割裂空间或遮挡顶部进度条 |

组件生成器（`data-make`）：`bars` `line` `ring` `wave` `steps` `chapters` `switches` `pixels` `wall` `dust`
`circle-text` `retro-grid` `papercut` `hills` `torn` `space`（2D 粒子画布）`stage3d`（3D 舞台）。

```html
<div class="abs" style="left:200px;top:300px;width:1200px;height:400px"
     data-make="bars" data-values="3,8,21,40,26,12" data-labels="1月,2月,3月,4月,5月,6月" data-hi="4"
     data-fx="each:grow-y@0.3(stagger=0.05)"></div>

<div class="fx-chapters" data-make="chapters" data-labels="问题,原因,解法,总结"
     data-fx="chapter@0(i=1,dur=0.01) chapter@12.4(i=2) chapter@31.0(i=3) chapter@52.6(i=4)"></div>
```

排版类名：文字 `t-hero` `t-title` `t-h2` `t-h3` `t-body` `t-small` `t-num` `t-mono` `accent` `muted`；
布局 `layer`（整屏层）`abs` `center` `row` `col`；容器 `card` `shot` `glass` `stat` `qcard`；
标签 `pill` `note` `tag`；组件 `fx-window`（窗口）`fx-chat` `fx-check` `fx-hbar` `pbar`。

## 6. 角色与 3D（可选）

- **3D 口播主持人**（`fx-vrm.js`）：把透明的 `stage3d`（`data-alpha="1" data-light="anime"`）放在叠加层，
  `vrm3d@0(src=shino)` 载入内置 CC0 模型（`shino` / `vita`），`vrm-pose@t(pose=explain,expr=happy)` 换姿态，
  `vrm-talk@t(dur=秒数)` 对口型。口型时间直接用 `timing.js` 里每个分镜的 `talk: [开始, 结束]`。
  姿态：`idle` `wave` `explain` `point` `point-up` `think` `shock` `clasp` `reject` `shrug` `proud` `cheer` `bow`。
- **双人对话**：两个角色各占画面一侧；分镜的 `speaker` 决定这一句谁开口，另一位切倾听姿态。
- **3D 场景**（`fx-3d.js`）：`<div class="layer" data-make="stage3d" data-bloom="0.8" data-fx="stars3d@0 galaxy3d@0 orbit3d@0(turn=120,r=13,h=5,dur=6)">`。
  一条视频里 `stage3d` 不超过 7 个。
- **2D 粒子**（`fx-particles.js`）：`<div class="layer" data-make="space" data-fx="nebula@0 starfield@0(speed=0.15)">`。

## 7. 布局安全区（1920×1080）

| 区域 | 范围 | 规则 |
|---|---|---|
| 字幕带 | 底部约 y 900–1060 | **主内容不要低于 y=880**；图表、卡片、角色的脚都要留在这条线以上或被字幕压住也无妨的位置 |
| 章节条 | 顶部约 y 0–80 | 用了 `chapters` 时，标题从 y≥110 开始 |
| 左右边距 | 各 ≥ 96px | 大标题不要贴边 |
| 主持人 | 一般左下或右下约 600×800 | 这一侧不放正文，正文偏向另一侧 |

- **一屏只讲一件事（手机竖屏看横屏片铁律）**：`1920×1080` 横版画面在抖音竖屏信息流里会被缩到手机宽度（约缩小 5 倍），**严禁把页面写成多卡片小字 PPT**：
  - 单屏可见文字不超过 **12–18 个字**，文字超过 3 行立刻拆分镜；禁止塞 4 宫格说明段落或长串英文伪代码。
  - **字号硬底线**：主标题 **≥ 72px**，卡片/模块标题 **≥ 46px**，正文与标签 **≥ 36px**，全片**严禁出现 `< 30px` 的文字**；底部字幕建议 **34–38px** 加粗实底。
  - **高对比配色**：B-roll 讲解镜头优先用纯深色黑板底（如 `#101218`）配亮白/明黄/荧光绿/珊瑚红实心高反差色块，避免浅米底配浅灰小字糊成一片。
  - **角色别全程霸占角落**：有角色出镜时，交替切分「双人/多人放大半身对手戏互动镜」「情境故事演绎镜」与「无角色遮挡的全屏大字 B-roll 讲解镜」，切忌全程把小人钉死在底部左右角外加一堆名牌气泡挤占画布。
  - **真实波形对口型**：2D 多帧嘴型角色直接读取 `AVW_TIMING.mouth`（`tts.mjs` 按真实人声 RMS 能量生成的 20fps `0/1/2` 序列），保证停顿闭嘴、重音张嘴，严禁用伪随机定时器空嚼。
- 用 `class="abs"` 加明确的 `left/top/width/height` 定位，避免元素互相挤压。
- 每个分镜至少有一个入场动效，且在分镜前 60% 的时间内全部入场完毕（`snap.mjs` 在 82% 处截图）。

## 8. 确定性铁律

渲染器是「跳到第 N 帧截图」，下面三条违反了就会出现静止、闪烁或每次渲染不一样：

1. 不用 CSS `animation` / `transition`。
2. 不用 `setTimeout` / `setInterval` / `requestAnimationFrame`。
3. 随机一律用 `FX.rand(seed)`，不用 `Math.random()`。

库里没有的动效：`FX.register('名字', '分类', '说明', c => { c.tl.from(c.els, {…}, c.t); })`，
或在 `FX.build({ extra(tl, at) { … } })` 里直接操作主时间线。

## 9. 常见问题

| 现象 | 原因 |
|---|---|
| 成片底部少一截、字幕没了 | 没走 `lib/chrome-tall.sh`；用 `render.mjs` 渲染会自动带上 |
| 某个动效没动 | 动效名拼错，或触发秒数超过了分镜的 `data-d` |
| 渐变文字配 `chars:` / `type` 后消失 | `background-clip: text` 拆字后失效，逐字动画的标题改用纯色 |
| 3D 或 VRM 黑屏 | 脚本加载顺序不对（见第 2 节），或动效没挂在 `data-make="stage3d"` 的元素上 |
| 截图是空白 | 截图时刻元素还没入场：把入场时间提前 |
