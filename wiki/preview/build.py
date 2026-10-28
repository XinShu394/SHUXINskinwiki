"""知识库预览数据生成（仅本地预览用，不进站点构建）

扫描 wiki/内容/ 下所有「正文.md」，按所在文件夹决定它放在哪里：

  内容/选皮焚诀/{枪名}/{优品|极品|通用}/正文.md            这一格只有一篇
  内容/选皮焚诀/{枪名}/{优品|极品|通用}/{任意名}/正文.md    这一格有多篇
  内容/市场焚诀/{砖皮市场机制|砖皮市场见闻}/{任意名}/正文.md

文件夹里放了「合集.md」，它下面的每个子文件夹就是合集里的一章。
图片和正文.md 放在同一个文件夹，正文里直接写文件名。
内容/外部链接.md 是 B站知识库的链接列表。

同时读取 site/covers.js、site/data/*.js、site/meta.js，
用来排 14 把枪的格子和生成「图鉴：编号」卡片。

用法：python wiki/preview/build.py
"""

import datetime
import html
import io
import shutil
import sys
import json
import re
from pathlib import Path
from urllib.parse import quote

HERE = Path(__file__).resolve().parent
WIKI = HERE.parent
ROOT = WIKI.parent
CONTENT = WIKI / "内容"
OUT = HERE / "data.js"
SITE = ROOT / "site"

# python build.py --site ：输出到 site/wiki/，图片压缩后复制到 site/wiki/内容/，供正式站使用
DEPLOY = "--site" in sys.argv
DIST = SITE / "wiki"
if DEPLOY:
    OUT = DIST / "data.js"
GALLERY = "../index.html" if DEPLOY else "../../site/index.html"
EXPORTED = set()


def export_image(src: Path, rel: Path) -> Path:
    """把源图复制到 site/wiki/内容/，大图压成 1920 宽的 JPG。返回目标路径。"""
    dst = DIST / rel
    big = src.stat().st_size > 600 * 1024
    if big and src.suffix.lower() in (".png", ".jpg", ".jpeg"):
        dst = dst.with_suffix(".jpg")
    EXPORTED.add(dst)
    if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
        return dst
    dst.parent.mkdir(parents=True, exist_ok=True)
    if big:
        from PIL import Image
        im = Image.open(src)
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGBA")
            bg = Image.new("RGB", im.size, (22, 25, 23))
            bg.paste(im, mask=im.split()[-1])
            im = bg
        else:
            im = im.convert("RGB")
        im.thumbnail((1920, 1920))
        im.save(dst, "JPEG", quality=86, optimize=True)
    else:
        shutil.copy2(src, dst)
    return dst

TIERS = ["优品", "极品", "通用"]
MARKET = ["砖皮市场机制", "砖皮市场见闻"]
SPECIAL = {"先看这一段", "图鉴里看哪里", "不要写进回答"}


# —— 站点数据 ——
def load_js_array(path: Path):
    text = path.read_text(encoding="utf-8")
    return json.loads(text[text.index("["): text.rindex("]") + 1])


def load_covers():
    out = []
    for c in load_js_array(SITE / "covers.js"):
        name = c["src"].rsplit("/", 1)[-1]
        out.append({
            "weapon": c["weapon"],
            "title": c.get("title", ""),
            "remote": c["src"],
            "local": c["src"] if DEPLOY else "../../枪皮总封面/" + name,
            "enabled": bool(c.get("enabled")),
        })
    return out


def load_skins():
    names = {}
    meta = SITE / "meta.js"
    if meta.exists():
        for m in re.finditer(r'"([^"]+)":\s*\{\s*name:\s*"([^"]*)"', meta.read_text(encoding="utf-8")):
            names[m.group(1)] = m.group(2)
    skins, counts = {}, {}
    for f in (SITE / "data").glob("*.js"):
        try:
            rows = load_js_array(f)
        except ValueError:
            continue
        for r in rows:
            sid = r.get("id")
            if not sid:
                continue
            w = r.get("weapon", f.stem)
            counts[w] = counts.get(w, 0) + 1
            skins[sid] = {
                "name": names.get(sid, ""),
                "img": r.get("imageA", ""),
                "quality": r.get("qualityLabel", ""),
                "material": r.get("materialLabel", ""),
                "color": r.get("colorLabel", ""),
            }
    return skins, counts


