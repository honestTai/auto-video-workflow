"""用已保存的账号凭证构造接口会话（DouyinAuth）。"""
import os
import sys
import threading

from .proxy_pool import ProxyPool


SECURITY_FIELDS = {
    "ticket": "DY_TICKET",
    "ts_sign": "DY_TS_SIGN",
    "client_cert": "DY_CLIENT_CERT",
    "private_key": "DY_PRIVATE_KEY",
    "dtrait_blob": "DY_DTRAIT_BLOB",
}


def apply_runtime_env(runtime_env):
    """把账号凭证与设备指纹写进进程环境，并让已加载的签名模块重新读取。

    签名模块会从环境里读指纹（DY_FP_*）和 Cookie 里的 ttwid，且指纹是进程级缓存；
    换凭证前先清掉旧值，避免不同浏览器的指纹混用。
    """
    stale = [key for key in os.environ if key.startswith("DY_FP_")]
    stale += [key for key in ("DY_COOKIES", *SECURITY_FIELDS.values()) if key in os.environ]
    for key in stale:
        del os.environ[key]
    for key, value in runtime_env.items():
        if key.startswith("DY_") and value not in (None, ""):
            os.environ[key] = str(value)
    fingerprint = sys.modules.get("utils.fingerprint")
    if fingerprint is not None:
        fingerprint._profile = None
        profile = fingerprint.get_profile()
        header = sys.modules.get("builder.header")
        if header is not None:
            builder = header.HeaderBuilder
            builder.ua = profile["ua"]
            builder.sec_ch_ua = profile["sec_ch_ua"]
            builder.sec_ch_ua_platform = profile["sec_ch_ua_platform"]
            builder.accept_language = profile["accept_language"]


class DouyinSession:
    """单账号会话：读接口和发布接口共用一个 Auth，凭证更新后自动重建。"""

    def __init__(self, store, auth_factory=None):
        self.store = store
        self.auth_factory = auth_factory
        self._pool = ProxyPool()
        self._auth = None
        self._saved_at = None
        self._proxies = None
        self._lock = threading.Lock()

    def _factory(self):
        if self.auth_factory is None:
            from builder.auth import DouyinAuth
            self.auth_factory = DouyinAuth.from_cookie
        return self.auth_factory

    def get_auth(self, creator=False):
        """返回 (auth, proxies)。creator=True 时额外初始化创作者中心会话（发布用）。"""
        with self._lock:
            runtime = self.store.get_runtime()
            if not runtime:
                raise RuntimeError("尚未保存登录凭证，请先调用 refresh_account_runtime 从浏览器采集")
            env = runtime["env"]
            cookie = (env.get("DY_COOKIES") or "").strip()
            if not cookie:
                raise RuntimeError("已保存的凭证里没有 Cookie，请重新调用 refresh_account_runtime")
            if self._auth is None or self._saved_at != runtime["saved_at"]:
                self.close()
                apply_runtime_env(env)
                proxy = self.store.account_proxy() or env.get("DY_PROXY_URL") or self._pool.for_session(cookie)
                self._proxies = ProxyPool.request_config(proxy)
                security = {field: env.get(name) or None for field, name in SECURITY_FIELDS.items()}
                self._auth = self._factory()(
                    cookie, bootstrap_creator=creator, proxies=self._proxies, **security,
                )
                self._saved_at = runtime["saved_at"]
            elif creator and not getattr(self._auth, "creator_bootstrapped", False):
                self._auth.bootstrap_creator_session(proxies=self._proxies)
            return self._auth, self._proxies

    def close(self):
        if self._auth is not None:
            try:
                self._auth.close()
            except Exception:
                pass
        self._auth = None
        self._saved_at = None
