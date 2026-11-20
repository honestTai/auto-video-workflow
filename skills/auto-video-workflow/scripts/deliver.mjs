#!/usr/bin/env node
// 把一条视频的成品交付到「交付目录/<视频名>/」，方便同步到云盘、给同事看：
//   1-video.mp4   成片（renders/<slug>.mp4）
//   2-cover.png   3:4 竖版封面（cover/cover-3x4.png）；有横版的再加 2-cover-16x9.jpg
//   3-copy.md     文案：标题、简介、话题、封面文字、口播全文、资料出处、发布链接
// 同时刷新交付目录下的 index.md（所有视频一览）。
//
// 用法: node deliver.mjs <工程> [--out <交付目录>] [--name <文件夹名>]
//   交付目录按这个顺序找：--out → 环境变量 AVW_DELIVER_DIR → profile.json 的 deliver_dir（相对路径按仓库根目录算）→ 仓库旁边的 ve/
//   文件夹名默认是工程的 slug。同一条视频再跑一次会覆盖旧文件：重新渲染、换了封面、发布后补了链接，都再跑一次。
//   发布链接写在 project.json 的 publish.links 里，例如 { "抖音": "https://…", "YouTube": "https://…" }。
//   角色名：project.json 的 cast（例如 { "host": "主持人名" }）→ profile.json 的 cast_names → 角色代号本身。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseArgs, die, readProject, loadProfile, REPO_ROOT } from "./lib.mjs";

const { opts, rest } = parseArgs(process.argv.slice(2), ["out", "name"]);
if (!rest[0]) die("用法: node deliver.mjs <工程> [--out <交付目录>] [--name <文件夹名>]");
const dir = path.resolve(rest[0]);
const project = readProject(dir);
const profile = loadProfile();
const slug = project.slug || path.basename(dir);

const outRoot = path.resolve(REPO_ROOT, opts.out || process.env.AVW_DELIVER_DIR || profile.deliver_dir || path.join("..", "ve"));
const name = opts.name || slug;
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) die(`文件夹名只用英文字母、数字、点、连字符：${name}`);
const out = path.join(outRoot, name);

// ── 成片 ──
const renders = path.join(dir, "renders");
let video = path.join(renders, slug + ".mp4");
if (!fs.existsSync(video) && fs.existsSync(renders)) {
  const mp4 = fs.readdirSync(renders).filter((f) => f.endsWith(".mp4")).map((f) => path.join(renders, f));
  mp4.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  video = mp4[0];
}
if (!video || !fs.existsSync(video)) die(`没有成片：先跑 render.mjs（找的是 ${path.join(renders, slug + ".mp4")}）`);

// ── 封面 ──
const coverDir = path.join(dir, "cover");
const pick = (...names) => names.map((n) => path.join(coverDir, n)).find((f) => fs.existsSync(f));
const cover = pick("cover-3x4.png", "cover-3x4.jpg");
const coverWide = pick("cover-16x9.jpg", "cover-16x9.png");

fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(video, path.join(out, "1-video.mp4"));
for (const f of fs.readdirSync(out)) if (/^2-cover/.test(f)) fs.rmSync(path.join(out, f));
if (cover) fs.copyFileSync(cover, path.join(out, "2-cover" + path.extname(cover)));
if (coverWide) fs.copyFileSync(coverWide, path.join(out, "2-cover-16x9" + path.extname(coverWide)));

// ── 文案 ──
let info = "";
try {
  const s = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", video]).toString());
  const v = s.streams.find((x) => x.codec_type === "video");
  info = `${Math.round(+s.format.duration)} 秒，${v.width}×${v.height}`;
} catch { /* 没有 ffprobe 就不写时长 */ }

const pub = project.publish || {};
const castNames = { ...(profile.cast_names || {}), ...(project.cast || {}) };
const who = (k) => castNames[k] || k;
const clean = (t) => String(t || "").replace(/[{}]/g, "");
const links = pub.links ? (Array.isArray(pub.links) ? pub.links.map((u, i) => [`链接 ${i + 1}`, u]) : Object.entries(pub.links)) : [];

