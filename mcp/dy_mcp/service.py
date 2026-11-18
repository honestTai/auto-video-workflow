"""MCP 工具和命令行共用的业务层：账号凭证、搜索、作品详情、下载、发布。"""
import re
from pathlib import Path

from .session import DouyinSession
from .store import ROOT, AccountStore


TITLE_LIMIT = 20
SORT_TYPES = {"0": "综合排序", "1": "最多点赞", "2": "最新发布"}
PUBLISH_TIMES = {"0": "不限", "1": "一天内", "7": "一周内", "180": "半年内"}
CREATOR_SORTS = {"latest": "最新发布", "play": "最多播放", "like": "最多点赞", "comment": "最多评论"}
VISIBILITY = {0: "公开", 1: "仅自己可见", 2: "好友可见"}


def extract_item_id(value):
    """从作品数字 ID、抖音视频链接、modal_id 或创作者详情链接里提取作品 ID。"""
    text = str(value or "").strip()
    if text.isdigit():
        return text
    match = re.search(r"(?:video/|modal_id=|work-detail/)(\d{10,25})", text)
    if match:
        return match.group(1)
    raise ValueError("需要传入纯数字作品 ID 或含 /video/<id>、modal_id=<id> 的链接")


def js_length(text):
    """按 UTF-16 code unit 计长度，和抖音前端的字数统计一致。"""
    return len(str(text).encode("utf-16-le")) // 2


def truncate_title(title, limit=TITLE_LIMIT):
    result = ""
    for char in title:
        if js_length(result + char) > limit:
            break
        result += char
    return result.rstrip()


def normalize_tags(tags):
    """把 ["AI", "#MCP", "AI"] 规范成去重后的 ["#AI", "#MCP"]。"""
    result = []
    for tag in tags or []:
        for part in re.split(r"[\s,，]+", str(tag)):
            name = part.strip().lstrip("#＃").strip()
            if name and f"#{name}" not in result:
                result.append(f"#{name}")
    return result


def build_publish_text(title, desc="", tags=None):
    """组装发布文案，返回 (item_title, desc)。

    创作者中心的标题最多 20 个字符：超长时把完整标题放到简介第一段，标题截断到 20 字以内。
    标签规范成 `#标签` 追加到简介末尾，简介里已经有的不重复追加。
    """
    title = str(title or "").strip()
    desc = str(desc or "").strip()
    if not title:
        raise ValueError("title 不能为空")
    item_title = title
    if js_length(title) > TITLE_LIMIT:
        item_title = truncate_title(title)
        if title not in desc:
            desc = f"{title}\n{desc}".strip()
    existing = set(re.findall(r"#[^\s#]+", desc))
    extra = [tag for tag in normalize_tags(tags) if tag not in existing]
    if extra:
        desc = f"{desc} {' '.join(extra)}".strip()
    return item_title, desc


