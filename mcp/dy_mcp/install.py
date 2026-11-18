"""把 douyin-video-mcp 注册到各个 Agent。

用法: python -m dy_mcp.install --agent claude|codex|antigravity|kimi|json
  claude       claude mcp add（用户级）
  codex        codex mcp add
  antigravity  写入 ~/.gemini/config/mcp_config.json 的 mcpServers
  kimi         写入 ~/.kimi-code/mcp.json 的 mcpServers
  json         只打印通用 MCP 配置，自己粘到别的 Agent 里
"""
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SERVER_NAME = "douyin-video-mcp"


def launch_command(root=ROOT):
    return [str(Path(sys.executable).absolute()), str(Path(root) / "mcp_server.py")]


def server_config(root=ROOT):
    command = launch_command(root)
    return {"command": command[0], "args": command[1:], "cwd": str(root)}


def generic_config(root=ROOT):
    return json.dumps({"mcpServers": {SERVER_NAME: server_config(root)}}, ensure_ascii=False, indent=2)


def write_json_config(path, root=ROOT):
    path = Path(path).expanduser()
    raw = path.read_text(encoding="utf-8").strip() if path.exists() else ""
    config = json.loads(raw) if raw else {}
    if not isinstance(config, dict):
        raise ValueError(f"配置文件顶层必须是 JSON 对象: {path}")
    config.setdefault("mcpServers", {})[SERVER_NAME] = server_config(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def install_antigravity(root=ROOT, home=None):
    path = write_json_config(Path(home or Path.home()) / ".gemini" / "config" / "mcp_config.json", root)
    return f"Antigravity: {path}"


def install_kimi(root=ROOT, home=None):
    path = write_json_config(Path(home or Path.home()) / ".kimi-code" / "mcp.json", root)
    return f"Kimi Code: {path}"


def install_codex(root=ROOT):
    executable = shutil.which("codex")
    if not executable:
        raise RuntimeError("未找到 codex CLI，请先安装 Codex")
    subprocess.run([executable, "mcp", "add", SERVER_NAME, "--", *launch_command(root)], cwd=root, check=True)
    return "Codex: 已写入用户级 MCP 配置"


def install_claude(root=ROOT):
    executable = shutil.which("claude")
    if not executable:
        raise RuntimeError("未找到 claude CLI，请先安装 Claude Code")
    subprocess.run(
        [executable, "mcp", "add", "--transport", "stdio", "--scope", "user",
         SERVER_NAME, "--", *launch_command(root)],
        cwd=root, check=True,
    )
    return "Claude Code: 已写入用户级 MCP 配置"


INSTALLERS = {
    "claude": install_claude,
    "codex": install_codex,
    "antigravity": install_antigravity,
    "kimi": install_kimi,
}


def main(argv=None):
    parser = argparse.ArgumentParser(description="把 douyin-video-mcp 注册到 Agent")
    parser.add_argument("--agent", choices=(*INSTALLERS, "json"), required=True)
    args = parser.parse_args(argv)
    if args.agent == "json":
        print(generic_config())
        return 0
    try:
        print(INSTALLERS[args.agent]())
    except (OSError, RuntimeError, ValueError, subprocess.CalledProcessError) as error:
        print(f"{args.agent} 安装失败: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
