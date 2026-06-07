(function () {
  const qualityMap = { U: "优品", J: "极品" };
  const materialMap = { T: "透光", G: "贵金属", Q: "其他", L: "镭射", M: "漆面", Z: "木质" };
  const colorMap = {
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
  };

  const metaById = window.SKIN_META || {};
  const weaponCovers = window.WEAPON_COVERS || [];
  const skins = (window.SKIN_DATA || []).map((item) => enrich(item));
  const state = { query: "", nav: "home", quality: "", material: "", color: "" };
  const tutorialImagesByWeapon = {
    K416: [
      {
        src: "https://skinwiki.oss-accelerate.aliyuncs.com/K416/上方教程/Snipaste_2026-05-26_22-48-20.png",
        slot: "tutorial-main",
        alt: "教程示意图-主图",
      },
      {
        src: "https://skinwiki.oss-accelerate.aliyuncs.com/K416/上方教程/Snipaste_2026-05-26_22-48-48.png",
        slot: "tutorial-pitfall",
        alt: "教程示意图-坑点",
      },
      {
        src: "https://skinwiki.oss-accelerate.aliyuncs.com/K416/上方教程/Snipaste_2026-05-26_23-17-41.png",
        slot: "tutorial-pitfall-extra",
        alt: "教程示意图-坑点补充",
      },
    ],
    QBZ95: [
      {
        src: "https://skinwiki.oss-accelerate.aliyuncs.com/QBZ95/上方教程.png",
        slot: "tutorial-main",
        alt: "QBZ95 教程图",
      },
    ],
    SCARH: [
      {
        src: "https://skinwiki.oss-accelerate.aliyuncs.com/SCARH/上方教程.png",
        slot: "tutorial-main",
        alt: "SCARH 教程图",
      },
    ],
    Vector: [
      {
        src: "https://skinwiki.oss-accelerate.aliyuncs.com/Vector/上方教程图片.png",
        slot: "tutorial-main",
        alt: "Vector 教程图",
      },
    ],
    M4A1: [
      {
        src: "https://skinwiki.oss-accelerate.aliyuncs.com/M4A1/上方教程.png",
        slot: "tutorial-main",
        alt: "M4A1 教程图",
      },
      {
        src: "https://skinwiki.oss-accelerate.aliyuncs.com/M4A1/上方教程2.png",
        slot: "tutorial-pitfall",
        alt: "M4A1 教程图2",
      },
    ],
    KC17: [
      {
        src: "https://skinwiki.oss-accelerate.aliyuncs.com/KC17/上方教程/上方教程.png",
        slot: "tutorial-main",
        alt: "KC17 教程图",
      },
      {
        src: "https://skinwiki.oss-accelerate.aliyuncs.com/KC17/上方教程/上方教程2.png",
        slot: "tutorial-pitfall",
        alt: "KC17 教程图2",
      },
    ],
    腾龙: [
      {
        src: "https://skinwiki.oss-accelerate.aliyuncs.com/腾龙/上方教程.png",
        slot: "tutorial-main",
        alt: "腾龙 教程图",
      },
      {
        src: "https://skinwiki.oss-accelerate.aliyuncs.com/腾龙/上方教程2.png",
        slot: "tutorial-pitfall",
        alt: "腾龙 教程图2",
      },
    ],
  };

  const homeView = document.getElementById("homeView");
  const homeGuide = document.getElementById("homeGuide");
  const listView = document.getElementById("listView");
  const detailView = document.getElementById("detailView");
  const tutorialPanel = document.getElementById("tutorialPanel");
  const tutorialImages = document.getElementById("tutorialImages");
  const filterBar = document.getElementById("filterBar");
  const sideNav = document.getElementById("sideNav");
  const searchInput = document.getElementById("searchInput");
  const qualityFilter = document.getElementById("qualityFilter");
  const materialFilter = document.getElementById("materialFilter");
  const colorFilter = document.getElementById("colorFilter");
  const pageTitle = document.getElementById("pageTitle");
  const backBtn = document.getElementById("backBtn");
  const lightbox = document.getElementById("lightbox");
  const lightboxImage = document.getElementById("lightboxImage");
  const lightboxClose = document.getElementById("lightboxClose");

  buildSideNav();

  searchInput.addEventListener("input", (e) => {
    state.query = e.target.value.trim().toLowerCase();
    renderList();
  });
  qualityFilter.addEventListener("change", (e) => {
    state.quality = e.target.value;
    renderList();
  });
  materialFilter.addEventListener("change", (e) => {
    state.material = e.target.value;
    renderList();
  });
  colorFilter.addEventListener("change", (e) => {
    state.color = e.target.value;
    renderList();
  });

  backBtn.addEventListener("click", () => {
    location.hash = "";
    renderList();
  });

  lightboxClose.addEventListener("click", closeLightbox);
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLightbox();
  });

  window.addEventListener("hashchange", route);
  route();

  function enrich(item) {
    const code = item.normalizedCode || "";
    const qualityCode = code[0] || "";
    const colorCode = /\d{4}$/.test(code) ? code.slice(-4) : "";
    const materialCode = colorCode ? code.slice(1, -4) : code.slice(1);
    const c1 = colorCode.slice(0, 2);
    const c2 = colorCode.slice(2, 4);

    let colorLabel = colorCode ? "未知配色" : "";
    if (!colorCode) {
      colorLabel = "";
    } else if (colorCode === "1111") {
      colorLabel = "未知配色";
    } else {
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
    const labels = materialCode
      .split("")
      .map((code) => materialMap[code] || code)
      .filter(Boolean);
    if (labels.length > 2) return labels.slice(0, 2).join(" + ");
    return labels.join(" + ");
  }

  function normalizeLabel(rawLabel, fallback) {
    if (!rawLabel || rawLabel === "NA") return fallback;
    return qualityMap[rawLabel] || materialMap[rawLabel] || rawLabel;
  }

  function route() {
    const hash = location.hash || "";
    if (!hash.startsWith("#skin=")) {
      renderList();
      return;
    }

    const id = decodeURIComponent(hash.replace("#skin=", ""));
    const skin = skins.find((s) => s.id === id);
    if (!skin) {
      renderList();
      return;
    }

    renderDetail(skin);
  }

  function renderList() {
    pageTitle.textContent = state.nav === "home" ? "首页" : state.nav;
    detailView.classList.add("hidden");
    homeGuide.classList.add("hidden");
    homeView.classList.add("hidden");
    listView.classList.add("hidden");

    if (state.nav === "home") {
      homeGuide.classList.remove("hidden");
      tutorialPanel.classList.add("hidden");
      filterBar.classList.add("hidden");
      renderHomeCovers();
      return;
    }

    homeView.classList.add("hidden");
    listView.classList.remove("hidden");
    const tutorialImagesForWeapon = tutorialImagesByWeapon[state.nav] || [];
    if (tutorialImagesForWeapon.length) {
      tutorialPanel.classList.remove("hidden");
      renderTutorialImages(tutorialImagesForWeapon);
    } else {
      tutorialPanel.classList.add("hidden");
      tutorialImages.innerHTML = "";
    }
    filterBar.classList.remove("hidden");

    const shown = skins.filter((s) => {
      if (state.nav !== "home" && s.weapon !== state.nav) return false;
      if (state.quality && s.qualityLabel !== state.quality) return false;
      if (state.material && !s.materialLabel.includes(state.material)) return false;
      if (state.color && !s.colorLabel.includes(state.color)) return false;
      if (!state.query) return true;
      const hay = [s.id, s.normalizedCode, s.name, s.colorLabel, s.qualityLabel, s.materialLabel]
        .join(" ")
        .toLowerCase();
      return hay.includes(state.query);
    });

    listView.innerHTML = shown
      .map(
        (s) => `
      <article class="card" data-id="${escapeHtml(s.id)}">
        <img src="${encodeURI(s.imageA)}" alt="${escapeHtml(s.id)} A图" />
        <div class="card-body">
          <div class="card-id">${escapeHtml(s.name)}</div>
          <div class="card-name">${escapeHtml(s.id)}</div>
          <div class="tags">
            ${renderTags(s)}
          </div>
        </div>
      </article>
    `
      )
      .join("");

    listView.querySelectorAll(".card").forEach((card) => {
      card.addEventListener("click", () => {
        const id = card.dataset.id;
        location.hash = `#skin=${encodeURIComponent(id)}`;
      });
    });
  }

  function renderDetail(s) {
    homeGuide.classList.add("hidden");
    homeView.classList.add("hidden");
    listView.classList.add("hidden");
    detailView.classList.remove("hidden");
    tutorialPanel.classList.add("hidden");
    filterBar.classList.add("hidden");

    document.getElementById("detailName").textContent = s.name;
    document.getElementById("detailId").textContent = s.id;
    document.getElementById("imgB").src = encodeURI(s.imageB);
    document.getElementById("imgC").src = encodeURI(s.imageC);
    document.getElementById("imgD").src = encodeURI(s.imageD);
    bindPreview("imgB", s.imageB);
    bindPreview("imgC", s.imageC);
    bindPreview("imgD", s.imageD);

    const metaList = document.getElementById("metaList");
    metaList.innerHTML = `
      <li><strong>武器：</strong>${escapeHtml(s.weapon)}</li>
      <li><strong>品质：</strong>${escapeHtml(s.qualityLabel)}</li>
      ${s.materialLabel ? `<li><strong>材质：</strong>${escapeHtml(s.materialLabel)}</li>` : ""}
      ${s.colorLabel ? `<li><strong>配色：</strong>${escapeHtml(s.colorLabel)}</li>` : ""}
      ${s.rating ? `<li><strong>评分：</strong>${escapeHtml(s.rating)}</li>` : ""}
      ${s.comment ? `<li><strong>简评：</strong>${escapeHtml(s.comment)}</li>` : ""}
    `;

    if (window.Comments) window.Comments.load(s.id);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function bindPreview(imgId, src) {
    const el = document.getElementById(imgId);
    el.onclick = () => openLightbox(src);
  }

  function openLightbox(src) {
    lightboxImage.src = encodeURI(src);
    lightbox.classList.remove("hidden");
  }

  function closeLightbox() {
    lightbox.classList.add("hidden");
    lightboxImage.src = "";
  }

  function renderTutorialImages(items) {
    tutorialImages.innerHTML = items
      .map(
        (item) => `
      <figure class="tutorial-card ${item.slot}">
        <img src="${encodeURI(item.src)}" alt="${escapeHtml(item.alt)}" />
      </figure>
    `
      )
      .join("");
  }

  function renderHomeCovers() {
    homeView.classList.remove("hidden");
    const cards = weaponCovers.length
      ? weaponCovers
      : [{ weapon: "K416", title: "K416", src: skins[0] ? skins[0].imageA : "", enabled: true }];

    homeView.innerHTML = cards
      .map(
        (c) => `
      <article class="card weapon-card ${c.enabled ? "enabled" : "disabled"}" data-weapon="${escapeHtml(c.weapon)}">
        <img src="${encodeURI(c.src)}" alt="${escapeHtml(c.title)} 总封面" />
        <div class="card-body">
          <div class="card-id">${escapeHtml(c.title)}</div>
          <div class="card-name">${c.enabled ? "进入图鉴" : "建设中"}</div>
        </div>
      </article>
    `
      )
      .join("");

    homeView.querySelectorAll(".weapon-card.enabled").forEach((card) => {
      card.addEventListener("click", () => {
        const weapon = card.dataset.weapon;
        state.nav = weapon;
        setActiveNav(weapon);
        renderList();
      });
    });
  }

  function setActiveNav(navKey) {
    document.querySelectorAll(".nav-btn").forEach((n) => n.classList.remove("active"));
    const target = document.querySelector(`.nav-btn[data-nav="${navKey}"]`);
    if (target) target.classList.add("active");
  }

  function renderTags(skin) {
    return [skin.qualityLabel, skin.materialLabel, skin.colorLabel]
      .filter((tag) => tag && tag !== "未标注")
      .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
      .join("");
  }

  function buildSideNav() {
    const coverWeapons = weaponCovers.filter((c) => c.enabled).map((c) => c.weapon);
    const dataWeapons = [...new Set(skins.map((s) => s.weapon).filter(Boolean))];
    const weapons = [...new Set([...coverWeapons, ...dataWeapons])];

    sideNav.innerHTML = [
      '<button class="nav-btn active" data-nav="home">首页</button>',
      ...weapons.map((weapon) => `<button class="nav-btn" data-nav="${escapeHtml(weapon)}">${escapeHtml(weapon)}</button>`),
    ].join("");

    sideNav.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.nav = btn.dataset.nav;
        setActiveNav(state.nav);
        location.hash = "";
        renderList();
      });
    });
  }

  // ── 本地开发工具：校验并更新 ───────────────────────────────────────────────
  const DEV_API = "http://localhost:8765";

  const devTools = document.getElementById("devTools");
  const validateBtn = document.getElementById("validateBtn");
  const validateWeaponSelect = document.getElementById("validateWeaponSelect");
  const validateNormalize = document.getElementById("validateNormalize");
  const validatePanel = document.getElementById("validatePanel");
  const validatePanelTitle = document.getElementById("validatePanelTitle");
  const validatePanelBody = document.getElementById("validatePanelBody");
  const validatePanelClose = document.getElementById("validatePanelClose");

  async function checkDevServer() {
    try {
      const res = await fetch(`${DEV_API}/api/health`, {
        signal: AbortSignal.timeout(800),
      });
      if (res.ok) {
        devTools.classList.remove("hidden");
        populateWeaponSelect();
      }
    } catch {
      // 静默：非本地开发环境不显示工具栏
    }
  }

  function populateWeaponSelect() {
    const weapons = [...new Set(weaponCovers.map((c) => c.weapon))].sort();
    weapons.forEach((w) => {
      const opt = document.createElement("option");
      opt.value = w;
      opt.textContent = w;
      validateWeaponSelect.appendChild(opt);
    });
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

    const lines = (data.stdout || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

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
      const weapon = validateWeaponSelect.value;
      const normalize = validateNormalize.checked;

      openValidatePanel();
      validatePanelTitle.textContent = "校验中…";
      validatePanelTitle.className = "";
      validatePanelBody.innerHTML = '<div class="validate-spinner"></div>';
      validateBtn.disabled = true;

      try {
        const res = await fetch(`${DEV_API}/api/validate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ weapon, normalize }),
        });
        const data = await res.json();
        renderValidateResult(data);
      } catch (err) {
        validatePanelTitle.textContent = "请求失败";
        validatePanelTitle.className = "validate-title-err";
        validatePanelBody.innerHTML = `<div class="validate-line">${escapeHtml(String(err))}</div>`;
      } finally {
        validateBtn.disabled = false;
      }
    });
  }

  if (validatePanelClose) {
    validatePanelClose.addEventListener("click", closeValidatePanel);
  }

  if (validatePanel) {
    validatePanel.addEventListener("click", (e) => {
      if (e.target === validatePanel) closeValidatePanel();
    });
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !validatePanel.classList.contains("hidden")) {
      closeValidatePanel();
    }
  });

  checkDevServer();
})();
