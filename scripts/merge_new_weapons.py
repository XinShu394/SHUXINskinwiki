import json
import re
from pathlib import Path


ROOT = Path(r"d:\港科广\自学\砖皮鉴赏\砖皮百科")
SITE = ROOT / "site"


def read_js_wrapped_array(path: Path, prefix: str):
    text = path.read_text(encoding="utf-8")
    body = text.strip()
    if not body.startswith(prefix):
        raise ValueError(f"Unexpected format in {path}")
    arr_start = body.find("[")
    arr_end = body.rfind("]")
    return json.loads(body[arr_start : arr_end + 1])


def write_js(path: Path, left: str, value):
    dumped = json.dumps(value, ensure_ascii=False, indent=2)
    path.write_text(f"{left}{dumped};\n", encoding="utf-8")


def main():
    data_path = SITE / "data.js"
    meta_path = SITE / "meta.js"
    covers_path = SITE / "covers.js"
    new_records_path = SITE / "_new_weapon_records.json"
    new_meta_path = SITE / "_new_weapon_meta.json"

    old_data = read_js_wrapped_array(data_path, "window.SKIN_DATA =")
    old_meta_text = meta_path.read_text(encoding="utf-8")
    covers = read_js_wrapped_array(covers_path, "window.WEAPON_COVERS =")
    new_records = json.loads(new_records_path.read_text(encoding="utf-8-sig"))
    new_meta = json.loads(new_meta_path.read_text(encoding="utf-8-sig"))

    keep_data = [x for x in old_data if x.get("weapon") not in {"SCARH", "Vector"}]
    merged_data = keep_data + new_records

    existing_ids = set(re.findall(r'"([^"]+)"\s*:', old_meta_text))
    additions = []
    for item in new_meta:
        item_id = item["id"]
        if item_id in existing_ids:
            continue
        name = item.get("name", "").replace("\\", "\\\\").replace('"', '\\"')
        rating = item.get("rating", "").replace("\\", "\\\\").replace('"', '\\"')
        comment = item.get("comment", "").replace("\\", "\\\\").replace('"', '\\"')
        additions.append(f'  "{item_id}": {{ name: "{name}", rating: "{rating}", comment: "{comment}" }}')

    for cover in covers:
      if cover.get("weapon") in {"SCARH", "Vector"}:
          cover["enabled"] = True

    write_js(data_path, "window.SKIN_DATA = ", merged_data)

    stripped = old_meta_text.rstrip()
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

    write_js(covers_path, "window.WEAPON_COVERS = ", covers)


if __name__ == "__main__":
    main()
