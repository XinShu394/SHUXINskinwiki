"""
砖皮百科 · API 服务
运行方式：python app.py
数据库：同目录下 comments.db（SQLite，自动创建）
"""
import io
import json
import os
import shutil
import sqlite3
import subprocess
import time
from pathlib import Path

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

# ── 常量 ──────────────────────────────────────────────────
DB_PATH    = os.path.join(os.path.dirname(__file__), "comments.db")
ROOT       = Path(__file__).resolve().parent.parent
UPLOAD_DIR = Path(__file__).resolve().parent / "uploads" / "pending"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ADMIN_TOKEN    = os.environ.get("ZPBK_ADMIN_TOKEN", "")
MAX_FILE_BYTES = 5 * 1024 * 1024
app.config["MAX_CONTENT_LENGTH"] = 30 * 1024 * 1024

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

# ── 数据库 ────────────────────────────────────────────────
def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
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
            status      TEXT    NOT NULL DEFAULT 'pending',
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
    conn.commit()
    conn.close()
    print(f"[DB] 数据库就绪：{DB_PATH}")

# ── 工具函数 ──────────────────────────────────────────────
def clean(s, maxlen: int) -> str:
    return (s or "").strip()[:maxlen]

def get_ip() -> str:
    return (request.headers.get("X-Forwarded-For", request.remote_addr) or "").split(",")[0].strip()

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
    return {
        "id":          r["id"],
        "status":      r["status"],
        "weapon":      r["weapon"],
        "skinName":    r["skin_name"],
        "quality":     r["quality"] or "",
        "material":    r["material"] or "",
        "color1":      r["color1"] or "",
        "color2":      r["color2"] or "",
        "notes":       r["notes"] or "",
        "contributor": r["contributor"],
        "hasA":        bool(r["file_a"]),
        "hasB":        bool(r["file_b"]),
        "hasC":        bool(r["file_c"]),
        "hasD":        bool(r["file_d"]),
        "createdAt":   r["created_at"],
        "reviewedAt":  r["reviewed_at"],
        "reviewNote":  r["review_note"] or "",
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


# ── 健康检查 ──────────────────────────────────────────────
@app.route("/api/ping", methods=["GET"])
def ping():
    return jsonify({"status": "ok"})


# ── 投稿路由 ──────────────────────────────────────────────
@app.route("/api/submit", methods=["POST"])
def submit_skin():
    ip = get_ip()
    if _is_limited(_submit_rate, ip, SUBMIT_WINDOW, SUBMIT_LIMIT):
        return jsonify({"error": "今日投稿次数已达上限，明天再来吧"}), 429

    weapon      = clean(request.form.get("weapon",      ""), 50)
    skin_name   = clean(request.form.get("skinName",    ""), 50)
    quality     = clean(request.form.get("quality",     ""), 10)
    material    = clean(request.form.get("material",    ""), 20)
    color1      = clean(request.form.get("color1",      ""), 10)
    color2      = clean(request.form.get("color2",      ""), 10)
    notes       = clean(request.form.get("notes",       ""), 300)
    contributor = clean(request.form.get("contributor", ""), 20) or "匿名"

    if not weapon or not skin_name:
        return jsonify({"error": "武器和皮肤名不能为空"}), 400
    if not quality or not material:
        return jsonify({"error": "品级和材质不能为空"}), 400

    # 读取并验证图片
    file_data: dict = {"A": None, "B": None, "C": None, "D": None}
    for slot in ("A", "B", "C", "D"):
        f = request.files.get(f"file{slot}")
        if not f or not f.filename:
            continue
        raw = f.read(MAX_FILE_BYTES + 1)
        if len(raw) > MAX_FILE_BYTES:
            return jsonify({"error": f"图片 {slot} 超过 5MB 限制"}), 400
        try:
            from PIL import Image
            img = Image.open(io.BytesIO(raw))
            img.verify()
            if img.format not in ("PNG", "JPEG"):
                return jsonify({"error": f"图片 {slot} 仅支持 PNG/JPG 格式"}), 400
        except Exception:
            return jsonify({"error": f"图片 {slot} 格式无效，请确认为 PNG 或 JPG"}), 400
        file_data[slot] = raw

    if not any(file_data.values()):
        return jsonify({"error": "至少需要上传一张图片"}), 400

    # 写数据库（先获取 id）
    now = int(time.time() * 1000)
    conn = get_db()
    cur = conn.execute(
        """INSERT INTO submissions
           (weapon, skin_name, quality, material, color1, color2, notes, contributor, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (weapon, skin_name, quality, material, color1, color2, notes, contributor, now),
    )
    conn.commit()
    sub_id = cur.lastrowid
    conn.close()

    # 保存图片到磁盘
    sub_dir = UPLOAD_DIR / str(sub_id)
    sub_dir.mkdir(parents=True, exist_ok=True)
    paths: dict = {"A": None, "B": None, "C": None, "D": None}
    for slot, raw in file_data.items():
        if raw is None:
            continue
        suffix = ".png"
        try:
            from PIL import Image
            if Image.open(io.BytesIO(raw)).format == "JPEG":
                suffix = ".jpg"
        except Exception:
            pass
        dest = sub_dir / f"{slot}{suffix}"
        dest.write_bytes(raw)
        paths[slot] = str(dest)

    conn = get_db()
    conn.execute(
        "UPDATE submissions SET file_a=?, file_b=?, file_c=?, file_d=? WHERE id=?",
        (paths["A"], paths["B"], paths["C"], paths["D"], sub_id),
    )
    conn.commit()
    conn.close()

    return jsonify({"id": sub_id}), 201


@app.route("/api/uploads/<int:sub_id>/<slot>", methods=["GET"])
def get_upload_preview(sub_id: int, slot: str):
    """供审核面板预览待审图片（需 token）"""
    if not check_token():
        return jsonify({"error": "无权限"}), 401
    slot = slot.upper()
    if slot not in ("A", "B", "C", "D"):
        return jsonify({"error": "无效图位"}), 400
    sub_dir = UPLOAD_DIR / str(sub_id)
    for ext in (".png", ".jpg", ".jpeg"):
        f = sub_dir / f"{slot}{ext}"
        if f.exists():
            return send_file(str(f))
    return jsonify({"error": "图片不存在"}), 404


@app.route("/api/submissions", methods=["GET"])
def list_submissions():
    if not check_token():
        return jsonify({"error": "无权限"}), 401
    status = request.args.get("status", "pending")
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
    folder_code = clean(data.get("folderCode", ""), 80)
    if not folder_code:
        return jsonify({"error": "folderCode 不能为空"}), 400

    conn = get_db()
    row = conn.execute("SELECT * FROM submissions WHERE id=?", (sub_id,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "投稿不存在"}), 404
    if row["status"] != "pending":
        return jsonify({"error": "该投稿已处理"}), 400

    weapon     = row["weapon"]
    weapon_dir = get_weapon_dir(weapon)
    target_dir = ROOT / weapon_dir / folder_code
    target_dir.mkdir(parents=True, exist_ok=True)

    for slot in ("A", "B", "C", "D"):
        src_path = row[f"file_{slot.lower()}"]
        if not src_path:
            continue
        src = Path(src_path)
        if src.exists():
            shutil.copy2(str(src), str(target_dir / src.name))

    # 运行构建脚本
    build_ok, build_log = False, ""
    try:
        script = ROOT / "scripts" / "validate_and_build.py"
        r = subprocess.run(
            ["python", str(script), "--weapon", weapon],
            capture_output=True, text=True, encoding="utf-8",
            errors="replace", cwd=str(ROOT), timeout=120,
        )
        build_ok  = r.returncode == 0
        build_log = (r.stdout + r.stderr)[-2000:]
    except Exception as e:
        build_log = str(e)

    # OSS 上传（可选，需环境变量配置）
    oss_ok, oss_log = False, ""
    try:
        import oss2
        ak          = os.environ.get("OSS_ACCESS_KEY_ID", "")
        sk          = os.environ.get("OSS_ACCESS_KEY_SECRET", "")
        bucket_name = os.environ.get("OSS_BUCKET", "skinwiki")
        endpoint    = os.environ.get("OSS_ENDPOINT", "https://oss-cn-hangzhou.aliyuncs.com")
        if ak and sk:
            bucket = oss2.Bucket(oss2.Auth(ak, sk), endpoint, bucket_name)
            for f in target_dir.iterdir():
                if f.is_file():
                    bucket.put_object_from_file(f"{weapon_dir}/{folder_code}/{f.name}", str(f))
            oss_ok  = True
            oss_log = "OSS 上传成功"
        else:
            oss_log = "未配置 OSS 凭证，图片暂由本机提供（后续可手动上传 OSS）"
    except ImportError:
        oss_log = "oss2 未安装，跳过 OSS 上传"
    except Exception as e:
        oss_log = f"OSS 上传失败：{e}"

    now = int(time.time() * 1000)
    conn = get_db()
    conn.execute(
        "UPDATE submissions SET status='approved', reviewed_at=? WHERE id=?",
        (now, sub_id),
    )
    conn.commit()
    conn.close()

    return jsonify({
        "ok":       True,
        "buildOk":  build_ok,
        "buildLog": build_log,
        "ossOk":    oss_ok,
        "ossLog":   oss_log,
    })


@app.route("/api/submissions/<int:sub_id>/reject", methods=["PUT"])
def reject_submission(sub_id: int):
    if not check_token():
        return jsonify({"error": "无权限"}), 401
    data = request.get_json(silent=True) or {}
    note = clean(data.get("note", ""), 200)
    conn = get_db()
    row  = conn.execute("SELECT id FROM submissions WHERE id=?", (sub_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "投稿不存在"}), 404
    now = int(time.time() * 1000)
    conn.execute(
        "UPDATE submissions SET status='rejected', reviewed_at=?, review_note=? WHERE id=?",
        (now, note, sub_id),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ── 启动 ──────────────────────────────────────────────────
if __name__ == "__main__":
    init_db()
    print("[服务] 评论 API 启动在 http://127.0.0.1:5200")
    app.run(host="127.0.0.1", port=5200, debug=False, threaded=True)
