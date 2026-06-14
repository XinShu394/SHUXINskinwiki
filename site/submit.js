/**
 * 砖皮百科 · 投稿面板（三步流版）
 * Step1: 筛选（枪型 / 稀有度 / 材质 / 颜色）
 * Step2: 查重确认（展示数据库已有同类皮肤）
 * Step3: 填写名称 + 上传图片（OSS 直传）
 * window.Submit.open() 打开面板
 */
(function (global) {
  'use strict';

  var API_BASE = (
    location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      ? 'http://localhost:5200/api'
      : '/api'
  );

  var QUALITY_OPTS  = ['优品', '极品'];
  var MATERIAL_OPTS = ['贵金属', '透光', '镭射', '漆面', '木质', '其他'];
  var COLOR_OPTS    = ['白', '红', '黄', '青', '紫', '棕', '黑', '灰', '橙', '绿', '蓝', '粉', '炫彩'];

  var QUALITY_CODES  = { '优品': 'U', '极品': 'J' };
  var MATERIAL_CODES = { '贵金属': 'G', '透光': 'T', '镭射': 'L', '漆面': 'M', '木质': 'Z', '其他': 'Q' };
  var COLOR_CODES    = {
    '白': '01', '红': '02', '黄': '03', '青': '04', '紫': '05', '棕': '06',
    '黑': '07', '灰': '08', '橙': '09', '绿': '10', '蓝': '11', '粉': '12', '炫彩': '1111'
  };

  // 模板武器（目录名不用颜色码，用皮肤名）
  var TEMPLATE_WEAPONS = ['AUG', 'SCARH', 'Vector', 'M4A1', 'KC17'];

  var SLOT_INFO = {
    A: { label: 'A  市场缩略图', hint: '市场列表中的预览小图' },
    B: { label: 'B  市场详情图', hint: '点击「查看」后的大图' },
    C: { label: 'C  室内效果图', hint: '靶场室内持枪截图' },
    D: { label: 'D  室外效果图', hint: '室外场景持枪截图' }
  };

  var state   = mkState();
  var panelEl = null;

  global.Submit = { open: openPanel };

  // ── 初始化 ──────────────────────────────────────────────
  function mkState() {
    return { step: 1, weapon: '', skinName: '', quality: '', material: '',
             color1: '', color2: '',
             files: { '1': null, '2': null, '3': null, '4': null },
             coverSlot: '1' };
  }

  function openPanel() {
    revokeFiles();
    state = mkState();
    if (!panelEl) {
      panelEl = document.getElementById('submitPanel');
      if (panelEl) {
        panelEl.addEventListener('click', function (e) {
          if (e.target === panelEl) closePanel();
        });
      }
    }
    render(1);
    if (panelEl) panelEl.classList.remove('hidden');
  }

  function closePanel() {
    revokeFiles();
    if (panelEl) panelEl.classList.add('hidden');
  }

  function revokeFiles() {
    if (!state) return;
    Object.values(state.files).forEach(function (f) {
      if (f && f.url) URL.revokeObjectURL(f.url);
    });
  }

  // ── 工具 ────────────────────────────────────────────────
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
           .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function parseApiResponse(r) {
    var reqId = r.headers.get('X-Request-Id') || '';
    var ct = (r.headers.get('content-type') || '').toLowerCase();
    if (ct.indexOf('application/json') !== -1) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        return { ok: r.ok, status: r.status, data: d, requestId: reqId };
      });
    }
    return r.text().then(function (t) {
      return { ok: r.ok, status: r.status, data: { error: (t || '').slice(0, 120) }, requestId: reqId };
    });
  }

  function formatApiError(res, fallback) {
    var msg = (res && res.data && res.data.error) || fallback;
    if (res && res.status === 413) {
      msg = '上传体积过大，请压缩后重试（单图≤20MB）';
    }
    if (res && res.requestId) msg += '（请求ID:' + res.requestId + '）';
    return msg;
  }

  function inferExt(file) {
    if (!file) return '.png';
    if (/jpe?g$/i.test(file.type) || /\.jpe?g$/i.test(file.name || '')) return '.jpg';
    return '.png';
  }

  function loadOssSdk() {
    if (global.OSS) return Promise.resolve(global.OSS);
    if (global.__zpbkOssLoading) return global.__zpbkOssLoading;
    global.__zpbkOssLoading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://gosspublic.alicdn.com/aliyun-oss-sdk-6.18.0.min.js';
      s.async = true;
      s.onload = function () {
        if (global.OSS) resolve(global.OSS);
        else reject(new Error('OSS SDK 加载失败'));
      };
      s.onerror = function () { reject(new Error('OSS SDK 加载失败')); };
      document.head.appendChild(s);
    });
    return global.__zpbkOssLoading;
  }

  function createOssClient(sts) {
    return new global.OSS({
      region: sts.region,
      accessKeyId: sts.accessKeyId,
      accessKeySecret: sts.accessKeySecret,
      stsToken: sts.securityToken,
      bucket: sts.bucket
    });
  }

  function enabledWeapons() {
    return (global.WEAPON_COVERS || []).filter(function (c) { return c.enabled; })
           .map(function (c) { return c.weapon; });
  }

  function isTemplate(w) { return TEMPLATE_WEAPONS.indexOf(w) !== -1; }

  function buildCodeHint() {
    if (!state.quality || !state.material) return '—';
    var q = QUALITY_CODES[state.quality] || '?';
    var m = MATERIAL_CODES[state.material] || '?';
    if (isTemplate(state.weapon)) return '—';
    if (!state.color1) return q + m + '????';
    if (state.color1 === '炫彩') return q + m + '1111';
    var c1 = COLOR_CODES[state.color1] || '??';
    var c2 = (state.color2 && state.color2 !== '单色') ? (COLOR_CODES[state.color2] || '??') : '00';
    return q + m + c1 + c2;
  }

  // ── 查重过滤 ─────────────────────────────────────────────
  function matchingSkinsInDB() {
    var all = global.SKIN_DATA || [];
    return all.filter(function (s) {
      if (s.weapon !== state.weapon) return false;
      if (state.quality  && s.qualityLabel  !== state.quality)  return false;
      if (state.material && s.materialLabel !== state.material) return false;
      if (state.color1) {
        // colorLabel 格式："白色" / "白色 + 红色"，state.color1 = "白"
        if (!s.colorLabel || s.colorLabel.indexOf(state.color1) === -1) return false;
      }
      return true;
    });
  }

  // ── 渲染 ────────────────────────────────────────────────
  function stepHeader(active) {
    var steps = [
      { n: '①', label: '筛选' },
      { n: '②', label: '查重' },
      { n: '③', label: '上传' }
    ];
    var h = '<div class="sp-steps">';
    steps.forEach(function (s, i) {
      if (i > 0) h += '<span class="sp-step-sep">›</span>';
      var cls = 'sp-step' + (i + 1 === active ? ' sp-step-active' : '');
      h += '<span class="' + cls + '">' + s.n + ' ' + s.label + '</span>';
    });
    h += '</div>';
    return h;
  }

  function render(step) {
    if (!panelEl) return;
    state.step = step;
    var html;
    if (step === 1)      html = buildStep1();
    else if (step === 2) html = buildStep2();
    else                 html = buildStep3();
    panelEl.innerHTML = html;
    bindEvents(step);
  }

  function chips(opts, type, current) {
    return opts.map(function (o) {
      return '<button class="sp-chip' + (current === o ? ' active' : '') +
             '" data-type="' + type + '" data-val="' + esc(o) + '">' + esc(o) + '</button>';
    }).join('');
  }

  // ── Step 1：筛选 ──────────────────────────────────────────
  function buildStep1() {
    var weapons = enabledWeapons();
    var showColor = !isTemplate(state.weapon);
    var h = '<div class="sp-inner"><div class="sp-head">';
    h += stepHeader(1);
    h += '<span class="sp-title">投稿皮肤截图</span>';
    h += '<button class="sp-close" id="spClose">×</button></div>';
    h += '<div class="sp-body">';

    // 武器
    h += '<div class="sp-section"><div class="sp-label">选择武器</div>';
    h += '<div class="sp-chips">' + chips(weapons, 'weapon', state.weapon) + '</div></div>';

    // 稀有度
    h += '<div class="sp-section"><div class="sp-label">稀有度 <span class="sp-req">必填</span></div>';
    h += '<div class="sp-chips">' + chips(QUALITY_OPTS, 'quality', state.quality) + '</div></div>';

    // 材质
    h += '<div class="sp-section"><div class="sp-label">材质 <span class="sp-req">必填</span></div>';
    h += '<div class="sp-chips">' + chips(MATERIAL_OPTS, 'material', state.material) + '</div></div>';

    // 颜色（非模板武器）
    if (showColor) {
      h += '<div class="sp-section"><div class="sp-label">主色</div>';
      h += '<div class="sp-chips">' + chips(COLOR_OPTS, 'color1', state.color1) + '</div></div>';
      if (state.color1 && state.color1 !== '炫彩') {
        var c2opts = ['单色'].concat(COLOR_OPTS.filter(function (c) { return c !== state.color1 && c !== '炫彩'; }));
        var c2cur  = state.color2 || '单色';
        h += '<div class="sp-section"><div class="sp-label">副色 <span class="sp-hint">单色时选「单色」</span></div>';
        h += '<div class="sp-chips">' + chips(c2opts, 'color2', c2cur) + '</div></div>';
      }
    }

    // 编码预览（模板武器显示"—"）
    h += '<div class="sp-code-preview">目录编码预览：<span class="sp-code-val">' + esc(buildCodeHint()) + '</span></div>';

    h += '<div class="sp-footer"><button class="sp-btn-primary" id="spNext">下一步 →</button></div>';
    h += '</div></div>';
    return h;
  }

  // ── Step 2：查重确认 ──────────────────────────────────────
  function buildStep2() {
    var matches = matchingSkinsInDB();
    var h = '<div class="sp-inner"><div class="sp-head">';
    h += stepHeader(2);
    h += '<span class="sp-title">查重确认</span>';
    h += '<button class="sp-close" id="spClose">×</button></div>';
    h += '<div class="sp-body">';

    // 筛选条件摘要
    var summary = [state.weapon, state.quality, state.material];
    if (state.color1) summary.push(state.color1 + (state.color2 && state.color2 !== '单色' ? '+' + state.color2 : ''));
    h += '<div class="sp-dupcheck-summary">筛选条件：<strong>' + esc(summary.join(' · ')) + '</strong></div>';

    if (matches.length === 0) {
      h += '<div class="sp-dupcheck-notice sp-dupcheck-ok">';
      h += '✓ 数据库中暂无该组合皮肤，可放心投稿新模板。';
      h += '</div>';
    } else {
      h += '<div class="sp-dupcheck-notice sp-dupcheck-warn">';
      h += '⚠ 已有 ' + matches.length + ' 款相似皮肤，请确认你投稿的是新模板（外观/配色不同）。';
      h += '</div>';

      // 缩略图网格
      h += '<div class="sp-match-grid">';
      matches.forEach(function (s) {
        var imgSrc = s.imageA || '';
        h += '<div class="sp-match-card">';
        if (imgSrc) {
          h += '<img class="sp-match-img" src="' + esc(imgSrc) + '" alt="' + esc(s.id) + '" loading="lazy" />';
        } else {
          h += '<div class="sp-match-noimg">无图</div>';
        }
        h += '<div class="sp-match-id">' + esc(s.id) + '</div>';
        h += '</div>';
      });
      h += '</div>';
    }

    h += '<div class="sp-footer">';
    h += '<button class="sp-btn-sec" id="spBack">← 返回</button>';
    h += '<button class="sp-btn-primary" id="spConfirmNew">确认是新模板，继续 →</button>';
    h += '</div>';
    h += '</div></div>';
    return h;
  }

  // ── Step 3：填写名称 + 上传 ───────────────────────────────
  function buildStep3() {
    var h = '<div class="sp-inner"><div class="sp-head">';
    h += stepHeader(3);
    h += '<span class="sp-title">填写信息并上传截图</span>';
    h += '<button class="sp-close" id="spClose">×</button></div>';
    h += '<div class="sp-body">';

    // 皮肤名称（从 Step1 移到这里）
    h += '<div class="sp-section"><div class="sp-label">皮肤名称 <span class="sp-req">必填</span></div>';
    h += '<input class="sp-input" id="spName" maxlength="50" placeholder="例：七彩雷、纯银、蓝血" value="' + esc(state.skinName) + '" /></div>';

    // 图片上传区（4 张全部必填，选 1 张作封面）
    h += '<div class="sp-section"><div class="sp-label">截图上传 <span class="sp-hint">4 张全部必填 · PNG/JPG · 单张 ≤ 20MB · 选一张设为封面图</span></div>';
    h += '<div class="sp-upload-grid">';
    ['1', '2', '3', '4'].forEach(function (slot) {
      var f       = state.files[slot];
      var isCover = state.coverSlot === slot;
      h += '<div class="sp-uz' + (f ? ' has-file' : '') + (isCover ? ' sp-uz-cover' : '') + '" id="spUz' + slot + '" data-slot="' + slot + '">';
      if (f) {
        h += '<img class="sp-uz-img" src="' + f.url + '" />';
        if (isCover) {
          h += '<div class="sp-uz-cover-badge">★ 封面图</div>';
        } else {
          h += '<button class="sp-uz-cover-btn" data-slot="' + slot + '">设为封面</button>';
        }
        h += '<div class="sp-uz-fname">' + esc(f.name) + '</div>';
        h += '<button class="sp-uz-del" data-slot="' + slot + '">✕</button>';
      } else {
        h += '<div class="sp-uz-plus">＋</div>';
        h += '<div class="sp-uz-label">图 ' + slot + (isCover ? ' · 封面' : '') + '</div>';
        h += '<div class="sp-uz-hint">任意角度截图</div>';
      }
      h += '<input class="sp-uz-input" id="spUzIn' + slot + '" type="file" accept="image/png,image/jpeg" />';
      h += '</div>';
    });
    h += '</div></div>';

    // 昵称 + 备注
    h += '<div class="sp-row">';
    h += '<div class="sp-section sp-half"><div class="sp-label">昵称 <span class="sp-hint">可匿名</span></div>';
    h += '<input class="sp-input" id="spContrib" maxlength="20" placeholder="匿名" /></div>';
    h += '<div class="sp-section sp-half"><div class="sp-label">备注说明 <span class="sp-hint">可选</span></div>';
    h += '<input class="sp-input" id="spNotes" maxlength="200" placeholder="例：这款颜色很独特…" /></div>';
    h += '</div>';

    // 授权声明
    h += '<label class="sp-auth"><input type="checkbox" id="spAuth" />';
    h += ' 我确认图片为本人游戏内截图，授权用于本非盈利图鉴展示</label>';

    // 上传进度（提交后显示）
    h += '<div id="spProgress" class="sp-progress hidden">';
    h += '<div class="sp-progress-header">';
    h += '<span id="spProgressText">准备上传…</span>';
    h += '<span id="spProgressPct">0%</span>';
    h += '</div>';
    h += '<div class="sp-progress-track"><div class="sp-progress-fill" id="spProgressFill"></div></div>';
    h += '<div class="sp-progress-tip">⏱ 4 张图预计 1–2 分钟，请勿关闭页面</div>';
    h += '</div>';

    h += '<div class="sp-footer">';
    h += '<button class="sp-btn-sec" id="spBack">← 返回</button>';
    h += '<button class="sp-btn-primary" id="spSubmit" disabled>提交投稿</button>';
    h += '</div>';

    h += '</div></div>';
    return h;
  }

  // ── 事件绑定 ────────────────────────────────────────────
  function bindEvents(step) {
    if (!panelEl) return;
    var closeBtn = panelEl.querySelector('#spClose');
    if (closeBtn) closeBtn.addEventListener('click', closePanel);

    // chip 选择（步骤 1 用）
    panelEl.querySelectorAll('.sp-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var type = chip.dataset.type;
        var val  = chip.dataset.val;
        state[type] = val;
        if (type === 'color1') state.color2 = '';
        render(step);
      });
    });

    if (step === 1) {
      var nextBtn = panelEl.querySelector('#spNext');
      if (nextBtn) {
        nextBtn.addEventListener('click', function () {
          if (!state.weapon)   { toast('请先选择武器'); return; }
          if (!state.quality)  { toast('请选择稀有度'); return; }
          if (!state.material) { toast('请选择材质'); return; }
          render(2);
        });
      }

    } else if (step === 2) {
      var backBtn2 = panelEl.querySelector('#spBack');
      if (backBtn2) backBtn2.addEventListener('click', function () { render(1); });

      var confirmBtn = panelEl.querySelector('#spConfirmNew');
      if (confirmBtn) confirmBtn.addEventListener('click', function () { render(3); });

    } else {
      // Step 3
      var backBtn3 = panelEl.querySelector('#spBack');
      if (backBtn3) backBtn3.addEventListener('click', function () { render(2); });

      var authChk   = panelEl.querySelector('#spAuth');
      var submitBtn = panelEl.querySelector('#spSubmit');

      function updateSubmitBtn() {
        if (!authChk || !submitBtn) return;
        var hasAll  = ['1','2','3','4'].every(function (s) { return state.files[s] !== null; });
        var hasName = (panelEl.querySelector('#spName') || {}).value && panelEl.querySelector('#spName').value.trim().length > 0;
        submitBtn.disabled = !(authChk.checked && hasAll && hasName);
      }

      if (authChk) authChk.addEventListener('change', updateSubmitBtn);

      var nameInput = panelEl.querySelector('#spName');
      if (nameInput) {
        nameInput.addEventListener('input', function () {
          state.skinName = nameInput.value;
          updateSubmitBtn();
        });
      }

      ['1', '2', '3', '4'].forEach(function (slot) {
        var zone  = panelEl.querySelector('#spUz' + slot);
        var input = panelEl.querySelector('#spUzIn' + slot);
        if (!zone || !input) return;

        zone.addEventListener('click', function (e) {
          if (e.target.classList.contains('sp-uz-del')) return;
          if (e.target.classList.contains('sp-uz-cover-btn')) return;
          if (e.target.tagName === 'INPUT') return;
          input.click();
        });
        zone.addEventListener('dragover', function (e) {
          e.preventDefault(); zone.classList.add('drag-over');
        });
        zone.addEventListener('dragleave', function () {
          zone.classList.remove('drag-over');
        });
        zone.addEventListener('drop', function (e) {
          e.preventDefault(); zone.classList.remove('drag-over');
          var file = e.dataTransfer.files[0];
          if (file) handleFile(slot, file);
        });
        input.addEventListener('change', function () {
          if (input.files[0]) handleFile(slot, input.files[0]);
        });
        var delBtn = zone.querySelector('.sp-uz-del');
        if (delBtn) {
          delBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            var s = delBtn.dataset.slot;
            if (state.files[s] && state.files[s].url) URL.revokeObjectURL(state.files[s].url);
            state.files[s] = null;
            if (state.coverSlot === s) {
              state.coverSlot = ['1','2','3','4'].find(function (x) { return x !== s && state.files[x]; }) || '1';
            }
            render(3);
          });
        }
        var coverBtn = zone.querySelector('.sp-uz-cover-btn');
        if (coverBtn) {
          coverBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            state.coverSlot = coverBtn.dataset.slot;
            render(3);
          });
        }
      });

      if (submitBtn) submitBtn.addEventListener('click', doSubmit);
    }
  }

  function handleFile(slot, file) {
    if (!file.type.match(/^image\/(png|jpe?g)$/i)) { toast('仅支持 PNG / JPG 格式'); return; }
    if (file.size > 20 * 1024 * 1024)              { toast('图片超过 20MB 限制'); return; }
    if (state.files[slot] && state.files[slot].url) URL.revokeObjectURL(state.files[slot].url);
    state.files[slot] = { file: file, name: file.name, url: URL.createObjectURL(file) };
    render(3);
  }

  // ── 提交 ────────────────────────────────────────────────
  function doSubmit() {
    var hasAll = ['1','2','3','4'].every(function (s) { return state.files[s] !== null; });
    if (!hasAll) { toast('请上传全部 4 张截图后提交'); return; }

    var nameEl = panelEl.querySelector('#spName');
    var skinName = nameEl ? nameEl.value.trim() : state.skinName.trim();
    if (!skinName) { toast('请填写皮肤名称'); return; }
    state.skinName = skinName;

    var submitBtn   = panelEl.querySelector('#spSubmit');
    var contributor = (panelEl.querySelector('#spContrib') || {}).value || '';
    var notes       = (panelEl.querySelector('#spNotes') || {}).value || '';

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '提交中…'; }

    var payload = {
      weapon: state.weapon,
      skinName: state.skinName,
      quality: state.quality,
      material: state.material,
      color1: state.color1 || '',
      color2: state.color2 || '',
      notes: notes.trim(),
      contributor: contributor.trim() || '匿名'
    };

    fetch(API_BASE + '/submissions/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(parseApiResponse)
      .then(function (res) {
        if (!res.ok) {
          toast(formatApiError(res, '提交失败，请重试'));
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '提交投稿'; }
          return Promise.reject(new Error('create failed'));
        }
        return loadOssSdk().then(function () { return res.data; });
      })
      .then(function (createData) {
        var sts = createData.sts || {};
        if (!sts.accessKeyId || !sts.securityToken || !sts.keyPrefix) {
          toast('上传凭证无效，请稍后重试');
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '提交投稿'; }
          return Promise.reject(new Error('bad sts'));
        }
        var client = createOssClient(sts);
        var uploads = {};
        var chain = Promise.resolve();
        // 封面图 → A，其余按顺序 → B/C/D
        var ossSlots    = ['A', 'B', 'C', 'D'];
        var allNums     = ['1', '2', '3', '4'];
        var orderedNums = [state.coverSlot].concat(allNums.filter(function (x) { return x !== state.coverSlot; }));
        var total       = orderedNums.length;
        var uploadedCount = 0;

        // 显示进度条
        var progEl = panelEl && panelEl.querySelector('#spProgress');
        if (progEl) progEl.classList.remove('hidden');

        function setProgress(done, label) {
          var pctNum = Math.round(done / total * 100);
          var fill = panelEl && panelEl.querySelector('#spProgressFill');
          var text = panelEl && panelEl.querySelector('#spProgressText');
          var pct  = panelEl && panelEl.querySelector('#spProgressPct');
          if (fill) fill.style.width = pctNum + '%';
          if (text) text.textContent = label;
          if (pct)  pct.textContent  = pctNum + '%';
        }

        setProgress(0, '准备上传…');

        orderedNums.forEach(function (numSlot, i) {
          var ossSlot = ossSlots[i];
          chain = chain.then(function () {
            setProgress(uploadedCount, '上传第 ' + (uploadedCount + 1) + ' / ' + total + ' 张…');
            var f = state.files[numSlot].file;
            var ext = inferExt(f);
            var key = sts.keyPrefix + ossSlot + ext;
            return client.multipartUpload(key, f, {
              timeout: 120000,
              mime: f.type || 'image/png'
            }).then(function (ret) {
              var etag = '';
              if (ret && ret.res && ret.res.headers && ret.res.headers.etag) etag = String(ret.res.headers.etag).replace(/"/g, '');
              uploads[ossSlot] = { key: key, etag: etag, contentType: f.type || '' };
              uploadedCount++;
              setProgress(uploadedCount, uploadedCount < total
                ? ('上传第 ' + (uploadedCount + 1) + ' / ' + total + ' 张…')
                : '图片上传完毕，提交中…');
            });
          });
        });
        return chain.then(function () {
          setProgress(total, '图片上传完毕，提交中…');
          return fetch(API_BASE + '/submissions/commit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ submissionId: createData.id, uploads: uploads })
          }).then(parseApiResponse).then(function (commitRes) {
            if (!commitRes.ok) {
              toast(formatApiError(commitRes, '提交失败，请重试'));
              if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '提交投稿'; }
              return;
            }
            showSuccess(createData.id, createData.queryToken || '');
          });
        });
      })
      .catch(function () {
        if (submitBtn && submitBtn.disabled) {
          toast('上传失败，请重试（请检查网络与 OSS 跨域配置）');
        }
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '提交投稿'; }
      });
  }

  function showSuccess(id, queryToken) {
    if (!panelEl) return;
    var ticketHtml = queryToken
      ? ('<div class="sp-success-ticket">查询票据：<strong>' + esc(queryToken) + '</strong><br>请截图保存，后续可查询审核状态。</div>')
      : '';
    panelEl.innerHTML =
      '<div class="sp-inner sp-inner-success">' +
        '<div class="sp-success-icon">✓</div>' +
        '<div class="sp-success-title">投稿成功！</div>' +
        '<div class="sp-success-desc">编号 <strong>#' + id + '</strong>，审核通过后将在图鉴中展示。<br>感谢你的贡献！</div>' +
        ticketHtml +
        '<button class="sp-btn-primary" id="spDone">关闭</button>' +
      '</div>';
    panelEl.querySelector('#spDone').addEventListener('click', closePanel);
    panelEl.addEventListener('click', function (e) {
      if (e.target === panelEl) closePanel();
    });
  }

  // ── Toast 提示 ──────────────────────────────────────────
  var _toastTimer = null;
  function toast(msg) {
    var el = document.getElementById('spToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'spToast';
      el.className = 'sp-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('visible');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () { el.classList.remove('visible'); }, 2800);
  }

  // ── 绑定入口按钮 ─────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('submitBtn');
    if (btn) btn.addEventListener('click', openPanel);
  });

}(window));
