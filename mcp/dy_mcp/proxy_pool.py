import hashlib
import json
import os
from urllib.parse import urlsplit


class ProxyPool:
    def __init__(self, value=None):
        raw = os.getenv("DY_PROXY_POOL", "") if value is None else value
        self.proxies = self._parse(raw)

    @staticmethod
    def _parse(value):
        text = str(value or "").strip()
        if not text:
            return []
        if text.startswith("["):
            try:
                items = json.loads(text)
            except json.JSONDecodeError as error:
                raise ValueError("DY_PROXY_POOL 必须是 JSON 数组或逗号分隔的代理地址") from error
            if not isinstance(items, list) or not all(isinstance(item, str) for item in items):
                raise ValueError("DY_PROXY_POOL JSON 数组只能包含代理地址字符串")
        else:
            items = text.split(",")
        proxies = []
        for item in items:
            proxy = item.strip()
            if not proxy:
                continue
            parsed = urlsplit(proxy)
            if parsed.scheme not in {"http", "https", "socks4", "socks5", "socks5h"} or not parsed.hostname:
                raise ValueError("代理地址必须包含受支持的协议和主机名")
            if proxy not in proxies:
                proxies.append(proxy)
        return proxies

    def for_session(self, session_key):
        if not self.proxies:
            return None
        digest = hashlib.sha256(str(session_key).encode("utf-8")).digest()
        index = int.from_bytes(digest[:8], "big") % len(self.proxies)
        return self.proxies[index]

    @staticmethod
    def request_config(proxy):
        if not proxy:
            return None
        return {"http": proxy, "https": proxy}

    @staticmethod
    def display_name(proxy):
        if not proxy:
            return "direct"
        parsed = urlsplit(proxy)
        host = parsed.hostname or "unknown"
        return f"{host}:{parsed.port}" if parsed.port else host
