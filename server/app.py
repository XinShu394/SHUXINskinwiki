"""
砖皮百科 · 评论 API 服务
运行方式：python app.py
数据库：同目录下 comments.db（SQLite，自动创建）
"""
import sqlite3
import time
import os
import re
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)

# 允许跨域（开发时用 localhost；生产时建议改成你的域名）
CORS(app, resources={r"/api/*": {"origins": "*"}})

DB_PATH = os.path.join(os.path.dirname(__file__), "comments.db")

# ── 简单频率限制（内存，重启后清空）──────────────────────
_rate: dict = {}          # ip -> [时间戳, ...]
RATE_WINDOW  = 60         # 统计窗口（秒）
RATE_LIMIT   = 5          # 窗口内最多发 N 条

def is_rate_limited(ip: str) -> bool:
    now = time.time()
    ts_list = _rate.get(ip, [])
    ts_list = [t for t in ts_list if now - t < RATE_WINDOW]
    if len(ts_list) >= RATE_LIMIT:
        _rate[ip] = ts_list
        return True
    ts_list.append(now)
    _rate[ip] = ts_list
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
    conn.commit()
    conn.close()
    print(f"[DB] 数据库就绪：{DB_PATH}")

# ── 工具 ─────────────────────────────────────────────────
def clean(s: str, maxlen: int) -> str:
    """去除首尾空白 + 截断"""
    return (s or "").strip()[:maxlen]

def row_to_dict(r) -> dict:
    return {
        "id":        r["id"],
        "skinId":    r["skin_id"],
        "nickname":  r["nickname"],
        "content":   r["content"],
        "likes":     r["likes"],
        "createdAt": r["created_at"],   # 毫秒时间戳
    }

# ── 路由 ─────────────────────────────────────────────────

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
    # 频率限制
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "").split(",")[0].strip()
    if is_rate_limited(ip):
        return jsonify({"error": "发送太频繁，请稍后再试"}), 429

    data     = request.get_json(silent=True) or {}
    skin_id  = clean(data.get("skinId",  ""), 200)
    nickname = clean(data.get("nickname", "匿名"), 20) or "匿名"
    content  = clean(data.get("content", ""), 500)

    if not skin_id:
        return jsonify({"error": "skinId 不能为空"}), 400
    if not content:
        return jsonify({"error": "评论内容不能为空"}), 400
    if len(content) < 1:
        return jsonify({"error": "评论太短"}), 400

    now = int(time.time() * 1000)
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO comments (skin_id, nickname, content, likes, created_at) VALUES (?, ?, ?, 0, ?)",
        (skin_id, nickname, content, now),
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()

    return jsonify({"id": new_id, "createdAt": now}), 201


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


# ── 启动 ──────────────────────────────────────────────────
if __name__ == "__main__":
    init_db()
    print("[服务] 评论 API 启动在 http://127.0.0.1:5200")
    app.run(host="127.0.0.1", port=5200, debug=False, threaded=True)