const lines = [];
lines.push(`# ${pub.title || project.topic || slug}`, "");
lines.push(`- 视频：\`1-video.mp4\`${info ? `（${info}）` : ""}`);
lines.push(`- 封面：${cover ? "`2-cover" + path.extname(cover) + "`" + (coverWide ? "，横版 `2-cover-16x9" + path.extname(coverWide) + "`" : "") : "还没有（先做封面再跑一次 deliver.mjs）"}`);
lines.push(`- 发布：${links.length ? links.map(([k, u]) => `[${k}](${u})`).join(" · ") : "未发布"}`);
let projRel = path.relative(path.dirname(REPO_ROOT), dir);          // 例如 auto-video-workflow/videos/<slug>
if (projRel.startsWith("..") || path.isAbsolute(projRel)) projRel = dir;
lines.push(`- 工程：\`${projRel.split(path.sep).join("/")}\``);
const now = new Date(), pad = (n) => String(n).padStart(2, "0");
lines.push(`- 交付时间：${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`, "");
lines.push("## 标题", "", pub.title || "（未填写）", "");
lines.push("## 简介", "", pub.desc || "（未填写）", "");
lines.push("## 话题", "", (pub.tags || []).map((t) => "#" + t).join(" ") || "（未填写）", "");
if (pub.cover) {
  lines.push("## 封面文字", "");
  if (pub.cover.lead) lines.push(`- 引导小字：${pub.cover.lead}`);
  if (pub.cover.title) lines.push(`- 主标题：${pub.cover.title}`);
  if (pub.cover.tag) lines.push(`- 印章：${pub.cover.tag}`);
  lines.push("");
}
const scenes = project.scenes || [];
if (scenes.length) {
  const multi = scenes.some((s) => s.speaker && s.speaker !== "host");
  lines.push("## 口播全文", "");
  for (const s of scenes) lines.push(`${s.id ? `**${s.id}**` : ""}${multi ? ` ${who(s.speaker || "host")}` : ""}${s.id || multi ? "：" : ""}${clean(s.say)}`, "");
}
// 资料出处：script.md 里标题含「出处」或「资料」的那一节
const scriptFile = path.join(dir, "script.md");
if (fs.existsSync(scriptFile)) {
  const md = fs.readFileSync(scriptFile, "utf8").split(/\r?\n/);
  const at = md.findIndex((l) => /^##\s/.test(l) && /出处|资料/.test(l));
  if (at >= 0) {
    let end = md.findIndex((l, i) => i > at && /^##\s/.test(l));
    if (end < 0) end = md.length;
    const body = md.slice(at + 1, end).join("\n").trim();
    if (body) lines.push("## 资料与出处", "", body, "");
  }
}
fs.writeFileSync(path.join(out, "3-copy.md"), lines.join("\n").replace(/\n{3,}/g, "\n\n"));

// ── 一览表 ──
const rows = [];
for (const d of fs.readdirSync(outRoot).sort()) {
  const f = path.join(outRoot, d, "3-copy.md");
  if (!fs.existsSync(f)) continue;
  const t = fs.readFileSync(f, "utf8");
  const title = (t.match(/^# (.+)$/m) || [])[1] || d;
  const len = (t.match(/^- 视频：`1-video\.mp4`（(\d+) 秒/m) || [])[1];
  const pubLine = (t.match(/^- 发布：(.+)$/m) || [])[1] || "未发布";
  const when = (t.match(/^- 交付时间：(.+)$/m) || [])[1] || "";
  rows.push(`| [${d}](${d}/3-copy.md) | ${title.replace(/\|/g, "\\|")} | ${len ? len + " 秒" : ""} | ${pubLine} | ${when} |`);
}
fs.writeFileSync(path.join(outRoot, "index.md"), [
  "# 视频交付一览",
  "",
  "每条视频一个文件夹：`1-video.mp4` 成片、`2-cover.png` 封面、`3-copy.md` 文案（标题、简介、话题、口播全文、出处、发布链接）。",
  "这个文件由 `deliver.mjs` 自动生成，不要手改。",
  "",
  "| 文件夹 | 标题 | 时长 | 发布 | 交付时间 |",
  "|---|---|---|---|---|",
  ...rows,
  "",
].join("\n"));

console.log(`✓ 已交付到 ${out}`);
for (const f of fs.readdirSync(out).sort()) console.log(`  ${f}  ${(fs.statSync(path.join(out, f)).size / 1048576).toFixed(1)} MB`);
if (!cover) console.log("! 没有封面 cover/cover-3x4.png：做完封面再跑一次");
console.log(`  一览表：${path.join(outRoot, "index.md")}`);
