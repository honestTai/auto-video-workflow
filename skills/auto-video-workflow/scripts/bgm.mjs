#!/usr/bin/env node
// 背景音乐：把任意音频收进本机 BGM 曲库 → 按内容情绪选一首 → 裁到片长并和配音混好
//
//   node bgm.mjs add <音频文件或目录> [--tags 轻快,科技] [--mood "一句话描述"] [--vocal]
//        导入并分析（时长、响度、估算 BPM、动态）。同名文件已在库里就只更新标签。
//   node bgm.mjs list                     列出曲库里的曲目和特征，供选曲
//   node bgm.mjs tag <曲名关键词> --tags a,b [--mood "…"] [--vocal|--no-vocal]
//   node bgm.mjs mix <工程目录> [--track <曲名关键词>] [--level -24] [--start 秒] [--no-duck] [--sfx 0] [--no-sfx]
//        人声统一到 -16 LUFS，垫乐 -24 LUFS，人声出现时自动压低约 4–5 dB，片头淡入、片尾淡出，
//        工程里有 audio/sfx.wav（sfx.mjs 生成的音效轨）就一起混进去，--sfx 是音效轨整体加减的分贝数。
//        输出 audio/mix.wav 并登记到 project.json。曲库是空的、也没有音效轨，就跳过混音，成片直接用纯人声。
//
// 曲库位置：环境变量 AUTO_VIDEO_BGM_DIR，默认 ~/.config/auto-video-workflow/bgm/。音乐文件只在本机，不随仓库分发。
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { parseArgs, die, configDir, readProject, writeProject, estimateBpm } from "./lib.mjs";

const cmd = process.argv[2];
const { opts, rest: positional } = parseArgs(process.argv.slice(3), ["tags", "mood", "track", "level", "start", "sfx"]);
const LIB = process.env.AUTO_VIDEO_BGM_DIR || path.join(configDir(), "bgm");
const INDEX = path.join(LIB, "index.json");
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|flac|ogg|opus|aiff?)$/i;
const load = () => (fs.existsSync(INDEX) ? JSON.parse(fs.readFileSync(INDEX, "utf8")) : []);
const save = (list) => { fs.mkdirSync(LIB, { recursive: true }); fs.writeFileSync(INDEX, JSON.stringify(list, null, 2) + "\n"); };
const seconds = (f) => parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());

/** 整体响度（LUFS）、动态范围（LRA）、真峰值 */
function loudness(file, extra = []) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", ...extra, "-i", file, "-af", "loudnorm=print_format=json", "-f", "null", "-"], { maxBuffer: 64 * 1024 * 1024 });
  const text = r.stderr.toString(), at = text.lastIndexOf("{");
  if (at < 0 || !text.includes('"input_i"')) return { lufs: -23, lra: 0, peak: 0 };
  const j = JSON.parse(text.slice(at, text.indexOf("}", at) + 1));
  return { lufs: parseFloat(j.input_i), lra: parseFloat(j.input_lra), peak: parseFloat(j.input_tp) };
}
function analyze(file) {
  const duration = seconds(file), l = loudness(file);
  return { duration: Math.round(duration * 10) / 10, lufs: l.lufs, lra: l.lra, bpm: estimateBpm(file, duration) };
}
const find = (list, key) => {
  const k = String(key).toLowerCase();
  const hits = list.filter((t) => t.file.toLowerCase().includes(k) || (t.title || "").toLowerCase().includes(k));
  if (!hits.length) die(`曲库里没有匹配 "${key}" 的曲目。先跑 bgm.mjs list`);
  if (hits.length > 1) die(`"${key}" 匹配到多首：${hits.map((t) => t.file).join("、")}`);
  return hits[0];
};
const tagsOf = (v) => String(v || "").split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
const tempoWord = (bpm) => (bpm == null ? "未知" : bpm < 90 ? "慢" : bpm < 115 ? "中速" : bpm < 140 ? "轻快" : "快");

