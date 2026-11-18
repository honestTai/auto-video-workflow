"""抖音主站只读接口（精简版）。

只保留本项目用到的部分：作品详情、用户信息、综合/视频搜索，以及
builder/auth.py 与 douyin_creator_api.py 依赖的 uid / sec_uid / device_id 查询。
评论、点赞、收藏、私信、直播等写接口与 protobuf 依赖均已移除。
"""
import base64
import json
import re
import urllib.parse
import uuid

from utils import http_client as requests
requests.packages.urllib3.disable_warnings()

from builder.header import HeaderBuilder, HeaderType
from builder.params import Params
from utils.dy_util import splice_url, generate_a_bogus_pure


class SearchVerifyError(RuntimeError):
    """搜索接口返回空列表并在 search_nil_info 里要求人机验证。"""


def check_search_response(res_json, resp):
    nil_info = (res_json or {}).get("search_nil_info") or {}
    if nil_info.get("search_nil_type") == "verify_check" or nil_info.get("search_nil_item") == "verify_check":
        raise SearchVerifyError(
            "搜索触发人机验证（verify_check），请在浏览器打开抖音搜索页完成验证后重新调用 refresh_account_runtime。"
            f"logid={resp.headers.get('X-Tt-Logid')}"
        )


def check_risk_response(resp):
    """抖音风控拒绝时返回 HTTP 200 + 空 body 或 HTML 挑战页，原因只在响应头里，
    这里翻译成可读异常。直接 `resp.json()` 只会得到毫无信息量的 JSONDecodeError。
    """
    text = (resp.text or "").lstrip()
    if text.startswith("{") or text.startswith("["):
        return
    bd = resp.headers.get("X-Vc-Bdturing-Parameters")
    if bd:
        subtype = ""
        try:
            info = json.loads(base64.b64decode(bd + "=" * (-len(bd) % 4)))
            subtype = info.get("subtype", "")
        except Exception:
            pass
        raise RuntimeError(
            f"触发人机验证（bdturing {subtype or '未知类型'}）。"
            f"需在浏览器完成验证、或更换 IP / 降低请求频率后重试。logid={resp.headers.get('X-Tt-Logid')}")
    pp = resp.headers.get("X-Tt-Verify-Passport-Decision")
    if pp:
        scene = ""
        try:
            scene = json.loads(pp)["event_params"]["verify_scene"]
        except Exception:
            pass
        raise RuntimeError(
            f"需要二次身份验证（scene={scene or '未知'}）。"
            f"多为缺少 x-tt-session-dtrait 或账号风控所致。logid={resp.headers.get('X-Tt-Logid')}")
    if not text:
        raise RuntimeError(
            f"接口返回空响应（HTTP {resp.status_code}），通常是签名参数不对或被风控拦截。"
            f"logid={resp.headers.get('X-Tt-Logid')}")
    if "__ac_nonce" in text or "_$jsvmprt" in text:
        raise RuntimeError(
            f"命中 acrawler 挑战页（HTTP {resp.status_code}）。需要 __ac_signature，"
            f"该签名尚未纯算实现。logid={resp.headers.get('X-Tt-Logid')}")
    raise RuntimeError(
        f"接口返回非 JSON（HTTP {resp.status_code}），前 120 字：{text[:120]!r}。"
        f"logid={resp.headers.get('X-Tt-Logid')}")


_AWEME_ID_PATTERNS = (
    r'/(?:video|note|slides)/(\d+)',
    r'[?&]modal_id=(\d+)',
    r'[?&]aweme_id=(\d+)',
)
_URL_PATTERN = re.compile(r'https?://[^\s，。！？、）)]+')
_SHORT_HOSTS = ('v.douyin.com', 'v.iesdouyin.com')
_SHORT_LINK_UA = (
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
    '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
)


def _match_aweme_id(text: str):
    for pattern in _AWEME_ID_PATTERNS:
        matched = re.search(pattern, text)
        if matched:
            return matched.group(1)
    return None