# —— 解析 ——
def parse_front(text: str):
    text = text.replace("\r\n", "\n").lstrip("﻿")
    m = re.match(r"^---\n(.*?)\n---\n?", text, re.S)
    meta = {}
    if m:
        for line in m.group(1).splitlines():
            k, sep, v = line.partition(":")
            if not sep:
                k, sep, v = line.partition("：")
            if sep:
                meta[k.strip()] = v.strip()
        text = text[m.end():]
    return meta, text


def split_sections(body: str, special=SPECIAL):
    """按 ## 切开。特殊栏目单独取出，其余都算正文。"""
    out = {k: "" for k in special}
    main = []
    parts = re.split(r"^## +(.+?)\s*$", body, flags=re.M)
    if parts[0].strip():
        main.append(parts[0])
    for i in range(1, len(parts), 2):
        name, chunk = parts[i].strip(), parts[i + 1]
        if name in special:
            out[name] = chunk.strip()
        elif name == "正文":
            main.append(chunk)
        else:
            main.append(f"### {name}\n{chunk}")
    out["正文"] = "\n".join(main).strip()
    return out


IMG_RE = re.compile(r"^!\[(.*?)\]\((.+?)\)$")
SPOT_RE = re.compile(r"^(.+?)\s*!\[(.*?)\]\((.+?)\)$")
CARD_RE = re.compile(r"^(?:图鉴[：:]\s*([\w\-]+)|\S*#skin=([\w\-%]+)\S*)$")
LINKITEM_RE = re.compile(r"^\[([^\]]+)\]\((https?://[^)\s]+)\)\s*(?:[：:]\s*(.*))?$")
TABLE_SEP_RE = re.compile(r"^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$")


def clean_url(url: str) -> str:
    """去掉 B站分享链接里的跟踪参数。"""
    url = url.replace("&amp;", "&")
    if "bilibili.com" in url:
        url = re.sub(r"[?&](spm_id_from|vd_source|share_source|share_medium|from)=[^&#]*", "", url)
        url = re.sub(r"\?&", "?", url).rstrip("?&")
    return url


def site_label(url: str) -> str:
    if "bilibili.com" in url or "b23.tv" in url:
        m = re.search(r"(BV\w{10})", url)
        return m.group(1) if m else "bilibili"
    m = re.match(r"https?://([^/]+)", url)
    return m.group(1) if m else ""


