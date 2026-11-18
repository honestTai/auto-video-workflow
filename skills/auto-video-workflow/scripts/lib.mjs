// 各脚本共用的小工具：配置目录、工程读写、字幕切句与逐字时间戳对齐、BPM 估算
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 仓库根目录（skills/auto-video-workflow/scripts 往上三级）；skill 被单独拷走时这个目录可能不是仓库 */
export const REPO_ROOT = path.resolve(HERE, "..", "..", "..");

/** 本机配置目录：豆包语音密钥 volc.env、BGM 曲库 bgm/、可选的 profile.json 和 strategy.md */
export const configDir = () => process.env.AUTO_VIDEO_CONFIG_DIR || path.join(os.homedir(), ".config", "auto-video-workflow");

/** 简单的命令行解析：--key value、--flag，其余是位置参数 */
export function parseArgs(argv, valueFlags = []) {
  const opts = {}, rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { rest.push(a); continue; }
    const key = a.slice(2);
    if (valueFlags.includes(key)) opts[key] = argv[++i];
    else opts[key] = true;
  }
  return { opts, rest };
}

export const die = (msg) => { console.error("✗ " + msg); process.exit(1); };

/** 读 / 写单条视频工程的 project.json */
export function readProject(dir) {
  const file = path.join(dir, "project.json");
  if (!fs.existsSync(file)) die(`没有找到 ${file}：先用 init-project.mjs 新建工程`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
export const writeProject = (dir, project) => fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(project, null, 2) + "\n");

/** 本机私有配置 profile.json：仓库的 .local/ 优先，其次配置目录；都没有返回 {} */
export function loadProfile() {
  for (const file of [path.join(REPO_ROOT, ".local", "profile.json"), path.join(configDir(), "profile.json")])
    if (fs.existsSync(file)) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { die(`${file} 不是合法的 JSON`); } }
  return {};
}

/** 本机 Chrome 的可执行文件（渲染和截图用）；找不到返回 undefined */
export function findChrome() {
  return [
    process.env.REAL_CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ].find((f) => f && fs.existsSync(f));
}

/** 跑 HyperFrames 时的环境变量：通过工程里的 lib/chrome-tall.sh 启动 Chrome，避免成片底部（字幕）被截掉 */
export function hyperframesEnv(dir) {
  const chrome = findChrome(), wrapper = path.join(dir, "lib", "chrome-tall.sh");
  const env = { ...process.env };
  if (chrome && process.platform !== "win32" && fs.existsSync(wrapper)) { env.HYPERFRAMES_BROWSER_PATH = wrapper; env.REAL_CHROME = chrome; }
  else if (chrome) { env.HYPERFRAMES_BROWSER_PATH = chrome; console.warn("! 没用上 lib/chrome-tall.sh：渲染后务必检查成片底部的字幕有没有被截掉"); }
  else console.warn("! 没找到本机 Chrome，HyperFrames 会自行下载渲染用浏览器");
  return env;
}

const PUNCT = /[，。！？；：,!?;]/g;
/** 去掉标点、空白和重点词花括号，只留会被读出来的字 */
export const spoken = (t) => String(t).replace(/[\s，。！？、；：,.!?;:"'“”‘’（）()《》{}\-—…·]/g, "");
/** 送去配音的文本：去掉字幕重点词的花括号 */
export const ttsText = (t) => String(t || "").replace(/[{}]/g, "");
/** 字幕上显示的文本：去掉行尾的逗号句号（问号感叹号保留） */
export const subtitleText = (t) => String(t).replace(/[，。；：,;、]+$/u, "").trim();

/** 把一段口播按标点切成字幕行；太短的碎片并到相邻行，尽量不超过 max 个字 */
export function splitLines(text, max = 18) {
  const parts = String(text || "").split(/(?<=[，。！？；：,!?;])\s*|\n+/).map((t) => t.trim()).filter(Boolean);
  const bare = (t) => t.replace(PUNCT, "").replace(/[{}]/g, "");
  const out = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && (bare(p).length < 4 || bare(last).length < 4) && bare(last + p).length <= max) out[out.length - 1] += p;
    else out.push(p);
  }
  return out;
}

const round2 = (v) => Math.round(v * 100) / 100;

/** 没有逐字时间戳时：在 [t0, t1] 内按字数比例给每行分配时间 */
export function timeLines(text, t0, t1) {
  const lines = splitLines(text);
  const total = lines.reduce((n, l) => n + spoken(l).length, 0) || 1;
  let acc = 0;
  return lines.map((line) => {
    const start = t0 + ((t1 - t0) * acc) / total;
    acc += spoken(line).length;
    return { text: subtitleText(line), start: round2(start), end: round2(t0 + ((t1 - t0) * acc) / total) };
  });
}

/**
 * 用配音返回的逐字时间戳给字幕行定时（比按字数比例分配准得多）。
 * words: [{ word, start, end }]，时间相对这段音频的开头；offset 是这段音频在整条配音里的起点。
 * 对不上（字数差太多）时返回 null，由调用方退回 timeLines。
 */
