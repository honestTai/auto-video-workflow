#!/usr/bin/env node
// 配音先行：逐分镜合成口播 → 量出真实时长 → 把每个分镜的 start/end/duration 和逐行字幕写回 project.json，
// 同时生成 timing.js（index.html 直接引用里面的字幕数组和分镜时长）。配音必须在写动画之前跑。
//
// 用法: node tts.mjs <工程目录> [--provider volc|say|files] [--voice 音色] [--pace 1.1] [--gap 0.22] [--lead 0.3]
//   volc   火山引擎豆包语音合成大模型（默认）：音色自然，带逐字时间戳，字幕对得准
//            密钥：环境变量 VOLC_TTS_API_KEY，或写在 ~/.config/auto-video-workflow/volc.env 里
//   say    macOS 自带语音（离线可用，只适合打样）
//   files  用自己录的声音：把每个分镜的音频放到 audio/takes/<分镜 id>.(wav|mp3|m4a|aiff)
//
// 音色：分镜写了 speaker 就用 project.json 里 voices[speaker]（双人对话就是两个 speaker 配两个音色），
//       否则用 --voice → meta.tts.voice → volc.env 里的 VOLC_TTS_SPEAKER → 默认音色。
// 节奏倍率 --pace（默认 1.1，或 meta.pace）：语速和句间停顿一起按这个倍率加快。
// 口播文本里用 {花括号} 标出字幕要高亮的重点词，配音时会自动去掉花括号。
// 某个词读音不对时，给分镜加 tts 字段写成想要的读法（say 仍用来出字幕）。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseArgs, die, readProject, writeProject, timeLines, timeLinesFromWords, ttsText, extractMouthEnvelope } from "./lib.mjs";
import * as volc from "./volc-tts.mjs";

const { opts, rest } = parseArgs(process.argv.slice(2), ["provider", "voice", "pace", "gap", "lead"]);
const dir = path.resolve(rest[0] || ".");
const project = readProject(dir);
const scenes = project.scenes || [];
if (!scenes.length) die("project.json 里还没有分镜（scenes）：先写口播文案");
if (new Set(scenes.map((s) => s.id)).size !== scenes.length) die("分镜 id 有重复");

const saved = project.meta?.tts || {};
const provider = opts.provider || saved.provider || (volc.hasCredentials() ? "volc" : process.platform === "darwin" ? "say" : "volc");
if (!["volc", "say", "files"].includes(provider)) die(`未知 provider: ${provider}`);
if (provider === "volc" && !volc.hasCredentials()) die(`没有找到豆包语音的密钥：请在 ${volc.CONFIG_FILE} 里写入 VOLC_TTS_API_KEY=你的Key（不要发到对话里）`);
const pace = parseFloat(opts.pace || project.meta?.pace || 1.1);
if (!(pace >= 0.7 && pace <= 1.6)) die(`节奏倍率 ${pace} 不合理，应在 0.7–1.6 之间`);
const gap = parseFloat(opts.gap || "0.22") / pace;   // 分镜之间的停顿
const lead = parseFloat(opts.lead || "0.3") / pace;  // 开头留白
const defaultVoice = opts.voice || (provider === saved.provider && saved.voice) || { volc: volc.loadCredentials()?.speaker || "zh_female_vv_uranus_bigtts", say: "Tingting", files: "" }[provider];
const voiceOf = (scene) => (scene.speaker && project.voices?.[scene.speaker]) || defaultVoice;

const outDir = path.join(dir, "audio", "scenes");
fs.mkdirSync(outDir, { recursive: true });
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
const seconds = (f) => parseFloat(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());
const round2 = (v) => Math.round(v * 100) / 100;
const TRIM = "silenceremove=start_periods=1:start_threshold=-48dB,areverse,silenceremove=start_periods=1:start_threshold=-48dB,areverse";
// 只裁尾部静音：开头不能动，否则逐字时间戳会整体错位
const TRIM_TAIL = "areverse,silenceremove=start_periods=1:start_threshold=-48dB,areverse";
const toWav = (src, dst, tempo = 1) => run("ffmpeg", ["-v", "error", "-y", "-i", src, "-af", TRIM + (tempo !== 1 ? `,atempo=${tempo}` : ""), "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", dst]);

