"""
ASVAL 皮肤录入脚本

命名规则（与 K416/腾龙 编码模式一致，新增复合材质支持）：
  品质   U=优品  J=极品
  材质   G=贵金属  M=漆面  Z=木质  L=镭射  可复合最多2位：GL/ML/ZL
  颜色   中文→双色码  无颜色文字→1111

文件夹示例：
  UGL         → U+GL(贵金属+镭射)，无颜色 → UGL1111-001
  UGL001      → 同 UGL1111，按字母排序分配 -002
  UG白红      → U+G(贵金属)，白(01)+红(02) → UG0102-001
  UML002      → U+ML(漆面+镭射)，无颜色 → UML1111-002（排序后）

串号规则：同 normalizedCode 的文件夹按文件夹名升序排列，依次分配 001 002 003…

运行：
    python scripts/ingest_asval.py
"""

import csv
import json
import re
import shutil
from collections import defaultdict
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ASVAL_DIR = ROOT / "ASVAL"
SITE_DIR = ROOT / "site"

QUALITY_LABEL = {"U": "优品", "J": "极品"}
MATERIAL_LABEL = {"T": "透光", "G": "贵金属", "Q": "其他", "L": "镭射", "M": "漆面", "Z": "木质"}
COLOR_MAP = {
    "白": "01", "红": "02", "黄": "03", "青": "04",
    "紫": "05", "棕": "06", "黑": "07", "灰": "08",
    "橙": "09", "绿": "10", "蓝": "11", "粉": "12",
}
COLOR_LABEL = {
    "00": "单色", "01": "白色", "02": "红色", "03": "黄色",
    "04": "青色", "05": "紫色", "06": "棕色", "07": "黑色",
    "08": "灰色", "09": "橙色", "10": "绿色", "11": "蓝色", "12": "粉色",
}

IGNORED_FOLDERS = {"_archive", "_raw_backup", "上方教程"}


def parse_folder_core(name: str) -> tuple[str, str, str, str]:
    """解析文件夹名，返回 (quality, material, color_code, color_label)。"""
    if not name:
        raise ValueError("空文件夹名")

    quality = name[0]
    if quality not in QUALITY_LABEL:
        raise ValueError(f"品级字符不合法: {name!r}")

    pos = 1
    material_chars: list[str] = []
    while pos < len(name) and name[pos] in MATERIAL_LABEL and len(material_chars) < 2:
        material_chars.append(name[pos])
        pos += 1

    if not material_chars:
        raise ValueError(f"找不到材质字符: {name!r}")

    material = "".join(material_chars)
    color_text = name[pos:]

    # 剥离尾部纯数字流水后缀（如 UG白002 中的 002）
    color_core = re.sub(r"\d+$", "", color_text)

    # 纯数字或空 → 颜色未知
    if not color_core:
        return quality, material, "1111", "未知配色"

    # 单色
    if len(color_core) == 1 and color_core in COLOR_MAP:
        code = COLOR_MAP[color_core] + "00"
        label = COLOR_LABEL.get(COLOR_MAP[color_core], color_core)
        return quality, material, code, label

    # 双色
    if len(color_core) == 2 and color_core[0] in COLOR_MAP and color_core[1] in COLOR_MAP:
        c1 = COLOR_MAP[color_core[0]]
        c2 = COLOR_MAP[color_core[1]]
        label = f"{COLOR_LABEL.get(c1, color_core[0])} + {COLOR_LABEL.get(c2, color_core[1])}"
        return quality, material, c1 + c2, label

    raise ValueError(f"颜色文字无法解析: {name!r}")


def score_outdoor(path: Path) -> float:
    img = Image.open(path).convert("RGB")
    try:
        pixels = img.resize((120, 68)).getdata()
        total = len(pixels) or 1
        luma_sum = 0.0
        blue_bonus = 0.0
        for r, g, b in pixels:
            luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
            luma_sum += luma
            blue_bonus += b - (r + g) / 2.0
        return (luma_sum / total) + (blue_bonus / total) * 0.08
    finally:
        img.close()


def choose_bcd(delta_files: list[Path]) -> tuple[Path, Path, Path, str]:
    deltas = sorted(delta_files, key=lambda p: p.name)
    b_file = deltas[0]
    remaining = deltas[1:]
    if len(remaining) != 2:
        return b_file, deltas[1], deltas[2], "sequence"
    scored = sorted(remaining, key=score_outdoor, reverse=True)
    margin = score_outdoor(scored[0]) - score_outdoor(scored[1])
    if margin >= 4.0:
        return b_file, scored[1], scored[0], "content+sequence"
    return b_file, remaining[0], remaining[1], "sequence"


def crop_image(
    src: Path, dst: Path,
    left_pct: float, top_pct: float, right_pct: float, bottom_pct: float,
) -> None:
    img = Image.open(src)
    try:
        w, h = img.size
        box = (
            round(w * left_pct),
            round(h * top_pct),
            w - round(w * right_pct),
            h - round(h * bottom_pct),
        )
        img.crop(box).save(dst, "PNG")
    finally:
        img.close()


