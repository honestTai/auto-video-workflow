#!/usr/bin/env node
// 机器自检：能用程序查出来的问题，一次列清楚。写完 index.html 先跑它，全部通过再截图、渲染。
// 用法: node check.mjs <工程目录> [--json] [--no-browser]
//
// 查两类问题：
//   静态（读 index.html）：动效名 / 转场名 / 组件名写错、触发时间超出分镜、转场种类太多、
//                          用了会让渲染不确定的写法（CSS 动画、定时器、Math.random）、分镜数量和时长对不上配音
//   实测（用本机 Chrome 打开页面，逐个分镜跳到「到位帧」和「后段帧」量真实排版）：
//                          字太小、到位时空屏、画面太空、文字出画、文字互相压住、被字幕压住、真素材太少
// 有「✗」就是必须改的；「!」是建议改的。退出码：有 ✗ 为 1，否则 0。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseArgs, die, findChrome } from "./lib.mjs";

const { opts, rest } = parseArgs(process.argv.slice(2), []);
const dir = path.resolve(rest[0] || ".");
const page = path.join(dir, "index.html");
if (!fs.existsSync(page)) die("没有 index.html：先写分镜页面");
const html = fs.readFileSync(page, "utf8");
const errors = [], warns = [];
const err = (where, msg) => errors.push({ where, msg });
const warn = (where, msg) => warns.push({ where, msg });

