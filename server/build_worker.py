"""
砖皮百科 · 异步构建 Worker
运行方式：
  python build_worker.py --once
  python build_worker.py
"""
import argparse
import os
import sqlite3
import subprocess
import time
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "comments.db"
ROOT = Path(__file__).resolve().parent.parent
POLL_SECONDS = int(os.environ.get("ZPBK_BUILD_WORKER_POLL_SECONDS", "5"))
BUILD_TIMEOUT_SECONDS = int(os.environ.get("ZPBK_BUILD_TIMEOUT_SECONDS", "300"))
PYTHON = str(Path(__file__).resolve().parent / "venv" / "bin" / "python")


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def pick_next_job():
    conn = get_db()
    conn.execute("BEGIN IMMEDIATE")
    row = conn.execute(
        "SELECT * FROM build_jobs WHERE status='queued' ORDER BY created_at ASC LIMIT 1"
    ).fetchone()
    if not row:
        conn.commit()
        conn.close()
        return None
    now = int(time.time() * 1000)
    conn.execute(
        "UPDATE build_jobs SET status='running', attempts=attempts+1, updated_at=? WHERE id=?",
        (now, row["id"]),
    )
    conn.commit()
    conn.close()
    return dict(row)


def finish_job(job_id: int, status: str, last_error: str = ""):
    conn = get_db()
    now = int(time.time() * 1000)
    conn.execute(
        "UPDATE build_jobs SET status=?, last_error=?, updated_at=? WHERE id=?",
        (status, (last_error or "")[:2000], now, job_id),
    )
    conn.commit()
    conn.close()


def mark_submissions(weapon: str, build_status: str, build_error: str = ""):
    conn = get_db()
    conn.execute(
        """UPDATE submissions
           SET build_status=?, build_error=?
           WHERE weapon=? AND status='approved' AND build_status IN ('queued','failed')""",
        (build_status, (build_error or "")[:2000], weapon),
    )
    conn.commit()
    conn.close()


def run_build_for_weapon(weapon: str):
    script = ROOT / "scripts" / "validate_and_build.py"
    source = "oss" if os.environ.get("UPLOAD_STORAGE_MODE") == "oss" else "local"
    r = subprocess.run(
        [PYTHON, str(script), "--weapon", weapon, "--source", source],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=str(ROOT),
        timeout=BUILD_TIMEOUT_SECONDS,
    )
    out = (r.stdout + r.stderr)[-2000:]
    return r.returncode == 0, out


def run_once() -> bool:
    job = pick_next_job()
    if not job:
        return False
    weapon = job["weapon"]
    ok = False
    log = ""
    try:
        ok, log = run_build_for_weapon(weapon)
    except Exception as e:
        ok = False
        log = str(e)
    if ok:
        finish_job(job["id"], "done", "")
        mark_submissions(weapon, "done", "")
        print(f"[worker] job={job['id']} weapon={weapon} done")
    else:
        finish_job(job["id"], "failed", log)
        mark_submissions(weapon, "failed", log)
        print(f"[worker] job={job['id']} weapon={weapon} failed: {log[:120]}")
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    if args.once:
        run_once()
        return
    print(f"[worker] start, poll={POLL_SECONDS}s")
    while True:
        has_job = run_once()
        if not has_job:
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
