/*
 * 视功能分析规则引擎
 * 依据《视功能自动分析提示词（修正版）》实现的纯前端确定性规则引擎。
 * 约定：隐斜符号——外隐斜为正、内隐斜为负；NRA 内部为正值、PRA 内部为负值；未查字段为 null。
 */
(function (global) {
  'use strict';

  /* ---------------- 工具 ---------------- */
  var has = function (v) { return v !== null && v !== undefined && v !== '' && !isNaN(v); };
  var r1 = function (v) { return Math.round(v * 10) / 10; };
  var fmtD = function (v) { return (v > 0 ? '+' : '') + r1(v).toFixed(2) + ' D'; };
  var fmtP = function (v) { // 棱镜：正=外隐斜，负=内隐斜
    var a = Math.abs(v);
    return a + 'Δ' + (v > 0 ? ' 外隐斜' : v < 0 ? ' 内隐斜' : '');
  };

  /* ---------------- 正常参考值（第四节） ---------------- */
  function ampExpected(age, method) { // Hofstetter 最小调节幅度；负镜法约低 2D
    var e = 15 - 0.25 * age;
    if (method === 'minus') e -= 2;
    return Math.max(e, 0);
  }
  function flipNorms(age) { // 调节灵敏度标准（±2.00D 翻转拍）
    if (age < 13) return { mono: 7, bin: 5, label: '8~12 岁儿童标准（单眼≥7、双眼≥5 cpm）' };
    if (age <= 30) return { mono: 11, bin: 8, label: '13~30 岁标准（单眼≥11、双眼≥8 cpm）' };
    return { mono: 11, bin: 8, label: '30 岁以上暂无独立标准，暂参照 13~30 岁成人标准' };
  }
  function stereoNorm(age) {
    if (age < 4) return { max: null, label: '4 岁以下立体视标准不适用' };
    if (age < 7) return { max: 200, label: age + ' 岁儿童 <200 弧秒为可接受（发育标准）' };
    return { max: 60, label: '7 岁以上及成人 ≤60 弧秒（正常约 40 弧秒）' };
  }
  function vaFloor(age) { // 矫正视力同龄下限（工程近似，供红旗征自动判定）
    if (age >= 6) return 0.8;
    if (age >= 5) return 0.6;
    if (age >= 4) return 0.5;
    return 0.4;
  }
  var HYPEROPIA_RESERVE = [ // 睫状肌麻痹后等效球镜下限（WS/T 10039-2025）
    { maxAge: 5, min: 2.05 }, { maxAge: 6, min: 1.72 }, { maxAge: 7, min: 1.48 },
    { maxAge: 8, min: 1.19 }, { maxAge: 9, min: 1.11 }, { maxAge: 10, min: 0.92 },
    { maxAge: 11, min: 0.83 }, { maxAge: 12, min: 0.75 }
  ];

  /* ---------------- 步骤 1：红旗征 ---------------- */
  var REDFLAG_ITEMS = [
    ['suddenVisionLoss', '突发性视力下降'],
    ['monoDiplopia', '单眼复视（遮盖一眼后复视不消失）'],
    ['newDiplopia', '突发性或新发的复视'],
    ['eyeMoveLimit', '眼球运动明显受限'],
    ['pupilAbnormal', '瞳孔异常（不等大、对光反应异常）'],
    ['severePain', '剧烈眼痛伴畏光、恶心呕吐'],
    ['fieldDefect', '视野缺损主诉'],
    ['exophthalmos', '眼球突出'],
    ['recentTrauma', '近期眼外伤或眼内手术史'],
    ['cantCooperate', '年龄 < 6 岁且无法配合检查']
  ];
  function checkRedFlags(d) {
    var hits = [];
    REDFLAG_ITEMS.forEach(function (it) {
      if (d.redFlags && d.redFlags[it[0]]) hits.push(it[1]);
    });
    if (d.history && d.history.surgery && !(d.redFlags && d.redFlags.recentTrauma)) {
      // 既往史填了手术/外伤史但红旗征未勾选近期项 → 提示核实，不直接命中
    }
    var age = d.basic.age;
    if (has(age)) {
      var floor = vaFloor(age);
      ['OD', 'OS'].forEach(function (eye) {
        var v = d.basic['vaCorrected' + eye];
        if (has(v) && v < floor) {
          hits.push('最佳矫正视力 ' + eye + ' ' + v + ' 低于同龄下限（' + age + ' 岁约 ' + floor + '，工程近似值）');
        }
      });
    }
    if (has(age) && age < 6 && !(d.redFlags && d.redFlags.cantCooperate) &&
        !has(d.accom.ampOD) && !has(d.accom.ampOS) && !has(d.accom.ampOU) && !has(d.verg.nearPhoriaVal)) {
      hits.push('年龄 < 6 岁，且未录入有效配合性检查数据，请核实是否属于「无法配合检查」');
    }
    return hits;
  }

  /* ---------------- 步骤 2：数据校验（3.3） ---------------- */
  function validate(d) {
    var suspicious = [], missing = [];
    function chkAmp(v, tag) { if (has(v) && v > 20) suspicious.push('AMP（' + tag + '）= ' + v + 'D，超出合理上限 20D，请核实'); }
    chkAmp(d.accom.ampOD, 'OD'); chkAmp(d.accom.ampOS, 'OS'); chkAmp(d.accom.ampOU, '双眼');
    function chkPhoria(v, tag) { if (has(v) && Math.abs(v) > 30) suspicious.push(tag + ' = ' + Math.abs(v) + 'Δ，超过常见范围 30Δ，请核实'); }
    var dp = phoriaSigned(d.verg.distPhoriaVal, d.verg.distPhoriaDir);
    var np = phoriaSigned(d.verg.nearPhoriaVal, d.verg.nearPhoriaDir);
    chkPhoria(dp, '远距隐斜'); chkPhoria(np, '近距隐斜');
    if (has(d.accom.nra) && d.accom.nra > 5) suspicious.push('NRA = +' + d.accom.nra + 'D，绝对值超过 5D，请核实');
    if (has(d.accom.pra) && d.accom.pra > 5) suspicious.push('PRA = −' + d.accom.pra + 'D，绝对值超过 5D，请核实');
    // 逻辑一致性：近外隐斜显著大于远距但 AC/A 偏低（或反之）
    if (has(dp) && has(np) && has(d.verg.aca)) {
      var exoGap = np - dp; // 正值=近距外隐斜更大
      if (exoGap > 4 && d.verg.aca < 3) suspicious.push('近距外隐斜比远距大 ' + r1(exoGap) + 'Δ，但 AC/A 仅 ' + d.verg.aca + ' Δ/D，二者存在矛盾，请复核隐斜或 AC/A 测量');
      if (exoGap < -4 && d.verg.aca > 5) suspicious.push('远距外隐斜比近距大 ' + r1(-exoGap) + 'Δ，但 AC/A 高达 ' + d.verg.aca + ' Δ/D，二者存在矛盾，请复核');
    }
    // 缺失统计
    var groups = [
      ['调节功能', [d.accom.ampOD, d.accom.ampOS, d.accom.ampOU, d.accom.nra, d.accom.pra, d.accom.bcc, d.accom.flipOD, d.accom.flipOS, d.accom.flipOU]],
      ['聚散功能', [dp, np, d.verg.aca, d.verg.npc, d.verg.vergFlex]],
      ['三级视功能', [d.binoc.worth4 === '' ? null : d.binoc.worth4, d.binoc.stereo, d.binoc.aniseikonia]]
    ];
    groups.forEach(function (g) {
      var total = g[1].length, got = g[1].filter(has).length;
      if (got === 0) missing.push(g[0] + '：整组未查');
    });
    return { suspicious: suspicious, missing: missing };
  }
  function phoriaSigned(val, dir) {
    if (!has(val)) return null;
    return dir === 'eso' ? -Math.abs(val) : Math.abs(val);
  }

  /* ---------------- 偏离幅度（步骤 5 工程近似） ---------------- */
  function deviation(ratio) { // ratio: 偏离量/参照宽度，返回 {pct, level:'轻'|'中'|'重'}
    var pct = Math.round(Math.abs(ratio) * 100);
    return { pct: pct, significant: Math.abs(ratio) > 0.3 };
  }

  /* ---------------- 调节功能分析 ---------------- */
  function analyzeAccom(d) {
    var a = d.accom, age = d.basic.age;
    var res = { analyzable: true, pro: [], plain: [], diagnoses: [], findings: [] };
    var ampVals = [a.ampOD, a.ampOS].filter(has);
    var ampWorst = ampVals.length ? Math.min.apply(null, ampVals) : (has(a.ampOU) ? a.ampOU : null);
    var ampOk = has(ampWorst);
    var hasRel = has(a.nra) || has(a.pra) || has(a.bcc);
    if (!ampOk || !hasRel) {
      res.analyzable = false;
      res.pro.push('关键项缺失（' + (!ampOk ? 'AMP ' : '') + (!hasRel ? 'NRA/PRA/BCC' : '') + '），依据最小可分析数据集规则，本维度不下诊断结论。');
      return res;
    }
    var exp = ampExpected(age, a.ampMethod);
    var methodLabel = a.ampMethod === 'minus' ? '负镜法' : '推进法';
    var fn = flipNorms(age);
    res.findings.push({ key: 'AMP', value: r1(ampWorst) + ' D', norm: '≥ ' + r1(exp) + ' D（Hofstetter 公式 15−0.25×年龄' + (a.ampMethod === 'minus' ? '，负镜法再 −2D' : '') + '）', status: (exp - ampWorst) >= 2 ? '偏低' : '正常' });
    if (has(a.nra)) res.findings.push({ key: 'NRA', value: fmtD(a.nra), norm: '+1.75 ~ +2.50 D', status: a.nra < 1.75 ? '偏低' : a.nra > 2.5 ? '偏高' : '正常' });
    if (has(a.pra)) res.findings.push({ key: 'PRA', value: fmtD(-a.pra), norm: '−1.75 ~ −3.00 D', status: a.pra < 1.75 ? '偏低' : '正常' });
    if (has(a.bcc)) res.findings.push({ key: 'BCC', value: fmtD(a.bcc), norm: '+0.25 ~ +0.75 D', status: a.bcc > 0.75 ? '偏高' : a.bcc < 0.25 ? '偏低' : '正常' });
    var flipMonoVals = [a.flipOD, a.flipOS].filter(has);
    var flipMonoWorst = flipMonoVals.length ? Math.min.apply(null, flipMonoVals) : null;
    if (has(flipMonoWorst)) res.findings.push({ key: '调节灵敏度（单眼）', value: r1(flipMonoWorst) + ' cpm', norm: fn.label, status: flipMonoWorst < fn.mono ? '偏低' : '正常' });
    if (has(a.flipOU)) res.findings.push({ key: '调节灵敏度（双眼）', value: r1(a.flipOU) + ' cpm', norm: fn.label, status: a.flipOU < fn.bin ? '偏低' : '正常' });

    var deficit = exp - ampWorst;
    var ampNormal = deficit < 2;
    var relNormal = (!has(a.nra) || a.nra >= 1.75) && (!has(a.pra) || a.pra >= 1.75);
    var flipLow = (has(flipMonoWorst) && flipMonoWorst < fn.mono) || (has(a.flipOU) && a.flipOU < fn.bin);

    // 调节不足：AMP 低于年龄预期 ≥2D（主要条件）
    if (!ampNormal) {
      var dev = deviation(deficit / exp);
      var accomp = [];
      if (has(a.pra) && a.pra < 1.75) accomp.push('PRA ' + fmtD(-a.pra) + ' 低于 −1.75D');
      if (has(a.bcc) && a.bcc > 0.75) accomp.push('BCC ' + fmtD(a.bcc) + ' 超出 +0.75D 上限');
      if (flipLow) accomp.push('调节灵敏度低于年龄标准');
      res.diagnoses.push({ id: 'accom-insuff', dim: 'accom', name: '调节不足', significant: dev.significant,
        basis: 'AMP（' + methodLabel + '，较差眼 ' + r1(ampWorst) + 'D）低于年龄预期值 ' + r1(exp) + 'D，差值 ' + r1(deficit) + 'D ≥ 2D' + (accomp.length ? '；伴 ' + accomp.join('、') : '') });
      res.pro.push('AMP ' + r1(ampWorst) + 'D 显著低于该年龄最小调节幅度预期值（15−0.25×' + age + (a.ampMethod === 'minus' ? '，负镜法−2D' : '') + '＝' + r1(exp) + 'D），差值达 ' + r1(deficit) + 'D。' + (accomp.length ? '伴随：' + accomp.join('；') + '。' : '') + '符合调节不足特征。');
      res.plain.push('眼睛的「调焦范围」不够大——就像相机的变焦幅度不够，看近时需要付出更多力气，所以容易累、看一会儿就模糊。');
      if (has(a.bcc) && a.bcc > 0.75) {
        res.diagnoses.push({ id: 'accom-lag', dim: 'accom', name: '调节滞后', significant: deviation((a.bcc - 0.75) / 0.5).significant,
          basis: 'BCC ' + fmtD(a.bcc) + ' 超出正常上限 +0.75D' });
      }
    }
    // 调节过度：NRA < +1.75D（主要条件）
    if (has(a.nra) && a.nra < 1.75) {
      var devN = deviation((1.75 - a.nra) / 0.75);
      var acc2 = [];
      if (has(a.bcc) && a.bcc < 0.25) acc2.push('BCC ' + fmtD(a.bcc) + ' 低于 +0.25D 下限');
      if (flipLow) acc2.push('调节灵敏度下降');
      res.diagnoses.push({ id: 'accom-excess', dim: 'accom', name: '调节过度', significant: devN.significant,
        basis: 'NRA ' + fmtD(a.nra) + ' 低于 +1.75D 下限' + (acc2.length ? '；伴 ' + acc2.join('、') : '') });
      res.pro.push('NRA ' + fmtD(a.nra) + ' 低于正常下限 +1.75D（正常 +1.75~+2.50D）。' + (acc2.length ? '伴随：' + acc2.join('；') + '。' : '') + '提示调节过度。');
      res.plain.push('眼睛的「调焦肌肉」一直处于紧绷状态，放松不下来——就像一直握紧拳头，时间一长会酸胀、头痛。');
    }
    // 调节灵活度下降：AMP、NRA/PRA 基本正常但灵敏度低（主要条件）
    if (ampNormal && relNormal && flipLow) {
      var wv = has(flipMonoWorst) ? flipMonoWorst : null, wvB = has(a.flipOU) ? a.flipOU : null;
      var worstRatio = 0;
      if (has(wv)) worstRatio = Math.max(worstRatio, (fn.mono - wv) / fn.mono);
      if (has(wvB)) worstRatio = Math.max(worstRatio, (fn.bin - wvB) / fn.bin);
      res.diagnoses.push({ id: 'accom-flex', dim: 'accom', name: '调节灵活度下降', significant: deviation(worstRatio).significant,
        basis: 'AMP、NRA/PRA 基本正常，但调节灵敏度低于年龄标准（' + (has(wv) ? '单眼 ' + r1(wv) + 'cpm/标准≥' + fn.mono : '') + (has(wv) && has(wvB) ? '；' : '') + (has(wvB) ? '双眼 ' + r1(wvB) + 'cpm/标准≥' + fn.bin : '') + '）' });
      res.pro.push('AMP 与 NRA/PRA 均在正常范围，但调节灵敏度' + (has(wv) ? '（单眼 ' + r1(wv) + 'cpm）' : '') + (has(wvB) ? '（双眼 ' + r1(wvB) + 'cpm）' : '') + '低于' + fn.label + '，符合调节灵活度下降特征。');
      res.plain.push('眼睛的「调焦速度」太慢——从看远切换到看近时要等很久才能看清，就像相机对焦很慢，看书容易串行、犯困。');
    }
    // 单纯调节滞后（未被调节不足覆盖时）
    if (ampNormal && has(a.bcc) && a.bcc > 0.75) {
      res.diagnoses.push({ id: 'accom-lag', dim: 'accom', name: '调节滞后', significant: deviation((a.bcc - 0.75) / 0.5).significant,
        basis: 'BCC ' + fmtD(a.bcc) + ' 超出正常上限 +0.75D' });
      res.pro.push('BCC ' + fmtD(a.bcc) + ' 超出正常上限 +0.75D（正常 +0.25~+0.75D），提示调节滞后。');
      res.plain.push('看近时眼睛的调焦总是「慢半拍」，焦点落在视网膜后面，看久了会累。');
    }
    if (!res.diagnoses.length) {
      res.pro.push('AMP、NRA/PRA、BCC 及调节灵敏度各项指标均在年龄对应正常范围内，未见明显调节功能异常。');
      res.plain.push('眼睛的调焦功能（范围和速度）目前都在正常范围内。');
    }
    return res;
  }

  /* ---------------- 聚散功能分析 ---------------- */
  function analyzeVerg(d) {
    var v = d.verg, age = d.basic.age;
    var res = { analyzable: true, pro: [], plain: [], diagnoses: [], findings: [] };
    var dp = phoriaSigned(v.distPhoriaVal, v.distPhoriaDir);
    var np = phoriaSigned(v.nearPhoriaVal, v.nearPhoriaDir);
    if (!has(np)) {
      res.analyzable = false;
      res.pro.push('近距隐斜未查，依据最小可分析数据集规则，本维度不下诊断结论。');
      return res;
    }
    if (has(dp)) res.findings.push({ key: '远距隐斜', value: fmtP(dp), norm: '1Δ 内隐斜 ~ 3Δ 外隐斜', status: (dp >= -1 && dp <= 3) ? '正常' : '偏离' });
    res.findings.push({ key: '近距隐斜', value: fmtP(np), norm: '0 ~ 6Δ 外隐斜（Morgan）', status: (np >= 0 && np <= 6) ? '正常' : '偏离' });
    if (has(v.aca)) res.findings.push({ key: 'AC/A', value: v.aca + ' Δ/D（' + (v.acaMethod === 'grad' ? '梯度法' : '计算法') + '）', norm: '3 ~ 5 Δ/D（Morgan）', status: (v.aca >= 3 && v.aca <= 5) ? '正常' : '偏离' });
    if (has(v.npc)) {
      var npcBad = v.npc >= 6;
      res.findings.push({ key: 'NPC 破裂点', value: r1(v.npc) + ' cm', norm: '< 6 cm（老视前）；老视者 ≥10 cm 异常', status: npcBad ? '后退' : '正常' });
    }
    if (has(v.nearBO && v.nearBO.break)) res.findings.push({ key: '近距 BO 融合破裂点', value: v.nearBO.break + 'Δ', norm: '18 ~ 24Δ（Morgan 修正）', status: v.nearBO.break < 18 ? '偏低' : '正常' });
    if (has(v.distBO && v.distBO.break)) res.findings.push({ key: '远距 BO 融合破裂点', value: v.distBO.break + 'Δ', norm: '19±8Δ（Morgan，下限约 11Δ）', status: v.distBO.break < 11 ? '偏低' : '正常' });
    if (has(v.distBI && v.distBI.break)) res.findings.push({ key: '远距 BI 融合破裂点', value: v.distBI.break + 'Δ', norm: '7±3Δ（Morgan，下限约 4Δ）', status: v.distBI.break < 4 ? '偏低' : '正常' });
    if (has(v.nearBI && v.nearBI.break)) res.findings.push({ key: '近距 BI 融合破裂点', value: v.nearBI.break + 'Δ', norm: '21±4Δ（Morgan，下限约 17Δ）', status: v.nearBI.break < 17 ? '偏低' : '正常' });
    if (has(v.vergFlex)) res.findings.push({ key: '聚散灵敏度', value: r1(v.vergFlex) + ' cpm', norm: '≥ 9 cpm（经验参考）', status: v.vergFlex < 9 ? '偏低' : '正常' });

    var nearBObreak = v.nearBO && v.nearBO.break;
    // Sheard 准则：近距 BO 破裂点 ≥ 2×近距外隐斜量
    var sheardFail = has(nearBObreak) && has(np) && np > 0 && nearBObreak < 2 * np;

    // 集合不足 CI：近外隐斜比远距大 >4Δ，且 NPC≥6cm 和/或近距 BO 不足（破裂<18Δ 或不满足 Sheard）
    if (has(dp) && (np - dp) > 4 && np > 6) {
      var conds = [];
      if (has(v.npc) && v.npc >= 6) conds.push('NPC ' + r1(v.npc) + 'cm ≥ 6cm 后退');
      if (has(nearBObreak) && nearBObreak < 18) conds.push('近距 BO 破裂点 ' + nearBObreak + 'Δ 低于正常下限 18Δ');
      if (sheardFail) conds.push('不满足 Sheard 准则（BO 破裂点 ' + nearBObreak + 'Δ < 2×隐斜 ' + (2 * np) + 'Δ）');
      if (conds.length) {
        var devCI = deviation((np - 6) / 6);
        res.diagnoses.push({ id: 'ci', dim: 'verg', name: '集合不足', significant: devCI.significant,
          basis: '近距外隐斜 ' + np + 'Δ 比远距（' + dp + 'Δ）大 ' + r1(np - dp) + 'Δ > 4Δ；' + conds.join('；') });
        res.pro.push('近距外隐斜 ' + np + 'Δ（正常 0~6Δ）较远距 ' + dp + 'Δ 大 ' + r1(np - dp) + 'Δ，超过 4Δ 临界；' + conds.join('；') + '。' + (has(v.aca) ? 'AC/A ' + v.aca + ' Δ/D ' + (v.aca >= 3 && v.aca <= 5 ? '在正常范围' : '偏离正常范围') + '。' : '') + '符合集合不足诊断标准。');
        res.plain.push('两只眼睛「向内聚拢」的能力不够。看近处时双眼需要同时向内转才能对准目标，但聚拢的幅度和耐力都不够，所以看久了会眼胀、头痛，甚至串行。');
      }
    }
    // 集合过度 CE：近距内隐斜 >6Δ，AC/A>5，近距 BI 降低
    if (np <= -6) {
      var ceConds = [];
      if (has(v.aca) && v.aca > 5) ceConds.push('AC/A ' + v.aca + ' Δ/D 高于 5');
      if (has(v.nearBI && v.nearBI.break) && v.nearBI.break < 17) ceConds.push('近距 BI 破裂点 ' + v.nearBI.break + 'Δ 低于下限 17Δ');
      res.diagnoses.push({ id: 'ce', dim: 'verg', name: '集合过度', significant: deviation((-np - 6) / 6).significant,
        basis: '近距内隐斜 ' + (-np) + 'Δ > 6Δ' + (ceConds.length ? '；' + ceConds.join('；') : '') });
      res.pro.push('近距内隐斜 ' + (-np) + 'Δ 超过 6Δ。' + (ceConds.length ? ceConds.join('；') + '。' : '') + '符合集合过度特征。');
      res.plain.push('两只眼睛「向内聚拢」得过头了，看近时眼睛用力过猛，容易引起眼胀、头痛。');
    }
    // 散开不足 DI：远距内隐斜为主，远距 BI 降低
    if (has(dp) && dp < -3 && (!has(np) || dp < np)) {
      var diConds = [];
      if (has(v.distBI && v.distBI.break) && v.distBI.break < 4) diConds.push('远距 BI 破裂点 ' + v.distBI.break + 'Δ 低于下限 4Δ');
      res.diagnoses.push({ id: 'di', dim: 'verg', name: '散开不足', significant: deviation((-dp - 3) / 4).significant,
        basis: '远距内隐斜 ' + (-dp) + 'Δ（正常 1Δ 内隐斜~3Δ 外隐斜）' + (diConds.length ? '；' + diConds.join('；') : '') });
      res.pro.push('远距内隐斜 ' + (-dp) + 'Δ，超出正常范围（1Δ 内隐斜~3Δ 外隐斜），且以内隐斜为主。' + (diConds.length ? diConds.join('；') + '。' : '') + '符合散开不足特征。');
      res.plain.push('看远处时两只眼睛向外「分开」的能力不够，看远容易疲劳、可能出现重影。');
    }
    // 散开过度 DE：远距外隐斜 > 近距，远距 BO 降低
    if (has(dp) && dp > 3 && has(np) && dp > np) {
      var deConds = [];
      if (has(v.distBO && v.distBO.break) && v.distBO.break < 11) deConds.push('远距 BO 破裂点 ' + v.distBO.break + 'Δ 低于下限 11Δ');
      res.diagnoses.push({ id: 'de', dim: 'verg', name: '散开过度', significant: deviation((dp - 3) / 6).significant,
        basis: '远距外隐斜 ' + dp + 'Δ 大于近距 ' + np + 'Δ' + (deConds.length ? '；' + deConds.join('；') : '') });
      res.pro.push('远距外隐斜 ' + dp + 'Δ 超过正常范围且大于近距隐斜 ' + np + 'Δ。' + (deConds.length ? deConds.join('；') + '。' : '') + '符合散开过度特征。');
      res.plain.push('看远处时两只眼睛向外「飘」的倾向比较明显，需要额外用力才能维持双眼对准。');
    }
    // 聚散灵敏度不足（无其它聚散诊断时单列）
    if (!res.diagnoses.length && has(v.vergFlex) && v.vergFlex < 9) {
      res.diagnoses.push({ id: 'verg-flex-low', dim: 'verg', name: '聚散灵敏度偏低', significant: deviation((9 - v.vergFlex) / 9).significant,
        basis: '聚散灵敏度 ' + r1(v.vergFlex) + 'cpm 低于经验参考值 9cpm' });
      res.pro.push('隐斜量与融合范围未见明显异常，但聚散灵敏度 ' + r1(v.vergFlex) + 'cpm 低于经验参考值（≥9cpm，文献多在 12~15cpm），提示聚散系统耐力不足。');
      res.plain.push('双眼「聚拢—分开」切换的耐力不够，长时间看近后容易累。');
    }
    if (!res.diagnoses.length) {
      res.pro.push('远/近距隐斜、AC/A、NPC 及融合范围均在 Morgan 正常值范围内，未见明显聚散功能异常。');
      res.plain.push('两只眼睛「聚拢和分开」的配合能力目前都在正常范围内。');
    }
    return res;
  }

  /* ---------------- 三级视功能分析 ---------------- */
  function analyzeBinoc(d) {
    var b = d.binoc, age = has(d.basic.age) ? d.basic.age : 99;
    var res = { analyzable: true, pro: [], plain: [], diagnoses: [], findings: [] };
    var gotAny = b.worth4 !== '' || has(b.stereo) || has(b.aniseikonia);
    if (!gotAny) {
      res.analyzable = false;
      res.pro.push('三级视功能整组未查，无法评估。');
      return res;
    }
    if (b.worth4 !== '' && b.worth4 !== null) {
      var wok = b.worth4 === '4';
      res.findings.push({ key: 'Worth 4 灯', value: b.worth4 + ' 灯', norm: '远、近均 4 灯', status: wok ? '正常' : '异常' });
      if (!wok) {
        res.diagnoses.push({ id: 'worth-abn', dim: 'binoc', name: '同时视异常（Worth 4 灯非 4 灯）', significant: true,
          basis: 'Worth 4 灯见 ' + b.worth4 + ' 灯，提示' + (b.worth4 === '5' ? '复视' : '可能存在抑制或异常视网膜对应') });
        res.pro.push('Worth 4 灯见 ' + b.worth4 + ' 灯，非正常双眼单视（4 灯），提示' + (b.worth4 === '5' ? '存在复视' : '可能存在一眼抑制或异常视网膜对应') + '。');
        res.plain.push('双眼同时看世界的能力出了问题——大脑可能「关掉」了一只眼睛传来的图像，或者看到了重影。');
      }
    }
    if (has(b.stereo)) {
      var sn = stereoNorm(age);
      if (sn.max === null) {
        res.findings.push({ key: '立体视', value: b.stereo + ' 弧秒', norm: sn.label, status: '未评' });
        res.pro.push('立体视 ' + b.stereo + ' 弧秒；' + age + ' 岁儿童立体视尚在发育早期，本标准不予评级，建议随访观察。');
      } else if (b.stereo <= sn.max) {
        res.findings.push({ key: '立体视', value: b.stereo + ' 弧秒', norm: sn.label, status: '正常' });
        res.pro.push('立体视 ' + b.stereo + ' 弧秒，在' + sn.label + '范围内。');
        res.plain.push('双眼的立体感正常。');
      } else if (b.stereo <= 200) {
        res.findings.push({ key: '立体视', value: b.stereo + ' 弧秒', norm: sn.label, status: '轻度下降' });
        res.diagnoses.push({ id: 'stereo-mild', dim: 'binoc', name: '立体视功能轻度下降', significant: false,
          basis: '立体视 ' + b.stereo + ' 弧秒，超出' + sn.label + '，但未超过实用立体视标准 200 弧秒' });
        res.pro.push('立体视 ' + b.stereo + ' 弧秒，超出' + sn.label + '，但未超过实用立体视标准（200 弧秒），提示立体视功能轻度下降。');
        res.plain.push('双眼的立体感比一般人差一些，但不影响日常使用。');
      } else {
        res.findings.push({ key: '立体视', value: b.stereo + ' 弧秒', norm: sn.label, status: '明显受损' });
        res.diagnoses.push({ id: 'stereo-sev', dim: 'binoc', name: '立体视功能明显受损', significant: true,
          basis: '立体视 ' + b.stereo + ' 弧秒 > 200 弧秒（实用立体视标准）' });
        res.pro.push('立体视 ' + b.stereo + ' 弧秒，超过实用立体视标准 200 弧秒，提示立体视功能明显受损。');
        res.plain.push('双眼的立体感明显偏差，判断物体远近、深浅会比较吃力。');
      }
    }
    if (has(b.aniseikonia)) {
      if (b.aniseikonia > 3) {
        res.findings.push({ key: '不等像', value: b.aniseikonia + '%', norm: '>0.75% 可致视疲劳；>3~5% 影响融合', status: '偏高' });
        res.diagnoses.push({ id: 'aniseikonia-sev', dim: 'binoc', name: '不等像显著（影响融合）', significant: true,
          basis: '不等像 ' + b.aniseikonia + '% > 3%，可能影响融合甚至复视' });
        res.pro.push('不等像 ' + b.aniseikonia + '% 超过 3%，可能影响双眼融合、甚至导致复视。');
        res.plain.push('两只眼睛看到的图像大小差别明显，大脑很难把它们拼成一个画面。');
      } else if (b.aniseikonia > 0.75) {
        res.findings.push({ key: '不等像', value: b.aniseikonia + '%', norm: '>0.75% 可致视疲劳；>3~5% 影响融合', status: '轻度偏高' });
        res.diagnoses.push({ id: 'aniseikonia-mild', dim: 'binoc', name: '不等像（可致视疲劳）', significant: false,
          basis: '不等像 ' + b.aniseikonia + '% > 0.75%，可致视疲劳' });
        res.pro.push('不等像 ' + b.aniseikonia + '% 超过 0.75%，可致视疲劳，但尚未达到影响融合的程度（3~5%）。');
        res.plain.push('两只眼睛看到的图像大小略有差别，看久了容易累。');
      } else {
        res.findings.push({ key: '不等像', value: b.aniseikonia + '%', norm: '>0.75% 可致视疲劳', status: '正常' });
      }
    }
    if (!res.diagnoses.length && !res.plain.length) {
      res.pro.push('已查项目未见明显三级视功能异常。');
      res.plain.push('双眼协同使用的能力（同时视、融合、立体感）未见明显异常。');
    }
    return res;
  }

  /* ---------------- 远视储备（4.4） ---------------- */
  function analyzeReserve(d) {
    var age = d.basic.age;
    if (!has(age) || age > 12 || age < 3) return null;
    if (d.basic.cycloplegia !== 'yes') return null;
    function se(rx) { return has(rx.sph) ? rx.sph + (has(rx.cyl) ? rx.cyl / 2 : 0) : null; }
    var row = null;
    for (var i = 0; i < HYPEROPIA_RESERVE.length; i++) {
      if (age <= HYPEROPIA_RESERVE[i].maxAge) { row = HYPEROPIA_RESERVE[i]; break; }
    }
    if (!row) return null;
    var out = { min: row.min, eyes: [] };
    ['OD', 'OS'].forEach(function (eye) {
      var s = se(d.basic['rx' + eye]);
      if (has(s)) out.eyes.push({ eye: eye, se: r1(s), insufficient: s < row.min });
    });
    if (!out.eyes.length) return null;
    out.anyInsufficient = out.eyes.some(function (e) { return e.insufficient; });
    return out;
  }

  /* ---------------- 步骤 4：关联与综合诊断 ---------------- */
  function integrate(accom, verg, binoc, symptoms) {
    var all = accom.diagnoses.concat(verg.diagnoses, binoc.diagnoses);
    var notes = [];
    function find(id) { return all.findIndex(function (x) { return x.id === id; }); }
    function take(id) { var i = find(id); return i >= 0 ? all.splice(i, 1)[0] : null; }
    // 关联模式：合并为组合诊断，避免继发诊断被「1~3 个主要诊断」截断
    if (find('accom-insuff') >= 0 && find('ci') >= 0) {
      var a = take('accom-insuff'), c = take('ci');
      all.push({ id: 'ai-ci', members: ['accom-insuff', 'ci'], dim: 'accom', name: '调节不足继发集合不足',
        significant: a.significant || c.significant, role: '原发',
        basis: a.basis + '；' + c.basis + '。调节储备不足导致调节性集合减少，进而引发集合不足' });
      notes.push('调节不足与集合不足并存：调节储备不足导致调节性集合减少，符合「调节不足继发集合不足」关联模式。');
    } else if (find('ci') >= 0 && find('accom-excess') >= 0) {
      var c2 = take('ci'), e2 = take('accom-excess');
      all.push({ id: 'ci-ae', members: ['ci', 'accom-excess'], dim: 'verg', name: '集合不足继发调节过度',
        significant: c2.significant || e2.significant, role: '原发',
        basis: c2.basis + '；' + e2.basis + '。可能为代偿性增加调节以刺激集合' });
      notes.push('集合不足与调节过度并存：可能为代偿性增加调节以刺激集合，符合「集合不足继发调节过度」关联模式。');
    } else if (find('accom-excess') >= 0 && find('ce') >= 0) {
      var e3 = take('accom-excess'), c3 = take('ce');
      all.push({ id: 'ae-ce', members: ['accom-excess', 'ce'], dim: 'accom', name: '调节过度继发集合过度',
        significant: e3.significant || c3.significant, role: '原发',
        basis: e3.basis + '；' + c3.basis + '。调节过强带动调节性集合增加' });
      notes.push('调节过度与集合过度并存：调节过强带动调节性集合增加，符合「调节过度继发集合过度」关联模式。');
    }
    var symCount = ['eyeStrain', 'blurAfterNear', 'headache', 'lineSkip', 'diplopia', 'drowsy']
      .filter(function (k) { return symptoms[k]; }).length;
    // 排序：原发 > 无标注；同级显著 > 轻度
    all.sort(function (a, b) {
      var ra = a.role === '原发' ? 0 : 1;
      var rb = b.role === '原发' ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return (b.significant ? 1 : 0) - (a.significant ? 1 : 0);
    });
    return { diagnoses: all.slice(0, 3), extraCount: Math.max(0, all.length - 3), notes: notes, symCount: symCount };
  }

  /* ---------------- 步骤 5：严重程度 ---------------- */
  function gradeSeverity(diagnoses, symCount, duration) {
    var sig = diagnoses.filter(function (x) { return x.significant; });
    var mild = diagnoses.filter(function (x) { return !x.significant; });
    var chronic = duration === '3to6m' || duration === 'gt6m';
    var stereoSev = diagnoses.some(function (x) { return x.id === 'stereo-sev'; });
    var compensate = symCount >= 4 && chronic; // 工程近似：症状负担高且持续 → 提示明显代偿
    if (!diagnoses.length) return { level: '未见明显异常', reasons: ['各项指标在年龄对应正常范围内'] };
    if ((sig.length >= 2 && compensate) || stereoSev) {
      return { level: '重度', reasons: [sig.length >= 2 ? sig.length + ' 项指标显著异常并伴随明显代偿行为（症状 ' + symCount + ' 项且持续时间长）' : null,
        stereoSev ? '立体视 >200 弧秒，立体视功能明显受损' : null].filter(Boolean) };
    }
    if (sig.length >= 1 || mild.length >= 2) {
      return { level: '中度', reasons: [sig.length >= 1 ? sig.length + ' 项指标显著偏离正常（偏离幅度 > 正常范围 30%）' : mild.length + ' 项指标轻度偏离',
        symCount > 0 ? '伴随症状 ' + symCount + ' 项' + (chronic ? '，持续时间长' : '') + '，影响阅读/工作效率' : null].filter(Boolean) };
    }
    return { level: '轻度', reasons: ['1 项指标轻度偏离正常（偏离幅度 < 正常范围 30%）', symCount <= 1 ? '症状偶发，对日常用眼影响小' : '症状存在但指标偏离轻微'] };
  }

  /* ---------------- 第六~九节：建议方案 ---------------- */
  function buildPlan(d, diagnoses) {
    var age = has(d.basic.age) ? d.basic.age : 25;
    var fn = flipNorms(age);
    var ids = [];
    diagnoses.forEach(function (x) {
      ids.push(x.id);
      (x.members || []).forEach(function (m) { ids.push(m); });
    });
    var plan = { glasses: [], training: [], habits: [], followup: [], phases: [] };

    // 6.1 配镜
    if (ids.indexOf('accom-insuff') >= 0 || ids.indexOf('accom-lag') >= 0) {
      plan.glasses.push('当前屈光处方建议足矫；可考虑验配抗疲劳设计镜片（下加光 +0.50 ~ +0.75D），减轻近距离用眼时的调节负担。');
      plan.glasses.push('调节不足的处理分两步：先以近距离正镜附加补偿不足的调节能力、消除疲劳症状；再通过视觉训练改进调节功能、提高调节幅度。');
    }
    if (ids.indexOf('accom-excess') >= 0) {
      plan.glasses.push('确认处方无过矫（尤其近视过矫会加重调节紧张）；必要时在充分雾视/散瞳后复核处方。');
    }
    if (!plan.glasses.length) plan.glasses.push('现有屈光处方如足矫且无不适，可按需配戴；无特殊附加要求。');

    // 6.2 视觉训练（六要素，按诊断个性化）
    if (ids.indexOf('accom-insuff') >= 0 || ids.indexOf('accom-flex') >= 0 || ids.indexOf('accom-lag') >= 0) {
      plan.training.push({
        name: '翻转拍训练（针对调节灵活度）',
        tool: '±2.00D 翻转拍 + 20/30（或更小字号）视力卡；若调节能力特别弱，可先从 ±1.50D 开始，逐渐过渡到 ±2.00D',
        steps: '① 视力卡置于眼前 40cm；② 手持翻转拍贴近眼前，按视力卡顺序读字；③ 正镜面朝上读第一个字母，翻转到负镜面读第二个字母，交替进行；④ 一正一负为一个周期；⑤ 必须看清后再翻转，不可猜测',
        params: '先单眼（遮盖另一眼），每眼计时 1 分钟记录周期数；再做双眼；每天 1~2 次，单眼和双眼各每次 5~10 分钟',
        advance: age < 13 ? '单眼 ≥7cpm、双眼 ≥5cpm 即达该年龄正常范围，可换更高度数翻转拍' : '单眼 ≥11cpm、双眼 ≥8cpm 后可换更高度数翻转拍',
        place: '家庭',
        taboo: '恒定斜视、明显双眼抑制者慎用'
      });
      plan.training.push({
        name: '字母表训练（针对调节幅度不足）',
        tool: '大字母表（贴于 3~5 米远处）+ 小字母表（手持）',
        steps: '① 遮盖左眼，右眼注视小表第一行；② 边读字母边将小表移近，直到字母变模糊；③ 将小表移远约 2.5cm 至清晰，保持该距离；④ 交替注视大表和小表第二行；⑤ 读第三行时将小表重新移回 40cm 处，重复上述步骤',
        params: '每天 1~2 次，每次 10~15 分钟；先单眼后双眼',
        advance: '能顺利读完 10 行且每行清晰',
        place: '家庭',
        taboo: null
      });
    }
    if (ids.indexOf('accom-excess') >= 0) {
      plan.training.push({
        name: '远近交替注视（放松调节）',
        tool: '近目标（笔尖/手指）+ 远目标（窗外景物），无需特殊工具',
        steps: '注视近目标 15~20 秒 → 注视远目标 15~20 秒，反复交替 10~15 组；重点放在看远时的放松感',
        params: '每天 2~3 次',
        advance: '看近后看远恢复清晰的时间明显缩短',
        place: '家庭',
        taboo: null
      });
    }
    if (ids.indexOf('ci') >= 0) {
      var highACA = has(d.verg.aca) && d.verg.aca > 5;
      var eso = (d.verg.nearPhoriaDir === 'eso' && has(d.verg.nearPhoriaVal)) || (d.verg.distPhoriaDir === 'eso' && has(d.verg.distPhoriaVal));
      plan.training.push({
        name: '聚散球训练（针对集合不足）',
        tool: '聚散球（红黄绿三球，线长约 1 米）；标准位置：红球 30cm、黄球 60cm、绿球 90cm',
        steps: '① 绳子一端固定于鼻尖前方，另一端拉直；② 依次注视近—中—远每颗珠子，每颗维持 5~10 秒；③ 注视红球时应看到黄球、绿球各分成两个，绳子在红球处交叉成「X」形；④ 保持 5 秒后移到黄球，同样看到绳子在黄球处交叉；⑤ 最后移到绿球',
        params: '每次 3~5 分钟，每天 1~2 次，持续 4~8 周以上',
        advance: '能稳定在三球之间切换且始终维持单一清晰注视目标后，可缩短球间距并增加时长',
        place: '家庭',
        taboo: (highACA || eso) ? '本例存在内隐斜倾向/高 AC/A，慎用，需在专业视光师指导下进行' : '隐性内斜/高 AC/A 者慎用，可能诱发内斜'
      });
    }
    if (plan.training.length) {
      plan.phases = [
        { name: '第一阶段（第 1~4 周）', desc: '以调节训练为主：' + plan.training.filter(function (t) { return t.name.indexOf('翻转拍') >= 0 || t.name.indexOf('字母表') >= 0 || t.name.indexOf('远近交替') >= 0; }).map(function (t) { return t.name.split('（')[0]; }).join('、') },
        { name: '第二阶段（第 5~8 周）', desc: ids.indexOf('ci') >= 0 ? '调节 + 聚散联合训练：在第一阶段基础上加入聚散球训练' : '继续第一阶段项目，逐步提升难度（更高度数翻转拍/更小字号）' },
        { name: '第三阶段（第 9~12 周）', desc: '巩固训练：频率降至每天 1 次，维持已改善的指标；复查确认达到正常范围后进入维持阶段（每周 2~3 次）' }
      ];
      plan.trainingCycle = '训练周期通常 6~12 周，每周 5~7 次，每次 15~30 分钟。短期 2~3 周可缓解主观症状，中期 1~3 个月可改善视功能指标。训练中若出现持续复视、症状加重、视力下降，应立即中止训练并复诊。';
    } else {
      plan.trainingCycle = null;
    }

    // 6.3 用眼习惯
    plan.habits = [
      '遵循 20-20-20 法则：每近距离用眼 20 分钟，远眺 6 米以外至少 20 秒',
      '阅读距离保持 33~40cm',
      '避免在光线不足或晃动的环境中阅读',
      '每天保证 2 小时以上户外活动时间'
    ];
    if (has(d.habits.nearHours) && d.habits.nearHours >= 6) {
      plan.habits.unshift('当前每天近距离用眼约 ' + d.habits.nearHours + ' 小时，负荷偏高，建议分段安排、每段不超过 40 分钟');
    }
    if (d.habits.continuousUse) {
      plan.habits.unshift('存在连续用眼不休息的习惯，请设置定时提醒强制执行休息');
    }

    // 6.4 复查
    if (plan.training.length) {
      plan.followup = [
        '第 4 周：复查调节功能（AMP、PRA、调节灵敏度）',
        '第 8 周：复查调节 + 聚散功能',
        '第 12 周：全面复查，评估是否进入维持阶段'
      ];
    } else {
      plan.followup = ['建议 6~12 个月常规复查视功能'];
    }
    return plan;
  }

  /* ---------------- 报告数据总览 ---------------- */
  function buildOverview(accomRes, vergRes, binocRes, d) {
    var rows = accomRes.findings.concat(vergRes.findings, binocRes.findings);
    var checked = rows.length;
    var unchecked = [];
    if (!accomRes.analyzable && !accomRes.findings.length) unchecked.push('调节功能（整组）');
    if (!vergRes.analyzable && !vergRes.findings.length) unchecked.push('聚散功能（整组）');
    if (!binocRes.analyzable && !binocRes.findings.length) unchecked.push('三级视功能（整组）');
    return { rows: rows, unchecked: unchecked, checkedCount: checked };
  }

  /* ---------------- 主入口 ---------------- */
  function analyze(d) {
    var now = new Date();
    var meta = {
      id: 'VF-' + now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0') + '-' + String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0'),
      date: now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0'),
      time: String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')
    };

    // 步骤 1：红旗征
    var flags = checkRedFlags(d);
    if (flags.length) {
      return {
        ok: false, referral: true, meta: meta, flags: flags,
        message: '您提供的检查数据中，' + flags.map(function (f) { return '〔' + f + '〕'; }).join('') + ' 提示可能存在器质性病变风险。视功能分析不适用于此情况，建议顾客尽快到眼科就诊，排除眼部疾病后再进行视功能评估。'
      };
    }

    // 步骤 2：校验
    var validation = validate(d);
    // 步骤 3：逐项分析
    var accomRes = analyzeAccom(d);
    var vergRes = analyzeVerg(d);
    var binocRes = analyzeBinoc(d);
    var reserve = analyzeReserve(d);
    // 步骤 4：关联
    var integrated = integrate(accomRes, vergRes, binocRes, d.symptoms);
    // 步骤 5：严重程度
    var severity = gradeSeverity(integrated.diagnoses, integrated.symCount, d.symptoms.duration);
    // 建议
    var plan = integrated.diagnoses.length ? buildPlan(d, integrated.diagnoses) : buildPlan(d, []);
    var overview = buildOverview(accomRes, vergRes, binocRes, d);

    // 局限性
    var limitations = [];
    validation.missing.forEach(function (m) { limitations.push(m + '，该项无法评估'); });
    validation.suspicious.forEach(function (s) { limitations.push('存疑数据：' + s); });
    if (!accomRes.analyzable) limitations.push('调节功能关键项（AMP、NRA/PRA/BCC）不全，调节维度仅输出数据概览');
    if (!vergRes.analyzable) limitations.push('近距隐斜未查，聚散维度仅输出数据概览');
    if (d.basic.cycloplegia !== 'yes' && has(d.basic.age) && d.basic.age <= 12) limitations.push('未行睫状肌麻痹验光，远视储备无法评估（非散瞳屈光度不可套用储备标准）');
    if (!limitations.length) limitations.push('本次录入数据覆盖主要检查维度，未见明显缺失。');

    // 症状汇总（供报告）
    var SYMPTOM_LABELS = { eyeStrain: '看近眼胀眼酸', blurAfterNear: '看近后看远模糊', headache: '头痛（额头/眼眶周围）', lineSkip: '阅读跳行串行漏字', diplopia: '重影', drowsy: '看书易犯困、注意力不集中' };
    var symptomList = Object.keys(SYMPTOM_LABELS).filter(function (k) { return d.symptoms[k]; }).map(function (k) { return SYMPTOM_LABELS[k]; });

    return {
      ok: true, referral: false, meta: meta,
      basic: d.basic, symptomList: symptomList,
      durationLabel: { '': '', lt1m: '不到 1 个月', '1to3m': '1~3 个月', '3to6m': '3~6 个月', gt6m: '6 个月以上' }[d.symptoms.duration] || '',
      timeOfDay: d.symptoms.timeOfDay || '',
      validation: validation,
      overview: overview,
      accom: accomRes, verg: vergRes, binoc: binocRes, reserve: reserve,
      diagnoses: integrated.diagnoses, extraDxCount: integrated.extraCount,
      relationNotes: integrated.notes,
      severity: severity,
      plan: plan,
      limitations: limitations,
      disclaimer: '本报告由 AI 辅助生成，仅供参考，不能替代执业医师的临床诊断。请结合临床检查由专业视光师或眼科医师最终确认。如出现突发性视力下降、剧烈眼痛、视野缺损等症状，请立即就医。'
    };
  }

  global.VFEngine = { analyze: analyze };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.VFEngine;
})(typeof window !== 'undefined' ? window : globalThis);
