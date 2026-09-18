/* 视功能分析助手 — UI 逻辑：表单收集、localStorage、报告渲染、历史记录、PWA 注册 */
(function () {
  'use strict';

  var DRAFT_KEY = 'vf_draft_v1';
  var RECORDS_KEY = 'vf_records_v1';

  /* ---------------- 数据模型 ---------------- */
  function emptyInput() {
    return {
      basic: { age: null, gender: '', wearType: '', complaint: '',
        rxOD: { sph: null, cyl: null, axis: null }, rxOS: { sph: null, cyl: null, axis: null },
        vaNakedOD: null, vaNakedOS: null, vaCorrectedOD: null, vaCorrectedOS: null,
        cycloplegia: '', fogging: '' },
      symptoms: { eyeStrain: false, blurAfterNear: false, headache: false, lineSkip: false,
        diplopia: false, drowsy: false, duration: '', timeOfDay: '' },
      habits: { nearHours: null, continuousUse: false },
      history: { strabismus: false, surgery: false, inTraining: false },
      redFlags: { suddenVisionLoss: false, monoDiplopia: false, newDiplopia: false, eyeMoveLimit: false,
        pupilAbnormal: false, severePain: false, fieldDefect: false, exophthalmos: false,
        recentTrauma: false, cantCooperate: false },
      accom: { ampMethod: 'pushup', ampOD: null, ampOS: null, ampOU: null,
        nra: null, pra: null, bcc: null, flipOD: null, flipOS: null, flipOU: null },
      verg: { distPhoriaVal: null, distPhoriaDir: 'exo', nearPhoriaVal: null, nearPhoriaDir: 'exo',
        aca: null, acaMethod: 'calc', npc: null, vergFlex: null,
        distBI: { blur: null, break: null, rec: null }, distBO: { blur: null, break: null, rec: null },
        nearBI: { blur: null, break: null, rec: null }, nearBO: { blur: null, break: null, rec: null } },
      binoc: { worth4: '', stereo: null, aniseikonia: null },
      other: { eyeMove: '', pd: null }
    };
  }

  function setDeep(obj, path, value) {
    var keys = path.split('.'), cur = obj;
    for (var i = 0; i < keys.length - 1; i++) {
      if (!(keys[i] in cur)) cur[keys[i]] = {};
      cur = cur[keys[i]];
    }
    cur[keys[keys.length - 1]] = value;
  }
  function getDeep(obj, path) {
    var keys = path.split('.'), cur = obj;
    for (var i = 0; i < keys.length; i++) {
      if (cur == null) return undefined;
      cur = cur[keys[i]];
    }
    return cur;
  }

  function collectInput() {
    var data = emptyInput();
    document.querySelectorAll('[data-field]').forEach(function (el) {
      var path = el.getAttribute('data-field');
      if (el.type === 'checkbox') setDeep(data, path, el.checked);
      else if (el.type === 'number') setDeep(data, path, el.value === '' ? null : parseFloat(el.value));
      else setDeep(data, path, el.value);
    });
    return data;
  }

  function fillForm(data) {
    document.querySelectorAll('[data-field]').forEach(function (el) {
      var v = getDeep(data, el.getAttribute('data-field'));
      if (v === undefined || v === null) return;
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v;
    });
    updateNormHints();
  }

  function clearForm() {
    document.querySelectorAll('[data-field]').forEach(function (el) {
      if (el.type === 'checkbox') el.checked = false;
      else if (el.tagName === 'SELECT') el.selectedIndex = 0;
      else el.value = '';
    });
    updateNormHints();
  }

  /* ---------------- 存储 ---------------- */
  function saveDraft() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(collectInput())); } catch (e) {}
  }
  function loadDraft() {
    try {
      var s = localStorage.getItem(DRAFT_KEY);
      if (!s) return false;
      fillForm(JSON.parse(s));
      return true;
    } catch (e) { return false; }
  }
  function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} }

  function getRecords() {
    try { return JSON.parse(localStorage.getItem(RECORDS_KEY)) || []; } catch (e) { return []; }
  }
  function setRecords(list) {
    try { localStorage.setItem(RECORDS_KEY, JSON.stringify(list)); } catch (e) {}
    updateHistoryBadge();
  }
  function updateHistoryBadge() {
    document.getElementById('history-count').textContent = getRecords().length;
  }

  /* ---------------- 步骤导航 ---------------- */
  var panels = { 1: 'step-1', 2: 'step-2', 3: 'step-3', history: 'history-view' };
  function goto(key) {
    Object.keys(panels).forEach(function (k) {
      document.getElementById(panels[k]).classList.toggle('active', k === String(key));
    });
    document.querySelectorAll('.step-tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-goto') === String(key));
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (key === 'history') renderHistory();
  }

  /* ---------------- 正常值动态提示 ---------------- */
  function updateNormHints() {
    var age = parseFloat((document.querySelector('[data-field="basic.age"]') || {}).value);
    var hasAge = !isNaN(age) && age > 0;
    var hints = {
      amp: hasAge ? '正常 ≥ ' + (Math.round((15 - 0.25 * age) * 10) / 10) + ' D（Hofstetter）' : '正常 ≥ 15−0.25×年龄（Hofstetter）',
      nra: '正常 +1.75 ~ +2.50 D',
      pra: '正常 −1.75 ~ −3.00 D',
      bcc: '正常 +0.25 ~ +0.75 D',
      flipMono: hasAge ? (age < 13 ? '正常 ≥ 7 cpm（8~12 岁）' : age <= 30 ? '正常 ≥ 11 cpm（13~30 岁）' : '参照成人 ≥ 11 cpm') : '8~12 岁 ≥7；13~30 岁 ≥11 cpm',
      flipBin: hasAge ? (age < 13 ? '正常 ≥ 5 cpm（8~12 岁）' : age <= 30 ? '正常 ≥ 8 cpm（13~30 岁）' : '参照成人 ≥ 8 cpm') : '8~12 岁 ≥5；13~30 岁 ≥8 cpm',
      distPhoria: '正常 1Δ 内隐斜 ~ 3Δ 外隐斜',
      nearPhoria: '正常 0~6Δ 外隐斜（Morgan）',
      aca: '正常 3~5 Δ/D（Morgan）',
      npc: '破裂点 <6cm 正常；≥6cm 后退',
      vergFlex: '参考 ≥ 9 cpm（经验值）',
      worth: '正常为 4 灯（双眼单视）',
      stereo: hasAge ? (age < 7 ? '该年龄 <200 弧秒可接受' : '正常 ≤60 弧秒（成人约 40）') : '成人 ≤40~60 弧秒；儿童按年龄放宽',
      aniseikonia: '>0.75% 可致视疲劳；>3~5% 影响融合'
    };
    document.querySelectorAll('[data-norm]').forEach(function (el) {
      el.textContent = hints[el.getAttribute('data-norm')] || '';
    });
  }

  /* ---------------- 报告渲染 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderReferral(result) {
    return '<div class="report"><div class="report-head" style="background:linear-gradient(135deg,#8e2f22,#c0392b)">' +
      '<h2>转诊提示</h2><div class="meta"><span>报告编号 ' + result.meta.id + '</span><span>' + result.meta.date + ' ' + result.meta.time + '</span></div></div>' +
      '<div class="report-body"><div class="alert alert-danger"><strong>红旗征筛查未通过 — 已终止视功能分析</strong>' + esc(result.message) + '</div>' +
      '<h3>命中项目</h3><ul>' + result.flags.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>' +
      '<div class="report-foot">本提示由规则引擎自动生成。请结合临床检查由专业医师确认。</div></div></div>';
  }

  function panePair(pro, plain) {
    return '<div class="dual">' +
      '<div class="pane pane-pro"><span class="pane-label">专业分析</span>' + pro.map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('') + '</div>' +
      '<div class="pane pane-plain"><span class="pane-label">通俗解读</span>' + plain.map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('') + '</div></div>';
  }

  function statusBadge(status) {
    var cls = status === '正常' ? 'st-ok' : status === '未查' || status === '未评' ? 'st-na' : 'st-low';
    return '<span class="' + cls + '">' + esc(status) + '</span>';
  }

  function renderReport(result, input) {
    if (result.referral) return renderReferral(result);
    var b = result.basic;
    var h = '';

    h += '<div class="report"><div class="report-head"><h2>视功能检查分析报告</h2>' +
      '<div class="meta"><span>报告编号 ' + result.meta.id + '</span><span>' + result.meta.date + ' ' + result.meta.time + '</span><span>规则引擎本地生成</span></div></div><div class="report-body">';

    // 一、顾客信息摘要
    var rxText = function (rx) {
      if (rx.sph == null) return '未填';
      return (rx.sph > 0 ? '+' : '') + rx.sph.toFixed(2) + 'DS' + (rx.cyl != null ? ' / ' + (rx.cyl > 0 ? '+' : '') + rx.cyl.toFixed(2) + 'DC' : '') + (rx.axis != null ? ' ×' + rx.axis : '');
    };
    h += '<h3>一、顾客信息摘要</h3><p>' +
      (b.age != null ? esc(b.age) + ' 岁' : '年龄未填') + (b.gender ? '，' + esc(b.gender) : '') +
      (b.wearType ? '，' + esc(b.wearType) : '') + '。' +
      (b.complaint ? '主诉：' + esc(b.complaint) + '。' : '') +
      (result.symptomList.length ? '症状：' + result.symptomList.map(esc).join('、') + (result.durationLabel ? '，持续 ' + result.durationLabel : '') + (result.timeOfDay ? '，' + esc(result.timeOfDay) + '最明显' : '') + '。' : '') +
      '<br>屈光处方：OD ' + rxText(b.rxOD) + '　OS ' + rxText(b.rxOS) +
      '；矫正视力：OD ' + (b.vaCorrectedOD != null ? b.vaCorrectedOD : '未填') + '　OS ' + (b.vaCorrectedOS != null ? b.vaCorrectedOS : '未填') +
      '；' + (b.cycloplegia === 'yes' ? '已散瞳' : b.cycloplegia === 'no' ? '未散瞳' : '散瞳状态未填') + '</p>';

    // 二、数据总览
    h += '<h3>二、检查数据总览</h3>';
    if (result.overview.rows.length) {
      h += '<table class="rpt-table"><thead><tr><th>项目</th><th>测量值</th><th>正常参考（含来源）</th><th>判定</th></tr></thead><tbody>';
      result.overview.rows.forEach(function (r) {
        h += '<tr><td>' + esc(r.key) + '</td><td class="num">' + esc(r.value) + '</td><td>' + esc(r.norm) + '</td><td>' + statusBadge(r.status) + '</td></tr>';
      });
      h += '</tbody></table>';
    }
    if (result.overview.unchecked.length) {
      h += '<div class="alert alert-warn"><strong>未检查项目</strong>' + result.overview.unchecked.map(esc).join('；') + ' — 相应维度无法评估</div>';
    }
    if (result.validation.suspicious.length) {
      h += '<div class="alert alert-warn"><strong>存疑数据（请核实后再参考结论）</strong><ul>' +
        result.validation.suspicious.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div>';
    }

    // 三、分析结果
    h += '<h3>三、分析结果</h3>';
    h += '<h4>3.1 调节功能</h4>' + panePair(result.accom.pro, result.accom.plain);
    h += '<h4>3.2 聚散功能</h4>' + panePair(result.verg.pro, result.verg.plain);
    h += '<h4>3.3 三级视功能</h4>' + panePair(result.binoc.pro, result.binoc.plain);

    // 远视储备
    if (result.reserve) {
      h += '<h4>3.4 远视储备评估（散瞳后等效球镜，WS/T 10039-2025）</h4>';
      result.reserve.eyes.forEach(function (e) {
        h += '<p>' + e.eye + ' 等效球镜 ' + (e.se > 0 ? '+' : '') + e.se + ' D，该年龄下限 +' + result.reserve.min + ' D — ' +
          (e.insufficient ? '<span class="st-low">远视储备不足，建议 3~6 个月复查</span>' : '<span class="st-ok">储备在正常范围</span>') + '</p>';
      });
    }

    // 四、综合诊断
    h += '<h3>四、综合诊断结论</h3>';
    if (result.diagnoses.length) {
      result.diagnoses.forEach(function (dx, i) {
        h += '<div class="dx-card' + (i === 0 ? ' primary-dx' : '') + '"><div class="dx-name">' + (i + 1) + '. ' + esc(dx.name) +
          (dx.role ? '（' + esc(dx.role) + '）' : '') + (i === 0 ? ' — 首要诊断' : '') + '</div>' +
          '<div class="dx-basis">依据：' + esc(dx.basis) + '</div></div>';
      });
      if (result.extraDxCount) h += '<p class="note">另有 ' + result.extraDxCount + ' 项轻度异常未列入主要诊断，详见各维度分析。</p>';
      if (result.relationNotes.length) {
        h += '<p><strong>关联分析：</strong>' + result.relationNotes.map(esc).join(' ') + '</p>';
      }
    } else {
      h += '<p>本次检查各维度指标均在年龄对应正常范围内，未见明显功能性视功能异常。</p>';
    }

    // 五、严重程度
    var sevClass = result.severity.level === '重度' ? 'sev-重' : result.severity.level === '中度' ? 'sev-中' : result.severity.level === '轻度' ? 'sev-轻' : 'sev-轻';
    h += '<h3>五、严重程度评估</h3><p><span class="severity-pill ' + sevClass + '">' + esc(result.severity.level) + '</span></p>' +
      '<ul>' + result.severity.reasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>';

    // 六、建议方案
    h += '<h3>六、建议方案</h3>';
    h += '<h4>6.1 配镜建议</h4><ul>' + result.plan.glasses.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
    if (result.plan.training.length) {
      h += '<h4>6.2 视觉训练方案</h4>';
      result.plan.phases.forEach(function (p) {
        h += '<p><strong>' + esc(p.name) + '</strong>：' + esc(p.desc) + '</p>';
      });
      result.plan.training.forEach(function (t, i) {
        h += '<div class="train-item"><h5>训练项目' + '一二三四'[i] + '：' + esc(t.name) + '</h5><dl>' +
          '<dt>所需工具</dt><dd>' + esc(t.tool) + '</dd>' +
          '<dt>操作步骤</dt><dd>' + esc(t.steps) + '</dd>' +
          '<dt>训练参数</dt><dd>' + esc(t.params) + '</dd>' +
          '<dt>进阶标准</dt><dd>' + esc(t.advance) + '</dd>' +
          '<dt>训练地点</dt><dd>' + esc(t.place) + '</dd>' +
          (t.taboo ? '<dt>禁忌</dt><dd>' + esc(t.taboo) + '</dd>' : '') + '</dl></div>';
      });
      if (result.plan.trainingCycle) h += '<div class="alert alert-warn"><strong>训练周期与安全提示</strong>' + esc(result.plan.trainingCycle) + '</div>';
    } else {
      h += '<h4>6.2 视觉训练方案</h4><p>本次检查未发现需要通过视觉训练干预的指标异常，无需训练。</p>';
    }
    h += '<h4>6.3 用眼习惯指导</h4><ul>' + result.plan.habits.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
    h += '<h4>6.4 复查计划</h4><ul>' + result.plan.followup.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';

    // 七、局限性
    h += '<h3>七、数据不足与局限性声明</h3><ul>' + result.limitations.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';

    // 八、免责声明
    h += '<h3>八、免责声明</h3><p>' + esc(result.disclaimer) + '</p>';
    h += '<div class="report-foot">正常参考值来源：Hofstetter 公式、Morgan 正常值、CITT 临床标准、WS/T 10039-2025、《近视防治指南（2024 年版）》。分析逻辑遵循《视功能自动分析提示词（修正版）》。</div>';
    h += '</div></div>';
    return h;
  }

  /* ---------------- 历史记录 ---------------- */
  function renderHistory() {
    var list = getRecords();
    var box = document.getElementById('history-list');
    if (!list.length) {
      box.innerHTML = '<div class="empty-state"><p>暂无历史记录。生成报告后会自动保存到这里。</p></div>';
      return;
    }
    box.innerHTML = list.map(function (r) {
      return '<div class="hist-item"><div class="hist-info">' +
        '<div class="hist-title">' + esc(r.date) + ' ' + esc(r.time) + '　' + (r.age != null ? esc(r.age) + ' 岁' : '') + (r.gender ? ' · ' + esc(r.gender) : '') + '</div>' +
        '<div class="hist-sub">' + (r.dx && r.dx.length ? esc(r.dx.join('；')) : (r.referral ? '已建议转诊' : '未见明显异常')) + (r.complaint ? '　｜　' + esc(r.complaint) : '') + '</div>' +
        '</div><div class="hist-actions">' +
        '<button class="btn btn-ghost" data-act="view" data-id="' + r.id + '" type="button">查看报告</button>' +
        '<button class="btn btn-ghost" data-act="load" data-id="' + r.id + '" type="button">载入数据</button>' +
        '<button class="btn-danger-ghost" data-act="del" data-id="' + r.id + '" type="button">删除</button>' +
        '</div></div>';
    }).join('');
  }

  /* ---------------- Toast ---------------- */
  var toastTimer = null;
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  /* ---------------- 事件绑定 ---------------- */
  function init() {
    // 草稿恢复
    if (loadDraft()) toast('已恢复上次未完成的录入');
    updateHistoryBadge();
    updateNormHints();

    // 输入监听：草稿自动保存 + 正常值提示联动
    var saveTimer = null;
    document.addEventListener('input', function (e) {
      if (!e.target.hasAttribute('data-field')) return;
      if (e.target.getAttribute('data-field') === 'basic.age') updateNormHints();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveDraft, 500);
    });
    document.addEventListener('change', function (e) {
      if (e.target.hasAttribute('data-field')) saveDraft();
    });

    // 步骤导航
    document.querySelectorAll('[data-goto]').forEach(function (btn) {
      btn.addEventListener('click', function () { goto(btn.getAttribute('data-goto')); });
    });
    document.querySelectorAll('[data-next]').forEach(function (btn) {
      btn.addEventListener('click', function () { goto(btn.getAttribute('data-next')); });
    });

    // 生成报告
    document.getElementById('btn-analyze').addEventListener('click', function () {
      var input = collectInput();
      var result = VFEngine.analyze(input);
      document.getElementById('report-container').innerHTML = renderReport(result, input);
      document.getElementById('report-actions').hidden = false;
      // 保存历史
      var list = getRecords();
      list.unshift({
        id: result.meta.id, date: result.meta.date, time: result.meta.time,
        age: input.basic.age, gender: input.basic.gender, complaint: input.basic.complaint,
        referral: result.referral,
        dx: result.referral ? [] : result.diagnoses.map(function (d) { return d.name; }),
        input: input, report: result
      });
      if (list.length > 100) list = list.slice(0, 100);
      setRecords(list);
      goto(3);
      toast(result.referral ? '发现红旗征，已生成转诊提示' : '报告已生成并保存到历史记录');
    });

    // 打印
    document.getElementById('btn-print').addEventListener('click', function () { window.print(); });

    // 新建
    document.getElementById('btn-new').addEventListener('click', function () {
      if (!confirm('新建顾客将清空当前表单（报告已保存在历史记录中）。继续？')) return;
      clearForm(); clearDraft();
      document.getElementById('report-container').innerHTML = '<div class="empty-state"><p>尚未生成报告。请完成第 1、2 步后点击「生成分析报告」。</p></div>';
      document.getElementById('report-actions').hidden = true;
      goto(1);
      toast('已开始新顾客录入');
    });

    // 历史记录
    document.getElementById('btn-history').addEventListener('click', function () { goto('history'); });
    document.getElementById('btn-back-main').addEventListener('click', function () { goto(1); });
    document.getElementById('history-list').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-act]');
      if (!btn) return;
      var id = btn.getAttribute('data-id');
      var list = getRecords();
      var rec = list.filter(function (r) { return r.id === id; })[0];
      if (!rec) return;
      var act = btn.getAttribute('data-act');
      if (act === 'del') {
        if (!confirm('确定删除这条记录？删除后不可恢复。')) return;
        setRecords(list.filter(function (r) { return r.id !== id; }));
        renderHistory();
        toast('记录已删除');
      } else if (act === 'view') {
        document.getElementById('report-container').innerHTML = renderReport(rec.report, rec.input);
        document.getElementById('report-actions').hidden = false;
        goto(3);
      } else if (act === 'load') {
        fillForm(rec.input);
        saveDraft();
        goto(1);
        toast('已载入该顾客的检查数据');
      }
    });

    // Service Worker 注册
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
