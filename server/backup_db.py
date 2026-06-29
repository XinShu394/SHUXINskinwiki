"""
砖皮百科 · 数据库每日备份脚本
功能：将 comments.db 安全快照并上传到 OSS backups/ 前缀
运行方式：由 zpbk-backup.timer 每天 03:00 触发
依赖：oss2（venv 内已有）、/etc/zpbk.env 注入 OSS 凭证
"""
import logging
import os
import sqlite3
import sys
import tempfile
from datetime import datetime
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("zpbk.backup")

DB_PATH = Path(__file__).resolve().parent / "comments.db"

OSS_AK_ID     = os.environ.get("OSS_ACCESS_KEY_ID", "")
OSS_AK_SECRET = os.environ.get("OSS_ACCESS_KEY_SECRET", "")
OSS_ENDPOINT  = os.environ.get("OSS_ENDPOINT", "https://oss-cn-guangzhou.aliyuncs.com")
OSS_BUCKET    = os.environ.get("OSS_BUCKET", "skinwiki")
BACKUP_PREFIX = "backups"


def _check_env():
    missing = [k for k in ("OSS_ACCESS_KEY_ID", "OSS_ACCESS_KEY_SECRET") if not os.environ.get(k)]
    if missing:
        logger.error("缺少环境变量：%s，请确认 /etc/zpbk.env 已正确加载", missing)
        sys.exit(1)


def _sqlite_backup(tmp_path: str):
    """使用 SQLite 官方 backup API 创建快照，对并发读写安全。"""
    src = sqlite3.connect(str(DB_PATH), timeout=30)
    dst = sqlite3.connect(tmp_path, timeout=30)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()


def _upload_to_oss(tmp_path: str, oss_key: str):
    try:
        import oss2
    except ImportError:
        logger.error("oss2 未安装，请在 venv 内执行 pip install oss2")
        sys.exit(1)

    auth = oss2.Auth(OSS_AK_ID, OSS_AK_SECRET)
    bucket = oss2.Bucket(auth, OSS_ENDPOINT, OSS_BUCKET)
    bucket.put_object_from_file(oss_key, tmp_path)


def main():
    _check_env()

    if not DB_PATH.exists():
        logger.error("数据库文件不存在：%s", DB_PATH)
        sys.exit(1)

    date_str = datetime.now().strftime("%Y%m%d")
    oss_key  = f"{BACKUP_PREFIX}/comments-{date_str}.db"

    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        logger.info("开始快照：%s", DB_PATH)
        _sqlite_backup(tmp_path)

        size_kb = Path(tmp_path).stat().st_size // 1024
        logger.info("快照完成，大小 %d KB，上传到 oss://%s/%s", size_kb, OSS_BUCKET, oss_key)

        _upload_to_oss(tmp_path, oss_key)
        logger.info("备份成功：%s", oss_key)

    except Exception as e:
        logger.error("备份失败：%s", e, exc_info=True)
        sys.exit(1)
    finally:
        try:
            Path(tmp_path).unlink()
        except OSError:
            pass


if __name__ == "__main__":
    main()