def resolve_short_url(url: str, max_hops: int = 5) -> str:
    """跟随 v.douyin.com 短链的 3xx 跳转，返回第一个能解析出作品 ID 的地址。"""
    import requests as plain_requests

    current = url
    for _ in range(max_hops):
        response = plain_requests.get(
            current, headers={'User-Agent': _SHORT_LINK_UA},
            allow_redirects=False, timeout=15,
        )
        location = response.headers.get('Location') or response.headers.get('location')
        if not location:
            break
        current = urllib.parse.urljoin(current, location)
        if _match_aweme_id(current):
            break
    return current


def parse_aweme_id(url: str):
    """从作品标识里取 aweme_id，并归一化成 /video/ 形式的 referer。

    支持：纯数字 ID、`/video/<id>`、`/note/<id>`、`/slides/<id>`、带 `modal_id=<id>`
    的链接，以及 App 分享文案里的 `v.douyin.com` 短链（会发起一次跳转解析）。
    """
    text = str(url or '').strip()
    if text.isascii() and text.isdigit():
        aweme_id = text
    else:
        aweme_id = _match_aweme_id(text)
        if not aweme_id:
            for candidate in _URL_PATTERN.findall(text):
                host = urllib.parse.urlparse(candidate).hostname or ''
                if host in _SHORT_HOSTS:
                    aweme_id = _match_aweme_id(resolve_short_url(candidate))
                    if aweme_id:
                        break
    if not aweme_id:
        raise ValueError(f"无法从链接中解析 aweme_id: {url}")
    return aweme_id, f'https://www.douyin.com/video/{aweme_id}'


