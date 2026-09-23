/* ============ 中国城市数据地图 · 交互逻辑 ============ */
(function () {
  'use strict';

  // ---------- 基础数据 ----------
  var GEO = window.__CHINA_CITY_GEO__;
  if (!GEO || !GEO.features || !GEO.features.length) {
    document.body.innerHTML = '<p style="padding:40px;font-size:16px">地图数据加载失败，请检查 data/china-city.js 是否存在。</p>';
    return;
  }

  var CITIES = GEO.features.map(function (f) {
    return {
      name: f.properties.name,
      adcode: f.properties.adcode,
      province: f.properties.province,
      center: f.properties.center,
      geom: f.geometry,
      bbox: f.properties.bbox
    };
  });
  var CITY_MAP = new Map(CITIES.map(function (c) { return [c.name, c]; }));

  // 省份代表坐标（省内城市几何中心均值）：连线以省份为单位的起点
  var PROV_CENTER = (function () {
    var acc = {};
    CITIES.forEach(function (c) {
      var a = acc[c.province] || (acc[c.province] = { x: 0, y: 0, n: 0 });
      a.x += c.center[0]; a.y += c.center[1]; a.n++;
    });
    var m = {};
    Object.keys(acc).forEach(function (p) { m[p] = [acc[p].x / acc[p].n, acc[p].y / acc[p].n]; });
    return m;
  })();

  function provOf(name) { var c = CITY_MAP.get(name); return c ? c.province : null; }

  var MAP_BBOX = [Infinity, Infinity, -Infinity, -Infinity];
  CITIES.forEach(function (c) {
    var b = c.bbox;
    if (b[0] < MAP_BBOX[0]) MAP_BBOX[0] = b[0];
    if (b[1] < MAP_BBOX[1]) MAP_BBOX[1] = b[1];
    if (b[2] > MAP_BBOX[2]) MAP_BBOX[2] = b[2];
    if (b[3] > MAP_BBOX[3]) MAP_BBOX[3] = b[3];
  });
  var DEFAULT_CENTER = [(MAP_BBOX[0] + MAP_BBOX[2]) / 2, (MAP_BBOX[1] + MAP_BBOX[3]) / 2];

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
  function fmtNum(v) { return Number.isInteger(v) ? v.toLocaleString('zh-CN') : String(v); }
  function shortName(s) { return s.replace(/(特别行政区|自治州|自治区|地区|林区|盟|市)/g, ''); }

  // ---------- 颜色（省内连续渐变：#666BCE → #18B7F6 → #D7EEF6，数值越大越饱和） ----------
  var EMPTY_COLOR = 'rgba(148,180,225,0.30)'; // 深色背景上的雾面玻璃底色
  var BAND_STOPS = ['#666bce', '#18b7f6', '#d7eef6']; // 深蓝紫 → 亮蓝 → 浅蓝
  var HIGHLIGHT_FILL = '#fde047';
  var HIGHLIGHT_BORDER = '#ca8a04';

  function hex2rgb(h) { var n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgb2hex(r, g, b) {
    return '#' + [r, g, b].map(function (v) { return Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0'); }).join('');
  }
  function mix(a, b, t) {
    var A = hex2rgb(a), B = hex2rgb(b);
    return rgb2hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
  }
  function shade(hex, f) { return f < 0 ? mix(hex, '#000000', -f) : mix(hex, '#ffffff', f); }
  function rgbaA(h, a) {
    var c = hex2rgb(h);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + Math.min(a, 1).toFixed(3) + ')';
  }

  // 色带取色：u ∈ [0,1] 沿 深蓝紫 → 亮蓝 → 浅蓝
  function band(u) {
    u = clamp(u, 0, 1);
    return u < 0.5 ? mix(BAND_STOPS[0], BAND_STOPS[1], u * 2) : mix(BAND_STOPS[1], BAND_STOPS[2], (u - 0.5) * 2);
  }

  // 省份 bbox（省内城市 bbox 并集）：省内连续渐变的区段换算基准
  var PROV_BBOX = (function () {
    var m = {};
    CITIES.forEach(function (c) {
      var b = m[c.province];
      if (!b) m[c.province] = [c.bbox[0], c.bbox[1], c.bbox[2], c.bbox[3]];
      else {
        if (c.bbox[0] < b[0]) b[0] = c.bbox[0];
        if (c.bbox[1] < b[1]) b[1] = c.bbox[1];
        if (c.bbox[2] > b[2]) b[2] = c.bbox[2];
        if (c.bbox[3] > b[3]) b[3] = c.bbox[3];
      }
    });
    return m;
  })();

  // 中心图标填充：紫色系纵向渐变（以 #666BCE 为主的紫 → 浅紫）
  function iconGrad() {
    return {
      type: 'linear', x: 0, y: 0, x2: 0, y2: 1, global: false,
      colorStops: [
        { offset: 0, color: '#666bce' },
        { offset: 0.55, color: '#8471e0' },
        { offset: 1, color: '#b9aef5' }
      ]
    };
  }

  // 用户气泡填充：毛玻璃质感（白色高光 → 浅蓝 → 半透明亮蓝），与省内渐变同族配色
  function bubbleGrad() {
    return {
      type: 'linear', x: 0, y: 0, x2: 0, y2: 1, global: false,
      colorStops: [
        { offset: 0, color: 'rgba(255,255,255,0.92)' },
        { offset: 0.55, color: 'rgba(215,238,246,0.78)' },
        { offset: 1, color: 'rgba(24,183,246,0.40)' }
      ]
    };
  }

  // 省级连续渐变填充：渐变向量铺满城市图形（global:false 相对自身包围盒），
  // colorStops 取全省渐变中该城市 bbox 对应区段的起止颜色 —— 相邻城市颜色首尾
  // 衔接，整省呈现一段连续渐变。渐变方向 = 省 bbox 长轴（水平：西→东 / 垂直：北→南）。
  // 透明度按省数值大小调整。opts: t 数值比例(0~1)；fade 点亮渐入；lighten 悬停提亮；boost 悬停加实
  function provGrad(c, opts) {
    opts = opts || {};
    var pb = PROV_BBOX[c.province];
    var alpha = 0.5 + 0.4 * clamp(opts.t || 0, 0, 1); // 数值越大越不透明（差异收敛，避免过透/过实）
    var fade = opts.fade == null ? 1 : clamp(opts.fade, 0, 1);
    alpha = clamp(alpha * fade + (opts.boost || 0), 0, 1);
    var lighten = opts.lighten || 0;
    if (!pb) return rgbaA(band(0.5), alpha);
    function col(u) {
      var h = band(u);
      if (lighten > 0) h = shade(h, lighten);
      return rgbaA(h, alpha);
    }
    var pw = pb[2] - pb[0] || 1e-9, ph = pb[3] - pb[1] || 1e-9;
    var horiz = (pb[2] - pb[0]) >= (pb[3] - pb[1]);
    var a, b; // 城市在省渐变轴上的起止比例
    if (horiz) {
      a = (c.bbox[0] - pb[0]) / pw;
      b = (c.bbox[2] - pb[0]) / pw;
    } else {
      a = (pb[3] - c.bbox[3]) / ph; // 屏幕 y 向下：顶部 = 城市北界
      b = (pb[3] - c.bbox[1]) / ph;
    }
    var stops = [{ offset: 0, color: col(a) }, { offset: 1, color: col(b) }];
    // 色带中点拐点落在区段内时补一个停靠点，保证跨城市的线性衔接精确
    if (a < 0.5 && b > 0.5) stops.splice(1, 0, { offset: (0.5 - a) / (b - a), color: col(0.5) });
    return horiz
      ? { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, global: false, colorStops: stops }
      : { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, global: false, colorStops: stops };
  }

  // ---------- 状态 ----------
  var STORE_KEY = 'chinaCityMap.v1';
  // 默认数据种子版本：更新 data.json / default-data.js 后把此值 +1，
  // 可让仍持有"旧版空存档"的访客重新播种为新默认数据（非空存档不受影响）
  var SEED_VERSION = 2;
  var state = {
    values: {}, arrows: {}, centers: [], users: {},
    style: { arrowColor: '#1d9bf0', arrowMotion: 'flow', centerIcon: 'pin', centerSize: 'medium', userSize: 'medium', arrowWidth: 'medium', arrowLine: 'solid', arrowCurve: 'curve', seqSpeed: 'normal', tipsText: '', tipsSize: 'medium' }
  };

  // 将任意来源的数据规范化为合法 state（本地存档 / 导入文件共用一套校验）
  function normalizeState(s) {
    if (!s || typeof s !== 'object') return null;
    var out = { values: {}, arrows: {}, centers: [], users: {} };
    Object.keys(s.values || {}).forEach(function (k) {
      var v = +s.values[k];
      if (CITY_MAP.has(k) && Number.isFinite(v) && v > 0) out.values[k] = v;
    });
    if (Array.isArray(s.centers)) {
      s.centers.forEach(function (n) { if (CITY_MAP.has(n) && out.centers.indexOf(n) < 0) out.centers.push(n); });
    } else if (s.center && CITY_MAP.has(s.center)) {
      out.centers = [s.center];
    }
    Object.keys(s.arrows || {}).forEach(function (k) {
      if (!out.centers.length) return;
      var t = (typeof s.arrows[k] === 'string' && CITY_MAP.has(s.arrows[k])) ? s.arrows[k] : out.centers[0];
      if (CITY_MAP.has(k)) {
        // 新格式：城市名 → 中心城市
        out.arrows[k] = t;
      } else if (PROV_CENTER[k]) {
        // 旧格式迁移：省名 → 中心，展开为该省每个有着色的城市
        CITIES.forEach(function (c) {
          if (c.province === k && out.values[c.name] > 0) out.arrows[c.name] = t;
        });
      }
    });
    Object.keys(s.users || {}).forEach(function (k) {
      var arr = Array.isArray(s.users[k]) ? s.users[k].filter(function (id) { return typeof id === 'string' && id.trim(); }).map(String) : [];
      if (CITY_MAP.has(k) && arr.length) out.users[k] = arr;
    });
    var st = s.style || {};
    out.style = {
      arrowColor: /^#[0-9a-fA-F]{6}$/.test(st.arrowColor || '') ? st.arrowColor : '#1d9bf0',
      arrowMotion: st.arrowMotion === 'static' ? 'static' : 'flow',
      centerIcon: ['pin', 'star', 'dot', 'ring', 'flag', 'highlight', 'moon'].indexOf(st.centerIcon) >= 0 ? st.centerIcon : 'pin',
      centerSize: ['small', 'medium', 'large'].indexOf(st.centerSize) >= 0 ? st.centerSize : 'medium',
      userSize: ['small', 'medium', 'large'].indexOf(st.userSize) >= 0 ? st.userSize : 'medium',
      arrowWidth: ['thin', 'medium', 'thick'].indexOf(st.arrowWidth) >= 0 ? st.arrowWidth : 'medium',
      arrowLine: ['solid', 'dashed', 'dotted'].indexOf(st.arrowLine) >= 0 ? st.arrowLine : 'solid',
      arrowCurve: st.arrowCurve === 'straight' ? 'straight' : 'curve',
      seqSpeed: ['slow', 'normal', 'fast'].indexOf(st.seqSpeed) >= 0 ? st.seqSpeed : 'normal',
      searchMode: st.searchMode === 'user' ? 'user' : 'city',
      tipsText: typeof st.tipsText === 'string' ? st.tipsText.slice(0, 500) : '',
      tipsSize: ['small', 'medium', 'large'].indexOf(st.tipsSize) >= 0 ? st.tipsSize : 'medium',
      tipsRect: (function () {
        var r = st.tipsRect;
        if (!r || typeof r !== 'object') return null;
        var x = +r.x, y = +r.y, w = +r.w, h = +r.h;
        return (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h) && w >= 120 && h >= 60) ? { x: x, y: y, w: w, h: h } : null;
      })()
    };
    return out;
  }
  function applyState(s) {
    state.values = s.values;
    state.arrows = s.arrows;
    state.centers = s.centers;
    state.users = s.users;
    state.style = s.style;
  }
  // 判断一份存档是否"完全空白"（旧版本首次访问时 refresh() 会自动存一份空状态，
  // 导致 data.json 默认数据永远被跳过——空旧存档应视为"从未播种"）
  function isEmptyState(s) {
    return !s || (
      Object.keys(s.values || {}).length === 0 &&
      Object.keys(s.arrows || {}).length === 0 &&
      (s.centers || []).length === 0 &&
      Object.keys(s.users || {}).length === 0
    );
  }
  // 数据优先级：本地有效存档（回访保留个人编辑）＞ 默认数据（data.json / 内嵌快照）
  function loadState() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        var seedV = +parsed.__seedV || 1;
        var s = normalizeState(parsed);
        // 旧种子版本 + 空白存档 → 放弃，走默认数据播种
        if (s && (seedV >= SEED_VERSION || !isEmptyState(s))) { applyState(s); return Promise.resolve(); }
      }
    } catch (e) { /* ignore */ }
    return loadDefaultState();
  }
  // 读取默认数据（不做兜底）：http(s) 环境实时 fetch 根目录 data.json；
  // file:// 双击打开时 fetch 被浏览器禁止，使用 js/default-data.js 的内嵌快照
  function readDefaultState() {
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      return fetch('data.json', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (d) { return normalizeState(d); });
    }
    return Promise.resolve(normalizeState(window.__DEFAULT_MAP_STATE__));
  }
  function loadDefaultState() {
    return readDefaultState()
      .then(function (s) { if (s) { applyState(s); saveState(); } })
      .catch(function () { // 在线 fetch 失败（网络/404/解析错误）→ 回退内嵌快照
        var s = normalizeState(window.__DEFAULT_MAP_STATE__);
        if (s) { applyState(s); saveState(); }
      });
  }
  function saveState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(Object.assign({ __seedV: SEED_VERSION }, state))); } catch (e) { /* ignore */ }
  }

  // ---------- 数据导入导出 ----------
  function exportData() {
    try {
      var payload = JSON.stringify({ version: 1, values: state.values, arrows: state.arrows, centers: state.centers, users: state.users, style: state.style });
      var blob = new Blob([payload], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'china-map-data-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast('已导出当前数据');
    } catch (e) { toast('导出失败'); }
  }
  function importData(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var s = normalizeState(JSON.parse(String(reader.result)));
        if (!s) throw new Error('bad');
        var nv = Object.keys(s.values).length;
        var nc = s.centers.length;
        var na = Object.keys(s.arrows).length;
        var nu = Object.keys(s.users).length;
        if (!nv && !nc && !na && !nu) { toast('文件中没有可识别的数据'); return; }
        state.values = s.values;
        state.arrows = s.arrows;
        state.centers = s.centers;
        state.users = s.users;
        state.style = s.style;
        saveState();
        refresh();
        syncStyleUI();
        toast('已导入 ' + nv + ' 个城市数值、' + nc + ' 个中心' + (na ? '、' + na + ' 条连线' : '') + (nu ? '、' + nu + ' 个城市的用户' : ''));
      } catch (e) { toast('导入失败：文件格式不正确'); }
    };
    reader.onerror = function () { toast('导入失败：文件读取错误'); };
    reader.readAsText(file);
  }

  // ---------- DOM ----------
  function $(id) { return document.getElementById(id); }
  var searchInput = $('search'), suggestEl = $('suggest');
  var cardEl = $('card'), valueInput = $('cardValue');
  var legendMaxEl = $('legendMax'), toastEl = $('toast'), modalEl = $('modal');

  // ---------- Toast ----------
  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.add('hidden'); }, 2200);
  }

  // ---------- 图表 ----------
  echarts.registerMap('chinaCity', GEO);
  var chart = echarts.init($('map'));

  function regionKind(c) {
    if (c.name === c.province) {
      if (/特别行政区/.test(c.name)) return '特别行政区';
      if (/台湾/.test(c.name)) return '省级行政区';
      return '直辖市';
    }
    return c.province;
  }

  function baseOption() {
    return {
      animationDurationUpdate: 260,
      tooltip: {
        trigger: 'item',
        confine: true,
        backgroundColor: 'transparent',
        borderWidth: 0,
        padding: 0,
        extraCssText: 'box-shadow:none;',
        formatter: fmtTooltip
      },
      geo: {
        map: 'chinaCity',
        roam: true,
        center: DEFAULT_CENTER,
        zoom: 1,
        scaleLimit: { min: 0.7, max: 20 },
        selectedMode: false,
        label: { show: false },
        itemStyle: { areaColor: EMPTY_COLOR, borderColor: 'rgba(160,190,235,0.22)', borderWidth: 0.6 },
        emphasis: {
          label: { show: true, color: '#3d4a8f', fontSize: 12, fontWeight: 600 },
          itemStyle: { areaColor: 'rgba(150,195,255,0.18)', borderColor: '#4aa8f0', borderWidth: 1.1 }
        }
      },
      series: [
        { id: 'regions', type: 'map', map: 'chinaCity', geoIndex: 0, selectedMode: false, data: [] },
        {
          id: 'names', type: 'scatter', coordinateSystem: 'geo', zlevel: 1, silent: true,
          symbolSize: 0.1,
          labelLayout: { hideOverlap: true },
          label: {
            show: true, position: 'top', distance: 3,
            fontSize: 9, color: '#8ea6c8',
            textBorderColor: 'rgba(255,255,255,.85)', textBorderWidth: 2
          },
          data: []
        },
        {
          id: 'flows', type: 'lines', coordinateSystem: 'geo', zlevel: 2,
          animation: false, // 生长动画由 graphic 承担；真线瞬时完整出现，避免数据更新时整线重播进场动画
          symbol: ['none', 'arrow'], symbolSize: 7,
          effect: { show: true, period: 4, trailLength: 0.28, symbol: 'arrow', symbolSize: 7, color: '#7fd0ff', loop: true },
          lineStyle: { color: '#1d9bf0', width: 1.4, opacity: 0.45, curveness: 0.22 },
          data: []
        },
        {
          id: 'sources', type: 'scatter', coordinateSystem: 'geo', zlevel: 2,
          symbolSize: 4.5,
          itemStyle: { color: '#1d9bf0', borderColor: '#ffffff', borderWidth: 1, opacity: 0.95 },
          data: []
        },
        {
          id: 'flowNums', type: 'scatter', coordinateSystem: 'geo', zlevel: 2, silent: true,
          symbolSize: 0.1,
          labelLayout: { hideOverlap: false },
          label: {
            show: true, position: 'inside',
            formatter: function (p) { return p.name; },
            fontSize: 10, fontWeight: 700, color: '#3d4a8f',
            backgroundColor: 'rgba(255,255,255,.95)', borderColor: '#9fd4f8',
            borderWidth: 1, padding: [2, 6], borderRadius: 99
          },
          data: []
        },
        {
          id: 'users', type: 'scatter', coordinateSystem: 'geo', zlevel: 3,
          symbol: 'pin', symbolSize: 30,
          itemStyle: { color: bubbleGrad(), borderColor: 'rgba(102,107,206,.35)', borderWidth: 1.2, shadowColor: 'rgba(102,107,206,.25)', shadowBlur: 6 },
          label: {
            show: true, position: 'inside',
            formatter: function (p) { return p.data.userId || ''; },
            color: '#1668b8', fontSize: 9,
            width: 16, overflow: 'truncate', ellipsis: ''
          },
          data: []
        },
        {
          id: 'centerPin', type: 'scatter', coordinateSystem: 'geo', zlevel: 3,
          symbol: 'pin', symbolSize: 34, symbolOffset: [0, '-46%'],
          itemStyle: { color: '#666bce', borderColor: '#ffffff', borderWidth: 2, shadowColor: 'rgba(102,107,206,.5)', shadowBlur: 10 },
          label: {
            show: true, position: 'top', distance: 10,
            formatter: function (p) { return p.name; },
            color: '#454ba3', backgroundColor: 'rgba(255,255,255,.95)', borderColor: '#c3c6f2',
            borderWidth: 1, padding: [3, 9], borderRadius: 99, fontWeight: 700, fontSize: 12
          },
          data: []
        }
      ]
    };
  }

  function fmtTooltip(p) {
    if (p.seriesType === 'map' || p.componentType === 'geo') {
      var c = CITY_MAP.get(p.name);
      if (!c) return '';
      var v = state.values[p.name];
      var isCenter = state.centers.indexOf(p.name) >= 0;
      var ps = provinceSums();
      var sum = ps[c.province] || 0;
      return '<div class="tt">' +
        '<div class="tt-head">' + p.name + (isCenter ? '<span class="tt-badge">中心</span>' : '') + '</div>' +
        '<div class="tt-sub">' + regionKind(c) + '</div>' +
        '<div class="tt-row"><span>数值</span><b>' + (v != null ? fmtNum(v) : '未设置') + '</b></div>' +
        '<div class="tt-row"><span>全省合计</span><b>' + (sum > 0 ? fmtNum(sum) : '—') + '</b></div>' +
        '</div>';
    }
    if (p.seriesType === 'lines' && p.name) {
      return '<div class="tt"><div class="tt-head">' + p.name + ' → ' + (state.arrows[p.name] || '') + '</div>' +
        '<div class="tt-sub">指向中心城市的箭头</div></div>';
    }
    if (p.seriesType === 'scatter' && p.name) {
      if (p.data && p.data.userId) {
        if (selectedUserId && p.data.userId === selectedUserId) return ''; // 选中态已用钉住卡片，避免重复
        return '<div class="tt"><div class="tt-head">' + p.data.userId + '</div><div class="tt-sub">' + p.name + ' · 用户标注</div></div>';
      }
      if (state.centers.indexOf(p.name) >= 0) {
        return '<div class="tt"><div class="tt-head">' + p.name + '</div><div class="tt-sub">中心城市</div></div>';
      }
      return '<div class="tt"><div class="tt-head">' + p.name + ' → ' + (state.arrows[p.name] || '') + '</div>' +
        '<div class="tt-sub">指向中心城市的箭头</div></div>';
    }
    return '';
  }

  // 省份数值合计：着色单位为省份，数值仍按城市录入
  function provinceSums() {
    var m = {};
    Object.keys(state.values).forEach(function (k) {
      var c = CITY_MAP.get(k);
      if (c) m[c.province] = (m[c.province] || 0) + state.values[k];
    });
    return m;
  }

  // opt.litMap：点亮播放模式（省名 → 点亮进度 0~1）；正常模式不传
  function geoRegions(opt) {
    opt = opt || {};
    var litMap = opt.litMap || null;
    var playing = !!litMap;
    var showVal = $('chkLabels').checked;
    var showName = $('chkNames').checked;
    var ps = provinceSums();
    var maxPS = 0;
    Object.keys(ps).forEach(function (p) { if (ps[p] > maxPS) maxPS = ps[p]; });
    var txtBorder = 'rgba(255,255,255,.85)';
    return CITIES.map(function (c) {
      var v = state.values[c.name] || 0;
      var sum = ps[c.province] || 0;
      var prog = playing ? (litMap[c.province] || 0) : (sum > 0 ? 1 : 0);
      var t = prog > 0 ? Math.sqrt(sum / maxPS) : 0;
      var r = { name: c.name, itemStyle: { areaColor: EMPTY_COLOR } };
      if (prog > 0) {
        // 边框完全去除：消除省内城市分界线，使省份呈现为一整块连续渐变
        r.itemStyle = { areaColor: provGrad(c, { t: t, fade: prog }), borderColor: 'rgba(255,255,255,0)', borderWidth: 0 };
        if (!playing && showVal && v > 0) {
          r.label = {
            show: true, position: 'inside',
            formatter: showName
              ? '{n|' + c.name + '}\n{v|' + fmtNum(v) + '}'
              : '{v|' + fmtNum(v) + '}',
            rich: {
              n: { fontSize: 9, lineHeight: 12, color: '#6b5a8f', align: 'center', textBorderColor: txtBorder, textBorderWidth: 2 },
              v: { fontSize: 11, fontWeight: 700, color: '#3d4a8f', align: 'center', textBorderColor: txtBorder, textBorderWidth: 2 }
            }
          };
        }
        if (!playing) {
          var emphFmt = showName
            ? '{n|' + c.name + '}' + (v > 0 ? '\n{v|' + fmtNum(v) + '}' : '')
            : (v > 0 ? '{v|' + fmtNum(v) + '}' : '{n|' + c.name + '}');
          r.emphasis = {
            itemStyle: { areaColor: provGrad(c, { t: t, lighten: 0.12, boost: 0.15 }), borderColor: '#2b9ff0', borderWidth: 1.1 },
            label: {
              show: true, position: 'inside',
              formatter: emphFmt,
              rich: {
                n: { fontSize: 10, lineHeight: 13, color: '#4a4a8f', fontWeight: 600, align: 'center', textBorderColor: txtBorder, textBorderWidth: 2 },
                v: { fontSize: 11, fontWeight: 700, color: '#3d4a8f', align: 'center', textBorderColor: txtBorder, textBorderWidth: 2 }
              }
            }
          };
        }
      }
      if (!playing && c.name === selected) {
        r.itemStyle = sum > 0
          ? { areaColor: provGrad(c, { t: t }), borderColor: '#2b9ff0', borderWidth: 1.3 }
          : { areaColor: 'rgba(140,190,250,0.24)', borderColor: '#2b9ff0', borderWidth: 1.3 };
        r.emphasis = {
          itemStyle: { areaColor: sum > 0 ? provGrad(c, { t: t, lighten: 0.12, boost: 0.15 }) : 'rgba(150,200,255,0.32)', borderColor: '#2b9ff0', borderWidth: 1.4 },
          label: { show: true, position: 'inside', formatter: '{n|' + c.name + '}', rich: { n: { fontSize: 11, fontWeight: 600, color: '#1668b8', align: 'center' } } }
        };
      }
      if (state.centers.indexOf(c.name) >= 0 && state.style.centerIcon === 'highlight') {
        r.itemStyle = { areaColor: HIGHLIGHT_FILL, borderColor: HIGHLIGHT_BORDER, borderWidth: 1.5 };
        r.emphasis = {
          itemStyle: { areaColor: '#facc15', borderColor: HIGHLIGHT_BORDER, borderWidth: 1.6 },
          label: { show: true, position: 'inside', formatter: '{n|' + c.name + '}', rich: { n: { fontSize: 11, fontWeight: 700, color: '#854d0e', align: 'center' } } }
        };
      }
      return r;
    });
  }

  function regionData() {
    return CITIES.map(function (c) {
      return { name: c.name, value: state.values[c.name] || 0 };
    });
  }

  function nameLabelsData() {
    if (!$('chkNames').checked) return [];
    var regionShowsName = $('chkLabels').checked;
    return CITIES.filter(function (c) {
      return state.centers.indexOf(c.name) < 0 && !(regionShowsName && state.values[c.name] > 0);
    }).map(function (c) {
      return { name: c.name, value: c.center, label: { formatter: c.name } };
    });
  }

  function centerIconCfg() {
    var icon = state.style.centerIcon;
    if (icon === 'star') {
      return {
        symbol: 'path://M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z',
        size: 30, offset: [0, 0], ripple: 2.2
      };
    }
    if (icon === 'moon') {
      return {
        symbol: 'path://M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
        size: 30, offset: [0, 0], ripple: 2.2
      };
    }
    if (icon === 'dot') return { symbol: 'circle', size: 14, offset: [0, 0], ripple: 3 };
    if (icon === 'ring') return { symbol: 'circle', size: 20, offset: [0, 0], ripple: 3.2, hollow: true };
    if (icon === 'flag') {
      return {
        symbol: 'path://M6 2h2v20H6zM8 3h11l-3 4.5L19 12H8z',
        size: 30, offset: [0, '-46%'], ripple: 2.2
      };
    }
    if (icon === 'highlight') {
      return { symbol: 'circle', size: 30, offset: [0, 0], ripple: 3, halo: 'rgba(253,224,71,.32)', noLabel: true };
    }
    return { symbol: 'pin', size: 34, offset: [0, '-46%'], ripple: 2.4 };
  }

  // 中心图标大小档位系数
  function centerSizeFactor() {
    var s = state.style.centerSize;
    if (s === 'small') return 0.72;
    if (s === 'large') return 1.35;
    return 1;
  }

  // 用户气泡大小档位系数
  function userSizeFactor() {
    var s = state.style.userSize;
    if (s === 'small') return 0.7;
    if (s === 'large') return 1.35;
    return 1;
  }

  function arrowTarget(cityName) {
    var t = state.arrows[cityName];
    return (typeof t === 'string' && CITY_MAP.has(t)) ? CITY_MAP.get(t) : null;
  }
  // 连线以城市为单位：每个发出箭头的城市各自连到目标中心城市
  function flowsData() {
    return Object.keys(state.arrows).map(function (from) {
      var c = CITY_MAP.get(from), to = arrowTarget(from);
      return c && to && from !== to.name ? { name: from, coords: [c.center, to.center] } : null;
    }).filter(Boolean);
  }

  // 线段中点（弧线时按二次贝塞尔中点近似：偏移 = (dy,-dx)/len * curveness*len/2）
  function flowMid(coords) {
    var a = coords[0], b = coords[1];
    var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    if (state.style.arrowCurve === 'straight') return [mx, my];
    var dx = b[0] - a[0], dy = b[1] - a[1];
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var off = 0.11 * len;
    return [mx - dy / len * off, my - dx / len * off];
  }

  // 线段编号（按添加顺序，从 1 开始）
  function flowNumsData() {
    return flowsData().map(function (f, i) {
      return { name: String(i + 1), value: flowMid(f.coords) };
    });
  }

  function sourcesData() {
    return Object.keys(state.arrows).map(function (from) {
      var c = CITY_MAP.get(from), to = arrowTarget(from);
      return c && to && from !== to.name ? { name: from, value: c.center } : null;
    }).filter(Boolean);
  }

  function centerPinData() {
    return state.centers.map(function (n) {
      var c = CITY_MAP.get(n);
      return c ? { name: c.name, value: c.center } : null;
    }).filter(Boolean);
  }

  // 确定性伪随机（0~1）：保证用户标注散布位置在刷新后保持稳定
  function prand(seed) {
    var x = Math.sin(seed) * 43758.5453;
    return x - Math.floor(x);
  }

  // 射线法：点是否在多边形环内（经纬度小范围近似平面足够）
  function pointInRing(x, y, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  // 点是否落在城市真实边界内部（Polygon / MultiPolygon，忽略内环孔洞）
  function pointInCity(c, x, y) {
    var g = c.geom;
    if (!g || !g.coordinates) return true;
    if (g.type === 'Polygon') return pointInRing(x, y, g.coordinates[0]);
    if (g.type === 'MultiPolygon') {
      for (var i = 0; i < g.coordinates.length; i++) {
        if (pointInRing(x, y, g.coordinates[i][0])) return true;
      }
    }
    return false;
  }

  // 用户标注数据：圆形气泡（pin）下方尖角指向落点。单个用户钉在城市中心（若中心点
  // 落在边界外则重新选址到城内）；多个用户在城市真实边界内随机散布（bbox 候选 +
  // 多边形命中检测，确定性可复现）。旧数据（仅存用户 ID）刷新时自动按此规则重算落点
  function usersData() {
    var out = [];
    Object.keys(state.users).forEach(function (cityName) {
      var c = CITY_MAP.get(cityName);
      if (!c) return;
      var ids = state.users[cityName];
      var spread = ids.length > 1;
      ids.forEach(function (id, i) {
        var s = (c.adcode || 0) + i * 97 + 1;
        var x = c.center[0], y = c.center[1];
        // 多用户散布；或城市中心点不在城市边界内（部分城市 center 偏离主城区）时重新选址
        if (spread || !pointInCity(c, x, y)) {
          // 在城市 bbox 内随机取点，命中城市多边形内部才采用；多次未命中回退城市中心
          var x0 = c.bbox[0], x1 = c.bbox[2], y0 = c.bbox[1], y1 = c.bbox[3];
          for (var k = 0; k < 30; k++) {
            var rx = x0 + (x1 - x0) * prand(s + k * 131);
            var ry = y0 + (y1 - y0) * prand(s + k * 131 + 42);
            if (pointInCity(c, rx, ry)) { x = rx; y = ry; break; }
          }
        }
        out.push({ name: cityName, value: [x, y], userId: id });
      });
    });
    return out;
  }

  var selected = null;
  var selectedUserId = null; // 当前选中的用户（chip 与地图气泡联动高亮）

  // ---------- 登录门禁（纯静态站点的前端权限区分：只读浏览 / 登录可编辑，非安全认证） ----------
  var AUTH = { user: 'admin', pass: 'ziyu26' };
  var AUTH_KEY = 'china_map_admin_v1';
  var isAdmin = false;
  try { isAdmin = sessionStorage.getItem(AUTH_KEY) === '1'; } catch (e) { /* ignore */ }
  function canEdit() { return isAdmin; }
  // 写操作统一入口守卫：未登录则提示并弹出登录框
  function requireAdmin() {
    if (isAdmin) return true;
    toast('只读模式：登录后才能编辑数据');
    openLoginModal();
    return false;
  }

  // 选中用户的"钉住"提示卡：独立于 ECharts tooltip 的固定 DOM 元素。
  // 之前用 dispatchAction showTip 钉住会与 ECharts 内部的悬停隐藏/替换互相打架
  // （同步重锚被覆盖、rAF 重锚两帧交替导致忽闪忽现），自绘卡片彻底脱离其生命周期
  var pinTip = document.createElement('div');
  pinTip.style.cssText = 'position:fixed;z-index:60;pointer-events:none;display:none;';
  document.body.appendChild(pinTip);

  // 按气泡 geo 像素坐标渲染钉住卡片（georoam 平移/缩放、refresh、resize 时重新定位）
  function renderPinTip() {
    if (!selectedUserId) { pinTip.style.display = 'none'; return; }
    var d = null;
    usersData().forEach(function (u) { if (u.userId === selectedUserId) d = u; });
    var pt = d && chart.convertToPixel({ geoIndex: 0 }, d.value);
    if (!pt) { pinTip.style.display = 'none'; return; }
    pinTip.innerHTML = '<div class="tt"><div class="tt-head">' + escapeHtml(selectedUserId) +
      '</div><div class="tt-sub">' + escapeHtml(d.name) + ' · 用户标注</div></div>';
    var rect = chart.getDom().getBoundingClientRect();
    pinTip.style.display = 'block';
    var left = rect.left + pt[0] + 14;
    var top = rect.top + pt[1] - Math.round(20 * userSizeFactor()) - pinTip.offsetHeight - 8;
    if (top < 8) top = rect.top + pt[1] + 16; // 顶部放不下时改到点下方
    if (left < rect.left + 8) left = rect.left + 8;
    pinTip.style.left = Math.round(left) + 'px';
    pinTip.style.top = Math.round(top) + 'px';
  }

  // 在地图上显示选中用户的钉住卡片（chip 点击/搜索选中/气泡点击时调用）
  function showUserTip() { renderPinTip(); }

  function arrowWidthCfg() {
    var w = state.style.arrowWidth;
    if (w === 'thin') return { width: 1.2, dot: 3.5, effect: 6 };
    if (w === 'thick') return { width: 3.2, dot: 6, effect: 9 };
    return { width: 2, dot: 4.5, effect: 7 };
  }

  function refresh() {
    stopFlowSeq();
    renderPinTip(); // 用户数据/选中态可能变化，同步钉住卡片位置与显隐
    var st = state.style;
    var icon = centerIconCfg();
    var aw = arrowWidthCfg();
    chart.setOption({
      geo: { regions: geoRegions() },
      series: [
        { id: 'regions', data: regionData() },
        { id: 'names', data: nameLabelsData() },
        {
          id: 'flows', data: flowsData(), animation: false,
          lineStyle: {
            color: st.arrowColor, width: aw.width, opacity: 0.5,
            type: st.arrowLine, curveness: st.arrowCurve === 'straight' ? 0 : 0.22
          },
          effect: {
            show: st.arrowMotion === 'flow', period: seqTiming().period, trailLength: 0.28,
            symbol: 'arrow', symbolSize: aw.effect, color: shade(st.arrowColor, 0.4), loop: true
          }
        },
        {
          id: 'sources', data: sourcesData(),
          symbolSize: aw.dot,
          itemStyle: { color: st.arrowColor, borderColor: '#ffffff', borderWidth: 1, opacity: 0.95 }
        },
        {
          id: 'flowNums', data: $('chkNums').checked ? flowNumsData() : [],
          label: { borderColor: '#9fd4f8', fontSize: 10, fontWeight: 700, color: '#3d4a8f', backgroundColor: 'rgba(255,255,255,.95)' }
        },
        {
          id: 'users', data: usersData().map(function (d) {
            // 被选中的用户气泡：明显放大 + 强蓝色光晕描边，与 chip 高亮联动
            if (selectedUserId && d.userId === selectedUserId) {
              return {
                name: d.name, value: d.value, userId: d.userId,
                symbolSize: Math.round(20 * userSizeFactor() * 1.65),
                symbolOffset: [0, 3],
                itemStyle: { color: bubbleGrad(), borderColor: '#4fc3ff', borderWidth: 3, shadowColor: 'rgba(79,195,255,1)', shadowBlur: 26 },
                label: { color: '#0d5a9e', fontSize: 11, fontWeight: 800 }
              };
            }
            return d;
          }),
          symbolSize: Math.round(20 * userSizeFactor()),
          label: { width: Math.round(16 * userSizeFactor()) },
          itemStyle: { color: bubbleGrad(), borderColor: 'rgba(102,107,206,.35)', borderWidth: 1.2, shadowColor: 'rgba(102,107,206,.25)', shadowBlur: 6 }
        },
        {
          id: 'centerPin', type: 'scatter', data: centerPinData(),
          symbol: icon.symbol, symbolSize: Math.round(icon.size * centerSizeFactor()), symbolOffset: icon.offset,
          itemStyle: icon.hollow
            ? { color: 'rgba(255,255,255,0)', borderColor: iconGrad(), borderWidth: 3, shadowBlur: 0 }
            : icon.halo
              ? { color: icon.halo, borderColor: 'rgba(0,0,0,0)', borderWidth: 0, shadowBlur: 0 }
              : { color: iconGrad(), borderColor: '#ffffff', borderWidth: 2, shadowColor: 'rgba(102,107,206,.5)', shadowBlur: 10 },
          label: { show: !icon.noLabel }
        }
      ]
    });
    updateLegend();
    updateCard();
    saveState();
  }

  function updateLegend() {
    var ps = provinceSums();
    var maxPS = 0;
    Object.keys(ps).forEach(function (p) { if (ps[p] > maxPS) maxPS = ps[p]; });
    legendMaxEl.textContent = maxPS > 0 ? fmtNum(maxPS) : '—';
    var disabled = !state.centers.length;
    $('btnArrowAll').disabled = disabled;
    $('btnArrowNone').disabled = disabled;
    $('markArrow').setAttribute('stroke', state.style.arrowColor);
  }

  // ---------- 右上角 tips 备注框 ----------
  var TIPS_FONT = { small: '12px', medium: '15px', large: '19px' };
  function applyTipsSize() {
    $('tipsText').style.fontSize = TIPS_FONT[state.style.tipsSize] || TIPS_FONT.medium;
  }
  // 恢复/清除备注面板位置与尺寸（拖拽、缩放后的持久化状态）
  function applyTipsRect() {
    var panel = $('tipsPanel'), r = state.style.tipsRect;
    if (r) {
      panel.style.left = r.x + 'px';
      panel.style.top = r.y + 'px';
      panel.style.right = 'auto';
      panel.style.width = r.w + 'px';
      panel.style.height = r.h + 'px';
    } else {
      panel.style.left = panel.style.top = panel.style.width = panel.style.height = '';
      panel.style.right = '';
    }
  }
  function saveTipsRect() {
    var r = $('tipsPanel').getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return; // 面板隐藏时忽略
    state.style.tipsRect = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    saveState();
  }

  function syncStyleUI() {
    var st = state.style;
    Array.prototype.forEach.call($('segMotion').querySelectorAll('button'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-motion') === st.arrowMotion);
    });
    Array.prototype.forEach.call($('segIcon').querySelectorAll('button'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-icon') === st.centerIcon);
    });
    Array.prototype.forEach.call($('segSize').querySelectorAll('button'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-size') === st.centerSize);
    });
    Array.prototype.forEach.call($('segUserSize').querySelectorAll('button'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-size') === st.userSize);
    });
    Array.prototype.forEach.call($('swatchArrow').querySelectorAll('.swatch'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-color') === st.arrowColor);
    });
    Array.prototype.forEach.call($('segWidth').querySelectorAll('button'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-w') === st.arrowWidth);
    });
    Array.prototype.forEach.call($('segLine').querySelectorAll('button'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-line') === st.arrowLine);
    });
    Array.prototype.forEach.call($('segCurve').querySelectorAll('button'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-curve') === st.arrowCurve);
    });
    Array.prototype.forEach.call($('segSpeed').querySelectorAll('button'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-speed') === st.seqSpeed);
    });
    Array.prototype.forEach.call($('segTipsSize').querySelectorAll('button'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-size') === st.tipsSize);
    });
    $('tipsText').textContent = st.tipsText || '';
    applyTipsSize();
    applyTipsRect();
    $('markArrow').setAttribute('stroke', st.arrowColor);
    $('arrowPicker').value = st.arrowColor;
    $('arrowHex').value = st.arrowColor;
  }

  // ---------- 选中卡片 ----------
  function selectCity(name, opts) {
    opts = opts || {};
    if (!CITY_MAP.has(name)) return;
    selected = name;
    updateCard();
    refresh();
  }

  function closeCard() {
    selected = null;
    selectedUserId = null;
    chart.dispatchAction({ type: 'hideTip' });
    updateCard();
    refresh();
  }

  function updateCard() {
    if (!selected || !CITY_MAP.has(selected)) {
      cardEl.classList.add('hidden');
      return;
    }
    var c = CITY_MAP.get(selected);
    var v = state.values[selected];
    $('cardName').textContent = c.name;
    $('cardSub').textContent = regionKind(c);
    valueInput.value = v != null ? v : '';
    renderUserChips();

    var isCenter = state.centers.indexOf(selected) >= 0;
    $('btnCenter').classList.toggle('active', isCenter);
    $('btnCenterText').textContent = isCenter ? '取消中心城市' : '设为中心城市';

    var arrowBtn = $('btnArrow');
    var pickEl = $('centerPick');
    if (!state.centers.length || isCenter) {
      arrowBtn.classList.add('hidden');
      pickEl.classList.add('hidden');
      arrowBtn.disabled = false;
      arrowBtn.title = '';
    } else if (state.centers.length === 1) {
      arrowBtn.classList.remove('hidden');
      pickEl.classList.add('hidden');
      arrowBtn.disabled = false;
      arrowBtn.title = '连线以城市为单位：' + selected + ' → ' + state.centers[0];
      var on = !!state.arrows[selected];
      arrowBtn.classList.toggle('active', on);
      $('btnArrowText').textContent = on ? '移除 ' + selected + ' 的箭头' : '为 ' + selected + ' 添加箭头';
    } else {
      arrowBtn.classList.add('hidden');
      pickEl.classList.remove('hidden');
      pickEl.innerHTML = '<div class="pick-title">为「' + selected + '」选择指向的中心</div>' + state.centers.map(function (n) {
        return '<button class="pick-btn' + (state.arrows[selected] === n ? ' active' : '') + '" data-center="' + n + '">' +
          '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20C8 12 13 8 21 6"/><path d="M15 5l6 1-1 6"/></svg>' + n + '</button>';
      }).join('');
    }
    cardEl.classList.remove('hidden');
  }

  function currentGeoOpt() {
    var opt = chart.getOption();
    return (opt && opt.geo && opt.geo[0]) || {};
  }
  function zoomBy(factor) {
    var g = currentGeoOpt();
    chart.setOption({
      geo: {
        center: g.center || DEFAULT_CENTER,
        zoom: clamp((g.zoom || 1) * factor, 0.7, 20)
      }
    });
  }

  // ---------- 搜索 ----------
  var sugItems = [], sugActive = -1;
  var searchMode = 'city'; // 搜索模式：city 城市 / user 用户
  var SEARCH_PH = { city: '搜索城市，如：成都、杭州…', user: '搜索用户 ID，如：U001…' };

  function setSearchMode(m) {
    searchMode = m === 'user' ? 'user' : 'city';
    state.style.searchMode = searchMode;
    Array.prototype.forEach.call($('searchMode').querySelectorAll('button'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-mode') === searchMode);
    });
    searchInput.placeholder = SEARCH_PH[searchMode];
    saveState();
  }

  function hideSuggest() {
    suggestEl.classList.add('hidden');
    suggestEl.innerHTML = '';
    sugItems = [];
    sugActive = -1;
  }

  // 用户模式搜索：按用户 ID 匹配（忽略大小写），候选右侧显示所属城市
  function renderUserSuggest(sq) {
    var lq = sq.toLowerCase();
    var hits = [];
    Object.keys(state.users).forEach(function (cityName) {
      (state.users[cityName] || []).forEach(function (id) {
        var lid = String(id).toLowerCase();
        var score = lid.indexOf(lq) === 0 ? 0 : (lid.indexOf(lq) >= 0 ? 1 : -1);
        if (score >= 0) hits.push({ userId: String(id), city: cityName, score: score });
      });
    });
    hits.sort(function (a, b) {
      return a.score - b.score || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0);
    });
    sugItems = hits.slice(0, 9);
    sugActive = sugItems.length ? 0 : -1;
    if (!sugItems.length) {
      suggestEl.innerHTML = '<div class="suggest-empty">未找到与「' + sq.replace(/</g, '&lt;') + '」匹配的用户</div>';
      suggestEl.classList.remove('hidden');
      return;
    }
    suggestEl.innerHTML = sugItems.map(function (it, i) {
      var idx = it.userId.toLowerCase().indexOf(lq);
      var nameHtml = it.userId;
      if (idx >= 0) nameHtml = it.userId.slice(0, idx) + '<mark>' + it.userId.slice(idx, idx + sq.length) + '</mark>' + it.userId.slice(idx + sq.length);
      return '<div class="suggest-item' + (i === sugActive ? ' active' : '') + '" data-i="' + i + '">' +
        '<span class="s-name">' + nameHtml + '</span>' +
        '<span class="s-prov">' + it.city + '</span>' +
        '</div>';
    }).join('');
    suggestEl.classList.remove('hidden');
  }

  function renderSuggest(q) {
    var sq = q.trim();
    if (!sq) { hideSuggest(); return; }
    if (searchMode === 'user') { renderUserSuggest(sq); return; }
    var nq = shortName(sq);
    var hits = [];
    CITIES.forEach(function (c) {
      var n = c.name, sh = shortName(n), pv = shortName(c.province);
      var score = -1;
      if (sh.indexOf(nq) === 0 || n.indexOf(sq) === 0) score = 0;
      else if (n.indexOf(sq) >= 0 || sh.indexOf(nq) >= 0 || pv === nq || pv.indexOf(nq) === 0) score = 1;
      if (score >= 0) hits.push({ c: c, score: score });
    });
    hits.sort(function (a, b) {
      return a.score - b.score || a.c.name.length - b.c.name.length || (a.c.adcode < b.c.adcode ? -1 : 1);
    });
    sugItems = hits.slice(0, 9).map(function (h) { return h.c; });
    sugActive = sugItems.length ? 0 : -1;

    if (!sugItems.length) {
      suggestEl.innerHTML = '<div class="suggest-empty">未找到与「' + sq.replace(/</g, '&lt;') + '」匹配的城市</div>';
      suggestEl.classList.remove('hidden');
      return;
    }
    suggestEl.innerHTML = sugItems.map(function (c, i) {
      var nameHtml = c.name;
      var idx = c.name.indexOf(sq);
      if (idx >= 0) {
        nameHtml = c.name.slice(0, idx) + '<mark>' + c.name.slice(idx, idx + sq.length) + '</mark>' + c.name.slice(idx + sq.length);
      }
      return '<div class="suggest-item' + (i === sugActive ? ' active' : '') + '" data-i="' + i + '">' +
        '<span class="s-name">' + nameHtml + '</span>' +
        '<span class="s-prov">' + (c.province === c.name ? '直辖市' : c.province) + '</span>' +
        '</div>';
    }).join('');
    suggestEl.classList.remove('hidden');
  }

  function chooseSuggest(i) {
    var it = sugItems[i];
    if (!it) {
      if (searchInput.value.trim()) toast(searchMode === 'user' ? '未找到匹配的用户' : '未找到匹配的城市');
      return;
    }
    hideSuggest();
    searchInput.blur();
    if (it.userId !== undefined && it.city) {
      // 用户候选 → 选中该用户：气泡高亮 + tooltip，不打开城市编辑卡
      searchInput.value = it.userId;
      selectedUserId = it.userId;
      refresh();
      showUserTip();
      toast('用户 ' + it.userId + ' 位于 ' + it.city);
      return;
    }
    searchInput.value = it.name;
    if (!canEdit()) { toast('只读模式：登录后才能打开城市编辑卡'); return; }
    selectCity(it.name, { fly: true });
  }

  searchInput.addEventListener('input', function () { renderSuggest(searchInput.value); });
  searchInput.addEventListener('focus', function () { renderSuggest(searchInput.value); });
  searchInput.addEventListener('blur', function () { setTimeout(hideSuggest, 120); });
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!sugItems.length) return;
      e.preventDefault();
      sugActive = (sugActive + (e.key === 'ArrowDown' ? 1 : -1) + sugItems.length) % sugItems.length;
      Array.prototype.forEach.call(suggestEl.querySelectorAll('.suggest-item'), function (el, i) {
        el.classList.toggle('active', i === sugActive);
      });
    } else if (e.key === 'Enter') {
      chooseSuggest(sugActive >= 0 ? sugActive : 0);
    } else if (e.key === 'Escape') {
      hideSuggest();
      searchInput.blur();
    }
  });
  suggestEl.addEventListener('mousedown', function (e) {
    var item = e.target.closest('.suggest-item');
    if (item) { e.preventDefault(); chooseSuggest(+item.getAttribute('data-i')); }
  });

  // 搜索模式切换（城市 / 用户）
  $('searchMode').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    setSearchMode(btn.getAttribute('data-mode'));
    hideSuggest();
    renderSuggest(searchInput.value);
    searchInput.focus();
  });

  // ---------- 地图事件 ----------
  chart.on('click', function (p) {
    var name = p.name;
    // 点击用户气泡 → 选中/取消该用户（气泡高亮 + tooltip），不打开城市编辑卡
    if (p.seriesType === 'scatter' && p.data && p.data.userId) {
      selectedUserId = (selectedUserId === p.data.userId) ? null : p.data.userId;
      refresh();
      if (selectedUserId) showUserTip();
      else chart.dispatchAction({ type: 'hideTip' });
      return;
    }
    if ((p.seriesType === 'map' || p.componentType === 'geo' ||
      p.seriesType === 'effectScatter' || p.seriesType === 'scatter' || p.seriesType === 'lines') &&
      name && CITY_MAP.has(name)) {
      if (!canEdit()) return; // 只读模式：悬停时原生 tooltip 可看，点击不打开编辑卡
      selectedUserId = null;
      chart.dispatchAction({ type: 'hideTip' }); // 取消用户选中后立即清掉残留的用户 tooltip
      selectCity(name);
    }
  });
  // 记录按下位置：拖动地图平移时抬起不应视为"点击空白"
  var zrDownPt = null;
  chart.getZr().on('mousedown', function (e) { zrDownPt = { x: e.offsetX, y: e.offsetY }; });
  chart.getZr().on('click', function (e) {
    if (e.target != null) return;
    // 按下→抬起位移超过阈值 = 拖拽平移，不关闭选中态（只有原地点击空白才算"点击其他位置"）
    if (zrDownPt && Math.hypot(e.offsetX - zrDownPt.x, e.offsetY - zrDownPt.y) > 6) return;
    if (selected || selectedUserId) closeCard();
  });
  // 平移/缩放时重新定位钉住卡片，使其始终跟随选中的用户气泡
  chart.on('georoam', function () { renderPinTip(); });

  // ---------- 卡片按钮 ----------
  valueInput.addEventListener('change', function () {
    if (!selected || !requireAdmin()) return;
    var raw = valueInput.value.trim();
    if (raw === '') {
      delete state.values[selected];
    } else {
      var v = Number(raw);
      if (!Number.isFinite(v) || v < 0) { toast('请输入不小于 0 的数字'); updateCard(); return; }
      state.values[selected] = v;
    }
    refresh();
  });

  $('btnCenter').addEventListener('click', function () {
    if (!selected || !requireAdmin()) return;
    var idx = state.centers.indexOf(selected);
    if (idx >= 0) {
      state.centers.splice(idx, 1);
      Object.keys(state.arrows).forEach(function (k) {
        if (state.arrows[k] === selected) delete state.arrows[k];
      });
      toast('已取消 ' + selected + ' 的中心城市');
    } else {
      state.centers.push(selected);
      delete state.arrows[selected];
      toast('已将 ' + selected + ' 设为中心城市');
    }
    refresh();
  });

  $('btnArrow').addEventListener('click', function () {
    if (!selected || !requireAdmin() || !state.centers.length || state.centers.indexOf(selected) >= 0) return;
    if (state.arrows[selected]) {
      delete state.arrows[selected];
      toast('已移除 ' + selected + ' 的箭头');
    } else {
      state.arrows[selected] = state.centers[0];
      toast('已添加 ' + selected + ' → ' + state.centers[0] + ' 的箭头');
    }
    refresh();
  });

  $('centerPick').addEventListener('click', function (e) {
    var btn = e.target.closest('.pick-btn');
    if (!btn || !selected || !requireAdmin()) return;
    var target = btn.getAttribute('data-center');
    if (state.arrows[selected] === target) {
      delete state.arrows[selected];
      toast('已移除 ' + selected + ' → ' + target + ' 的箭头');
    } else {
      state.arrows[selected] = target;
      toast('已添加 ' + selected + ' → ' + target + ' 的箭头');
    }
    refresh();
  });

  // ---------- 用户标注 ----------
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function renderUserChips() {
    var arr = selected ? (state.users[selected] || []) : [];
    $('userChips').innerHTML = arr.map(function (id, i) {
      var active = selectedUserId && selectedUserId === id ? ' chip-active' : '';
      return '<span class="chip' + active + '" data-uid="' + escapeHtml(id) + '">' + escapeHtml(id) + '<button class="chip-x" data-i="' + i + '" title="移除该用户">×</button></span>';
    }).join('');
    $('cardUser').value = '';
  }
  function addUser() {
    if (!selected || !requireAdmin()) return;
    var input = $('cardUser');
    var id = input.value.trim();
    if (!id) { toast('请输入用户 ID'); return; }
    var arr = state.users[selected] || (state.users[selected] = []);
    if (arr.indexOf(id) >= 0) { toast('该用户已存在'); return; }
    arr.push(id);
    saveState();
    refresh();
    renderUserChips();
    input.value = '';
    input.focus();
    toast('已在 ' + selected + ' 添加用户 ' + id);
  }
  $('btnAddUser').addEventListener('click', addUser);
  $('cardUser').addEventListener('keydown', function (e) { if (e.key === 'Enter') addUser(); });
  $('userChips').addEventListener('click', function (e) {
    var btn = e.target.closest('.chip-x');
    if (btn && selected) {
      if (!requireAdmin()) return;
      var arr = state.users[selected];
      if (!arr) return;
      arr.splice(+btn.getAttribute('data-i'), 1);
      if (!arr.length) delete state.users[selected];
      saveState();
      refresh();
      if (selectedUserId) selectedUserId = null;
      renderUserChips();
      toast('已移除用户');
      return;
    }
    // 点击 chip 本身 → 选中/取消选中，地图上对应用户气泡放大 + 蓝色光晕 + 显示 tooltip
    var chip = e.target.closest('.chip');
    if (!chip) return;
    var uid = chip.getAttribute('data-uid');
    if (!selected) return;
    selectedUserId = (selectedUserId === uid) ? null : uid;
    renderUserChips();
    refresh();
    if (selectedUserId) showUserTip();
    else chart.dispatchAction({ type: 'hideTip' });
  });

  $('cardClose').addEventListener('click', closeCard);

  // ---------- 图例按钮 ----------
  $('chkLabels').addEventListener('change', refresh);
  $('chkNames').addEventListener('change', refresh);
  $('chkNums').addEventListener('change', refresh);

  function bindSeg(id, attr, apply) {
    $(id).addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn || !requireAdmin()) return;
      apply(btn.getAttribute(attr));
      Array.prototype.forEach.call($(id).querySelectorAll('button'), function (b) {
        b.classList.toggle('active', b === btn);
      });
      refresh();
    });
  }
  bindSeg('segMotion', 'data-motion', function (v) { state.style.arrowMotion = v; });
  bindSeg('segIcon', 'data-icon', function (v) { state.style.centerIcon = v; });
  bindSeg('segSize', 'data-size', function (v) { state.style.centerSize = v; });
  bindSeg('segUserSize', 'data-size', function (v) { state.style.userSize = v; });
  bindSeg('segWidth', 'data-w', function (v) { state.style.arrowWidth = v; });
  bindSeg('segLine', 'data-line', function (v) { state.style.arrowLine = v; });
  bindSeg('segCurve', 'data-curve', function (v) { state.style.arrowCurve = v; });
  bindSeg('segSpeed', 'data-speed', function (v) { state.style.seqSpeed = v; });

  $('swatchArrow').addEventListener('click', function (e) {
    var btn = e.target.closest('.swatch');
    if (!btn || !requireAdmin()) return;
    state.style.arrowColor = btn.getAttribute('data-color');
    syncStyleUI();
    refresh();
  });

  // 自定义箭头颜色（画板取色 + 手动输入）
  $('arrowPicker').addEventListener('input', function () {
    if (!canEdit()) return;
    state.style.arrowColor = $('arrowPicker').value;
    syncStyleUI();
    refresh();
  });
  $('arrowHex').addEventListener('change', function () {
    if (!requireAdmin()) return;
    var v = $('arrowHex').value.trim();
    if (/^#[0-9a-fA-F]{3}$/.test(v)) v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      state.style.arrowColor = v.toLowerCase();
      syncStyleUI();
      refresh();
    } else {
      toast('请输入正确的颜色值，如 #ff6699');
    }
    $('arrowHex').value = state.style.arrowColor;
  });

  // 就近中心（城市维度）：排除自身；允许连到省内其他中心（如地级市 → 省会）
  function nearestCenter(cityName) {
    var c0 = CITY_MAP.get(cityName);
    if (!c0) return null;
    var best = null, bestD = Infinity;
    state.centers.forEach(function (n) {
      var c = CITY_MAP.get(n);
      if (!c || c.name === cityName) return;
      var dx = c.center[0] - c0.center[0], dy = c.center[1] - c0.center[1];
      var d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = n; }
    });
    return best;
  }

  $('btnArrowAll').addEventListener('click', function () {
    if (!requireAdmin()) return;
    if (!state.centers.length) { toast('请先设置中心城市'); return; }
    state.arrows = {};
    var n = 0;
    Object.keys(state.values).forEach(function (cityName) {
      var t = nearestCenter(cityName);
      if (t) { state.arrows[cityName] = t; n++; }
    });
    refresh();
    toast(n ? '已为 ' + n + ' 个有着色的城市添加箭头（就近指向中心）' : '暂无有着色的城市');
  });
  $('btnArrowNone').addEventListener('click', function () {
    if (!requireAdmin()) return;
    state.arrows = {};
    refresh();
    toast('已移除全部箭头');
  });

  // ---------- 缩放控件 ----------
  $('zoomIn').addEventListener('click', function () { zoomBy(1.5); });
  $('zoomOut').addEventListener('click', function () { zoomBy(1 / 1.5); });
  $('zoomReset').addEventListener('click', function () {
    chart.setOption({ geo: { center: DEFAULT_CENTER, zoom: 1 } });
  });

  // ---------- 顶栏按钮 ----------
  var DEMO_VALUES = {
    '北京市': 912, '上海市': 968, '深圳市': 845, '广州市': 702, '成都市': 634,
    '杭州市': 521, '重庆市': 489, '武汉市': 452, '西安市': 388, '南京市': 356,
    '郑州市': 301, '长沙市': 268, '青岛市': 243, '昆明市': 176, '哈尔滨市': 133,
    '贵阳市': 121, '乌鲁木齐市': 96, '海口市': 72, '银川市': 64, '拉萨市': 38
  };
  var DEMO_ARROWS = ['北京市', '上海市', '重庆市', '西安市', '武汉市', '广州市', '深圳市', '昆明市', '哈尔滨市', '乌鲁木齐市'];

  $('btnDemo').addEventListener('click', function () {
    if (!requireAdmin()) return;
    state.values = {};
    Object.keys(DEMO_VALUES).forEach(function (n) {
      if (CITY_MAP.has(n)) state.values[n] = DEMO_VALUES[n];
    });
    state.arrows = {};
    state.centers = CITY_MAP.has('成都市') ? ['成都市'] : [];
    DEMO_ARROWS.forEach(function (n) {
      if (CITY_MAP.has(n) && state.centers.indexOf(n) < 0) state.arrows[n] = state.centers[0];
    });
    refresh();
    toast('已填充示例数据，可点击城市继续编辑');
  });

  $('btnClear').addEventListener('click', function () {
    if (!requireAdmin()) return;
    if (!confirm('确定清空所有数值、箭头与中心城市设置吗？')) return;
    state = {
      values: {}, arrows: {}, centers: [], users: {},
      style: state.style
    };
    refresh();
    toast('已清空全部数据');
  });

  // 重置：放弃当前修改，强制重新读取 data.json（线上）/ 内置快照（本地双击）；无需登录
  $('btnReset').addEventListener('click', function () {
    if (!confirm('确定恢复为初始数据（data.json）吗？当前修改将被覆盖。')) return;
    var btn = this;
    btn.disabled = true;
    readDefaultState().then(function (s) {
      if (!s) throw new Error('默认数据格式无效');
      applyState(s);
      saveState();
      if (selected || selectedUserId) closeCard();
      setSearchMode(state.style.searchMode === 'user' ? 'user' : 'city');
      syncStyleUI();
      refresh();
      toast((location.protocol === 'http:' || location.protocol === 'https:')
        ? '已重置为 data.json 初始数据' : '已重置为内置初始数据');
    }).catch(function () {
      // 在线读取失败时仍允许用内嵌快照重置
      var s = normalizeState(window.__DEFAULT_MAP_STATE__);
      if (s) {
        applyState(s); saveState();
        if (selected || selectedUserId) closeCard();
        syncStyleUI(); refresh();
        toast('data.json 读取失败，已重置为内置初始数据');
      } else {
        toast('重置失败：无法读取初始数据');
      }
    }).then(function () { btn.disabled = false; });
  });

  // ---------- 点亮播放：先隐藏所有连线和除中心城市外的数据效果，按编号逐个「点亮省份 → 匀速生长连线」 ----------
  var seqTimer = null, seqEndTimer = null, seqToken = 0;
  function stopFlowSeq() {
    seqToken++;
    if (seqTimer) { clearTimeout(seqTimer); seqTimer = null; }
    if (seqEndTimer) { clearTimeout(seqEndTimer); seqEndTimer = null; }
    var btn = $('btnFlowSeq');
    btn.disabled = false;
    btn.classList.remove('playing');
  }
  function seqTiming() {
    var s = state.style.seqSpeed;
    // period = 流动箭头走完全程的秒数（effect.period），生长动画时长与之严格一致
    if (s === 'slow') return { litDur: 500, period: 2.1, rest: 680 };
    if (s === 'fast') return { litDur: 200, period: 1.0, rest: 240 };
    return { litDur: 320, period: 1.5, rest: 340 };
  }
  function playFlowSeq() {
    var flows = flowsData();
    if (!flows.length) { toast('暂无线段，请先添加箭头'); return; }
    stopFlowSeq();
    var token = seqToken;
    var btn = $('btnFlowSeq');
    btn.disabled = true;
    btn.classList.add('playing');
    var aw = arrowWidthCfg();
    var st = state.style;
    var showNums = $('chkNums').checked;
    var tm = seqTiming();
    var litMap = {};
    var i = 0;
    // 第一步：隐藏所有连线和除中心城市外的数据效果（保留中心图钉/高亮）
    chart.setOption({
      geo: { regions: geoRegions({ litMap: {} }) },
      series: [
        { id: 'names', data: [] },
        { id: 'flows', data: [] },
        { id: 'sources', data: [] },
        { id: 'flowNums', data: [] }
      ]
    });
    // 省份点亮渐入动画（easeOut）
    function animateProv(prov, done) {
      var start = null;
      function frame(ts) {
        if (token !== seqToken) return;
        if (start == null) start = ts;
        var p = Math.min((ts - start) / tm.litDur, 1);
        litMap[prov] = 1 - (1 - p) * (1 - p);
        chart.setOption({ geo: { regions: geoRegions({ litMap: litMap }) } });
        if (p < 1) requestAnimationFrame(frame); else done();
      }
      requestAnimationFrame(frame);
    }
    // 连线匀速生长：graphic 样式与最终线段完全一致，箭头跟随线头匀速前进
    function growLine(f, done) {
      var a = chart.convertToPixel({ geoIndex: 0 }, f.coords[0]);
      var b = chart.convertToPixel({ geoIndex: 0 }, f.coords[1]);
      if (!a || !b) { done(); return; }
      var dx = b[0] - a[0], dy = b[1] - a[1];
      var dist = Math.sqrt(dx * dx + dy * dy) || 1;
      // 生长时长 = 流动箭头走完全程的时长，线头推进速度与交接后的流动箭头完全一致
      var dur = tm.period * 1000;
      var straight = st.arrowCurve === 'straight';
      var shape = { x1: a[0], y1: a[1], x2: b[0], y2: b[1], percent: 0 };
      var cx = 0, cy = 0;
      if (!straight) {
        var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        var off = 0.22 * dist;
        // 与 ECharts lines curveness 控制点公式一致：mid + (dy, -dx) * curveness
        cx = mx + dy / dist * off;
        cy = my - dx / dist * off;
        shape.cpx1 = cx;
        shape.cpy1 = cy;
      }
      var gid = 'grow' + i, aid = 'growArrow' + i;
      var style = { stroke: st.arrowColor, lineWidth: aw.width, opacity: 0.5, fill: 'none' };
      if (st.arrowLine === 'dashed') style.lineDash = [8, 5];
      else if (st.arrowLine === 'dotted') style.lineDash = [2, 4];
      chart.setOption({
        graphic: [
          { id: gid, type: straight ? 'line' : 'bezierCurve', shape: shape, silent: true, zlevel: 4, style: style },
          { id: aid, type: 'polygon', shape: { points: [[a[0], a[1]], [a[0], a[1]], [a[0], a[1]]] }, silent: true, zlevel: 4, style: { fill: st.arrowColor, opacity: 0.9 } }
        ]
      });
      var start = null;
      function frame(ts) {
        if (token !== seqToken) { chart.setOption({ graphic: [{ id: gid, $action: 'remove' }, { id: aid, $action: 'remove' }] }); return; }
        if (start == null) start = ts;
        var p = Math.min((ts - start) / dur, 1);
        // 线头坐标与方向
        var hx, hy, tx, ty;
        if (straight) {
          hx = a[0] + dx * p; hy = a[1] + dy * p;
          tx = dx / dist; ty = dy / dist;
        } else {
          var q = 1 - p;
          hx = q * q * a[0] + 2 * q * p * cx + p * p * b[0];
          hy = q * q * a[1] + 2 * q * p * cy + p * p * b[1];
          tx = 2 * q * (cx - a[0]) + 2 * p * (b[0] - cx);
          ty = 2 * q * (cy - a[1]) + 2 * p * (b[1] - cy);
          var tl = Math.sqrt(tx * tx + ty * ty) || 1;
          tx /= tl; ty /= tl;
        }
        chart.setOption({
          graphic: [
            { id: gid, shape: { percent: p } },
            { id: aid, shape: { points: [
              [hx + tx * 4, hy + ty * 4],
              [hx - tx * 2.4 - ty * 3.2, hy - ty * 2.4 + tx * 3.2],
              [hx - tx * 2.4 + ty * 3.2, hy - ty * 2.4 - tx * 3.2]
            ] } }
          ]
        });
        if (p < 1) requestAnimationFrame(frame); else done();
      }
      requestAnimationFrame(frame);
    }
    // 生长完成：用真实线段（带流动效果）替换 graphic
    function showLine(k) {
      var upto = flows.slice(0, k + 1);
      chart.setOption({
        graphic: [{ id: 'grow' + k, $action: 'remove' }, { id: 'growArrow' + k, $action: 'remove' }],
        series: [
          { id: 'flows', data: upto.map(function (g) { return { name: g.name, coords: g.coords }; }) },
          { id: 'sources', data: upto.map(function (g) { return { name: g.name, value: g.coords[0] }; }) },
          { id: 'flowNums', data: showNums ? upto.map(function (g, j) { return { name: String(j + 1), value: flowMid(g.coords) }; }) : [] }
        ]
      });
    }
    function step() {
      if (token !== seqToken) return;
      if (i >= flows.length) {
        seqEndTimer = setTimeout(function () {
          if (token !== seqToken) return;
          stopFlowSeq();
          refresh();
          toast('点亮完毕');
        }, 620);
        return;
      }
      var k = i, f = flows[k];
      var prov = provOf(f.name);
      function next() {
        if (token !== seqToken) return;
        growLine(f, function () {
          if (token !== seqToken) return;
          showLine(k);
          i++;
          seqTimer = setTimeout(step, tm.rest);
        });
      }
      // 着色仍以省为单位：城市所在省已点亮则直接生长连线，避免重复渐入闪烁
      if (litMap[prov] >= 1) { next(); } else { animateProv(prov, next); }
    }
    step();
  }
  $('btnFlowSeq').addEventListener('click', playFlowSeq);
  $('btnExport').addEventListener('click', exportData);
  $('btnImport').addEventListener('click', function () { if (requireAdmin()) $('fileImport').click(); });
  $('fileImport').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (f) importData(f);
    this.value = '';
  });

  $('btnHelp').addEventListener('click', function () { modalEl.classList.remove('hidden'); });
  $('modalClose').addEventListener('click', function () { modalEl.classList.add('hidden'); });
  modalEl.addEventListener('click', function (e) { if (e.target === modalEl) modalEl.classList.add('hidden'); });

  // ---------- 工具栏显隐开关 ----------
  $('btnToggleUI').addEventListener('click', function () {
    var hidden = document.body.classList.toggle('ui-hidden');
    $('iconEyeOn').style.display = hidden ? 'none' : 'block';
    $('iconEyeOff').style.display = hidden ? 'block' : 'none';
    this.title = hidden ? '显示工具栏' : '隐藏工具栏';
    toast(hidden ? '已隐藏工具栏，点击右上角按钮恢复' : '已显示工具栏');
  });

  // ---------- tips 备注框 ----------
  var tipsPanelEl = $('tipsPanel');
  $('btnTips').addEventListener('click', function () {
    var open = tipsPanelEl.classList.toggle('hidden');
    this.classList.toggle('active', !open);
    if (!open && canEdit()) $('tipsText').focus();
  });
  // 编辑态：显示标题栏与字号按钮；点击面板外退出，仅展示内容
  $('tipsText').addEventListener('focus', function () { if (canEdit()) tipsPanelEl.classList.add('editing'); });
  document.addEventListener('mousedown', function (e) {
    if (tipsPanelEl.classList.contains('editing') && !tipsPanelEl.contains(e.target)) {
      tipsPanelEl.classList.remove('editing');
    }
  });
  $('tipsText').addEventListener('input', function () {
    if (!canEdit()) { this.textContent = state.style.tipsText || ''; return; }
    state.style.tipsText = this.textContent.slice(0, 500);
    if (this.textContent.length > 500) this.textContent = state.style.tipsText;
    saveState();
  });
  $('segTipsSize').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn || !requireAdmin()) return;
    state.style.tipsSize = btn.getAttribute('data-size');
    Array.prototype.forEach.call(this.querySelectorAll('button'), function (b) {
      b.classList.toggle('active', b === btn);
    });
    applyTipsSize();
    saveState();
  });

  // 备注面板拖拽（按住"备注"标题移动）与缩放（右下角手柄），位置尺寸自动保存
  (function initTipsDrag() {
    var panel = $('tipsPanel');
    var handle = panel.querySelector('.tips-title');
    var sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    handle.addEventListener('mousedown', function (e) {
      if (e.button !== 0 || !canEdit()) return;
      var r = panel.getBoundingClientRect();
      panel.style.left = r.left + 'px';
      panel.style.top = r.top + 'px';
      panel.style.right = 'auto';
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      dragging = true;
      e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      panel.style.left = clamp(ox + e.clientX - sx, 4, window.innerWidth - 60) + 'px';
      panel.style.top = clamp(oy + e.clientY - sy, 4, window.innerHeight - 40) + 'px';
    });
    document.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      saveTipsRect();
    });
    if (window.ResizeObserver) {
      new ResizeObserver(function () { saveTipsRect(); }).observe(panel);
    }
  })();

  // ---------- 登录 / 退出 ----------
  var loginModalEl = $('loginModal'), loginErrEl = $('loginErr');

  function openLoginModal() {
    $('loginUser').value = '';
    $('loginPass').value = '';
    loginErrEl.classList.add('hidden');
    loginModalEl.classList.remove('hidden');
    $('loginUser').focus();
  }
  function closeLoginModal() { loginModalEl.classList.add('hidden'); }

  function applyAuth() {
    document.body.classList.toggle('readonly', !isAdmin);
    $('btnAuthText').textContent = isAdmin ? '退出' : '登录';
    $('btnAuth').title = isAdmin ? '退出登录（切换为只读浏览）' : '登录后可编辑数据';
    $('tipsText').setAttribute('contenteditable', isAdmin ? 'true' : 'false');
    tipsPanelEl.classList.remove('editing');
    document.querySelector('.legend-caption').textContent = isAdmin
      ? '点击城市编辑数值 · 数值越大颜色越实'
      : '只读浏览模式 · 右上角登录后可编辑数据 · 悬停城市查看数值';
    if (!isAdmin) {
      // 切到只读：收起编辑卡，样式类控件视觉禁用（.edit-only 由 CSS 处理）
      if (selected) closeCard();
    }
  }

  function doLogin() {
    var u = $('loginUser').value.trim(), p = $('loginPass').value;
    if (u === AUTH.user && p === AUTH.pass) {
      isAdmin = true;
      try { sessionStorage.setItem(AUTH_KEY, '1'); } catch (e) { /* ignore */ }
      closeLoginModal();
      applyAuth();
      toast('登录成功，可编辑数据');
    } else {
      loginErrEl.classList.remove('hidden');
      $('loginPass').select();
    }
  }
  $('btnAuth').addEventListener('click', function () {
    if (isAdmin) {
      isAdmin = false;
      try { sessionStorage.removeItem(AUTH_KEY); } catch (e) { /* ignore */ }
      applyAuth();
      toast('已退出，切换为只读浏览');
    } else {
      openLoginModal();
    }
  });
  $('loginOk').addEventListener('click', doLogin);
  $('loginCancel').addEventListener('click', closeLoginModal);
  loginModalEl.addEventListener('click', function (e) { if (e.target === loginModalEl) closeLoginModal(); });
  $('loginPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  $('loginUser').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('loginPass').focus(); });

  // ---------- 全局键盘 ----------
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement !== searchInput && document.activeElement !== valueInput) {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    } else if (e.key === 'Escape') {
      if (!loginModalEl.classList.contains('hidden')) closeLoginModal();
      else if (!modalEl.classList.contains('hidden')) modalEl.classList.add('hidden');
      else if (!suggestEl.classList.contains('hidden')) hideSuggest();
      else if (selected || selectedUserId) closeCard();
    }
  });

  // ---------- 启动 ----------
  window.addEventListener('resize', function () { chart.resize(); renderPinTip(); });
  chart.setOption(baseOption());
  loadState().then(function () {
    setSearchMode(state.style.searchMode === 'user' ? 'user' : 'city');
    syncStyleUI();
    applyAuth();
    refresh();
  });
})();