class Renderer:
    def __init__(self, folder: Path, skins: dict, titles: dict, problems: list, where: str):
        self.folder = folder
        self.skins = skins
        self.titles = titles
        self.problems = problems
        self.where = where

    def src(self, raw: str) -> str:
        raw = raw.strip()
        if re.match(r"^(https?:)?//", raw):
            return raw
        p = (self.folder / raw).resolve()
        if not p.exists():
            self.problems.append(f"{self.where}：找不到图片 {raw}")
        try:
            rel = p.relative_to(WIKI)
        except ValueError:
            return raw
        if DEPLOY and p.exists():
            dst = export_image(p, rel)
            return "./" + "/".join(quote(x) for x in dst.relative_to(DIST).parts)
        return "../" + "/".join(quote(x) for x in rel.parts)

    def inline(self, s: str) -> str:
        links = []

        def keep_link(m):
            links.append((m.group(1), clean_url(m.group(2))))
            return f"\x00{len(links) - 1}\x00"

        s = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", keep_link, s)
        s = html.escape(s, quote=False)

        def strong(m):
            t = m.group(1)
            return f'<strong class="todo-tag">{t}</strong>' if t in ("待补", "待写") else f"<strong>{t}</strong>"

        s = re.sub(r"\*\*(.+?)\*\*", strong, s)

        def wikilink(m):
            t = m.group(1)
            aid = self.titles.get(t)
            if aid:
                return f'<a class="ref" href="#a={quote(aid)}">{t}</a>'
            self.problems.append(f"{self.where}：[[{t}]] 没有对应标题的词条")
            return f"「{t}」"

        s = re.sub(r"\[\[(.+?)\]\]", wikilink, s)
        s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)

        def put_link(m):
            t, u = links[int(m.group(1))]
            return f'<a class="ext" href="{html.escape(u)}" target="_blank" rel="noopener">{html.escape(t)}<i aria-hidden="true">↗</i></a>'

        return re.sub(r"\x00(\d+)\x00", put_link, s)

    def card(self, sid: str) -> str:
        sk = self.skins.get(sid)
        if not sk:
            self.problems.append(f"{self.where}：图鉴里找不到皮肤 {sid}")
            return f'<span class="skin-card missing"><span class="sc-body"><span class="sc-name">图鉴里找不到</span><span class="sc-id">{html.escape(sid)}</span></span></span>'
        tags = "".join(
            f'<span class="t{" t-q" if i == 0 else ""}">{html.escape(v)}</span>'
            for i, v in enumerate([sk["quality"], sk["material"], sk["color"]]) if v and v != "NA")
        q = "ji" if sk["quality"] == "极品" else "you"
        return (f'<a class="skin-card q-{q}" href="{GALLERY}#skin={sid}" target="_blank" rel="noopener">'
                f'<span class="sc-img"><img src="{html.escape(sk["img"])}" alt="" loading="lazy"></span>'
                f'<span class="sc-body"><span class="sc-name">{html.escape(sk["name"] or sid)}</span>'
                f'<span class="sc-id">{sid}</span><span class="sc-tags">{tags}</span></span>'
                f'<span class="sc-go">图鉴 ↗</span></a>')

    def table(self, rows: list) -> str:
        """rows[0] 表头，rows[1] 分隔线。单元格以 ▮ 开头时画占比条，长度按这一列最大值。"""
        def cells(line):
            line = line.strip()
            if line.startswith("|"):
                line = line[1:]
            if line.endswith("|"):
                line = line[:-1]
            return [c.strip() for c in line.split("|")]

        head = cells(rows[0])
        body = [cells(r) for r in rows[2:]]
        n = len(head)
        body = [(r + [""] * n)[:n] for r in body]
        maxes = {}
        for j in range(n):
            vals = []
            for r in body:
                m = re.match(r"^▮\s*([\d.]+)", r[j])
                if m:
                    vals.append(float(m.group(1)))
            if vals:
                maxes[j] = max(vals) or 1

        def cell(j, text, tag):
            m = re.match(r"^▮\s*([\d.]+)(.*)$", text)
            if tag == "td" and m:
                v = float(m.group(1))
                pct = v / maxes[j] * 100
                label = html.escape(m.group(1) + m.group(2))
                return (f'<td class="meter"><span class="bar" style="--w:{pct:.1f}%" aria-hidden="true"></span>'
                        f'<span class="v">{label}</span></td>')
            num = re.fullmatch(r"[\d.,%]+", re.sub(r"<[^>]+>|\*\*", "", text))
            cls = ' class="num"' if num and tag == "td" else ""
            return f"<{tag}{cls}>{self.inline(text)}</{tag}>"

        thead = "".join(cell(j, h, "th") for j, h in enumerate(head))
        trs = "".join(
            f'<tr{" class=\"hl\"" if r[0].startswith("**") else ""}>' + "".join(cell(j, c, "td") for j, c in enumerate(r)) + "</tr>"
            for r in body)
        return f'<div class="tbl"><table><thead><tr>{thead}</tr></thead><tbody>{trs}</tbody></table></div>'

    def blocks(self, md: str, stats: dict) -> str:
        out, para, lst, gallery, cards, table = [], [], [], [], [], []
        timeline = []

        def flush():
            if para:
                text = " ".join(para)
                cls = ' class="todo"' if text.startswith(("**待补**", "**待写**")) else (
                    ' class="callout"' if re.fullmatch(r"\*\*[^*]+\*\*", text) else "")
                out.append(f"<p{cls}>{self.inline(text)}</p>")
                para.clear()
            if lst:
                if timeline:
                    items = []
                    for x in lst:
                        x = x if isinstance(x, str) else x[0]
                        head, _, desc = x.partition("：")
                        name, _, when = head.partition("｜")
                        hl = name.startswith("**") and name.endswith("**")
                        name = name.strip("*")
                        items.append(
                            f'<li{" class=\"hl\"" if hl else ""}><i aria-hidden="true"></i>'
                            f'<b>{self.inline(name)}</b>'
                            + (f'<em>{self.inline(when)}</em>' if when else "")
                            + (f'<p>{self.inline(desc)}</p>' if desc else "") + "</li>")
                    out.append(f'<ol class="timeline" style="--n:{len(items)}">' + "".join(items) + "</ol>")
                    timeline.clear()
                elif any(isinstance(x, tuple) for x in lst) and all(isinstance(x, tuple) or "：" in x for x in lst):
                    items = []
                    for x in lst:
                        if isinstance(x, str):
                            term, _, desc = x.partition("：")
                            items.append(
                                f'<li class="spot no-img"><span class="spot-term">{self.inline(term)}</span>'
                                f'<span class="spot-desc">{self.inline(desc)}</span><span></span></li>')
                            continue
                        term_desc, alt, src = x
                        term, _, desc = term_desc.partition("：")
                        u = self.src(src)
                        items.append(
                            f'<li class="spot" data-img="{u}" data-alt="{html.escape(alt)}" tabindex="0">'
                            f'<span class="spot-term">{self.inline(term)}</span>'
                            f'<span class="spot-desc">{self.inline(desc)}</span>'
                            f'<span class="spot-ico" aria-hidden="true"></span>'
                            f'<img class="spot-img" src="{u}" alt="{html.escape(alt)}" loading="lazy"></li>')
                        stats["images"] += 1
                        stats.setdefault("cover", u)
                    out.append('<ul class="spots">' + "".join(items) + "</ul>")
                elif all(isinstance(x, str) and LINKITEM_RE.match(x) for x in lst):
                    items = []
                    for x in lst:
                        m = LINKITEM_RE.match(x)
                        u = clean_url(m.group(2))
                        items.append(
                            f'<li><a href="{html.escape(u)}" target="_blank" rel="noopener">'
                            f'<span class="lk-site">{html.escape(site_label(u))}</span>'
                            f'<span class="lk-t">{html.escape(m.group(1))}</span>'
                            + (f'<span class="lk-d">{self.inline(m.group(3))}</span>' if m.group(3) else "")
                            + '<span class="lk-go" aria-hidden="true">↗</span></a></li>')
                        stats["links"] += 1
                    out.append('<ul class="links">' + "".join(items) + "</ul>")
                else:
                    out.append("<ul>" + "".join(
                        f"<li>{self.inline(x if isinstance(x, str) else x[0])}</li>" for x in lst) + "</ul>")
                lst.clear()
            if gallery:
                n = len(gallery)
                figs = "".join(
                    f'<figure><img src="{u}" alt="{html.escape(alt)}" loading="lazy">'
                    + (f"<figcaption>{html.escape(alt)}</figcaption>" if alt else "") + "</figure>"
                    for alt, u in gallery)
                out.append(f'<div class="gallery g{min(n, 4)}" data-n="{n}">{figs}</div>')
                gallery.clear()
            if cards:
                out.append('<div class="skin-cards">' + "".join(cards) + "</div>")
                cards.clear()
            if table:
                if len(table) >= 2 and TABLE_SEP_RE.match(table[1].strip()):
                    out.append(self.table(table))
                    stats["tables"] += 1
                else:
                    out.append("".join(f"<p>{self.inline(t)}</p>" for t in table))
                table.clear()

        for raw in md.splitlines():
            line = raw.rstrip()
            s = line.strip()
            if s.startswith("|"):
                if not table:
                    flush()
                table.append(s)
                continue
            if table:
                flush()
            c = CARD_RE.match(s)
            if c:
                if para or lst or gallery:
                    flush()
                cards.append(self.card(c.group(1) or c.group(2)))
                stats["cards"] += 1
                continue
            if cards:
                flush()
            m = IMG_RE.match(s)
            if m:
                if para or lst:
                    flush()
                u = self.src(m.group(2))
                gallery.append((m.group(1), u))
                stats["images"] += 1
                stats.setdefault("cover", u)
                continue
            if gallery:
                flush()
            if not s:
                if not (timeline and not lst):
                    flush()
                continue
            if s in ("时间线：", "时间线:"):
                flush()
                timeline.append(True)
                continue
            hm = re.match(r"^(#{3,4}) +(.+)$", s)
            if hm:
                flush()
                level = len(hm.group(1)) - 2
                title = hm.group(2).strip()
                anchor = f"s{len(stats['toc']) + 1}"
                tag = "h3" if level == 1 else "h4"
                out.append(f'<{tag} id="{anchor}">{self.inline(title)}</{tag}>')
                stats["toc"].append({"id": anchor, "title": title, "level": level})
                continue
            if s.startswith("- "):
                if para:
                    flush()
                item = s[2:].strip()
                sm = SPOT_RE.match(item)
                lst.append((sm.group(1), sm.group(2), sm.group(3)) if sm else item)
                continue
            if lst:
                flush()
            para.append(s)
            if "**待补**" in s or "**待写**" in s:
                stats["todo"] += 1
        flush()
        return "\n".join(out)


