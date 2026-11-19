#!/usr/bin/env node
// 渲染 1080p 60fps 画面 → 合上配音/混音 → 核对成片
// 用法: node render.mjs <工程目录> [--name 文件名] [--quality draft|looks|delivery] [--fps 60] [--grain 0]
//   --grain 胶片颗粒强度（0 不加；写实 / 电影感皮肤用 2–4；像素风、矢量风保持 0）。颗粒在合成时用 ffmpeg 加，不在页面里画（页面里画会拖慢渲染、撑大文件）。
// 输出: renders/<名字>.mp4（名字默认取 project.json 的 slug）
import fs from "node:fs";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { parseArgs, die, readProject, writeProject, hyperframesEnv, HYPERFRAMES } from "./lib.mjs";

const { opts, rest } = parseArgs(process.argv.slice(2), ["name", "quality", "fps", "grain"]);
const dir = path.resolve(rest[0] || ".");
const project = readProject(dir);
const name = opts.name || project.slug || path.basename(dir);
const quality = opts.quality || "looks", fps = opts.fps || "60";
const grain = Math.max(0, Math.min(12, parseFloat(opts.grain ?? project.meta?.grain ?? 0) || 0));
const page = path.join(dir, "index.html");
if (!fs.existsSync(page)) die("没有 index.html：先写分镜页面");
if (typeof project.duration !== "number") die("分镜还没有时间：先跑 tts.mjs");

// 分镜时长必须和配音对上：逐个核对 index.html 里非叠加层分镜的 data-d
const html = fs.readFileSync(page, "utf8");
const sections = [...html.matchAll(/<section\b[^>]*class="([^"]*\bscene\b[^"]*)"[^>]*>/g)].filter((m) => !/\boverlay\b/.test(m[1])).map((m) => parseFloat((m[0].match(/data-d="([\d.]+)"/) || [])[1]));
const expected = project.scenes.map((s) => s.duration);
if (sections.length !== expected.length) die(`index.html 里有 ${sections.length} 个分镜，project.json 里有 ${expected.length} 个：两边要一一对应`);
const off = expected.map((d, i) => [project.scenes[i].id, d, sections[i]]).filter(([, d, got]) => !(Math.abs(got - d) <= 0.02));
if (off.length) die("分镜时长和配音对不上，把 data-d 改成配音的真实秒数：\n" + off.map(([id, d, got]) => `  ${id}: data-d="${got}" 应为 "${d}"`).join("\n"));

const audio = [project.audio?.mix, project.audio?.voice].map((f) => f && path.join(dir, f)).find((f) => f && fs.existsSync(f));
if (!audio) die("没有音轨：先跑 tts.mjs（和 bgm.mjs mix）");

fs.mkdirSync(path.join(dir, "renders"), { recursive: true });
const silent = path.join("renders", `.${name}.silent.mp4`), file = path.join(dir, "renders", `${name}.mp4`);
const t0 = Date.now();
// 快速截帧模式在这类页面上自检不通过，会白跑一遍再回退；直接关掉
const r = spawnSync("npx", ["--yes", HYPERFRAMES, "render", "-o", silent, "-q", quality, "--fps", fps, "--experimental-fast-capture=false"], { cwd: dir, env: hyperframesEnv(dir), shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
let log = String(r.stdout) + String(r.stderr);
const fail = (msg) => { fs.writeFileSync(path.join(dir, "render.log"), log); die(`${msg}，日志见 ${path.join(dir, "render.log")}`); };
if (r.status !== 0 || !fs.existsSync(path.join(dir, silent))) fail(`渲染失败（exit ${r.status}）`);

const probe = (f) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height,duration,r_frame_rate", "-of", "json", f]).toString()).streams;
const picture = probe(path.join(dir, silent)).find((s) => s.codec_type === "video");
// 音轨补静音到画面长度，再按画面长度截断：音画一样长
const m = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", path.join(dir, silent), "-i", audio, "-map", "0:v", "-map", "1:a", ...(grain ? ["-vf", `noise=c0s=${grain}:allf=t`, "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p"] : ["-c:v", "copy"]), "-af", "apad", "-c:a", "aac", "-b:a", "192k", "-t", String(picture.duration), "-movflags", "+faststart", file]);
log += "\n--- 合成音轨 ---\n" + String(m.stderr);
fs.rmSync(path.join(dir, silent), { force: true });
if (m.status !== 0 || !fs.existsSync(file)) fail("合成音轨失败");
fs.writeFileSync(path.join(dir, "render.log"), log);

// 成片质检
const streams = probe(file), v = streams.find((s) => s.codec_type === "video"), a = streams.find((s) => s.codec_type === "audio");
const [num, den] = String(v.r_frame_rate).split("/").map(Number), rate = num / (den || 1);
const problems = [];
if (v.width !== 1920 || v.height !== 1080) problems.push(`分辨率是 ${v.width}×${v.height}，不是 1920×1080`);
if (Math.abs(rate - parseFloat(fps)) > 0.5) problems.push(`帧率是 ${rate.toFixed(2)}，不是 ${fps}`);
if (!a) problems.push("成片没有音轨");
if (Math.abs(+v.duration - project.duration) > 1) problems.push(`成片时长 ${(+v.duration).toFixed(1)}s 与配音时间轴 ${project.duration.toFixed(1)}s 不一致`);
project.render = { file: path.relative(dir, file), width: v.width, height: v.height, fps: Math.round(rate), duration: Math.round(+v.duration * 100) / 100, audio: path.relative(dir, audio) };
writeProject(dir, project);
console.log(`${problems.length ? "!" : "✓"} ${path.relative(process.cwd(), file)}  ${v.width}×${v.height}  ${rate.toFixed(0)}fps  ${(+v.duration).toFixed(1)}s  ${(fs.statSync(file).size / 1e6).toFixed(1)}MB  音轨 ${path.basename(audio)}  用时 ${Math.round((Date.now() - t0) / 1000)}s`);
if (problems.length) { for (const p of problems) console.error("✗ " + p); process.exit(1); }