class DouyinAPI:
    douyin_url = 'https://www.douyin.com'
    creator = "https://creator.douyin.com"

    @staticmethod
    def get_work_info(auth, url: str) -> dict:
        """
        获取作品信息.
        :param auth: DouyinAuth object.
        :param url: 作品URL.
        :return: JSON.
        """
        api = f"/aweme/v1/web/aweme/detail/"
        aweme_id, url = parse_aweme_id(url)
        headers = HeaderBuilder().build(HeaderType.GET)
        headers.set_referer(url)
        headers.with_uifid(auth)
        params = Params()
        params.add_param("device_platform", "webapp")
        params.add_param("aid", "6383")
        params.add_param("channel", "channel_pc_web")
        params.add_param("aweme_id", aweme_id)
        # 实录里 aweme_id 之后紧跟这两个，缺了会少字段（2026-08-16 抓包）
        params.add_param("request_source", "600")
        params.add_param("origin_type", "video_page")
        # 公共组用 with_platform()：字段/顺序与浏览器同源接口一致，
        # 手写那版缺 pc_libra_divert / support_* ，会触发风控。
        # 但 version_code 必须回到 190500/19.5.0 —— 实录里 aweme/detail 就是这个值
        # （2026-08-22 用 browser_capture.json 做值层面对账时发现：上一轮换
        #  with_platform() 时把它一起降成了通用的 170400，属于自己引入的回退）。
        # version_code 是**按接口**取值的，不是全站一个常量：实录 63 条里
        # 59 条是 170400，但 aweme/detail=190500、aweme/post=290100、
        # general/search/single=190600，各自前端模块自带版本号。
        params.with_platform(round_trip_time='50', version_code='190500',
                             version_name='19.5.0')
        params.with_web_id(auth, url)
        params.with_uifid(auth)
        # 这个接口的 verifyFp / fp 在 msToken **之前**（各接口位置不同，以抓包为准）
        params.with_verify_fp(auth)
        params.add_param("msToken", auth.msToken)
        params.with_a_bogus()
        # 这个接口在 secsdk 的 webSign 策略表里，末尾还要带 timestamp + 签名
        resp = requests.get(params.signed_url(f'{DouyinAPI.douyin_url}{api}', auth),
                            headers=headers.get(), cookies=auth.cookie, verify=False)
        check_risk_response(resp)
        result = resp.json()
        if hasattr(auth, "main_read_verified"):
            auth.main_read_verified = True
        return result

    @staticmethod
    def get_user_info(auth, user_url: str, **kwargs) -> dict:
        """
        获取用户信息.
        :param auth: DouyinAuth object.
        :param user_url: 用户主页URL.
        :return: 用户信息.
        """
        api = f"/aweme/v1/web/user/profile/other/"
        user_id = user_url.split("/")[-1].split("?")[0]
        headers = HeaderBuilder().build(HeaderType.GET)
        headers.set_referer(user_url)
        headers.with_uifid(auth)
        params = Params()
        params.add_param("device_platform", 'webapp')
        params.add_param("aid", '6383')
        params.add_param("channel", 'channel_pc_web')
        params.add_param("publish_video_strategy_type", '2')
        params.add_param("source", 'channel_pc_web')
        params.add_param("sec_user_id", user_id)
        params.add_param("personal_center_strategy", '1')
        # 2026-08-16 用户真实 Chrome 实录：personal_center_strategy 之后还有这两个，以前全漏了
        params.add_param("profile_other_record_enable", '1')
        params.add_param("land_to", '1')
        # 公共组换 with_platform()：手写那版缺 pc_libra_divert / support_h265 / support_dash，
        # 且 round_trip_time 写死 100（实录是 0）
        params.with_platform(round_trip_time='0')
        params.with_web_id(auth, user_url)
        params.with_uifid(auth)
        params.add_param("msToken", auth.msToken)
        params.with_a_bogus()
        # 实录里 verifyFp / fp 在 a_bogus **之后**
        params.with_verify_fp(auth)
        resp = requests.get(f'{DouyinAPI.douyin_url}{api}', headers=headers.get(), cookies=auth.cookie,
                            params=params.get(), verify=False)
        check_risk_response(resp)
        return resp.json()

    @staticmethod
    def search_general_work(auth, query: str, sort_type: str = '0', publish_time: str = '0', offset: str = '0',
                            filter_duration="", search_range="", content_type="", **kwargs):
        """
        搜索综合频道作品.
        :param auth: DouyinAuth object.
        :param query: 搜索关键字.
        :param sort_type: 排序方式 0 综合排序, 1 最多点赞, 2 最新发布.
        :param publish_time: 发布时间 0 不限, 1 一天内, 7 一周内, 180 半年内.
        :param offset: 搜索结果偏移量.
        :param filter_duration: 视频时长 空字符串 不限, 0-1 一分钟内, 1-5 1-5分钟内, 5-10000 5分钟以上
        :param search_range: 搜索范围 0 不限, 1 最近看过, 2 还未看过, 3 关注的人
        :param content_type: 内容形式 0 不限, 1 视频, 2 图文
        :return: JSON数据.
        """
        api = f"/aweme/v1/web/general/search/single/"
        headers = HeaderBuilder().build(HeaderType.GET)
        refer = f'https://www.douyin.com/search/{urllib.parse.quote(query)}?aid={uuid.uuid4()}&type=general'
        headers.set_referer(refer)
        headers.with_uifid(auth)
        params = Params()
        params.add_param("device_platform", "webapp")
        params.add_param("aid", "6383")
        params.add_param("channel", "channel_pc_web")
        params.add_param("search_channel", "aweme_general")
        params.add_param("enable_history", "1")
        # 综合频道的后端不会从 is_filter_search 反推出具体条件；五个值
        # 必须作为 JSON 一起传递，否则排序/发布时间等筛选只显示为已筛选，
        # 实际结果仍按默认条件返回。
        filter_selected = json.dumps({
            "sort_type": str(sort_type),
            "publish_time": str(publish_time),
            "filter_duration": str(filter_duration),
            "search_range": str(search_range),
            "content_type": str(content_type),
        }, ensure_ascii=False, separators=(",", ":"))
        params.add_param("filter_selected", filter_selected)
        params.add_param("keyword", query)
        params.add_param("search_source", "tab_search")
        params.add_param("query_correct_type", "1")
        params.add_param("is_filter_search", '0' if not any(
            [sort_type != '0', publish_time != '0', filter_duration, search_range, content_type]) else '1')
        # from_group_id / pc_search_top_1_params / search_id 都是**空值字段**，
        # 浏览器确实发。实录顺序：is_filter_search → from_group_id → disable_rs
        params.add_param("from_group_id", "")
        params.add_param("disable_rs", "0")
        params.add_param("offset", offset)
        params.add_param("count", '15')
        params.add_param("need_filter_settings", '1' if offset == '0' else '0')
        params.add_param("list_type", "single")
        # 搜索页特有的两个：pc_search_top_1_params 是前端埋点上下文，search_id 翻页时才有值
        params.add_param("pc_search_top_1_params", '{"enable_ai_search_top_1":1}')
        params.add_param("search_id", kwargs.get("search_id", ""))
        # 公共组换 with_platform()：手写那版缺 pc_libra_divert / support_h265 / support_dash
        # 实录：search 系接口 version_code=190600/19.6.0，与主站通用的 170400 不同
        params.with_platform(round_trip_time='0', version_code='190600', version_name='19.6.0')
        params.with_web_id(auth, refer)
        params.with_uifid(auth)
        params.add_param("msToken", auth.msToken)
        # 综合搜索风控(antispam_check)只认新算法签名：纯算 a_bogus（Python 原生执行 bdms VMP）
        params.add_param('a_bogus', generate_a_bogus_pure(api, splice_url(params.get())))
        # 搜索接口的 verifyFp / fp 在 a_bogus **之后**（与评论接口相反，以抓包为准）
        params.with_verify_fp(auth)
        resp = requests.get(f'{DouyinAPI.douyin_url}{api}', headers=headers.get(), cookies=auth.cookie,
                            params=params.get(), verify=False)
        check_risk_response(resp)
        res_json = resp.json()
        check_search_response(res_json, resp)
        return res_json

    @staticmethod
    def search_some_general_work(auth, query: str, num: int, sort_type: str, publish_time: str, filter_duration="", search_range="", content_type="", **kwargs) -> list:
        """
        搜索指定数量综合频道作品.
        :param auth: DouyinAuth object.
        :param query: 搜索关键字.
        :param num: 搜索结果数量.
        :param sort_type: 排序方式 0 综合排序, 1 最多点赞, 2 最新发布.
        :param publish_time: 发布时间 0 不限, 1 一天内, 7 一周内, 180 半年内.
        :param filter_duration: 视频时长 空字符串 不限, 0-1 一分钟内, 1-5 1-5分钟内, 5-10000 5分钟以上
        :param search_range: 搜索范围 0 不限, 1 最近看过, 2 还未看过, 3 关注的人
        :param content_type: 内容形式 0 不限, 1 视频, 2 图文
        :return: 作品列表.
        """
        offset = "0"
        work_list = []
        while True:
            res_json = DouyinAPI.search_general_work(auth, query, sort_type, publish_time, offset,
                                                     filter_duration, search_range, content_type)
            data = res_json.get("data") or []
            works = [w for w in data if w.get("aweme_info")]
            work_list.extend(works)
            if res_json.get("has_more") != 1 or len(work_list) >= num or not data:
                break
            offset = str(int(offset) + len(data))
        if len(work_list) > num:
            work_list = work_list[:num]
        return work_list

    @staticmethod
    def search_video_work(auth, query: str, offset: str = '0', count: str = '16', sort_type: str = '0',
                          publish_time: str = '0', filter_duration="", search_range="0", search_id="", **kwargs):
        """
        搜索视频频道作品.
        :param auth: DouyinAuth object.
        :param query: 搜索关键字.
        :param offset: 搜索结果偏移量.
        :param count: 搜索结果数量.
        :param sort_type: 排序方式 0 综合排序 1 最多点赞 2 最新发布.
        :param publish_time: 发布时间 0 不限 1 一天内 7 一周内 180 半年内.
        :param filter_duration: 视频时长 空字符串 不限 0-1 一分钟内 1-5 1-5分钟内 5-10000 5分钟以上
        :param search_range: 搜索范围 0 不限 3 关注的人 1 最近看过 2 还未看过
        :return: 下个搜索ID, 引导词, JSON数据.
        """
        api = "/aweme/v1/web/search/item/"
        headers = HeaderBuilder().build(HeaderType.GET)
        refer = f'https://www.douyin.com/search/{urllib.parse.quote(query)}?aid={uuid.uuid4()}&type=video'
        headers.set_referer(refer)
        headers.with_uifid(auth)
        params = Params()
        params.add_param("device_platform", 'webapp')
        params.add_param("aid", '6383')
        params.add_param("channel", 'channel_pc_web')
        params.add_param("search_channel", 'aweme_video_web')
        params.add_param("enable_history", '1')
        params.add_param("sort_type", sort_type)
        params.add_param("publish_time", publish_time)
        params.add_param("filter_duration", filter_duration)
        params.add_param("search_range", search_range)
        params.add_param("keyword", query)
        params.add_param("search_source", 'normal_search')
        params.add_param("query_correct_type", '1')
        params.add_param("is_filter_search", '1')
        params.add_param("from_group_id", '')
        params.add_param("offset", offset)
        params.add_param("count", count)
        params.add_param("need_filter_settings", '1' if offset == '0' else '0')
        if search_id != "":
            params.add_param("search_id", search_id)
        params.add_param("list_type", 'single')
        # 实录：list_type 之后是 pc_search_top_1_params（空值），再进公共组
        params.add_param("pc_search_top_1_params", '')
        # with_platform() 里已经有 effective_type / round_trip_time，
        # 原来后面又 add_param 覆盖一遍（0 被改成 50），读代码时极易误判实际值。
        # 直接把想要的值作为参数传进去。
        params.with_platform(round_trip_time='50')
        params.with_web_id(auth, refer)
        params.add_param("msToken", auth.msToken)
        params.with_a_bogus()
        params.add_param("verifyFp", auth.cookie['s_v_web_id'])
        params.add_param("fp", auth.cookie['s_v_web_id'])
        resp = requests.get(f'{DouyinAPI.douyin_url}{api}', headers=headers.get(), cookies=auth.cookie,
                            params=params.get(), verify=False)
        check_risk_response(resp)
        search_id = resp.headers.get("X-Tt-Logid", "")
        json_data = resp.json()
        check_search_response(json_data, resp)
        return search_id, json_data.get("guide_search_words"), json_data

    @staticmethod
    def search_some_video_work(auth, query: str, num: int = 16, sort_type: str = '0', publish_time: str = '0',
                               filter_duration="", search_range="0", **kwargs) -> tuple:
        """
        搜索视频频道作品.
        :param auth: DouyinAuth object.
        :param query: 搜索关键字.
        :param num: 搜索结果数量.
        :param sort_type: 排序方式 0 综合排序 1 最多点赞 2 最新发布.
        :param publish_time: 发布时间 0 不限 1 一天内 7 一周内 180 半年内.
        :param filter_duration: 视频时长 空字符串 不限 0-1 一分钟内 1-5 1-5分钟内 5-10000 5分钟以上
        :param search_range: 搜索范围 0 不限 3 关注的人 1 最近看过 2 还未看过
        :return: 作品列表, 引导词.
        """
        offset = "0"
        count = "25"
        search_id = ""
        video_work_list = []
        while True:
            search_id, guide_search_words, res_json = DouyinAPI.search_video_work(auth, query, offset, count, sort_type,
                                                                                  publish_time, filter_duration,
                                                                                  search_range, search_id)
            data = res_json.get("data") or []
            video_works = [w for w in data if w.get("aweme_info")]
            video_work_list.extend(video_works)
            if res_json.get("has_more") != 1 or len(video_work_list) >= num or not data:
                break
            offset = str(int(offset) + int(count))
        if len(video_work_list) > num:
            video_work_list = video_work_list[:num]
        return video_work_list, guide_search_words

    @staticmethod
    def get_my_uid(auth, **kwargs) -> int:
        """
        获取自己的用户ID.
        :param auth: DouyinAuth object.
        :return: 用户ID.
        """
        url = 'https://www.douyin.com/aweme/v1/web/query/user/'
        headers = HeaderBuilder().build(HeaderType.GET)
        refer = 'https://www.douyin.com/'
        headers.set_header('referer', refer)
        headers.with_uifid(auth)
        params = Params()
        params.add_param('publish_video_strategy_type', '2')
        params.with_platform()
        params.with_uifid(auth)
        params.with_web_id(auth, refer)
        params.add_param('verifyFp', auth.cookie['s_v_web_id'])
        params.add_param('fp', auth.cookie['s_v_web_id'])
        params.with_a_bogus()
        resp = requests.get(url, params=params.get(), verify=False, headers=headers.get(), cookies=auth.cookie)
        check_risk_response(resp)
        resp_json = resp.json()
        return int(resp_json['user_uid'])

    @staticmethod
    def get_my_sec_uid(auth, **kwargs) -> str:
        """
        获取自己的SECID.

        主站 `/user/self` 已改成客户端渲染，HTML 里不再有 secUid（2026-08-16 复核），
        所以走创作者中心的 user/info 拿（同一套 cookie），HTML 仅作兜底。
        :param auth: DouyinAuth object.
        :return: SECID.
        """
        try:
            resp = requests.get(
                "https://creator.douyin.com/web/api/media/user/info/",
                headers={
                    "accept": "application/json, text/plain, */*",
                    "accept-language": HeaderBuilder.accept_language,
                    "referer": "https://creator.douyin.com/creator-micro/home",
                    "user-agent": HeaderBuilder.ua,
                },
                cookies=auth.cookie, verify=False, timeout=20,
            )
            sec_uid = ((resp.json() or {}).get("user") or {}).get("sec_uid")
            if sec_uid:
                return sec_uid
        except Exception:
            pass

        headers = HeaderBuilder().build(HeaderType.GET)
        response = requests.get("https://www.douyin.com/user/self", headers=headers.get(),
                                cookies=auth.cookie, params={"from_tab_name": "main"})
        found = re.findall(r'\\"secUid\\":\\"(.*?)\\"', response.text)
        if not found:
            raise RuntimeError("未取到 sec_uid：创作者接口与主站 HTML 都没拿到，请检查登录态")
        return found[0]

    @staticmethod
    def get_device_id(auth, **kwargs) -> str:
        """
        获取设备ID.
        :param auth: DouyinAuth object.
        :return: 设备ID.
        """
        url = "https://www.douyin.com/aweme/v1/web/query/user"
        headers = HeaderBuilder().build(HeaderType.GET)
        refer = "https://www.douyin.com/discover"
        headers.set_header("referer", refer)
        headers.with_uifid(auth)
        params = Params()
        (params
         .with_platform()
         .add_param("publish_video_strategy_type", "2")
         .with_web_id(auth, refer)
         .with_ms_token()
         .add_param('verifyFp', auth.cookie['s_v_web_id'])
         .add_param('fp', auth.cookie['s_v_web_id'])
         .with_a_bogus()
         )
        resp = requests.get(url, params=params.get(), verify=False, headers=headers.get(), cookies=auth.cookie)
        check_risk_response(resp)
        resp_json = resp.json()
        return resp_json['id']
