// 各脚本共用的小工具：配置目录、工程读写、字幕切句与逐字时间戳对齐、BPM 估算
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 仓库根目录（skills/auto-video-workflow/scripts 往上三级）；skill 被单独拷走时这个目录可能不是仓库 */
export const REPO_ROOT = path.resolve(HERE, "..", "..", "..");

/** 本机配置目录：豆包语音密钥 volc.env、BGM 曲库 bgm/、ip-cast/、profile.json 和 strategy.md
 *  支持通过环境变量 AUTO_VIDEO_CONFIG_DIR 或 ~/.config/auto-video-workflow/.cloud-dir 指向 Google Drive 同步目录 */
export const configDir = () => {
  if (process.env.AUTO_VIDEO_CONFIG_DIR) return process.env.AUTO_VIDEO_CONFIG_DIR;
  const def = path.join(os.homedir(), ".config", "auto-video-workflow");
  const ptr = path.join(def, ".cloud-dir");
  if (fs.existsSync(ptr)) {
    const target = fs.readFileSync(ptr, "utf8").trim();
    if (target && fs.existsSync(target)) return target;
  }
  return def;
};

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

/** 渲染器的 npm 包名。固定在测试过的版本上：上游刚发新版的那几分钟里 npx 可能装不下来，新版也可能改行为。
 *  想换版本设环境变量 HYPERFRAMES_VERSION（例如 latest） */
export const HYPERFRAMES = "hyperframes@" + (process.env.HYPERFRAMES_VERSION || "0.9.69");

