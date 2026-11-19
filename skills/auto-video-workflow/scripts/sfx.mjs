#!/usr/bin/env node
// 音效轨：画面上每个动效（弹出、落下、划入、转场、特写、表情…）按触发时间自动配一个音效 → audio/sfx.wav
// 用法: node sfx.mjs <工程目录> [--palette soft|pixel|cinema|paper] [--gain 1]
//   音色默认跟皮肤走（theme-pixel → pixel 8-bit 音色）；--gain 是整体音量倍数。
//   跑完再跑 bgm.mjs mix，音效轨会和配音、垫乐混在一起。画面改过触发时间后要重跑本脚本。
//   个别动效想换声音或不出声：在 index.html 里给它加参数 sfx=ding / sfx=none（声音名见 motion-lib 的 README「声音」一节）。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs, die, readProject, writeProject } from "./lib.mjs";

const { opts, rest } = parseArgs(process.argv.slice(2), ["palette", "gain"]);
const dir = path.resolve(rest[0] || ".");
const project = readProject(dir);
const page = path.join(dir, "index.html"), tool = path.join(dir, "lib", "sfx.mjs");
if (!fs.existsSync(page)) die("没有 index.html：先写分镜页面");
if (!fs.existsSync(tool) || !fs.existsSync(path.join(dir, "lib", "fx-sound.js"))) die("工程的 lib/ 里没有音效模块（fx-sound.js / sfx.mjs）：重跑 init-project.mjs <工程> 把 lib/ 更新到新版");
if (!/lib\/fx-sound\.js/.test(fs.readFileSync(page, "utf8"))) die('index.html 还没有加载音效模块：在 <script src="lib/fx.js"> 之后（其他 fx-*.js 旁边）加一行 <script src="lib/fx-sound.js"></script>');

const r = spawnSync(process.execPath, [tool, dir, "--out", "audio/sfx.wav", "--json", ...(opts.palette ? ["--palette", opts.palette] : []), ...(opts.gain ? ["--gain", opts.gain] : [])], { encoding: "utf8" });
if (r.status !== 0) die((r.stderr || r.stdout || "").trim().replace(/^✗ /, "") || "生成音效轨失败");
const info = JSON.parse(r.stdout.trim().split("\n").pop());
if (!info.file) { console.log(info.palette === "off" ? "· 这条片子关掉了音效（根元素 data-sound=\"off\"），没有生成音效轨" : "! 页面里没有会出声的动效，没有生成音效轨"); process.exit(0); }
project.audio = { ...project.audio, sfx: "audio/sfx.wav" };
project.meta = { ...project.meta, sfx: { ...project.meta?.sfx, palette: info.palette, cues: info.cues } };
writeProject(dir, project);
console.log(`✓ audio/sfx.wav  ${info.total.toFixed(1)}s  音色 ${info.palette}  共 ${info.cues} 个音效（每分钟 ${info.perMinute} 个）  峰值 ${info.peakDb} dB`);
console.log("  " + Object.entries(info.kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join("  "));
if (info.perMinute > 90) console.log("! 音效偏密（每分钟超过 90 个）：给次要的动效加 sfx=none，只让重点动作出声");
if (info.perMinute < 12) console.log("! 音效很少（每分钟不到 12 个）：画面上的动作是不是也太少了？");
if (info.longestGap > 8) console.log(`! ${info.gapAt}s 起有 ${info.longestGap} 秒没有任何音效：这一段画面上有没有动作？`);
console.log("  下一步：node bgm.mjs mix <工程>（把音效轨和配音、垫乐混在一起）");
