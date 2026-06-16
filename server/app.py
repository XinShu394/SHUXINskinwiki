"""
砖皮百科 · API 服务
运行方式：python app.py
数据库：同目录下 comments.db（SQLite，自动创建）
"""
import json
import logging
import os
import random
import re
import shutil
import sqlite3
import time
import uuid
from pathlib import Path

from flask import Flask, request, jsonify, send_file, g
from flask_cors import CORS
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

logging.basicConfig(
    level=os.environ.get("ZPBK_LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("zpbk.api")

# ── 常量 ──────────────────────────────────────────────────
DB_PATH    = os.path.join(os.path.dirname(__file__), "comments.db")
ROOT       = Path(__file__).resolve().parent.parent
UPLOAD_DIR = Path(__file__).resolve().parent / "uploads" / "pending"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ADMIN_TOKEN    = os.environ.get("ZPBK_ADMIN_TOKEN", "")
MAX_FILE_BYTES = 20 * 1024 * 1024
app.config["MAX_CONTENT_LENGTH"] = 30 * 1024 * 1024
UPLOAD_STORAGE_MODE = os.environ.get("UPLOAD_STORAGE_MODE", "oss").strip().lower() or "oss"

OSS_BUCKET = os.environ.get("OSS_BUCKET", "skinwiki")
OSS_ENDPOINT = os.environ.get("OSS_ENDPOINT", "https://oss-cn-guangzhou.aliyuncs.com")
OSS_REGION = os.environ.get("OSS_REGION", "oss-cn-guangzhou")
OSS_PENDING_PREFIX = os.environ.get("OSS_PENDING_PREFIX", "pending")

STS_REGION_ID = os.environ.get("ALIYUN_REGION_ID", "cn-guangzhou")
STS_ROLE_ARN = os.environ.get("ALIYUN_STS_ROLE_ARN", "")
STS_SESSION_SECONDS = int(os.environ.get("ALIYUN_STS_DURATION_SECONDS", "600"))
STS_AK_ID = os.environ.get("ALIYUN_STS_ACCESS_KEY_ID", "")
STS_AK_SECRET = os.environ.get("ALIYUN_STS_ACCESS_KEY_SECRET", "")

# ── parse 辅助（approve 时计算 skin_id，避免命名不一致）──────
def _compute_skin_id(weapon: str, folder_code: str) -> str | None:
    """从 weapon + folder_code 推导 skin_id。ASVAL 序号依赖全量目录，返回 None（用 slot.png 兜底）。"""
    import sys as _sys
    _scripts = str(ROOT / "scripts")
    if _scripts not in _sys.path:
        _sys.path.insert(0, _scripts)
    try:
        from validate_and_build import load_weapon_rules, parse_folder  # type: ignore
        _config = ROOT / "scripts" / "config" / "weapon_rules.json"
        rules = load_weapon_rules(_config)
        rule = next((r for r in rules if r.weapon == weapon), None)
        if not rule or rule.mode == "asval":
            return None
        return parse_folder(rule, folder_code).skin_id
    except Exception:
        return None


# ── 频率限制 ──────────────────────────────────────────────
_rate:        dict = {}   # 评论用：ip -> [ts, ...]
_submit_rate: dict = {}   # 投稿用：ip -> [ts, ...]

RATE_WINDOW   = 60
RATE_LIMIT    = 5
SUBMIT_WINDOW = 86400
SUBMIT_LIMIT  = 10

def _is_limited(store: dict, ip: str, window: int, limit: int) -> bool:
    now = time.time()
    ts  = [t for t in store.get(ip, []) if now - t < window]
    if len(ts) >= limit:
        store[ip] = ts
        return True
    ts.append(now)
    store[ip] = ts
    return False

@app.before_request
def before_request():
    g.request_id = request.headers.get("X-Request-Id", "") or uuid.uuid4().hex[:12]
    g.started_at = time.time()

@app.after_request
def after_request(resp):
    request_id = getattr(g, "request_id", "-")
    started_at = getattr(g, "started_at", time.time())
    cost_ms = int((time.time() - started_at) * 1000)
    ip = get_ip()
    resp.headers["X-Request-Id"] = request_id
    logger.info(
        "rid=%s ip=%s %s %s -> %s (%dms)",
        request_id,
        ip,
        request.method,
        request.path,
        resp.status_code,
        cost_ms,
    )
    return resp

@app.errorhandler(RequestEntityTooLarge)
def handle_large_body(_e):
    return jsonify({
        "error": "请求体过大，请压缩图片后重试（单图<=20MB）",
        "requestId": getattr(g, "request_id", "-"),
    }), 413

@app.errorhandler(HTTPException)
def handle_http_exception(e: HTTPException):
    if not request.path.startswith("/api/"):
        return e
    return jsonify({
        "error": e.description or "请求失败",
        "requestId": getattr(g, "request_id", "-"),
    }), e.code

@app.errorhandler(Exception)
def handle_unexpected_error(e: Exception):
    logger.exception("rid=%s unexpected error: %s", getattr(g, "request_id", "-"), e)
    return jsonify({
        "error": "服务器内部错误，请稍后重试",
        "requestId": getattr(g, "request_id", "-"),
    }), 500

# ── 数据库 ────────────────────────────────────────────────
def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn

def ensure_column(conn: sqlite3.Connection, table: str, col_name: str, ddl: str):
    cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if col_name not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")

def init_db():
    conn = get_db()
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS comments (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            skin_id    TEXT    NOT NULL,
            nickname   TEXT    NOT NULL DEFAULT '匿名',
            content    TEXT    NOT NULL,
            likes      INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_skin ON comments(skin_id)")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS submissions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            status      TEXT    NOT NULL DEFAULT 'pending_review',
            weapon      TEXT    NOT NULL,
            skin_name   TEXT    NOT NULL,
            quality     TEXT,
            material    TEXT,
            color1      TEXT,
            color2      TEXT,
            notes       TEXT,
            contributor TEXT    NOT NULL DEFAULT '匿名',
            file_a      TEXT,
            file_b      TEXT,
            file_c      TEXT,
            file_d      TEXT,
            created_at  INTEGER NOT NULL,
            reviewed_at INTEGER,
            review_note TEXT
        )
    """)
    ensure_column(conn, "submissions", "storage_mode", "storage_mode TEXT NOT NULL DEFAULT 'local'")
    ensure_column(conn, "submissions", "oss_key_a", "oss_key_a TEXT")
    ensure_column(conn, "submissions", "oss_key_b", "oss_key_b TEXT")
    ensure_column(conn, "submissions", "oss_key_c", "oss_key_c TEXT")
    ensure_column(conn, "submissions", "oss_key_d", "oss_key_d TEXT")
    ensure_column(conn, "submissions", "oss_etag_a", "oss_etag_a TEXT")
    ensure_column(conn, "submissions", "oss_etag_b", "oss_etag_b TEXT")
    ensure_column(conn, "submissions", "oss_etag_c", "oss_etag_c TEXT")
    ensure_column(conn, "submissions", "oss_etag_d", "oss_etag_d TEXT")
    ensure_column(conn, "submissions", "query_token", "query_token TEXT")
    ensure_column(conn, "submissions", "build_status", "build_status TEXT NOT NULL DEFAULT 'none'")
    ensure_column(conn, "submissions", "build_error", "build_error TEXT")
    ensure_column(conn, "submissions", "submission_type", "submission_type TEXT NOT NULL DEFAULT 'new_skin'")
    ensure_column(conn, "submissions", "supplement_skin_id", "supplement_skin_id TEXT")
    ensure_column(conn, "submissions", "supplement_folder_code", "supplement_folder_code TEXT")
    ensure_column(conn, "submissions", "oss_key_s1", "oss_key_s1 TEXT")
    ensure_column(conn, "submissions", "oss_key_s2", "oss_key_s2 TEXT")
    ensure_column(conn, "submissions", "oss_key_s3", "oss_key_s3 TEXT")
    ensure_column(conn, "submissions", "oss_etag_s1", "oss_etag_s1 TEXT")
    ensure_column(conn, "submissions", "oss_etag_s2", "oss_etag_s2 TEXT")
    ensure_column(conn, "submissions", "oss_etag_s3", "oss_etag_s3 TEXT")
    ensure_column(conn, "submissions", "approved_skin_id", "approved_skin_id TEXT")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS supplement_images (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            skin_id     TEXT    NOT NULL,
            oss_key     TEXT    NOT NULL,
            contributor TEXT    NOT NULL DEFAULT '',
            created_at  INTEGER NOT NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_supp_skin ON supplement_images(skin_id)")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS build_jobs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            weapon      TEXT NOT NULL,
            status      TEXT NOT NULL DEFAULT 'queued',
            attempts    INTEGER NOT NULL DEFAULT 0,
            last_error  TEXT,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status)")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_query_token ON submissions(query_token)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_submissions_approved_skin_id ON submissions(approved_skin_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_build_jobs_status ON build_jobs(status)")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS skin_likes (
            skin_id TEXT PRIMARY KEY,
            count   INTEGER NOT NULL DEFAULT 0
        )
    """)
    conn.commit()
    conn.close()
    print(f"[DB] 数据库就绪：{DB_PATH}")

# ── 工具函数 ──────────────────────────────────────────────
def clean(s, maxlen: int) -> str:
    return (s or "").strip()[:maxlen]

def get_ip() -> str:
    return (request.headers.get("X-Forwarded-For", request.remote_addr) or "").split(",")[0].strip()

def valid_folder_code(folder_code: str) -> bool:
    # 防止路径穿越/跨目录写入，仅允许单级文件夹名。
    if not folder_code:
        return False
    if ".." in folder_code:
        return False
    if "/" in folder_code or "\\" in folder_code:
        return False
    return True

def check_token() -> bool:
    if not ADMIN_TOKEN:
        return False
    auth = request.headers.get("Authorization", "")
    if auth == f"Bearer {ADMIN_TOKEN}":
        return True
    return request.args.get("token", "") == ADMIN_TOKEN

def row_to_dict(r) -> dict:
    return {
        "id":        r["id"],
        "skinId":    r["skin_id"],
        "nickname":  r["nickname"],
        "content":   r["content"],
        "likes":     r["likes"],
        "createdAt": r["created_at"],
    }

def sub_to_dict(r) -> dict:
    has_a = bool(r["file_a"] or r["oss_key_a"])
    has_b = bool(r["file_b"] or r["oss_key_b"])
    has_c = bool(r["file_c"] or r["oss_key_c"])
    has_d = bool(r["file_d"] or r["oss_key_d"])
    cols = set(r.keys())
    return {
        "id":                   r["id"],
        "status":               r["status"],
        "storageMode":          r["storage_mode"] or "local",
        "weapon":               r["weapon"],
        "skinName":             r["skin_name"],
        "quality":              r["quality"] or "",
        "material":             r["material"] or "",
        "color1":               r["color1"] or "",
        "color2":               r["color2"] or "",
        "notes":                r["notes"] or "",
        "contributor":          r["contributor"],
        "hasA":                 has_a,
        "hasB":                 has_b,
        "hasC":                 has_c,
        "hasD":                 has_d,
        "createdAt":            r["created_at"],
        "reviewedAt":           r["reviewed_at"],
        "reviewNote":           r["review_note"] or "",
        "buildStatus":          r["build_status"] or "none",
        "buildError":           r["build_error"] or "",
        "submissionType":       r["submission_type"] if "submission_type" in cols else "new_skin",
        "supplementSkinId":     r["supplement_skin_id"] if "supplement_skin_id" in cols else "",
        "supplementFolderCode": r["supplement_folder_code"] if "supplement_folder_code" in cols else "",
        "hasS1":                bool(r["oss_key_s1"] if "oss_key_s1" in cols else None),
        "hasS2":                bool(r["oss_key_s2"] if "oss_key_s2" in cols else None),
        "hasS3":                bool(r["oss_key_s3"] if "oss_key_s3" in cols else None),
        "approvedSkinId":       r["approved_skin_id"] if "approved_skin_id" in cols else "",
    }

def get_weapon_dir(weapon: str) -> str:
    try:
        rules_path = ROOT / "scripts" / "config" / "weapon_rules.json"
        rules = json.loads(rules_path.read_text(encoding="utf-8"))
        for r in rules.get("weapons", []):
            if r["weapon"] == weapon:
                return r["dir"]
    except Exception:
        pass
    return weapon

def mk_query_token() -> str:
    return uuid.uuid4().hex + f"{random.randint(1000, 9999)}"

def normalize_status(status: str) -> str:
    s = (status or "").strip()
    if s == "pending":
        return "pending_review"
    return s or "pending_review"

def slot_field(slot: str, prefix: str) -> str:
    return f"{prefix}_{slot.lower()}"

def strip_quotes(s: str) -> str:
    return (s or "").strip().strip('"')

def get_slot_extension_by_content_type(content_type: str) -> str:
    ct = (content_type or "").lower()
    if "jpeg" in ct or "jpg" in ct:
        return ".jpg"
    return ".png"

def check_magic(first_bytes: bytes) -> str:
    if first_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if first_bytes.startswith(b"\xff\xd8"):
        return "image/jpeg"
    return ""

def get_oss_auth():
    try:
        import oss2
    except ImportError as e:
        raise RuntimeError("未安装 oss2，请执行 pip install -r server/requirements.txt") from e
    ak = os.environ.get("OSS_ACCESS_KEY_ID", "")
    sk = os.environ.get("OSS_ACCESS_KEY_SECRET", "")
    if not ak or not sk:
        raise RuntimeError("缺少 OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET")
    return oss2.Auth(ak, sk)

def get_oss_bucket():
    import oss2
    return oss2.Bucket(get_oss_auth(), OSS_ENDPOINT, OSS_BUCKET)

def issue_sts_for_submission(submission_id: int) -> dict:
    if not STS_ROLE_ARN:
        raise RuntimeError("缺少 ALIYUN_STS_ROLE_ARN")
    ak_id = STS_AK_ID or os.environ.get("OSS_ACCESS_KEY_ID", "")
    ak_secret = STS_AK_SECRET or os.environ.get("OSS_ACCESS_KEY_SECRET", "")
    if not ak_id or not ak_secret:
        raise RuntimeError("缺少 STS 调用凭证（ALIYUN_STS_ACCESS_KEY_ID/SECRET）")
    try:
        from aliyunsdkcore.client import AcsClient
        from aliyunsdksts.request.v20150401.AssumeRoleRequest import AssumeRoleRequest
    except ImportError as e:
        raise RuntimeError("缺少 aliyun STS SDK，请安装 aliyun-python-sdk-core 与 aliyun-python-sdk-sts") from e

    session_name = f"zpbk-sub-{submission_id}-{random.randint(1000, 9999)}"
    prefix = f"{OSS_PENDING_PREFIX}/{submission_id}/"
    policy = {
        "Version": "1",
        "Statement": [{
            "Effect": "Allow",
            "Action": [
                "oss:PutObject",
                "oss:PostObject",
                "oss:AbortMultipartUpload",
                "oss:ListParts"
            ],
            "Resource": [f"acs:oss:*:*:{OSS_BUCKET}/{prefix}*"]
        }]
    }
    req = AssumeRoleRequest()
    req.set_accept_format("json")
    req.set_RoleArn(STS_ROLE_ARN)
    req.set_RoleSessionName(session_name)
    req.set_DurationSeconds(STS_SESSION_SECONDS)
    req.set_Policy(json.dumps(policy, ensure_ascii=False))
    resp = AcsClient(ak_id, ak_secret, STS_REGION_ID).do_action_with_exception(req)
    data = json.loads(resp)
    cred = data.get("Credentials", {})
    if not cred.get("AccessKeyId"):
        raise RuntimeError("STS 凭证签发失败")
    return {
        "accessKeyId": cred["AccessKeyId"],
        "accessKeySecret": cred["AccessKeySecret"],
        "securityToken": cred["SecurityToken"],
        "expiration": cred.get("Expiration"),
        "region": OSS_REGION,
        "bucket": OSS_BUCKET,
        "endpoint": OSS_ENDPOINT,
        "keyPrefix": prefix,
    }

def validate_oss_object(bucket, key: str) -> dict:
    if not key:
        raise RuntimeError("对象 key 不能为空")
    head = bucket.head_object(key)
    size = int(getattr(head, "content_length", 0) or 0)
    content_type = getattr(head, "content_type", "") or ""
    if size <= 0:
        raise RuntimeError("对象为空文件")
    if size > MAX_FILE_BYTES:
        raise RuntimeError("单图超过 20MB 限制")
    part = bucket.get_object(key, byte_range=(0, 15)).read()
    magic_type = check_magic(part)
    if magic_type not in ("image/png", "image/jpeg"):
        raise RuntimeError("对象内容不是有效 PNG/JPEG 图片")
    if content_type and "image/" not in content_type.lower():
        raise RuntimeError("对象 Content-Type 非 image/*")
    etag = strip_quotes(getattr(head, "etag", "") or "")
    return {
        "size": size,
        "contentType": magic_type,
        "etag": etag,
    }

def enqueue_build_job(weapon: str) -> int:
    now = int(time.time() * 1000)
    conn = get_db()
    row = conn.execute(
        "SELECT id FROM build_jobs WHERE weapon=? AND status IN ('queued','running') ORDER BY id DESC LIMIT 1",
        (weapon,),
    ).fetchone()
    if row:
        conn.close()
        return int(row["id"])
    cur = conn.execute(
        "INSERT INTO build_jobs (weapon, status, attempts, created_at, updated_at) VALUES (?, 'queued', 0, ?, ?)",
        (weapon, now, now),
    )
    conn.commit()
    job_id = cur.lastrowid
    conn.close()
    return int(job_id)

def _get_next_supplement_index(conn: sqlite3.Connection, skin_id: str) -> int:
    row = conn.execute("SELECT COUNT(*) AS cnt FROM supplement_images WHERE skin_id=?", (skin_id,)).fetchone()
    return int(row["cnt"]) + 1

def _oss_public_url(key: str) -> str:
    endpoint = OSS_ENDPOINT.replace("https://", "").replace("http://", "")
    return f"https://{OSS_BUCKET}.{endpoint}/{key}"

# ── 评论路由 ──────────────────────────────────────────────
@app.route("/api/comments", methods=["GET"])
def get_comments():
    skin_id = clean(request.args.get("skinId", ""), 200)
    if not skin_id:
        return jsonify({"error": "skinId 不能为空"}), 400
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM comments WHERE skin_id = ? ORDER BY created_at DESC",
        (skin_id,)
    ).fetchall()
    conn.close()
    return jsonify({"results": [row_to_dict(r) for r in rows]})


