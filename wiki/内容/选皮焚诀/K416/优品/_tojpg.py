"""把超过 3 MB 的整枪截图压成宽 1600 的 JPG。"""
from pathlib import Path

from PIL import Image

folder = Path(__file__).resolve().parent
limit = 3 * 1024 * 1024

for src in folder.glob("*.png"):
    if src.stat().st_size < limit:
        continue
    image = Image.open(src).convert("RGB")
    width, height = image.size
    if width > 1600:
        height = round(height * 1600 / width)
        width = 1600
        image = image.resize((width, height), Image.Resampling.LANCZOS)
    out = src.with_suffix(".jpg")
    image.save(out, "JPEG", quality=85, optimize=True)
    print(f"{src.name} -> {out.name} {out.stat().st_size} {width}x{height}")
    src.unlink()
