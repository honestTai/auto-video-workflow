import json

from dy_mcp.install import SERVER_NAME, install_antigravity, write_json_config


def test_write_json_config_handles_empty_existing_file(tmp_path):
    config_file = tmp_path / "mcp_config.json"
    config_file.write_text("", encoding="utf-8")

    write_json_config(config_file, root=tmp_path)

    data = json.loads(config_file.read_text(encoding="utf-8"))
    assert SERVER_NAME in data["mcpServers"]
    assert data["mcpServers"][SERVER_NAME]["cwd"] == str(tmp_path)


def test_install_antigravity_preserves_other_servers(tmp_path):
    config_dir = tmp_path / ".gemini" / "config"
    config_dir.mkdir(parents=True)
    (config_dir / "mcp_config.json").write_text(
        json.dumps({"mcpServers": {"other": {"command": "echo"}}}),
        encoding="utf-8",
    )

    install_antigravity(root=tmp_path, home=tmp_path)

    data = json.loads((config_dir / "mcp_config.json").read_text(encoding="utf-8"))
    assert "other" in data["mcpServers"]
    assert SERVER_NAME in data["mcpServers"]
