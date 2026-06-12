/**
 * 砖皮百科 · 投稿面板
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

  var state = mkState();
  var panelEl = null;

  global.Submit = { open: openPanel };

  // ── 初始化 ──────────────────────────────────────────────
  function mkState() {
    return { step: 1, weapon: '', skinName: '', quality: '', material: '',
             color1: '', color2: '', files: { A: null, B: null, C: null, D: null } };
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
      msg = '上传体积过大，请压缩后重试（单图≤5MB，总请求≤30MB）';
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
    if (isTemplate(state.weapon)) {
      return state.skinName.trim() ? (q + m + state.skinName.trim()) : (q + m + '…');
    }
    if (!state.color1) return q + m + '????';
    if (state.color1 === '炫彩') return q + m + '1111';
    var c1 = COLOR_CODES[state.color1] || '??';
    var c2 = (state.color2 && state.color2 !== '单色') ? (COLOR_CODES[state.color2] || '??') : '00';
    return q + m + c1 + c2;
  }

  // ── 渲染 ────────────────────────────────────────────────
  function render(step) {
    if (!panelEl) return;
    state.step = step;
    panelEl.innerHTML = step === 1 ? buildStep1() : buildStep2();
    bindEvents(step);
  }

  function chips(opts, type, current) {
    return opts.map(function (o) {
      return '<button class="sp-chip' + (current === o ? ' active' : '') +
             '" data-type="' + type + '" data-val="' + esc(o) + '">' + esc(o) + '</button>';
    }).join('');
  }

  function buildStep1() {
    var weapons = enabledWeapons();
    var showColor = !isTemplate(state.weapon);
    var h = '<div class="sp-inner"><div class="sp-head">';
    h += '<div class="sp-steps"><span class="sp-step sp-step-active">① 皮肤信息</span>'
       + '<span class="sp-step-sep">›</span><span class="sp-step">② 上传图片</span></div>';
    h += '<span class="sp-title">投稿皮肤截图</span>';
    h += '<button class="sp-close" id="spClose">×</button></div>';
    h += '<div class="sp-body">';

    // 武器
    h += '<div class="sp-section"><div class="sp-label">选择武器</div>';
    h += '<div class="sp-chips">' + chips(weapons, 'weapon', state.weapon) + '</div></div>';

    // 皮肤名
    h += '<div class="sp-section"><div class="sp-label">皮肤名称 <span class="sp-req">必填</span></div>';
    h += '<input class="sp-input" id="spName" maxlength="50" placeholder="例：七彩雷、纯银、蓝血" value="' + esc(state.skinName) + '" /></div>';

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

    // 编码预览
    h += '<div class="sp-code-preview">目录编码预览：<span class="sp-code-val">' + esc(buildCodeHint()) + '</span></div>';

    h += '<div class="sp-footer"><button class="sp-btn-primary" id="spNext">下一步 →</button></div>';
    h += '</div></div>';
    return h;
  }

  function buildStep2() {
    var h = '<div class="sp-inner"><div class="sp-head">';
    h += '<div class="sp-steps"><span class="sp-step">① 皮肤信息</span>'
       + '<span class="sp-step-sep">›</span><span class="sp-step sp-step-active">② 上传图片</span></div>';
    h += '<span class="sp-title">投稿皮肤截图</span>';
    h += '<button class="sp-close" id="spClose">×</button></div>';
    h += '<div class="sp-body">';

    // 图片上传区
    h += '<div class="sp-section"><div class="sp-label">截图上传 <span class="sp-hint">至少 1 张 · PNG/JPG · 单张 ≤ 5MB</span></div>';
    h += '<div class="sp-upload-grid">';
    ['A', 'B', 'C', 'D'].forEach(function (slot) {
      var info = SLOT_INFO[slot];
      var f    = state.files[slot];
      h += '<div class="sp-uz' + (f ? ' has-file' : '') + '" id="spUz' + slot + '" data-slot="' + slot + '">';
      if (f) {
        h += '<img class="sp-uz-img" src="' + f.url + '" />';
        h += '<div class="sp-uz-fname">' + esc(f.name) + '</div>';
        h += '<button class="sp-uz-del" data-slot="' + slot + '">✕ 移除</button>';
      } else {
        h += '<div class="sp-uz-plus">＋</div>';
        h += '<div class="sp-uz-label">' + info.label + '</div>';
        h += '<div class="sp-uz-hint">' + info.hint + '</div>';
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
      var nameInput = panelEl.querySelector('#spName');
      if (nameInput) {
        nameInput.addEventListener('input', function () {
          state.skinName = nameInput.value;
          var codeEl = panelEl.querySelector('.sp-code-val');
          if (codeEl) codeEl.textContent = buildCodeHint();
        });
      }
      var nextBtn = panelEl.querySelector('#spNext');
      if (nextBtn) {
        nextBtn.addEventListener('click', function () {
          if (!state.weapon)            { toast('请先选择武器'); return; }
          if (!state.skinName.trim())   { toast('请填写皮肤名称'); return; }
          if (!state.quality)           { toast('请选择稀有度'); return; }
          if (!state.material)          { toast('请选择材质'); return; }
          render(2);
        });
      }
    } else {
      var backBtn = panelEl.querySelector('#spBack');
      if (backBtn) backBtn.addEventListener('click', function () { render(1); });

      var authChk   = panelEl.querySelector('#spAuth');
      var submitBtn = panelEl.querySelector('#spSubmit');
      if (authChk && submitBtn) {
        authChk.addEventListener('change', function () {
          submitBtn.disabled = !authChk.checked;
        });
      }

      ['A', 'B', 'C', 'D'].forEach(function (slot) {
        var zone  = panelEl.querySelector('#spUz' + slot);
        var input = panelEl.querySelector('#spUzIn' + slot);
        if (!zone || !input) return;

        zone.addEventListener('click', function (e) {
          if (e.target.classList.contains('sp-uz-del')) return;
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
            render(2);
          });
        }
      });

      if (submitBtn) submitBtn.addEventListener('click', doSubmit);
    }
  }

  function handleFile(slot, file) {
    if (!file.type.match(/^image\/(png|jpe?g)$/i)) { toast('仅支持 PNG / JPG 格式'); return; }
    if (file.size > 5 * 1024 * 1024)               { toast('图片超过 5MB 限制'); return; }
    if (state.files[slot] && state.files[slot].url) URL.revokeObjectURL(state.files[slot].url);
    state.files[slot] = { file: file, name: file.name, url: URL.createObjectURL(file) };
    render(2);
  }

  // ── 提交 ────────────────────────────────────────────────
  function doSubmit() {
    var hasAny = Object.values(state.files).some(function (f) { return f !== null; });
    if (!hasAny) { toast('至少上传一张图片'); return; }

    var submitBtn = panelEl.querySelector('#spSubmit');
    var contributor = (panelEl.querySelector('#spContrib') || {}).value || '';
    var notes       = (panelEl.querySelector('#spNotes') || {}).value || '';

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '提交中…'; }

    var payload = {
      weapon: state.weapon,
      skinName: state.skinName.trim(),
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
        ['A', 'B', 'C', 'D'].forEach(function (slot) {
          if (!state.files[slot]) return;
          chain = chain.then(function () {
            var f = state.files[slot].file;
            var ext = inferExt(f);
            var key = sts.keyPrefix + slot + ext;
            return client.multipartUpload(key, f, {
              timeout: 120000,
              mime: f.type || 'image/png'
            }).then(function (ret) {
              var etag = '';
              if (ret && ret.res && ret.res.headers && ret.res.headers.etag) etag = String(ret.res.headers.etag).replace(/"/g, '');
              uploads[slot] = { key: key, etag: etag, contentType: f.type || '' };
            });
          });
        });
        return chain.then(function () {
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