const connections = new Map(); // 一个音色一条连接
async function synth(scene, wav) {
  const text = ttsText(scene.tts || scene.say), voice = voiceOf(scene), tmp = path.join(outDir, `${scene.id}.tmp`);
  if (provider === "volc") {
    if (!connections.has(voice)) connections.set(voice, await volc.connect({ speaker: voice, speechRate: Math.round((pace - 1) * 100) }));
    const { pcm, words } = await connections.get(voice).synth(text);
    fs.writeFileSync(tmp + ".pcm", pcm);
    run("ffmpeg", ["-v", "error", "-y", "-f", "s16le", "-ar", String(volc.SAMPLE_RATE), "-ac", "1", "-i", tmp + ".pcm", "-af", TRIM_TAIL, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", wav]);
    fs.rmSync(tmp + ".pcm");
    fs.writeFileSync(path.join(outDir, `${scene.id}.words.json`), JSON.stringify(words));
  } else if (provider === "say") {
    run("say", ["-v", voice, "-r", String(Math.round(195 * pace)), "-o", tmp + ".aiff", text]);
    toWav(tmp + ".aiff", wav); fs.rmSync(tmp + ".aiff");
  } else {
    const take = ["wav", "mp3", "m4a", "aiff", "aac"].map((e) => path.join(dir, "audio", "takes", `${scene.id}.${e}`)).find((f) => fs.existsSync(f));
    if (!take) throw new Error(`缺少 audio/takes/${scene.id}.(wav|mp3|m4a|aiff)`);
    toWav(take, wav, pace); // 自己录的声音没有语速参数，用变速不变调来套倍率
  }
}
const closeAll = async () => { for (const c of connections.values()) await c.close().catch(() => {}); };

// 1) 逐分镜合成（文本、音色、倍率没变就复用缓存）
for (const scene of scenes) {
  if (!scene.say) continue;
  const wav = path.join(outDir, `${scene.id}.wav`), stamp = path.join(outDir, `${scene.id}.txt`);
  const key = [provider, voiceOf(scene), pace, ttsText(scene.tts || scene.say)].join("|");
  if (provider !== "files" && fs.existsSync(wav) && fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8") === key) continue;
  fs.rmSync(path.join(outDir, `${scene.id}.words.json`), { force: true }); // 旧的时间戳不能配新的音频
  try { await synth(scene, wav); } catch (e) {
    await closeAll();
    die(`${scene.id} 配音失败: ${(e.stderr || e.message || "").toString().trim().split("\n").pop()}`);
  }
  fs.writeFileSync(stamp, key);
}
await closeAll();

// 2) 排时间：分镜首尾相接，分镜时长 = 这句话的真实时长 + 停顿（取到 0.01 秒，音频按取整后的时长拼）
const silence = (d, f) => run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", d.toFixed(3), "-c:a", "pcm_s16le", f]);
const pieces = [];
let t = 0, n = 0, timed = 0;
const pushSilence = (d) => { if (d <= 0.001) return; const f = path.join(outDir, `_sil${n++}.wav`); silence(d, f); pieces.push(f); };
scenes.forEach((scene, i) => {
  scene.start = round2(t);
  if (!scene.say) {
    scene.duration = round2(scene.hold || 1.5);
    pushSilence(scene.duration);
    scene.lines = []; delete scene.talk;
  } else {
    const wav = path.join(outDir, `${scene.id}.wav`), d = seconds(wav);
    const pre = i === 0 ? lead : 0;
    scene.duration = round2(pre + d + gap + (scene.pause || 0));
    pushSilence(pre); pieces.push(wav); pushSilence(scene.duration - pre - d);
    // 有逐字时间戳就按真实发音位置给字幕定时；没有或对不上再按字数比例分
    const wordsFile = path.join(outDir, `${scene.id}.words.json`);
    const words = fs.existsSync(wordsFile) && !scene.tts ? JSON.parse(fs.readFileSync(wordsFile, "utf8")) : null;
    const byWords = words && words.length && words[words.length - 1].end <= d + 0.6 ? timeLinesFromWords(scene.say, words, t + pre) : null;
    if (byWords) timed++;
    scene.lines = byWords || timeLines(scene.say, t + pre, t + pre + d);
    scene.talk = [round2(t + pre), round2(t + pre + d)]; // 这个分镜里真正在说话的时间段（给角色口型用）
  }
  t = round2(t + scene.duration);
  scene.end = t;
});

// 3) 拼成一条完整配音
const list = path.join(outDir, "_concat.txt");
fs.writeFileSync(list, pieces.map((f) => `file '${f.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"));
const voicePath = path.join(dir, "audio", "voice.wav");
run("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", voicePath]);
for (const f of fs.readdirSync(outDir)) if (f.startsWith("_")) fs.rmSync(path.join(outDir, f));

// 4) 写回 project.json 和 timing.js
project.duration = t;
project.audio = { ...project.audio, voice: "audio/voice.wav" };
// 配音变了，旧的混音对不上了
if (project.audio.mix) { delete project.audio.mix; fs.rmSync(path.join(dir, "audio", "mix.wav"), { force: true }); }
project.meta = { ...project.meta, pace, tts: { provider, voice: defaultVoice } };
writeProject(dir, project);

const mouth = extractMouthEnvelope(voicePath, 12);
const timing = {
  duration: t,
  scenes: scenes.map((s) => ({ id: s.id, start: s.start, end: s.end, d: s.duration, ...(s.speaker ? { speaker: s.speaker } : {}), ...(s.talk ? { talk: s.talk } : {}) })),
  subtitles: scenes.flatMap((s) => s.lines.map((l) => [l.start, l.end, l.text])),
  mouth,
};
fs.writeFileSync(path.join(dir, "timing.js"), `// 由 tts.mjs 生成，不要手改；改了口播文本就重跑 tts.mjs\nwindow.AVW_TIMING = ${JSON.stringify(timing, null, 2)};\n`);

const voiced = scenes.filter((s) => s.say).length;
console.log(`✓ audio/voice.wav  ${seconds(voicePath).toFixed(2)}s  (${provider}，节奏 ${pace} 倍)${provider === "volc" ? `  字幕按逐字时间戳定时 ${timed}/${voiced} 个分镜` : ""}`);
console.log(`✓ timing.js  全片 ${t.toFixed(2)}s，${scenes.length} 个分镜，${timing.subtitles.length} 行字幕`);
console.log("  每个分镜的 <section class=\"scene\"> 要写上对应的 data-scene 和 data-d：");
for (const s of scenes) console.log(`  ${s.id.padEnd(6)} ${s.start.toFixed(2).padStart(7)} → ${s.end.toFixed(2).padStart(7)}  data-d="${s.duration}"  ${(s.speaker || "").padEnd(6)} ${(s.say ? ttsText(s.say) : "(静默)").slice(0, 26)}`);
