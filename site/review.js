/**
 * 砖皮百科 · 审核面板
 * window.Review.open() 打开面板
 */
(function (global) {
  'use strict';

  var API_BASE = (
    location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      ? 'http://localhost:5200/api'
      : '/api'
  );

  var QUALITY_CODES  = { '优品': 'U', '极品': 'J' };
  var MATERIAL_CODES = { '贵金属': 'G', '透光': 'T', '镭射': 'L', '漆面': 'M', '木质': 'Z', '其他': 'Q' };
  var COLOR_CODES    = {
    '白': '01', '红': '02', '黄': '03', '青': '04', '紫': '05', '棕': '06',
    '黑': '07', '灰': '08', '橙': '09', '绿': '10', '蓝': '11', '粉': '12', '炫彩': '1111'
  };
  var TEMPLATE_WEAPONS = ['AUG', 'SCARH', 'Vector', 'M4A1', 'KC17'];
  var SESSION_KEY = 'zpbk_review_token';

  var panelEl = null;
  var token   = '';
  var blobUrls = [];   // 所有已创建的 blob URL，关闭时统一 revoke

  global.Review = { open: openPanel };

  // ── 入口 ────────────────────────────────────────────────
  function openPanel() {
    if (!panelEl) {
      panelEl = document.getElementById('reviewPanel');
      if (panelEl) {
        panelEl.addEventListener('click', function (e) {
          if (e.target === panelEl) closePanel();
        });
      }
    }
    token = sessionStorage.getItem(SESSION_KEY) || '';
    if (token) showList(); else showLogin();
    if (panelEl) panelEl.classList.remove('hidden');
  }

  function closePanel() {
    if (panelEl) panelEl.classList.add('hidden');
    blobUrls.forEach(function (u) { URL.revokeObjectURL(u); });
    blobUrls = [];
  }

  // ── 工具 ────────────────────────────────────────────────
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
           .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function authHeaders() { return { 'Authorization': 'Bearer ' + token }; }

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
      msg = '请求体过大，请缩小图片体积后重试';
    }
    if (res && res.requestId) msg += '（请求ID:' + res.requestId + '）';
    return msg;
  }

  function suggestFolder(sub) {
    var q = QUALITY_CODES[sub.quality] || '';
    var m = MATERIAL_CODES[sub.material] || '';
    if (!q || !m) return '';
    if (TEMPLATE_WEAPONS.indexOf(sub.weapon) !== -1) return q + m + (sub.skinName || '');
    if (!sub.color1) return q + m + '????';
    if (sub.color1 === '炫彩') return q + m + '1111';
    var c1 = COLOR_CODES[sub.color1] || '??';
    var c2 = (sub.color2 && sub.color2 !== '单色' && COLOR_CODES[sub.color2]) ? COLOR_CODES[sub.color2] : '00';
    return q + m + c1 + c2;
  }

  // ── 登录界面 ─────────────────────────────────────────────
  function showLogin() {
    if (!panelEl) return;
    panelEl.innerHTML =
      '<div class="rp-inner rp-inner-login">' +
        '<div class="rp-head">' +
          '<span class="rp-title">审核通道</span>' +
          '<button class="rp-close" id="rpClose">×</button>' +
        '</div>' +
        '<div class="rp-login-body">' +
          '<div class="rp-login-icon">🔑</div>' +
          '<div class="rp-login-desc">输入审核密钥进入待审列表</div>' +
          '<input class="rp-token-input" id="rpToken" type="password" placeholder="审核密钥" autocomplete="off" />' +
          '<div class="rp-login-err hidden" id="rpErr">密钥错误，请重试</div>' +
          '<button class="rp-login-btn" id="rpLoginBtn">进入审核</button>' +
        '</div>' +
      '</div>';

    panelEl.querySelector('#rpClose').addEventListener('click', closePanel);

    var input   = panelEl.querySelector('#rpToken');
    var btn     = panelEl.querySelector('#rpLoginBtn');
    var errEl   = panelEl.querySelector('#rpErr');

    function doLogin() {
      var t = (input ? input.value : '').trim();
      if (!t) return;
      btn.disabled = true; btn.textContent = '验证中…';
      fetch(API_BASE + '/submissions?status=pending_review', {
        headers: { 'Authorization': 'Bearer ' + t }
      })
        .then(parseApiResponse)
        .then(function (res) {
          if (res.status === 401) {
            errEl.classList.remove('hidden');
            btn.disabled = false; btn.textContent = '进入审核';
            return null;
          }
          if (!res.ok) {
            errEl.classList.remove('hidden');
            errEl.textContent = formatApiError(res, '验证失败，请重试');
            btn.disabled = false; btn.textContent = '进入审核';
            return null;
          }
          token = t;
          sessionStorage.setItem(SESSION_KEY, t);
          showList(res.data.results);
        })
        .catch(function () {
          errEl.classList.remove('hidden');
          errEl.textContent = '网络连接失败，请重试（请检查 /api 是否可用）';
          btn.disabled = false; btn.textContent = '进入审核';
        });
    }

    btn.addEventListener('click', doLogin);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  }

  // ── 待审列表 ─────────────────────────────────────────────
  function showList(preloaded) {
    if (!panelEl) return;
    panelEl.innerHTML =
      '<div class="rp-inner">' +
        '<div class="rp-head">' +
          '<span class="rp-title" id="rpTitle">待审投稿</span>' +
          '<div class="rp-head-right">' +
            '<button class="rp-head-btn" id="rpRefresh">刷新</button>' +
            '<button class="rp-head-btn rp-logout" id="rpLogout">退出</button>' +
            '<button class="rp-close" id="rpClose">×</button>' +
          '</div>' +
        '</div>' +
        '<div class="rp-body" id="rpBody"><div class="rp-loading">加载中…</div></div>' +
      '</div>';

    panelEl.querySelector('#rpClose').addEventListener('click', closePanel);
    panelEl.querySelector('#rpRefresh').addEventListener('click', loadList);
    panelEl.querySelector('#rpLogout').addEventListener('click', function () {
      sessionStorage.removeItem(SESSION_KEY);
      token = '';
      showLogin();
    });

    if (preloaded) renderList(preloaded); else loadList();
  }

  function loadList() {
    var body = panelEl && panelEl.querySelector('#rpBody');
    if (body) body.innerHTML = '<div class="rp-loading">加载中…</div>';
    fetch(API_BASE + '/submissions?status=pending_review', { headers: authHeaders() })
      .then(parseApiResponse)
      .then(function (res) {
        if (res.status === 401) { sessionStorage.removeItem(SESSION_KEY); showLogin(); return; }
        if (!res.ok) {
          if (body) body.innerHTML = '<div class="rp-empty">' + esc(formatApiError(res, '加载失败，请重试')) + '</div>';
          return;
        }
        renderList(res.data.results);
      })
      .catch(function () {
        if (body) body.innerHTML = '<div class="rp-empty">网络连接失败，请重试（请检查 /api 是否可用）</div>';
      });
  }

  function renderList(results) {
    var body  = panelEl && panelEl.querySelector('#rpBody');
    var title = panelEl && panelEl.querySelector('#rpTitle');
    if (!body) return;

    var n = results ? results.length : 0;
    if (title) title.textContent = '待审投稿（' + n + '）';

    if (!n) {
      body.innerHTML = '<div class="rp-empty">暂无待审投稿，可以休息一下 ☕</div>';
      return;
    }

    body.innerHTML = results.map(function (sub) {
      var isSupp   = sub.submissionType === 'supplement';
      var suggested = isSupp ? '' : suggestFolder(sub);
      var dt = sub.createdAt ? new Date(sub.createdAt).toLocaleString('zh-CN') : '';
      var colorTag = sub.color1 ? (sub.color1 + (sub.color2 && sub.color2 !== '单色' ? '+' + sub.color2 : '')) : '';

      return '<div class="rp-card' + (isSupp ? ' rp-card-supp' : '') + '" id="rpCard' + sub.id + '">' +

        // 缩略图行（补充图只有 A）
        '<div class="rp-thumbs">' +
          (isSupp
            ? ('<div class="rp-thumb">' +
                '<span class="rp-thumb-label">共享图</span>' +
                '<img class="rp-thumb-img" id="rpImg' + sub.id + 'A" src="" />' +
              '</div>')
            : ['A','B','C','D'].map(function (slot) {
                var has = sub['has' + slot];
                return '<div class="rp-thumb' + (has ? '' : ' rp-thumb-empty') + '">' +
                  '<span class="rp-thumb-label">' + slot + '</span>' +
                  (has ? '<img class="rp-thumb-img" id="rpImg' + sub.id + slot + '" src="" />' : '') +
                '</div>';
              }).join('') +
              ['S1','S2','S3'].filter(function (s) { return sub['has' + s]; }).map(function (slot) {
                return '<div class="rp-thumb rp-thumb-supp">' +
                  '<span class="rp-thumb-label rp-thumb-label-supp">补充图</span>' +
                  '<img class="rp-thumb-img" id="rpImg' + sub.id + slot + '" src="" />' +
                '</div>';
              }).join('')
          ) +
        '</div>' +

        // 元信息
        '<div class="rp-meta">' +
          '<div class="rp-meta-title">' +
            (isSupp
              ? ('<span class="rp-supp-badge">玩家共享图</span> 为 <strong>' + esc(sub.supplementSkinId || sub.skinName) + '</strong> 补充')
              : (esc(sub.weapon) + ' · ' + esc(sub.skinName))
            ) +
          '</div>' +
          (isSupp ? '' :
            '<div class="rp-meta-tags">' +
              (sub.quality  ? '<span class="rp-tag">' + esc(sub.quality)  + '</span>' : '') +
              (sub.material ? '<span class="rp-tag">' + esc(sub.material) + '</span>' : '') +
              (colorTag     ? '<span class="rp-tag">' + esc(colorTag)     + '</span>' : '') +
            '</div>'
          ) +
          (sub.notes ? '<div class="rp-meta-notes">"' + esc(sub.notes) + '"</div>' : '') +
          '<div class="rp-meta-contrib">投稿人：' + esc(sub.contributor) + '　' + esc(dt) + '</div>' +
        '</div>' +

        // 目录名输入（补充图不需要）
        (isSupp ? '' :
          '<div class="rp-folder-row">' +
            '<span class="rp-folder-lbl">目录名</span>' +
            '<input class="rp-folder-input" id="rpFolder' + sub.id + '" value="' + esc(suggested) + '" placeholder="如 UG0100 或 七彩雷" />' +
            '<span class="rp-folder-tip">审核通过后在此目录存放图片</span>' +
          '</div>'
        ) +

        // 操作按钮
        '<div class="rp-actions" id="rpActions' + sub.id + '">' +
          '<button class="rp-btn-approve" data-id="' + sub.id + '" data-supp="' + (isSupp ? '1' : '0') + '">✓ 通过发布</button>' +
          '<button class="rp-btn-reject"  data-id="' + sub.id + '">✕ 拒绝</button>' +
        '</div>' +

      '</div>';
    }).join('');

    // 懒加载缩略图
    results.forEach(function (sub) {
      ['A','B','C','D'].forEach(function (slot) {
        if (!sub['has' + slot]) return;
        var imgEl = body.querySelector('#rpImg' + sub.id + slot);
        if (!imgEl) return;
        fetch(API_BASE + '/uploads/' + sub.id + '/' + slot, { headers: authHeaders() })
          .then(function (r) {
            var ct = (r.headers.get('content-type') || '').toLowerCase();
            if (!r.ok) return null;
            if (ct.indexOf('application/json') !== -1) {
              return r.json().then(function (d) { return d && d.url ? { mode: 'url', val: d.url } : null; });
            }
            return r.blob().then(function (blob) { return { mode: 'blob', val: blob }; });
          })
          .then(function (ret) {
            if (!ret) return;
            if (ret.mode === 'url') {
              if (imgEl) imgEl.src = ret.val;
              return;
            }
            var u = URL.createObjectURL(ret.val);
            blobUrls.push(u);
            if (imgEl) imgEl.src = u;
          })
          .catch(function () {});
      });
      // 懒加载投稿时附带的补充图 S1/S2/S3
      ['S1','S2','S3'].forEach(function (slot) {
        if (!sub['has' + slot]) return;
        var imgEl = body.querySelector('#rpImg' + sub.id + slot);
        if (!imgEl) return;
        fetch(API_BASE + '/uploads/' + sub.id + '/' + slot, { headers: authHeaders() })
          .then(function (r) {
            if (!r.ok) return null;
            var ct = (r.headers.get('content-type') || '').toLowerCase();
            if (ct.indexOf('application/json') !== -1) {
              return r.json().then(function (d) { return d && d.url ? { mode: 'url', val: d.url } : null; });
            }
            return r.blob().then(function (blob) { return { mode: 'blob', val: blob }; });
          })
          .then(function (ret) {
            if (!ret) return;
            if (ret.mode === 'url') { if (imgEl) imgEl.src = ret.val; return; }
            var u = URL.createObjectURL(ret.val);
            blobUrls.push(u);
            if (imgEl) imgEl.src = u;
          })
          .catch(function () {});
      });
    });

    // 绑定通过/拒绝按钮
    body.querySelectorAll('.rp-btn-approve').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id    = parseInt(btn.dataset.id);
        var isSupp = btn.dataset.supp === '1';
        if (isSupp) {
          doApprove(id, '', btn);
          return;
        }
        var fi = body.querySelector('#rpFolder' + id);
        var fc = fi ? fi.value.trim() : '';
        if (!fc) { alert('请先填写目录名（如 UG0100）'); return; }
        doApprove(id, fc, btn);
      });
    });

    body.querySelectorAll('.rp-btn-reject').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showRejectForm(parseInt(btn.dataset.id), btn);
      });
    });
  }

  // ── 通过 ────────────────────────────────────────────────
  function doApprove(id, folderCode, btn) {
    btn.disabled = true; btn.textContent = '处理中…';
    fetch(API_BASE + '/submissions/' + id + '/approve', {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify({ folderCode: folderCode })
    })
      .then(parseApiResponse)
      .then(function (res) {
        var d = res.data || {};
        if (!res.ok || !d.ok) {
          btn.disabled = false; btn.textContent = '✓ 通过发布';
          alert(formatApiError(res, d.error || '操作失败，请重试')); return;
        }
        replaceCard(id,
          '<div class="rp-done rp-done-ok">' +
            '<span class="rp-done-icon">✓</span>' +
            '<span>已通过发布</span>' +
            (d.buildQueued ? '<span class="rp-done-note">构建任务已入队，后台处理中</span>' : '') +
          '</div>'
        );
        decCount();
      })
      .catch(function () {
        btn.disabled = false; btn.textContent = '✓ 通过发布';
        alert('网络连接失败，请重试（请检查 /api 是否可用）');
      });
  }

  // ── 拒绝 ────────────────────────────────────────────────
  function showRejectForm(id, btn) {
    var actionsEl = document.getElementById('rpActions' + id);
    if (!actionsEl) return;
    if (actionsEl.querySelector('.rp-reject-form')) {
      actionsEl.querySelector('.rp-reject-form').remove(); return;
    }
    var form = document.createElement('div');
    form.className = 'rp-reject-form';
    form.innerHTML =
      '<input class="rp-reject-input" placeholder="拒绝原因（可留空）" maxlength="200" />' +
      '<button class="rp-reject-confirm">确认拒绝</button>' +
      '<button class="rp-reject-cancel">取消</button>';
    actionsEl.appendChild(form);

    form.querySelector('.rp-reject-cancel').addEventListener('click', function () { form.remove(); });
    form.querySelector('.rp-reject-confirm').addEventListener('click', function () {
      var note = form.querySelector('.rp-reject-input').value.trim();
      doReject(id, note, btn, form);
    });
  }

  function doReject(id, note, btn, form) {
    if (btn) btn.disabled = true;
    fetch(API_BASE + '/submissions/' + id + '/reject', {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify({ note: note })
    })
      .then(parseApiResponse)
      .then(function (res) {
        var d = res.data || {};
        if (!res.ok || !d.ok) {
          if (btn) btn.disabled = false;
          alert(formatApiError(res, d.error || '操作失败')); return;
        }
        replaceCard(id,
          '<div class="rp-done rp-done-no">' +
            '<span class="rp-done-icon">✕</span>' +
            '<span>已拒绝</span>' +
            (note ? '<span class="rp-done-note">原因：' + esc(note) + '</span>' : '') +
          '</div>'
        );
        decCount();
      })
      .catch(function () {
        if (btn) btn.disabled = false;
        alert('网络连接失败，请重试（请检查 /api 是否可用）');
      });
  }

  // ── 辅助 ────────────────────────────────────────────────
  function replaceCard(id, html) {
    var card = document.getElementById('rpCard' + id);
    if (card) card.innerHTML = html;
  }

  function decCount() {
    var titleEl = panelEl && panelEl.querySelector('#rpTitle');
    if (!titleEl) return;
    var m = titleEl.textContent.match(/\d+/);
    if (m) titleEl.textContent = '待审投稿（' + Math.max(0, parseInt(m[0]) - 1) + '）';
  }

  // ── 绑定入口按钮 ─────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('reviewBtn');
    if (btn) btn.addEventListener('click', openPanel);
  });

}(window));
