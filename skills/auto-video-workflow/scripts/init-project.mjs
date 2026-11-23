#!/usr/bin/env node
// 新建一条视频的工程目录，并把 motion-lib 的运行时同步到工程的 lib/
// 用法: node init-project.mjs <slug 或目录> [--topic "主题"] [--root videos] [--motion-lib <motion-lib 目录>] [--stage | --oner]
//   --oner   index.html 用舞台剧「一镜到底」拍法的骨架（一栋楼 + 不剪的长镜头，见 references/stage-play.md 第 3.5 节）
//   --stage  index.html 用舞台剧片型的骨架（见 references/stage-play.md）；工程里已有带时间的 project.json 时，会按分镜预填好 data-d 和每句台词的时间
//   <slug>   只含字母数字和连字符时，工程建在 <root>/<slug>/（root 默认是当前目录下的 videos/）；传路径则直接用该目录
// 已有工程再跑一次 = 只把 lib/ 更新到最新版，不动 project.json、script.md 和 index.html。
//
// motion-lib 按这个顺序找：--motion-lib → 环境变量 MOTION_LIB_DIR → profile.json 的 motion_lib →
//   仓库里/仓库旁/当前目录里/当前目录旁的 motion-lib/ → ~/motion-lib
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, die, loadProfile, configDir, REPO_ROOT } from "./lib.mjs";

const { opts, rest } = parseArgs(process.argv.slice(2), ["topic", "root", "motion-lib"]);      // 另有开关 --stage：生成舞台剧片型的骨架（主持人 + 场景 + 画中画）
if (!rest[0]) die('用法: init-project.mjs <slug 或目录> [--topic "主题"] [--root videos] [--motion-lib 目录]');
const isSlug = /^[a-z0-9][a-z0-9-]*$/i.test(rest[0]);
const dir = path.resolve(isSlug ? path.join(opts.root || "videos", rest[0]) : rest[0]);
const slug = path.basename(dir);

const isMotionLib = (d) => d && fs.existsSync(path.join(d, "fx.js")) && fs.existsSync(path.join(d, "fx.css"));
const candidates = [
  opts["motion-lib"], process.env.MOTION_LIB_DIR, loadProfile().motion_lib,
  path.join(REPO_ROOT, "motion-lib"), path.join(REPO_ROOT, "..", "motion-lib"),
  path.join(process.cwd(), "motion-lib"), path.join(process.cwd(), "..", "motion-lib"),
  path.join(os.homedir(), "motion-lib"),
].filter(Boolean).map((d) => path.resolve(String(d).replace(/^~(?=[/\\]|$)/, os.homedir())));
const motionLib = candidates.find(isMotionLib);
if (!motionLib) die("没有找到 motion-lib。先 git clone https://github.com/honestTai/motion-lib，再用 --motion-lib <目录> 或环境变量 MOTION_LIB_DIR 指给我。找过的位置：\n  " + candidates.join("\n  "));

fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
for (const item of ["fx.js", "fx-world.js", "fx-puppet.js", "fx-stage.js", "fx-oner.js", "fx-ink.js", "fx-chat.js", "fx-diagram.js", "fx-shape.js", "fx-desk3d.js", "fx-sound.js", "sfx.mjs", "fx-particles.js", "fx-3d.js", "fx-rig.js", "fx-vrm.js", "fx.css", "chrome-tall.sh", "fonts", "vendor", "assets"]) {
  const src = path.join(motionLib, item);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(dir, "lib", item), { recursive: true, force: true });
}
const camSmoothSrc = path.join(path.dirname(fileURLToPath(import.meta.url)), "cam-smooth.js");
if (fs.existsSync(camSmoothSrc)) fs.copyFileSync(camSmoothSrc, path.join(dir, "lib", "cam-smooth.js"));

const ipCastRaw = loadProfile().ip_cast_dir;
const ipCastCandidates = [
  ipCastRaw && path.resolve(String(ipCastRaw).replace(/^~(?=[/\\]|$)/, os.homedir())),
  path.join(configDir(), "ip-cast"),
].filter(Boolean);
const ipCastDir = ipCastCandidates.find((d) => fs.existsSync(d));
const created = [];
const writeNew = (name, content) => { const f = path.join(dir, name); if (!fs.existsSync(f)) { fs.writeFileSync(f, content); created.push(name); } };

writeNew("project.json", JSON.stringify({
  slug,
  topic: opts.topic || "",
  theme: "theme-studio",
  meta: { pace: 1.1 },
  voices: {},
  publish: { title: "", desc: "", tags: [], cover: { lead: "", title: "", tag: "" } },
  scenes: [
    { id: "S01", say: "开头三到五秒直接抛结果，{重点词}用花括号标出来。" },
  ],
}, null, 2) + "\n");

