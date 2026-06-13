import argparse
import json
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SITE_DIR = ROOT / "site"
CONFIG_DIR = ROOT / "scripts" / "config"

# 图片存储基础地址（OSS）
# 若留空则使用相对路径 "../武器/..."（仅本地开发用）
OSS_BASE = "https://skinwiki.oss-cn-guangzhou.aliyuncs.com"

QUALITY_LABEL = {"U": "优品", "J": "极品"}
MATERIAL_LABEL = {"T": "透光", "G": "贵金属", "Q": "其他", "L": "镭射", "M": "漆面", "Z": "木质"}
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

IGNORED_FOLDER_NAMES = {
    "上方教程",
    "上方教程图片",
    "_archive",
    "_raw_backup",
    "__pycache__",
}


# ── OSS 工具（仅 --source oss 时使用）──────────────────────
def _get_oss_bucket():
    import oss2  # type: ignore
    ak = os.environ.get("OSS_ACCESS_KEY_ID", "")
    sk = os.environ.get("OSS_ACCESS_KEY_SECRET", "")
    endpoint = os.environ.get("OSS_ENDPOINT", "https://oss-cn-guangzhou.aliyuncs.com")
    bucket_name = os.environ.get("OSS_BUCKET", "skinwiki")
    auth = oss2.Auth(ak, sk)
    return oss2.Bucket(auth, endpoint, bucket_name)


def list_oss_virtual_folders(bucket, prefix: str) -> list[str]:
    """返回 OSS prefix 下的虚拟子目录名列表（不含 prefix 和尾部 /）。"""
    import oss2  # type: ignore
    result = []
    for obj in oss2.ObjectIterator(bucket, prefix=prefix, delimiter="/"):
        if hasattr(obj, "key") and obj.key.endswith("/") and obj.key != prefix:
            folder = obj.key[len(prefix):].rstrip("/")
            if folder and not should_skip_folder(folder):
                result.append(folder)
    return sorted(result)


def oss_image_exists(bucket, key: str) -> bool:
    try:
        bucket.head_object(key)
        return True
    except Exception:
        return False


def validate_required_images_oss(
    bucket, weapon_dir: str, folder_code: str, skin_id: str,
    errors: list[str], warnings: list[str],
) -> None:
    """校验 OSS 上的图片。
    A 缺失 → error（阻断构建）；B/C/D 缺失 → warning（允许只有 1 张图的投稿通过）。
    兼容 {skin_id}_{slot}.png 和 {slot}.png 两种命名。
    """
    for slot in ("A", "B", "C", "D"):
        standard_key = f"{weapon_dir}/{folder_code}/{skin_id}_{slot}.png"
        fallback_key = f"{weapon_dir}/{folder_code}/{slot}.png"
        if not oss_image_exists(bucket, standard_key) and not oss_image_exists(bucket, fallback_key):
            if slot == "A":
                errors.append(f"OSS 缺少主图: {standard_key}")
            else:
                warnings.append(f"OSS 缺少副图（可选）: {standard_key}")


@dataclass
class WeaponRule:
    weapon: str
    dir_name: str
    mode: str
    id_prefix: str | None = None
    default_material: str | None = None


@dataclass
class ParseResult:
    skin_id: str
    folder_code: str
    normalized_code: str
    weapon: str
    serial: str
    template: str
    quality_label: str
    material_label: str
    color_label: str
    canonical_folder_code: str
    name_hint: str = ""


def load_weapon_rules(path: Path) -> list[WeaponRule]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    rules = []
    for item in payload.get("weapons", []):
        rules.append(
                WeaponRule(
                    weapon=item["weapon"],
                    dir_name=item["dir"],
                    mode=item["mode"],
                    id_prefix=item.get("idPrefix"),
                    default_material=item.get("defaultMaterial"),
                )
            )
    return rules


def load_meta_overrides(path: Path) -> dict[str, dict[str, str]]:
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    overrides = payload.get("overrides", {})
    normalized = {}
    for skin_id, raw in overrides.items():
        normalized[skin_id] = {
            "name": str(raw.get("name", "")),
            "rating": str(raw.get("rating", "")),
            "comment": str(raw.get("comment", "")),
        }
    return normalized


def parse_meta_js(path: Path) -> dict[str, dict[str, str]]:
    text = path.read_text(encoding="utf-8")
    pattern = re.compile(
        r'"([^"]+)"\s*:\s*\{\s*name:\s*"((?:[^"\\]|\\.)*)",\s*rating:\s*"((?:[^"\\]|\\.)*)",\s*comment:\s*"((?:[^"\\]|\\.)*)"\s*\}',
        re.S,
    )
    out = {}
    for match in pattern.finditer(text):
        skin_id = match.group(1)
        out[skin_id] = {
            "name": _unescape_js_string(match.group(2)),
            "rating": _unescape_js_string(match.group(3)),
            "comment": _unescape_js_string(match.group(4)),
        }
    return out


