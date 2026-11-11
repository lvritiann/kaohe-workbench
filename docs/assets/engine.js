/* 计分引擎 V4 —— 《高速公路加油站目标责任考核方案》V1.0
   四段：油品45 / 非油10 / 人效15 / 管理30；基准100、封顶120；不设等级只排名
*/
window.Engine = (function () {
  var C = window.CFG;

  function r(n, d) { var p = Math.pow(10, d); return Math.round(n * p) / p; }

  /* ---------------- 通用：少扣多奖 ---------------- */

  /* 完成率 → 倍数。≥100% 按 1+1.5×(r−1)；<100% 按 1+0.5×(r−1) */
  function multi(rate) {
    var k = C.scoreRule;
    return rate >= 1 ? 1 + k.bonus * (rate - 1) : 1 + k.penalty * (rate - 1);
  }

  function capScore(v, cap) { return Math.min(v, cap); }

  /* ---------------- 一、油品销量段（45，封顶53） ---------------- */

  function oilSegment(actualTon, taskTon) {
    if (!(taskTon > 0)) return { rate: 0, raw: 0, score: 0 };
    var rate = actualTon / taskTon;
    var raw = C.seg.oil.base * multi(rate);
    if (raw < 0) raw = 0;
    return { rate: r(rate, 4), raw: r(raw, 2), score: r(capScore(raw, C.seg.oil.cap), 2) };
  }

  /* ---------------- 二、非油销量段（10，封顶12） ---------------- */

  /* 销售分与毛利分各 5 分、各封顶 6 分 */
  function nonoilSegment(salesRate, marginRate, weights) {
    var w = weights || C.nonoil;
    var s = capScore(w.salesWeight * multi(salesRate), w.capEach);
    var m = capScore(w.marginWeight * multi(marginRate), w.capEach);
    if (s < 0) s = 0;
    if (m < 0) m = 0;
    return {
      salesRate: r(salesRate, 4), marginRate: r(marginRate, 4),
      salesScore: r(s, 2), marginScore: r(m, 2),
      score: r(capScore(s + m, C.seg.nonoil.cap), 2)
    };
  }

  /* ---------------- 三、油品人效段（15，封顶25） ---------------- */

  function efficiency(gasTon, dieselTon, headcount) {
    var H = C.hr;
    var sge = gasTon * H.sgeGas + dieselTon * H.sgeDiesel;
    var denom = headcount - H.baseHeadcount;
    var eff = denom > 0 ? sge / denom : 0;
    var raw = eff / H.benchmark * C.seg.eff.base;
    return {
      gasTon: r(gasTon, 2), dieselTon: r(dieselTon, 2),
      sge: r(sge, 1),
      headcount: headcount, denom: r(denom, 2),
      eff: r(eff, 2),
      multiple: r(eff / H.benchmark, 3),
      raw: r(raw, 2),
      score: r(capScore(raw, C.seg.eff.cap), 2)
    };
  }

  /* ---------------- 四、现场管理段（30） ---------------- */

  function gradeOf(score) {
    var L = C.inspect.gradeLines;
    if (score >= L.excellent) return '优秀';
    if (score >= L.good) return '良好';
    if (score >= L.pass) return '合格';
    return '不合格';
  }

  function inspectResult(data, answers) {
    var raw = 0, naScore = 0, naCount = 0, noCount = 0, undecided = 0;

    data.items.forEach(function (it) {
      var a = answers.items[it.no];
      if (a === 'ok') raw += it.score;
      else if (a === 'na') { naScore += it.score; naCount += 1; }
      else if (a === 'no') { noCount += 1; }
      else { undecided += 1; }
    });

    var effective = C.inspect.total - naScore;
    var converted = effective > 0 ? r(raw / effective * 100, 2) : 0;
    if (Object.keys(answers.items).length === 0) converted = 0;

    return {
      raw: raw, naScore: naScore, naCount: naCount, noCount: noCount,
      undecided: undecided, effective: effective, converted: converted,
      grade: gradeOf(converted),
      score: r(capScore(converted * C.inspect.weight, C.seg.inspect.cap), 2)
    };
  }

  function vetoResult(data, answers) {
    var failed = [], undecided = 0;
    data.veto.forEach(function (v) {
      var a = answers.veto[v.no];
      if (a === 'no') failed.push(v.name);
      else if (!a) undecided += 1;
    });
    return { failed: failed, vetoed: failed.length > 0, undecided: undecided };
  }

  /* ---------------- 投诉扣分与进步加分 ---------------- */

  /* complaints = { escalate, repeat, regulator } 件数 */
  function complaintDeduct(c) {
    var K = C.complaint;
    return (c.escalate || 0) * K.escalate + (c.repeat || 0) * K.repeat + (c.regulator || 0) * K.regulator;
  }

  /* 进步加分：年度人效同比提升率（如 0.08 表示 +8%），0.2 分/1%，上限 3 */
  function progressBonus(growthRate) {
    if (!(growthRate > 0)) return 0;
    return r(Math.min(growthRate * 100 * C.progressPerPct, C.progressCap), 2);
  }

  /* ---------------- 综合得分 ---------------- */

  function composite(p) {
    var total = (p.oilScore || 0) + (p.nonoilScore || 0) + (p.effScore || 0) + (p.inspectScore || 0)
      - (p.complaint || 0) + (p.progress || 0);
    return r(total, 2);
  }

  /* 排名：得分降序；同分按油品段高者优先；否决者置末位 */
  function rank(rows) {
    var list = rows.slice().sort(function (a, b) {
      if (!!a.vetoed !== !!b.vetoed) return a.vetoed ? 1 : -1;
      if (b.total !== a.total) return b.total - a.total;
      return (b.oilScore || 0) - (a.oilScore || 0);
    });
    list.forEach(function (x, i) { x.rank = i + 1; });
    return list;
  }

  return {
    multi: multi,
    oilSegment: oilSegment,
    nonoilSegment: nonoilSegment,
    efficiency: efficiency,
    inspectResult: inspectResult,
    vetoResult: vetoResult,
    complaintDeduct: complaintDeduct,
    progressBonus: progressBonus,
    composite: composite,
    rank: rank,
    gradeOf: gradeOf,
    round: r
  };
})();
