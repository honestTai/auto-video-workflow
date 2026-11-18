# 首次配置

四样东西：出片工具链、动效库、豆包语音密钥、抖音账号凭证。BGM 曲库和本机私有配置是可选的。

## 1. 工具链

| 工具 | 用途 | 检查 |
|---|---|---|
| Node.js 18+ | 跑脚本和 `npx hyperframes` | `node -v` |
| FFmpeg（含 ffprobe） | 音频处理、合成、质检 | `ffmpeg -version` |
| Google Chrome | HyperFrames 渲染 | macOS 默认路径自动识别；其他位置设环境变量 `REAL_CHROME` |
| Python 3.10+ | 抖音 MCP | `python3 --version` |

## 2. 动效库 motion-lib

```bash
git clone https://github.com/honestTai/motion-lib
```

放在本仓库里或和本仓库同级的目录会被自动找到；放别处就设环境变量 `MOTION_LIB_DIR`，
或在 `profile.json` 里写 `"motion_lib": "/绝对路径/motion-lib"`。

## 3. 豆包语音密钥

在火山引擎控制台开通「豆包语音合成大模型」，拿到 API Key 后**自己写进文件**（不要发到对话里）：

```bash
mkdir -p ~/.config/auto-video-workflow
printf 'VOLC_TTS_API_KEY=你的Key\n' > ~/.config/auto-video-workflow/volc.env
chmod 600 ~/.config/auto-video-workflow/volc.env
```

可选变量：`VOLC_TTS_SPEAKER`（默认音色 id）、`VOLC_TTS_RESOURCE_ID`（默认 `seed-tts-2.0`）；
旧版控制台用 `VOLC_TTS_APP_ID` + `VOLC_TTS_ACCESS_TOKEN`。
没有密钥时，macOS 上可以用 `--provider say` 打样，但不适合发布。

## 4. 抖音 MCP 与账号凭证

```bash
cd mcp
python3 -m venv .venv                                 # 系统 Python < 3.10 时用: uv venv --python 3.12 .venv
.venv/bin/pip install -r requirements.txt             # 用 uv 时: uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/python -m dy_mcp.install --agent claude    # 或 codex / antigravity / kimi / json
```

绑定账号（只保存一个账号）并从已登录抖音的 Chrome 采集凭证，二选一：

**方式 A：Chrome 远程调试端口**

```bash
# macOS：用独立的用户目录启动一个带调试端口的 Chrome，在里面登录 douyin.com 和 creator.douyin.com
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir="$HOME/.config/auto-video-workflow/chrome"

.venv/bin/python douyin_cli.py set-account --name "我的账号" --browser-type chrome
.venv/bin/python douyin_cli.py refresh
```

**方式 B：浏览器扩展桥**（直接复用日常使用的 Chrome，需要本机已有监听 `127.0.0.1:10086` 的扩展桥）

```bash
.venv/bin/python douyin_cli.py set-account --name "我的账号" --browser-type webbridge
.venv/bin/python douyin_cli.py refresh
```

检查与试发：

```bash
.venv/bin/python douyin_cli.py account                 # runtime_status 应为 saved
.venv/bin/python douyin_cli.py analytics --limit 5     # 拉取近期作品播放与 2s/5s 跳出率数据
.venv/bin/python douyin_cli.py search "AI 工具" --limit 3
.venv/bin/python douyin_cli.py publish --video 成片.mp4 --title "标题" --dry-run   # 只校验，不上传
```

凭证失效（搜索或发布报登录、验证类错误）时，在浏览器里重新登录后再跑一次 `refresh`。
从别的账号数据库迁移：`douyin_cli.py import-db <数据库路径> [--account 名称]`。

## 5. BGM 曲库（可选）

```bash
node skills/auto-video-workflow/scripts/bgm.mjs add ~/Music/bgm --tags 轻快,科技
node skills/auto-video-workflow/scripts/bgm.mjs tag "曲名关键词" --tags 沉稳,电影感 --mood "适合深度解读"
node skills/auto-video-workflow/scripts/bgm.mjs list
```

曲库在 `~/.config/auto-video-workflow/bgm/`，只存在本机。请只导入你有权使用的音乐。没有曲库时成片用纯人声。

## 6. 本机私有配置（可选）

把 `.local.example/` 复制成 `.local/`（已被 `.gitignore` 排除），或放到 `~/.config/auto-video-workflow/`：

- `profile.json`：账号名、关键词池、默认可见性、默认音色、motion-lib 路径
- `strategy.md`：你自己的附加创作要求，工作流会在写文案和发布信息时遵守

两个文件都不存在时，工作流按通用流程运行。
