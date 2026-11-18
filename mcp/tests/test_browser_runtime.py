import json

from dy_mcp import browser_runtime


def wrapped(value):
    return json.dumps({"data": json.dumps(value)})


def test_cookie_header_prefers_shared_domain_over_creator_host():
    header = browser_runtime.cookie_header([
        {"name": "csrf", "value": "creator", "domain": "creator.douyin.com"},
        {"name": "csrf", "value": "shared", "domain": ".douyin.com"},
        {"name": "sessionid", "value": "s", "domain": ".douyin.com"},
        {"name": "other", "value": "x", "domain": ".example.com"},
    ])

    assert header == "csrf=shared; sessionid=s"


def test_build_runtime_uses_browser_material():
    fingerprint = {
        "ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/157.0.0.0",
        "platform": "MacIntel",
        "languages": ["zh-CN", "en-US"],
        "cpu": 10,
        "memory": 16,
        "screen": {"width": 1728, "height": 1117, "availWidth": 1728, "availHeight": 1005},
        "window": {"innerWidth": 1728, "innerHeight": 862, "outerWidth": 1728, "outerHeight": 1005},
        "webgl": {"vendor": "Apple", "renderer": "M1 Pro"},
    }
    credentials = {
        "web": wrapped({"ticket": "ticket", "ts_sign": "sign", "client_cert": "cert"}),
        "keys": wrapped({"ec_privateKey": "private"}),
        "dtrait": "blob",
    }

    env, info = browser_runtime.build_runtime("sessionid=secret", fingerprint, credentials, {"browser_type": "chrome"})

    assert env["DY_COOKIES"] == "sessionid=secret"
    assert env["DY_FP_OS_NAME"] == "macOS"
    assert env["DY_FP_BROWSER_VERSION"] == "157.0.0.0"
    assert env["DY_DTRAIT_BLOB"] == "blob"
    assert info["platform"] == "MacIntel"
