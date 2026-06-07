import csv
import json
import re
import shutil
from pathlib import Path

from PIL import Image


ROOT = Path(r"d:\港科广\自学\砖皮鉴赏\砖皮百科")
QBZ95_DIR = ROOT / "QBZ95"
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

QUALITY_LABEL = {"J": "极品"}
MATERIAL_LABEL = {"T": "透光", "G": "贵金属", "Q": "其他", "L": "镭射", "M": "漆面", "Z": "木质"}

DISPLAY_NAME_POOL = {
    "JG0100": ["霜曜白"],
    "JG1200": ["樱曜粉"],
    "JQ0900": ["日落橙", "炽霞橙"],
    "JQ0910": ["琥珀绿"],
    "JQ0911": ["裂空蓝", "星潮蓝", "暮海蓝", "极光蓝"],
    "JQ0800": ["钢雾灰"],
    "JQ0809": ["烟砂橙", "灰烬橙"],
    "JQ0802": ["熔铁红"],
    "JQ0810": ["苔原绿"],
    "JQ0811": ["寒川蓝", "霜夜蓝"],
    "JQ0112": ["云樱粉", "晨樱粉", "雪莓粉"],
    "JQ0110": ["雪芽绿"],
    "JQ0111": ["天穹蓝", "雪境蓝", "冰川蓝", "银翼蓝"],
    "JQ0508": ["暮烟紫"],
    "JQ0512": ["幻樱紫", "霞雾紫"],
    "JQ0510": ["紫藤绿"],
    "JQ0208": ["赤雾灰", "烽火灰"],
    "JQ0211": ["霓火蓝"],
    "JQ0204": ["绯青色"],
    "JQ1011": ["碧潮蓝"],
    "JQ1112": ["梦境粉", "星纱粉"],
    "JQ0409": ["青焰橙"],
    "JQ0310": ["春岚绿"],
}


def parse_folder_name(name: str):
    # Supports one or two material codes after quality, e.g. JQ白粉 / JLZ白粉
    if not name.startswith("J"):
        raise ValueError(f"Invalid QBZ95 folder name: {name}")

    serial_match = re.search(r"(\d{3})$", name)
    serial = serial_match.group(1) if serial_match else "001"
    body = name[1 : -3] if serial_match else name[1:]

    codes = []
    while body and len(codes) < 2 and body[0] in MATERIAL_LABEL:
        codes.append(body[0])
        body = body[1:]

    if not codes or not body:
        raise ValueError(f"Invalid QBZ95 folder name: {name}")

    material = "".join(codes)
    color_text = body
    return material, color_text, serial


def encode_colors(color_text: str):
    if len(color_text) == 1:
        c1 = COLOR_MAP[color_text]
        c2 = "00"
    elif len(color_text) == 2:
        c1 = COLOR_MAP[color_text[0]]
        c2 = COLOR_MAP[color_text[1]]
    else:
        raise ValueError(f"Unsupported color text: {color_text}")
    return c1 + c2


def pick_display_name(normalized_code: str, serial: str, color_text: str):
    candidates = DISPLAY_NAME_POOL.get(normalized_code, [])
    index = max(int(serial) - 1, 0)
    if index < len(candidates):
        return candidates[index]
    if candidates:
        return f"{candidates[-1]}{serial}"
    return color_text


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


def choose_bcd(delta_files):
    deltas_sorted = sorted(delta_files, key=lambda p: p.name)
    b_file = deltas_sorted[0]
    remaining = deltas_sorted[1:]
    if len(remaining) != 2:
        return b_file, deltas_sorted[1], deltas_sorted[2], False

    scored = [(f, score_outdoor(f)) for f in remaining]
    scored.sort(key=lambda x: x[1], reverse=True)
    margin = scored[0][1] - scored[1][1]
    if margin >= 4.0:
        d_file = scored[0][0]
        c_file = scored[1][0]
        return b_file, c_file, d_file, True

    return b_file, remaining[0], remaining[1], False


