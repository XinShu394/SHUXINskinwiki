"""本地启动 API，用来在知识库预览里试市场焚诀投稿和审核。

- 数据写进 wiki/preview/_local/，不碰 server/comments.db。
- 图片存在本地，不传 OSS。
- 审核密钥默认是 local-admin，可以用环境变量 ZPBK_ADMIN_TOKEN 改。

用法：python wiki/preview/run_api_local.py
然后打开 wiki/preview/index.html（或预览服务器）。
"""

import os
import runpy
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
LOCAL = HERE / "_local"
LOCAL.mkdir(exist_ok=True)

os.environ.setdefault("ZPBK_DB_PATH", str(LOCAL / "test.db"))
os.environ.setdefault("MARKET_LOCAL_DIR", str(LOCAL / "market"))
os.environ.setdefault("MARKET_STORAGE_MODE", "local")
os.environ.setdefault("ZPBK_ADMIN_TOKEN", "local-admin")

print(f"[本地] 数据库：{os.environ['ZPBK_DB_PATH']}")
print(f"[本地] 审核密钥：{os.environ['ZPBK_ADMIN_TOKEN']}")
sys.path.insert(0, str(ROOT / "server"))
os.chdir(ROOT / "server")
runpy.run_path(str(ROOT / "server" / "app.py"), run_name="__main__")
