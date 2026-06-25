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
  var COLOR_OPTS    = ['白', '红', '黄', '青', '紫', '棕', '黑', '灰', '橙', '绿', '蓝', '粉', '炫彩'];

  var QUALITY_CODES = { '优品': 'U', '极品': 'J' };
  var COLOR_CODES   = {
    '白': '01', '红': '02', '黄': '03', '青': '04', '紫': '05', '棕': '06',
    '黑': '07', '灰': '08', '橙': '09', '绿': '10', '蓝': '11', '粉': '12', '炫彩': '1111'
  };

  // KC17 专属材质选项与编码（支持双材质，保持不变）
  var KC17_MATERIAL_OPTS  = ['结构光', '镭射贵金属', '贵金属', '镭射', '其他'];
  var KC17_MATERIAL_CODES = { '结构光': 'J', '镭射贵金属': 'LG', '贵金属': 'G', '镭射': 'L', '其他': 'Q' };
  var KC17_DUAL_ELIGIBLE  = ['结构光', '贵金属', '镭射'];

  // 每把武器的独立配置
  // materialOpts: 可选材质列表（空数组 = 该武器无材质选项）
  // materialCodes: 材质 → 编码映射
  // dualEligible: 可叠加第二材质的主材质列表（空 = 不支持双材质）
  // showColor: 是否显示颜色选择
  // genCode: 是否生成目录编码预览（模板武器用皮肤名命名，显示"—"）
  var WEAPON_CONFIG = {
    'ASVAL': {
      materialOpts:  ['贵金属', '玉石', '镭射', '漆面', '木质', '其他'],
      materialCodes: { '贵金属': 'G', '玉石': 'Y', '镭射': 'L', '漆面': 'M', '木质': 'Z', '其他': 'Q' },
      dualEligible:  ['贵金属', '玉石', '镭射'],
      showColor: true, genCode: true
    },
    'K416': {
      materialOpts:  ['贵金属', '透光', '其他'],
      materialCodes: { '贵金属': 'G', '透光': 'T', '其他': 'Q' },
      dualEligible:  ['贵金属', '透光'],
      showColor: true, genCode: true
    },
    'AKM': {
      materialOpts:  ['星河光', '镭射贵金属', '贵金属', '大理石', '镭射大理石', '镭射', '其他'],
      materialCodes: { '星河光': 'X', '镭射贵金属': 'LG', '贵金属': 'G', '大理石': 'R', '镭射大理石': 'LR', '镭射': 'L', '其他': 'Q' },
      dualEligible:  ['星河光', '贵金属', '大理石', '镭射'],
      showColor: true, genCode: true
    },
    'QBZ95': {
      materialOpts:  ['贵金属', '其他'],
      materialCodes: { '贵金属': 'G', '其他': 'Q' },
      dualEligible:  [],
      showColor: true, genCode: true
    },
    '腾龙': {
      materialOpts:  ['贵金属', '镭射', '镭射贵金属', '其他'],
      materialCodes: { '贵金属': 'G', '镭射': 'L', '镭射贵金属': 'LG', '其他': 'Q' },
      dualEligible:  ['贵金属', '镭射'],
      showColor: true, genCode: true
    },
    'AUG': {
      materialOpts:  ['贵金属', '镭射', '其他'],
      materialCodes: { '贵金属': 'G', '镭射': 'L', '其他': 'Q' },
      dualEligible:  ['贵金属', '镭射'],
      showColor: true, genCode: false
    },
    'M4A1': {
      materialOpts:  [],
      materialCodes: {},
      dualEligible:  [],
      showColor: false, genCode: false
    },
    'M7': {
      materialOpts:  ['贵金属', '透光', '镭射', '钻石', '镭射贵金属', '其他'],
      materialCodes: { '贵金属': 'G', '透光': 'T', '镭射': 'L', '钻石': 'D', '镭射贵金属': 'LG', '其他': 'Q' },
      dualEligible:  ['贵金属', '透光', '镭射', '钻石'],
      showColor: true, genCode: true
    },
    'M250': {
      materialOpts:  ['贵金属', '透光', '镭射', '钻石', '镭射贵金属', '其他'],
      materialCodes: { '贵金属': 'G', '透光': 'T', '镭射': 'L', '钻石': 'D', '镭射贵金属': 'LG', '其他': 'Q' },
      dualEligible:  ['贵金属', '透光', '镭射', '钻石'],
      showColor: true, genCode: true
    },
    'MP7': {
      materialOpts:  ['贵金属', '透光', '镭射', '水晶', '钻石', '镭射贵金属', '其他'],
      materialCodes: { '贵金属': 'G', '透光': 'T', '镭射': 'L', '水晶': 'C', '钻石': 'D', '镭射贵金属': 'LG', '其他': 'Q' },
      dualEligible:  ['贵金属', '透光', '镭射', '水晶', '钻石'],
      showColor: true, genCode: true
    },
    'SCARH': {
      materialOpts:  ['贵金属', '水晶', '其他'],
      materialCodes: { '贵金属': 'G', '水晶': 'C', '其他': 'Q' },
      dualEligible:  [],
      showColor: true, genCode: false
    },
    'Vector': {
      materialOpts:  [],
      materialCodes: {},
      dualEligible:  [],
      showColor: false, genCode: false
    }
  };

  function getWeaponCfg(w) {
    return WEAPON_CONFIG[w] || {
      materialOpts:  ['贵金属', '透光', '镭射', '漆面', '木质', '其他'],
      materialCodes: { '贵金属': 'G', '透光': 'T', '镭射': 'L', '漆面': 'M', '木质': 'Z', '其他': 'Q' },
      dualEligible:  [],
      showColor: true, genCode: true
    };
  }

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
             material2: '',
             color1: '', color2: '',
             files: { '1': null, '2': null, '3': null, '4': null },
             coverSlot: '1',
             extraFiles: { S1: null, S2: null, S3: null } };
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
    render(0);
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
    Object.values(state.extraFiles || {}).forEach(function (f) {
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

  function isKC17(w) { return w === 'KC17'; }

  function buildCodeHint() {
    if (!state.quality) return '—';
    var q = QUALITY_CODES[state.quality] || '?';
    // KC17 专属逻辑（保持不变）
    if (isKC17(state.weapon)) {
      if (!state.material) return '—';
      var m1 = KC17_MATERIAL_CODES[state.material] || '?';
      var m2 = (state.material2 && KC17_DUAL_ELIGIBLE.indexOf(state.material) !== -1)
               ? (KC17_MATERIAL_CODES[state.material2] || '') : '';
      if (!state.color1) return q + m1 + m2 + '????';
      if (state.color1 === '炫彩') return q + m1 + m2 + '1111';
      var c1 = COLOR_CODES[state.color1] || '??';
      var c2 = (state.color2 && state.color2 !== '单色') ? (COLOR_CODES[state.color2] || '??') : '00';
      return q + m1 + m2 + c1 + c2 + '【+模板名】';
    }
    var cfg = getWeaponCfg(state.weapon);
    // 无材质 / 模板武器（M4A1、Vector、AUG、SCARH）
    if (!cfg.genCode) return '—';
    if (!state.material) return '—';
    var mCode = cfg.materialCodes[state.material] || '?';
    // 双材质叠加码
    var m2Code = '';
    if (state.material2 && state.material2 !== '无' && cfg.dualEligible.indexOf(state.material) !== -1) {
      m2Code = cfg.materialCodes[state.material2] || '';
    }
    if (!state.color1) return q + mCode + m2Code + '????';
    if (state.color1 === '炫彩') return q + mCode + m2Code + '1111';
    var c1 = COLOR_CODES[state.color1] || '??';
    var c2 = (state.color2 && state.color2 !== '单色') ? (COLOR_CODES[state.color2] || '??') : '00';
    return q + mCode + m2Code + c1 + c2;
  }

  // ── 查重过滤 ─────────────────────────────────────────────
  function isXuancaiSkin(skin) {
    var code = String((skin && skin.normalizedCode) || '');
    var label = String((skin && skin.colorLabel) || '');
    return /1111$/.test(code) || label === '炫彩' || label === '未知配色';
  }

  function matchingSkinsInDB() {
    var all = global.SKIN_DATA || [];
    return all.filter(function (s) {
      if (s.weapon !== state.weapon) return false;
      if (state.quality  && s.qualityLabel  !== state.quality)  return false;
      if (state.material && s.materialLabel !== state.material) return false;
      if (state.color1) {
        if (state.color1 === '炫彩') {
          if (!isXuancaiSkin(s)) return false;
        } else {
          // colorLabel 格式："白色" / "白色 + 红色"，state.color1 = "白"
          if (!s.colorLabel || s.colorLabel.indexOf(state.color1) === -1) return false;
        }
      }
      return true;
    });
  }

  // ── 渲染 ────────────────────────────────────────────────
  function stepHeader(active) {
    var steps = [
      { n: '①', label: '推荐' },
      { n: '②', label: '筛选' },
      { n: '③', label: '查重' },
      { n: '④', label: '上传' }
    ];
    var h = '<div class="sp-steps">';
    steps.forEach(function (s, i) {
      if (i > 0) h += '<span class="sp-step-sep">›</span>';
      var cls = 'sp-step' + (i === active ? ' sp-step-active' : '');
      h += '<span class="' + cls + '">' + s.n + ' ' + s.label + '</span>';
    });
    h += '</div>';
    return h;
  }

  function render(step) {
    if (!panelEl) return;
    state.step = step;
    var html;
    if (step === 0)      html = buildStep0();
    else if (step === 1) html = buildStep1();
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

  // ── Step 0：投稿推荐 ──────────────────────────────────────
  function buildStep0() {
    var base = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
      ? '/site/guide/' : '/guide/';
    var h = '<div class="sp-inner"><div class="sp-head">';
    h += stepHeader(0);
    h += '<span class="sp-title">投稿推荐</span>';
    h += '<button class="sp-close" id="spClose">×</button></div>';
    h += '<div class="sp-body">';

    h += '<div class="sp-guide-block">';
    h += '<img class="sp-guide-img" src="' + base + '\u6295\u7a3f\u63a8\u8350\u56fe.png" alt="\u63a8\u8350\u653e\u56fe\u793a\u4f8b" />';
    h += '<p class="sp-guide-desc">';
    h += '\u4e0a\u4f20\u65b0\u6a21\u677f\u9996\u6b21\u4e0a\u4f20\u53ef\u4ee5\u4e0a\u4f204\u20137\u5f20\u56fe\u7247\uff0c\u63a8\u8350\u56fe\u5982\u4e0a\uff0c\u5927\u5bb6\u5c3d\u91cf\u5c55\u793a\u5e38\u7528\u7684\u914d\u4ef6\uff5e\u611f\u8c22';
    h += '</p></div>';

    h += '<div class="sp-guide-block">';
    h += '<img class="sp-guide-img" src="' + base + '\u6750\u8d28\u786e\u8ba4\u56fe.png" alt="\u6750\u8d28\u786e\u8ba4\u8def\u5f84" />';
    h += '<p class="sp-guide-desc">';
    h += '\u4e0a\u4f20\u524d\u8bf7\u786e\u8ba4\u6750\u8d28\u548c\u989c\u8272\u4e3a\u5b98\u65b9\u989c\u8272\uff0c\u786e\u8ba4\u8def\u5f84\uff1a\u5e02\u573a \u2014 \u552e\u5356 \u2014 \u76f8\u4f3c\u76ae\u80a4';
    h += '</p></div>';

    h += '<div class="sp-footer">';
    h += '<button class="sp-btn-primary" id="spStart">\u5f00\u59cb\u6295\u7a3f \u2192</button>';
    h += '</div>';
    h += '</div></div>';
    return h;
  }

  // ── Step 1：筛选 ──────────────────────────────────────────
  function buildStep1() {
    var weapons = enabledWeapons();
    var showColor = isKC17(state.weapon) || getWeaponCfg(state.weapon).showColor;
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
    var wcfg = getWeaponCfg(state.weapon);
    if (isKC17(state.weapon)) {
      h += '<div class="sp-section"><div class="sp-label">材质 <span class="sp-req">必填</span></div>';
      h += '<div class="sp-chips">' + chips(KC17_MATERIAL_OPTS, 'material', state.material) + '</div>';
      if (state.material && KC17_DUAL_ELIGIBLE.indexOf(state.material) !== -1) {
        var m2opts = ['无'].concat(KC17_DUAL_ELIGIBLE.filter(function (o) { return o !== state.material; }));
        var m2cur  = state.material2 || '无';
        h += '<div class="sp-label" style="margin-top:6px">第二材质 <span class="sp-hint">可叠加，如结构光+镭射</span></div>';
        h += '<div class="sp-chips">' + chips(m2opts, 'material2', m2cur) + '</div>';
      }
      h += '</div>';
    } else if (wcfg.materialOpts.length > 0) {
      h += '<div class="sp-section"><div class="sp-label">材质 <span class="sp-req">必填</span></div>';
      h += '<div class="sp-chips">' + chips(wcfg.materialOpts, 'material', state.material) + '</div>';
      if (state.material && wcfg.dualEligible.length > 0 && wcfg.dualEligible.indexOf(state.material) !== -1) {
        var dm2opts = ['无'].concat(wcfg.dualEligible.filter(function (o) { return o !== state.material; }));
        var dm2cur  = state.material2 || '无';
        h += '<div class="sp-label" style="margin-top:6px">第二材质 <span class="sp-hint">可叠加</span></div>';
        h += '<div class="sp-chips">' + chips(dm2opts, 'material2', dm2cur) + '</div>';
      }
      h += '</div>';
    }
    // 无材质武器（M4A1、Vector）：不渲染材质区

    // 颜色（按武器配置决定是否显示）
    if (showColor) {
      var colorRequired = !isKC17(state.weapon) && wcfg.genCode;
      h += '<div class="sp-section"><div class="sp-label">主色' + (colorRequired ? ' <span class="sp-req">必填</span>' : '') + '</div>';
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
    h += '<div class="sp-section"><div class="sp-label">截图上传 <span class="sp-hint">4 张全部<span class="sp-req">必填</span> · PNG/JPG · 单张 ≤ 20MB · 选一张设为封面图</span></div>';
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

    // 补充图上传区（可选，最多 3 张）
    h += '<div class="sp-section sp-extra-section">';
    h += '<div class="sp-label">补充图 <span class="sp-optional">选填</span><span class="sp-hint"> · 最多 3 张 · 审核通过后展示在皮肤详情页右侧补充图列</span></div>';
    h += '<div class="sp-upload-grid sp-upload-grid-extra">';
    ['S1', 'S2', 'S3'].forEach(function (slot, idx) {
      var f = state.extraFiles[slot];
      h += '<div class="sp-uz sp-uz-extra' + (f ? ' has-file' : '') + '" id="spUzEx' + slot + '" data-exslot="' + slot + '">';
      if (f) {
        h += '<img class="sp-uz-img" src="' + f.url + '" />';
        h += '<div class="sp-uz-fname">' + esc(f.name) + '</div>';
        h += '<button class="sp-uz-del sp-uz-del-ex" data-exslot="' + slot + '">✕</button>';
      } else {
        h += '<div class="sp-uz-plus">＋</div>';
        h += '<div class="sp-uz-label">补充图 ' + (idx + 1) + '</div>';
        h += '<div class="sp-uz-hint">任意角度均可</div>';
      }
      h += '<input class="sp-uz-input" id="spUzExIn' + slot + '" type="file" accept="image/png,image/jpeg" />';
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
        // KC17 主材质切换时，清除第二材质（避免无效组合）
        if (type === 'material') state.material2 = '';
        render(step);
      });
    });

    if (step === 0) {
      var startBtn = panelEl.querySelector('#spStart');
      if (startBtn) startBtn.addEventListener('click', function () { render(1); });

    } else if (step === 1) {
      var nextBtn = panelEl.querySelector('#spNext');
      if (nextBtn) {
        nextBtn.addEventListener('click', function () {
          if (!state.weapon)  { toast('请先选择武器'); return; }
          if (!state.quality) { toast('请选择稀有度'); return; }
          var needMaterial = !isKC17(state.weapon) && getWeaponCfg(state.weapon).materialOpts.length > 0;
          if (needMaterial && !state.material) { toast('请选择材质'); return; }
          if (isKC17(state.weapon) && !state.material) { toast('请选择材质'); return; }
          // 需要生成编码的武器：颜色也是必填（不选会产生 ???? 占位符导致目录名非法）
          var wcfg = getWeaponCfg(state.weapon);
          if (!isKC17(state.weapon) && wcfg.showColor && wcfg.genCode && !state.color1) {
            toast('请选择主色');
            return;
          }
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

      // 补充图 S1/S2/S3 的事件绑定
      ['S1', 'S2', 'S3'].forEach(function (exSlot) {
        var zone  = panelEl.querySelector('#spUzEx' + exSlot);
        var input = panelEl.querySelector('#spUzExIn' + exSlot);
        if (!zone || !input) return;

        zone.addEventListener('click', function (e) {
          if (e.target.classList.contains('sp-uz-del-ex')) return;
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
          if (file) handleExtraFile(exSlot, file);
        });
        input.addEventListener('change', function () {
          if (input.files[0]) handleExtraFile(exSlot, input.files[0]);
        });
        var delBtn = zone.querySelector('.sp-uz-del-ex');
        if (delBtn) {
          delBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            var s = delBtn.dataset.exslot;
            if (state.extraFiles[s] && state.extraFiles[s].url) URL.revokeObjectURL(state.extraFiles[s].url);
            state.extraFiles[s] = null;
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

  function handleExtraFile(slot, file) {
    if (!file.type.match(/^image\/(png|jpe?g)$/i)) { toast('仅支持 PNG / JPG 格式'); return; }
    if (file.size > 20 * 1024 * 1024)              { toast('图片超过 20MB 限制'); return; }
    if (state.extraFiles[slot] && state.extraFiles[slot].url) URL.revokeObjectURL(state.extraFiles[slot].url);
    state.extraFiles[slot] = { file: file, name: file.name, url: URL.createObjectURL(file) };
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
      // 双材质时合并为 "材质1+材质2" 存入 material 字段
      material: (state.material2 && state.material2 !== '无')
                ? (state.material + '+' + state.material2)
                : state.material,
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
        // 收集非空的补充图 slot
        var extraSlots = ['S1', 'S2', 'S3'].filter(function (s) { return state.extraFiles[s] !== null; });
        var total       = orderedNums.length + extraSlots.length;
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

        // 上传主图 ABCD
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

        // 上传补充图 S1/S2/S3
        extraSlots.forEach(function (exSlot) {
          chain = chain.then(function () {
            setProgress(uploadedCount, '上传补充图 ' + exSlot + '（' + (uploadedCount + 1) + ' / ' + total + '）…');
            var f = state.extraFiles[exSlot].file;
            var ext = inferExt(f);
            var key = sts.keyPrefix + exSlot + ext;
            return client.multipartUpload(key, f, {
              timeout: 120000,
              mime: f.type || 'image/png'
            }).then(function (ret) {
              var etag = '';
              if (ret && ret.res && ret.res.headers && ret.res.headers.etag) etag = String(ret.res.headers.etag).replace(/"/g, '');
              uploads[exSlot] = { key: key, etag: etag, contentType: f.type || '' };
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