def parse_cover_js(path: Path) -> list[dict[str, Any]]:
    return _read_wrapped_json_array(path, "window.WEAPON_COVERS =")


def _read_wrapped_json_array(path: Path, prefix: str) -> list[dict[str, Any]]:
    text = path.read_text(encoding="utf-8").strip()
    if not text.startswith(prefix):
        raise ValueError(f"Unexpected format in {path}")
    start = text.find("[")
    end = text.rfind("]")
    return json.loads(text[start : end + 1])


def _write_js_array_atomically(path: Path, left: str, value: list[dict[str, Any]]) -> None:
    dumped = json.dumps(value, ensure_ascii=False, indent=2)
    data = f"{left}{dumped};\n"
    _atomic_write(path, data)


def _write_meta_js_atomically(path: Path, meta_map: dict[str, dict[str, str]]) -> None:
    lines = ["window.SKIN_META = {"]
    for skin_id in sorted(meta_map.keys()):
        row = meta_map[skin_id]
        name = _escape_js_string(row.get("name", ""))
        rating = _escape_js_string(row.get("rating", ""))
        comment = _escape_js_string(row.get("comment", ""))
        lines.append(f'  "{skin_id}": {{ name: "{name}", rating: "{rating}", comment: "{comment}" }},')
    lines.append("};")
    lines.append("")
    _atomic_write(path, "\n".join(lines))


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False, dir=path.parent) as tmp:
        tmp.write(content)
        tmp.flush()
        temp_name = tmp.name
    Path(temp_name).replace(path)


