/**
 * 砖皮百科 · 玩家共享图上传面板
 * window.Supplement.open(skinId, weapon, folderCode, skinName) 打开面板
 */
(function (global) {
  'use strict';

  var API_BASE = (
    location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      ? 'http://localhost:5200/api'
      : '/api'
  );

  var MAX_FILE_BYTES = 20 * 1024 * 1024;

  var state   = mkState();
  var panelEl = null;

  global.Supplement = { open: openPanel };

  function mkState() {
    return { skinId: '', skinName: '', weapon: '', folderCode: '', file: null };
  }

  function openPanel(skinId, weapon, folderCode, skinName) {
    if (state.file && state.file.url) URL.revokeObjectURL(state.file.url);
    state = { skinId: skinId, skinName: skinName || skinId, weapon: weapon, folderCode: folderCode, file: null };
    if (!panelEl) {
      panelEl = document.getElementById('supplementPanel');
      if (panelEl) {
        panelEl.addEventListener('click', function (e) {
          if (e.target === panelEl) closePanel();
        });
      }
    }
    render();
    if (panelEl) panelEl.classList.remove('hidden');
  }

  function closePanel() {
    if (state.file && state.file.url) URL.revokeObjectURL(state.file.url);
    if (panelEl) panelEl.classList.add('hidden');
  }

  // ── 工具 ────────────────────────────────────────────────
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
           .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
    if (res && res.status === 413) msg = '图片过大，请压缩后重试（单图≤20MB）';
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
      s.onload = function () { global.OSS ? resolve(global.OSS) : reject(new Error('OSS SDK 加载失败')); };
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

  // ── 渲染 ────────────────────────────────────────────────
  function render() {
    if (!panelEl) return;
    var f = state.file;
    var h = '<div class="sp-inner"><div class="sp-head">';
    h += '<span class="sp-title">上传补充图</span>';
    h += '<button class="sp-close" id="suppClose">×</button></div>';
    h += '<div class="sp-body">';

    // 皮肤信息
    h += '<div class="sp-section">';
    h += '<div class="sp-label">为以下皮肤上传补充图</div>';
    h += '<div class="sp-supp-skin-info">';
    h += '<span class="sp-supp-name">' + esc(state.skinName) + '</span>';
    h += ' <span class="sp-supp-id">' + esc(state.skinId) + '</span>';
    h += '</div>';
    h += '<div class="sp-supp-tip">任意角度均可（室内/室外/特写/市场图等），审核通过后显示在皮肤详情页补充图区</div>';
    h += '</div>';

    // 上传区
    h += '<div class="sp-section">';
    h += '<div class="sp-label">上传图片 <span class="sp-hint">PNG/JPG · 单张 ≤ 20MB</span></div>';
    h += '<div class="sp-uz' + (f ? ' has-file' : '') + '" id="suppUz">';
    if (f) {
      h += '<img class="sp-uz-img" src="' + f.url + '" />';
      h += '<div class="sp-uz-fname">' + esc(f.name) + '</div>';
      h += '<button class="sp-uz-del" id="suppDel">✕ 移除</button>';
    } else {
      h += '<div class="sp-uz-plus">＋</div>';
      h += '<div class="sp-uz-label">点击或拖拽上传</div>';
      h += '<div class="sp-uz-hint">推荐上传游戏内截图</div>';
    }
    h += '<input class="sp-uz-input" id="suppUzIn" type="file" accept="image/png,image/jpeg" />';
    h += '</div></div>';

    // 昵称 + 备注
    h += '<div class="sp-row">';
    h += '<div class="sp-section sp-half"><div class="sp-label">昵称 <span class="sp-hint">可匿名</span></div>';
    h += '<input class="sp-input" id="suppContrib" maxlength="20" placeholder="匿名" /></div>';
    h += '<div class="sp-section sp-half"><div class="sp-label">备注 <span class="sp-hint">可选</span></div>';
    h += '<input class="sp-input" id="suppNotes" maxlength="200" placeholder="例：室外近景截图…" /></div>';
    h += '</div>';

    // 授权
    h += '<label class="sp-auth"><input type="checkbox" id="suppAuth" />';
    h += ' 我确认图片为本人游戏内截图，授权用于本非盈利图鉴展示</label>';

    h += '<div class="sp-footer">';
    h += '<button class="sp-btn-primary" id="suppSubmit" disabled>提交补充图</button>';
    h += '</div>';
    h += '</div></div>';

    panelEl.innerHTML = h;
    bindEvents();
  }

  // ── 事件绑定 ────────────────────────────────────────────
  function bindEvents() {
    if (!panelEl) return;

    var closeBtn = panelEl.querySelector('#suppClose');
    if (closeBtn) closeBtn.addEventListener('click', closePanel);

    var authChk   = panelEl.querySelector('#suppAuth');
    var submitBtn = panelEl.querySelector('#suppSubmit');
    if (authChk && submitBtn) {
      authChk.addEventListener('change', function () {
        submitBtn.disabled = !(authChk.checked && state.file);
      });
    }

    var zone  = panelEl.querySelector('#suppUz');
    var input = panelEl.querySelector('#suppUzIn');
    if (zone && input) {
      zone.addEventListener('click', function (e) {
        if (e.target.id === 'suppDel' || e.target.tagName === 'INPUT') return;
        input.click();
      });
      zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('drag-over'); });
      zone.addEventListener('dragleave', function () { zone.classList.remove('drag-over'); });
      zone.addEventListener('drop', function (e) {
        e.preventDefault(); zone.classList.remove('drag-over');
        if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
      });
      input.addEventListener('change', function () {
        if (input.files[0]) handleFile(input.files[0]);
      });
    }

    var delBtn = panelEl.querySelector('#suppDel');
    if (delBtn) {
      delBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (state.file && state.file.url) URL.revokeObjectURL(state.file.url);
        state.file = null;
        render();
      });
    }

    if (submitBtn) submitBtn.addEventListener('click', doSubmit);
  }

  function handleFile(file) {
    if (!file.type.match(/^image\/(png|jpe?g)$/i)) { toast('仅支持 PNG / JPG 格式'); return; }
    if (file.size > MAX_FILE_BYTES) { toast('图片超过 20MB 限制'); return; }
    if (state.file && state.file.url) URL.revokeObjectURL(state.file.url);
    state.file = { file: file, name: file.name, url: URL.createObjectURL(file) };
    render();
  }

  // ── 提交 ────────────────────────────────────────────────
  function doSubmit() {
    if (!state.file) { toast('请先上传一张图片'); return; }
    var submitBtn = panelEl.querySelector('#suppSubmit');
    var contributor = (panelEl.querySelector('#suppContrib') || {}).value || '';
    var notes       = (panelEl.querySelector('#suppNotes') || {}).value || '';

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '提交中…'; }

    var payload = {
      submissionType:   'supplement',
      weapon:           state.weapon,
      skinName:         state.skinName,
      quality:          '',
      material:         '',
      color1:           '',
      color2:           '',
      notes:            notes.trim(),
      contributor:      contributor.trim() || '匿名',
      targetSkinId:     state.skinId,
      targetFolderCode: state.folderCode,
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
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '提交补充图'; }
          return Promise.reject(new Error('create failed'));
        }
        return loadOssSdk().then(function () { return res.data; });
      })
      .then(function (createData) {
        var sts = createData.sts || {};
        if (!sts.accessKeyId || !sts.securityToken || !sts.keyPrefix) {
          toast('上传凭证无效，请稍后重试');
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '提交补充图'; }
          return Promise.reject(new Error('bad sts'));
        }
        var client = createOssClient(sts);
        var f      = state.file.file;
        var ext    = inferExt(f);
        var key    = sts.keyPrefix + 'A' + ext;

        return client.multipartUpload(key, f, {
          timeout: 120000,
          mime: f.type || 'image/png'
        }).then(function (ret) {
          var etag = '';
          if (ret && ret.res && ret.res.headers && ret.res.headers.etag) {
            etag = String(ret.res.headers.etag).replace(/"/g, '');
          }
          return fetch(API_BASE + '/submissions/commit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              submissionId: createData.id,
              uploads: { A: { key: key, etag: etag, contentType: f.type || '' } }
            })
          }).then(parseApiResponse).then(function (commitRes) {
            if (!commitRes.ok) {
              toast(formatApiError(commitRes, '提交失败，请重试'));
              if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '提交补充图'; }
              return;
            }
            showSuccess(createData.id, createData.queryToken || '');
          });
        });
      })
      .catch(function () {
        if (submitBtn && submitBtn.disabled) {
          toast('上传失败，请检查网络后重试');
        }
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '提交补充图'; }
      });
  }

  function showSuccess(id, queryToken) {
    if (!panelEl) return;
    var ticketHtml = queryToken
      ? ('<div class="sp-success-ticket">查询票据：<strong>' + esc(queryToken) + '</strong><br>请截图保存，可查询审核状态。</div>')
      : '';
    panelEl.innerHTML =
      '<div class="sp-inner sp-inner-success">' +
        '<div class="sp-success-icon">✓</div>' +
        '<div class="sp-success-title">补充图提交成功！</div>' +
        '<div class="sp-success-desc">编号 <strong>#' + id + '</strong>，审核通过后将在皮肤详情页补充图区展示。<br>感谢你的贡献！</div>' +
        ticketHtml +
        '<button class="sp-btn-primary" id="suppDone">关闭</button>' +
      '</div>';
    panelEl.querySelector('#suppDone').addEventListener('click', closePanel);
    panelEl.addEventListener('click', function (e) {
      if (e.target === panelEl) closePanel();
    });
  }

  // ── Toast ────────────────────────────────────────────────
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

}(window));