@app.route("/api/comments", methods=["POST"])
def post_comment():
    ip = get_ip()
    if _is_limited(_rate, ip, RATE_WINDOW, RATE_LIMIT):
        return jsonify({"error": "发送太频繁，请稍后再试"}), 429
    data     = request.get_json(silent=True) or {}
    skin_id  = clean(data.get("skinId",  ""), 200)
    nickname = clean(data.get("nickname", "匿名"), 20) or "匿名"
    content  = clean(data.get("content", ""), 500)
    if not skin_id:
        return jsonify({"error": "skinId 不能为空"}), 400
    if not content:
        return jsonify({"error": "评论内容不能为空"}), 400
    now = int(time.time() * 1000)
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO comments (skin_id, nickname, content, likes, created_at) VALUES (?, ?, ?, 0, ?)",
        (skin_id, nickname, content, now),
    )
    conn.commit()
    conn.close()
    return jsonify({"id": cur.lastrowid, "createdAt": now}), 201


@app.route("/api/comments/<int:comment_id>/like", methods=["PUT"])
def like_comment(comment_id: int):
    conn = get_db()
    conn.execute("UPDATE comments SET likes = likes + 1 WHERE id = ?", (comment_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ── 皮肤点赞路由 ───────────────────────────────────────────
@app.route("/api/skin-stats", methods=["GET"])
def get_skin_stats():
    conn = get_db()
    like_rows = conn.execute("SELECT skin_id, count FROM skin_likes").fetchall()
    comment_rows = conn.execute(
        "SELECT skin_id, COUNT(*) as cnt FROM comments GROUP BY skin_id"
    ).fetchall()
    conn.close()
    result = {}
    for r in like_rows:
        result.setdefault(r["skin_id"], {})["likes"] = r["count"]
    for r in comment_rows:
        result.setdefault(r["skin_id"], {})["comments"] = r["cnt"]
    return jsonify(result)


@app.route("/api/skin-notes", methods=["GET"])
def get_skin_notes():
    """返回已审核通过的心得映射：{skin_id: {notes, contributor}}"""
    conn = get_db()
    rows = conn.execute(
        """
        SELECT approved_skin_id, notes, contributor, reviewed_at
        FROM submissions
        WHERE status='approved'
          AND submission_type='new_skin'
          AND approved_skin_id IS NOT NULL
          AND TRIM(approved_skin_id)!=''
          AND notes IS NOT NULL
          AND TRIM(notes)!=''
        ORDER BY reviewed_at DESC, id DESC
        """
    ).fetchall()
    conn.close()

    result = {}
    for r in rows:
        skin_id = (r["approved_skin_id"] or "").strip()
        if not skin_id or skin_id in result:
            continue
        result[skin_id] = {
            "notes": (r["notes"] or "").strip(),
            "contributor": (r["contributor"] or "").strip() or "匿名",
        }
    return jsonify(result)


@app.route("/api/skins/<skin_id>/like", methods=["POST"])
def like_skin(skin_id: str):
    skin_id = clean(skin_id, 200)
    if not skin_id:
        return jsonify({"error": "skin_id 不能为空"}), 400
    data = request.get_json(silent=True) or {}
    action = data.get("action", "up")
    conn = get_db()
    if action == "up":
        conn.execute(
            "INSERT INTO skin_likes(skin_id, count) VALUES(?, 1) "
            "ON CONFLICT(skin_id) DO UPDATE SET count = count + 1",
            (skin_id,),
        )
    else:
        conn.execute(
            "INSERT INTO skin_likes(skin_id, count) VALUES(?, 0) "
            "ON CONFLICT(skin_id) DO UPDATE SET count = MAX(0, count - 1)",
            (skin_id,),
        )
    conn.commit()
    row = conn.execute("SELECT count FROM skin_likes WHERE skin_id = ?", (skin_id,)).fetchone()
    conn.close()
    return jsonify({"count": row["count"] if row else 0})


# ── 健康检查 ──────────────────────────────────────────────
@app.route("/api/ping", methods=["GET"])
def ping():
    return jsonify({"status": "ok"})


# ── 投稿路由（直传 OSS）────────────────────────────────────
@app.route("/api/submissions/create", methods=["POST"])
def create_submission():
    ip = get_ip()
    if _is_limited(_submit_rate, ip, SUBMIT_WINDOW, SUBMIT_LIMIT):
        return jsonify({"error": "今日投稿次数已达上限，明天再来吧"}), 429

    data = request.get_json(silent=True) or {}
    submission_type = clean(data.get("submissionType", "new_skin"), 20) or "new_skin"
    weapon      = clean(data.get("weapon", ""), 50)
    skin_name   = clean(data.get("skinName", ""), 50)
    quality     = clean(data.get("quality", ""), 10)
    material    = clean(data.get("material", ""), 20)
    color1      = clean(data.get("color1", ""), 10)
    color2      = clean(data.get("color2", ""), 10)
    notes       = clean(data.get("notes", ""), 300)
    contributor = clean(data.get("contributor", ""), 20) or "匿名"

    supplement_skin_id     = ""
    supplement_folder_code = ""

    if submission_type == "supplement":
        supplement_skin_id     = clean(data.get("targetSkinId", ""), 100)
        supplement_folder_code = clean(data.get("targetFolderCode", ""), 80)
        if not supplement_skin_id or not supplement_folder_code:
            return jsonify({"error": "补充图需要提供 targetSkinId 和 targetFolderCode"}), 400
        if not valid_folder_code(supplement_folder_code):
            return jsonify({"error": "targetFolderCode 非法（禁止包含路径分隔符或 ..）"}), 400

    if not weapon or not skin_name:
        return jsonify({"error": "武器和皮肤名不能为空"}), 400
    # Vector / M4A1 无材质选项，不强制要求 material 字段
    NO_MATERIAL_WEAPONS = {"Vector", "M4A1"}
    if submission_type == "new_skin" and not quality:
        return jsonify({"error": "品级不能为空"}), 400
    if submission_type == "new_skin" and weapon not in NO_MATERIAL_WEAPONS and not material:
        return jsonify({"error": "材质不能为空"}), 400

    now = int(time.time() * 1000)
    query_token = mk_query_token()
    conn = get_db()
    cur = conn.execute(
        """INSERT INTO submissions
           (status, storage_mode, weapon, skin_name, quality, material, color1, color2, notes, contributor,
            created_at, query_token, build_status, submission_type, supplement_skin_id, supplement_folder_code)
           VALUES ('created', 'oss', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', ?, ?, ?)""",
        (weapon, skin_name, quality, material, color1, color2, notes, contributor, now, query_token,
         submission_type, supplement_skin_id, supplement_folder_code),
    )
    conn.commit()
    sub_id = int(cur.lastrowid)
    conn.close()

    try:
        sts = issue_sts_for_submission(sub_id)
    except Exception as e:
        logger.exception("rid=%s STS 签发失败: %s", getattr(g, "request_id", "-"), e)
        return jsonify({"error": f"签发上传凭证失败：{e}"}), 500

    return jsonify({
        "id": sub_id,
        "queryToken": query_token,
        "sts": sts,
        "limits": {
            "maxFileBytes": MAX_FILE_BYTES,
            "allowedTypes": ["image/png", "image/jpeg"],
        },
    }), 201


@app.route("/api/submissions/commit", methods=["POST"])
def commit_submission():
    data = request.get_json(silent=True) or {}
    sub_id = int(data.get("submissionId", 0) or 0)
    uploads = data.get("uploads", {}) or {}
    if not sub_id:
        return jsonify({"error": "submissionId 不能为空"}), 400
    if not isinstance(uploads, dict) or not uploads:
        return jsonify({"error": "uploads 不能为空"}), 400

    conn = get_db()
    row = conn.execute("SELECT * FROM submissions WHERE id=?", (sub_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "投稿不存在"}), 404
    if row["status"] not in ("created", "uploaded", "pending_review"):
        conn.close()
        return jsonify({"error": "投稿状态不允许提交"}), 400
    conn.close()

    try:
        bucket = get_oss_bucket()
    except Exception as e:
        return jsonify({"error": f"OSS 配置异常：{e}"}), 500

    key_updates = {}
    etag_updates = {}
    has_any = False
    key_prefix = f"{OSS_PENDING_PREFIX}/{sub_id}/"

    # ABCD 为主图，S1/S2/S3 为投稿时附带的补充图（可选）
    for slot in ("A", "B", "C", "D", "S1", "S2", "S3"):
        info = uploads.get(slot) or {}
        key = clean(info.get("key", ""), 500)
        if not key:
            continue
        if not key.startswith(key_prefix):
            return jsonify({"error": f"图片 {slot} key 非法，必须位于 {key_prefix}"}), 400
        meta = validate_oss_object(bucket, key)
        key_updates[slot] = key
        etag_updates[slot] = meta["etag"] or clean(info.get("etag", ""), 200)
        has_any = True

    if not has_any:
        return jsonify({"error": "至少提交一张有效图片"}), 400

    conn = get_db()
    conn.execute(
        """UPDATE submissions SET
            status='pending_review',
            storage_mode='oss',
            oss_key_a=?, oss_key_b=?, oss_key_c=?, oss_key_d=?,
            oss_etag_a=?, oss_etag_b=?, oss_etag_c=?, oss_etag_d=?,
            oss_key_s1=?, oss_key_s2=?, oss_key_s3=?,
            oss_etag_s1=?, oss_etag_s2=?, oss_etag_s3=?
           WHERE id=?""",
        (
            key_updates.get("A"), key_updates.get("B"), key_updates.get("C"), key_updates.get("D"),
            etag_updates.get("A"), etag_updates.get("B"), etag_updates.get("C"), etag_updates.get("D"),
            key_updates.get("S1"), key_updates.get("S2"), key_updates.get("S3"),
            etag_updates.get("S1"), etag_updates.get("S2"), etag_updates.get("S3"),
            sub_id,
        ),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "id": sub_id})


# 旧投稿接口兼容（仅当显式切回 local 模式）
@app.route("/api/submit", methods=["POST"])
def submit_skin():
    if UPLOAD_STORAGE_MODE != "local":
        return jsonify({"error": "当前已升级直传 OSS，请使用新投稿接口"}), 410
    ip = get_ip()
    if _is_limited(_submit_rate, ip, SUBMIT_WINDOW, SUBMIT_LIMIT):
        return jsonify({"error": "今日投稿次数已达上限，明天再来吧"}), 429
    return jsonify({"error": "local 模式已停用"}), 501


@app.route("/api/submissions/query", methods=["GET"])
def query_submission():
    token = clean(request.args.get("ticket", ""), 200)
    if not token:
        return jsonify({"error": "ticket 不能为空"}), 400
    conn = get_db()
    row = conn.execute("SELECT * FROM submissions WHERE query_token=?", (token,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "票据无效"}), 404
    result = sub_to_dict(row)
    result["queryToken"] = token
    return jsonify({"result": result})


@app.route("/api/uploads/<int:sub_id>/<slot>", methods=["GET"])
def get_upload_preview(sub_id: int, slot: str):
    """供审核面板预览待审图片（需 token）"""
    if not check_token():
        return jsonify({"error": "无权限"}), 401
    slot = slot.upper()
    if slot not in ("A", "B", "C", "D", "S1", "S2", "S3"):
        return jsonify({"error": "无效图位"}), 400

    conn = get_db()
    row = conn.execute("SELECT * FROM submissions WHERE id=?", (sub_id,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "投稿不存在"}), 404

    if (row["storage_mode"] or "local") == "oss":
        col = f"oss_key_{slot.lower()}"
        key = row[col] if col in row.keys() else None
        if not key:
            return jsonify({"error": "图片不存在"}), 404
        try:
            bucket = get_oss_bucket()
            signed = bucket.sign_url("GET", key, 300)
            return jsonify({"url": signed})
        except Exception as e:
            return jsonify({"error": f"生成预览链接失败：{e}"}), 500

    src_path = row[slot_field(slot, "file")] if slot in ("A", "B", "C", "D") else None
    if not src_path:
        return jsonify({"error": "图片不存在"}), 404
    src = Path(src_path)
    if not src.exists():
        return jsonify({"error": "图片不存在"}), 404
    return send_file(str(src))


@app.route("/api/submissions", methods=["GET"])
def list_submissions():
    if not check_token():
        return jsonify({"error": "无权限"}), 401
    status = normalize_status(request.args.get("status", "pending_review"))
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM submissions WHERE status = ? ORDER BY created_at DESC",
        (status,),
    ).fetchall()
    conn.close()
    return jsonify({"results": [sub_to_dict(r) for r in rows]})