def parse_gallery_links(md: str):
    items, cur = [], None
    for line in md.splitlines():
        line = line.strip()
        if line.startswith("- 武器："):
            cur = {"weapon": line.split("：", 1)[1].strip(), "note": ""}
            items.append(cur)
        elif line.startswith("说明：") and cur is not None:
            cur["note"] = line.split("：", 1)[1].strip()
    return items


def locate(rel_parts):
    if rel_parts[0] == "选皮焚诀":
        if len(rel_parts) < 3 or rel_parts[2] not in TIERS:
            raise ValueError("选皮焚诀的正文要放在 选皮焚诀/枪名/优品|极品|通用/ 里")
        return "选皮焚诀", rel_parts[1], rel_parts[2], 3
    if rel_parts[0] == "市场焚诀":
        if len(rel_parts) < 3 or rel_parts[1] not in MARKET:
            raise ValueError("市场焚诀的正文要放在 市场焚诀/砖皮市场机制|砖皮市场见闻/文件夹名/ 里")
        return "市场焚诀", "", rel_parts[1], 2
    raise ValueError("正文.md 只能放在 选皮焚诀 或 市场焚诀 下面")


def order_key(folder_name: str):
    m = re.match(r"^(\d+)", folder_name or "")
    return int(m.group(1)) if m else 9999


