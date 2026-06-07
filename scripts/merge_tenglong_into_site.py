import json
import re
from pathlib import Path


ROOT = Path(r"d:\港科广\自学\砖皮鉴赏\砖皮百科")
SITE = ROOT / "site"


def read_js_array(path: Path, prefix: str):
    text = path.read_text(encoding="utf-8")
    body = text.strip()
    if not body.startswith(prefix):
        raise ValueError(f"Unexpected format in {path}")
    start = body.find("[")
    end = body.rfind("]")
    return json.loads(body[start : end + 1])


def write_js(path: Path, left: str, value):
    dumped = json.dumps(value, ensure_ascii=False, indent=2)
    path.write_text(f"{left}{dumped};\n", encoding="utf-8")


def merge_meta(meta_path: Path, entries):
    original = meta_path.read_text(encoding="utf-8")
    existing_ids = set(re.findall(r'"([^"]+)"\s*:', original))
    additions = []

    for item in entries:
        item_id = item["id"]
        if item_id in existing_ids:
            continue
        # Keep names empty as requested.
        additions.append(f'  "{item_id}": {{ name: "", rating: "", comment: "" }}')

    stripped = original.rstrip()
    if not stripped.endswith("};"):
        raise ValueError("Unexpected meta.js ending")
    stripped = stripped[:-2].rstrip()
    if additions:
        if not stripped.endswith("{"):
            stripped += ",\n"
        stripped += ",\n".join(additions)
        stripped += "\n"
    stripped += "};\n"
    meta_path.write_text(stripped, encoding="utf-8")


def main():
    data_path = SITE / "data.js"
    meta_path = SITE / "meta.js"
    covers_path = SITE / "covers.js"
    records_path = SITE / "_new_tenglong_records.json"
    meta_entries_path = SITE / "_new_tenglong_meta.json"

    old_data = read_js_array(data_path, "window.SKIN_DATA =")
    covers = read_js_array(covers_path, "window.WEAPON_COVERS =")
    new_records = json.loads(records_path.read_text(encoding="utf-8"))
    new_meta = json.loads(meta_entries_path.read_text(encoding="utf-8"))

    keep_data = [x for x in old_data if x.get("weapon") != "腾龙"]
    merged_data = keep_data + new_records

    for cover in covers:
        if cover.get("weapon") == "腾龙":
            cover["enabled"] = True

    write_js(data_path, "window.SKIN_DATA = ", merged_data)
    write_js(covers_path, "window.WEAPON_COVERS = ", covers)
    merge_meta(meta_path, new_meta)

    print(f"merged tenglong records: {len(new_records)}")


if __name__ == "__main__":
    main()
