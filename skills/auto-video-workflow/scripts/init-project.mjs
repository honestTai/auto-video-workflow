#!/usr/bin/env node
// 新建一条视频的工程目录，并把 motion-lib 的运行时同步到工程的 lib/
// 用法: node init-project.mjs <slug 或目录> [--topic "主题"] [--root videos] [--motion-lib <motion-lib 目录>]
//   <slug>   只含字母数字和连字符时，工程建在 <root>/<slug>/（root 默认是当前目录下的 videos/）；传路径则直接用该目录
// 已有工程再跑一次 = 只把 lib/ 更新到最新版，不动 project.json、script.md 和 index.html。
//
// motion-lib 按这个顺序找：--motion-lib → 环境变量 MOTION_LIB_DIR → profile.json 的 motion_lib →
//   仓库里/仓库旁/当前目录里/当前目录旁的 motion-lib/ → ~/motion-lib
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs, die, loadProfile, REPO_ROOT } from "./lib.mjs";

const { opts, rest } = parseArgs(process.argv.slice(2), ["topic", "root", "motion-lib"]);
if (!rest[0]) die('用法: init-project.mjs <slug 或目录> [--topic "主题"] [--root videos] [--motion-lib 目录]');
const isSlug = /^[a-z0-9][a-z0-9-]*$/i.test(rest[0]);
const dir = path.resolve(isSlug ? path.join(opts.root || "videos", rest[0]) : rest[0]);
const slug = path.basename(dir);

const isMotionLib = (d) => d && fs.existsSync(path.join(d, "new-project.sh")) && fs.existsSync(path.join(d, "fx.js"));
const candidates = [
  opts["motion-lib"], process.env.MOTION_LIB_DIR, loadProfile().motion_lib,
  path.join(REPO_ROOT, "motion-lib"), path.join(REPO_ROOT, "..", "motion-lib"),
  path.join(process.cwd(), "motion-lib"), path.join(process.cwd(), "..", "motion-lib"),
  path.join(os.homedir(), "motion-lib"),
].filter(Boolean).map((d) => path.resolve(String(d).replace(/^~(?=\/|$)/, os.homedir())));
const motionLib = candidates.find(isMotionLib);
if (!motionLib) die("没有找到 motion-lib。先 git clone https://github.com/honestTai/motion-lib，再用 --motion-lib <目录> 或环境变量 MOTION_LIB_DIR 指给我。找过的位置：\n  " + candidates.join("\n  "));

fs.mkdirSync(dir, { recursive: true });
const sync = spawnSync("bash", [path.join(motionLib, "new-project.sh"), dir], { stdio: ["ignore", "pipe", "pipe"] });
if (sync.status !== 0) die("同步 motion-lib 失败：" + String(sync.stderr).trim().split("\n").slice(-3).join(" "));

const created = [];
const writeNew = (name, content) => { const f = path.join(dir, name); if (!fs.existsSync(f)) { fs.writeFileSync(f, content); created.push(name); } };

writeNew("project.json", JSON.stringify({
  slug,
  topic: opts.topic || "",
  theme: "theme-violet",
  meta: { pace: 1.1 },
  voices: {},
  publish: { title: "", desc: "", tags: [], cover: { lead: "", title: "", tag: "" } },
  scenes: [
    { id: "S01", say: "开头三到五秒直接抛结果，{重点词}用花括号标出来。" },
  ],
}, null, 2) + "\n");

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

writeNew("index.html", `<!doctype html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=1920, height=1080" />
<title>${slug}</title>
<link rel="stylesheet" href="lib/fx.css" />
<script src="lib/vendor/gsap.min.js"></script>
<script src="lib/fx.js"></script>
<!-- 按需加载：粒子 lib/fx-particles.js；真 3D 依次加 lib/vendor/three-fx.min.js（放在 fx.js 前）和 lib/fx-3d.js -->
<script src="timing.js"></script>
</head>
<body>
<div id="root" class="theme-violet" data-composition-id="main" data-width="1920" data-height="1080" data-fps="60">

  <!-- 一个分镜一个 section，顺序和 project.json 的 scenes 一一对应；data-d 填 tts.mjs 打印的真实秒数 -->
  <section class="scene dark center" data-scene="S01" data-d="4">
    <h1 class="t-title" data-fx="mask-rise@0.2">这里写<span class="accent">大标题</span></h1>
    <p class="t-body" data-fx="rise-in@0.7">这里写一句话副标题</p>
  </section>

</div>
<script>
  // 字幕来自配音的逐字时间戳（timing.js 由 tts.mjs 生成）
  FX.subtitles(AVW_TIMING.subtitles, { style: 'pill' });
  FX.build();
</script>
</body>
</html>
`);

for (const sub of ["audio", "assets", "renders", "cover"]) fs.mkdirSync(path.join(dir, sub), { recursive: true });
console.log(`✓ 工程 ${path.relative(process.cwd(), dir) || "."}`);
console.log(`  motion-lib: ${motionLib} → lib/（fx.js、fx.css、字体、vendor、chrome-tall.sh）`);
console.log(created.length ? `  新建：${created.join("、")}` : "  已有工程：只更新了 lib/");
console.log("  接着：写 script.md 和 project.json 的 scenes → tts.mjs → 写 index.html → snap.mjs → bgm.mjs mix → render.mjs");
