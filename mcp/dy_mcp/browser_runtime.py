"""从已登录的本机 Chrome 采集抖音登录凭证。

两种连接方式，采集到的内容相同（Cookie、ticket/ts_sign、浏览器私钥、dtrait、设备指纹）：
  chrome     通过 Chrome 远程调试端口（CDP），需要用 --remote-debugging-port 启动 Chrome
  webbridge  通过本机浏览器扩展桥（127.0.0.1:10086），直接复用日常使用的 Chrome
"""
import json
import os
import re
import time
import urllib.request

from .store import DEFAULT_CDP_URL


DOUYIN_URL = "https://www.douyin.com/user/self?from_tab_name=main"
CREATOR_URL = "https://creator.douyin.com/"
# 主站和创作者中心的 Cookie 一次抓全：发布接口两边的都要
COOKIE_URLS = [DOUYIN_URL, CREATOR_URL]
WEBBRIDGE_ENDPOINT = "http://127.0.0.1:10086/command"
WEBBRIDGE_SESSION = "douyin-video-mcp"

DTRAIT_HOOK = r"""
(() => {
  const calls = [];
  Object.defineProperty(window, "__dtraitCalls", {value: calls, configurable: true});
  let sdk;
  const wrap = obj => {
    if (!obj || obj.__dtraitWrapped) return;
    try {
      const original = obj.encryptData;
      if (typeof original !== "function") return;
      obj.encryptData = function(...args) {
        try {
          calls.push(args.map(arg => typeof arg === "string" ? arg : String(arg)));
        } catch (error) {}
        return original.apply(this, args);
      };
      Object.defineProperty(obj, "__dtraitWrapped", {value: true});
    } catch (error) {}
  };
  Object.defineProperty(window, "DTraitUcAesEncrypt", {
    configurable: true,
    get() { return sdk; },
    set(value) { sdk = value; wrap(value); }
  });
})();
"""

FINGERPRINT_SCRIPT = r"""
(() => {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl");
  const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
  return JSON.stringify({
    ua: navigator.userAgent,
    platform: navigator.platform,
    languages: navigator.languages,
    language: navigator.language,
    cpu: navigator.hardwareConcurrency,
    memory: navigator.deviceMemory || 8,
    screen: {
      width: screen.width, height: screen.height,
      availWidth: screen.availWidth, availHeight: screen.availHeight
    },
    window: {
      innerWidth, innerHeight, outerWidth, outerHeight,
      dpr: devicePixelRatio
    },
    webgl: {
      vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : "",
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ""
    }
  });
})()
"""

CREDENTIAL_SCRIPT = r"""
(() => {
  const calls = (window.__dtraitCalls || []).map(args => {
    try { return JSON.parse(args[1]); } catch (error) { return null; }
  }).filter(Boolean);
  const central = calls.find(item => item.sdkVersion && item.dtrait);
  return JSON.stringify({
    web: localStorage.getItem("security-sdk/s_sdk_sign_data_key/web_protect"),
    keys: localStorage.getItem("security-sdk/s_sdk_crypt_sdk"),
    dtrait: central ? central.dtrait : "",
    callCount: calls.length
  });
})()
"""


class CDPClient:
    def __init__(self, ws_url):
        import websocket

        self.socket = websocket.create_connection(ws_url, timeout=30, suppress_origin=True)
        self.next_id = 0

    def call(self, method, params=None, session_id=""):
        self.next_id += 1
        request_id = self.next_id
        payload = {"id": request_id, "method": method, "params": params or {}}
        if session_id:
            payload["sessionId"] = session_id
        self.socket.send(json.dumps(payload))
        deadline = time.monotonic() + 35
        while time.monotonic() < deadline:
            response = json.loads(self.socket.recv())
            if response.get("id") != request_id:
                continue
            if "error" in response:
                raise RuntimeError(f"CDP {method} 失败: {response['error']}")
            return response.get("result", {})
        raise TimeoutError(f"CDP {method} 超时")

    def close(self):
        self.socket.close()


def _decode_wrapped(value, label):
    if not value:
        raise RuntimeError(f"浏览器里缺少 {label}，请先在该浏览器完成抖音登录")
    outer = json.loads(value)
    return json.loads(outer["data"])


