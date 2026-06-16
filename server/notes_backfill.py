#!/usr/bin/env python3
"""
投稿心得历史回填工具（submissions.notes -> submissions.approved_skin_id）

命令：
  1) 审计基线（只读）：
     python server/notes_backfill.py audit --db /var/www/zpbk/server/comments.db

  2) 生成 dry-run 报告（只读）：
     python server/notes_backfill.py dry-run --db /var/www/zpbk/server/comments.db --repo-root /var/www/zpbk --out-prefix /var/www/zpbk/server/reports/notes_backfill

  3) 执行回填（仅 exact_one，含备份+事务）：
     python server/notes_backfill.py apply --db /var/www/zpbk/server/comments.db --exact-file /var/www/zpbk/server/reports/notes_backfill_exact_one.csv --backup-dir /var/www/zpbk/server/backups --yes
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import shutil
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple


@dataclass
class SkinRecord:
    skin_id: str
    weapon: str
    name_norm: str
    quality_norm: str
    material_norm: str
    color_norm: str


COLOR_MAP = {
    "白": "白色",
    "红": "红色",
    "黄": "黄色",
    "青": "青色",
    "紫": "紫色",
    "棕": "棕色",
    "黑": "黑色",
    "灰": "灰色",
    "橙": "橙色",
    "绿": "绿色",
    "蓝": "蓝色",
    "粉": "粉色",
    "白色": "白色",
    "红色": "红色",
    "黄色": "黄色",
    "青色": "青色",
    "紫色": "紫色",
    "棕色": "棕色",
    "黑色": "黑色",
    "灰色": "灰色",
    "橙色": "橙色",
    "绿色": "绿色",
    "蓝色": "蓝色",
    "粉色": "粉色",
    "炫彩": "炫彩",
}

QUALITY_MAP = {
    "U": "优品",
    "J": "极品",
    "优品": "优品",
    "极品": "极品",
}


def normalize_text(value: str) -> str:
    s = (value or "").strip().lower()
    s = re.sub(r"\s+", "", s)
    s = s.replace("（", "(").replace("）", ")")
    return s


def normalize_quality(value: str) -> str:
    return QUALITY_MAP.get((value or "").strip(), (value or "").strip())


def normalize_color_value(value: str) -> str:
    v = (value or "").strip()
    if not v:
        return ""
    if v in ("1111", "未知配色"):
        return "炫彩"
    return COLOR_MAP.get(v, v)


def normalize_color_pair(color1: str, color2: str) -> str:
    c1 = normalize_color_value(color1)
    c2 = normalize_color_value(color2)
    if not c1 and not c2:
        return ""
    if c1 == "炫彩" or c2 == "炫彩":
        return "炫彩"
    if not c2 or c2 in ("00", "单色"):
        return c1
    return f"{c1}+{c2}"


def normalize_color_label(label: str) -> str:
    s = (label or "").strip()
    if not s:
        return ""
    if "未知配色" in s or "炫彩" in s:
        return "炫彩"
    parts = [normalize_color_value(p.strip()) for p in re.split(r"[+＋]", s)]
    parts = [p for p in parts if p]
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0]
    return f"{parts[0]}+{parts[1]}"


def normalize_material(value: str) -> str:
    s = (value or "").strip()
    if not s:
        return ""
    tokens = [t.strip() for t in re.split(r"[+＋/|,，]", s) if t.strip()]
    mapped: List[str] = []
    for t in tokens:
        if t in ("LG", "镭射贵金属"):
            mapped.append("镭射贵金属")
        elif t in ("L", "镭射"):
            mapped.append("镭射")
        elif t in ("G", "贵金属"):
            mapped.append("贵金属")
        elif t in ("T", "透光"):
            mapped.append("透光")
        elif t in ("Q", "其他"):
            mapped.append("其他")
        elif t in ("M", "漆面"):
            mapped.append("漆面")
        elif t in ("Z", "木质"):
            mapped.append("木质")
        elif t in ("Y", "玉石"):
            mapped.append("玉石")
        elif t in ("D", "钻石"):
            mapped.append("钻石")
        elif t in ("C", "水晶"):
            mapped.append("水晶")
        elif t in ("J", "结构光"):
            mapped.append("结构光")
        else:
            mapped.append(t)
    if len(mapped) == 2 and set(mapped) == {"镭射", "贵金属"}:
        return "镭射贵金属"
    return "+".join(sorted(set(mapped)))


def load_meta_names(meta_path: Path) -> Dict[str, str]:
    content = meta_path.read_text(encoding="utf-8")
    pattern = re.compile(r'"([^"]+)"\s*:\s*\{\s*name:\s*"([^"]*)"')
    return {m.group(1): m.group(2) for m in pattern.finditer(content)}


def load_skin_records(repo_root: Path) -> List[SkinRecord]:
    data_dir = repo_root / "site" / "data"
    meta_path = repo_root / "site" / "meta.js"
    meta_names = load_meta_names(meta_path)
    records: List[SkinRecord] = []

    for path in sorted(data_dir.glob("*.js")):
        content = path.read_text(encoding="utf-8")
        left = content.find("[")
        right = content.rfind("]")
        if left < 0 or right < 0 or right <= left:
            continue
        arr = json.loads(content[left : right + 1])
        for item in arr:
            skin_id = item.get("id", "")
            if not skin_id:
                continue
            name = meta_names.get(skin_id, "")
            records.append(
                SkinRecord(
                    skin_id=skin_id,
                    weapon=item.get("weapon", ""),
                    name_norm=normalize_text(name),
                    quality_norm=normalize_quality(item.get("qualityLabel", "")),
                    material_norm=normalize_material(item.get("materialLabel", "")),
                    color_norm=normalize_color_label(item.get("colorLabel", "")),
                )
            )
    return records


def get_target_submissions(conn: sqlite3.Connection) -> List[sqlite3.Row]:
    conn.row_factory = sqlite3.Row
    return conn.execute(
        """
        SELECT id, weapon, skin_name, quality, material, color1, color2, notes, contributor, created_at, reviewed_at
        FROM submissions
        WHERE status='approved'
          AND notes IS NOT NULL
          AND TRIM(notes)!=''
        ORDER BY reviewed_at DESC, id DESC
        """
    ).fetchall()


def classify_candidates(
    subs: List[sqlite3.Row], skins: List[SkinRecord]
) -> Tuple[List[dict], List[dict], Dict[str, int]]:
    by_weapon: Dict[str, List[SkinRecord]] = {}
    for s in skins:
        by_weapon.setdefault(s.weapon, []).append(s)

    review_rows: List[dict] = []
    exact_rows: List[dict] = []
    summary = {"total": 0, "exact_one": 0, "multi_candidate": 0, "no_match": 0}

    for row in subs:
        summary["total"] += 1
        weapon = row["weapon"] or ""
        skin_name_norm = normalize_text(row["skin_name"] or "")
        q_norm = normalize_quality(row["quality"] or "")
        m_norm = normalize_material(row["material"] or "")
        c_norm = normalize_color_pair(row["color1"] or "", row["color2"] or "")

        candidates = by_weapon.get(weapon, [])
        name_candidates = [c for c in candidates if c.name_norm and c.name_norm == skin_name_norm]

        status = "no_match"
        matched = name_candidates

        if name_candidates:
            narrowed = name_candidates
            if q_norm:
                q_filtered = [c for c in narrowed if c.quality_norm == q_norm]
                if q_filtered:
                    narrowed = q_filtered
            if m_norm:
                m_filtered = [c for c in narrowed if c.material_norm == m_norm]
                if m_filtered:
                    narrowed = m_filtered
            if c_norm:
                c_filtered = [c for c in narrowed if c.color_norm == c_norm]
                if c_filtered:
                    narrowed = c_filtered
            matched = narrowed
            if len(matched) == 1:
                status = "exact_one"
                exact_rows.append(
                    {
                        "submission_id": row["id"],
                        "approved_skin_id": matched[0].skin_id,
                    }
                )
            else:
                status = "multi_candidate"

        summary[status] += 1
        review_rows.append(
            {
                "submission_id": row["id"],
                "weapon": weapon,
                "skin_name": row["skin_name"] or "",
                "quality": row["quality"] or "",
                "material": row["material"] or "",
                "color1": row["color1"] or "",
                "color2": row["color2"] or "",
                "notes": row["notes"] or "",
                "reviewed_at": row["reviewed_at"] or "",
                "status": status,
                "candidate_count": len(matched),
                "candidate_skin_ids": "|".join(c.skin_id for c in matched),
            }
        )
    return review_rows, exact_rows, summary


def run_audit(db_path: Path):
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cols = [r[1] for r in cur.execute("PRAGMA table_info(submissions)").fetchall()]
    has_approved_skin_id = "approved_skin_id" in cols
    stats = {
        "approved_with_notes": cur.execute(
            "SELECT COUNT(1) FROM submissions WHERE status='approved' AND notes IS NOT NULL AND TRIM(notes)!=''"
        ).fetchone()[0],
        "has_approved_skin_id_column": has_approved_skin_id,
        "approved_with_notes_and_skin_id": (
            cur.execute(
                "SELECT COUNT(1) FROM submissions WHERE status='approved' AND notes IS NOT NULL AND TRIM(notes)!='' AND approved_skin_id IS NOT NULL AND TRIM(approved_skin_id)!=''"
            ).fetchone()[0]
            if has_approved_skin_id
            else 0
        ),
    }
    conn.close()
    print(json.dumps(stats, ensure_ascii=False, indent=2))


def write_csv(path: Path, rows: List[dict]):
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def run_dry_run(db_path: Path, repo_root: Path, out_prefix: Path):
    conn = sqlite3.connect(db_path)
    submissions = get_target_submissions(conn)
    conn.close()
    skins = load_skin_records(repo_root)
    review_rows, exact_rows, summary = classify_candidates(submissions, skins)

    review_csv = Path(str(out_prefix) + "_review.csv")
    exact_csv = Path(str(out_prefix) + "_exact_one.csv")
    summary_json = Path(str(out_prefix) + "_summary.json")

    write_csv(review_csv, review_rows)
    write_csv(exact_csv, exact_rows)
    summary_json.parent.mkdir(parents=True, exist_ok=True)
    summary_json.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"review_csv={review_csv}")
    print(f"exact_csv={exact_csv}")
    print(f"summary_json={summary_json}")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def run_apply(db_path: Path, exact_file: Path, backup_dir: Path, yes: bool):
    if not yes:
        raise SystemExit("apply 模式必须显式传 --yes")
    if not exact_file.exists():
        raise SystemExit(f"exact 文件不存在: {exact_file}")

    mapping_rows = []
    with exact_file.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            submission_id = int(row["submission_id"])
            approved_skin_id = (row["approved_skin_id"] or "").strip()
            if approved_skin_id:
                mapping_rows.append((submission_id, approved_skin_id))

    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = backup_dir / f"comments.db.backup-{stamp}"
    shutil.copy2(db_path, backup_path)
    print(f"backup={backup_path}")

    conn = sqlite3.connect(db_path)
    try:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(submissions)").fetchall()]
        if "approved_skin_id" not in cols:
            raise SystemExit("submissions 缺少 approved_skin_id 列，请先重启 API 或手工执行迁移。")
        conn.execute("BEGIN IMMEDIATE")
        updated = 0
        for submission_id, skin_id in mapping_rows:
            cur = conn.execute(
                """
                UPDATE submissions
                SET approved_skin_id = ?
                WHERE id = ?
                  AND status='approved'
                  AND notes IS NOT NULL
                  AND TRIM(notes)!=''
                  AND (approved_skin_id IS NULL OR TRIM(approved_skin_id)='')
                """,
                (skin_id, submission_id),
            )
            updated += cur.rowcount
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    print(json.dumps({"attempted": len(mapping_rows), "updated": updated}, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description="回填 submissions.approved_skin_id 工具")
    sub = parser.add_subparsers(dest="command", required=True)

    p_audit = sub.add_parser("audit", help="只读审计")
    p_audit.add_argument("--db", required=True, type=Path)

    p_dry = sub.add_parser("dry-run", help="生成只读匹配报告")
    p_dry.add_argument("--db", required=True, type=Path)
    p_dry.add_argument("--repo-root", required=True, type=Path)
    p_dry.add_argument("--out-prefix", required=True, type=Path)

    p_apply = sub.add_parser("apply", help="按 exact_one 回填（事务）")
    p_apply.add_argument("--db", required=True, type=Path)
    p_apply.add_argument("--exact-file", required=True, type=Path)
    p_apply.add_argument("--backup-dir", required=True, type=Path)
    p_apply.add_argument("--yes", action="store_true")

    args = parser.parse_args()
    if args.command == "audit":
        run_audit(args.db)
    elif args.command == "dry-run":
        run_dry_run(args.db, args.repo_root, args.out_prefix)
    elif args.command == "apply":
        run_apply(args.db, args.exact_file, args.backup_dir, args.yes)


if __name__ == "__main__":
    main()
