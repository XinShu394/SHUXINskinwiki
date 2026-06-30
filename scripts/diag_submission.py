#!/usr/bin/env python3
"""审核失败诊断：读 submissions 表并模拟 folderCode → skin_id 解析。

用法（在 ECS 项目根目录）：
  python scripts/diag_submission.py --db server/comments.db
  python scripts/diag_submission.py --db server/comments.db --id 12
  python scripts/diag_submission.py --db server/comments.db --id 12 --folder UZ0108
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from validate_and_build import load_weapon_rules, parse_folder  # noqa: E402


def suggest_folder_code(weapon: str, quality: str, material: str, color1: str, color2: str) -> str:
    """与 site/review.js suggestFolder 对齐的简化版（非 KC17/模板枪）。"""
    quality_codes = {"优品": "U", "极品": "J"}
    material_codes = {
        "贵金属": "G", "透光": "T", "镭射": "L", "漆面": "M", "木质": "Z", "其他": "Q",
        "玉石": "Y", "钻石": "D", "水晶": "C", "镭射贵金属": "LG",
    }
    color_codes = {
        "白": "01", "红": "02", "黄": "03", "青": "04", "紫": "05", "棕": "06",
        "黑": "07", "灰": "08", "橙": "09", "绿": "10", "蓝": "11", "粉": "12", "炫彩": "1111",
    }
    q = quality_codes.get(quality or "", "")
    if not q:
        return ""
    parts = (material or "").split("+")
    m_code = "".join(material_codes.get(p.strip(), "?") for p in parts if p.strip())
    if not m_code:
        return ""
    if not color1:
        return q + m_code + "????"
    if color1 == "炫彩":
        return q + m_code + "1111"
    c1 = color_codes.get(color1, "??")
    c2 = color_codes.get(color2, "00") if color2 and color2 not in ("", "单色") else "00"
    return q + m_code + c1 + c2


def check_deploy() -> list[str]:
    lines: list[str] = []
    vb = ROOT / "scripts" / "validate_and_build.py"
    text = vb.read_text(encoding="utf-8") if vb.exists() else ""
    if "def parse_asval_folder" in text:
        lines.append(f"OK  validate_and_build.py 含 parse_asval_folder ({vb})")
    else:
        lines.append(f"!!  validate_and_build.py 缺少 parse_asval_folder — 需 git pull ({vb})")
    cfg = ROOT / "scripts" / "config" / "weapon_rules.json"
    if cfg.exists():
        rules = load_weapon_rules(cfg)
        asval = next((r for r in rules if r.weapon == "ASVAL"), None)
        if asval:
            lines.append(f"OK  ASVAL mode={asval.mode}")
        else:
            lines.append("!!  weapon_rules.json 无 ASVAL 条目")
    else:
        lines.append(f"!!  缺少 {cfg}")
    return lines


def diag_row(row: sqlite3.Row, folder_override: str | None, rules) -> None:
    sub_id = row["id"]
    weapon = row["weapon"]
    print(f"\n{'='*60}")
    print(f"投稿 #{sub_id}  status={row['status']}  weapon={weapon!r}")
    print(f"  skin_name={row['skin_name']!r}")
    print(f"  quality={row['quality']!r}  material={row['material']!r}")
    print(f"  color1={row['color1']!r}  color2={row['color2']!r}")
    if "approved_skin_id" in row.keys():
        print(f"  approved_skin_id={row['approved_skin_id']!r}")
    suggested = suggest_folder_code(
        weapon, row["quality"] or "", row["material"] or "",
        row["color1"] or "", row["color2"] or "",
    )
    print(f"  建议目录码: {suggested or '(无法生成)'}")
    folder = folder_override or suggested
    if not folder:
        print("  跳过解析：无 folder 参数且无法生成建议码")
        return
    print(f"  测试目录码: {folder!r}")
    rule = next((r for r in rules if r.weapon == weapon), None)
    if not rule:
        print(f"  !! weapon_rules 无 {weapon!r}")
        return
    print(f"  规则 mode={rule.mode}")
    try:
        parsed = parse_folder(rule, folder.split("__", 1)[0].strip())
        print(f"  OK  skin_id={parsed.skin_id}")
        print(f"      normalized={parsed.normalized_code}  serial={parsed.serial}")
        print(f"      labels: {parsed.quality_label} / {parsed.material_label} / {parsed.color_label}")
        core = folder.split("__", 1)[0].strip()
        candidate = core + "100"
        p100 = parse_folder(rule, candidate)
        print(f"  审核补号预览: {candidate!r} -> {p100.skin_id}")
    except Exception as exc:
        print(f"  !! 解析失败: {exc}")


def main() -> int:
    parser = argparse.ArgumentParser(description="诊断投稿审核 folderCode 解析")
    parser.add_argument("--db", default=str(ROOT / "server" / "comments.db"), help="comments.db 路径")
    parser.add_argument("--id", type=int, help="指定投稿 id")
    parser.add_argument("--folder", help="覆盖测试的 folderCode")
    parser.add_argument("--status", default="pending_review", help="筛选状态，默认 pending_review")
    args = parser.parse_args()

    db_path = Path(args.db)
    print("部署检查:")
    for line in check_deploy():
        print(" ", line)

    if not db_path.exists():
        print(f"\n!! 数据库不存在: {db_path}")
        return 1

    rules = load_weapon_rules(ROOT / "scripts" / "config" / "weapon_rules.json")
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    if args.id:
        row = conn.execute("SELECT * FROM submissions WHERE id=?", (args.id,)).fetchone()
        if not row:
            print(f"\n!! submissions 无 id={args.id}")
            return 1
        diag_row(row, args.folder, rules)
    else:
        rows = conn.execute(
            "SELECT * FROM submissions WHERE status=? ORDER BY created_at DESC LIMIT 10",
            (args.status,),
        ).fetchall()
        print(f"\n最近 {len(rows)} 条 status={args.status!r} 的投稿:")
        if not rows:
            print("  (无记录)")
        for row in rows:
            diag_row(row, args.folder, rules)
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