def _accept_language(languages):
    if not languages:
        return "zh-CN,zh;q=0.9"
    return ",".join(
        language if index == 0 else f"{language};q={max(0.1, 0.9 - index * 0.1):.1f}"
        for index, language in enumerate(languages)
    )


def cookie_header(cookies):
    """把浏览器 Cookie 列表拼成请求头。

    主站与创作者中心有同名 Cookie 时保留共享域（.douyin.com）的那个；
    creator.douyin.com 的 host-only 副本由发布会话初始化时重新获取。
    """
    chosen = {}
    for item in cookies:
        name = item.get("name")
        domain = str(item.get("domain") or "").lower()
        if not name or "douyin" not in domain:
            continue
        priority = 0 if domain.lstrip(".").startswith("creator.") else 1
        if name not in chosen or priority > chosen[name][0]:
            chosen[name] = (priority, item.get("value", ""))
    return "; ".join(f"{name}={value}" for name, (_priority, value) in chosen.items())


def build_runtime(cookie, fingerprint, credentials, runtime_info):
    """把采集到的浏览器素材整理成凭证环境变量 + 可展示的环境信息。"""
    if "sessionid=" not in cookie and "sessionid_ss=" not in cookie:
        raise RuntimeError("该浏览器尚未登录抖音")
    if not credentials.get("dtrait"):
        raise RuntimeError("未能从浏览器安全 SDK 获取 dtrait，请刷新抖音页面后重试")
    web = _decode_wrapped(credentials.get("web"), "ticket/ts_sign")
    keys = _decode_wrapped(credentials.get("keys"), "浏览器私钥")
    ua = fingerprint["ua"]
    browser_version = re.search(r"Chrome/([\d.]+)", ua)
    platform = fingerprint.get("platform", "Win32")
    if platform == "MacIntel":
        os_name = "macOS"
        os_version = re.search(r"Mac OS X ([\d_]+)", ua)
        os_version = os_version.group(1).replace("_", ".") if os_version else "10.15.7"
    elif platform.startswith("Win"):
        os_name, os_version = "Windows", "10"
    else:
        os_name, os_version = platform, ""
    screen = fingerprint["screen"]
    window = fingerprint["window"]
    version = browser_version.group(1) if browser_version else ""
    env = {
        "DY_COOKIES": cookie,
        "DY_TICKET": web["ticket"],
        "DY_TS_SIGN": web["ts_sign"],
        "DY_CLIENT_CERT": web["client_cert"],
        "DY_PRIVATE_KEY": keys["ec_privateKey"],
        "DY_DTRAIT_BLOB": credentials["dtrait"],
        "DY_FP_UA": ua,
        "DY_FP_BROWSER_VERSION": version,
        "DY_FP_ENGINE_VERSION": version,
        "DY_FP_OS_NAME": os_name,
        "DY_FP_OS_VERSION": os_version,
        "DY_FP_PLATFORM": platform,
        "DY_FP_CPU_CORE_NUM": str(fingerprint["cpu"]),
        "DY_FP_DEVICE_MEMORY": str(fingerprint["memory"]),
        "DY_FP_SCREEN_WIDTH": str(screen["width"]),
        "DY_FP_SCREEN_HEIGHT": str(screen["height"]),
        "DY_FP_INNER_WIDTH": str(window["innerWidth"]),
        "DY_FP_INNER_HEIGHT": str(window["innerHeight"]),
        "DY_FP_OUTER_WIDTH": str(window["outerWidth"]),
        "DY_FP_OUTER_HEIGHT": str(window["outerHeight"]),
        "DY_FP_AVAIL_WIDTH": str(screen["availWidth"]),
        "DY_FP_AVAIL_HEIGHT": str(screen["availHeight"]),
        "DY_FP_WEBGL_VENDOR": fingerprint["webgl"]["vendor"],
        "DY_FP_WEBGL_RENDERER": fingerprint["webgl"]["renderer"],
        "DY_FP_ACCEPT_LANGUAGE": _accept_language(fingerprint.get("languages", [])),
    }
    runtime_info.update({
        "browser_version": version,
        "os_name": os_name,
        "platform": platform,
    })
    return env, runtime_info