def main() -> None:
    if not ASVAL_DIR.exists():
        raise FileNotFoundError(f"ASVAL 目录不存在: {ASVAL_DIR}")

    # ── 第一阶段：解析所有文件夹，按 normalizedCode 分组 ──────────────────
    folders = sorted(
        [p for p in ASVAL_DIR.iterdir() if p.is_dir() and p.name not in IGNORED_FOLDERS],
        key=lambda p: p.name,
    )

    parse_errors: list[str] = []
    parsed_list: list[dict] = []  # [{folder, quality, material, color_code, color_label, normalized_code}]

    for folder in folders:
        try:
            quality, material, color_code, color_label = parse_folder_core(folder.name)
            normalized_code = f"{quality}{material}{color_code}"
            parsed_list.append({
                "folder": folder,
                "quality": quality,
                "material": material,
                "color_code": color_code,
                "color_label": color_label,
                "normalized_code": normalized_code,
            })
        except Exception as exc:
            parse_errors.append(f"解析失败 {folder.name}: {exc}")

    if parse_errors:
        print("── 解析错误，中止录入 ──")
        for e in parse_errors:
            print(f"  {e}")
        raise SystemExit(1)

    # 按 normalizedCode 分组，记录排序后的序号（001/002/...）
    code_to_items: dict[str, list[dict]] = defaultdict(list)
    for item in parsed_list:
        code_to_items[item["normalized_code"]].append(item)

    # 各组内已按文件夹名升序排好（因为 folders 是排序的）
    serial_map: dict[str, str] = {}  # folder.name → "001"
    for code, items in code_to_items.items():
        for idx, item in enumerate(items, start=1):
            serial_map[item["folder"].name] = f"{idx:03d}"

    # ── 第二阶段：生成 A/B/C/D 图，构建记录 ─────────────────────────────
    records: list[dict] = []
    metas: list[dict] = []
    mapping_rows: list[dict] = []

    for item in parsed_list:
        folder: Path = item["folder"]
        normalized_code: str = item["normalized_code"]
        quality: str = item["quality"]
        material: str = item["material"]
        color_label: str = item["color_label"]
        serial: str = serial_map[folder.name]
        skin_id = f"ASVAL-{normalized_code}-{serial}"

        snipaste_files = sorted(folder.glob("Snipaste_*.png"), key=lambda p: p.name)
        delta_files = sorted(folder.glob("Delta Force Screenshot*.png"), key=lambda p: p.name)

        status = "ready"
        b_file = c_file = d_file = None
        bcd_rule = "sequence"

        if len(snipaste_files) < 1 or len(delta_files) < 3:
            status = "incomplete"
            print(f"  [incomplete] {folder.name} → snip={len(snipaste_files)} delta={len(delta_files)}")
        else:
            b_file, c_file, d_file, bcd_rule = choose_bcd(delta_files[:3])
            shutil.copy2(snipaste_files[0], folder / f"{skin_id}_A.png")
            crop_image(b_file, folder / f"{skin_id}_B.png", 0.15, 0.10, 0.06, 0.18)
            crop_image(c_file, folder / f"{skin_id}_C.png", 0.0, 0.022, 0.0, 0.0)
            crop_image(d_file, folder / f"{skin_id}_D.png", 0.0, 0.022, 0.0, 0.0)

        material_label = " + ".join(MATERIAL_LABEL.get(c, c) for c in material)
        quality_label = QUALITY_LABEL.get(quality, "")

        records.append({
            "id": skin_id,
            "folderCode": folder.name,
            "normalizedCode": normalized_code,
            "weapon": "ASVAL",
            "serial": serial,
            "imageA": f"../ASVAL/{folder.name}/{skin_id}_A.png",
            "imageB": f"../ASVAL/{folder.name}/{skin_id}_B.png",
            "imageC": f"../ASVAL/{folder.name}/{skin_id}_C.png",
            "imageD": f"../ASVAL/{folder.name}/{skin_id}_D.png",
            "status": status,
            "qualityLabel": quality_label,
            "materialLabel": material_label,
            "colorLabel": color_label,
        })
        metas.append({"id": skin_id, "name": "", "rating": "", "comment": ""})
        mapping_rows.append({
            "folderCode": folder.name,
            "id": skin_id,
            "normalizedCode": normalized_code,
            "serial": serial,
            "qualityLabel": quality_label,
            "materialLabel": material_label,
            "colorLabel": color_label,
            "status": status,
            "bcdRule": bcd_rule,
            "sourceB": b_file.name if b_file else "",
            "sourceC": c_file.name if c_file else "",
            "sourceD": d_file.name if d_file else "",
        })

    # ── 输出索引与映射 CSV ───────────────────────────────────────────────
    index_fields = ["id", "folderCode", "normalizedCode", "weapon", "serial",
                    "imageA", "imageB", "imageC", "imageD", "status"]
    index_path = ASVAL_DIR / "asval_index_step1.csv"
    with index_path.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=index_fields)
        w.writeheader()
        w.writerows({k: r[k] for k in index_fields} for r in records)

    mapping_path = ASVAL_DIR / "asval_folder_mapping.csv"
    mapping_fields = ["folderCode", "id", "normalizedCode", "serial",
                      "qualityLabel", "materialLabel", "colorLabel",
                      "status", "bcdRule", "sourceB", "sourceC", "sourceD"]
    with mapping_path.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=mapping_fields)
        w.writeheader()
        w.writerows(mapping_rows)

    # ── 输出中间 JSON 供 validate_and_build 使用 ─────────────────────────
    (SITE_DIR / "_new_asval_records.json").write_text(
        json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (SITE_DIR / "_new_asval_meta.json").write_text(
        json.dumps(metas, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    ready = sum(1 for r in records if r["status"] == "ready")
    print(f"ASVAL 录入完成")
    print(f"  总计: {len(records)} 条  就绪: {ready} 条")
    print(f"  索引: {index_path}")
    print(f"  映射: {mapping_path}")
    print(f"  下一步: python scripts/validate_and_build.py --weapon ASVAL")


if __name__ == "__main__":
    main()