/* ───────────── 1. 库里到底有哪些名字 ───────────── */
function loadCatalog() {
  const win = { gsap: {} };
  const fake = () => ({ getContext: () => new Proxy({}, { get: () => () => ({ data: [0, 0, 0, 0], addColorStop() {} }) }), width: 0, height: 0 });
  const lib = path.join(dir, "lib");
  if (!fs.existsSync(path.join(lib, "fx.js"))) die("工程里没有 lib/fx.js：先跑 init-project.mjs 把 motion-lib 同步进来");
  new Function("window", fs.readFileSync(path.join(lib, "fx.js"), "utf8"))(win);
  const owner = new Map(), names = () => [...Object.keys(win.FX.fx), ...Object.keys(win.FX.trans).map((k) => "in:" + k), ...Object.keys(win.FX.make).map((k) => "make:" + k)];
  let seen = new Set(names());
  for (const f of ["fx-particles.js", "fx-3d.js", "fx-rig.js", "fx-vrm.js", "fx-world.js", "fx-puppet.js", "fx-stage.js", "fx-oner.js", "fx-ink.js", "fx-chat.js", "fx-diagram.js", "fx-shape.js", "fx-desk3d.js", "fx-sound.js", "cam-smooth.js"]) {
    const file = path.join(lib, f);
    if (!fs.existsSync(file)) continue;
    try { new Function("window", "document", fs.readFileSync(file, "utf8"))(win, { createElement: fake, getElementById: () => null, head: { appendChild() {} } }); } catch { /* 需要完整浏览器环境的模块跳过，下面按源码里的注册语句补名字 */ }
    for (const n of names()) if (!seen.has(n)) { seen.add(n); owner.set(n, f); }      // 这个名字是哪个模块提供的
  }
  const FX = win.FX, fx = new Set(Object.keys(FX.fx)), trans = new Set(Object.keys(FX.trans)), make = new Set(Object.keys(FX.make));
  // 工程自己注册的（页面内联脚本、assets/ 和 lib/ 下的脚本）
  const sources = [html];
  for (const sub of ["assets", "lib"]) {
    const d = path.join(dir, sub);
    if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) if (f.endsWith(".js") && !f.includes(".min.")) sources.push(fs.readFileSync(path.join(d, f), "utf8"));
  }
  for (const src of sources) {
    for (const m of src.matchAll(/FX\.register\(\s*['"]([\w-]+)['"]/g)) fx.add(m[1]);
    for (const m of src.matchAll(/FX\.fx\[['"]([\w-]+)['"]\]\s*=/g)) fx.add(m[1]);
    for (const m of src.matchAll(/(?:FX\.trans\[|registerTrans\(\s*)['"]([\w-]+)['"]/g)) trans.add(m[1]);
    for (const m of src.matchAll(/FX\.make(?:\.([\w]+)|\[['"]([\w-]+)['"]\])\s*=/g)) make.add(m[1] || m[2]);
  }
  return { fx, trans, make, owner };
}
const cat = loadCatalog();
const dist = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
const suggest = (name, set) => { const near = [...set].map((n) => [dist(name, n), n]).sort((a, b) => a[0] - b[0]).filter(([d]) => d <= Math.max(2, name.length / 2)).slice(0, 3).map(([, n]) => n); return near.length ? `，是不是想写 ${near.join(" / ")}` : ""; };

/* ───────────── 2. 静态检查 ───────────── */
const tokens = (str) => { const out = []; let depth = 0, cur = ""; for (const ch of str.trim()) { if (ch === "(") depth++; if (ch === ")") depth--; if (/\s/.test(ch) && depth === 0) { if (cur) out.push(cur); cur = ""; } else cur += ch; } if (cur) out.push(cur); return out; };
const parseToken = (t) => { const m = t.match(/^(?:(each|chars|words|lines):)?([a-zA-Z0-9-]+)(?:@([+-]?[\d.]+))?(\(.*\))?$/); return m ? { mod: m[1], name: m[2], time: m[3], raw: t } : { raw: t }; };

const world = /<[^>]*data-composition-id[^>]*\bdata-world\b/.test(html);
const stageMode = /<[^>]*data-composition-id[^>]*\bdata-mode="stage"/.test(html);       // 舞台剧语法：场景硬切 + 主持人常驻
const loaded = new Set([...html.matchAll(/<script[^>]*src="[^"]*?([\w.-]+\.js)"/g)].map((m) => m[1]));
const needModule = (where, key, label) => { const f = cat.owner.get(key); if (f && !loaded.has(f)) err(where, `${label} 在 lib/${f} 里，但页面没有加载它：在 <script src="lib/fx.js"> 后面加一行 <script src="lib/${f}"></script>`); };
const blocks = html.split(/(?=<section\b)/).filter((b) => b.startsWith("<section"));
const seqBlocks = [], kinds = new Map(), fulls = [];      // fulls：全屏镜头（插画 / 特写）的起止时间，全片绝对秒数
let clock = 0;
blocks.forEach((b, i) => {
  const open = b.match(/^<section\b[^>]*>/)[0], cls = (open.match(/class="([^"]*)"/) || [])[1] || "";
  if (!/\bscene\b/.test(cls)) return;
  const overlay = /\boverlay\b/.test(cls), id = (open.match(/data-scene="([^"]+)"/) || open.match(/\bid="([^"]+)"/) || [])[1] || `第 ${i + 1} 个 section`;
  const d = parseFloat((open.match(/data-d="([\d.]+)"/) || [])[1]);
  if (!overlay) seqBlocks.push({ id, d });
  if (!(d > 0)) err(id, "没有写 data-d（分镜时长）");
  const tin = (open.match(/data-in="([^"]*)"/) || [])[1];
  if (tin && !overlay) {
    const t = parseToken(tin.trim());
    if (!t.name || !cat.trans.has(t.name)) err(id, `没有这个转场：${tin}${t.name ? suggest(t.name, cat.trans) : ""}`);
    else { needModule(id, "in:" + t.name, `转场 ${t.name}`); kinds.set(t.name, (kinds.get(t.name) || 0) + 1); if (world && !["cam-to", "cam-jump", "card-wipe"].includes(t.name)) err(id, `世界画布（data-world）里换分镜只能用 cam-to、cam-jump 或 card-wipe，这里写的是 ${t.name}：删掉 data-in 即可（默认就是 cam-to）`); }
  }
  const events = [0];      // 这个分镜里所有视觉事件的时间，用来查「多久没有变化」
  for (const m of b.matchAll(/data-fx="([^"]*)"/g)) { let last = 0; for (const tk of tokens(m[1])) {
    const t = parseToken(tk);
    if (!t.name) { err(id, `data-fx 写法看不懂：${tk}（正确写法是 名字@秒数(参数=值)，参数之间用逗号、不能有空格）`); continue; }
    if (!cat.fx.has(t.name)) { err(id, `没有这个动效：${t.name}${suggest(t.name, cat.fx)}（写错的名字不会报错，只是不动）`); continue; }
    needModule(id, t.name, `动效 ${t.name}`);
    if (t.time && !/^[+-]/.test(t.time) && d > 0 && parseFloat(t.time) > d + 0.01) err(id, `${tk} 的触发时间 ${t.time}s 超过了这个分镜的时长 ${d}s，不会生效`);
    last = !t.time ? 0 : t.time[0] === "+" ? last + parseFloat(t.time) : t.time[0] === "-" ? d + parseFloat(t.time) : parseFloat(t.time);
    if (!["pup-talk", "talk", "lipsync", "rig-talk", "vrm-talk", "frames", "pup-idle", "sfx"].includes(t.name)) events.push(last);
    if (!overlay && (t.name === "cutaway" || t.name === "closeup")) {
      const fd = parseFloat((tk.match(/dur=([\d.]+)/) || [])[1] || (t.name === "cutaway" ? "1.8" : "1.1"));
      fulls.push({ id, name: t.name, a: clock + last, b: clock + last + fd, end: clock + d });
      events.push(last + fd);
    }     // 说话、播序列帧是持续的，不算一次变化
    if (t.name === "fly") { const n = parseInt((tk.match(/\bto=(\d+)/) || [])[1] || "6", 10), each = parseFloat((tk.match(/each=([\d.]+)/) || [])[1] || "0.7"); for (let k = 1; k < n; k++) events.push(last + k * each); }
    if (t.name === "helix-spin" || t.name === "marquee" || t.name === "parallax" || t.name === "wall-pull" || t.name === "card-storm") for (let x = last + 1; x < d; x += 1) events.push(x);     // 一直在动的
    if (t.name === "skeleton" || t.name === "drop-gather" || t.name === "layer-explode" || t.name === "deal-arc" || t.name === "cal-flip" || t.name === "stack-print" || t.name === "slab-shatter" || t.name === "board-lay") events.push(last + 0.7, last + 1.4, last + 2.0);
    const multi = tk.match(/\bi=([\d/]+)[,)]/), every = parseFloat((tk.match(/every=([\d.]+)/) || [])[1] || "0.28");
    if (multi && multi[1].includes("/")) multi[1].split("/").forEach((_, k) => events.push(last + k * every));
  } }
  for (const m of b.matchAll(/data-make="([^"]*)"/g)) { if (!cat.make.has(m[1])) err(id, `没有这个组件：data-make="${m[1]}"${suggest(m[1], cat.make)}`); else needModule(id, "make:" + m[1], `组件 ${m[1]}`); }
  if (!overlay && d > 0) clock += d;
  if (!overlay && d > 0) {
    const ev = [...new Set(events.filter((x) => x >= 0 && x <= d))].sort((x, y) => x - y).concat(d);
    let gap = 0, at = 0;
    for (let k = 1; k < ev.length; k++) if (ev[k] - ev[k - 1] > gap) { gap = ev[k] - ev[k - 1]; at = ev[k - 1]; }
    const tip = stageMode ? "换一次主持人姿势（pup-pose）、让小演员动一下、弹一个面板，或切一张插画（cutaway）" : "加一次强调（wake / zoom-here / cam-look / pulse）或换一个画面元素";
    if (gap > 5.5) err(id, `${at.toFixed(1)}–${(at + gap).toFixed(1)} 秒，连续 ${gap.toFixed(1)} 秒画面没有任何变化：${tip}`);
    else if (gap > 3.5) warn(id, `${at.toFixed(1)}–${(at + gap).toFixed(1)} 秒，有 ${gap.toFixed(1)} 秒画面没有变化（建议不超过 3 秒）：${tip}`);
  }
});
if (!seqBlocks.length) err("页面", "一个分镜都没有：每个分镜写成 <section class=\"scene\" data-scene=\"S01\" data-d=\"秒数\">");

// 全屏镜头（插画 / 特写）结束后只露出零点几秒原画面就又切走，观众看到的是「闪了一下」
fulls.sort((x, y) => x.a - y.a);
fulls.forEach((f, i) => {
  const left = f.end - f.b, next = fulls[i + 1];
  if (left > 0.06 && left < 0.5) err(f.id, `${f.name} 结束后离分镜结束只剩 ${left.toFixed(2)} 秒，画面会闪一下：把它的 dur 加长到分镜结束，或提前到至少留 0.5 秒`);
  else if (next && next.a - f.b > 0.06 && next.a - f.b < 0.5) err(f.id, `${f.name} 结束后 ${(next.a - f.b).toFixed(2)} 秒又切到下一个全屏镜头，中间会闪一下：两个镜头接上，或隔开至少 0.5 秒`);
});
if (stageMode) {
  const extra = [...kinds.keys()].filter((k) => !["cut", "mosaic", "fade"].includes(k));
  if (extra.length) err("页面", `舞台剧模式（data-mode="stage"）里换分镜只用硬切（不写 data-in）和 mosaic（换场景背景时），这里还用了 ${extra.join("、")}`);
} else if (!world) {
  warn("页面", "根元素没有写 data-world：现在是「一幕一页」的翻页结构，容易像 PPT。建议改成世界画布（见 references/motion-lib-guide.md 第 1 节）");
  if (kinds.size > 2) err("页面", `转场用了 ${kinds.size} 种（${[...kinds.keys()].join("、")}）：一条片子最多 2 种，否则像转场大全`);
  const flashy = ["shatter", "halftone", "blinds", "crt-off", "portal-spin", "diagonal-split", "pixelate", "iris", "glitch-cut"].filter((k) => kinds.has(k));
  if (flashy.length) warn("页面", `用了遮罩式转场 ${flashy.join("、")}：会盖住画面和字幕，全片最多留 1 处用在最大的转折上`);
}
const bodyNoComment = html.replace(/<!--[\s\S]*?-->/g, "");
[[/\bsetTimeout\s*\(|\bsetInterval\s*\(|\brequestAnimationFrame\s*\(/, "用了定时器 / requestAnimationFrame：渲染是逐帧跳着截图的，定时器不会按预期执行。改用 data-fx 或 FX.build({ extra }) 里的时间线"],
 [/\bMath\.random\s*\(/, "用了 Math.random()：每次渲染结果都不一样。改用 FX.rand(种子)"],
 [/@keyframes\b|[\s;{"]animation\s*:|[\s;{"]transition\s*:/, "用了 CSS animation / transition / @keyframes：渲染时不会动或会闪。改用 data-fx"],
].forEach(([re, msg]) => { const m = bodyNoComment.match(re); if (m) err("页面", `${msg}（出现在「${bodyNoComment.slice(Math.max(0, m.index - 30), m.index + 40).replace(/\s+/g, " ").trim()}」附近）`); });

const pj = path.join(dir, "project.json");
if (fs.existsSync(pj)) {
  const project = JSON.parse(fs.readFileSync(pj, "utf8")), scenes = project.scenes || [];
  if (scenes.length && scenes.every((s) => typeof s.duration === "number")) {
    if (scenes.length !== seqBlocks.length) err("页面", `index.html 里有 ${seqBlocks.length} 个分镜，project.json 里有 ${scenes.length} 个：两边要一一对应`);
    else scenes.forEach((s, i) => { if (!(Math.abs(seqBlocks[i].d - s.duration) <= 0.02)) err(s.id, `data-d="${seqBlocks[i].d}" 应为 "${s.duration}"（配音的真实秒数）`); });
  }
}

/* ───────────── 3. 实测：用 Chrome 打开页面量真实排版 ───────────── */
let report = null;
if (!opts["no-browser"]) {
  const chrome = findChrome();
  if (!chrome) warn("环境", "没找到本机 Chrome，跳过了实测检查（字号、空屏、出画这些只能靠 snap.mjs 的截图肉眼看）");
  else {
    // 3D 页面需要 WebGL：先用软件渲染的 WebGL 跑，跑不起来再退回纯 CPU 模式
    const open = (gl) => spawnSync(chrome, ["--headless=new", gl, "--hide-scrollbars", "--window-size=1920,1400", "--allow-file-access-from-files", "--virtual-time-budget=10000", "--dump-dom", pathToFileURL(page).href + "?lint"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 120000 });
    const find = (res) => String(res.stdout || "").match(/<script id="fx-lint"[^>]*>([\s\S]*?)<\/script>/);
    let r = open("--enable-unsafe-swiftshader"), m = find(r);
    if (!m) { r = open("--disable-gpu"); m = find(r); }
    if (!m && !/FX\.lint\s*=/.test(fs.readFileSync(path.join(dir, "lib", "fx.js"), "utf8"))) err("环境", "工程里的 lib/ 是旧版 motion-lib（没有自检功能）：重跑 init-project.mjs <工程> 把 lib/ 更新到最新版");
    else if (!m) err("页面", "页面没有跑起来（脚本报错，或没有调用 FX.build()）。用浏览器打开 index.html?play 看控制台的报错" + (String(r.stderr || "").match(/Uncaught[^\n]*/)?.[0] ? "：" + String(r.stderr).match(/Uncaught[^\n]*/)[0] : ""));
    else {
      report = JSON.parse(m[1]);
      const emoji = [];   // emoji 只汇总成一条提示
      const put = (where, i) => { if (i.type === "emoji") emoji.push((i.msg.match(/「(.+?)」/) || [])[1]); else (i.level === "error" ? err : warn)(where, i.msg); };
      for (const i of report.overlay || []) put("常驻层（章节条、名牌、角标）", i);
      for (const s of report.scenes) for (const i of s.issues) put(s.id, i);
      if (emoji.length) warn("页面", `有 ${emoji.length} 处用了 emoji（如「${emoji.slice(0, 3).join("」「")}」）：不同机器渲染出来不一样，图标尽量换成图片或文字；角色的情绪气泡可以保留`);
      if (!stageMode && report.checked >= 3 && report.assetScenes / report.checked < 1 / 3) warn("页面", `${report.checked} 个分镜里只有 ${report.assetScenes} 个用了真素材（截图 / 图片 / 视频帧）。全是文字卡片的片子没有冲击力，至少每 3 个分镜放 1 张，并且占画面 40% 以上`);
    }
  }
}

/* ───────────── 输出 ───────────── */
if (opts.json) { console.log(JSON.stringify({ ok: !errors.length, world, errors, warnings: warns, report }, null, 2)); process.exit(errors.length ? 1 : 0); }
const group = (list) => { const g = new Map(); for (const x of list) g.set(x.where, [...(g.get(x.where) || []), x.msg]); return g; };
for (const [where, msgs] of group(errors)) { console.log(`✗ ${where}`); for (const m of msgs) console.log(`    ${m}`); }
for (const [where, msgs] of group(warns)) { console.log(`! ${where}`); for (const m of msgs) console.log(`    ${m}`); }
if (report) console.log(`  实测了 ${report.checked} 个分镜${report.world ? "（世界画布）" : ""}：平均到位时铺满 ${Math.round(100 * report.scenes.filter((s) => !s.skipped).reduce((n, s) => n + s.coverAtArrival, 0) / Math.max(1, report.checked))}% 的画面，${report.assetScenes} 个分镜有真素材`);
console.log(errors.length ? `✗ ${errors.length} 个必须改的问题${warns.length ? `，${warns.length} 个建议` : ""}。改完重跑 check.mjs，直到没有 ✗` : `✓ 自检通过${warns.length ? `（${warns.length} 个建议）` : ""}，可以跑 snap.mjs 截图了`);
process.exit(errors.length ? 1 : 0);