def _poll_credentials(evaluate):
    credentials = {}
    for _ in range(20):
        time.sleep(0.5)
        credentials = json.loads(evaluate(CREDENTIAL_SCRIPT) or "{}")
        if credentials.get("dtrait"):
            break
    return credentials


def collect_chrome(cdp_url=""):
    """通过 Chrome 远程调试端口采集；会临时打开一个抖音标签页，采集完自动关闭。"""
    cdp_url = cdp_url or os.getenv("DOUYIN_CDP_URL") or DEFAULT_CDP_URL
    if cdp_url.startswith("http"):
        try:
            with urllib.request.urlopen(cdp_url.rstrip("/") + "/json/version", timeout=10) as response:
                cdp_url = json.load(response)["webSocketDebuggerUrl"]
        except OSError as error:
            raise RuntimeError(
                f"连不上 Chrome 远程调试端口 {cdp_url}：请用 --remote-debugging-port 启动 Chrome，"
                "或把账号的 browser_type 设为 webbridge"
            ) from error
    client = CDPClient(cdp_url)
    target_id = ""
    try:
        target = client.call("Target.createTarget", {"url": DOUYIN_URL})
        target_id = target["targetId"]
        attached = client.call("Target.attachToTarget", {"targetId": target_id, "flatten": True})
        session_id = attached["sessionId"]

        def evaluate(script):
            result = client.call(
                "Runtime.evaluate", {"expression": script, "returnByValue": True}, session_id,
            )
            return result.get("result", {}).get("value")

        client.call("Page.addScriptToEvaluateOnNewDocument", {"source": DTRAIT_HOOK}, session_id)
        client.call("Page.reload", {"ignoreCache": False}, session_id)
        credentials = _poll_credentials(evaluate)
        fingerprint = json.loads(evaluate(FINGERPRINT_SCRIPT) or "{}")
        result = client.call("Network.getCookies", {"urls": COOKIE_URLS}, session_id)
        header = cookie_header(result.get("cookies", []))
    finally:
        if target_id:
            client.call("Target.closeTarget", {"targetId": target_id})
        client.close()
    return build_runtime(header, fingerprint, credentials, {
        "browser_type": "chrome",
        "connection": cdp_url.split("?")[0],
    })


def webbridge_command(action, args=None):
    payload = {"action": action, "args": args or {}, "session": WEBBRIDGE_SESSION}
    request = urllib.request.Request(
        WEBBRIDGE_ENDPOINT,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=40) as response:
            result = json.load(response)
    except OSError as error:
        raise RuntimeError("连不上本机浏览器扩展桥（127.0.0.1:10086），请确认扩展和守护进程已启动") from error
    if not result.get("ok"):
        raise RuntimeError(result.get("error", {}).get("message", "浏览器扩展桥调用失败"))
    return result["data"]


def collect_webbridge():
    """通过本机浏览器扩展桥采集，直接复用日常使用的 Chrome 登录态。"""
    try:
        webbridge_command("find_tab", {"url": DOUYIN_URL})
    except RuntimeError:
        webbridge_command("navigate", {"url": DOUYIN_URL, "newTab": True, "group_title": "抖音账号"})
    webbridge_command("cdp", {
        "method": "Page.addScriptToEvaluateOnNewDocument",
        "params": {"source": DTRAIT_HOOK},
    })
    webbridge_command("cdp", {"method": "Page.reload", "params": {"ignoreCache": False}})
    credentials = _poll_credentials(
        lambda script: webbridge_command("evaluate", {"code": script}).get("value")
    )
    fingerprint = json.loads(webbridge_command("evaluate", {"code": FINGERPRINT_SCRIPT})["value"])
    result = webbridge_command("cdp", {"method": "Network.getCookies", "params": {"urls": COOKIE_URLS}})
    header = cookie_header(result.get("cookies", []))
    return build_runtime(header, fingerprint, credentials, {
        "browser_type": "webbridge",
        "connection": "http://127.0.0.1:10086",
    })


def collect_runtime(account):
    """按账号绑定的连接方式采集凭证，返回 (凭证环境变量, 环境信息)。"""
    browser_type = account.get("browser_type") or "chrome"
    if browser_type == "chrome":
        return collect_chrome(account.get("cdp_url") or "")
    if browser_type == "webbridge":
        return collect_webbridge()
    raise ValueError(f"不支持的浏览器连接方式: {browser_type}")