def _escape_js_string(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _unescape_js_string(value: str) -> str:
    return value.replace('\\"', '"').replace("\\\\", "\\")


def parse_k416_folder(rule: WeaponRule, folder_name: str) -> ParseResult:
    base_name, annotation = split_folder_name(folder_name)
    m = re.fullmatch(r"([UJ][TGQLMZ]{1,2}\d{4})(\d{3})?", base_name)
    if not m:
        raise ValueError(f"目录不符合编码模式: {folder_name}")
    normalized_code = m.group(1)
    serial = m.group(2) or "001"
    id_prefix = rule.id_prefix or rule.weapon
    skin_id = f"{id_prefix}-{normalized_code}-{serial}"
    quality = normalized_code[0]
    material = normalized_code[1:-4]
    color_code = normalized_code[-4:]
    canonical_folder = normalized_code if serial == "001" else f"{normalized_code}{serial}"
    return ParseResult(
        skin_id=skin_id,
        folder_code=folder_name,
        normalized_code=normalized_code,
        weapon=rule.weapon,
        serial=serial,
        template="",
        quality_label=QUALITY_LABEL.get(quality, ""),
        material_label=decode_material(material),
        color_label=decode_color_code(color_code),
        canonical_folder_code=canonical_folder,
        name_hint=annotation.get("skinName", ""),
    )


def parse_qbz95_folder(rule: WeaponRule, folder_name: str) -> ParseResult:
    base_name, annotation = split_folder_name(folder_name)
    encoded = re.fullmatch(r"(J[TGQLMZ]{1,2}\d{4})(\d{3})?", base_name)
    if encoded:
        normalized_code = encoded.group(1)
        serial = encoded.group(2) or "001"
    else:
        normalized_code, serial = parse_qbz95_chinese_folder(base_name)
    skin_id = f"{rule.weapon}-{normalized_code}-{serial}"
    quality = normalized_code[0]
    material = normalized_code[1:-4]
    color_code = normalized_code[-4:]
    canonical_folder = normalized_code if serial == "001" else f"{normalized_code}{serial}"
    return ParseResult(
        skin_id=skin_id,
        folder_code=folder_name,
        normalized_code=normalized_code,
        weapon=rule.weapon,
        serial=serial,
        template="",
        quality_label=QUALITY_LABEL.get(quality, ""),
        material_label=decode_material(material),
        color_label=decode_color_code(color_code),
        canonical_folder_code=canonical_folder,
        name_hint=annotation.get("skinName", ""),
    )


def parse_qbz95_chinese_folder(name: str) -> tuple[str, str]:
    if not name.startswith("J"):
        raise ValueError(f"QBZ95 目录不合法: {name}")
    serial_match = re.search(r"(\d{3})$", name)
    serial = serial_match.group(1) if serial_match else "001"
    body = name[1 : -3] if serial_match else name[1:]
    codes = []
    while body and len(codes) < 2 and body[0] in MATERIAL_LABEL:
        codes.append(body[0])
        body = body[1:]
    if not codes or not body:
        raise ValueError(f"QBZ95 目录不合法: {name}")
    if len(body) == 1:
        color = COLOR_MAP[body] + "00"
    elif len(body) == 2:
        color = COLOR_MAP[body[0]] + COLOR_MAP[body[1]]
    else:
        raise ValueError(f"QBZ95 颜色解析失败: {name}")
    return f"J{''.join(codes)}{color}", serial


def parse_tenglong_folder(rule: WeaponRule, folder_name: str) -> ParseResult:
    base_name, annotation = split_folder_name(folder_name)
    encoded = re.fullmatch(r"([UJ][TGQLMZ]{1,2}\d{4})(\d{3})?", base_name)
    if encoded:
        normalized_code = encoded.group(1)
        serial = encoded.group(2) or "001"
    else:
        normalized_code, serial = parse_tenglong_chinese_folder(base_name)
    skin_id = f"{rule.weapon}-{normalized_code}-{serial}"
    quality = normalized_code[0]
    material = normalized_code[1:-4]
    color_code = normalized_code[-4:]
    canonical_folder = normalized_code if serial == "001" else f"{normalized_code}{serial}"
    return ParseResult(
        skin_id=skin_id,
        folder_code=folder_name,
        normalized_code=normalized_code,
        weapon=rule.weapon,
        serial=serial,
        template="",
        quality_label=QUALITY_LABEL.get(quality, ""),
        material_label=decode_material(material),
        color_label=decode_color_code(color_code),
        canonical_folder_code=canonical_folder,
        name_hint=annotation.get("skinName", ""),
    )


def parse_tenglong_chinese_folder(name: str) -> tuple[str, str]:
    serial_match = re.search(r"(\d{3})$", name)
    serial = serial_match.group(1) if serial_match else "001"
    core = name[:-3] if serial_match else name
    if len(core) < 3:
        raise ValueError(f"腾龙目录不合法: {name}")
    quality = core[0]
    first_material = core[1]
    if quality not in QUALITY_LABEL or first_material not in MATERIAL_LABEL:
        raise ValueError(f"腾龙目录不合法: {name}")
    rest = core[2:]
    if rest == "镭射贵金属":
        return f"{quality}LG1111", serial
    if len(rest) == 1 and rest in COLOR_MAP:
        color_code = COLOR_MAP[rest] + "00"
    elif len(rest) == 2 and rest[0] in COLOR_MAP and rest[1] in COLOR_MAP:
        color_code = COLOR_MAP[rest[0]] + COLOR_MAP[rest[1]]
    else:
        color_code = "1111"
    return f"{quality}{first_material}{color_code}", serial


def parse_material_color_folder(rule: WeaponRule, folder_name: str) -> ParseResult:
    base_name, annotation = split_folder_name(folder_name)
    normalized_code, serial = parse_material_color_core(base_name)
    skin_id = f"{rule.weapon}-{normalized_code}-{serial}"
    quality = normalized_code[0]
    material = normalized_code[1:-4]
    color_code = normalized_code[-4:]
    canonical_folder = normalized_code if serial == "001" else f"{normalized_code}{serial}"
    return ParseResult(
        skin_id=skin_id,
        folder_code=folder_name,
        normalized_code=normalized_code,
        weapon=rule.weapon,
        serial=serial,
        template="",
        quality_label=QUALITY_LABEL.get(quality, ""),
        material_label=decode_material(material),
        color_label=decode_color_code(color_code),
        canonical_folder_code=canonical_folder,
        name_hint=annotation.get("skinName", ""),
    )


def parse_material_color_core(name: str) -> tuple[str, str]:
    # 优先尝试数字编码格式：[UJ][材质{1,2}][4位颜色码][可选3位流水]
    # 兼容旧手工录入文件夹（如 UQ0802），与 K416 风格一致
    numeric_match = re.fullmatch(r"([UJ])([TGQLMZ]{1,2})(\d{4})(\d{3})?", name)
    if numeric_match:
        quality = numeric_match.group(1)
        material_str = numeric_match.group(2)
        color_code = numeric_match.group(3)
        serial = numeric_match.group(4) or "001"
        return f"{quality}{material_str}{color_code}", serial

    # 中文颜色名格式：[UJ][材质{1,2}][颜色汉字][可选3位流水]
    serial_match = re.search(r"(\d{3})$", name)
    serial = serial_match.group(1) if serial_match else "001"
    core = name[:-3] if serial_match else name
    if len(core) < 2:
        raise ValueError(f"目录不符合材质配色模式: {name}")
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


def parse_template_with_material_folder(rule: WeaponRule, folder_name: str) -> ParseResult:
    base_name, annotation = split_folder_name(folder_name)
    # 优先尝试带材质码格式：[UJ][材质码{1,2}][模板名][可选流水]
    m = re.fullmatch(r"([UJ])([TGQLMZ]{1,2})(.+?)(\d{3})?", base_name)
    if m:
        quality = m.group(1)
        material = m.group(2)
        template = m.group(3).strip()
        serial = m.group(4) or "001"
    else:
        # 无材质码格式：[UJ][模板名][可选流水]，材质取 defaultMaterial
        m2 = re.fullmatch(r"([UJ])(.+?)(\d{3})?", base_name)
        if not m2 or not rule.default_material:
            raise ValueError(f"目录不符合模板材质模式（且无 defaultMaterial）: {folder_name}")
        quality = m2.group(1)
        material = rule.default_material
        template = m2.group(2).strip()
        serial = m2.group(3) or "001"
    if not template:
        raise ValueError(f"模板名为空: {folder_name}")
    skin_id = f"{rule.weapon}-{template}-{serial}"
    normalized_code = f"{quality}{material}"
    return ParseResult(
        skin_id=skin_id,
        folder_code=folder_name,
        normalized_code=normalized_code,
        weapon=rule.weapon,
        serial=serial,
        template=template,
        quality_label=QUALITY_LABEL.get(quality, ""),
        material_label=decode_material(material),
        color_label="NA",
        canonical_folder_code=base_name,
        name_hint=annotation.get("skinName", ""),
    )


def parse_pure_template_folder(rule: WeaponRule, folder_name: str) -> ParseResult:
    base_name, annotation = split_folder_name(folder_name)
    serial_match = re.search(r"(\d{3})$", base_name)
    serial = serial_match.group(1) if serial_match else "001"
    core = base_name[:-3] if serial_match else base_name
    template = core[1:] if core.startswith("J") else core
    template = template.strip()
    if not template:
        raise ValueError(f"模板名为空: {folder_name}")
    skin_id = f"{rule.weapon}-{template}-{serial}"
    return ParseResult(
        skin_id=skin_id,
        folder_code=folder_name,
        normalized_code="J",
        weapon=rule.weapon,
        serial=serial,
        template=template,
        quality_label=QUALITY_LABEL["J"],
        material_label="NA",
        color_label="NA",
        canonical_folder_code=base_name,
        name_hint=annotation.get("skinName", ""),
    )


def decode_material(material_code: str) -> str:
    if not material_code:
        return ""
    return " + ".join(MATERIAL_LABEL.get(c, c) for c in material_code)


def decode_color_code(color_code: str) -> str:
    if not re.fullmatch(r"\d{4}", color_code):
        return ""
    if color_code == "1111":
        return "未知配色"
    c1 = color_code[:2]
    c2 = color_code[2:]
    c1_label = COLOR_LABEL_BY_CODE.get(c1, c1)
    c2_label = COLOR_LABEL_BY_CODE.get(c2, c2)
    return c1_label if c2 == "00" else f"{c1_label} + {c2_label}"


def split_folder_name(folder_name: str) -> tuple[str, dict[str, str]]:
    if "__" not in folder_name:
        return folder_name, {}
    base, ext = folder_name.split("__", 1)
    parts = ext.split("-", 2)
    if len(parts) != 3:
        return base, {}
    return base, {"materialLabel": parts[0], "qualityLabel": parts[1], "skinName": parts[2]}


COLOR_LABEL_BY_CODE = {
    "00": "单色",
    "01": "白色",
    "02": "红色",
    "03": "黄色",
    "04": "青色",
    "05": "紫色",
    "06": "棕色",
    "07": "黑色",
    "08": "灰色",
    "09": "橙色",
    "10": "绿色",
    "11": "蓝色",
    "12": "粉色",
}


def parse_asval_folder_core(folder_name: str) -> tuple[str, str, str, str]:
    """返回 (quality, material, color_code, color_label)，不含 serial。"""
    base_name, annotation = split_folder_name(folder_name)
    if not base_name:
        raise ValueError(f"目录名为空: {folder_name}")
    quality = base_name[0]
    if quality not in QUALITY_LABEL:
        raise ValueError(f"品级不合法: {folder_name}")
    pos = 1
    material_chars: list[str] = []
    while pos < len(base_name) and base_name[pos] in MATERIAL_LABEL and len(material_chars) < 2:
        material_chars.append(base_name[pos])
        pos += 1
    if not material_chars:
        raise ValueError(f"材质不合法: {folder_name}")
    material = "".join(material_chars)
    color_text = base_name[pos:]
    # 剥离尾部纯数字流水后缀（如 UG白002 中的 002）
    color_core = re.sub(r"\d+$", "", color_text)
    if not color_core:
        return quality, material, "1111", "未知配色"
    if len(color_core) == 1 and color_core in COLOR_MAP:
        code = COLOR_MAP[color_core] + "00"
        return quality, material, code, decode_color_code(code)
    if len(color_core) == 2 and color_core[0] in COLOR_MAP and color_core[1] in COLOR_MAP:
        code = COLOR_MAP[color_core[0]] + COLOR_MAP[color_core[1]]
        return quality, material, code, decode_color_code(code)
    raise ValueError(f"颜色无法解析: {folder_name!r}")


def parse_asval_all_folders(rule: WeaponRule, weapon_dir: Path) -> dict[str, ParseResult]:
    """两阶段串号：先解析所有文件夹，按 normalizedCode 分组排序后分配 serial。
    返回 {folder_name: ParseResult}。"""
    from collections import defaultdict

    folders = sorted(
        [p for p in weapon_dir.iterdir() if p.is_dir() and not should_skip_folder(p.name)],
        key=lambda p: p.name,
    )
    groups: dict[str, list[tuple[str, str, str, str, str]]] = defaultdict(list)
    errors: list[str] = []
    for folder in folders:
        try:
            quality, material, color_code, color_label = parse_asval_folder_core(folder.name)
            normalized_code = f"{quality}{material}{color_code}"
            groups[normalized_code].append((folder.name, quality, material, color_code, color_label))
        except Exception as exc:
            errors.append(f"[{rule.weapon}] 解析失败 {folder.name}: {exc}")
    if errors:
        raise ValueError("\n".join(errors))

    result: dict[str, ParseResult] = {}
    for normalized_code, items in groups.items():
        for idx, (folder_name, quality, material, color_code, color_label) in enumerate(items, start=1):
            serial = f"{idx:03d}"
            skin_id = f"{rule.weapon}-{normalized_code}-{serial}"
            canonical_folder = normalized_code if serial == "001" else f"{normalized_code}{serial}"
            result[folder_name] = ParseResult(
                skin_id=skin_id,
                folder_code=folder_name,
                normalized_code=normalized_code,
                weapon=rule.weapon,
                serial=serial,
                template="",
                quality_label=QUALITY_LABEL.get(quality, ""),
                material_label=decode_material(material),
                color_label=color_label,
                canonical_folder_code=canonical_folder,
                name_hint="",
            )
    return result


def parse_asval_all_folders_oss(bucket, rule: WeaponRule) -> dict[str, ParseResult]:
    """OSS 版本的 ASVAL 两阶段串号：从 OSS 虚拟目录列举文件夹名，逻辑与本地版相同。"""
    from collections import defaultdict

    folder_names = list_oss_virtual_folders(bucket, rule.dir_name + "/")
    groups: dict[str, list[tuple[str, str, str, str, str]]] = defaultdict(list)
    errors_local: list[str] = []
    for folder_name in folder_names:
        try:
            quality, material, color_code, color_label = parse_asval_folder_core(folder_name)
            normalized_code = f"{quality}{material}{color_code}"
            groups[normalized_code].append((folder_name, quality, material, color_code, color_label))
        except Exception as exc:
            errors_local.append(f"[{rule.weapon}] 解析失败 {folder_name}: {exc}")
    if errors_local:
        raise ValueError("\n".join(errors_local))

    result: dict[str, ParseResult] = {}
    for normalized_code, items in groups.items():
        for idx, (folder_name, quality, material, color_code, color_label) in enumerate(items, start=1):
            serial = f"{idx:03d}"
            skin_id = f"{rule.weapon}-{normalized_code}-{serial}"
            canonical_folder = normalized_code if serial == "001" else f"{normalized_code}{serial}"
            result[folder_name] = ParseResult(
                skin_id=skin_id,
                folder_code=folder_name,
                normalized_code=normalized_code,
                weapon=rule.weapon,
                serial=serial,
                template="",
                quality_label=QUALITY_LABEL.get(quality, ""),
                material_label=decode_material(material),
                color_label=color_label,
                canonical_folder_code=canonical_folder,
                name_hint="",
            )
    return result


def parse_folder(rule: WeaponRule, folder_name: str) -> ParseResult:
    if rule.mode == "k416":
        return parse_k416_folder(rule, folder_name)
    if rule.mode == "qbz95":
        return parse_qbz95_folder(rule, folder_name)
    if rule.mode == "tenglong":
        return parse_tenglong_folder(rule, folder_name)
    if rule.mode == "material_color":
        return parse_material_color_folder(rule, folder_name)
    if rule.mode == "template_with_material":
        return parse_template_with_material_folder(rule, folder_name)
    if rule.mode == "pure_template":
        return parse_pure_template_folder(rule, folder_name)
    if rule.mode == "asval":
        raise NotImplementedError("ASVAL 使用 parse_asval_all_folders，不走单文件夹解析")
    raise ValueError(f"不支持的 mode: {rule.mode}")


def should_skip_folder(folder_name: str) -> bool:
    if folder_name in IGNORED_FOLDER_NAMES:
        return True
    if folder_name.startswith("."):
        return True
    if folder_name.startswith("_"):
        return True
    return False


def validate_required_images(folder_path: Path, skin_id: str, errors: list[str]) -> None:
    for slot in ("A", "B", "C", "D"):
        file_path = folder_path / f"{skin_id}_{slot}.png"
        if not file_path.exists():
            errors.append(f"缺少标准图: {file_path}")


def _img_url(weapon: str, folder_code: str, filename: str) -> str:
    """生成图片 URL（OSS 或本地相对路径）"""
    if OSS_BASE:
        return f"{OSS_BASE}/{weapon}/{folder_code}/{filename}"
    return f"../{weapon}/{folder_code}/{filename}"


def build_record(result: ParseResult) -> dict[str, Any]:
    record = {
        "id": result.skin_id,
        "folderCode": result.folder_code,
        "normalizedCode": result.normalized_code,
        "weapon": result.weapon,
        "serial": result.serial,
        "imageA": _img_url(result.weapon, result.folder_code, f"{result.skin_id}_A.png"),
        "imageB": _img_url(result.weapon, result.folder_code, f"{result.skin_id}_B.png"),
        "imageC": _img_url(result.weapon, result.folder_code, f"{result.skin_id}_C.png"),
        "imageD": _img_url(result.weapon, result.folder_code, f"{result.skin_id}_D.png"),
        "status": "ready",
    }
    if result.template:
        record["template"] = result.template
    if result.quality_label:
        record["qualityLabel"] = result.quality_label
    if result.material_label:
        record["materialLabel"] = result.material_label
    if result.color_label:
        record["colorLabel"] = result.color_label
    return record


def parse_existing_data_js(path: Path) -> list[dict[str, Any]]:
    """读取已有皮肤数据。优先从 site/data/ 子文件合并，子目录不存在时回退到旧版单文件。"""
    data_dir = path.parent / "data"
    if data_dir.is_dir():
        combined: list[dict[str, Any]] = []
        for js_file in sorted(data_dir.glob("*.js")):
            combined.extend(_read_weapon_data_js(js_file))
        return combined
    # 兼容旧版单文件格式
    return _read_wrapped_json_array(path, "window.SKIN_DATA =")


def _read_weapon_data_js(path: Path) -> list[dict[str, Any]]:
    """解析 site/data/{weapon}.js，格式为 window._SKIN_DATA_{weapon} = [...]。"""
    text = path.read_text(encoding="utf-8").strip()
    start = text.find("[")
    end = text.rfind("]")
    if start == -1 or end == -1:
        return []
    return json.loads(text[start : end + 1])


def _write_weapon_data_js_atomically(data_dir: Path, weapon: str, records: list[dict[str, Any]]) -> None:
    """将单武器记录写入 site/data/{weapon}.js。"""
    data_dir.mkdir(parents=True, exist_ok=True)
    var_name = f"window._SKIN_DATA_{weapon}"
    dumped = json.dumps(records, ensure_ascii=False, indent=2)
    content = f"{var_name} = {dumped};\n"
    _atomic_write(data_dir / f"{weapon}.js", content)


def duplicate_priority(parsed: ParseResult) -> int:
    # 带 __ 注解的文件夹包含投稿人填写的皮肤名（name_hint），优先级最高。
    if "__" in parsed.folder_code:
        return 3
    # 其次保留标准编码目录（例如 UQ0409 或 UQ0409002），避免中文临时目录覆盖。
    if parsed.folder_code == parsed.canonical_folder_code:
        return 2
    return 1


def choose_meta_for_id(
    skin_id: str,
    derived_template: str,
    name_hint: str,
    existing_meta: dict[str, dict[str, str]],
    overrides: dict[str, dict[str, str]],
) -> dict[str, str]:
    if skin_id in overrides:
        row = overrides[skin_id]
        return {"name": row.get("name", ""), "rating": row.get("rating", ""), "comment": row.get("comment", "")}
    if skin_id in existing_meta:
        row = existing_meta[skin_id]
        return {"name": row.get("name", ""), "rating": row.get("rating", ""), "comment": row.get("comment", "")}
    # 新皮肤：优先用模板名，其次用文件夹注解中的 name_hint（用户投稿时填写的皮肤名）
    return {"name": derived_template or name_hint, "rating": "", "comment": ""}


def sanitize_folder_piece(value: str) -> str:
    out = re.sub(r'[\\/:*?"<>|]+', "_", value).strip()
    return out


def build_standard_folder_name(parsed: ParseResult, skin_name: str) -> str:
    material = sanitize_folder_piece(parsed.material_label or "NA")
    quality = sanitize_folder_piece(parsed.quality_label or "未标注")
    name = sanitize_folder_piece(skin_name or parsed.name_hint or parsed.template or parsed.skin_id)
    return f"{parsed.canonical_folder_code}__{material}-{quality}-{name}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="验证枪皮目录并动态更新站点数据。")
    parser.add_argument("--weapon", help="只处理指定武器，例如 K416。")
    parser.add_argument("--all", action="store_true", help="处理所有已配置武器（默认行为）。")
    parser.add_argument("--config", default=str(CONFIG_DIR / "weapon_rules.json"), help="武器规则配置路径。")
    parser.add_argument("--meta-overrides", default=str(CONFIG_DIR / "meta_overrides.json"), help="展示名映射配置路径。")
    parser.add_argument("--dry-run", action="store_true", help="仅校验和报告，不写入 site 文件。")
    parser.add_argument(
        "--normalize-folders",
        action="store_true",
        help="按规范重命名文件夹为 代码__材质-品级-枪皮名。",
    )
    parser.add_argument(
        "--source",
        choices=["local", "oss"],
        default="local",
        help="图片来源：local（默认，读本地磁盘）或 oss（从 OSS 列目录+校验）。",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config_path = Path(args.config)
    overrides_path = Path(args.meta_overrides)
    rules = load_weapon_rules(config_path)
    if args.weapon:
        rules = [r for r in rules if r.weapon == args.weapon]
        if not rules:
            raise SystemExit(f"未在配置中找到武器: {args.weapon}")

    use_oss = args.source == "oss"
    oss_bucket = _get_oss_bucket() if use_oss else None

    existing_data = parse_existing_data_js(SITE_DIR / "data.js")
    existing_meta = parse_meta_js(SITE_DIR / "meta.js")
    overrides = load_meta_overrides(overrides_path)
    existing_covers = parse_cover_js(SITE_DIR / "covers.js")

    errors: list[str] = []
    warnings: list[str] = []
    records: list[dict[str, Any]] = []
    generated_meta: dict[str, dict[str, str]] = {}
    chosen_by_id: dict[str, ParseResult] = {}
    count_by_weapon: dict[str, int] = {}

    for rule in rules:
        weapon_dir = ROOT / rule.dir_name
        if not use_oss and not weapon_dir.exists():
            errors.append(f"武器目录不存在: {weapon_dir}")
            continue

        count_by_weapon[rule.weapon] = 0

        # ASVAL 使用两阶段串号，单独处理
        if rule.mode == "asval":
            try:
                if use_oss:
                    asval_map = parse_asval_all_folders_oss(oss_bucket, rule)
                else:
                    asval_map = parse_asval_all_folders(rule, weapon_dir)
            except Exception as exc:
                errors.append(str(exc))
                continue
            for folder_name, parsed in sorted(asval_map.items()):
                if parsed.skin_id in chosen_by_id:
                    warnings.append(f"[{rule.weapon}] ID 冲突跳过: {parsed.skin_id} ({folder_name})")
                    continue
                chosen_by_id[parsed.skin_id] = parsed
        else:
            if use_oss:
                folder_names = list_oss_virtual_folders(oss_bucket, rule.dir_name + "/")
            else:
                folder_names = sorted(
                    [p.name for p in weapon_dir.iterdir() if p.is_dir()],
                )
            for folder_name in folder_names:
                if should_skip_folder(folder_name):
                    continue
                try:
                    parsed = parse_folder(rule, folder_name)
                except Exception as exc:
                    errors.append(f"[{rule.weapon}] 目录解析失败 {folder_name}: {exc}")
                    continue

                prev = chosen_by_id.get(parsed.skin_id)
                if prev is not None:
                    prev_score = duplicate_priority(prev)
                    new_score = duplicate_priority(parsed)
                    if new_score > prev_score:
                        warnings.append(
                            f"[{rule.weapon}] ID 冲突已自动选择标准目录: {parsed.skin_id} ({prev.folder_code} -> {parsed.folder_code})"
                        )
                        chosen_by_id[parsed.skin_id] = parsed
                    else:
                        warnings.append(f"[{rule.weapon}] ID 冲突已跳过目录: {parsed.skin_id} ({folder_name})")
                    continue
                chosen_by_id[parsed.skin_id] = parsed

        for parsed in sorted(
            [x for x in chosen_by_id.values() if x.weapon == rule.weapon], key=lambda x: x.skin_id
        ):
            if use_oss:
                validate_required_images_oss(oss_bucket, rule.dir_name, parsed.folder_code, parsed.skin_id, errors, warnings)
            else:
                folder = weapon_dir / parsed.folder_code
                validate_required_images(folder, parsed.skin_id, errors)
            meta_row = choose_meta_for_id(
                parsed.skin_id, parsed.template, parsed.name_hint, existing_meta, overrides
            )
            skin_name = meta_row.get("name", "") or parsed.name_hint or parsed.template
            if not use_oss and args.normalize_folders:
                desired_folder = build_standard_folder_name(parsed, skin_name)
                if desired_folder != parsed.folder_code:
                    src = weapon_dir / parsed.folder_code
                    dst = weapon_dir / desired_folder
                    if args.dry_run:
                        warnings.append(f"[{rule.weapon}] 预览重命名: {parsed.folder_code} -> {desired_folder}")
                        parsed.folder_code = desired_folder
                    elif dst.exists():
                        errors.append(f"[{rule.weapon}] 目标目录已存在，无法重命名: {dst}")
                    else:
                        src.rename(dst)
                        warnings.append(f"[{rule.weapon}] 已重命名目录: {parsed.folder_code} -> {desired_folder}")
                        parsed.folder_code = desired_folder
                folder = weapon_dir / parsed.folder_code
                validate_required_images(folder, parsed.skin_id, errors)
            records.append(build_record(parsed))
            generated_meta[parsed.skin_id] = meta_row
            count_by_weapon[rule.weapon] += 1

    if errors:
        report_dir = SITE_DIR / "reports"
        report_dir.mkdir(parents=True, exist_ok=True)
        report_path = report_dir / "validate_errors.txt"
        _atomic_write(report_path, "\n".join(errors) + "\n")
        print("校验失败，未更新 site 数据。")
        print(f"错误数量: {len(errors)}")
        print(f"错误报告: {report_path}")
        return 1

    selected_weapons = {r.weapon for r in rules}
    kept_existing_records = [x for x in existing_data if x.get("weapon") not in selected_weapons]
    records = kept_existing_records + records
    records.sort(key=lambda x: (x.get("weapon", ""), x.get("id", "")))

    # 收集本次重建武器在旧数据中的所有 skin_id，用于清除已删除皮肤的孤立 meta 条目
    selected_weapons = {r.weapon for r in rules}
    rebuilt_existing_ids = {rec["id"] for rec in existing_data if rec.get("weapon") in selected_weapons}
    carry_over_meta = {
        k: v for k, v in existing_meta.items()
        if k not in generated_meta and k not in rebuilt_existing_ids
    }
    merged_meta = {**carry_over_meta, **generated_meta}

    covers = []
    ready_counts = {weapon: 0 for weapon in count_by_weapon}
    for row in records:
        if row.get("status") == "ready":
            ready_counts[row["weapon"]] = ready_counts.get(row["weapon"], 0) + 1

    for cover in existing_covers:
        weapon = cover.get("weapon", "")
        new_cover = dict(cover)
        if weapon in ready_counts:
            new_cover["enabled"] = ready_counts[weapon] > 0
        covers.append(new_cover)

    if not args.dry_run:
        # 按武器分组写入 site/data/{weapon}.js，data.js 本身是静态索引不重写
        data_dir = SITE_DIR / "data"
        records_by_weapon: dict[str, list[dict[str, Any]]] = {}
        for rec in records:
            records_by_weapon.setdefault(rec["weapon"], []).append(rec)
        for weapon, weapon_records in records_by_weapon.items():
            _write_weapon_data_js_atomically(data_dir, weapon, weapon_records)
        _write_meta_js_atomically(SITE_DIR / "meta.js", merged_meta)
        _write_js_array_atomically(SITE_DIR / "covers.js", "window.WEAPON_COVERS = ", covers)

    summary_lines = [
        "校验通过。",
        "本次为 dry-run，未写入 site 文件。" if args.dry_run else "并完成更新。",
        f"总记录数: {len(records)}",
    ]
    for weapon, count in sorted(count_by_weapon.items(), key=lambda x: x[0]):
        summary_lines.append(f"- {weapon}: {count}")
    if warnings:
        report_dir = SITE_DIR / "reports"
        report_dir.mkdir(parents=True, exist_ok=True)
        warning_path = report_dir / "validate_warnings.txt"
        _atomic_write(warning_path, "\n".join(warnings) + "\n")
        summary_lines.append(f"警告数量: {len(warnings)}")
        summary_lines.append(f"警告报告: {warning_path}")
        # 成功后清理旧错误报告，避免误读上一次失败结果。
        old_error_report = report_dir / "validate_errors.txt"
        if old_error_report.exists():
            old_error_report.unlink()
    else:
        report_dir = SITE_DIR / "reports"
        old_warning_report = report_dir / "validate_warnings.txt"
        if old_warning_report.exists():
            old_warning_report.unlink()
        old_error_report = report_dir / "validate_errors.txt"
        if old_error_report.exists():
            old_error_report.unlink()
    print("\n".join(summary_lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
