"""
砖皮图鉴本地开发服务器

功能：
- 从项目根目录提供静态文件，使 site/index.html 中 ../武器/... 的相对路径正常工作
- 提供 /api/health 和 /api/validate 接口，供前端校验按钮调用
- 启动后自动在浏览器打开图鉴页面

使用：
    python scripts/dev_server.py
    或直接双击根目录下的 启动.bat
"""

import http.server
import json
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VALIDATE_SCRIPT = ROOT / "scripts" / "validate_and_build.py"
PORT = 8765
_validate_lock = threading.Lock()
_running_proc: subprocess.Popen | None = None


class SkinWikiHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):
        pass  # 不在控制台输出每次请求

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path == "/":
            self.send_response(302)
            self.send_header("Location", "/site/index.html")
            self.end_headers()
            return
        if self.path == "/api/health":
            self._json(200, {"status": "ok"})
            return
        super().do_GET()

    def do_POST(self):
        if self.path == "/api/validate":
            self._handle_validate()
            return
        self.send_error(404)

    def _handle_validate(self):
        global _running_proc
        if not _validate_lock.acquire(blocking=False):
            self._json(409, {"ok": False, "error": "校验正在运行，请稍候"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            body: dict = {}
            if length:
                try:
                    body = json.loads(self.rfile.read(length))
                except Exception:
                    pass

            weapon: str = body.get("weapon", "")
            normalize: bool = bool(body.get("normalize", False))

            cmd = [sys.executable, str(VALIDATE_SCRIPT)]
            if weapon:
                cmd += ["--weapon", weapon]
            else:
                cmd.append("--all")
            if normalize:
                cmd.append("--normalize-folders")

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                cwd=str(ROOT),
            )

            # 读取告警文件（如果有）
            warning_lines: list[str] = []
            warning_path = ROOT / "site" / "reports" / "validate_warnings.txt"
            if warning_path.exists():
                warning_lines = [
                    l.strip() for l in warning_path.read_text(encoding="utf-8").splitlines() if l.strip()
                ]

            self._json(200, {
                "ok": result.returncode == 0,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "returncode": result.returncode,
                "warnings": warning_lines,
            })
        except Exception as exc:
            self._json(500, {"ok": False, "error": str(exc), "stdout": "", "stderr": "", "warnings": []})
        finally:
            _validate_lock.release()

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")

    def _json(self, code: int, data: dict) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    server = http.server.HTTPServer(("127.0.0.1", PORT), SkinWikiHandler)
    url = f"http://localhost:{PORT}/site/index.html"
    print(f"砖皮图鉴本地服务已启动")
    print(f"  地址: {url}")
    print(f"  根目录: {ROOT}")
    print("  按 Ctrl+C 停止")
    threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止。")


if __name__ == "__main__":
    main()
