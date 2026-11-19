#!/usr/bin/env node
// 每个分镜截一帧（默认取分镜 82% 处，元素基本都已入场），拼成一张总览图供肉眼检查
// 用法: node snap.mjs <工程目录> [--at 0.82] [--only S03,S07]
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { parseArgs, die, readProject, hyperframesEnv } from "./lib.mjs";

const { opts, rest } = parseArgs(process.argv.slice(2), ["at", "only"]);
const dir = path.resolve(rest[0] || ".");
const project = readProject(dir);
if (!fs.existsSync(path.join(dir, "index.html"))) die("没有 index.html：先写分镜页面");
const frac = parseFloat(opts.at || "0.82");
const only = opts.only?.split(",").map((s) => s.trim());
const scenes = (project.scenes || []).filter((s) => typeof s.start === "number" && (!only || only.includes(s.id)));
if (!scenes.length) die("没有带时间的分镜：先跑 tts.mjs");
const times = scenes.map((s) => (s.start + (s.end - s.start) * frac).toFixed(2));

const out = path.join(dir, "snapshots");
fs.rmSync(out, { recursive: true, force: true });
const r = spawnSync("npx", ["--yes", "hyperframes", "snapshot", "--at", times.join(","), "--no-end", "--output", "snapshots"], { cwd: dir, env: hyperframesEnv(dir), shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
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

const cols = Math.min(4, frames.length), rows = Math.ceil(frames.length / cols);
const list = path.join(out, "_frames.txt");
fs.writeFileSync(list, frames.map((f) => `file '${path.join(out, f).replace(/\\/g, "/").replace(/'/g, "'\\''")}'\nduration 1`).join("\n") + "\n");
const sheet = path.join(out, "sheet.jpg");
execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-vf", `scale=640:-2,tile=${cols}x${rows}`, "-frames:v", "1", "-q:v", "3", sheet]);
fs.rmSync(list);
console.log(`✓ ${frames.length} 帧 → ${path.relative(process.cwd(), sheet)}（每行 ${cols} 帧，按分镜顺序）`);
scenes.forEach((s, i) => console.log(`  ${String(i + 1).padStart(2)}. ${s.id} @${times[i]}s  ${frames[i] || "(缺帧)"}`));
console.log("必须打开 sheet.jpg 逐帧看：文字有没有溢出或重叠、元素是否已入场、底部字幕有没有压住主内容、有没有空白或黑屏帧。");
console.log("看不清就直接打开 snapshots/ 里的单帧原图。发现问题改 index.html 后重跑本脚本。");
