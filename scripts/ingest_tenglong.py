import csv
import json
import re
import shutil
from pathlib import Path

from PIL import Image


ROOT = Path(r"d:\港科广\自学\砖皮鉴赏\砖皮百科")
WEAPON_DIR = ROOT / "腾龙"
SITE_DIR = ROOT / "site"

COLOR_MAP = {
    "白": "01",
    "红": "02",
    "黄": "03",
    "青": "04",
    "紫": "05",
    "棕": "06",
    "黑": "07",
    "灰": "08",
    "橙": "09",
    "绿": "10",
    "蓝": "11",
    "粉": "12",
}

QUALITY_LABEL = {"U": "优品", "J": "极品"}
MATERIAL_LABEL = {"T": "透光", "G": "贵金属", "Q": "其他", "L": "镭射", "M": "漆面", "Z": "木质"}


def parse_folder(name: str):
    # Extract serial suffix.
    serial_match = re.search(r"(\d{3})$", name)
    serial = serial_match.group(1) if serial_match else "001"
    core = name[:-3] if serial_match else name

    if len(core) < 2:
        raise ValueError(f"Invalid folder name: {name}")

    quality = core[0]
    first_material = core[1]
    rest = core[2:]

    if quality not in QUALITY_LABEL:
        raise ValueError(f"Invalid quality in folder: {name}")
    if first_material not in MATERIAL_LABEL:
        raise ValueError(f"Invalid material in folder: {name}")

    # Special case required by user:
    # UG镭射贵金属 => quality U, material LG, unknown color.
    if rest == "镭射贵金属":
        material_code = "LG"
        color_text = ""
        color_code = "1111"
    else:
        material_code = first_material
        color_text = rest
        color_code = encode_color_text(color_text)

    normalized_code = f"{quality}{material_code}{color_code}"
    target_folder = normalized_code if serial == "001" else f"{normalized_code}{serial}"
    return {
        "quality": quality,
        "material_code": material_code,
        "color_text": color_text,
        "color_code": color_code,
        "serial": serial,
        "normalized_code": normalized_code,
        "target_folder": target_folder,
    }


def encode_color_text(color_text: str):
    if not color_text:
        return "1111"
    if len(color_text) == 1 and color_text in COLOR_MAP:
        return COLOR_MAP[color_text] + "00"
    if len(color_text) == 2 and color_text[0] in COLOR_MAP and color_text[1] in COLOR_MAP:
        return COLOR_MAP[color_text[0]] + COLOR_MAP[color_text[1]]
    return "1111"


def score_outdoor(path: Path):
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


def choose_bcd(delta_files):
    deltas_sorted = sorted(delta_files, key=lambda p: p.name)
    b_file = deltas_sorted[0]
    remaining = deltas_sorted[1:]
    if len(remaining) != 2:
        return b_file, deltas_sorted[1], deltas_sorted[2], "sequence"

    scored = [(f, score_outdoor(f)) for f in remaining]
    scored.sort(key=lambda x: x[1], reverse=True)
    margin = scored[0][1] - scored[1][1]
    if margin >= 4.0:
        d_file = scored[0][0]
        c_file = scored[1][0]
        return b_file, c_file, d_file, "content+sequence"

    return b_file, remaining[0], remaining[1], "sequence"


def crop_image(src: Path, dst: Path, left_pct: float, top_pct: float, right_pct: float, bottom_pct: float):
    img = Image.open(src)
    try:
        width, height = img.size
        left = round(width * left_pct)
        top = round(height * top_pct)
        right = round(width * right_pct)
        bottom = round(height * bottom_pct)
        cropped = img.crop((left, top, width - right, height - bottom))
        cropped.save(dst, "PNG")
    finally:
        img.close()