@app.route("/api/submissions/<int:sub_id>/approve", methods=["PUT"])
def approve_submission(sub_id: int):
    if not check_token():
        return jsonify({"error": "无权限"}), 401

    data        = request.get_json(silent=True) or {}

    conn = get_db()
    row = conn.execute("SELECT * FROM submissions WHERE id=?", (sub_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "投稿不存在"}), 404
    if row["status"] == "approved":
        conn.close()
        return jsonify({"ok": True, "alreadyApproved": True})
    if row["status"] != "pending_review":
        conn.close()
        return jsonify({"error": "该投稿状态不允许审核通过"}), 400

    cols = set(row.keys())
    sub_type = (row["submission_type"] if "submission_type" in cols else None) or "new_skin"

    # ── 补充图审核 ────────────────────────────────────────────
    if sub_type == "supplement":
        target_skin_id     = row["supplement_skin_id"] if "supplement_skin_id" in cols else ""
        target_folder_code = row["supplement_folder_code"] if "supplement_folder_code" in cols else ""
        target_weapon      = row["weapon"]
        weapon_dir         = get_weapon_dir(target_weapon)
        src_key            = row["oss_key_a"]
        if not src_key:
            conn.close()
            return jsonify({"error": "补充图未上传（oss_key_a 为空）"}), 400
        try:
            bucket = get_oss_bucket()
            n   = _get_next_supplement_index(conn, target_skin_id)
            ext = Path(src_key).suffix.lower()
            if ext not in (".png", ".jpg", ".jpeg"):
                ext = ".png"
            dst_key = f"{weapon_dir}/{target_folder_code}/{target_skin_id}_S{n}{ext}"
            bucket.copy_object(OSS_BUCKET, src_key, dst_key)
            now_ts = int(time.time() * 1000)
            conn.execute(
                "INSERT INTO supplement_images (skin_id, oss_key, contributor, created_at) VALUES (?, ?, ?, ?)",
                (target_skin_id, dst_key, row["contributor"] or "", now_ts),
            )
            conn.execute(
                "UPDATE submissions SET status='approved', reviewed_at=?, review_note=?, build_status='none', build_error='' WHERE id=?",
                (now_ts, "", sub_id),
            )
            conn.commit()
        except Exception as e:
            conn.close()
            return jsonify({"error": f"处理补充图失败：{e}"}), 500
        conn.close()
        return jsonify({"ok": True, "buildQueued": False, "message": "补充图已通过"})

    # ── 新皮肤审核 ────────────────────────────────────────────
    folder_code = clean(data.get("folderCode", ""), 80)
    if not folder_code:
        conn.close()
        return jsonify({"error": "folderCode 不能为空"}), 400
    if not valid_folder_code(folder_code):
        conn.close()
        return jsonify({"error": "folderCode 非法（禁止包含路径分隔符或 ..）"}), 400

    weapon     = row["weapon"]
    weapon_dir = get_weapon_dir(weapon)

    # 将投稿人填写的皮肤名编码进文件夹名（__ 注解格式），供构建脚本读取 name_hint
    # 格式：{folderCode}__{material}-{quality}-{skinName}，仅当 skin_name 存在且 folderCode 不含 __ 时追加
    sub_skin_name = (row["skin_name"] if "skin_name" in cols else "") or ""
    sub_quality   = (row["quality"]   if "quality"   in cols else "") or ""
    sub_material  = (row["material"]  if "material"  in cols else "") or ""
    effective_folder_code = folder_code
    if sub_skin_name and "__" not in folder_code:
        safe_name = re.sub(r'[/\\|]', '_', sub_skin_name.strip())
        if safe_name:
            effective_folder_code = (
                f"{folder_code}__{sub_material or 'NA'}-{sub_quality or 'NA'}-{safe_name}"
            )
    # 计算 skin_id 时只用原始 folderCode，避免 "__材质-品质-名称" 注解影响 parser
    # 注解目录名仅用于 OSS 落盘与构建 name_hint，不应用于 ID 解析。
    skin_id = _compute_skin_id(weapon, folder_code.split("__", 1)[0]) or ""

    if (row["storage_mode"] or "local") == "oss":
        try:
            bucket = get_oss_bucket()
            for slot in ("A", "B", "C", "D"):
                src_key = row[slot_field(slot, "oss_key")]
                if not src_key:
                    continue
                ext = Path(src_key).suffix.lower()
                if ext not in (".png", ".jpg", ".jpeg"):
                    ext = ".png"
                fname = f"{skin_id}_{slot}{ext}" if skin_id else f"{slot}{ext}"
                dst_key = f"{weapon_dir}/{effective_folder_code}/{fname}"
                bucket.copy_object(OSS_BUCKET, src_key, dst_key)
            # 处理投稿时附带的补充图 S1/S2/S3
            if skin_id:
                now_ts = int(time.time() * 1000)
                supp_n = _get_next_supplement_index(conn, skin_id)
                for s_slot in ("S1", "S2", "S3"):
                    col = f"oss_key_{s_slot.lower()}"
                    src_key = row[col] if col in row.keys() else None
                    if not src_key:
                        continue
                    ext = Path(src_key).suffix.lower()
                    if ext not in (".png", ".jpg", ".jpeg"):
                        ext = ".png"
                    dst_key = f"{weapon_dir}/{effective_folder_code}/{skin_id}_S{supp_n}{ext}"
                    bucket.copy_object(OSS_BUCKET, src_key, dst_key)
                    conn.execute(
                        "INSERT INTO supplement_images (skin_id, oss_key, contributor, created_at) VALUES (?, ?, ?, ?)",
                        (skin_id, dst_key, row["contributor"] or "", now_ts),
                    )
                    supp_n += 1
        except Exception as e:
            conn.close()
            return jsonify({"error": f"复制 OSS 图片失败：{e}"}), 500
    else:
        target_dir = ROOT / weapon_dir / folder_code
        target_dir.mkdir(parents=True, exist_ok=True)
        for slot in ("A", "B", "C", "D"):
            src_path = row[slot_field(slot, "file")]
            if not src_path:
                continue
            src = Path(src_path)
            if src.exists():
                shutil.copy2(str(src), str(target_dir / src.name))

    now = int(time.time() * 1000)
    conn.execute(
        """UPDATE submissions
           SET status='approved', reviewed_at=?, review_note=?, build_status='queued', build_error='',
               approved_skin_id=?
           WHERE id=?""",
        (now, "", skin_id, sub_id),
    )
    conn.commit()
    conn.close()
    job_id = enqueue_build_job(weapon)
    return jsonify({
        "ok": True,
        "buildQueued": True,
        "buildJobId": job_id,
        "message": "审核通过，构建已入队（异步执行）",
    })