def main():
    if not QBZ95_DIR.exists():
        raise FileNotFoundError(QBZ95_DIR)

    folder_entries = []
    for folder in sorted([p for p in QBZ95_DIR.iterdir() if p.is_dir()], key=lambda p: p.name):
        material, color_text, serial = parse_folder_name(folder.name)
        color_code = encode_colors(color_text)
        normalized_code = f"J{material}{color_code}"
        target_folder_name = normalized_code if serial == "001" else f"{normalized_code}{serial}"
        folder_entries.append(
            {
                "old_name": folder.name,
                "old_path": folder,
                "new_name": target_folder_name,
                "new_path": QBZ95_DIR / target_folder_name,
                "material": material,
                "color_text": color_text,
                "serial": serial,
                "normalized_code": normalized_code,
            }
        )

    # Stage 1: rename folders.
    for item in folder_entries:
        if item["old_name"] == item["new_name"]:
            continue
        if item["new_path"].exists():
            raise RuntimeError(f"Target folder already exists: {item['new_path']}")
        item["old_path"].rename(item["new_path"])
        item["old_path"] = item["new_path"]

    records = []
    metas = []
    mapping_rows = []

    for item in folder_entries:
        folder = item["new_path"]
        normalized_code = item["normalized_code"]
        serial = item["serial"]
        color_text = item["color_text"]
        material = item["material"]
        folder_code = item["new_name"]
        skin_id = f"QBZ95-{normalized_code}-{serial}"

        snipaste_files = sorted(folder.glob("Snipaste_*.png"), key=lambda p: p.name)
        delta_files = sorted(folder.glob("Delta Force Screenshot*.png"), key=lambda p: p.name)

        status = "ready"
        used_rule = "sequence"
        if len(snipaste_files) < 1 or len(delta_files) < 3:
            status = "incomplete"
            b_file = c_file = d_file = None
        else:
            b_file, c_file, d_file, by_content = choose_bcd(delta_files[:3])
            if by_content:
                used_rule = "content+sequence"
            # A
            shutil.copy2(snipaste_files[0], folder / f"{skin_id}_A.png")
            # B/C/D
            crop_image(b_file, folder / f"{skin_id}_B.png", 0.15, 0.10, 0.06, 0.18)
            crop_image(c_file, folder / f"{skin_id}_C.png", 0.0, 0.022, 0.0, 0.0)
            crop_image(d_file, folder / f"{skin_id}_D.png", 0.0, 0.022, 0.0, 0.0)

        record = {
            "id": skin_id,
            "folderCode": folder_code,
            "normalizedCode": normalized_code,
            "weapon": "QBZ95",
            "serial": serial,
            "imageA": f"../QBZ95/{folder_code}/{skin_id}_A.png",
            "imageB": f"../QBZ95/{folder_code}/{skin_id}_B.png",
            "imageC": f"../QBZ95/{folder_code}/{skin_id}_C.png",
            "imageD": f"../QBZ95/{folder_code}/{skin_id}_D.png",
            "status": status,
        }
        records.append(record)

        metas.append(
            {
                "id": skin_id,
                "name": pick_display_name(normalized_code, serial, color_text),
                "rating": "",
                "comment": "",
            }
        )

        mapping_rows.append(
            {
                "oldFolder": item["old_name"],
                "newFolder": folder_code,
                "id": skin_id,
                "normalizedCode": normalized_code,
                "serial": serial,
                "qualityLabel": QUALITY_LABEL["J"],
                "materialLabel": " + ".join(MATERIAL_LABEL.get(c, c) for c in material),
                "colorText": color_text,
                "status": status,
                "bcdRule": used_rule,
                "sourceB": b_file.name if b_file else "",
                "sourceC": c_file.name if c_file else "",
                "sourceD": d_file.name if d_file else "",
            }
        )

    # Outputs for indexing and merge.
    index_path = QBZ95_DIR / "qbz95_index_step1.csv"
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
        for row in records:
            writer.writerow(row)

    mapping_path = QBZ95_DIR / "qbz95_folder_mapping.csv"
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
                "status",
                "bcdRule",
                "sourceB",
                "sourceC",
                "sourceD",
            ],
        )
        writer.writeheader()
        for row in mapping_rows:
            writer.writerow(row)

    (SITE_DIR / "_new_qbz95_records.json").write_text(
        json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (SITE_DIR / "_new_qbz95_meta.json").write_text(
        json.dumps(metas, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"generated records: {len(records)}")
    print(f"generated meta: {len(metas)}")
    print(f"index: {index_path}")
    print(f"mapping: {mapping_path}")


if __name__ == "__main__":
    main()
