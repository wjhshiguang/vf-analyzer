/* 滚轮选择器 — 把数字输入框变成「苹果闹钟」式滚轮（底部弹层 + 滚动吸附） */
(function () {
  'use strict';

  var ITEM_H = 40;      // 每行高度
  var PAD = ITEM_H * 2; // 上下垫 2 行使首末项可居中

  /* ---------------- 字段配置 ---------------- */
  var VA_VALUES = [0.05, 0.08, 0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.2, 1.5, 2];
  var STEREO_VALUES = [20, 25, 30, 40, 50, 60, 70, 80, 100, 120, 140, 160, 180, 200, 300, 400, 500, 600, 700, 800, 1000];

  var EXACT = {
    'basic.age':           { min: 1, max: 100, step: 1, def: 12 },
    'basic.rxOD.axis':     { min: 0, max: 180, step: 1 },
    'basic.rxOS.axis':     { min: 0, max: 180, step: 1 },
    'basic.vaNakedOD':     { values: VA_VALUES, def: 1 },
    'basic.vaNakedOS':     { values: VA_VALUES, def: 1 },
    'basic.vaCorrectedOD': { values: VA_VALUES, def: 1 },
    'basic.vaCorrectedOS': { values: VA_VALUES, def: 1 },
    'habits.nearHours':    { min: 0, max: 24, step: 0.5, def: 6 },
    'accom.ampOD':         { min: 0, max: 20, step: 0.25 },
    'accom.ampOS':         { min: 0, max: 20, step: 0.25 },
    'accom.ampOU':         { min: 0, max: 20, step: 0.25 },
    'accom.nra':           { min: 0, max: 5, step: 0.25 },
    'accom.pra':           { min: 0, max: 5, step: 0.25 },
    'accom.bcc':           { min: -2, max: 2.5, step: 0.25, sign: true, def: 0 },
    'accom.flipOD':        { min: 0, max: 30, step: 0.5 },
    'accom.flipOS':        { min: 0, max: 30, step: 0.5 },
    'accom.flipOU':        { min: 0, max: 30, step: 0.5 },
    'verg.distPhoriaVal':  { min: 0, max: 30, step: 1 },
    'verg.nearPhoriaVal':  { min: 0, max: 30, step: 1 },
    'verg.aca':            { min: 0, max: 12, step: 0.5, def: 4 },
    'verg.npc':            { min: 0, max: 40, step: 0.5 },
    'verg.vergFlex':       { min: 0, max: 30, step: 0.5 },
    'binoc.stereo':        { values: STEREO_VALUES, def: 40 },
    'binoc.aniseikonia':   { min: 0, max: 10, step: 0.5 },
    'other.pd':            { min: 40, max: 90, step: 0.5, def: 62 }
  };

  function configFor(path) {
    if (EXACT[path]) return EXACT[path];
    if (/\.sph$/.test(path)) return { dual: true, min: -30, max: 30, step: 0.25 };
    if (/\.cyl$/.test(path)) return { dual: true, min: -10, max: 10, step: 0.25 };
    if (/^verg\.(distBI|distBO|nearBI|nearBO)\./.test(path)) return { min: 0, max: 50, step: 1 };
    return null;
  }

  /* ---------------- 数值与标签 ---------------- */
  function decimalsOf(step) {
    var s = String(step);
    return s.indexOf('.') >= 0 ? s.split('.')[1].length : 0;
  }
  function fmt(v, step, sign) {
    var dec = decimalsOf(step);
    var s = v.toFixed(dec);
    if (dec > 0) s = s.replace(/\.?0+$/, '');
    if (sign && v > 0) s = '+' + s;
    return s;
  }
  function buildRange(min, max, step) {
    var list = [];
    for (var v = min; v <= max + 1e-9; v += step) list.push(Math.round(v * 10000) / 10000);
    return list;
  }
  function nearestIndex(values, target) {
    var best = 0, bestD = Infinity;
    for (var i = 0; i < values.length; i++) {
      var d = Math.abs(values[i] - target);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /* ---------------- DOM ---------------- */
  var overlay, titleEl, wheelsEl;
  var current = null; // { input, cfg, cols: [{el, labels, index, snapTimer}] }

  function buildDom() {
    overlay = document.createElement('div');
    overlay.className = 'wp-overlay';
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="wp-sheet" role="dialog" aria-modal="true">' +
        '<div class="wp-header">' +
          '<button type="button" class="wp-btn wp-cancel">取消</button>' +
          '<span class="wp-title"></span>' +
          '<button type="button" class="wp-btn wp-clear">清除</button>' +
          '<button type="button" class="wp-btn wp-ok">确定</button>' +
        '</div>' +
        '<div class="wp-wheels"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    titleEl = overlay.querySelector('.wp-title');
    wheelsEl = overlay.querySelector('.wp-wheels');

    overlay.querySelector('.wp-cancel').addEventListener('click', close);
    overlay.querySelector('.wp-clear').addEventListener('click', function () { commit(''); });
    overlay.querySelector('.wp-ok').addEventListener('click', function () { commit(assemble()); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function (e) {
      if (!overlay.hidden && e.key === 'Escape') close();
    });
  }

  function makeWheel(labels, initialIdx) {
    var wheel = document.createElement('div');
    wheel.className = 'wp-wheel';
    var items = document.createElement('div');
    items.className = 'wp-items';
    labels.forEach(function (lb, i) {
      var d = document.createElement('div');
      d.className = 'wp-item';
      d.textContent = lb;
      d.addEventListener('click', function () {
        wheel.scrollTo({ top: i * ITEM_H, behavior: 'smooth' });
      });
      items.appendChild(d);
    });
    wheel.appendChild(items);
    var col = { el: wheel, items: items, index: initialIdx, snapTimer: null };
    wheel.addEventListener('scroll', function () {
      clearTimeout(col.snapTimer);
      col.snapTimer = setTimeout(function () { settle(col); }, 90);
    });
    return col;
  }

  function settle(col) {
    var idx = Math.round(col.el.scrollTop / ITEM_H);
    idx = Math.max(0, Math.min(col.items.children.length - 1, idx));
    col.index = idx;
    if (Math.abs(col.el.scrollTop - idx * ITEM_H) > 1) {
      col.el.scrollTo({ top: idx * ITEM_H, behavior: 'smooth' });
    }
    mark(col);
  }

  function mark(col) {
    var kids = col.items.children;
    for (var i = 0; i < kids.length; i++) kids[i].classList.toggle('on', i === col.index);
  }

  /* ---------------- 打开 / 关闭 / 取值 ---------------- */
  function open(input, cfg) {
    current = { input: input, cfg: cfg, cols: [] };
    titleEl.textContent = titleFor(input);
    wheelsEl.innerHTML = '<div class="wp-band"></div>';

    var raw = input.value.trim();
    var num = raw === '' ? NaN : parseFloat(raw);

    if (cfg.dual) {
      var ints = [], i;
      for (i = cfg.min; i <= cfg.max; i++) {
        if (i === 0) { ints.push('-0', '+0'); }
        else ints.push(i > 0 ? '+' + i : String(i));
      }
      var dec = decimalsOf(cfg.step);
      var factor = Math.pow(10, dec);
      var fracs = [];
      for (i = 0; i < 1 / cfg.step; i++) {
        fracs.push('.' + String(Math.round(i * cfg.step * factor)).padStart(dec, '0'));
      }

      var intIdx = ints.indexOf('+0'), fracIdx = 0;
      if (!isNaN(num)) {
        var sign = num < 0 ? '-' : '+';
        var abs = Math.abs(num);
        var ip = Math.floor(abs + 1e-6);
        fracIdx = Math.round((abs - ip) / cfg.step);
        if (fracIdx >= fracs.length) { ip++; fracIdx = 0; }
        var found = ints.indexOf(sign + ip);
        if (found >= 0) intIdx = found;
      }
      addCol(ints, intIdx);
      addCol(fracs, fracIdx);
    } else {
      var values = cfg.values || buildRange(cfg.min, cfg.max, cfg.step);
      var labels = values.map(function (v) { return fmt(v, cfg.step || 1, cfg.sign); });
      var idx = 0;
      if (!isNaN(num)) idx = nearestIndex(values, num);
      else if (cfg.def != null) idx = nearestIndex(values, cfg.def);
      addCol(labels, idx);
      current.values = values;
    }

    wheelsEl.insertAdjacentHTML('beforeend', '<div class="wp-mask top"></div><div class="wp-mask bottom"></div>');
    overlay.hidden = false;
    document.body.classList.add('wp-lock');
    requestAnimationFrame(function () { overlay.classList.add('show'); });

    current.cols.forEach(function (col) {
      col.el.scrollTop = col.index * ITEM_H;
      mark(col);
    });
  }

  function addCol(labels, idx) {
    var col = makeWheel(labels, idx);
    wheelsEl.appendChild(col.el);
    current.cols.push(col);
  }

  function assemble() {
    var cfg = current.cfg;
    if (cfg.dual) {
      return current.cols[0].items.children[current.cols[0].index].textContent +
             current.cols[1].items.children[current.cols[1].index].textContent;
    }
    return fmt(current.values[current.cols[0].index], cfg.step || 1, cfg.sign);
  }

  function commit(str) {
    var input = current.input;
    if (input.value !== str) {
      input.value = str;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.classList.remove('wp-flash');
      void input.offsetWidth;
      input.classList.add('wp-flash');
    }
    close();
  }

  function close() {
    if (!current) return;
    current = null;
    overlay.classList.remove('show');
    document.body.classList.remove('wp-lock');
    setTimeout(function () { overlay.hidden = true; }, 220);
  }

  /* ---------------- 标题 ---------------- */
  function titleFor(input) {
    var t = '';
    var field = input.closest('.field');
    if (field) {
      var span = field.querySelector(':scope > span');
      if (span) t = (span.childNodes[0] ? span.childNodes[0].textContent : span.textContent).trim();
    }
    if (!t) {
      var p = input.previousElementSibling;
      while (p && !p.classList.contains('fusion-row-head')) p = p.previousElementSibling;
      if (p) t = p.textContent.trim();
    }
    if (input.placeholder && input.placeholder.indexOf('如') !== 0) t += ' · ' + input.placeholder;
    return t || '输入数值';
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    buildDom();
    document.querySelectorAll('input[type="number"][data-field]').forEach(function (input) {
      var cfg = configFor(input.getAttribute('data-field'));
      if (!cfg) return;
      input.readOnly = true;
      input.setAttribute('inputmode', 'none');
      input.classList.add('wheel-input');
      input.addEventListener('focus', function () { input.blur(); });
      input.addEventListener('click', function () { open(input, cfg); });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