def strip_order(name: str) -> str:
    return re.sub(r"^\d+[-_ ]*", "", name)


def stats_dict():
    return {"images": 0, "todo": 0, "cards": 0, "tables": 0, "links": 0, "toc": []}


def load_external(skins, problems):
    f = CONTENT / "外部链接.md"
    if not f.exists():
        return None
    meta, body = parse_front(f.read_text(encoding="utf-8"))
    r = Renderer(CONTENT, skins, {}, problems, "外部链接.md")
    groups, cur = [], {"title": "", "items": []}
    intro = []
    for line in body.splitlines():
        s = line.strip()
        if s.startswith("### "):
            if cur["items"] or cur["title"]:
                groups.append(cur)
            cur = {"title": s[4:].strip(), "items": []}
        elif s.startswith("- "):
            m = LINKITEM_RE.match(s[2:].strip())
            if m:
                u = clean_url(m.group(2))
                cur["items"].append({"title": m.group(1), "url": u, "site": site_label(u), "desc": m.group(3) or ""})
            else:
                problems.append(f"外部链接.md：这一行不是「- [标题](网址)：说明」格式：{s}")
        elif s and not groups and not cur["items"]:
            intro.append(s)
    if cur["items"] or cur["title"]:
        groups.append(cur)
    return {
        "title": meta.get("标题", "B站知识库"),
        "summary": meta.get("摘要", ""),
        "intro": r.inline(" ".join(intro)) if intro else "",
        "groups": groups,
        "count": sum(len(g["items"]) for g in groups),
    }