writeNew("beats.js", "// bgm.mjs pick / mix 会重写这个文件：BGM 在成片里的拍点（秒）\nwindow.FX_BEATS = null;\n");
writeNew("script.md", `# ${opts.topic || slug}

## 资料与出处

- （搜集到的事实、数据、链接，逐条写清出处）

## 口播稿

（定稿后的完整口播，按分镜分段；和 project.json 的 scenes 保持一致）

## 发布信息

- 标题（20 字以内）：
- 简介：
- 标签：
- 封面：引导小字 / 主标题 / 印章
`);

const WORLD = (total) => `  <!-- 世界：一栋楼。每个 backdrop 是一个房间（4–6 个，每章一个），data-cell="列,层" 决定它在楼里的位置：
       同层相邻 = 镜头横移穿墙，上下层 = 镜头升降穿楼板。按讲述顺序摆成一条走得通的路线（比如上层 1 2 3、下层 5 4）。
       下面三个是程序画的占位场景：换成这一期生成的背景图（data-src="assets/stage/xxx.jpg"），并填上氛围属性 -->
  <section class="scene overlay" data-t="0" data-d="${total}">
    <div data-make="house">
      <div data-make="backdrop" data-cell="0,0" data-kind="night" data-focus="tilt" data-grade="plain" data-weather="dust"></div>
      <div data-make="backdrop" data-cell="1,0" data-kind="room" data-focus="tilt" data-grade="warm" data-weather="rays dust"></div>
      <div data-make="backdrop" data-cell="1,1" data-kind="city" data-focus="tilt" data-grade="dusk" data-weather="fireflies"></div>
    </div>
  </section>

`;
if (opts.stage || opts.oner) {
  const oner = Boolean(opts.oner);
  const pj = path.join(dir, "project.json");
  const project = fs.existsSync(pj) ? JSON.parse(fs.readFileSync(pj, "utf8")) : {};
  const timed = (project.scenes || []).filter((s) => typeof s.duration === "number");
  const cast = Boolean(ipCastDir);           // 本机配置里有账号自己的角色素材包
  const total = timed.length ? (project.duration || timed.reduce((n, s) => n + s.duration, 0)) : 4;
  const sections = (timed.length ? timed : [{ id: "S01", duration: 4, say: "" }]).map((s, k) => {
    const lines = (s.lines || []).map((l) => `       ${(l.start - (s.start || 0)).toFixed(2).padStart(5)}  ${l.text}`).join("\n");
    const fx = cast ? "" : `call@0(who=host) pup-talk@0.1(who=host,dur=${Math.max(0.5, s.duration - 0.2).toFixed(2)})`;
    return `  <!-- ${s.id} · ${s.speaker || "host"} 说 · ${s.duration}s${lines ? "\n" + lines : ""} -->\n  <section class="scene${oner ? " clear" : ""}" data-scene="${s.id}" data-d="${s.duration}"${oner && k < 2 ? ` data-room="${k ? 1 : "all"}"` : ""} data-fx="${fx}">\n  </section>\n`;
  }).join("\n");
  writeNew("index.html", `<!doctype html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=1920, height=1080" />
<title>${slug}</title>
<link rel="stylesheet" href="lib/fx.css" />${cast ? '\n<link rel="stylesheet" href="assets/ip-cast.css" />' : ""}
<script src="lib/vendor/gsap.min.js"></script>
<script src="lib/fx.js"></script>
<script src="lib/fx-world.js"></script>     <!-- 只用它的 wake / push-back / zoom-here；不写 data-world 就不会启用世界画布 -->
<script src="lib/fx-puppet.js"></script>    <!-- 主持人 -->
<script src="lib/fx-stage.js"></script>     <!-- 场景、画中画、小演员 -->
${oner ? '<script src="lib/fx-oner.js"></script>      <!-- 一镜到底：一栋楼 + 不剪的长镜头（要放在 fx-sound.js 前面） -->\n' : ""}<script src="lib/fx-sound.js"></script>     <!-- 音效层：每个动效自带声音，跑 sfx.mjs 生成音效轨 -->
<script src="timing.js"></script>
<script src="beats.js"></script>      <!-- bgm.mjs pick 量出的拍点（卡点用）；没有 BGM 时是空的 -->${cast ? '\n<script src="assets/ip-cast-rig.js"></script>' : ""}
<style>
  /* 这条片子自己的样式写这里。字号下限 32px；内容放在画面右边 2/3（x ≥ 640），左下角是主持人 */
</style>
</head>
<body>
${oner ? "<!-- 一镜到底拍法：分镜写成 scene clear、只放道具；data-room 说这一镜在哪个房间（不写 = 还在上一个房间，all = 楼外全景），换房间时镜头自己走。\n     不写 data-in，不用 closeup / cutaway：特写换成 cam@秒(x=±200,z=1.14,blur=3) 朝说话的人推，插画换成 push-into 推进照片里。详见 references/stage-play.md 第 3.5 节 -->\n" : ""}<!-- 舞台剧片型：分镜之间硬切；换场景背景时在后一个分镜上写 data-in="mosaic"。写法、零件、分镜表见 references/stage-play.md，样板见 references/recipes-stage/index.html。
     每个分镜上面的注释是这个分镜的台词和每句的开始秒数（相对分镜开头）：@秒数 直接照着写 -->
<div id="root" class="theme-pixel" data-composition-id="main" data-width="1920" data-height="1080" data-fps="60" data-mode="stage"${oner ? ' data-sound="cinema"' : ""}>

${oner ? WORLD(total) : ""}${sections}
  <!-- 常驻层：进度线（data-n = 章节数；segment 的时间是全片的绝对秒数）+ 主持人 -->
  <section class="scene overlay" data-t="0" data-d="${total}">
${oner ? '    <div data-make="letterbox" data-h="96"></div>        <!-- 电影画幅的上下黑边；分镜里的字不要进黑边 -->\n' : ""}    <div class="abs" style="left:60px;right:60px;top:30px" data-make="segments" data-n="4" data-fx="segment@0(i=1)"></div>
    ${cast ? '<div id="ip-stage"></div>' : '<div data-make="actor" data-name="host" data-src="lib/assets/puppet/bot" data-poses="wave/point/think/cheer" data-eyes="238,236,64,76,#7fe7ff/362,236,64,76,#7fe7ff" data-neck="300,400" data-home="-10,0,640"></div>'}
  </section>

</div>
<script>
${cast ? "  window.AVW_SCENE_META = {};          // 每个分镜的补充编排（with / mode / emotes…），写法见本机的 strategy.md\n  setupIPCast({ mode: 'bust' });       // 设字幕、编排角色并构建时间线" : "  FX.mouthTrack = AVW_TIMING.mouth;    // 用配音的真实口型\n  FX.subtitles(AVW_TIMING.subtitles, { style: 'studio' });\n  FX.build();"}
</script>
</body>
</html>
`);
}

