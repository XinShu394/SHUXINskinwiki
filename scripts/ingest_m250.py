"""
M250 皮肤图片标准化脚本

对 M250/ 目录下每个皮肤文件夹：
- Snipaste_*.png        -> M250-{id}_A.png  （不裁剪）
- Delta Force Screenshot（按文件名升序）
    第1张 -> _B.png  （左15%/上10%/右6%/下18%）
    第2张 -> _C.png  （仅上裁 2.2%）
    第3张 -> _D.png  （仅上裁 2.2%）

用法：
  python scripts/ingest_m250.py              # 处理所有文件夹
  python scripts/ingest_m250.py --folder UGL   # 只处理指定文件夹
  python scripts/ingest_m250.py --dry-run       # 仅预览，不写文件
"""

import argparse
import re
import shutil
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("缺少依赖：pip install Pillow")

ROOT = Path(__file__).resolve().parents[1]
M250_DIR = ROOT / "M250"

QUALITY_LABEL = {"U": "优品", "J": "极品"}
MATERIAL_LABEL = {"T", "G", "Q", "L", "M", "Z"}
COLOR_MAP = {
    "白": "01", "红": "02", "黄": "03", "青": "04",
    "紫": "05", "棕": "06", "黑": "07", "灰": "08",
    "橙": "09", "绿": "10", "蓝": "11", "粉": "12",
}
IGNORED = {"上方教程", "_archive", "_raw_backup", "__pycache__"}

# 裁剪参数
CROP_B = {"left": 0.15, "top": 0.10, "right": 0.06, "bottom": 0.18}
CROP_CD = {"top": 0.022}


def parse_material_color_core(name: str) -> tuple[str, str]:
    """解析文件夹名 -> (normalizedCode, serial)"""
    serial_match = re.search(r"(\d{3})$", name)
    serial = serial_match.group(1) if serial_match else "001"
    core = name[:-3] if serial_match else name

    if len(core) < 2:
        raise ValueError(f"目录太短: {name}")

    quality = core[0]
    if quality not in QUALITY_LABEL:
        raise ValueError(f"品级不合法: {name}")

    pos = 1
    materials: list[str] = []
    while pos < len(core) and core[pos] in MATERIAL_LABEL and len(materials) < 2:
        materials.append(core[pos])
        pos += 1
    if not materials:
        raise ValueError(f"材质不合法: {name}")

    color_text = core[pos:]
    if not color_text:
        color_code = "1111"
    elif len(color_text) == 1 and color_text in COLOR_MAP:
        color_code = COLOR_MAP[color_text] + "00"
    elif len(color_text) == 2 and color_text[0] in COLOR_MAP and color_text[1] in COLOR_MAP:
        color_code = COLOR_MAP[color_text[0]] + COLOR_MAP[color_text[1]]
    else:
        raise ValueError(f"颜色无法解析: {name!r}")

    return f"{quality}{''.join(materials)}{color_code}", serial


def crop_image(src: Path, dst: Path, slot: str, dry_run: bool) -> None:
    if dry_run:
        print(f"    [dry] {slot}: {src.name} -> {dst.name}")
        return
    img = Image.open(src)
    w, h = img.size
    if slot == "B":
        left   = int(w * CROP_B["left"])
        top    = int(h * CROP_B["top"])
        right  = w - int(w * CROP_B["right"])
        bottom = h - int(h * CROP_B["bottom"])
        img = img.crop((left, top, right, bottom))
    elif slot in ("C", "D"):
        top = int(h * CROP_CD["top"])
        img = img.crop((0, top, w, h))
    img.save(dst)
    print(f"    {slot}: {src.name} -> {dst.name}")


def process_folder(folder: Path, dry_run: bool) -> bool:
    name = folder.name
    base_name = name.split("__")[0] if "__" in name else name

    try:
        normalized_code, serial = parse_material_color_core(base_name)
    except ValueError as e:
        print(f"  [跳过] {name}: {e}")
        return False

    skin_id = f"M250-{normalized_code}-{serial}"
    print(f"  {name} -> {skin_id}")

    snipastes = sorted(folder.glob("Snipaste_*.png"))
    deltas = sorted(folder.glob("Delta Force Screenshot*.png"))

    errors = []
    if not snipastes:
        errors.append("缺少 Snipaste 图（A 位）")
    if len(deltas) < 3:
        errors.append(f"Delta Force 截图不足3张（当前 {len(deltas)} 张，需 B/C/D）")

    if errors:
        for e in errors:
            print(f"    [错误] {e}")
        return False

    # A：直接复制 Snipaste（不裁剪）
    dst_a = folder / f"{skin_id}_A.png"
    if dry_run:
        print(f"    [dry] A: {snipastes[0].name} -> {dst_a.name}")
    else:
        shutil.copy2(snipastes[0], dst_a)
        print(f"    A: {snipastes[0].name} -> {dst_a.name}")

    # B/C/D：裁剪三张 Delta 截图
    for slot, src in zip(("B", "C", "D"), deltas[:3]):
        dst = folder / f"{skin_id}_{slot}.png"
        crop_image(src, dst, slot, dry_run)

    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="M250 皮肤图片标准化")
    parser.add_argument("--folder", help="只处理指定文件夹名（如 UGL）")
    parser.add_argument("--dry-run", action="store_true", help="仅预览，不写文件")
    args = parser.parse_args()

    if not M250_DIR.exists():
        sys.exit(f"目录不存在: {M250_DIR}")

    if args.folder:
        targets = [M250_DIR / args.folder]
        missing = [t for t in targets if not t.is_dir()]
        if missing:
            sys.exit(f"文件夹不存在: {missing[0]}")
    else:
        targets = sorted([p for p in M250_DIR.iterdir() if p.is_dir() and p.name not in IGNORED])

    ok = 0
    fail = 0
    print(f"{'[dry-run] ' if args.dry_run else ''}处理 {len(targets)} 个文件夹...\n")
    for folder in targets:
        if process_folder(folder, args.dry_run):
            ok += 1
        else:
            fail += 1

    print(f"\n完成：{ok} 成功，{fail} 跳过/失败")


if __name__ == "__main__":
    main()
