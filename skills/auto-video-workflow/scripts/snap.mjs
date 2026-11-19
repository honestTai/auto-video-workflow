#!/usr/bin/env node
// 先跑机器自检（check.mjs），再给每个分镜截两帧拼成总览图供肉眼检查：
//   到位帧：分镜开始后约 0.8 秒——镜头刚到，这时画面不能是空的
//   后段帧：分镜 82% 处——元素都已入场，检查排版
// 另出一张 phone.jpg：把后段帧缩到手机竖屏刷到横屏视频时的真实大小（约 390px 宽），看不清的字就是太小
// 用法: node snap.mjs <工程目录> [--at 0.82] [--only S03,S07] [--no-check]
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs, die, readProject, hyperframesEnv, HYPERFRAMES } from "./lib.mjs";

const { opts, rest } = parseArgs(process.argv.slice(2), ["at", "only"]);
const dir = path.resolve(rest[0] || ".");
const project = readProject(dir);
if (!fs.existsSync(path.join(dir, "index.html"))) die("没有 index.html：先写分镜页面");
const frac = parseFloat(opts.at || "0.82");
const only = opts.only?.split(",").map((s) => s.trim());
const scenes = (project.scenes || []).filter((s) => typeof s.start === "number" && (!only || only.includes(s.id)));
if (!scenes.length) die("没有带时间的分镜：先跑 tts.mjs");
const arrive = scenes.map((s) => (s.start + Math.min(0.8, (s.end - s.start) * 0.3)).toFixed(2));
const late = scenes.map((s) => (s.start + (s.end - s.start) * frac).toFixed(2));
const times = scenes.flatMap((_, i) => [arrive[i], late[i]]);

// 机器能查的先查：有 ✗ 也继续截图，但要先改掉再看图
if (!opts["no-check"]) {
  const c = spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), "check.mjs"), dir], { stdio: "inherit" });
  console.log(c.status === 0 ? "" : "\n↑ 先把上面的 ✗ 改掉。下面的截图仅供对照。\n");
}

const out = path.join(dir, "snapshots");
fs.rmSync(out, { recursive: true, force: true });
const r = spawnSync("npx", ["--yes", HYPERFRAMES, "snapshot", "--at", times.join(","), "--no-end", "--output", "snapshots"], { cwd: dir, env: hyperframesEnv(dir), shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
// 旧版 HyperFrames 不认 --output，截图在 .hyperframes/artifacts/snapshots/<批次>/ 下：取最新一批拷回 snapshots/
const art = path.join(dir, ".hyperframes", "artifacts", "snapshots");
const pngs = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(".png")) : []);
if (!pngs(out).length && fs.existsSync(art)) {
  const latest = fs.readdirSync(art).map((d) => path.join(art, d)).filter((d) => fs.statSync(d).isDirectory()).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (latest) { fs.mkdirSync(out, { recursive: true }); for (const f of pngs(latest)) fs.copyFileSync(path.join(latest, f), path.join(out, f)); }
}
// 按文件名里的数字排序（帧序号或秒数），和分镜顺序一致
const order = (f) => parseFloat((f.match(/\d+(?:\.\d+)?/g) || ["0"]).join("."));
const frames = pngs(out).sort((a, b) => order(a) - order(b) || a.localeCompare(b));
if (!frames.length) die("截图失败\n" + String(r.stdout).slice(-600) + String(r.stderr).slice(-600));

const tile = (files, name, width, cols) => {
  const rows = Math.ceil(files.length / cols), list = path.join(out, "_frames.txt"), file = path.join(out, name);
  fs.writeFileSync(list, files.map((f) => `file '${path.join(out, f).replace(/\\/g, "/").replace(/'/g, "'\\''")}'\nduration 1`).join("\n") + "\n");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-vf", `scale=${width}:-2,tile=${cols}x${rows}:padding=6:margin=6:color=0x333333`, "-frames:v", "1", "-q:v", "3", file]);
  fs.rmSync(list);
  return file;
};
// sheet.jpg：每行两个分镜，每个分镜左边是到位帧、右边是后段帧
const sheet = tile(frames, "sheet.jpg", 640, 4);
// phone.jpg：只放后段帧，缩到手机上的真实大小
const lateFrames = frames.filter((_, i) => i % 2 === 1);
const phone = tile(lateFrames.length ? lateFrames : frames, "phone.jpg", 390, Math.min(4, Math.max(1, lateFrames.length)));
console.log(`✓ ${frames.length} 帧 → ${path.relative(process.cwd(), sheet)}（每行 2 个分镜；每个分镜左 = 到位帧，右 = 后段帧）`);
console.log(`✓ 手机尺寸预览 → ${path.relative(process.cwd(), phone)}（每格就是手机上看到的大小）`);
scenes.forEach((s, i) => console.log(`  ${String(i + 1).padStart(2)}. ${s.id}  到位 @${arrive[i]}s  后段 @${late[i]}s`));
console.log("必须打开这两张图看：");
console.log("  sheet.jpg  左边的到位帧不能是空的或只有一行标题；右边的后段帧里文字没有溢出、重叠，字幕没有压住主内容，没有空白或黑屏");
console.log("  phone.jpg  不放大的情况下，每一格的主文字都要能一眼读出来；读不出来就删字、放大");
console.log("发现问题改 index.html 后重跑本脚本。单帧原图在 snapshots/ 里。");