writeNew("index.html", `<!doctype html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=1920, height=1080" />
<title>${slug}</title>
<link rel="stylesheet" href="lib/fx.css" />
<script src="lib/vendor/gsap.min.js"></script>
<script src="lib/fx.js"></script>
<script src="lib/fx-world.js"></script>
<script src="lib/fx-sound.js"></script>
<script src="lib/fx-puppet.js"></script>
<!-- 按需加载：粒子 lib/fx-particles.js；真 3D 依次加 lib/vendor/three-fx.min.js（放在 fx.js 前）和 lib/fx-3d.js -->
<script src="timing.js"></script>
<script src="beats.js"></script>      <!-- bgm.mjs pick 量出的拍点（卡点用）；没有 BGM 时是空的 -->
<style>
  /* 这条片子自己的样式写这里。字号下限 32px；一条片子只用一个强调色（改 --fx-accent） */
  #root { --fx-accent: #f5a524; }
</style>
</head>
<body>
<!-- data-world：所有分镜摆在同一块画布上，换分镜 = 镜头走过去。data-wall 是背景字墙（写账号名或主题词） -->
<div id="root" class="theme-studio" data-composition-id="main" data-width="1920" data-height="1080" data-fps="60"
     data-world="snake" data-cols="4" data-wall="${slug.toUpperCase().slice(0, 12)}">

  <!-- 一个分镜一个 section，顺序和 project.json 的 scenes 一一对应；data-d 填 tts.mjs 打印的真实秒数。
       不用写 data-in：换分镜默认就是镜头斜着推过去。分镜的写法照抄 references/scene-recipes.md -->
  <section class="scene center" data-scene="S01" data-d="4">
    <h1 class="t-title">这里写<span class="accent">大标题</span></h1>
    <p class="t-body muted" style="margin-top:28px" data-fx="wake@1.2">这里写一句话副标题</p>
  </section>

  <!-- 常驻层：进度线（data-n = 章节数）。segment 的时间写全片的绝对秒数 -->
  <section class="scene overlay" data-t="0" data-d="4">
    <div class="abs" style="left:96px;right:96px;top:44px" data-make="segments" data-n="4" data-fx="segment@0(i=1)"></div>
  </section>

</div>
<script>
  // 字幕来自配音的逐字时间戳（timing.js 由 tts.mjs 生成）
  FX.subtitles(AVW_TIMING.subtitles, { style: 'studio' });
  FX.build();
</script>
</body>
</html>
`);

for (const sub of ["audio", "assets", "assets/shots", "renders", "cover"]) fs.mkdirSync(path.join(dir, sub), { recursive: true });
if (ipCastDir) {
  for (const item of ["chars", "ip-cast-rig.js", "ip-cast.css"]) {
    const src = path.join(ipCastDir, item);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(dir, "assets", item), { recursive: true });
  }
}
console.log(`✓ 工程 ${path.relative(process.cwd(), dir) || "."}`);
console.log(`  motion-lib: ${motionLib} → lib/（fx.js、fx.css、字体、vendor、chrome-tall.sh）`);
console.log(created.length ? `  新建：${created.join("、")}` : "  已有工程：只更新了 lib/");
console.log("  接着：写 script.md 和 project.json 的 scenes → tts.mjs → 写 index.html → check.mjs → snap.mjs → bgm.mjs pick → sfx.mjs → bgm.mjs mix → render.mjs");