@app.route("/api/submissions/<int:sub_id>/reject", methods=["PUT"])
def reject_submission(sub_id: int):
    if not check_token():
        return jsonify({"error": "无权限"}), 401
    data = request.get_json(silent=True) or {}
    note = clean(data.get("note", ""), 200)
    conn = get_db()
    row  = conn.execute("SELECT id, status FROM submissions WHERE id=?", (sub_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "投稿不存在"}), 404
    if row["status"] == "rejected":
        conn.close()
        return jsonify({"ok": True, "alreadyRejected": True})
    now = int(time.time() * 1000)
    conn.execute(
        "UPDATE submissions SET status='rejected', reviewed_at=?, review_note=? WHERE id=?",
        (now, note, sub_id),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/supplements", methods=["GET"])
def get_supplements():
    """返回某皮肤已审核通过的玩家共享图列表（公开接口）"""
    skin_id = clean(request.args.get("skinId", ""), 200)
    if not skin_id:
        return jsonify({"error": "skinId 不能为空"}), 400
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM supplement_images WHERE skin_id=? ORDER BY created_at ASC",
        (skin_id,),
    ).fetchall()
    conn.close()
    results = []
    for r in rows:
        results.append({
            "id":          r["id"],
            "url":         _oss_public_url(r["oss_key"]),
            "contributor": r["contributor"] or "",
            "createdAt":   r["created_at"],
        })
    return jsonify({"results": results})


# ── 启动 ──────────────────────────────────────────────────
if __name__ == "__main__":
    init_db()
    print("[服务] 评论 API 启动在 http://127.0.0.1:5200")
    app.run(host="127.0.0.1", port=5200, debug=False, threaded=True)
