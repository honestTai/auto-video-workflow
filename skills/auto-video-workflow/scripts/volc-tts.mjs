// 火山引擎 · 豆包语音合成大模型 · 双向流式 WebSocket（V3）
// 文档: https://docs.volcengine.com/docs/DoubaoVoice/bidirectional-streaming-text-to-speech-websocket
// 一条连接上可以连续开多个会话；这里一个分镜一个会话，拿回 PCM 音频和逐字时间戳。
//
// 密钥不写在代码和项目里。按这个顺序找：
//   环境变量 VOLC_TTS_API_KEY（新版控制台的 API Key）
//   环境变量 VOLC_TTS_APP_ID + VOLC_TTS_ACCESS_TOKEN（旧版控制台）
//   文件 ~/.config/auto-video-workflow/volc.env（同名变量，一行一个 KEY=VALUE，权限建议 600）
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { configDir } from "./lib.mjs";

const ENDPOINT = "wss://openspeech.bytedance.com/api/v3/tts/bidirection";
export const SAMPLE_RATE = 48000;
const EV = {
  StartConnection: 1, FinishConnection: 2, ConnectionStarted: 50, ConnectionFailed: 51, ConnectionFinished: 52,
  StartSession: 100, CancelSession: 101, FinishSession: 102, SessionStarted: 150, SessionCanceled: 151, SessionFinished: 152, SessionFailed: 153,
  TaskRequest: 200, TTSSentenceStart: 350, TTSSentenceEnd: 351, TTSResponse: 352,
};
const NO_SESSION = [EV.StartConnection, EV.FinishConnection, EV.ConnectionStarted, EV.ConnectionFailed, EV.ConnectionFinished];
const HAS_CONNECT_ID = [EV.ConnectionStarted, EV.ConnectionFailed, EV.ConnectionFinished];
const MSG = { FullClient: 0x1, FullServer: 0x9, AudioOnlyServer: 0xb, Error: 0xf };

export const CONFIG_FILE = path.join(configDir(), "volc.env");
export function loadCredentials() {
  const env = { ...process.env };
  if (fs.existsSync(CONFIG_FILE))
    for (const line of fs.readFileSync(CONFIG_FILE, "utf8").split("\n")) {
      const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*["']?(.*?)["']?\s*$/.exec(line);
      if (m && !line.trim().startsWith("#") && env[m[1]] === undefined) env[m[1]] = m[2];
    }
  const cred = { apiKey: env.VOLC_TTS_API_KEY, appId: env.VOLC_TTS_APP_ID, accessToken: env.VOLC_TTS_ACCESS_TOKEN, resourceId: env.VOLC_TTS_RESOURCE_ID, speaker: env.VOLC_TTS_SPEAKER };
  return cred.apiKey || (cred.appId && cred.accessToken) ? cred : null;
}
export const hasCredentials = () => !!loadCredentials();

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const i32 = (n) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };

/** 客户端帧：4 字节头 | 事件号 | [会话 id 长度 + 会话 id] | 载荷长度 + JSON 载荷（全部大端） */
function encode(event, sessionId, payload) {
  const body = Buffer.from(JSON.stringify(payload ?? {}));
  const parts = [Buffer.from([0x11, (MSG.FullClient << 4) | 0x4, 0x10, 0x00]), i32(event)];
  if (!NO_SESSION.includes(event)) { const sid = Buffer.from(sessionId); parts.push(u32(sid.length), sid); }
  parts.push(u32(body.length), body);
  return Buffer.concat(parts);
}

function decode(data) {
  const buf = Buffer.from(data);
  const type = buf[1] >> 4, flags = buf[1] & 0x0f, serialization = buf[2] >> 4, compression = buf[2] & 0x0f;
  let o = (buf[0] & 0x0f) * 4;
  const msg = { type };
  if (type === MSG.Error) { msg.errorCode = buf.readUInt32BE(o); o += 4; }
  else if (flags === 0x1 || flags === 0x2 || flags === 0x3) o += 4; // 序号
  if (flags & 0x4) {
    msg.event = buf.readInt32BE(o); o += 4;
    if (!NO_SESSION.includes(msg.event)) { const n = buf.readUInt32BE(o); o += 4; msg.sessionId = buf.toString("utf8", o, o + n); o += n; }
    if (HAS_CONNECT_ID.includes(msg.event)) { const n = buf.readUInt32BE(o); o += 4; msg.connectId = buf.toString("utf8", o, o + n); o += n; }
  }
  const size = o + 4 <= buf.length ? buf.readUInt32BE(o) : 0; o += 4;
  let payload = buf.subarray(o, o + size);
  if (compression === 1 && payload.length) payload = zlib.gunzipSync(payload);
  if (type === MSG.AudioOnlyServer) msg.audio = payload;
  else if (serialization === 1 || payload[0] === 0x7b) { try { msg.json = JSON.parse(payload.toString("utf8")); } catch { msg.text = payload.toString("utf8"); } }
  else msg.text = payload.toString("utf8");
  return msg;
}

const describe = (msg) => {
  const j = msg.json || {};
  return [msg.errorCode && `错误码 ${msg.errorCode}`, j.status_code && `status ${j.status_code}`, j.message || j.error || msg.text].filter(Boolean).join("，") || "未知错误";
};