export function timeLinesFromWords(text, words, offset = 0) {
  const lines = splitLines(text);
  const chars = [];
  for (const w of words || []) {
    const s = spoken(w.word);
    if (!s) continue;
    const step = (w.end - w.start) / s.length;
    for (let i = 0; i < s.length; i++) chars.push({ start: w.start + step * i, end: w.start + step * (i + 1) });
  }
  const need = lines.reduce((n, l) => n + spoken(l).length, 0);
  if (!chars.length || !need || Math.abs(chars.length - need) > Math.max(3, need * 0.2)) return null;
  const scale = chars.length / need; // 数字、英文的读法会让字数略有出入，按比例对齐
  let pos = 0;
  return lines.map((line) => {
    const n = spoken(line).length;
    const a = chars[Math.min(chars.length - 1, Math.floor(pos * scale))];
    pos += n;
    const b = chars[Math.min(chars.length - 1, Math.max(0, Math.ceil(pos * scale) - 1))];
    return { text: subtitleText(line), start: round2(offset + a.start), end: round2(offset + Math.max(b.end, a.start + 0.2)) };
  }).map((l, i, arr) => (i < arr.length - 1 ? { ...l, end: Math.max(l.start + 0.2, Math.min(l.end, arr[i + 1].start)) } : l));
}

/** 估算 BPM：取中段 80 秒，能量包络的起音强度做自相关，在 70–180 BPM 里找最强的周期。只是参考值 */
export function estimateBpm(file, duration) {
  const sr = 11025, hop = 128, fps = sr / hop;
  const pcm = execFileSync("ffmpeg", ["-v", "error", "-ss", String(Math.max(0, duration * 0.25)), "-t", "80", "-i", file, "-ac", "1", "-ar", String(sr), "-f", "s16le", "-"], { maxBuffer: 64 * 1024 * 1024 });
  const n = Math.floor(pcm.length / 2 / hop);
  if (n < fps * 20) return null;
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < hop; k++) { const v = pcm.readInt16LE((i * hop + k) * 2) / 32768; s += v * v; } env[i] = Math.log10(1e-7 + s / hop); }
  const onset = new Float32Array(n);
  for (let i = 1; i < n; i++) onset[i] = Math.max(0, env[i] - env[i - 1]);
  let best = 0, bestLag = 0;
  for (let lag = Math.round((fps * 60) / 180); lag <= Math.round((fps * 60) / 70); lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += onset[i] * onset[i - lag];
    // 自相关在整数倍周期上都有峰，不加偏好会总是选到最慢的那个；按常见速度（约 115 BPM）加一个宽松的权重
    s = (s / (n - lag)) * Math.exp(-0.5 * (Math.log2((fps * 60) / lag / 115) / 0.8) ** 2);
    if (s > best) { best = s; bestLag = lag; }
  }
  return bestLag ? Math.round((fps * 60) / bestLag) : null;
}

/**
 * 从配音音频（voice.wav）提取真实逐帧口型包络（0=闭嘴, 1=半张, 2=大张）：
 * - 逗号/句间停顿与换气静音处严格归 0（闭嘴），彻底消除伪随机“空嚼”抖动；
 * - 连续长元音自动插入自然的音节微收（2→1→2），避免大张嘴僵住。
 */
export function extractMouthEnvelope(file, fps = 20) {
  const sr = 16000, hop = Math.round(sr / fps);
  const pcm = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", String(sr), "-f", "s16le", "-"], { maxBuffer: 64 * 1024 * 1024 });
  const n = Math.floor(pcm.length / 2 / hop);
  if (!n) return { fps, frames: "" };
  const rms = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = 0; k < hop; k++) {
      const v = pcm.readInt16LE((i * hop + k) * 2) / 32768;
      sum += v * v;
    }
    rms[i] = Math.sqrt(sum / hop);
  }
  const active = Array.from(rms).filter((v) => v > 0.008).sort((a, b) => a - b);
  const ref = active.length ? active[Math.floor(active.length * 0.9)] : 0.1;
  const thOpen = ref * 0.16, thWide = ref * 0.52;
  const states = new Uint8Array(n);
  let wideRun = 0;
  for (let i = 0; i < n; i++) {
    const v = rms[i];
    if (v < thOpen) {
      states[i] = 0;
      wideRun = 0;
    } else if (v >= thWide) {
      wideRun++;
      // 连续超过 3 帧（150ms）处于高能量时，若局部能量微降或满 3 帧则回收一拍半张嘴，贴合中文音节开合
      if (wideRun >= 3 && (i + 1 < n && rms[i] < rms[i - 1] * 0.92 || wideRun >= 4)) {
        states[i] = 1;
        wideRun = 0;
      } else {
        states[i] = 2;
      }
    } else {
      states[i] = 1;
      wideRun = 0;
    }
  }
  return { fps, frames: Array.from(states).join("") };
}
