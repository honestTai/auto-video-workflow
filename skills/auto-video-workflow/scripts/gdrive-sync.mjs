#!/usr/bin/env node
// 通过 Antigravity 的 gdrive CLI 直接拉取/推送 Google 云盘里的 auto-video-workflow-config（无需安装谷歌云盘桌面客户端也能双机同步）
// 用法:
//   node gdrive-sync.mjs pull   # 从云盘拉取 profile.json、strategy.md、volc.env、douyin.db、assets.zip 到本机
//   node gdrive-sync.mjs push   # 把本机最新的 profile.json、strategy.md、volc.env、douyin.db 推送到云盘
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { configDir, die, REPO_ROOT } from "./lib.mjs";

const FOLDER_ID = "1jRulqQbzXZcMs-FutxdQs0P1hqgdGSj9";
const cmd = process.argv[2] || "pull";
const cfg = configDir();
fs.mkdirSync(cfg, { recursive: true });

const gdriveJson = (args) => JSON.parse(execFileSync("gdrive", [...args, "--json"], { encoding: "utf8", shell: process.platform === "win32" }));
const items = gdriveJson(["readonly", "ls", FOLDER_ID]);
const byName = Object.fromEntries(items.map((x) => [x.name, x]));

if (cmd === "pull") {
  for (const name of ["profile.json", "strategy.md", "volc.env", "douyin.db", "setup-windows.ps1", "link-mac.sh"]) {
    if (!byName[name]) continue;
    const dst = path.join(cfg, name);
    fs.rmSync(dst, { force: true });
    execFileSync("gdrive", ["readonly", "download", byName[name].id, "--out", dst], { stdio: "inherit", shell: process.platform === "win32" });
  }
  const dbSrc = path.join(cfg, "douyin.db");
  const dbDst = path.join(REPO_ROOT, "mcp", ".data", "douyin.db");
  if (fs.existsSync(dbSrc)) {
    fs.mkdirSync(path.dirname(dbDst), { recursive: true });
    fs.copyFileSync(dbSrc, dbDst);
  }
  if (byName["assets.zip"] && !fs.existsSync(path.join(cfg, "bgm", "index.json"))) {
    const zipPath = path.join(cfg, "assets.zip");
    fs.rmSync(zipPath, { force: true });
    execFileSync("gdrive", ["readonly", "download", byName["assets.zip"].id, "--out", zipPath], { stdio: "inherit", shell: process.platform === "win32" });
    if (process.platform === "win32") {
      spawnSync("powershell", ["-Command", `Expand-Archive -Path '${zipPath}' -DestinationPath '${cfg}' -Force`], { stdio: "inherit" });
    } else {
      spawnSync("unzip", ["-oq", zipPath, "-d", cfg], { stdio: "inherit" });
    }
  }
  console.log(`✓ 已从 Google 云盘同步配置到 ${cfg}`);
} else if (cmd === "push") {
  const dbRepo = path.join(REPO_ROOT, "mcp", ".data", "douyin.db");
  if (fs.existsSync(dbRepo)) fs.copyFileSync(dbRepo, path.join(cfg, "douyin.db"));
  for (const name of ["profile.json", "strategy.md", "volc.env", "douyin.db"]) {
    const src = [path.join(REPO_ROOT, ".local", name), path.join(cfg, name)].find((p) => fs.existsSync(p));
    if (!src) continue;
    if (byName[name]) {
      execFileSync("gdrive", ["mutate", "update", byName[name].id, src], { stdio: "inherit", shell: process.platform === "win32" });
    } else {
      execFileSync("gdrive", ["mutate", "upload", src, "--parent", FOLDER_ID], { stdio: "inherit", shell: process.platform === "win32" });
    }
  }
  console.log("✓ 已将本机最新配置推送到 Google 云盘");
} else {
  die("用法: node gdrive-sync.mjs pull|push");
}