/**
 * 建立连接。返回 { synth(text) → { pcm, words }, close() }
 * opts: { speaker, speechRate(-50~100，0 为原速), loudnessRate, resourceId, emotion }
 */
export async function connect(opts = {}) {
  const cred = loadCredentials();
  if (!cred) throw new Error(`没有找到豆包语音的密钥。请自行在 ${CONFIG_FILE} 里写入 VOLC_TTS_API_KEY=你的Key（不要发到对话里），或设置同名环境变量`);
  const headers = { "X-Api-Resource-Id": opts.resourceId || cred.resourceId || "seed-tts-2.0", "X-Api-Connect-Id": crypto.randomUUID() };
  if (cred.apiKey) headers["X-Api-Key"] = cred.apiKey;
  else { headers["X-Api-App-Key"] = cred.appId; headers["X-Api-Access-Key"] = cred.accessToken; }
  const speaker = opts.speaker || cred.speaker || "zh_female_vv_uranus_bigtts";

  const ws = new WebSocket(ENDPOINT, { headers });
  ws.binaryType = "arraybuffer";
  const queue = [], waiters = [];
  let failure = null;
  const push = (item) => (waiters.length ? waiters.shift()(item) : queue.push(item));
  ws.onmessage = (e) => push({ msg: decode(e.data) });
  ws.onerror = () => { failure = failure || new Error("连接失败：握手被拒绝或网络不通。检查 API Key、Resource-Id（seed-tts-2.0），以及账号是否开通了语音合成大模型"); push({ error: failure }); };
  ws.onclose = (e) => { failure = failure || new Error(`连接被关闭（${e.code}）`); push({ error: failure }); };
  const next = (ms = 60_000) => new Promise((resolve, reject) => {
    const done = (item) => { clearTimeout(timer); item.error ? reject(item.error) : resolve(item.msg); };
    const timer = setTimeout(() => { const i = waiters.indexOf(done); if (i >= 0) waiters.splice(i, 1); reject(new Error("等待服务端响应超时")); }, ms);
    queue.length ? done(queue.shift()) : waiters.push(done);
  });
  await new Promise((resolve, reject) => { ws.onopen = resolve; const t = setInterval(() => { if (failure) { clearInterval(t); reject(failure); } }, 50); ws.addEventListener("open", () => clearInterval(t)); });

  ws.send(encode(EV.StartConnection));
  const hello = await next(15_000);
  if (hello.event !== EV.ConnectionStarted) throw new Error(`建立连接失败：${describe(hello)}`);

  async function synth(text) {
    const sid = crypto.randomUUID();
    const params = {
      speaker,
      audio_params: { format: "pcm", sample_rate: SAMPLE_RATE, speech_rate: opts.speechRate ?? 0, loudness_rate: opts.loudnessRate ?? 0, enable_subtitle: true, ...(opts.emotion ? { emotion: opts.emotion } : {}) },
      additions: JSON.stringify({ disable_markdown_filter: true }),
    };
    const base = { user: { uid: "auto-video-workflow" }, namespace: "BidirectionalTTS" };
    ws.send(encode(EV.StartSession, sid, { ...base, event: EV.StartSession, req_params: params }));
    for (;;) {
      const m = await next(20_000);
      if (m.event === EV.SessionStarted) break;
      if (m.type === MSG.Error || m.event === EV.SessionFailed || m.event === EV.ConnectionFailed) throw new Error(`开启会话失败：${describe(m)}`);
    }
    ws.send(encode(EV.TaskRequest, sid, { ...base, event: EV.TaskRequest, req_params: { ...params, text } }));
    ws.send(encode(EV.FinishSession, sid, {}));

    const chunks = [], words = [];
    let offset = 0, lastEnd = 0;
    for (;;) {
      const m = await next(90_000);
      if (m.type === MSG.Error || m.event === EV.SessionFailed || m.event === EV.SessionCanceled) throw new Error(`合成失败：${describe(m)}`);
      if (m.audio) { chunks.push(m.audio); continue; }
      const list = m.json?.words;
      if (Array.isArray(list) && list.length) {
        // 逐字时间戳。一个会话里有多句话时，后一句的时间如果又从 0 开始，就接在上一句后面
        const first = Number(list[0].startTime ?? list[0].start_time ?? 0);
        if (first + offset < lastEnd - 0.3) offset = lastEnd;
        for (const w of list) {
          const start = Number(w.startTime ?? w.start_time), end = Number(w.endTime ?? w.end_time);
          if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
          words.push({ word: String(w.word ?? w.text ?? ""), start: start + offset, end: end + offset });
          lastEnd = Math.max(lastEnd, end + offset);
        }
      }
      if (m.event === EV.SessionFinished) break;
    }
    const pcm = Buffer.concat(chunks);
    if (!pcm.length) throw new Error("服务端没有返回音频");
    return { pcm, words, speaker };
  }

  async function close() {
    try { ws.send(encode(EV.FinishConnection)); await next(3000).catch(() => {}); } catch {}
    ws.onclose = ws.onerror = null;
    ws.close();
  }
  return { synth, close, speaker };
}
