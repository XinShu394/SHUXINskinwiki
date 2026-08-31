(function () {
  function safeEncodeURI(url) {
    return encodeURI(url).replace(/\+/g, "%2B");
  }

  const qualityMap = { U: "优品", J: "极品" };
  const materialMap = {
    T: "透光", G: "贵金属", Q: "其他", L: "镭射", M: "漆面", Z: "木质",
    Y: "玉石", D: "钻石", C: "水晶", J: "结构光",
    LG: "镭射贵金属",
  };
  const colorMap = {
    "00": "单色", "01": "白色", "02": "红色", "03": "黄色", "04": "青色",
    "05": "紫色", "06": "棕色", "07": "黑色", "08": "灰色", "09": "橙色",
    "10": "绿色", "11": "蓝色", "12": "粉色",
  };

  const WEAPON_FILTER_CONFIG = {
    ASVAL: { materialOpts: ["贵金属", "玉石", "镭射", "漆面", "木质", "其他"], showColor: true },
    K416: { materialOpts: ["贵金属", "透光", "其他"], showColor: true },
    QBZ95: { materialOpts: ["贵金属", "其他"], showColor: true },
    腾龙: { materialOpts: ["贵金属", "镭射", "镭射贵金属", "其他"], showColor: true },
    AUG: { materialOpts: ["贵金属", "镭射", "其他"], showColor: true },
    M4A1: { materialOpts: [], showColor: false },
    M7: { materialOpts: ["贵金属", "透光", "镭射", "钻石", "镭射贵金属", "其他"], showColor: true },
    M250: { materialOpts: ["贵金属", "透光", "镭射", "钻石", "镭射贵金属", "其他"], showColor: true },
    MP7: { materialOpts: ["贵金属", "透光", "镭射", "水晶", "钻石", "镭射贵金属", "其他"], showColor: true },
    SCARH: { materialOpts: ["贵金属", "水晶", "其他"], showColor: true },
    Vector: { materialOpts: [], showColor: false },
    KC17: { materialOpts: ["结构光", "镭射贵金属", "贵金属", "镭射", "其他"], showColor: true },
    AKM: { materialOpts: ["星河光", "镭射贵金属", "贵金属", "大理石", "镭射大理石", "镭射", "其他"], showColor: true },
  };

  const COLOR_TABS = [
    { v: "白色", t: "白", c: "#e8ece8" },
    { v: "红色", t: "红", c: "#c45a5a" },
    { v: "黄色", t: "黄", c: "#d4b84a" },
    { v: "青色", t: "青", c: "#4ec4c0" },
    { v: "紫色", t: "紫", c: "#8a6ab8" },
    { v: "棕色", t: "棕", c: "#8a6240" },
    { v: "黑色", t: "黑", c: "#2a302c" },
    { v: "灰色", t: "灰", c: "#8a948e" },
    { v: "橙色", t: "橙", c: "#d47838" },
    { v: "绿色", t: "绿", c: "#4aaa6a" },
    { v: "蓝色", t: "蓝", c: "#4a7ec8" },
    { v: "粉色", t: "粉", c: "#d478a0" },
    { v: "炫彩", t: "炫彩", prism: true },
  ];

  const metaById = window.SKIN_META || {};
  const weaponCovers = window.WEAPON_COVERS || [];
  const skins = (window.SKIN_DATA || []).map((item) => enrich(item));
  const state = { query: "", nav: "", quality: "", material: "", color: "", sort: "default" };

  let _skinStats = null;
  let _skinNotes = null;
  const NO_NOTES_TEXT = "";
  const LS_LIKED_KEY = "skin_liked_ids";

  const API_BASE =
    location.hostname === "localhost" || location.hostname === "127.0.0.1"
      ? "http://localhost:5200/api"
      : "/api";

  const views = {
    entry: document.getElementById("view-entry"),
    pick: document.getElementById("view-pick"),
    gallery: document.getElementById("view-gallery"),
    detail: document.getElementById("view-detail"),
    hub: document.getElementById("view-hub"),
    pending: document.getElementById("view-pending"),
  };

  const lightbox = document.getElementById("lightbox");
  const lightboxImage = document.getElementById("lightboxImage");
  const lightboxClose = document.getElementById("lightboxClose");

  function $(id) {
    return document.getElementById(id);
  }

  function formatPendingTime(v) {
    if (v == null || v === "") return "";
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return String(v);
    const d = new Date(n > 1e12 ? n : n * 1000);
    if (Number.isNaN(d.getTime())) return String(v);
    const pad = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function getLikedSet() {
    try {
      return new Set(JSON.parse(localStorage.getItem(LS_LIKED_KEY) || "[]"));
    } catch {
      return new Set();
    }
  }
  function saveLikedSet(set) {
    try {
      localStorage.setItem(LS_LIKED_KEY, JSON.stringify([...set]));
    } catch {}
  }
  function isLiked(skinId) {
    return getLikedSet().has(skinId);
  }

  async function ensureSkinStats() {
    if (_skinStats !== null) return;
    try {
      const res = await fetch(API_BASE + "/skin-stats");
      _skinStats = await res.json();
    } catch {
      _skinStats = {};
    }
  }
  async function ensureSkinNotes() {
    if (_skinNotes !== null) return;
    try {
      const res = await fetch(API_BASE + "/skin-notes");
      if (!res.ok) throw new Error("加载失败");
      _skinNotes = await res.json();
    } catch {
      _skinNotes = {};
    }
  }
  function getSkinNotes(skinId) {
    return (_skinNotes && _skinNotes[skinId]) || null;
  }
  function formatNotesText(noteInfo) {
    if (!noteInfo || !noteInfo.notes) return NO_NOTES_TEXT;
    const contributor = noteInfo.contributor ? ` —— ${noteInfo.contributor}` : "";
    return `“${noteInfo.notes}”${contributor}`;
  }
  function getSkinLikes(skinId) {
    return (_skinStats && _skinStats[skinId] && _skinStats[skinId].likes) || 0;
  }
  function getSkinComments(skinId) {
    return (_skinStats && _skinStats[skinId] && _skinStats[skinId].comments) || 0;
  }
  function getSkinHotScore(skinId) {
    return getSkinLikes(skinId) * 1 + getSkinComments(skinId) * 3;
  }

  async function toggleSkinLike(skinId, btnEl) {
    const liked = isLiked(skinId);
    const action = liked ? "down" : "up";
    try {
      const res = await fetch(API_BASE + "/skins/" + encodeURIComponent(skinId) + "/like", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      const set = getLikedSet();
      if (liked) set.delete(skinId);
      else set.add(skinId);
      saveLikedSet(set);
      if (_skinStats) {
        if (!_skinStats[skinId]) _skinStats[skinId] = { likes: 0, comments: 0 };
        _skinStats[skinId].likes = data.count;
      }
      updateLikeBtnUI(btnEl, skinId, data.count);
    } catch {}
  }
  function updateLikeBtnUI(btn, skinId, count) {
    if (!btn) return;
    const liked = isLiked(skinId);
    btn.classList.toggle("liked", liked);
    btn.setAttribute("aria-pressed", liked ? "true" : "false");
    const countEl = btn.querySelector(".like-count");
    if (countEl) countEl.textContent = count > 0 ? count : "";
  }

  function enrich(item) {
    const code = item.normalizedCode || "";
    const qualityCode = code[0] || "";
    const colorCode = /\d{4}$/.test(code) ? code.slice(-4) : "";
    const materialCode = colorCode ? code.slice(1, -4) : code.slice(1);
    const c1 = colorCode.slice(0, 2);
    const c2 = colorCode.slice(2, 4);

    let colorLabel = colorCode ? "未知配色" : "";
    if (!colorCode) colorLabel = "";
    else if (colorCode === "1111") colorLabel = "炫彩";
    else {
      const color1 = colorMap[c1] || c1;
      const color2 = colorMap[c2] || c2;
      colorLabel = c2 === "00" ? color1 : `${color1} + ${color2}`;
    }
    const meta = metaById[item.id] || {};
    return {
      ...item,
      name:
        (meta.name && String(meta.name).trim()) ||
        (item.template && String(item.template).trim()) ||
        "未命名",
      rating: meta.rating || "",
      comment: meta.comment || "",
      qualityLabel: normalizeLabel(item.qualityLabel, qualityMap[qualityCode] || "未标注"),
      materialLabel: normalizeLabel(item.materialLabel, decodeMaterialLabel(materialCode)),
      colorLabel: normalizeLabel(item.colorLabel, colorLabel),
    };
  }
  function decodeMaterialLabel(materialCode) {
    if (!materialCode) return "";
    const parts = [];
    let i = 0;
    while (i < materialCode.length) {
      if (i + 1 < materialCode.length && materialMap[materialCode.slice(i, i + 2)]) {
        parts.push(materialMap[materialCode.slice(i, i + 2)]);
        i += 2;
      } else {
        parts.push(materialMap[materialCode[i]] || materialCode[i]);
        i += 1;
      }
    }
    return parts.slice(0, 2).join(" + ");
  }
  function normalizeLabel(rawLabel, fallback) {
    if (!rawLabel || rawLabel === "NA") return fallback;
    if (rawLabel === "未知配色" && fallback === "炫彩") return "炫彩";
    return qualityMap[rawLabel] || materialMap[rawLabel] || rawLabel;
  }
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function enabledCovers() {
    return weaponCovers.filter((c) => c.enabled);
  }

  function showView(name) {
    Object.keys(views).forEach((k) => {
      if (views[k]) views[k].classList.toggle("active", k === name);
    });
    window.scrollTo(0, 0);
  }

  function goHome() {
    const stage = $("entryStage");
    if (stage) stage.classList.remove("is-leaving");
    document.querySelectorAll(".focus").forEach((el) => el.classList.remove("is-chosen"));
    if (location.hash) location.hash = "";
    else showView("entry");
  }

  function leaveEntry(id, done) {
    $("entryStage").classList.add("is-leaving");
    $(id).classList.add("is-chosen");
    setTimeout(done, 480);
  }

  function chipHtml(value, text, selected, extra) {
    return `<button type="button" class="chip${selected ? " on" : ""}" data-v="${escapeHtml(value)}">${extra || ""}${escapeHtml(text)}</button>`;
  }
  function qualityTag(label) {
    if (!label || label === "未标注") return "";
    const cls = label === "极品" ? "tag tag-ji" : "tag";
    return `<span class="${cls}">${escapeHtml(label)}</span>`;
  }
  function facetTag(label) {
    if (!label || label === "NA" || label === "未标注" || label === "未知配色") return "";
    return `<span class="tag-meta">${escapeHtml(label)}</span>`;
  }
  function skinTagRow(s) {
    return `<div class="skin-tags">${qualityTag(s.qualityLabel)}${facetTag(s.materialLabel)}${facetTag(s.colorLabel)}</div>`;
  }
  function labelHas(label, want) {
    if (!want) return true;
    return String(label || "")
      .split(/\s*\+\s*/)
      .map((x) => x.trim())
      .includes(want);
  }

  function renderFilterTabs() {
    const cfg = WEAPON_FILTER_CONFIG[state.nav] || { materialOpts: [], showColor: true };
    $("qualityTabs").querySelectorAll(".chip").forEach((b) => {
      b.classList.toggle("on", (b.dataset.v || "") === state.quality);
    });
    const matRow = $("materialRow");
    if (cfg.materialOpts.length) {
      if (state.material && !cfg.materialOpts.includes(state.material)) state.material = "";
      matRow.hidden = false;
      $("materialTabs").innerHTML =
        chipHtml("", "全部", !state.material) +
        cfg.materialOpts.map((m) => chipHtml(m, m, state.material === m)).join("");
    } else {
      state.material = "";
      matRow.hidden = true;
    }
    const colorRow = $("colorRow");
    if (cfg.showColor) {
      colorRow.hidden = false;
      $("colorTabs").innerHTML =
        chipHtml("", "全部", !state.color) +
        COLOR_TABS.map((c) => {
          const sw = c.prism
            ? `<span class="swatch prism"></span>`
            : `<span class="swatch" style="--sw:${c.c}"></span>`;
          return chipHtml(c.v, c.t, state.color === c.v, sw);
        }).join("");
    } else {
      state.color = "";
      colorRow.hidden = true;
    }
  }

  function renderPick() {
    const cards = enabledCovers();
    $("coverGrid").innerHTML = cards
      .map(
        (c) => `<button class="cover" type="button" data-w="${escapeHtml(c.weapon)}">
          <img src="${escapeHtml(safeEncodeURI(c.src))}" alt="${escapeHtml(c.weapon)}" />
          <div class="name">${escapeHtml(c.weapon)}</div>
        </button>`
      )
      .join("");
    $("coverGrid").querySelectorAll(".cover").forEach((btn) => {
      btn.onclick = () => {
        location.hash = "#w=" + encodeURIComponent(btn.dataset.w);
      };
    });
    showView("pick");
  }

  function renderGallery() {
    $("railList").innerHTML = enabledCovers()
      .map(
        (c) =>
          `<button type="button" data-w="${escapeHtml(c.weapon)}" class="${c.weapon === state.nav ? "on" : ""}">${escapeHtml(c.weapon)}</button>`
      )
      .join("");
    $("railList").querySelectorAll("button").forEach((b) => {
      b.onclick = () => {
        location.hash = "#w=" + encodeURIComponent(b.dataset.w);
      };
    });
    $("gunTitle").textContent = state.nav;
    renderFilterTabs();

    let list = skins.filter((s) => s.weapon === state.nav);
    if (state.quality) list = list.filter((s) => s.qualityLabel === state.quality);
    if (state.material) list = list.filter((s) => labelHas(s.materialLabel, state.material));
    if (state.color) list = list.filter((s) => labelHas(s.colorLabel, state.color));
    if (state.query) {
      const q = state.query.toLowerCase();
      list = list.filter((s) => {
        const hay = [s.name, s.id, s.normalizedCode, s.colorLabel, s.materialLabel, s.qualityLabel]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    if (state.sort === "hot") list = list.slice().sort((a, b) => getSkinHotScore(b.id) - getSkinHotScore(a.id));

    $("skinGrid").innerHTML = list
      .map((s) => {
        const noteInfo = getSkinNotes(s.id);
        const note = noteInfo && noteInfo.notes ? `“${noteInfo.notes}”` : NO_NOTES_TEXT;
        const likeCount = getSkinLikes(s.id);
        const liked = isLiked(s.id);
        return `<article class="skin" data-id="${escapeHtml(s.id)}">
          <img src="${escapeHtml(safeEncodeURI(s.imageA))}" alt="${escapeHtml(s.name)}" />
          <h3>${escapeHtml(s.name)}</h3>
          ${note ? `<p class="skin-notes">${escapeHtml(note)}</p>` : ""}
          ${skinTagRow(s)}
          <button class="card-like-btn${liked ? " liked" : ""}" type="button" data-skin-id="${escapeHtml(s.id)}" aria-pressed="${liked ? "true" : "false"}" title="点赞">
            <span class="like-icon">♥</span><span class="like-count">${likeCount > 0 ? likeCount : ""}</span>
          </button>
        </article>`;
      })
      .join("");

    $("skinGrid").querySelectorAll(".skin").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.closest(".card-like-btn")) return;
        location.hash = "#skin=" + encodeURIComponent(card.dataset.id);
      });
    });
    $("skinGrid").querySelectorAll(".card-like-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleSkinLike(btn.dataset.skinId, btn);
      });
    });

    if (_skinNotes === null) {
      ensureSkinNotes().then(() => {
        if ((location.hash || "").startsWith("#w=")) renderGallery();
      });
    }
    showView("gallery");
  }

  function extractFolderCode(imageUrl) {
    if (!imageUrl) return "";
    const parts = String(imageUrl).split("/");
    const raw = parts.length >= 3 ? parts[parts.length - 2] : "";
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  function loadSupplement(s) {
    const content = $("suppGalleryContent");
    const btn = $("suppUploadBtn");
    if (!content) return;
    if (btn) {
      btn.onclick = function () {
        if (window.Supplement) {
          window.Supplement.open(s.id, s.weapon, extractFolderCode(s.imageA), s.name);
        }
      };
    }
    content.innerHTML = '<div class="supp-loading">加载中…</div>';
    fetch(API_BASE + "/supplements?skinId=" + encodeURIComponent(s.id))
      .then((r) => r.json())
      .then((data) => {
        const results = (data && data.results) || [];
        if (!results.length) {
          content.innerHTML = '<div class="supp-empty">暂无补充图<br>点击右上角 ＋ 上传</div>';
          return;
        }
        renderSuppGallery(results, content);
      })
      .catch(() => {
        content.innerHTML = '<div class="supp-empty">加载失败，请刷新重试</div>';
      });
  }

  function renderSuppGallery(items, container) {
    const n = items.length;
    let h = '<div class="supp-grid' + (n > 1 ? " supp-carousel" : "") + '">';
    items.forEach((item) => {
      h += '<div class="supp-item" data-raw-url="' + escapeHtml(item.url) + '">';
      h += '<img class="supp-img" src="' + escapeHtml(safeEncodeURI(item.url)) + '" alt="补充图" loading="lazy" />';
      if (item.contributor) {
        h += '<div class="supp-contrib">@' + escapeHtml(item.contributor) + "</div>";
      }
      h += "</div>";
    });
    h += "</div>";
    if (n > 1) {
      h += '<div class="supp-pg-info"><span class="supp-pg-cur">1</span>/' + n + "</div>";
    }
    container.innerHTML = h;
    container.querySelectorAll(".supp-item").forEach((card) => {
      card.addEventListener("click", () => openLightbox(card.dataset.rawUrl));
    });
    const rail = container.querySelector(".supp-carousel");
    const cur = container.querySelector(".supp-pg-cur");
    if (rail && cur) {
      rail.addEventListener(
        "scroll",
        () => {
          const w = rail.clientWidth || 1;
          const i = Math.round(rail.scrollLeft / w) + 1;
          cur.textContent = String(Math.min(n, Math.max(1, i)));
        },
        { passive: true }
      );
    }
  }

  function bindPreview(imgId, src) {
    const el = $(imgId);
    if (!el) return;
    el.onclick = () => openLightbox(src);
  }
  function openLightbox(src) {
    lightboxImage.src = safeEncodeURI(src);
    lightbox.classList.remove("hidden");
  }
  function closeLightbox() {
    lightbox.classList.add("hidden");
    lightboxImage.src = "";
  }

  function renderDetail(s) {
    state.nav = s.weapon;
    $("detailWeapon").textContent = s.weapon;
    $("detailName").textContent = s.name;
    $("detailId").textContent = formatNotesText(getSkinNotes(s.id));
    $("detailTags").innerHTML = skinTagRow(s);
    $("imgB").src = safeEncodeURI(s.imageB || s.imageA);
    $("imgC").src = safeEncodeURI(s.imageC || s.imageA);
    $("imgD").src = safeEncodeURI(s.imageD || s.imageA);
    bindPreview("imgB", s.imageB || s.imageA);
    bindPreview("imgC", s.imageC || s.imageA);
    bindPreview("imgD", s.imageD || s.imageA);

    $("metaList").innerHTML = `
      <li><strong>武器：</strong>${escapeHtml(s.weapon)}</li>
      <li><strong>品质：</strong>${escapeHtml(s.qualityLabel)}</li>
      ${s.materialLabel ? `<li><strong>材质：</strong>${escapeHtml(s.materialLabel)}</li>` : ""}
      ${s.colorLabel ? `<li><strong>配色：</strong>${escapeHtml(s.colorLabel)}</li>` : ""}
      ${s.rating ? `<li><strong>评分：</strong>${escapeHtml(s.rating)}</li>` : ""}
      ${s.comment ? `<li><strong>简评：</strong>${escapeHtml(s.comment)}</li>` : ""}
    `;

    const detailLikeBtn = $("detailLikeBtn");
    if (detailLikeBtn) {
      const likeCount = getSkinLikes(s.id);
      updateLikeBtnUI(detailLikeBtn, s.id, likeCount);
      detailLikeBtn.dataset.skinId = s.id;
      detailLikeBtn.onclick = () => toggleSkinLike(s.id, detailLikeBtn);
      if (_skinStats === null) {
        ensureSkinStats().then(() => updateLikeBtnUI(detailLikeBtn, s.id, getSkinLikes(s.id)));
      }
    }

    if (window.Comments) window.Comments.load(s.id);
    loadSupplement(s);

    if (_skinNotes === null) {
      ensureSkinNotes().then(() => {
        const el = $("detailId");
        if (el) el.textContent = formatNotesText(getSkinNotes(s.id));
      });
    }
    showView("detail");
  }

  async function renderPending() {
    const list = $("pendList");
    list.innerHTML = '<p class="lede">加载中…</p>';
    showView("pending");
    try {
      const res = await fetch(API_BASE + "/submissions?status=pending_review");
      if (res.status === 401 || res.status === 403) {
        list.innerHTML =
          '<p class="lede">公开待审接口尚未开放。审核员请从「审批入口」用密钥查看同一批投稿。</p>';
        return;
      }
      if (!res.ok) throw new Error("bad");
      const data = await res.json();
      const rows = (data && data.results) || [];
      if (!rows.length) {
        list.innerHTML = '<p class="lede">当前没有待审投稿。</p>';
        return;
      }
      list.innerHTML = rows
        .map((p) => {
          const isSupp = p.submissionType === "supplement" || p.type === "supplement" || p.supplementSkinId;
          const title = isSupp
            ? `玩家共享图 · 为 ${escapeHtml(p.supplementSkinId || "")} 补充`
            : `${escapeHtml(p.weapon || "")} · ${escapeHtml(p.skinName || "")}`;
          const when = formatPendingTime(p.createdAt);
          return `<article class="pend">
            <div>
              <h3 class="display display-md" style="font-size:28px;margin:8px 0 12px">${title}</h3>
              ${p.notes ? `<p class="notes">“${escapeHtml(p.notes)}”</p>` : ""}
              <p class="meta">投稿人：${escapeHtml(p.contributor || "")}${when ? "　" + escapeHtml(when) : ""}</p>
            </div>
          </article>`;
        })
        .join("");
    } catch {
      list.innerHTML = '<p class="lede">暂时无法读取待审列表。</p>';
    }
  }

  function route() {
    const hash = location.hash || "";
    if (hash.startsWith("#skin=")) {
      const id = decodeURIComponent(hash.replace("#skin=", ""));
      const skin = skins.find((s) => s.id === id);
      if (!skin) {
        location.hash = "#gallery";
        return;
      }
      renderDetail(skin);
      return;
    }
    if (hash.startsWith("#w=")) {
      const w = decodeURIComponent(hash.replace("#w=", ""));
      if (w !== state.nav) {
        state.quality = "";
        state.material = "";
        state.color = "";
        state.query = "";
        if ($("qInput")) $("qInput").value = "";
      }
      state.nav = w;
      renderGallery();
      return;
    }
    if (hash === "#gallery") {
      renderPick();
      return;
    }
    if (hash === "#upload") {
      showView("hub");
      return;
    }
    if (hash === "#pending") {
      renderPending();
      return;
    }
    showView("entry");
  }

  $("focusGallery").onclick = () => {
    leaveEntry("focusGallery", () => {
      location.hash = "#gallery";
    });
  };
  $("focusUpload").onclick = () => {
    leaveEntry("focusUpload", () => {
      location.hash = "#upload";
    });
  };
  document.querySelectorAll("[data-home]").forEach((el) => {
    el.onclick = goHome;
  });
  $("backBtn").onclick = () => {
    if (state.nav) location.hash = "#w=" + encodeURIComponent(state.nav);
    else location.hash = "#gallery";
  };

  function onChipRow(id, apply) {
    $(id).addEventListener("click", (e) => {
      const btn = e.target.closest(".chip");
      if (!btn || !$(id).contains(btn)) return;
      apply(btn.dataset.v || "");
      renderGallery();
    });
  }
  onChipRow("qualityTabs", (v) => {
    state.quality = v;
  });
  onChipRow("materialTabs", (v) => {
    state.material = v;
  });
  onChipRow("colorTabs", (v) => {
    state.color = v;
  });
  $("qInput").oninput = (e) => {
    state.query = e.target.value.trim();
    renderGallery();
  };
  $("sortDefault").onclick = () => {
    state.sort = "default";
    $("sortDefault").classList.add("on");
    $("sortHot").classList.remove("on");
    renderGallery();
  };
  $("sortHot").onclick = async () => {
    state.sort = "hot";
    $("sortHot").classList.add("on");
    $("sortDefault").classList.remove("on");
    await ensureSkinStats();
    renderGallery();
  };
  $("hubPending").onclick = () => {
    location.hash = "#pending";
  };

  lightboxClose.addEventListener("click", closeLightbox);
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLightbox();
  });

  window.addEventListener("hashchange", route);
  route();
  ensureSkinNotes();
  ensureSkinStats();

  const DEV_API = "http://localhost:8765";
  const devTools = $("devTools");
  const validateBtn = $("validateBtn");
  const validateWeaponSelect = $("validateWeaponSelect");
  const validateNormalize = $("validateNormalize");
  const validatePanel = $("validatePanel");
  const validatePanelTitle = $("validatePanelTitle");
  const validatePanelBody = $("validatePanelBody");
  const validatePanelClose = $("validatePanelClose");

  async function checkDevServer() {
    if (!devTools) return;
    try {
      const res = await fetch(`${DEV_API}/api/health`, { signal: AbortSignal.timeout(800) });
      if (res.ok) {
        devTools.classList.remove("hidden");
        const weapons = [...new Set(weaponCovers.map((c) => c.weapon))].sort();
        weapons.forEach((w) => {
          const opt = document.createElement("option");
          opt.value = w;
          opt.textContent = w;
          validateWeaponSelect.appendChild(opt);
        });
      }
    } catch {}
  }
  function openValidatePanel() {
    validatePanel.classList.remove("hidden");
  }
  function closeValidatePanel() {
    validatePanel.classList.add("hidden");
  }
  function renderValidateResult(data) {
    if (data.ok) {
      validatePanelTitle.textContent = "校验通过 ✓";
      validatePanelTitle.className = "validate-title-ok";
    } else {
      validatePanelTitle.textContent = "校验失败 ✗";
      validatePanelTitle.className = "validate-title-err";
    }
    const lines = (data.stdout || "").split("\n").map((l) => l.trim()).filter(Boolean);
    const warnings = data.warnings || [];
    validatePanelBody.innerHTML = `
      <div class="validate-stdout">
        ${lines.map((l) => `<div class="validate-line">${escapeHtml(l)}</div>`).join("")}
      </div>
      ${
        warnings.length
          ? `<div class="validate-warnings">
              <div class="validate-warn-head">⚠ 告警（${warnings.length} 条）</div>
              ${warnings.map((w) => `<div class="validate-warn-line">${escapeHtml(w)}</div>`).join("")}
            </div>`
          : ""
      }
      ${
        !data.ok && data.stderr
          ? `<div class="validate-errors">
              <div class="validate-error-head">错误详情</div>
              <pre class="validate-pre">${escapeHtml(data.stderr)}</pre>
            </div>`
          : ""
      }
      <div class="validate-reload-hint">
        ${data.ok ? "数据已更新，<button class='validate-reload-btn' onclick='location.reload()'>刷新页面</button> 生效" : "未写入 site，无需刷新"}
      </div>
    `;
  }
  if (validateBtn) {
    validateBtn.addEventListener("click", async () => {
      openValidatePanel();
      validatePanelTitle.textContent = "校验中…";
      validatePanelTitle.className = "";
      validatePanelBody.innerHTML = '<div class="validate-spinner"></div>';
      validateBtn.disabled = true;
      try {
        const res = await fetch(`${DEV_API}/api/validate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            weapon: validateWeaponSelect.value,
            normalize: validateNormalize.checked,
          }),
        });
        renderValidateResult(await res.json());
      } catch (err) {
        validatePanelTitle.textContent = "请求失败";
        validatePanelTitle.className = "validate-title-err";
        validatePanelBody.innerHTML = `<div class="validate-line">${escapeHtml(String(err))}</div>`;
      } finally {
        validateBtn.disabled = false;
      }
    });
  }
  if (validatePanelClose) validatePanelClose.addEventListener("click", closeValidatePanel);
  if (validatePanel) {
    validatePanel.addEventListener("click", (e) => {
      if (e.target === validatePanel) closeValidatePanel();
    });
  }
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && validatePanel && !validatePanel.classList.contains("hidden")) {
      closeValidatePanel();
    }
  });
  checkDevServer();
})();
