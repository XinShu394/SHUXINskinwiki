import csv
import json
import re
import shutil
from pathlib import Path

from PIL import Image


ROOT = Path(r"d:\港科广\自学\砖皮鉴赏\砖皮百科")
AUG_DIR = ROOT / "AUG"
SITE_DIR = ROOT / "site"

QUALITY_LABEL = {"U": "优品", "J": "极品"}
MATERIAL_LABEL = {"T": "透光", "G": "贵金属", "Q": "其他", "L": "镭射", "M": "漆面", "Z": "木质"}


def parse_folder_name(name: str):
    # Example: UQ香芋牛奶 / UL七彩雷 / UG墨银 / ULZ模板 / UQ模板002
    m = re.fullmatch(r"([UJ])([TGQLMZ]{1,2})(.+?)(\d{3})?", name)
    if not m:
        raise ValueError(f"Invalid AUG folder name: {name}")
    quality = m.group(1)
    material = m.group(2)
    template = m.group(3)
    serial = m.group(4) or "001"
    return quality, material, template, serial


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
    records = []
    metas = []
    mapping_rows = []

    folders = sorted([p for p in AUG_DIR.iterdir() if p.is_dir()], key=lambda p: p.name)
    for folder in folders:
        quality, material, template, serial = parse_folder_name(folder.name)
        skin_id = f"AUG-{template}-{serial}"
        normalized_code = f"{quality}{material}"

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
                "weapon": "AUG",
                "serial": serial,
                "imageA": f"../AUG/{folder.name}/{skin_id}_A.png",
                "imageB": f"../AUG/{folder.name}/{skin_id}_B.png",
                "imageC": f"../AUG/{folder.name}/{skin_id}_C.png",
                "imageD": f"../AUG/{folder.name}/{skin_id}_D.png",
                "status": status,
                "template": template,
                "qualityLabel": QUALITY_LABEL.get(quality, ""),
                "materialLabel": " + ".join(MATERIAL_LABEL.get(c, c) for c in material),
                "colorLabel": "NA",
            }
        )

        metas.append({"id": skin_id, "name": template, "rating": "", "comment": ""})

        mapping_rows.append(
            {
                "folderCode": folder.name,
                "id": skin_id,
                "template": template,
                "normalizedCode": normalized_code,
                "serial": serial,
                "qualityLabel": QUALITY_LABEL.get(quality, ""),
                "materialLabel": " + ".join(MATERIAL_LABEL.get(c, c) for c in material),
                "status": status,
                "bcdRule": bcd_rule,
                "sourceB": b_file.name if b_file else "",
                "sourceC": c_file.name if c_file else "",
                "sourceD": d_file.name if d_file else "",
            }
        )

    index_path = AUG_DIR / "aug_index_step1.csv"
    with index_path.open("w", newline="", encoding="utf-8-sig") as f:
        index_fields = [
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
        ]
        writer = csv.DictWriter(
            f,
            fieldnames=index_fields,
        )
        writer.writeheader()
        writer.writerows({k: row[k] for k in index_fields} for row in records)

    mapping_path = AUG_DIR / "aug_folder_mapping.csv"
    with mapping_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "folderCode",
                "id",
                "template",
                "normalizedCode",
                "serial",
                "qualityLabel",
                "materialLabel",
                "status",
                "bcdRule",
                "sourceB",
                "sourceC",
                "sourceD",
            ],
        )
        writer.writeheader()
        writer.writerows(mapping_rows)

    (SITE_DIR / "_new_aug_records.json").write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    (SITE_DIR / "_new_aug_meta.json").write_text(json.dumps(metas, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"generated records: {len(records)}")
    print(f"index: {index_path}")
    print(f"mapping: {mapping_path}")


if __name__ == "__main__":
    main()