if (cmd === "add") {
  if (!positional.length) die("用法: bgm.mjs add <音频文件或目录> [--tags …] [--mood …] [--vocal]");
  const list = load();
  const files = positional.flatMap((p) => (fs.statSync(p).isDirectory() ? fs.readdirSync(p).filter((f) => AUDIO_EXT.test(f)).sort().map((f) => path.join(p, f)) : [p]));
  if (!files.length) die("没有找到音频文件");
  fs.mkdirSync(LIB, { recursive: true });
  for (const src of files) {
    const name = path.basename(src), dst = path.join(LIB, name);
    if (path.resolve(src) !== path.resolve(dst) && !fs.existsSync(dst)) fs.copyFileSync(src, dst);
    let item = list.find((t) => t.file === name);
    if (!item) { item = { file: name, title: name.replace(AUDIO_EXT, "").replace(/^\d+\s*-\s*/, ""), tags: [], mood: "", vocal: false }; list.push(item); }
    Object.assign(item, analyze(dst));
    if (opts.tags) item.tags = tagsOf(opts.tags);
    if (opts.mood) item.mood = opts.mood;
    if (opts.vocal) item.vocal = true;
    console.log(`✓ ${item.title}  ${item.duration}s  ${item.lufs} LUFS  约 ${item.bpm ?? "?"} BPM（${tempoWord(item.bpm)}）  动态 ${item.lra} LU${item.tags.length ? "" : "  ← 还没有标签"}`);
  }
  save(list);
  console.log(`曲库: ${LIB}（共 ${list.length} 首）。没有标签的曲目请用 bgm.mjs tag 补上情绪标签，选曲靠它。`);
} else if (cmd === "list") {
  const list = load();
  if (!list.length) { console.log(`BGM 曲库是空的（${LIB}）。用 bgm.mjs add <音频文件或目录> 导入；没有曲库时成片用纯人声。`); process.exit(0); }
  for (const t of list) console.log(`${t.title}\n    ${t.duration}s · 约 ${t.bpm ?? "?"} BPM（${tempoWord(t.bpm)}）· 动态 ${t.lra} LU · ${t.vocal ? "有人声" : "无人声"}\n    标签：${t.tags.join("、") || "（未标）"}${t.mood ? `\n    ${t.mood}` : ""}`);
} else if (cmd === "tag") {
  const list = load(), item = find(list, positional[0]);
  if (opts.tags) item.tags = tagsOf(opts.tags);
  if (opts.mood) item.mood = opts.mood;
  if (opts.vocal) item.vocal = true;
  if (opts["no-vocal"]) item.vocal = false;
  save(list);
  console.log(`✓ ${item.title}  标签：${item.tags.join("、")}${item.mood ? `  ${item.mood}` : ""}  ${item.vocal ? "有人声" : "无人声"}`);
} else if (cmd === "mix") {
  const dir = path.resolve(positional[0] || ".");
  const project = readProject(dir);
  const voice = path.join(dir, "audio", "voice.wav");
  if (!fs.existsSync(voice) || typeof project.duration !== "number") die("还没有配音：先跑 tts.mjs");
  const list = load();
  const sfxFile = path.join(dir, "audio", "sfx.wav"), hasSfx = fs.existsSync(sfxFile) && !opts["no-sfx"];
  const sfxLevel = parseFloat(opts.sfx ?? project.meta?.sfx?.level ?? 0); // 音效轨整体加减多少 dB
  if (!list.length) {
    if (!hasSfx) { console.log(`! BGM 曲库是空的（${LIB}），跳过混音：成片用纯人声 audio/voice.wav`); process.exit(0); }
    // 没有曲库但有音效轨：人声 + 音效
    const total = project.duration + (project.meta?.tail ?? 0.4), vg = (-16 - loudness(voice).lufs).toFixed(2), out = path.join(dir, "audio", "mix.wav");
    const graph = `[0:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${vg}dB,apad=whole_dur=${total.toFixed(2)}[vox];[1:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${sfxLevel}dB[sfx];[vox][sfx]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.84:level=disabled[mix]`;
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", voice, "-i", sfxFile, "-filter_complex", graph, "-map", "[mix]", "-c:a", "pcm_s16le", out]);
    if (r.status !== 0) die("混音失败：" + r.stderr.toString().trim().split("\n").slice(-3).join(" "));
    project.audio = { ...project.audio, mix: "audio/mix.wav" }; project.meta = { ...project.meta, sfx: { ...project.meta?.sfx, level: sfxLevel } };
    writeProject(dir, project);
    console.log(`✓ audio/mix.wav  ${seconds(out).toFixed(1)}s  人声 + 音效（BGM 曲库是空的，没有垫乐）  整体 ${loudness(out).lufs} LUFS`);
    process.exit(0);
  }
  const key = opts.track || project.meta?.bgm?.track;
  if (!key) die("没指定曲目：先跑 bgm.mjs list 按内容情绪选一首，再传 --track <曲名关键词>");
  const item = find(list, key), src = path.join(LIB, item.file);
  const total = project.duration + (project.meta?.tail ?? 0.4);
  const level = parseFloat(opts.level || project.meta?.bgm?.level || -24); // 垫乐的目标响度（LUFS）
  const start = parseFloat(opts.start || project.meta?.bgm?.start || 0);
  const duck = !opts["no-duck"] && project.meta?.bgm?.duck !== false;
  if (start + 5 > item.duration) die(`--start ${start} 超出了曲目长度 ${item.duration}s`);

  // 响度按实际用到的那一段来量，再算出需要的增益
  const used = loudness(src, ["-ss", String(start), "-t", String(Math.min(total, item.duration - start))]);
  const gain = (level - used.lufs).toFixed(2);
  const voiceGain = (-16 - loudness(voice).lufs).toFixed(2); // 人声统一到 -16 LUFS
  const fadeOut = Math.min(2.2, total / 4);
  const loop = item.duration - start < total ? "aloop=loop=-1:size=2147483647," : ""; // 曲子不够长就循环
  const bed = `[1:a]${loop}atrim=0:${total.toFixed(2)},asetpts=N/SR/TB,aformat=sample_rates=48000:channel_layouts=stereo,volume=${gain}dB,afade=t=in:d=0.8,afade=t=out:st=${(total - fadeOut).toFixed(2)}:d=${fadeOut.toFixed(2)}[bed]`;
  const vox = `[0:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${voiceGain}dB,apad=whole_dur=${total.toFixed(2)},asplit=2[vox][key]`;
  // 人声一出现，音乐自动让开约 4–5 dB；人声停顿时慢慢回来
  const ducked = duck ? `[bed][key]sidechaincompress=threshold=0.06:ratio=2.2:attack=25:release=450:makeup=1[bgm]` : `[key]anullsink;[bed]anull[bgm]`;
  const fx = hasSfx ? `;[2:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${sfxLevel}dB[sfx]` : "";
  const graph = `${vox};${bed};${ducked}${fx};[vox][bgm]${hasSfx ? "[sfx]" : ""}amix=inputs=${hasSfx ? 3 : 2}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.84:level=disabled[mix]`;
  const out = path.join(dir, "audio", "mix.wav");
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", voice, "-ss", String(start), "-i", src, ...(hasSfx ? ["-i", sfxFile] : []), "-filter_complex", graph, "-map", "[mix]", "-c:a", "pcm_s16le", out]);
  if (r.status !== 0) die("混音失败：" + r.stderr.toString().trim().split("\n").slice(-3).join(" "));
  const m = loudness(out);
  project.meta = { ...project.meta, bgm: { track: item.title, level, start, duck }, ...(hasSfx ? { sfx: { ...project.meta?.sfx, level: sfxLevel } } : {}) };
  project.audio = { ...project.audio, mix: "audio/mix.wav" };
  writeProject(dir, project);
  console.log(`✓ audio/mix.wav  ${seconds(out).toFixed(1)}s  整体 ${m.lufs} LUFS，峰值 ${m.peak} dBTP`);
  console.log(`  曲目：${item.title}（约 ${item.bpm ?? "?"} BPM，${item.tags.join("、") || "无标签"}）${loop ? "，已循环" : ""}，从 ${start}s 开始，垫乐 ${level} LUFS${duck ? "，人声下自动压低" : ""}${hasSfx ? `，已混入音效轨（${sfxLevel >= 0 ? "+" : ""}${sfxLevel} dB）` : ""}`);
} else {
  console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 12).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(cmd ? 2 : 0);
}