def main():
    covers = load_covers()
    skins, skin_counts = load_skins()
    weapons = [c["weapon"] for c in covers if c["enabled"]]
    problems = []

    # 合集
    collections = {}
    for cm in sorted(CONTENT.rglob("合集.md")):
        rel = cm.parent.relative_to(CONTENT).parts
        if rel and rel[0].startswith("_"):
            continue
        cid = "/".join(rel)
        try:
            section, weapon, tier, depth = locate(rel + ("x",))
        except ValueError as e:
            problems.append(f"{cid}：{e}")
            continue
        meta, body = parse_front(cm.read_text(encoding="utf-8"))
        sec = split_sections(body, {"后续章节"})
        r = Renderer(cm.parent, skins, {}, problems, cid)
        planned = [x.strip()[2:].strip() for x in sec["后续章节"].splitlines() if x.strip().startswith("- ")]
        collections[cid] = {
            "id": cid,
            "section": section,
            "weapon": weapon,
            "tier": tier,
            "order": order_key(rel[-1]),
            "title": meta.get("标题") or strip_order(rel[-1]),
            "subtitle": meta.get("副标题", ""),
            "summary": meta.get("摘要", ""),
            "author": meta.get("作者", ""),
            "status": meta.get("状态", "草稿"),
            "intro": r.blocks(sec["正文"], stats_dict()) if sec["正文"] else "",
            "planned": planned,
            "chapters": [],
            "coverSet": r.src(meta["封面"]) if meta.get("封面") else None,
        }

    found = []
    for md in sorted(CONTENT.rglob("正文.md")):
        rel = md.parent.relative_to(CONTENT).parts
        if rel and rel[0].startswith("_"):
            continue
        where = "/".join(rel) or "内容"
        try:
            section, weapon, tier, depth = locate(rel)
        except ValueError as e:
            problems.append(f"{where}：{e}")
            continue
        if section == "选皮焚诀" and weapon not in weapons:
            problems.append(f"{where}：枪名「{weapon}」和图鉴不一致，应为 {' / '.join(weapons)}")
            continue
        collection = None
        for k in range(len(rel) - 1, depth - 1, -1):
            cid = "/".join(rel[:k])
            if cid in collections:
                collection = cid
                break
        sub = rel[depth:]
        meta, body = parse_front(md.read_text(encoding="utf-8"))
        title = meta.get("标题") or (strip_order(sub[-1]) if sub else f"{weapon} {tier}焚诀")
        found.append((md, where, section, weapon, tier, sub, meta, body, title, collection))

    titles = {f[8]: f[1] for f in found}

    articles = []
    for md, where, section, weapon, tier, sub, meta, body, title, collection in found:
        sec = split_sections(body)
        r = Renderer(md.parent, skins, titles, problems, where)
        stats, lead_stats = stats_dict(), stats_dict()
        main_html = r.blocks(sec["正文"], stats)
        lead_raw = sec["先看这一段"]
        lead_html = r.blocks(lead_raw, lead_stats) if lead_raw else ""
        avoid = sec["不要写进回答"]
        plain = re.sub(r"!\[.*?\]\(.*?\)|[#*`>\-|▮]", "", lead_raw + sec["正文"])
        status = meta.get("状态", "草稿")
        if status not in ("草稿", "发布"):
            problems.append(f"{where}：状态只能写 草稿 或 发布，现在是「{status}」")
        folder = md.parent.name if sub else ""
        art = {
            "id": where,
            "section": section,
            "weapon": weapon,
            "tier": tier,
            "collection": collection,
            "chapterNo": (re.match(r"^(\d+)", folder).group(1) if collection and re.match(r"^(\d+)", folder) else ""),
            "order": order_key(folder if collection else (sub[0] if sub else "")),
            "title": title,
            "summary": meta.get("摘要", ""),
            "author": meta.get("作者", ""),
            "updated": meta.get("日期", ""),
            "status": status,
            "stability": "易变" if meta.get("易变", "否") in ("是", "易变") else "长期",
            "lead": lead_html,
            "leadIsStub": lead_raw.strip() in ("", "待写。", "待写"),
            # 只有模板骨架、没写内容：先看这一段是「待补」且没有图。正式站不显示这种文章
            "stub": lead_stats["todo"] > 0 and stats["images"] == 0 and stats["cards"] == 0,
            "body": main_html,
            "ownNumbers": bool(collection) or bool(stats["toc"]) and all(re.match(r"^\d", t["title"]) for t in stats["toc"] if t["level"] == 1),
            "toc": stats["toc"],
            "gallery": [] if sec["图鉴里看哪里"].strip() in ("", "无") else parse_gallery_links(sec["图鉴里看哪里"]),
            "avoid": [] if avoid.strip() in ("", "无") else [x.strip()[2:] for x in avoid.splitlines() if x.strip().startswith("- ")],
            "images": stats["images"],
            "cards": stats["cards"],
            "tables": stats["tables"],
            "todo": stats["todo"] + lead_stats["todo"],
            "cover": stats.get("cover"),
            "chars": len(re.sub(r"\s", "", plain)),
        }
        articles.append(art)
        if collection:
            collections[collection]["chapters"].append(where)

    by_id = {a["id"]: a for a in articles}
    for c in collections.values():
        c["chapters"].sort(key=lambda i: (by_id[i]["order"], by_id[i]["title"]))
        c["cover"] = c.pop("coverSet") or next((by_id[i]["cover"] for i in c["chapters"] if by_id[i]["cover"]), None)

    external = load_external(skins, problems)

    for p in problems:
        print("需要处理：", p)

    payload = {
        "articles": articles,
        "collections": list(collections.values()),
        "external": external,
        "covers": {c["weapon"]: c for c in covers},
        "weapons": weapons,
        "tiers": TIERS,
        "market": MARKET,
        "skinCounts": skin_counts,
        "built": datetime.date.today().isoformat(),
        "site": DEPLOY,
    }
    if DEPLOY:
        DIST.mkdir(parents=True, exist_ok=True)
        for name in ("index.html", "preview.css", "preview.js"):
            shutil.copy2(HERE / name, DIST / name)
        shutil.copytree(HERE / "assets", DIST / "assets", dirs_exist_ok=True)
        content_dir = DIST / "内容"
        stale = [f for f in content_dir.rglob("*") if f.is_file() and f not in EXPORTED] if content_dir.exists() else []
        for f in stale:
            f.unlink()
        if content_dir.exists():
            for d in sorted(content_dir.rglob("*"), reverse=True):
                if d.is_dir() and not any(d.iterdir()):
                    d.rmdir()
        print(f"正式站输出到 {DIST.relative_to(ROOT)}：{len(EXPORTED)} 张图，清理 {len(stale)} 张旧图")
    with io.open(OUT, "w", encoding="utf-8") as fp:
        fp.write("window.WIKI = ")
        json.dump(payload, fp, ensure_ascii=False, indent=1)
        fp.write(";\n")
    print(f"写出 {OUT.name}：{len(articles)} 篇，{len(collections)} 个合集，需要处理 {len(problems)} 处")


if __name__ == "__main__":
    main()
