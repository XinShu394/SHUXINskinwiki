/**
 * 砖皮百科 · 评论系统
 * 后端：自建 Flask API（server/app.py）
 *
 * 本地开发：API 在 http://localhost:5200/api
 * 生产环境：API 通过 Nginx 代理到 /api（同域，无跨域问题）
 */
(function (global) {

  // 本地 localhost 时直连 Flask；上线后走相对路径（Nginx 反代）
  var API_BASE = (
    location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      ? 'http://localhost:5200/api'
      : '/api'
  );

  var currentSkinId = null;
  var currentSort   = 'new';
  var allComments   = [];

  // 避免重复点赞（本地存储记录已点过的评论 ID）
  var LIKED_KEY = 'zpbk_liked';
  function getLiked()  { try { return JSON.parse(localStorage.getItem(LIKED_KEY) || '{}'); } catch { return {}; } }
  function setLiked(id){ var m = getLiked(); m[id] = 1; try { localStorage.setItem(LIKED_KEY, JSON.stringify(m)); } catch {} }
  function hasLiked(id){ return !!getLiked()[id]; }

  // ── Public API ───────────────────────────────────────────
  global.Comments = { load: load };

  function load(skinId) {
    currentSkinId = skinId;
    currentSort   = 'new';
    allComments   = [];
    buildShell();
    fetchComments();
  }

  // ── 构建评论区骨架 ───────────────────────────────────────
  function buildShell() {
    var sec = document.getElementById('commentSection');
    if (!sec) return;
    sec.innerHTML =
      '<div class="cm-bar">' +
        '<span class="cm-title-lbl">讨论看板</span>' +
        '<span class="cm-count-lbl" id="cmCount"></span>' +
        '<span class="cm-sort-wrap">' +
          '<span class="cm-sort-btn' + (currentSort==='hot'?' active':'') + '" data-sort="hot">最热</span>' +
          '<span class="cm-divider">|</span>' +
          '<span class="cm-sort-btn' + (currentSort==='new'?' active':'') + '" data-sort="new">最新</span>' +
        '</span>' +
      '</div>' +

      '<div class="cm-input-wrap">' +
        '<input id="cmNick" type="text" maxlength="20" placeholder="昵称（可匿名）" autocomplete="off" />' +
        '<textarea id="cmText" maxlength="500" placeholder="写点想法…（Ctrl+Enter 发送）" rows="3"></textarea>' +
        '<button id="cmSubmit" class="cm-submit-btn">发布</button>' +
      '</div>' +

      '<div id="cmList" class="cm-list"><div class="cm-loading">加载中…</div></div>';

    // 排序切换
    sec.querySelectorAll('.cm-sort-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        currentSort = btn.dataset.sort;
        sec.querySelectorAll('.cm-sort-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        renderList();
      });
    });

    // 发布按钮
    document.getElementById('cmSubmit').addEventListener('click', submitComment);

    // Ctrl+Enter 快捷键发布
    document.getElementById('cmText').addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitComment();
    });
  }

  // ── 拉取评论 ─────────────────────────────────────────────
  function fetchComments() {
    fetch(API_BASE + '/comments?skinId=' + encodeURIComponent(currentSkinId))
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) {
        allComments = data.results || [];
        renderList();
      })
      .catch(function(e) {
        var list = document.getElementById('cmList');
        if (list) list.innerHTML = '<div class="cm-error">评论加载失败，请稍后再试<br><small>' + escHtml(e.message) + '</small></div>';
      });
  }

  // ── 渲染列表 ─────────────────────────────────────────────
  function renderList() {
    var list    = document.getElementById('cmList');
    var countEl = document.getElementById('cmCount');
    if (!list) return;

    if (countEl) countEl.textContent = '评论 ' + allComments.length;

    if (allComments.length === 0) {
      list.innerHTML = '<div class="cm-empty">暂无评论，快来第一个发言！</div>';
      return;
    }

    var sorted = allComments.slice().sort(function(a, b) {
      if (currentSort === 'hot') return (b.likes || 0) - (a.likes || 0);
      return b.createdAt - a.createdAt;   // 毫秒时间戳，直接比较
    });

    list.innerHTML = sorted.map(buildItem).join('');

    list.querySelectorAll('.cm-like-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { likeComment(Number(btn.dataset.id)); });
    });
  }

  // ── 单条评论 HTML ────────────────────────────────────────
  function buildItem(c) {
    var nick    = c.nickname ? escHtml(c.nickname) : '匿名';
    var content = escHtml(c.content || '');
    var time    = fmtTime(c.createdAt);
    var likes   = c.likes || 0;
    var initial = (nick[0] || '匿').toUpperCase();
    var liked   = hasLiked(c.id);
    var filled  = liked ? 'currentColor' : 'none';

    return (
      '<div class="cm-item">' +
        '<div class="cm-avatar" style="background:' + avatarColor(nick) + '">' + initial + '</div>' +
        '<div class="cm-body">' +
          '<div class="cm-meta-row">' +
            '<span class="cm-nick">' + nick + '</span>' +
            '<span class="cm-time">' + time + '</span>' +
          '</div>' +
          '<div class="cm-content">' + content + '</div>' +
          '<div class="cm-actions">' +
            '<button class="cm-like-btn' + (liked ? ' liked' : '') + '" data-id="' + c.id + '">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="' + filled + '" stroke="currentColor" stroke-width="2">' +
                '<path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/>' +
                '<path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>' +
              '</svg>' +
              ' ' + likes +
            '</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  // ── 发布评论 ─────────────────────────────────────────────
  function submitComment() {
    var nickEl = document.getElementById('cmNick');
    var textEl = document.getElementById('cmText');
    var btn    = document.getElementById('cmSubmit');
    if (!nickEl || !textEl || !btn) return;

    var nick    = (nickEl.value.trim() || '匿名').slice(0, 20);
    var content = textEl.value.trim();
    if (!content) { showTip(textEl, '请输入评论内容'); return; }

    btn.disabled    = true;
    btn.textContent = '发布中…';

    fetch(API_BASE + '/comments', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ skinId: currentSkinId, nickname: nick, content: content }),
    })
      .then(function(r) {
        if (r.status === 429) throw new Error('发送太频繁，请稍后再试');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(res) {
        textEl.value = '';
        // 乐观插入，立即显示无需刷新
        allComments.unshift({
          id:        res.id,
          skinId:    currentSkinId,
          nickname:  nick,
          content:   content,
          likes:     0,
          createdAt: res.createdAt,
        });
        // 切换到最新排序以显示刚发的评论
        currentSort = 'new';
        var sec = document.getElementById('commentSection');
        if (sec) {
          sec.querySelectorAll('.cm-sort-btn').forEach(function(b) { b.classList.remove('active'); });
          var nb = sec.querySelector('[data-sort="new"]');
          if (nb) nb.classList.add('active');
        }
        renderList();
      })
      .catch(function(e) {
        alert('发布失败：' + e.message);
      })
      .finally(function() {
        btn.disabled    = false;
        btn.textContent = '发布';
      });
  }

  // ── 点赞 ─────────────────────────────────────────────────
  function likeComment(id) {
    if (hasLiked(id)) return;
    setLiked(id);

    // 乐观更新 UI
    var c = allComments.find(function(x) { return x.id === id; });
    if (c) { c.likes = (c.likes || 0) + 1; renderList(); }

    fetch(API_BASE + '/comments/' + id + '/like', { method: 'PUT' })
      .catch(function() {
        // 网络失败时回滚
        if (c) { c.likes = Math.max(0, (c.likes || 1) - 1); renderList(); }
      });
  }

  // ── 工具函数 ─────────────────────────────────────────────
  function fmtTime(ms) {
    if (!ms) return '';
    var d    = new Date(ms);
    var now  = Date.now();
    var diff = now - ms;
    if (diff < 60000)      return '刚刚';
    if (diff < 3600000)    return Math.floor(diff / 60000) + '分钟前';
    if (diff < 86400000)   return Math.floor(diff / 3600000) + '小时前';
    if (diff < 2592000000) return Math.floor(diff / 86400000) + '天前';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  var COLORS = ['#3d6e9a', '#4a8a6e', '#8a4a6e', '#6a5a9a', '#9a7a3d', '#3d9a8a'];
  function avatarColor(nick) {
    var h = 0;
    for (var i = 0; i < nick.length; i++) h = (h * 31 + nick.charCodeAt(i)) & 0xffff;
    return COLORS[h % COLORS.length];
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;')
      .replace(/\n/g, '<br>');
  }

  function showTip(el, msg) {
    el.placeholder = msg;
    el.classList.add('cm-shake');
    setTimeout(function() {
      el.placeholder = '写点想法…（Ctrl+Enter 发送）';
      el.classList.remove('cm-shake');
    }, 1500);
  }

})(window);
