#!/usr/bin/env node
// 给网页截一张图，存进工程的 assets/shots/，当片子里的真素材用（官网、公告、榜单、文档、仓库页……）
// 用法: node shot.mjs <工程目录> <网址> [--name 文件名] [--width 1600] [--height 1000] [--wait 6000]
//   --name    不带扩展名，默认按域名起名；重名会覆盖
//   --height  想截长一点（往下多截一屏）就调大，比如 2000
// 截出来的图在 index.html 里这样用：<div class="abs shot" style="left:…;top:…;width:…;height:…"><img src="assets/shots/名字.png"></div>
import fs from "node:fs";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { parseArgs, die, findChrome } from "./lib.mjs";

const { opts, rest } = parseArgs(process.argv.slice(2), ["name", "width", "height", "wait"]);
const dir = path.resolve(rest[0] || "."), url = rest[1];
if (!url || !/^https?:\/\//.test(url)) die("用法: shot.mjs <工程目录> <https://网址> [--name 文件名] [--width 1600] [--height 1000]");
const chrome = findChrome();
if (!chrome) die("没找到本机 Chrome，截不了图。手动截图后放进 <工程>/assets/shots/ 也可以");
const name = (opts.name || new URL(url).hostname.replace(/^www\./, "").replace(/[^a-z0-9]+/gi, "-")).replace(/\.png$/i, "");
const out = path.join(dir, "assets", "shots");
fs.mkdirSync(out, { recursive: true });
const file = path.join(out, name + ".png"), w = opts.width || "1600", h = opts.height || "1000";
fs.rmSync(file, { force: true });
const r = spawnSync(chrome, ["--headless=new", "--hide-scrollbars", "--force-device-scale-factor=1", `--window-size=${w},${h}`, `--virtual-time-budget=${opts.wait || "6000"}`, "--lang=zh-CN", `--screenshot=${file}`, url], { encoding: "utf8", timeout: 90000 });
if (!fs.existsSync(file)) die("截图失败：" + String(r.stderr || "").split("\n").filter((l) => /ERR_|error/i.test(l)).slice(0, 2).join(" ") + "\n  这个网址可能要登录或拦了无头浏览器：换一个公开页面，或手动截图放进 assets/shots/");
// 整张图几乎一个颜色 = 截到了空白页或拦截页
let flat = false;
try {
  const st = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-vf", "scale=64:40,format=gray", "-f", "rawvideo", "-"], { maxBuffer: 1 << 20 });
  let min = 255, max = 0; for (const v of st) { if (v < min) min = v; if (v > max) max = v; }
  flat = max - min < 12;
} catch { /* 没有 ffmpeg 就不查 */ }
console.log(`${flat ? "!" : "✓"} ${path.relative(process.cwd(), file)}  ${w}×${h}  ${(fs.statSync(file).size / 1024).toFixed(0)}KB`);
if (flat) console.log("  这张图几乎是纯色的，多半截到了空白页、加载中或验证页：打开看一眼，不行就换个网址或加大 --wait");
else console.log("  打开看一眼确认截到的是想要的内容（有没有弹窗、登录墙挡住），再写进 index.html");
