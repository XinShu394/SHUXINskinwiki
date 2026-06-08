(function () {
  const qualityMap = { U: "��Ʒ", J: "��Ʒ" };
  const materialMap = { T: "͸��", G: "�����", Q: "����", L: "����", M: "����", Z: "ľ��" };
  const colorMap = {
    "00": "��ɫ",
    "01": "��ɫ",
    "02": "��ɫ",
    "03": "��ɫ",
    "04": "��ɫ",
    "05": "��ɫ",
    "06": "��ɫ",
    "07": "��ɫ",
    "08": "��ɫ",
    "09": "��ɫ",
    "10": "��ɫ",
    "11": "��ɫ",
    "12": "��ɫ",
  };

  const metaById = window.SKIN_META || {};
  const weaponCovers = window.WEAPON_COVERS || [];
  const skins = (window.SKIN_DATA || []).map((item) => enrich(item));
  const state = { query: "", nav: "home", quality: "", material: "", color: "" };
  const tutorialImagesByWeapon = {
    K416: [
      {
        src: "https://skinwiki.oss-cn-guangzhou.aliyuncs.com/K416/�Ϸ��̳�/Snipaste_2026-05-26_22-48-20.png",
        slot: "tutorial-main",
        alt: "�̳�ʾ��ͼ-��ͼ",
      },
      {
        src: "https://skinwiki.oss-cn-guangzhou.aliyuncs.com/K416/�Ϸ��̳�/Snipaste_2026-05-26_22-48-48.png",
        slot: "tutorial-pitfall",
        alt: "�̳�ʾ��ͼ-�ӵ�",
      },
      {
        src: "https://skinwiki.oss-cn-guangzhou.aliyuncs.com/K416/�Ϸ��̳�/Snipaste_2026-05-26_23-17-41.png",
        slot: "tutorial-pitfall-extra",
        alt: "�̳�ʾ��ͼ-�ӵ㲹��",
      },
    ],
    QBZ95: [
      {
        src: "https://skinwiki.oss-cn-guangzhou.aliyuncs.com/QBZ95/�Ϸ��̳�.png",
        slot: "tutorial-main",
        alt: "QBZ95 �̳�ͼ",
      },
    ],
    SCARH: [
      {
        src: "https://skinwiki.oss-cn-guangzhou.aliyuncs.com/SCARH/�Ϸ��̳�.png",
        slot: "tutorial-main",
        alt: "SCARH �̳�ͼ",
      },
    ],
    Vector: [
      {
        src: "https://skinwiki.oss-cn-guangzhou.aliyuncs.com/Vector/�Ϸ��̳�ͼƬ.png",
        slot: "tutorial-main",
        alt: "Vector �̳�ͼ",
      },
    ],
    M4A1: [
      {
        src: "https://skinwiki.oss-cn-guangzhou.aliyuncs.com/M4A1/�Ϸ��̳�.png",
        slot: "tutorial-main",
        alt: "M4A1 �̳�ͼ",
      },
      {
        src: "https://skinwiki.oss-cn-guangzhou.aliyuncs.com/M4A1/�Ϸ��̳�2.png",
        slot: "tutorial-pitfall",
        alt: "M4A1 �̳�ͼ2",
      },
    ],
    KC17: [
      {
        src: "https://skinwiki.oss-cn-guangzhou.aliyuncs.com/KC17/�Ϸ��̳�/�Ϸ��̳�.png",
        slot: "tutorial-main",
        alt: "KC17 �̳�ͼ",
      },
      {
        src: "https://skinwiki.oss-cn-guangzhou.aliyuncs.com/KC17/�Ϸ��̳�/�Ϸ��̳�2.png",
        slot: "tutorial-pitfall",
        alt: "KC17 �̳�ͼ2",
      },
    ],
    ����: [
      {
        src: "https://skinwiki.oss-cn-guangzhou.aliyuncs.com/����/�Ϸ��̳�.png",
        slot: "tutorial-main",
        alt: "���� �̳�ͼ",
      },
      {
        src: "https://skinwiki.oss-cn-guangzhou.aliyuncs.com/����/�Ϸ��̳�2.png",
        slot: "tutorial-pitfall",
        alt: "���� �̳�ͼ2",
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

    let colorLabel = colorCode ? "δ֪��ɫ" : "";
    if (!colorCode) {
      colorLabel = "";
    } else if (colorCode === "1111") {
      colorLabel = "δ֪��ɫ";
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
        "δ����",
      rating: meta.rating || "",
      comment: meta.comment || "",
      qualityLabel: normalizeLabel(item.qualityLabel, qualityMap[qualityCode] || "δ��ע"),
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
    pageTitle.textContent = state.nav === "home" ? "��ҳ" : state.nav;
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
        <img src="${encodeURI(s.imageA)}" alt="${escapeHtml(s.id)} Aͼ" />
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
      <li><strong>������</strong>${escapeHtml(s.weapon)}</li>
      <li><strong>Ʒ�ʣ�</strong>${escapeHtml(s.qualityLabel)}</li>
      ${s.materialLabel ? `<li><strong>���ʣ�</strong>${escapeHtml(s.materialLabel)}</li>` : ""}
      ${s.colorLabel ? `<li><strong>��ɫ��</strong>${escapeHtml(s.colorLabel)}</li>` : ""}
      ${s.rating ? `<li><strong>���֣�</strong>${escapeHtml(s.rating)}</li>` : ""}
      ${s.comment ? `<li><strong>������</strong>${escapeHtml(s.comment)}</li>` : ""}
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
        <img src="${encodeURI(c.src)}" alt="${escapeHtml(c.title)} �ܷ���" />
        <div class="card-body">
          <div class="card-id">${escapeHtml(c.title)}</div>
          <div class="card-name">${c.enabled ? "����ͼ��" : "������"}</div>
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
      .filter((tag) => tag && tag !== "δ��ע")
      .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
      .join("");
  }

  function buildSideNav() {
    const coverWeapons = weaponCovers.filter((c) => c.enabled).map((c) => c.weapon);
    const dataWeapons = [...new Set(skins.map((s) => s.weapon).filter(Boolean))];
    const weapons = [...new Set([...coverWeapons, ...dataWeapons])];

    sideNav.innerHTML = [
      '<button class="nav-btn active" data-nav="home">��ҳ</button>',
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

  // ���� ���ؿ������ߣ�У�鲢���� ����������������������������������������������������������������������������������������������
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
      // ��Ĭ���Ǳ��ؿ�����������ʾ������
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
      validatePanelTitle.textContent = "У��ͨ�� ?";
      validatePanelTitle.className = "validate-title-ok";
    } else {
      validatePanelTitle.textContent = "У��ʧ�� ?";
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
              <div class="validate-warn-head">? �澯��${warnings.length} ����</div>
              ${warnings.map((w) => `<div class="validate-warn-line">${escapeHtml(w)}</div>`).join("")}
            </div>`
          : ""
      }
      ${
        !data.ok && data.stderr
          ? `<div class="validate-errors">
              <div class="validate-error-head">��������</div>
              <pre class="validate-pre">${escapeHtml(data.stderr)}</pre>
            </div>`
          : ""
      }
      <div class="validate-reload-hint">
        ${data.ok ? "�����Ѹ��£�<button class='validate-reload-btn' onclick='location.reload()'>ˢ��ҳ��</button> ��Ч" : "δд�� site������ˢ��"}
      </div>
    `;
  }

  if (validateBtn) {
    validateBtn.addEventListener("click", async () => {
      const weapon = validateWeaponSelect.value;
      const normalize = validateNormalize.checked;

      openValidatePanel();
      validatePanelTitle.textContent = "У���С�";
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
        validatePanelTitle.textContent = "����ʧ��";
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