/** 本机 Chrome 的可执行文件（渲染和截图用）；找不到返回 undefined */
export function findChrome() {
  return [
    process.env.REAL_CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
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
 * 从配音音频（voice.wav）提取真实逐帧口型包络（0=闭嘴, 1=中口半张, 2=大口张开）：
 * - 默认采用日式 2D 动画标准口型节拍（12fps ≈ 一拍五，每格约 83ms），避免 20fps 单帧高频抽动；
 * - 句中瞬时辅音气隙自动平滑为半张嘴（1），仅在真实逗号/换气停顿（连续静音 ≥ 2 格）时彻底闭嘴（0）。
 */
export function extractMouthEnvelope(file, fps = 12) {
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
  const thOpen = ref * 0.15, thWide = ref * 0.48;
  const raw = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    raw[i] = rms[i] < thOpen ? 0 : rms[i] >= thWide ? 2 : 1;
  }
  // 1) 消除句内单格闭嘴抽动：若前后都在发声（>0），中间仅 1 格跌到 0（爆破音闭气），平滑为半张嘴 1
  const states = Uint8Array.from(raw);
  for (let i = 1; i < n - 1; i++) {
    if (states[i] === 0 && raw[i - 1] > 0 && raw[i + 1] > 0) states[i] = 1;
  }
  // 2) 连续大张嘴超过 2 格时插入一格半张嘴（2→1→2），还原自然音节嚼字感
  let wideRun = 0;
  for (let i = 0; i < n; i++) {
    if (states[i] === 2) {
      wideRun++;
      if (wideRun >= 3) { states[i] = 1; wideRun = 0; }
    } else {
      wideRun = 0;
    }
  }
  return { fps, frames: Array.from(states).join("") };
}

/**
 * 卡点：给 BGM 量出节拍网格。返回 { bpm, offset, beats[], downbeats[], hits[], match }，时间都是成片里的秒数。
 * file = 曲子，start = 从曲子第几秒开始用，total = 成片总长（曲子不够长时按 bgm.mjs 的做法循环）。
 * 做法：低频（底鼓）和全频的能量起伏 → 自相关求拍长 → 在所有拍点上找最响的相位 → 用实际起拍点做最小二乘拟合，
 * 拍长和相位都由整首拟合出来（单看 tempo 估计会有 1–2% 的偏差，拍子越往后错得越多）。
 * 再按底鼓能量定出每小节的第一拍（重拍）和全片最重的几下（hits）。
 */
export function beatGrid(file, start, total) {
  const sr = 11025, hop = 128, fps = sr / hop;
  const raw = execFileSync("ffmpeg", ["-v", "error", "-stream_loop", "-1", "-ss", String(start || 0), "-t", String(total), "-i", file, "-ac", "1", "-ar", String(sr), "-f", "f32le", "-"], { maxBuffer: 512 * 1024 * 1024 });
  const pcm = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4));
  const n = Math.floor(pcm.length / hop);
  if (n < fps * 8) return null;
  const a = 1 - Math.exp((-2 * Math.PI * 150) / sr);
  let l1 = 0, l2 = 0;
  const E = new Float32Array(n), Lw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, sl = 0;
    for (let k = 0; k < hop; k++) { const v = pcm[i * hop + k]; l1 += a * (v - l1); l2 += a * (l1 - l2); s += v * v; sl += l2 * l2; }
    E[i] = Math.log10(1e-9 + s / hop); Lw[i] = Math.log10(1e-9 + sl / hop);
  }
  const O = new Float32Array(n), K = new Float32Array(n);
  for (let i = 1; i < n; i++) { O[i] = Math.max(0, E[i] - E[i - 1]) + 0.6 * Math.max(0, Lw[i] - Lw[i - 1]); K[i] = Math.max(0, Lw[i] - Lw[i - 1]); }
  // 拍长：自相关，偏好常见速度
  let best = 0, lag = 0;
  const ac = (L) => { let s = 0; for (let i = L; i < n; i++) s += O[i] * O[i - L]; return s / (n - L); };
  for (let L = Math.round((fps * 60) / 180); L <= Math.round((fps * 60) / 70); L++) {
    const s = ac(L) * Math.exp(-0.5 * (Math.log2((fps * 60) / L / 115) / 0.8) ** 2);
    if (s > best) { best = s; lag = L; }
  }
  if (!lag) return null;
  const y0 = ac(lag - 1), y1 = ac(lag), y2 = ac(lag + 1), den = y0 - 2 * y1 + y2;
  let T = (lag + (den ? (0.5 * (y0 - y2)) / den : 0)) / fps;
  // 相位：所有拍点上的起拍能量之和最大
  const at = (t) => { const i = Math.round(t * fps); return i >= 0 && i < n ? O[i] : 0; };
  let bestPh = 0, bestS = -1;
  for (let ph = 0; ph < T; ph += 1 / fps) { let s = 0; for (let t = ph; t < total; t += T) s += at(t) + 0.5 * at(t - 1 / fps) + 0.5 * at(t + 1 / fps); if (s > bestS) { bestS = s; bestPh = ph; } }
  // 拟合：每个拍点附近 ±T/6 找真实起拍峰，最小二乘拟合 t_k = t0 + k·T
  const sorted = Array.from(O).sort((x, y) => x - y), thr = sorted[Math.floor(n * 0.75)];
  const pts = [];
  for (let k = 0; bestPh + k * T < total; k++) {
    const c = (bestPh + k * T) * fps, w = Math.max(2, Math.round((T * fps) / 6));
    let bi = -1, bv = thr;
    for (let i = Math.max(1, Math.round(c - w)); i <= Math.min(n - 1, Math.round(c + w)); i++) if (O[i] > bv) { bv = O[i]; bi = i; }
    if (bi >= 0) pts.push([k, bi / fps]);
  }
  let t0 = bestPh;
  if (pts.length >= 8) {
    const m = pts.length, sx = pts.reduce((q, p) => q + p[0], 0), sy = pts.reduce((q, p) => q + p[1], 0), sxx = pts.reduce((q, p) => q + p[0] * p[0], 0), sxy = pts.reduce((q, p) => q + p[0] * p[1], 0);
    const slope = (m * sxy - sx * sy) / (m * sxx - sx * sx);
    if (Math.abs(slope / T - 1) < 0.05) { T = slope; t0 = (sy - slope * sx) / m; }
  }
  while (t0 - T >= 0) t0 -= T;
  const beats = [];
  for (let t = t0; t < total; t += T) if (t >= 0) beats.push(+t.toFixed(3));
  const kAt = (t) => { const c = Math.round(t * fps); let v = 0; for (let i = c - 2; i <= c + 2; i++) if (i >= 0 && i < n) v = Math.max(v, K[i]); return v; };
  let bar = 0, barS = -1;
  for (let m = 0; m < 4; m++) { let s = 0; for (let k = m; k < beats.length; k += 4) s += kAt(beats[k]); if (s > barS) { barS = s; bar = m; } }
  const downbeats = beats.filter((_, k) => k % 4 === bar);
  const hits = beats.map((t) => [t, kAt(t)]).sort((x, y) => y[1] - x[1]).reduce((acc, h) => { if (acc.length < 4 && acc.every((x) => Math.abs(x - h[0]) > 6)) acc.push(h[0]); return acc; }, []).sort((x, y) => x - y);
  const match = beats.filter((t) => { const c = Math.round(t * fps); for (let i = c - 4; i <= c + 4; i++) if (i > 0 && i < n && O[i] > thr) return true; return false; }).length / Math.max(1, beats.length);
  return { bpm: +(60 / T).toFixed(2), offset: +t0.toFixed(3), beats, downbeats, hits, match: +match.toFixed(2) };
}

