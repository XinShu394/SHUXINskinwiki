(() => {
  const D = window.WIKI || { articles: [], covers: {}, weapons: [], skinCounts: {} };
  /* 正式站（site/wiki/）由 build.py --site 生成：图鉴在上一级，投稿和审核先放「开发中」页 */
  const SITE = !!D.site;
  const GALLERY = SITE ? "../index.html" : "../../site/index.html";
  const API_BASE = location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.protocol === "file:"
    ? "http://localhost:5200/api"
    : "/api";
  const TIERS = [
    { key: "优品", cls: "you", label: "优品焚诀" },
    { key: "极品", cls: "ji", label: "极品焚诀" },
    { key: "通用", cls: "tong", label: "通用焚诀" },
  ];
  const MARKET = {
    砖皮市场机制: { short: "机制", en: "Mechanism", desc: "挂单、公示期、怎样算亏。把市场规则讲清楚。" },
    砖皮市场见闻: { short: "见闻", en: "Stories", desc: "大家的抢购体验：抢到了什么，踩过什么坑，当时怎么想。" },
  };
  const MARKET_KEYS = Object.keys(MARKET);
  const MAX_IMAGES = 9;
  const MAX_BYTES = 20 * 1024 * 1024;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtTime = (ms, withTime) => {
    if (!ms) return "";
    const d = new Date(ms);
    const day = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    return withTime ? `${day} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : day;
  };
  const hoverable = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const main = () => $("kbMain");

  const state = { drafts: true, editor: !SITE, pick: {}, open: new Set(), posts: {} };
  const byId = Object.fromEntries(D.articles.map((a) => [a.id, a]));
  const COLLS = D.collections || [];
  const collById = Object.fromEntries(COLLS.map((c) => [c.id, c]));
  const collChapters = (c) => c.chapters.map((id) => byId[id]).filter((a) => a && (state.drafts || a.status === "发布"));
  const collsFor = (tier) => COLLS.filter((c) => c.tier === tier && (state.drafts || c.status === "发布"));
  const collHref = (c, no) => `#kb/c/${encodeURIComponent(c.id)}${no != null ? "/" + no : ""}`;

  const visible = () => D.articles.filter((a) => state.drafts || a.status === "发布").sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  const forWeapon = (w, tier) => visible().filter((a) => a.section === "选皮焚诀" && !a.collection && a.weapon === w && (!tier || a.tier === tier));
  const forMarket = (sub) => visible().filter((a) => a.section === "市场焚诀" && !a.collection && (!sub || a.tier === sub));
  const cover = (w) => D.covers[w] || null;
  const coverImg = (w) => {
    const c = cover(w);
    if (!c) return "";
    return `<img src="${esc(c.local)}" data-remote="${esc(c.remote)}" alt="" loading="lazy" onerror="if(this.dataset.remote&&this.src!==this.dataset.remote){this.src=this.dataset.remote}">`;
  };
  const coverTitle = (w) => {
    const c = cover(w);
    return c && c.title ? c.title.replace(new RegExp("^" + w + "-?"), "") : "";
  };
  const pips = (w) =>
    `<span class="pips">${TIERS.map((t) => `<i class="pip ${t.cls}${forWeapon(w, t.key).length ? " has" : ""}" title="${t.label}${forWeapon(w, t.key).length ? "已有" : "待补"}"></i>`).join("")}</span>`;
  const legend = () =>
    `<div class="aside">${TIERS.map((t) => `<span class="legend"><i class="pip ${t.cls} has"></i>${t.key}</span>`).join("")}<span class="legend"><i class="pip"></i>待补</span></div>`;

  /* —— 接口 —— */
  async function api(path, opts = {}) {
    const res = await fetch(API_BASE + path, opts);
    let data = {};
    try { data = await res.json(); } catch (e) { /* 空响应 */ }
    if (!res.ok) throw Object.assign(new Error(data.error || `请求失败（${res.status}）`), { status: res.status });
    return data;
  }
  async function loadPosts(sub, force) {
    if (!force && state.posts[sub] !== undefined) return state.posts[sub];
    try {
      const data = await api(`/market-posts?category=${encodeURIComponent(MARKET[sub].short)}`);
      state.posts[sub] = data.results || [];
    } catch (e) {
      state.posts[sub] = null;
    }
    return state.posts[sub];
  }
  const adminToken = () => sessionStorage.getItem("zpbk_kb_admin") || "";

  /* —— 视图 —— */
  const views = { entry: $("view-entry"), kb: $("view-kb") };
  function show(name) {
    Object.entries(views).forEach(([k, el]) => el.classList.toggle("active", k === name));
    document.body.classList.toggle("kb", name === "kb");
  }
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove("on"), 2000);
  }

  /* —— 进入页 —— */
  const wipe = document.createElement("div");
  wipe.className = "wipe";
  document.body.appendChild(wipe);
  document.querySelectorAll(".focus").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.go !== "kb") {
        if (SITE) { location.href = GALLERY + (btn.dataset.go === "gallery" ? "#gallery" : "#upload"); return; }
        toast(btn.dataset.go === "gallery" ? "本预览只做知识库，图鉴沿用现站" : "本预览只做知识库，上传沿用现站");
        return;
      }
      $("entryStage").classList.add("is-leaving");
      btn.classList.add("is-chosen");
      setTimeout(() => wipe.classList.add("on"), 180);
      setTimeout(() => {
        location.hash = "#kb";
        $("entryStage").classList.remove("is-leaving");
        btn.classList.remove("is-chosen");
        requestAnimationFrame(() => wipe.classList.remove("on"));
      }, 700);
    });
  });
  document.querySelectorAll("[data-home]").forEach((el) => (el.onclick = () => { if (SITE) location.href = "../index.html"; else location.hash = ""; }));

  /* —— 侧栏：一级栏目点开才看到二级 —— */
  let lastSide = ["home", null];
  function renderSide(active, sub) {
    lastSide = [active, sub];
    if (active === "选皮焚诀" || active === "市场焚诀") state.open.add(active);
    const group = (key, ico, href, count, children) => `
      <div class="nav-group${state.open.has(key) ? " open" : ""}${active === key ? " on" : ""}" data-group="${key}">
        <button class="nav-head" type="button" data-href="${href}"><i class="ico ${ico}"></i><span>${key}</span><em>${count}</em><i class="chev"></i></button>
        <div class="nav-children"><div><div class="inner">${children}</div></div></div>
      </div>`;
    const weapons = D.weapons
      .map((w) => `<a class="w${active === "选皮焚诀" && sub === w ? " on" : ""}" href="#kb/w/${encodeURIComponent(w)}"><span>${esc(w)}</span>${pips(w)}</a>`)
      .join("");
    const markets = MARKET_KEYS
      .map((k) => `<a class="${active === "市场焚诀" && sub === k ? "on" : ""}" href="#kb/m/${encodeURIComponent(k)}"><span>${k}</span><span class="cnt">${pad2(forMarket(k).length + collsFor(k).length + (state.posts[k] || []).length)}</span></a>` +
        collsFor(k).map((c) => `<a class="coll${active === "市场焚诀" && sub === c.id ? " on" : ""}" href="${collHref(c)}"><span>${esc(c.title)}</span></a>`).join(""))
      .join("");
    $("kbNav").innerHTML = `
      <a class="nav-item${active === "home" ? " on" : ""}" href="#kb"><i class="ico ico-home"></i><span>首页</span></a>
      ${group("选皮焚诀", "ico-scope", "#kb/选皮焚诀", pad2(D.weapons.length), weapons)}
      ${group("市场焚诀", "ico-market", "#kb/m/" + MARKET_KEYS[0], pad2(MARKET_KEYS.length), markets)}
      ${D.external ? `<a class="nav-item${active === "外链" ? " on" : ""}" href="#kb/links"><i class="ico ico-link"></i><span>${esc(D.external.title)}</span><em class="nav-cnt">${pad2(D.external.count)}</em></a>` : ""}`;
    $("kbNav").querySelectorAll(".nav-head").forEach((h) => {
      h.onclick = () => {
        const g = h.parentElement;
        const key = g.dataset.group;
        if (g.classList.contains("on")) {
          g.classList.toggle("open");
          g.classList.contains("open") ? state.open.add(key) : state.open.delete(key);
        } else {
          state.open.add(key);
          location.hash = h.dataset.href;
        }
      };
    });
  }
  const refreshSide = () => renderSide(...lastSide);

  const crumbs = (items) =>
    `<nav class="crumbs">${items
      .map((it, i) => (i === items.length - 1 ? `<b>${esc(it[0])}</b>` : `<a href="${it[1]}">${esc(it[0])}</a><span class="sep">/</span>`))
      .join("")}</nav>`;
  const loading = () => `<p class="mono" style="color:var(--faint);padding:16px 0">加载中…</p>`;

  function rowMeta(a) {
    return [
      a.stability === "易变" ? `<span class="pill volatile">易变</span>` : "",
      a.images ? `<span class="pill">${a.images} 图</span>` : "",
      a.status !== "发布" ? `<span class="pill draft editor-only">草稿</span>` : "",
      a.todo ? `<span class="pill todo editor-only">待补 ${a.todo}</span>` : "",
    ].join("");
  }
  const listHtml = (arr, big) =>
    `<ol class="list${big ? " big" : ""}">${arr
      .map((a, i) => `<li><a href="#a=${encodeURIComponent(a.id)}" data-peek="${esc(a.cover || "")}" data-cap="${esc(a.title)}">
          <span class="no">${pad2(i + 1)}</span><span class="t">${esc(a.title)}</span>
          <span class="m">${rowMeta(a)}</span><span class="s">${esc(a.summary)}</span></a></li>`)
      .join("")}</ol>`;

  const tilesHtml = () =>
    `<div class="tiles">${D.weapons
      .map((w, i) => {
        const has = forWeapon(w).length > 0;
        return `<a class="tile${has ? "" : " empty"}" href="#kb/w/${encodeURIComponent(w)}">
          ${coverImg(w)}<span class="no">${pad2(i + 1)}</span>${pips(w)}
          <span class="w">${esc(w)}</span><span class="sub">${has ? esc(coverTitle(w)) : "待补"}</span></a>`;
      })
      .join("")}</div>`;

  /* —— 合集卡片 —— */
  const collCard = (c) => {
    const chs = collChapters(c);
    return `<a class="coll-card" href="${collHref(c)}">
      <div class="cc-body">
        <div class="cc-k kicker"><span class="stamp">COLLECTION</span><span>合集 · ${pad2(chs.length)} 章</span></div>
        <h3>${esc(c.title)}</h3>
        ${c.subtitle ? `<div class="cc-sub">${esc(c.subtitle)}</div>` : ""}
        ${c.summary ? `<p class="cc-sum">${esc(c.summary)}</p>` : ""}
        <ol class="cc-ch">
          ${chs.map((a) => `<li><b>${esc(a.chapterNo)}</b>${esc(a.title)}</li>`).join("")}
          ${(c.planned || []).slice(0, 2).map((t) => `<li class="plan"><b>··</b>${esc(t)} · 待写</li>`).join("")}
        </ol>
        <span class="cc-go">开始阅读 →</span>
      </div>
      <div class="cc-art">${c.cover ? `<img src="${esc(c.cover)}" alt="" loading="lazy">` : ""}<span class="cc-num">${pad2(chs.length)}</span></div>
    </a>`;
  };

  /* —— 投稿卡片与正文 —— */
  const firstText = (body) => String(body || "").replace(/\[图\d+\]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
  const postCard = (p) => `
    <a class="post" href="#kb/p/${p.id}">
      <span class="tag-ugc">投稿</span>
      ${p.images && p.images.length
        ? `<span class="ph"><img src="${esc(p.images[0])}" alt="" loading="lazy"><span class="n">${p.images.length} 图</span></span>`
        : `<span class="ph text"><span>${esc(firstText(p.body))}</span></span>`}
      <span class="pb">
        <span class="pt">${esc(p.title)}</span>
        <span class="pm"><span class="who">${esc(p.contributor)}</span><span>${fmtTime(p.createdAt)}</span></span>
      </span>
    </a>`;

  /* 空行分段，[图n] 放图，没被引用的图排在最后 */
  function postBodyInner(body, images) {
    const used = new Set();
    const fig = (n) => {
      const src = images[n - 1];
      if (!src) return "";
      used.add(n);
      return `<figure><img src="${esc(src)}" alt="图${n}" loading="lazy"></figure>`;
    };
    const blocks = String(body || "").split(/\n{2,}/).map((chunk) =>
      chunk.split(/(\[图\d+\])/).map((part) => {
        const m = part.match(/^\[图(\d+)\]$/);
        if (m) return fig(+m[1]);
        const t = part.replace(/^\n+|\n+$/g, "");
        return t.trim() ? `<p>${esc(t)}</p>` : "";
      }).join(""));
    const rest = images.map((_, i) => i + 1).filter((n) => !used.has(n)).map(fig).join("");
    return blocks.join("") + rest;
  }
  const renderPostBody = (body, images) => `<div class="post-body">${postBodyInner(body, images)}</div>`;

  /* —— 首页 —— */
  function renderHome() {
    const done = (t) => D.weapons.filter((w) => forWeapon(w, t).length).length;
    const bars = Array.from({ length: 18 }, () => "<i></i>").join("");
    main().innerHTML = `
      <section class="hero no-photo" id="hero">
        <div class="hero-art"></div>
        <div class="hero-ghost" aria-hidden="true">ARCHIVE</div>
        <div class="hero-top"><span class="mono">ZPBK // KNOWLEDGE ARCHIVE</span><span class="bar" aria-hidden="true">${bars}</span><span class="mono">VOL.01 · ${esc(D.built || "")}</span></div>
        <h1>砖皮知识库</h1>
        <p class="hero-sub"><span>三角洲砖皮相关知识库网站</span><span>选皮焚诀</span><span>市场焚诀</span></p>
        <div class="stats">
          <div class="stat"><b>${pad2(D.weapons.length)}</b><span>枪种</span></div>
          <div class="stat"><b>${pad2(done("优品"))}<small>/${D.weapons.length}</small></b><span>优品焚诀</span></div>
          <div class="stat"><b>${pad2(done("极品"))}<small>/${D.weapons.length}</small></b><span>极品焚诀</span></div>
          <div class="stat"><b>${pad2(done("通用"))}<small>/${D.weapons.length}</small></b><span>通用焚诀</span></div>
        </div>
      </section>

      <div class="sec-head"><h2>选皮焚诀<small>SELECTION</small></h2>${legend()}</div>
      ${tilesHtml()}

      <div class="sec-head"><h2>市场焚诀<small>MARKET</small></h2></div>
      ${collsFor("砖皮市场机制").map(collCard).join("")}
      <div class="duo">
        <section>
          <div class="feed-label kicker" style="margin-top:4px"><a href="#kb/m/砖皮市场机制" style="text-decoration:none">砖皮市场机制 →</a></div>
          ${listHtml(forMarket("砖皮市场机制"))}
        </section>
        <section>
          <div class="feed-label kicker" style="margin-top:4px"><a href="#kb/m/砖皮市场见闻" style="text-decoration:none">砖皮市场见闻 · 最新 →</a></div>
          <div id="homeStories">${loading()}</div>
        </section>
      </div>
      ${D.external && D.external.count ? `<div class="sec-head"><h2>${esc(D.external.title)}<small>LINKS</small></h2><a class="aside" href="#kb/links">全部 →</a></div>
        <div class="home-links">${linksHtml(D.external.groups.flatMap((g) => g.items).slice(0, 4))}</div>` : ""}`;
    probeHero();
    bindPeek();
    const own = forMarket("砖皮市场见闻");
    if (SITE) { const b = $("homeStories"); if (b) b.innerHTML = devStub("玩家见闻", "投稿功能正在开发。"); return; }
    loadPosts("砖皮市场见闻", true).then((posts) => {
      const box = $("homeStories");
      if (!box) return;
      const items = [
        ...(posts || []).map((p) => ({ href: `#kb/p/${p.id}`, t: p.title, who: p.contributor, when: fmtTime(p.createdAt), at: p.createdAt })),
        ...own.map((a) => ({ href: `#a=${encodeURIComponent(a.id)}`, t: a.title, who: a.author, when: a.updated, at: Date.parse(a.updated) || 0 })),
      ].sort((a, b) => b.at - a.at).slice(0, 6);
      box.innerHTML = items.length
        ? `<ol class="list">${items.map((x, i) => `<li><a href="${x.href}"><span class="no">${pad2(i + 1)}</span><span class="t">${esc(x.t)}</span><span class="m"><span class="pill">${esc(x.when)}</span></span><span class="s">@${esc(x.who)}</span></a></li>`).join("")}</ol>`
        : `<div class="empty-feed"><b>还没有见闻</b>${posts === null ? "投稿服务暂时连不上。" : "第一篇抢购体验等你来写。"} <a href="#kb/投稿/砖皮市场见闻">去投稿 →</a></div>`;
      refreshSide();
    });
  }

  let heroSrc;
  function probeHero() {
    const apply = () => {
      const h = $("hero");
      if (!h || !heroSrc) return;
      h.classList.remove("no-photo");
      h.style.setProperty("--hero-img", `url("${heroSrc}")`);
    };
    if (heroSrc !== undefined) return apply();
    const im = new Image();
    im.onload = () => { heroSrc = "./assets/hero.jpg"; apply(); };
    im.onerror = () => { heroSrc = null; };
    im.src = "./assets/hero.jpg";
  }

  /* —— 选皮焚诀总览 —— */
  function renderSelection() {
    main().innerHTML = `
      ${crumbs([["知识库", "#kb"], ["选皮焚诀"]])}
      <header class="page-head">
        <span class="ghost" aria-hidden="true">SELECTION</span>
        <div class="kicker">Selection</div>
        <h1>选皮焚诀</h1>
        <p>按枪种分。每把枪有优品、极品、通用三栏，不分品级的内容放在通用里。</p>
      </header>
      <div class="sec-head"><h2>全部枪种<small>${pad2(D.weapons.length)} WEAPONS</small></h2>${legend()}</div>
      ${tilesHtml()}`;
  }

  /* —— 枪种页 —— */
  function renderWeapon(w, tierKey) {
    if (!D.weapons.includes(w)) return (location.hash = "#kb/选皮焚诀");
    const idx = D.weapons.indexOf(w);
    const cur = TIERS.find((t) => t.key === tierKey) || TIERS.find((t) => forWeapon(w, t.key).length) || TIERS[0];
    const list = forWeapon(w, cur.key);
    const pick = list.find((a) => a.id === state.pick[w + cur.key]) || list[0];
    const prev = D.weapons[(idx - 1 + D.weapons.length) % D.weapons.length];
    const next = D.weapons[(idx + 1) % D.weapons.length];
    const tabs = TIERS.map((t) => {
      const n = forWeapon(w, t.key).length;
      return `<button class="tier${t === cur ? " on" : ""}" data-tier="${t.key}" type="button"><span class="badge ${t.cls}">${t.key}</span>${t.label}<span class="st">${n ? pad2(n) : "待补"}</span></button>`;
    }).join("");
    const content = pick
      ? `${list.length > 1 ? `<div class="subnav">${list.map((a) => `<button type="button" data-pick="${esc(a.id)}" class="${a === pick ? "on" : ""}">${esc(a.title)}</button>`).join("")}</div>` : ""}
         ${readerHtml(pick, true)}`
      : `<div class="empty-tier">
           <div class="kicker">${esc(w)} · ${cur.label} · 待补</div>
           <h3>这一栏还在整理</h3>
           <p class="editor-only">把正文.md 和图片放进 <code>wiki/内容/选皮焚诀/${esc(w)}/${cur.key}/</code>，运行一次 build.py，这里就会出现。</p>
         </div>`;
    main().innerHTML = `
      ${crumbs([["知识库", "#kb"], ["选皮焚诀", "#kb/选皮焚诀"], [w]])}
      <header class="w-head">
        <span class="w-ghost" aria-hidden="true">${esc(w)}</span>
        <div class="w-info">
          <div class="kicker"><span>Selection</span><i></i><span>${pad2(idx + 1)} / ${pad2(D.weapons.length)}</span></div>
          <h1>${esc(w)}</h1>
          <div class="cover-name">封面 · ${esc(coverTitle(w))}</div>
          <div class="facts">
            <div><b>${(D.skinCounts || {})[w] || 0}</b>图鉴收录</div>
            ${TIERS.map((t) => `<div><b>${forWeapon(w, t.key).length ? "已写" : "待补"}</b>${t.label}</div>`).join("")}
          </div>
          <a class="to-gallery" href="${GALLERY}#w=${encodeURIComponent(w)}" target="_blank" rel="noopener">在图鉴里看 ${esc(w)} ↗</a>
        </div>
        <div class="w-cover">${coverImg(w)}<span class="corner mono">${esc(cover(w)?.title || "")}</span></div>
      </header>
      <div class="tiers">${tabs}</div>
      ${content}
      <nav class="w-pager">
        <a href="#kb/w/${encodeURIComponent(prev)}"><span class="kicker">← 上一把</span><b>${esc(prev)}</b></a>
        <a class="next" href="#kb/w/${encodeURIComponent(next)}"><span class="kicker">下一把 →</span><b>${esc(next)}</b></a>
      </nav>`;
    main().querySelectorAll(".tier").forEach((b) => (b.onclick = () => (location.hash = `#kb/w/${encodeURIComponent(w)}/${b.dataset.tier}`)));
    main().querySelectorAll("[data-pick]").forEach((b) => (b.onclick = () => { state.pick[w + cur.key] = b.dataset.pick; renderWeapon(w, cur.key); }));
    afterReader();
  }

  /* —— 市场焚诀 —— */
  function renderMarket(sub) {
    const info = MARKET[sub];
    const own = forMarket(sub);
    main().innerHTML = `
      ${crumbs([["知识库", "#kb"], ["市场焚诀", "#kb/m/" + MARKET_KEYS[0]], [sub]])}
      <header class="page-head">
        <span class="ghost" aria-hidden="true">MARKET</span>
        <div class="kicker">Market</div>
        <h1>市场焚诀</h1>
      </header>
      <nav class="sub-tabs">${MARKET_KEYS.map((k) => `<a class="${k === sub ? "on" : ""}" href="#kb/m/${encodeURIComponent(k)}">${k}<small>${MARKET[k].en.toUpperCase()}</small></a>`).join("")}</nav>
      ${sub === "砖皮市场见闻" && !SITE ? `<div class="sub-intro"><p></p><a class="btn go" href="#kb/投稿/${encodeURIComponent(sub)}">＋ 投稿我的见闻</a></div>` : ""}
      ${collsFor(sub).map(collCard).join("")}
      ${own.length ? listHtml(own, true) : ""}
      ${sub === "砖皮市场见闻" ? `<div class="feed-label kicker">玩家投稿</div><div id="postFeed">${loading()}</div>` : ""}`;
    bindPeek();
    if (sub !== "砖皮市场见闻") return;
    if (SITE) { $("postFeed").innerHTML = devStub("玩家见闻投稿", "大家的购买故事会显示在这里。投稿和审核功能正在开发，先看砖皮市场机制。"); return; }
    loadPosts(sub, true).then((posts) => {
      const box = $("postFeed");
      if (!box) return;
      if (posts === null) {
        box.innerHTML = `<div class="empty-feed"><b>投稿暂时加载不出来</b>投稿服务连不上，稍后再试。</div>
          <p class="api-down editor-only">本地预览需要先运行 <code>python wiki/preview/run_api_local.py</code>。</p>`;
      } else if (!posts.length) {
        box.innerHTML = `<div class="empty-feed"><b>还没有投稿</b>审核通过的投稿会出现在这里。 <a href="#kb/投稿/${encodeURIComponent(sub)}">写第一篇 →</a></div>`;
      } else {
        box.innerHTML = `<div class="posts">${posts.map(postCard).join("")}</div>`;
      }
      refreshSide();
    });
  }

  async function renderPost(id) {
    main().innerHTML = loading();
    let p;
    try {
      p = (await api(`/market-posts/${encodeURIComponent(id)}`)).result;
    } catch (e) {
      main().innerHTML = `${crumbs([["知识库", "#kb"], ["市场焚诀", "#kb/m/" + MARKET_KEYS[0]], ["投稿"]])}
        <div class="empty-tier"><h3>找不到这篇投稿</h3><p>${esc(e.message)}</p></div>`;
      return;
    }
    renderSide("市场焚诀", p.category);
    main().innerHTML = `
      ${crumbs([["知识库", "#kb"], ["市场焚诀", "#kb/m/" + MARKET_KEYS[0]], [p.category, "#kb/m/" + encodeURIComponent(p.category)], [p.title]])}
      <div class="reader solo">
        <div class="r-col">
          <header class="r-head">
            <div class="kicker"><span>${esc(p.category)}</span><i></i><span>玩家投稿</span></div>
            <h2 class="r-title">${esc(p.title)}</h2>
            <div class="byline"><span class="av">${esc((p.contributor || "匿")[0])}</span><span><b>${esc(p.contributor)}</b> 投稿于 ${fmtTime(p.createdAt, true)}</span></div>
          </header>
          ${renderPostBody(p.body, p.images || [])}
          <nav class="w-pager"><a href="#kb/m/${encodeURIComponent(p.category)}"><span class="kicker">← 返回</span><b style="font-family:var(--sans);font-size:20px">${esc(p.category)}</b></a></nav>
        </div>
        <aside class="r-toc"></aside>
      </div>`;
    bindPostImages();
  }

  /* —— 外部链接 —— */
  function linksHtml(items) {
    return `<ul class="links">${items.map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">
      <span class="lk-site">${esc(x.site)}</span><span class="lk-t">${esc(x.title)}</span>${x.desc ? `<span class="lk-d">${esc(x.desc)}</span>` : ""}<span class="lk-go" aria-hidden="true">↗</span></a></li>`).join("")}</ul>`;
  }

  function renderLinks() {
    const ex = D.external;
    if (!ex) return (location.hash = "#kb");
    main().innerHTML = `
      ${crumbs([["知识库", "#kb"], [ex.title]])}
      <header class="page-head">
        <span class="ghost" aria-hidden="true">LINKS</span>
        <div class="kicker">Links</div>
        <h1>${esc(ex.title)}</h1>
        ${ex.summary ? `<p>${esc(ex.summary)}</p>` : ""}
      </header>
      <div class="ext-groups">${ex.groups.map((g) => `<section>${g.title ? `<h3>${esc(g.title)}</h3>` : ""}${linksHtml(g.items)}</section>`).join("")}</div>
      <p class="editor-only api-down" style="margin-top:40px">在 <code>wiki/内容/外部链接.md</code> 里增删链接，一行一个：<code>- [标题](网址)：一句话说明</code>。</p>`;
  }

  /* —— 合集 —— */
  function renderCollection(cid, no) {
    const c = collById[cid];
    if (!c) return (location.hash = "#kb");
    const chs = collChapters(c);
    const cur = chs.find((a) => a.chapterNo === no) || chs[0];
    const i = chs.indexOf(cur);
    const prev = chs[i - 1], next = chs[i + 1];
    const tabs = chs.map((a) => `<button type="button" class="ch-tab${a === cur ? " on" : ""}" data-no="${esc(a.chapterNo)}"><b>${esc(a.chapterNo)}</b><span>${esc(a.title)}</span></button>`).join("") +
      (c.planned || []).map((t) => `<span class="ch-tab plan"><b>··</b><span>${esc(t)}</span></span>`).join("");
    main().innerHTML = `
      ${crumbs([["知识库", "#kb"], ["市场焚诀", "#kb/m/" + MARKET_KEYS[0]], [c.tier, "#kb/m/" + encodeURIComponent(c.tier)], [c.title]])}
      <header class="c-head">
        ${c.cover ? `<div class="c-art" aria-hidden="true"><img src="${esc(c.cover)}" alt=""></div>` : `<span class="flap" aria-hidden="true"></span>`}
        <div class="kicker"><span>Collection</span><i></i><span>${esc(c.tier)}</span></div>
        <h1>${esc(c.title)}</h1>
        ${c.subtitle ? `<div class="sub">${esc(c.subtitle)}</div>` : ""}
        ${c.intro ? `<div class="intro">${c.intro}</div>` : ""}
        <div class="c-meta"><span><b>${pad2(chs.length)}</b>章已更新</span>${c.planned && c.planned.length ? `<span><b>${pad2(c.planned.length)}</b>章待写</span>` : ""}${c.author ? `<span>作者 ${esc(c.author)}</span>` : ""}</div>
        <nav class="ch-tabs">${tabs}</nav>
      </header>
      ${cur ? readerHtml(cur, false, true) : `<div class="empty-tier"><h3>还没有章节</h3></div>`}
      <nav class="ch-pager">
        ${prev ? `<a href="${collHref(c, prev.chapterNo)}"><span class="kicker">← 上一章</span><b><em>${esc(prev.chapterNo)}</em>${esc(prev.title)}</b></a>` : `<span class="na">这是第一章</span>`}
        ${next ? `<a class="next" href="${collHref(c, next.chapterNo)}"><span class="kicker">下一章 →</span><b><em>${esc(next.chapterNo)}</em>${esc(next.title)}</b></a>` : `<span class="na">${c.planned && c.planned.length ? "下一章还在写" : "已经是最后一章"}</span>`}
      </nav>`;
    main().querySelectorAll(".ch-tab[data-no]").forEach((b) => (b.onclick = () => (location.hash = collHref(c, b.dataset.no))));
    afterReader();
  }

  /* —— 投稿表单 —— */
  const draft = { files: [], category: "砖皮市场见闻" };
  function myTickets() {
    try { return JSON.parse(localStorage.getItem("zpbk_market_tickets") || "[]"); } catch (e) { return []; }
  }
  function renderSubmit(preset) {
    if (MARKET[preset]) draft.category = preset;
    draft.files.forEach((f) => URL.revokeObjectURL(f.url));
    draft.files = [];
    const tickets = myTickets();
    main().innerHTML = `
      ${crumbs([["知识库", "#kb"], ["市场焚诀", "#kb/m/" + MARKET_KEYS[0]], ["投稿"]])}
      <header class="page-head">
        <span class="ghost" aria-hidden="true">SUBMIT</span>
        <div class="kicker">Submit</div>
        <h1>投稿市场焚诀</h1>
        <p>图文都可以。提交后进入审核，通过后会显示在对应栏目里，并标上你的署名和投稿日期。</p>
      </header>
      ${tickets.length ? `<div class="feed-label kicker">我的投稿 · 这台设备</div><ol id="myTickets" class="list"></ol>` : ""}
      <form class="form" id="subForm" novalidate>
        <div class="field">
          <span class="lb">投到哪一栏</span>
          <div class="choice">
            ${MARKET_KEYS.map((k) => `<label><input type="radio" name="category" value="${k}" ${k === draft.category ? "checked" : ""}><b>${k}</b><span>${MARKET[k].desc}</span></label>`).join("")}
          </div>
        </div>
        <div class="field">
          <label for="fTitle">标题 <small id="cTitle">0 / 40</small></label>
          <input type="text" id="fTitle" maxlength="40" placeholder="例如：公示期 30 分钟抢到一把 K416" />
        </div>
        <div class="field">
          <label for="fName">署名 <small>会显示在投稿上，最多 20 字</small></label>
          <input type="text" id="fName" maxlength="20" placeholder="你的昵称，不填显示为匿名" />
        </div>
        <div class="field">
          <span class="lb">图片 <small id="cImg"></small></span>
          <div class="pick-zone" id="pickZone"></div>
          <input type="file" id="fFiles" accept="image/png,image/jpeg" multiple hidden />
        </div>
        <div class="field">
          <label for="fBody">正文 <small id="cBody">0 / 5000</small></label>
          <div class="sub-tabs" style="margin:0 0 10px"><a href="javascript:void 0" class="on" data-mode="edit">编辑</a><a href="javascript:void 0" data-mode="preview">预览</a></div>
          <textarea id="fBody" maxlength="5000" placeholder="空一行就是新的一段。&#10;&#10;想把图放在文字中间，点图片下面的「插入」，或者直接写 [图1]。"></textarea>
          <div id="fPreview" class="post-body" hidden></div>
          <p class="hint">空一行分段。<code>[图1]</code> 表示把第 1 张图放在这里，没被写进正文的图会自动排在最后。</p>
        </div>
        <p class="form-err" id="fErr" hidden></p>
        <div class="form-foot">
          <button class="btn go" type="submit" id="fSend">提交审核</button>
          <span class="note">审核通过前只有审核员能看到。每人每天最多 20 篇。</span>
        </div>
        <div class="progress" id="fProg" hidden><i></i></div>
      </form>`;

    $("fName").value = localStorage.getItem("zpbk_market_name") || "";
    const body = $("fBody");
    const count = (id, el, max) => ($(id).textContent = `${el.value.length} / ${max}`);
    $("fTitle").oninput = () => count("cTitle", $("fTitle"), 40);
    body.oninput = () => count("cBody", body, 5000);
    main().querySelectorAll('input[name="category"]').forEach((r) => (r.onchange = () => (draft.category = r.value)));

    main().querySelectorAll("[data-mode]").forEach((a) => {
      a.onclick = () => {
        main().querySelectorAll("[data-mode]").forEach((x) => x.classList.toggle("on", x === a));
        const pv = a.dataset.mode === "preview";
        body.hidden = pv;
        $("fPreview").hidden = !pv;
        if (pv) {
          const title = $("fTitle").value.trim();
          $("fPreview").innerHTML = (title ? `<h2 class="r-title" style="font-size:30px">${esc(title)}</h2>` : "") +
            (body.value.trim() ? postBodyInner(body.value, draft.files.map((f) => f.url)) : `<p style="color:var(--faint)">还没有写正文。</p>`);
          bindPostImages();
        }
      };
    });

    const zone = $("pickZone");
    const input = $("fFiles");
    function drawThumbs() {
      zone.innerHTML =
        draft.files.map((f, i) => `
          <div class="thumb"><img src="${f.url}" alt=""><span class="lab">图${i + 1}</span>
            <span class="acts"><button type="button" data-ins="${i}">插入</button><button type="button" data-del="${i}">删除</button></span></div>`).join("") +
        (draft.files.length < MAX_IMAGES ? `<div class="add-tile" id="addTile"><span class="big">＋</span>添加图片<small style="font-size:11px;color:var(--faint)">点击或拖进来</small></div>` : "");
      $("cImg").textContent = `${draft.files.length} / ${MAX_IMAGES} · 单张 20MB 以内 · PNG / JPG`;
      const add = $("addTile");
      if (add) {
        add.onclick = () => input.click();
        add.ondragover = (e) => { e.preventDefault(); add.classList.add("drag"); };
        add.ondragleave = () => add.classList.remove("drag");
        add.ondrop = (e) => { e.preventDefault(); add.classList.remove("drag"); addFiles(e.dataTransfer.files); };
      }
      zone.querySelectorAll("[data-ins]").forEach((b) => (b.onclick = () => insertMarker(+b.dataset.ins + 1)));
      zone.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => removeFile(+b.dataset.del)));
    }
    function addFiles(list) {
      for (const f of list) {
        if (draft.files.length >= MAX_IMAGES) { toast(`最多 ${MAX_IMAGES} 张图`); break; }
        if (!/^image\/(png|jpeg)$/.test(f.type)) { toast(`${f.name} 不是 PNG 或 JPG`); continue; }
        if (f.size > MAX_BYTES) { toast(`${f.name} 超过 20MB`); continue; }
        draft.files.push({ file: f, url: URL.createObjectURL(f) });
      }
      drawThumbs();
    }
    function insertMarker(n) {
      const s = body.selectionStart ?? body.value.length;
      const e = body.selectionEnd ?? s;
      const before = body.value.slice(0, s);
      const pre = before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
      const mark = `${pre}[图${n}]\n\n`;
      body.value = before + mark + body.value.slice(e);
      body.focus();
      body.selectionStart = body.selectionEnd = s + mark.length;
      body.oninput();
    }
    function removeFile(i) {
      URL.revokeObjectURL(draft.files[i].url);
      draft.files.splice(i, 1);
      const n = i + 1;
      body.value = body.value
        .replace(new RegExp(`\\[图${n}\\]\\n*`, "g"), "")
        .replace(/\[图(\d+)\]/g, (m, k) => (+k > n ? `[图${+k - 1}]` : m));
      body.oninput();
      drawThumbs();
    }
    input.onchange = () => { addFiles(input.files); input.value = ""; };
    drawThumbs();
    if (tickets.length) refreshTickets(tickets);
    $("subForm").onsubmit = (e) => { e.preventDefault(); sendPost(); };
  }

  async function refreshTickets(tickets) {
    const box = $("myTickets");
    if (!box) return;
    const label = { pending_review: "审核中", approved: "已通过", rejected: "未通过", created: "没传完" };
    const rows = await Promise.all(tickets.slice(0, 5).map(async (t) => {
      try {
        const r = (await api(`/market-posts/query?ticket=${encodeURIComponent(t.ticket)}`)).result;
        return { ...t, status: r.status, note: r.reviewNote };
      } catch (e) {
        return { ...t, status: "unknown" };
      }
    }));
    if (!$("myTickets")) return;
    box.innerHTML = rows.map((r, i) => `<li><a href="${r.status === "approved" ? `#kb/p/${r.id}` : "javascript:void 0"}">
      <span class="no">${pad2(i + 1)}</span><span class="t">${esc(r.title)}</span>
      <span class="m"><span class="pill${r.status === "approved" ? " todo" : ""}">${label[r.status] || "查询失败"}</span></span>
      <span class="s">${esc(r.category)} · ${fmtTime(r.at)}${r.note ? " · 理由：" + esc(r.note) : ""}</span></a></li>`).join("");
  }

  function loadOssSdk() {
    if (window.OSS) return Promise.resolve();
    return new Promise((ok, bad) => {
      const s = document.createElement("script");
      s.src = "https://gosspublic.alicdn.com/aliyun-oss-sdk-6.18.0.min.js";
      s.onload = ok;
      s.onerror = () => bad(new Error("上传组件加载失败，请检查网络"));
      document.head.appendChild(s);
    });
  }

  async function sendPost() {
    const err = $("fErr");
    const fail = (m) => { err.textContent = m; err.hidden = false; err.scrollIntoView({ block: "center", behavior: "smooth" }); };
    err.hidden = true;
    const category = (main().querySelector('input[name="category"]:checked') || {}).value;
    const title = $("fTitle").value.trim();
    const contributor = $("fName").value.trim();
    const body = $("fBody").value.trim();
    if (!category) return fail("请选择投到哪一栏。");
    if (title.length < 2) return fail("标题至少 2 个字。");
    if (body.length < 10) return fail("正文至少 10 个字。");
    const bad = [...body.matchAll(/\[图(\d+)\]/g)].map((m) => +m[1]).filter((n) => n < 1 || n > draft.files.length);
    if (bad.length) return fail(`正文里写了 [图${bad[0]}]，但只有 ${draft.files.length} 张图。`);

    const btn = $("fSend");
    const prog = $("fProg");
    const bar = prog.querySelector("i");
    btn.disabled = true;
    btn.textContent = "提交中…";
    prog.hidden = false;
    bar.style.width = "8%";
    try {
      localStorage.setItem("zpbk_market_name", contributor);
      const created = await api("/market-posts/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: MARKET[category].short, title, body, contributor, imageCount: draft.files.length }),
      });
      let keys = [];
      if (draft.files.length) {
        if (created.mode === "local") {
          const fd = new FormData();
          draft.files.forEach((f, i) => fd.append(`img${i + 1}`, f.file));
          bar.style.width = "40%";
          keys = (await api(`/market-posts/${created.id}/files?ticket=${encodeURIComponent(created.queryToken)}`, { method: "POST", body: fd })).keys;
        } else {
          await loadOssSdk();
          const sts = created.sts;
          const client = new window.OSS({ region: sts.region, accessKeyId: sts.accessKeyId, accessKeySecret: sts.accessKeySecret, stsToken: sts.securityToken, bucket: sts.bucket });
          for (let i = 0; i < draft.files.length; i++) {
            const f = draft.files[i].file;
            const key = `${sts.keyPrefix}${i + 1}${f.type === "image/png" ? ".png" : ".jpg"}`;
            await client.multipartUpload(key, f, { progress: (p) => (bar.style.width = `${10 + ((i + p) / draft.files.length) * 75}%`) });
            keys.push(key);
          }
        }
      }
      bar.style.width = "92%";
      await api("/market-posts/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: created.id, queryToken: created.queryToken, images: keys }),
      });
      bar.style.width = "100%";
      const tickets = myTickets();
      tickets.unshift({ id: created.id, ticket: created.queryToken, title, category, at: Date.now() });
      localStorage.setItem("zpbk_market_tickets", JSON.stringify(tickets.slice(0, 20)));
      draft.files.forEach((f) => URL.revokeObjectURL(f.url));
      draft.files = [];
      main().innerHTML = `
        ${crumbs([["知识库", "#kb"], ["市场焚诀", "#kb/m/" + MARKET_KEYS[0]], ["投稿"]])}
        <div class="done">
          <div class="kicker" style="color:var(--signal-ink)">Submitted · No.${created.id}</div>
          <h2>已提交，等待审核</h2>
          <p>《${esc(title)}》投到了「${esc(category)}」。审核通过后会出现在栏目里，署名 ${esc(contributor || "匿名")}，日期是今天。</p>
          <p style="color:var(--mute);font-size:13px">这台设备会记住你的投稿，回到投稿页就能看到审核进度。换设备的话，把下面的票据存起来。</p>
          <div class="ticket">${esc(created.queryToken)}</div>
          <div class="acts"><a class="btn go" href="#kb/m/${encodeURIComponent(category)}">去${esc(category)}看看</a><button class="btn ghost" type="button" id="again">再投一篇</button></div>
        </div>`;
      $("again").onclick = () => renderSubmit(category);
      window.scrollTo(0, 0);
    } catch (e) {
      fail(e.status ? e.message : `提交失败：${e.message || "投稿服务连不上"}`);
      btn.disabled = false;
      btn.textContent = "提交审核";
      prog.hidden = true;
    }
  }

  /* —— 审核 —— */
  const reviewState = { status: "pending_review" };
  function renderReview() {
    const token = adminToken();
    if (!token) {
      main().innerHTML = `
        ${crumbs([["知识库", "#kb"], ["审核"]])}
        <header class="page-head"><div class="kicker">Review</div><h1>审核市场焚诀</h1><p>输入审核密钥。和图鉴投稿用的是同一把密钥。</p></header>
        <form class="login field" id="loginForm"><div class="row"><input type="password" id="tok" placeholder="审核密钥" autocomplete="current-password" /><button class="btn" type="submit">进入</button></div><p class="form-err" id="lErr" hidden style="margin-top:12px"></p></form>`;
      $("loginForm").onsubmit = async (e) => {
        e.preventDefault();
        const t = $("tok").value.trim();
        if (!t) return;
        try {
          await api("/market-posts/review", { headers: { Authorization: `Bearer ${t}` } });
          sessionStorage.setItem("zpbk_kb_admin", t);
          renderReview();
        } catch (er) {
          $("lErr").textContent = er.status === 401 ? "密钥不对。" : `连不上审核服务：${er.message}`;
          $("lErr").hidden = false;
        }
      };
      return;
    }
    main().innerHTML = `
      ${crumbs([["知识库", "#kb"], ["审核"]])}
      <header class="page-head"><div class="kicker">Review</div><h1>审核市场焚诀</h1></header>
      <div class="rv-bar">
        <div class="tabs">${[["pending_review", "待审"], ["approved", "已通过"], ["rejected", "已拒绝"]].map(([k, l]) => `<button type="button" data-st="${k}" class="${k === reviewState.status ? "on" : ""}">${l}</button>`).join("")}</div>
        <button class="btn ghost" type="button" id="logout">退出审核</button>
      </div>
      <div id="rvList">${loading()}</div>`;
    main().querySelectorAll("[data-st]").forEach((b) => (b.onclick = () => { reviewState.status = b.dataset.st; renderReview(); }));
    $("logout").onclick = () => { sessionStorage.removeItem("zpbk_kb_admin"); renderReview(); };
    loadReview();
  }

  async function loadReview() {
    const box = $("rvList");
    let rows;
    try {
      rows = (await api(`/market-posts/review?status=${reviewState.status}`, { headers: { Authorization: `Bearer ${adminToken()}` } })).results;
    } catch (e) {
      if (e.status === 401) { sessionStorage.removeItem("zpbk_kb_admin"); return renderReview(); }
      box.innerHTML = `<div class="api-down">连不上审核服务：${esc(e.message)}</div>`;
      return;
    }
    if (!$("rvList")) return;
    if (!rows.length) {
      box.innerHTML = `<div class="empty-feed"><b>${reviewState.status === "pending_review" ? "没有待审的投稿" : "这里还是空的"}</b></div>`;
      return;
    }
    box.innerHTML = rows.map((p) => `
      <article class="rv" data-id="${p.id}">
        <div class="rv-main">
          <div class="k"><span class="cat">${esc(p.category)}</span><span>No.${p.id}</span><span>@${esc(p.contributor)}</span><span>${fmtTime(p.createdAt, true)}</span><span>${p.images.length} 图</span></div>
          <h3>${esc(p.title)}</h3>
          ${renderPostBody(p.body, p.images)}
        </div>
        <div class="rv-side">
          ${p.status === "pending_review" ? `
            <label>栏目<select data-f="category">${MARKET_KEYS.map((k) => `<option value="${MARKET[k].short}" ${k === p.category ? "selected" : ""}>${k}</option>`).join("")}</select></label>
            <label>标题（可改）<input data-f="title" value="${esc(p.title)}" maxlength="40"></label>
            <label>拒绝理由（可选）<input data-f="note" maxlength="200" placeholder="例如：和已有内容重复"></label>
            <div class="acts"><button class="btn danger" type="button" data-act="reject">拒绝</button><button class="btn go" type="button" data-act="approve">通过</button></div>`
          : `<p class="st ${p.status === "approved" ? "ok" : "no"}">${p.status === "approved" ? "已通过" : "已拒绝"} · ${fmtTime(p.reviewedAt, true)}</p>${p.reviewNote ? `<p class="st">理由：${esc(p.reviewNote)}</p>` : ""}`}
        </div>
      </article>`).join("");
    box.querySelectorAll("[data-act]").forEach((b) => {
      b.onclick = async () => {
        const card = b.closest(".rv");
        const val = (f) => card.querySelector(`[data-f="${f}"]`).value.trim();
        const approve = b.dataset.act === "approve";
        card.querySelectorAll("button").forEach((x) => (x.disabled = true));
        try {
          await api(`/market-posts/${card.dataset.id}/${approve ? "approve" : "reject"}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` },
            body: JSON.stringify(approve ? { category: val("category"), title: val("title") } : { note: val("note") }),
          });
          state.posts = {};
          toast(approve ? "已通过，现在所有人都能看到" : "已拒绝");
          card.style.transition = "opacity 300ms, transform 300ms";
          card.style.opacity = "0";
          card.style.transform = "translateX(12px)";
          setTimeout(loadReview, 300);
        } catch (e) {
          toast(e.message);
          card.querySelectorAll("button").forEach((x) => (x.disabled = false));
        }
      };
    });
    bindPostImages();
  }

  /* —— 阅读（站长整理的词条） —— */
  function tagBeforeAfter(html) {
    return html
      .replace(/<figure>(<img [^>]*alt="改模前")/g, '<figure data-tag="改模前">$1')
      .replace(/<figure>(<img [^>]*alt="改模后")/g, '<figure data-tag="改模后">$1');
  }
  function readerHtml(a, inWeapon, inColl) {
    const meta = [
      a.author ? `<span class="pill">作者 ${esc(a.author)}</span>` : "",
      a.updated ? `<span class="pill">日期 ${esc(a.updated)}</span>` : "",
      a.stability === "易变" ? `<span class="pill volatile">易变 · 当时经验</span>` : "",
      a.images ? `<span class="pill">${a.images} 图</span>` : "",
      a.cards ? `<span class="pill">${a.cards} 张图鉴卡</span>` : "",
      `<span class="pill editor-only">约 ${a.chars} 字</span>`,
      a.status !== "发布" ? `<span class="pill draft editor-only">状态 · ${esc(a.status)}</span>` : "",
      a.todo ? `<span class="pill todo editor-only">待补 ${a.todo} 处</span>` : "",
      `<span class="pill editor-only">wiki/内容/${esc(a.id)}/</span>`,
    ].join("");
    const volatileNote = a.stability === "易变"
      ? `<p class="volatile-note"><b>注意</b><span>本篇写于 ${esc(a.updated)}，${a.section === "市场焚诀" ? "价格和行情是当时的经验，不代表现在。" : "内容基于当时的信息，之后可能变化。"}</span></p>`
      : "";
    const goto = a.gallery.filter((g) => !inWeapon || g.weapon !== a.weapon);
    const gotoHtml = goto.length
      ? `<section class="r-block"><span class="kicker">图鉴里看哪里</span><div class="goto">${goto
          .map((g) => `<a href="${GALLERY}#w=${encodeURIComponent(g.weapon)}" target="_blank" rel="noopener"><div class="cv">${coverImg(g.weapon)}</div><div><div class="w">${esc(g.weapon)}</div><div class="note">${esc(g.note)}</div></div><span class="go">去图鉴 ↗</span></a>`)
          .join("")}</div></section>`
      : "";
    const avoid = a.avoid.length
      ? `<section class="avoid editor-only"><span class="kicker">不要写进回答 · 读者不可见</span><ul>${a.avoid.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>`
      : "";
    const toc = a.toc.length
      ? `<aside class="r-toc"><nav><span class="kicker">本篇</span>${a.toc.map((t) => `<a href="#${t.id}" data-sec="${t.id}" class="lv${t.level || 1}">${esc(t.title)}</a>`).join("")}</nav></aside>`
      : "<aside class='r-toc'></aside>";
    return `<div class="reader${inWeapon ? "" : " solo"}">
      <div class="r-col">
        <header class="r-head">
          <div class="kicker">${inColl ? `<span>第 ${esc(a.chapterNo)} 章</span>` : `<span>${esc(a.section)}</span><i></i><span>${esc(a.tier)}</span>`}</div>
          <h2 class="r-title">${esc(a.title)}</h2>
          ${a.summary ? `<p class="r-sum">${esc(a.summary)}</p>` : ""}
          <div class="r-meta">${meta}</div>
        </header>
        ${volatileNote}
        ${a.lead ? `<section class="lead${a.leadIsStub ? " stub" : ""}"><span class="kicker">先看这一段</span>${a.lead}</section>` : ""}
        <div class="prose${a.ownNumbers ? " own-num" : ""}">${tagBeforeAfter(a.body)}</div>
        ${gotoHtml}${avoid}
      </div>
      ${toc}
    </div>`;
  }

  function renderArticle(id) {
    const a = byId[id];
    if (!a) return (location.hash = "#kb");
    if (a.collection && collById[a.collection]) return (location.hash = collHref(collById[a.collection], a.chapterNo));
    if (a.section === "选皮焚诀") {
      state.pick[a.weapon + a.tier] = a.id;
      return (location.hash = `#kb/w/${encodeURIComponent(a.weapon)}/${a.tier}`);
    }
    const list = forMarket(a.tier);
    const i = list.findIndex((x) => x.id === a.id);
    const prev = list[i - 1], next = list[i + 1];
    main().innerHTML = `
      ${crumbs([["知识库", "#kb"], ["市场焚诀", "#kb/m/" + MARKET_KEYS[0]], [a.tier, "#kb/m/" + encodeURIComponent(a.tier)], [a.title]])}
      ${readerHtml(a, false)}
      <nav class="w-pager">
        ${prev ? `<a href="#a=${encodeURIComponent(prev.id)}"><span class="kicker">← 上一篇</span><b style="font-family:var(--sans);font-size:20px">${esc(prev.title)}</b></a>` : "<span></span>"}
        ${next ? `<a class="next" href="#a=${encodeURIComponent(next.id)}"><span class="kicker">下一篇 →</span><b style="font-family:var(--sans);font-size:20px">${esc(next.title)}</b></a>` : "<span></span>"}
      </nav>`;
    afterReader();
  }

  function afterReader() {
    bindGallery();
    bindToc();
    bindSpots();
  }

  /* —— 悬停预览 —— */
  const peek = $("peek");
  const peekImg = peek.querySelector("img");
  const peekCap = peek.querySelector(".peek-cap");
  let px = 0, py = 0, tx = 0, ty = 0, raf = 0;
  const loop = () => {
    px += (tx - px) * 0.2;
    py += (ty - py) * 0.2;
    peek.style.transform = `translate3d(${px}px, ${py}px, 0)`;
    raf = requestAnimationFrame(loop);
  };
  const aim = (e) => {
    const w = 340;
    tx = e.clientX + 24 + w > innerWidth ? e.clientX - w - 24 : e.clientX + 24;
    ty = Math.min(innerHeight - 240, Math.max(16, e.clientY - 100));
  };
  function peekOn(src, cap, e) {
    if (!src || !hoverable) return;
    peekImg.src = src;
    peekCap.textContent = cap || "";
    aim(e);
    px = tx; py = ty;
    peek.classList.add("on");
    if (!raf) raf = requestAnimationFrame(loop);
  }
  function peekOff() {
    peek.classList.remove("on");
    cancelAnimationFrame(raf);
    raf = 0;
  }
  function bindPeek() {
    main().querySelectorAll("[data-peek]").forEach((el) => {
      el.addEventListener("mouseenter", (e) => peekOn(el.dataset.peek, el.dataset.cap, e));
      el.addEventListener("mousemove", aim);
      el.addEventListener("mouseleave", peekOff);
    });
  }
  function bindSpots() {
    main().querySelectorAll(".spot[data-img]").forEach((li) => {
      const src = li.dataset.img;
      const cap = li.dataset.alt;
      if (hoverable) {
        li.addEventListener("mouseenter", (e) => peekOn(src, cap, e));
        li.addEventListener("mousemove", aim);
        li.addEventListener("mouseleave", peekOff);
        li.addEventListener("click", () => { peekOff(); openSingle(src, cap); });
      } else {
        li.addEventListener("click", () => li.classList.toggle("open"));
      }
      li.addEventListener("keydown", (e) => { if (e.key === "Enter") li.classList.toggle("open"); });
    });
  }

  /* —— 大图 —— */
  let lbList = [], lbIdx = 0;
  function bindGallery() {
    const figs = [...main().querySelectorAll(".gallery figure")];
    lbList = figs.map((f) => ({ src: f.querySelector("img").getAttribute("src"), cap: f.querySelector("img").alt }));
    figs.forEach((f, i) => f.addEventListener("click", () => openLb(i)));
  }
  function bindPostImages() {
    main().querySelectorAll(".post-body").forEach((pb) => {
      const figs = [...pb.querySelectorAll("figure")];
      const list = figs.map((f) => ({ src: f.querySelector("img").getAttribute("src"), cap: f.querySelector("img").alt }));
      figs.forEach((f, i) => (f.onclick = () => { lbList = list; openLb(i); }));
    });
  }
  function openSingle(src, cap) {
    const i = lbList.findIndex((x) => x.src === src);
    if (i >= 0) return openLb(i);
    lbList.push({ src, cap });
    openLb(lbList.length - 1);
  }
  function openLb(i) {
    lbIdx = (i + lbList.length) % lbList.length;
    $("lbImg").src = lbList[lbIdx].src;
    $("lbCap").textContent = `${lbList[lbIdx].cap || ""}　${lbIdx + 1} / ${lbList.length}`;
    $("lightbox").hidden = false;
  }
  const closeLb = () => ($("lightbox").hidden = true);
  $("lbClose").onclick = closeLb;
  $("lbPrev").onclick = (e) => { e.stopPropagation(); openLb(lbIdx - 1); };
  $("lbNext").onclick = (e) => { e.stopPropagation(); openLb(lbIdx + 1); };
  $("lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") closeLb(); });
  addEventListener("keydown", (e) => {
    if ($("lightbox").hidden) return;
    if (e.key === "Escape") closeLb();
    if (e.key === "ArrowLeft") openLb(lbIdx - 1);
    if (e.key === "ArrowRight") openLb(lbIdx + 1);
  });

  /* —— 目录高亮 —— */
  let tocLinks = [];
  function syncToc() {
    if (!tocLinks.length) return;
    const heads = [...main().querySelectorAll(".prose h3, .prose h4")];
    let cur = heads[0];
    heads.forEach((h) => { if (h.getBoundingClientRect().top < innerHeight * 0.33) cur = h; });
    tocLinks.forEach((l) => l.classList.toggle("on", cur && l.dataset.sec === cur.id));
  }
  addEventListener("scroll", syncToc, { passive: true });
  function bindToc() {
    tocLinks = [...main().querySelectorAll(".r-toc a")];
    tocLinks.forEach((l) => l.addEventListener("click", (e) => {
      e.preventDefault();
      document.getElementById(l.dataset.sec)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
    syncToc();
  }

  /* —— 预览开关 —— */
  /* —— 正式站的「开发中」占位 —— */
  const devStub = (title, note) => `<div class="dev-stub"><span class="kicker"><span class="stamp">WIP</span><span>正在开发</span></span><b>${esc(title)}</b><p>${esc(note)}</p></div>`;
  function renderDev(what) {
    main().innerHTML = `
      ${crumbs([["知识库", "#kb"], ["市场焚诀", "#kb/m/" + MARKET_KEYS[0]], [what]])}
      <header class="page-head"><span class="ghost" aria-hidden="true">${what === "审核" ? "REVIEW" : "SUBMIT"}</span><div class="kicker">${what === "审核" ? "Review" : "Submit"}</div><h1>${what}市场焚诀</h1></header>
      ${devStub(what === "审核" ? "审核入口" : "玩家投稿", what === "审核" ? "知识库的审核功能正在开发。图鉴投稿的审核请回砖皮百科首页的「上传」。" : "见闻投稿功能正在开发，开放后会在这里出现。想分享购买故事，先到 Q 群 765759268 找站长。")}`;
  }
  document.body.classList.toggle("site", SITE);
  const applyOpts = () => document.body.classList.toggle("editor", state.editor);
  $("optDrafts").onchange = (e) => { state.drafts = e.target.checked; route(); };
  $("optEditor").onchange = (e) => { state.editor = e.target.checked; applyOpts(); };

  /* —— 路由 ——
     #kb                 首页
     #kb/选皮焚诀         枪种总览
     #kb/w/K416/极品      枪种页
     #kb/m/砖皮市场见闻    市场焚诀子栏目
     #kb/p/12            玩家投稿
     #kb/投稿[/子栏目]     投稿表单
     #kb/审核             审核
     #a=词条路径           站长整理的词条            */
  function route() {
    peekOff();
    const h = decodeURIComponent(location.hash || "");
    if (!h || h === "#") { if (SITE) { location.hash = "#kb"; return; } return show("entry"); }
    show("kb");
    const parts = h.replace(/^#/, "").split("/");
    let active = "home", sub = null;
    if (h.startsWith("#a=")) {
      const a = byId[h.slice(3)];
      if (a) { active = a.section; sub = a.section === "选皮焚诀" ? a.weapon : (a.collection || a.tier); }
      renderArticle(h.slice(3));
    } else if (parts[1] === "w") {
      active = "选皮焚诀"; sub = parts[2];
      renderWeapon(parts[2], parts[3]);
    } else if (parts[1] === "选皮焚诀") {
      active = "选皮焚诀";
      renderSelection();
    } else if (parts[1] === "m" || parts[1] === "市场焚诀") {
      active = "市场焚诀"; sub = MARKET[parts[2]] ? parts[2] : MARKET_KEYS[0];
      renderMarket(sub);
    } else if (parts[1] === "c") {
      const rest = h.replace(/^#kb\/c\//, "");
      const c = COLLS.slice().sort((x, y) => y.id.length - x.id.length).find((x) => rest === x.id || rest.startsWith(x.id + "/"));
      active = "市场焚诀"; sub = c ? c.id : null;
      renderCollection(c ? c.id : "", c ? rest.slice(c.id.length + 1) : "");
    } else if (parts[1] === "links") {
      active = "外链";
      renderLinks();
    } else if (parts[1] === "p") {
      active = "市场焚诀";
      renderPost(parts[2]);
    } else if (parts[1] === "投稿") {
      active = "市场焚诀";
      if (SITE) renderDev("投稿"); else renderSubmit(parts[2]);
    } else if (parts[1] === "审核") {
      active = "审核";
      if (SITE) renderDev("审核"); else renderReview();
    } else {
      renderHome();
    }
    renderSide(active, sub);
    window.scrollTo(0, 0);
  }
  addEventListener("hashchange", route);
  applyOpts();
  route();
})();
