(function () {
  const $ = (id) => document.getElementById(id);
  const views = {
    entry: $("view-entry"),
    pick: $("view-pick"),
    gallery: $("view-gallery"),
    detail: $("view-detail"),
    hub: $("view-hub"),
    pending: $("view-pending"),
    submit: $("view-submit"),
    review: $("view-review"),
  };

  let weapon = "";
  let quality = "";
  let material = "";
  let color = "";
  let query = "";
  let sort = "default";
  let skinStats = null;
  let reviewAuthed = false;
  let submitStep = 1;
  let submitWeapon = "";

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

  const API_BASE =
    location.hostname === "localhost" || location.hostname === "127.0.0.1"
      ? "http://localhost:5200/api"
      : "/api";

  function covers() {
    return (window.WEAPON_COVERS || []).filter((c) => c.enabled);
  }
  function skins() {
    return window.SKIN_DATA || [];
  }
  function metaName(id, fallback) {
    const m = (window.SKIN_META || {})[id];
    return (m && m.name) || fallback || id;
  }
  async function ensureSkinStats() {
    if (skinStats !== null) return;
    try {
      const res = await fetch(API_BASE + "/skin-stats");
      skinStats = await res.json();
    } catch {
      skinStats = {};
    }
  }
  function hotScore(id) {
    const s = skinStats && skinStats[id];
    return ((s && s.likes) || 0) + ((s && s.comments) || 0) * 3;
  }

  function show(name) {
    Object.keys(views).forEach((k) => views[k].classList.toggle("active", k === name));
    window.scrollTo(0, 0);
  }
  function home() {
    $("entryStage").classList.remove("is-leaving");
    document.querySelectorAll(".focus").forEach((el) => el.classList.remove("is-chosen"));
    show("entry");
  }

  function goGallery(fromEntry) {
    const run = () => {
      renderPick();
      show("pick");
    };
    if (!fromEntry) return run();
    leaveEntry("focusGallery", run);
  }
  function goHub(fromEntry) {
    const run = () => show("hub");
    if (!fromEntry) return run();
    leaveEntry("focusUpload", run);
  }
  function leaveEntry(id, done) {
    $("entryStage").classList.add("is-leaving");
    $(id).classList.add("is-chosen");
    setTimeout(done, 480);
  }

  function renderPick() {
    $("coverGrid").innerHTML = covers()
      .map(
        (c) =>
          `<button class="cover" data-w="${esc(c.weapon)}">
            <img src="${esc(c.src)}" alt="${esc(c.title)}" />
            <div class="name">${esc(c.weapon)}</div>
            <div class="sub meta">${esc(c.title)}</div>
          </button>`
      )
      .join("");
    $("coverGrid").querySelectorAll(".cover").forEach((btn) => {
      btn.onclick = () => openWeapon(btn.dataset.w);
    });
  }

  function openWeapon(w) {
    weapon = w;
    quality = "";
    material = "";
    color = "";
    query = "";
    $("qInput").value = "";
    renderGallery();
    show("gallery");
  }

  function qualityTag(label) {
    if (!label) return "";
    const cls = label === "极品" ? "tag tag-ji" : "tag";
    return `<span class="${cls}">${esc(label)}</span>`;
  }

  function facetTag(label) {
    if (!label || label === "NA" || label === "未标注" || label === "未知配色") return "";
    return `<span class="tag-meta">${esc(label)}</span>`;
  }

  function skinTagRow(s) {
    return `<div class="skin-tags">${qualityTag(s.qualityLabel)}${facetTag(s.materialLabel)}${facetTag(s.colorLabel)}</div>`;
  }

  function chipHtml(value, text, selected, extra) {
    return `<button type="button" class="chip${selected ? " on" : ""}" data-v="${esc(value)}">${extra || ""}${esc(text)}</button>`;
  }

  function renderFilterTabs() {
    const cfg = WEAPON_FILTER_CONFIG[weapon] || { materialOpts: [], showColor: true };
    $("qualityTabs").querySelectorAll(".chip").forEach((b) => {
      b.classList.toggle("on", (b.dataset.v || "") === quality);
    });

    const matRow = $("materialRow");
    if (cfg.materialOpts.length) {
      if (material && !cfg.materialOpts.includes(material)) material = "";
      matRow.hidden = false;
      $("materialTabs").innerHTML =
        chipHtml("", "全部", !material) +
        cfg.materialOpts.map((m) => chipHtml(m, m, material === m)).join("");
    } else {
      material = "";
      matRow.hidden = true;
    }

    const colorRow = $("colorRow");
    if (cfg.showColor) {
      colorRow.hidden = false;
      $("colorTabs").innerHTML =
        chipHtml("", "全部", !color) +
        COLOR_TABS.map((c) => {
          const sw = c.prism
            ? `<span class="swatch prism"></span>`
            : `<span class="swatch" style="--sw:${c.c}"></span>`;
          return chipHtml(c.v, c.t, color === c.v, sw);
        }).join("");
    } else {
      color = "";
      colorRow.hidden = true;
    }
  }

  function labelHas(label, want) {
    if (!want) return true;
    return String(label || "")
      .split(/\s*\+\s*/)
      .map((x) => x.trim())
      .includes(want);
  }

  function renderGallery() {
    $("railList").innerHTML = covers()
      .map(
        (c) =>
          `<button data-w="${esc(c.weapon)}" class="${c.weapon === weapon ? "on" : ""}">${esc(c.weapon)}</button>`
      )
      .join("");
    $("railList").querySelectorAll("button").forEach((b) => {
      b.onclick = () => openWeapon(b.dataset.w);
    });
    $("gunTitle").textContent = weapon;

    renderFilterTabs();

    let list = skins().filter((s) => s.weapon === weapon);
    if (quality) list = list.filter((s) => s.qualityLabel === quality);
    if (material) list = list.filter((s) => labelHas(s.materialLabel, material));
    if (color) list = list.filter((s) => labelHas(s.colorLabel, color));
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((s) => {
        const hay = [metaName(s.id, s.folderCode), s.id, s.colorLabel, s.materialLabel, s.qualityLabel]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    if (sort === "hot") list = list.slice().sort((a, b) => hotScore(b.id) - hotScore(a.id));

    $("skinGrid").innerHTML = list
      .map((s) => {
        const name = metaName(s.id, s.folderCode);
        return `<button class="skin" data-id="${esc(s.id)}">
          <img src="${esc(s.imageA)}" alt="${esc(name)}" />
          <h3>${esc(name)}</h3>
          ${skinTagRow(s)}
        </button>`;
      })
      .join("");
    $("skinGrid").querySelectorAll(".skin").forEach((btn) => {
      btn.onclick = () => openDetail(btn.dataset.id);
    });
  }

  function openDetail(id) {
    const s = skins().find((x) => x.id === id);
    if (!s) return;
    const name = metaName(s.id, s.folderCode);
    $("detailPage").innerHTML = `
      <div class="detail-layout">
        <div class="detail-imgs">
          <img src="${esc(s.imageB || s.imageA)}" alt="市场详情" />
          <div class="detail-sub">
            <img src="${esc(s.imageC || s.imageA)}" alt="室内" />
            <img src="${esc(s.imageD || s.imageA)}" alt="室外" />
          </div>
        </div>
        <div>
          <div class="kicker">${esc(s.weapon)}</div>
          <h2 class="display display-md">${esc(name)}</h2>
          ${skinTagRow(s)}
          <p class="detail-meta">${esc(s.id)}</p>
        </div>
      </div>`;
    show("detail");
  }

  function pendingItems() {
    const sample = skins().filter((s) => s.imageA).slice(0, 3);
    const extra = skins().find((s) => s.weapon === "K416") || sample[0];
    return [
      sample[0] && {
        type: "new_skin",
        weapon: sample[0].weapon,
        skinName: metaName(sample[0].id, sample[0].folderCode),
        quality: sample[0].qualityLabel,
        material: sample[0].materialLabel,
        color: sample[0].colorLabel,
        notes: "构图按推荐图来的，室内外都拍了。",
        contributor: "砖皮共建",
        createdAt: "2026-08-30 21:14",
        folder: sample[0].folderCode,
        images: [
          ["A", sample[0].imageA],
          ["B", sample[0].imageB],
          ["C", sample[0].imageC],
          ["D", sample[0].imageD],
        ],
      },
      extra && {
        type: "new_skin",
        weapon: extra.weapon,
        skinName: metaName(extra.id, extra.folderCode),
        quality: extra.qualityLabel,
        material: extra.materialLabel,
        color: extra.colorLabel,
        notes: "",
        contributor: "匿名",
        createdAt: "2026-08-29 11:02",
        folder: extra.normalizedCode || extra.folderCode,
        images: [
          ["A", extra.imageA],
          ["B", extra.imageB],
          ["C", extra.imageC],
          ["D", extra.imageD],
        ],
      },
      sample[2] && {
        type: "supplement",
        weapon: sample[2].weapon,
        skinName: metaName(sample[2].id, sample[2].folderCode),
        supplementSkinId: sample[2].id,
        notes: "补充一张室外持枪。",
        contributor: "路过",
        createdAt: "2026-08-28 19:40",
        images: [["共享图", sample[2].imageC || sample[2].imageA]],
      },
    ].filter(Boolean);
  }

  function renderPending(targetId, withActions) {
    const title = $("pendTitle");
    const kicker = $("pendKicker");
    if (title && targetId === "pendList") {
      title.textContent = withActions ? "待审投稿" : "待审进度";
      kicker.textContent = withActions ? "Review" : "Queue";
    }
    $(targetId).innerHTML = pendingItems()
      .map((p) => {
        const thumbs = p.images
          .filter((x) => x[1])
          .map(
            ([lab, src]) =>
              `<figure><img src="${esc(src)}" alt="${esc(lab)}" /><figcaption>${esc(lab)}</figcaption></figure>`
          )
          .join("");
        const title =
          p.type === "supplement"
            ? `<span class="tag">玩家共享图</span> 为 ${esc(p.supplementSkinId)} 补充`
            : `${esc(p.weapon)} · ${esc(p.skinName)}`;
        const tags =
          p.type === "supplement"
            ? ""
            : `${p.quality ? qualityTag(p.quality) : ""}${[p.material, p.color].filter(Boolean).map((t) => `<span class="meta"> ${esc(t)}</span>`).join("")}`;
        const folder = withActions && p.type !== "supplement"
          ? `<label class="folder meta">目录名<input value="${esc(p.folder || "")}" /></label>`
          : "";
        const actions = withActions
          ? `<div class="actions"><button class="text-btn go">通过发布</button><button class="text-btn no">拒绝</button></div>`
          : "";
        return `<article class="pend">
          <div class="thumbs">${thumbs}</div>
          <div>
            <div class="kicker">${esc(p.weapon)}</div>
            <h3 class="display display-md" style="font-size:28px;margin:8px 0 12px">${title}</h3>
            <div>${tags}</div>
            ${p.notes ? `<p class="notes">“${esc(p.notes)}”</p>` : ""}
            <p class="meta">投稿人：${esc(p.contributor)}　${esc(p.createdAt)}</p>
            ${folder}${actions}
          </div>
        </article>`;
      })
      .join("");
  }

  function renderSubmit() {
    const steps = ["构图", "筛选", "查重", "上传"];
    const stepHtml = steps
      .map((n, i) => `<span class="sp-step${i + 1 === submitStep ? " on" : ""}">${i + 1} ${n}</span>`)
      .join("<span class=\"sp-step-sep\">›</span>");
    let body = "";
    if (submitStep === 1) {
      body = `<div class="sp-step1">
        <div class="sp-section">
          <div class="sp-label">推荐构图</div>
          <img class="sp-guide-img" src="../../site/guide/投稿推荐图.png" alt="投稿推荐图" />
          <p class="sp-hint">按现站引导：市场缩略 / 详情 / 室内 / 室外。</p>
        </div>
        <div class="sp-section">
          <div class="sp-label">材质确认</div>
          <img class="sp-guide-img" src="../../site/guide/材质确认图.png" alt="材质确认图" />
        </div>
      </div>`;
    } else if (submitStep === 2) {
      body = `<div class="sp-section">
        <div class="sp-label">选择武器</div>
        <div class="sp-chips" id="wChips"></div>
      </div>
      <p class="sp-hint">预览不改原投稿筛选交互，仅换绿系配色。</p>`;
    } else if (submitStep === 3) {
      const hit = skins().filter((s) => !submitWeapon || s.weapon === submitWeapon).slice(0, 4);
      body = `<div class="sp-label">查重（同源数据）</div>
        <div class="sp-match-grid">${hit
          .map((s) => `<div><img src="${esc(s.imageA)}" alt="" /><div class="sp-hint">${esc(metaName(s.id, s.folderCode))}</div></div>`)
          .join("")}</div>`;
    } else {
      body = `<div class="sp-label">上传图位</div>
        <div class="sp-upload-grid">
          <div class="sp-uz"><span>+</span><span>A 市场缩略图</span></div>
          <div class="sp-uz"><span>+</span><span>B 市场详情图</span></div>
          <div class="sp-uz"><span>+</span><span>C 室内效果图</span></div>
          <div class="sp-uz"><span>+</span><span>D 室外效果图</span></div>
        </div>
        <p class="sp-hint" style="margin-top:10px">本预览不接 OSS。武器：${esc(submitWeapon || "未选")}</p>`;
    }
    $("legacySubmit").classList.toggle("is-step1", submitStep === 1);
    $("legacySubmit").innerHTML = `
      <div class="sp-head">
        <div class="sp-steps">${stepHtml}</div>
        <div class="sp-title">我要投稿</div>
      </div>
      <div class="sp-body">${body}</div>
      <div class="sp-footer">
        <button class="sp-btn-sec" type="button" id="submitPrev">上一步</button>
        <button class="sp-btn-primary" type="button" id="submitNext">${submitStep === 4 ? "完成" : "下一步"}</button>
      </div>`;
    const chips = $("wChips");
    if (chips) {
      chips.innerHTML = covers()
        .map((c) => `<button class="sp-chip${c.weapon === submitWeapon ? " on" : ""}" type="button" data-w="${esc(c.weapon)}">${esc(c.weapon)}</button>`)
        .join("");
      chips.querySelectorAll("button").forEach((b) => {
        b.onclick = () => {
          submitWeapon = b.dataset.w;
          renderSubmit();
        };
      });
    }
    $("submitPrev").onclick = () => {
      submitStep = Math.max(1, submitStep - 1);
      renderSubmit();
    };
    $("submitNext").onclick = () => {
      if (submitStep >= 4) {
        show("hub");
        return;
      }
      submitStep += 1;
      renderSubmit();
    };
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  $("focusGallery").onclick = () => goGallery(true);
  $("focusUpload").onclick = () => goHub(true);
  document.querySelectorAll("[data-home]").forEach((el) => (el.onclick = home));
  $("backGallery").onclick = () => show("gallery");
  function onChipRow(id, apply) {
    $(id).addEventListener("click", (e) => {
      const btn = e.target.closest(".chip");
      if (!btn || !$(id).contains(btn)) return;
      apply(btn.dataset.v || "");
      renderGallery();
    });
  }
  onChipRow("qualityTabs", (v) => { quality = v; });
  onChipRow("materialTabs", (v) => { material = v; });
  onChipRow("colorTabs", (v) => { color = v; });
  $("qInput").oninput = (e) => {
    query = e.target.value.trim();
    renderGallery();
  };
  $("sortDefault").onclick = () => {
    sort = "default";
    $("sortDefault").classList.add("on");
    $("sortHot").classList.remove("on");
    renderGallery();
  };
  $("sortHot").onclick = async () => {
    sort = "hot";
    $("sortHot").classList.add("on");
    $("sortDefault").classList.remove("on");
    await ensureSkinStats();
    renderGallery();
  };

  $("hubSubmit").onclick = () => {
    submitStep = 1;
    renderSubmit();
    show("submit");
  };
    $("hubPending").onclick = () => {
    renderPending("pendList", false);
    show("pending");
  };
  $("hubReview").onclick = () => {
    reviewAuthed = false;
    $("reviewLogin").style.display = "block";
    $("reviewListWrap").style.display = "none";
    show("review");
  };
  $("reviewEnter").onclick = () => {
    reviewAuthed = true;
    $("reviewLogin").style.display = "none";
    $("reviewListWrap").style.display = "block";
    renderPending("reviewPendList", true);
  };

  if (!covers().length) {
    $("coverGrid").innerHTML = `<p class="empty">未读到 covers.js，请从仓库根目录用静态服务打开本页。</p>`;
  }
})();