class DouyinService:
    def __init__(self, store=None, session=None, api=None, creator_api=None, runtime_collector=None):
        self.store = store or AccountStore()
        self.session = session or DouyinSession(self.store)
        self._api = api
        self._creator_api = creator_api
        self._runtime_collector = runtime_collector

    # 签名模块在导入时读取设备指纹，必须等 session 写好环境变量之后再导入
    @property
    def api(self):
        if self._api is None:
            from dy_apis.douyin_api import DouyinAPI
            self._api = DouyinAPI
        return self._api

    @property
    def creator_api(self):
        if self._creator_api is None:
            from dy_apis.douyin_creator_api import DouyinCreatorAPI
            self._creator_api = DouyinCreatorAPI
        return self._creator_api

    # ---------- 账号凭证 ----------
    def account_status(self):
        account = self.store.get_account()
        if account is None:
            return {"bound": False, "message": "尚未绑定账号：先调用 set_account，再调用 refresh_account_runtime"}
        return {"bound": True, "account": account}

    def set_account(self, name, browser_type="chrome", cdp_url="", proxy_url=""):
        account = self.store.set_account(name, browser_type, cdp_url, proxy_url)
        return {"status": "saved", "account": account}

    def refresh_runtime(self):
        account = self.store.get_account()
        if account is None:
            raise ValueError("尚未绑定账号，请先调用 set_account")
        collector = self._runtime_collector
        if collector is None:
            from .browser_runtime import collect_runtime
            collector = collect_runtime
        runtime_env, runtime_info = collector(account)
        saved_at = self.store.save_runtime(runtime_env, runtime_info)
        self.store.set_account_status("active")
        self.session.close()
        return {
            "status": "saved",
            "account_name": account["name"],
            "runtime_saved_at": saved_at,
            "runtime_info": runtime_info,
            "message": "登录凭证已保存；后续搜索和发布直接复用，失效时重新调用本工具",
        }

    def import_db(self, source_db, account=""):
        imported = self.store.import_from(source_db, account)
        self.session.close()
        return {"status": "imported", "account": imported}

    # ---------- 搜索与作品 ----------
    def search_videos(self, keyword, limit=10, sort_type="0", publish_time="0", filter_duration=""):
        from utils.data_util import summarize_work

        keyword = str(keyword or "").strip()
        sort_type, publish_time = str(sort_type), str(publish_time)
        if not keyword:
            raise ValueError("keyword 不能为空")
        if not 1 <= int(limit) <= 50:
            raise ValueError("limit 必须在 1 到 50 之间")
        if sort_type not in SORT_TYPES:
            raise ValueError("sort_type 只支持 0 综合排序、1 最多点赞、2 最新发布")
        if publish_time not in PUBLISH_TIMES:
            raise ValueError("publish_time 只支持 0 不限、1 一天内、7 一周内、180 半年内")
        auth, _proxies = self.session.get_auth()
        from dy_apis.douyin_api import SearchVerifyError

        # 优先走综合频道（筛选字段更全）；若综合频道命中 verify_check，回退到视频频道搜索接口
        try:
            items = self.api.search_some_general_work(
                auth, keyword, int(limit), sort_type, publish_time, filter_duration, "", "1",
            )
        except SearchVerifyError:
            if not hasattr(self.api, "search_some_video_work"):
                raise
            items, _guide = self.api.search_some_video_work(
                auth, keyword, int(limit), sort_type, publish_time, filter_duration, "0",
            )
        videos = [
            info for item in items if item.get("aweme_info")
            and (info := summarize_work(item["aweme_info"]))["type"] == "video"
        ][:int(limit)]
        return {
            "keyword": keyword,
            "sort": SORT_TYPES[sort_type],
            "publish_time": PUBLISH_TIMES[publish_time],
            "count": len(videos),
            "videos": videos,
        }

    def _work_detail(self, url):
        auth, _proxies = self.session.get_auth()
        result = self.api.get_work_info(auth, url)
        detail = result.get("aweme_detail")
        if not detail:
            reason = (result.get("filter_detail") or {}).get("detail_msg") or result.get("status_msg") or "作品不存在或不可见"
            raise RuntimeError(f"没有取到作品详情: {reason}")
        return detail

    def get_video_info(self, url):
        from utils.data_util import summarize_work

        return summarize_work(self._work_detail(url))

    def download_video(self, url, output_dir=""):
        from utils.data_util import download_file, summarize_work, video_urls

        detail = self._work_detail(url)
        info = summarize_work(detail)
        if info["type"] != "video":
            raise ValueError("这是一条图文作品，没有可下载的视频")
        urls = video_urls(detail)
        if not urls:
            raise RuntimeError("作品里没有可用的视频地址")
        folder = Path(output_dir).expanduser() if output_dir else ROOT / ".data" / "downloads"
        path = (folder / f"{info['aweme_id']}.mp4").resolve()
        error = None
        for candidate in urls:
            try:
                size = download_file(candidate, str(path))
                return {"status": "downloaded", "path": str(path), "size_bytes": size, "video": info}
            except Exception as failure:  # 一个 CDN 地址失败就换下一个
                error = failure
        raise RuntimeError(f"视频下载失败: {error}")

    # ---------- 发布 ----------
    def publish_video(self, video, title, desc="", tags=None, cover="", visibility=0,
                      allow_download=True, timing=None, dry_run=False):
        video_path = Path(str(video or "")).expanduser().resolve()
        if not video_path.is_file() or video_path.stat().st_size <= 0:
            raise FileNotFoundError(f"视频文件不存在或为空: {video_path}")
        cover_path = None
        if cover:
            cover_path = Path(str(cover)).expanduser().resolve()
            if not cover_path.is_file():
                raise FileNotFoundError(f"封面文件不存在: {cover_path}")
        if int(visibility) not in VISIBILITY:
            raise ValueError("visibility 只支持 0 公开、1 仅自己可见、2 好友可见")
        if timing is not None and int(timing) <= 0:
            raise ValueError("timing 需要是秒级时间戳")
        item_title, description = build_publish_text(title, desc, tags)
        account = self.store.get_account()
        if account is None:
            raise ValueError("尚未绑定账号，请先调用 set_account 和 refresh_account_runtime")

        base = {
            "account_name": account["name"],
            "video": str(video_path),
            "cover": str(cover_path) if cover_path else "",
            "item_title": item_title,
            "desc": description,
            "visibility": VISIBILITY[int(visibility)],
            "timing": timing,
            "dry_run": bool(dry_run),
        }
        record = dict(
            video_path=video_path, cover_path=cover_path, item_title=item_title,
            description=description, visibility=int(visibility), timing=timing, dry_run=dry_run,
        )
        auth, proxies = self.session.get_auth(creator=True)
        if dry_run:
            self.creator_api._require_publish_security(auth)
            self.store.add_publication(status="dry_run", **record)
            return {**base, "status": "dry_run", "message": "文件与发布凭证校验通过，未上传"}

        success, message, response = self.creator_api.post_video(
            auth, video=str(video_path), title=item_title, desc=description,
            visibility=int(visibility), allow_download=bool(allow_download), timing=timing,
            cover=str(cover_path) if cover_path else None, proxies=proxies,
        )
        aweme_id = str((response or {}).get("item_id") or "")
        url = f"https://www.douyin.com/video/{aweme_id}" if aweme_id else ""
        if not success:
            self.store.add_publication(status="failed", error=message, **record)
            self.store.set_account_status("error", message)
            return {**base, "status": "failed", "error": message}
        self.store.add_publication(status="published", aweme_id=aweme_id, url=url, **record)
        self.store.set_account_status("active")
        return {**base, "status": "published", "aweme_id": aweme_id, "url": url, "message": message}

    def list_publications(self, limit=20):
        if not 1 <= int(limit) <= 200:
            raise ValueError("limit 必须在 1 到 200 之间")
        records = self.store.list_publications(limit)
        return {"count": len(records), "publications": records}

    # ---------- 账号播放数据与作品诊断 ----------
    def get_account_analytics(self, limit=10, sort_by="latest", min_views=20):
        """拉取本账号近期作品的播放数据（含 2s/5s 跳出率、完播率、均播时长、互动与吸粉率）及短板诊断。"""
        from utils.data_util import summarize_creator_item, summarize_creator_overview

        sort_key = str(sort_by or "latest").strip()
        if sort_key not in CREATOR_SORTS:
            raise ValueError("sort_by 只支持 latest、play、like、comment")
        if not 1 <= int(limit) <= 50:
            raise ValueError("limit 必须在 1 到 50 之间")
        if int(min_views) < 0:
            raise ValueError("min_views 不能小于 0")
        account = self.store.get_account()
        if account is None:
            raise ValueError("尚未绑定账号，请先调用 set_account 和 refresh_account_runtime")

        auth, proxies = self.session.get_auth(creator=True)
        raw_items = self.creator_api.get_creator_item_list(
            auth, count=int(limit), sort_by=sort_key, proxies=proxies,
        )
        works = [summarize_creator_item(item) for item in raw_items]
        overview = summarize_creator_overview(works, min_views=int(min_views))
        return {
            "account_name": account["name"],
            "sort": CREATOR_SORTS[sort_key],
            "count": len(works),
            "overview": overview,
            "works": works,
        }

    def get_video_diagnosis(self, item_id):
        """拉取本账号单条作品相对近期同类作品的诊断对比（2s/5s 跳出率、完播率等）及流量来源占比。"""
        from utils.data_util import summarize_item_diagnosis

        aweme_id = extract_item_id(item_id)
        account = self.store.get_account()
        if account is None:
            raise ValueError("尚未绑定账号，请先调用 set_account 和 refresh_account_runtime")

        auth, proxies = self.session.get_auth(creator=True)
        compare_resp = self.creator_api.get_creator_item_compare(auth, aweme_id, proxies=proxies)
        try:
            source_resp = self.creator_api.get_creator_item_play_source(auth, aweme_id, proxies=proxies)
        except Exception:
            source_resp = None
        return {
            "account_name": account["name"],
            **summarize_item_diagnosis(compare_resp, source_resp),
        }