def main():
    folders = sorted([p for p in WEAPON_DIR.iterdir() if p.is_dir()], key=lambda p: p.name)
    entries = []
    for folder in folders:
        parsed = parse_folder(folder.name)
        entries.append({"old_folder": folder.name, "old_path": folder, **parsed})

    # Rename folders to standardized format.
    for entry in entries:
        new_path = WEAPON_DIR / entry["target_folder"]
        entry["new_path"] = new_path
        if entry["old_path"].name == entry["target_folder"]:
            continue
        if new_path.exists():
            raise RuntimeError(f"Target folder exists: {new_path}")
        entry["old_path"].rename(new_path)
        entry["old_path"] = new_path

    records = []
    metas = []
    mapping_rows = []

    for entry in entries:
        folder = entry["new_path"]
        serial = entry["serial"]
        normalized_code = entry["normalized_code"]
        skin_id = f"腾龙-{normalized_code}-{serial}"

        snipaste_files = sorted(folder.glob("Snipaste_*.png"), key=lambda p: p.name)
        delta_files = sorted(folder.glob("Delta Force Screenshot*.png"), key=lambda p: p.name)

        status = "ready"
        b_file = c_file = d_file = None
        bcd_rule = "sequence"
        if len(snipaste_files) < 1 or len(delta_files) < 3:
            status = "incomplete"
        else:
            b_file, c_file, d_file, bcd_rule = choose_bcd(delta_files[:3])
            shutil.copy2(snipaste_files[0], folder / f"{skin_id}_A.png")
            crop_image(b_file, folder / f"{skin_id}_B.png", 0.15, 0.10, 0.06, 0.18)
            crop_image(c_file, folder / f"{skin_id}_C.png", 0.0, 0.022, 0.0, 0.0)
            crop_image(d_file, folder / f"{skin_id}_D.png", 0.0, 0.022, 0.0, 0.0)

        records.append(
            {
                "id": skin_id,
                "folderCode": folder.name,
                "normalizedCode": normalized_code,
                "weapon": "腾龙",
                "serial": serial,
                "imageA": f"../腾龙/{folder.name}/{skin_id}_A.png",
                "imageB": f"../腾龙/{folder.name}/{skin_id}_B.png",
                "imageC": f"../腾龙/{folder.name}/{skin_id}_C.png",
                "imageD": f"../腾龙/{folder.name}/{skin_id}_D.png",
                "status": status,
            }
        )

        # Leave display names empty as requested.
        metas.append({"id": skin_id, "name": "", "rating": "", "comment": ""})

        material_label = " + ".join(MATERIAL_LABEL.get(c, c) for c in entry["material_code"])
        mapping_rows.append(
            {
                "oldFolder": entry["old_folder"],
                "newFolder": folder.name,
                "id": skin_id,
                "normalizedCode": normalized_code,
                "serial": serial,
                "qualityLabel": QUALITY_LABEL.get(entry["quality"], ""),
                "materialLabel": material_label,
                "colorText": entry["color_text"] or "未知",
                "colorCode": entry["color_code"],
                "status": status,
                "bcdRule": bcd_rule,
                "sourceB": b_file.name if b_file else "",
                "sourceC": c_file.name if c_file else "",
                "sourceD": d_file.name if d_file else "",
            }
        )

    index_path = WEAPON_DIR / "tenglong_index_step1.csv"
    with index_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "id",
                "folderCode",
                "normalizedCode",
                "weapon",
                "serial",
                "imageA",
                "imageB",
                "imageC",
                "imageD",
                "status",
            ],
        )
        writer.writeheader()
        writer.writerows(records)

    mapping_path = WEAPON_DIR / "tenglong_folder_mapping.csv"
    with mapping_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "oldFolder",
                "newFolder",
                "id",
                "normalizedCode",
                "serial",
                "qualityLabel",
                "materialLabel",
                "colorText",
                "colorCode",
                "status",
                "bcdRule",
                "sourceB",
                "sourceC",
                "sourceD",
            ],
        )
        writer.writeheader()
        writer.writerows(mapping_rows)

    (SITE_DIR / "_new_tenglong_records.json").write_text(
        json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (SITE_DIR / "_new_tenglong_meta.json").write_text(
        json.dumps(metas, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"generated records: {len(records)}")
    print(f"index: {index_path}")
    print(f"mapping: {mapping_path}")


if __name__ == "__main__":
    main()
