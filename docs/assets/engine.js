/* 计分引擎 V5 —— 《目标责任考核方案》V1.0 五段制
   油品40 + 非油10 + 人效15 + 运营检查20 + 神秘访客15；基准100、封顶120
   不设等级，只按综合得分出 1–15 名（同分油品段优先）
*/
window.Engine = (function () {
  var C = window.CFG;

  function r(n, d) { var p = Math.pow(10, d); return Math.round(n * p) / p; }
  function cap(v, c) { return Math.min(v, c); }

  /* 少扣多奖：≥100% 按 1+1.5(r−1)；<100% 按 1+0.5(r−1) */
  function multi(rate) {
    var k = C.scoreRule;
    return rate >= 1 ? 1 + k.bonus * (rate - 1) : 1 + k.penalty * (rate - 1);
  }

  /* 一、油品销量段（40 / 封顶48） */
  function oilSegment(actualTon, taskTon) {
    if (!(taskTon > 0)) return { rate: 0, raw: 0, score: 0 };
    var rate = actualTon / taskTon;
    var raw = Math.max(0, C.seg.oil.base * multi(rate));
    return { rate: r(rate, 4), raw: r(raw, 2), score: r(cap(raw, C.seg.oil.cap), 2) };
  }

  /* 二、非油销量段（10 / 封顶12）
     salesRate = 不含烟草销售完成率；marginRate = 含烟草毛利率完成率 */
  function nonoilSegment(salesRate, marginRate) {
    var w = C.nonoil;
    var s = cap(Math.max(0, w.salesWeight * multi(salesRate)), w.capEach);
    var m = cap(Math.max(0, w.marginWeight * multi(marginRate)), w.capEach);
    return {
      salesRate: r(salesRate, 4), marginRate: r(marginRate, 4),
      salesScore: r(s, 2), marginScore: r(m, 2),
      score: r(cap(s + m, C.seg.nonoil.cap), 2)
    };
  }

  /* 三、油品人效段（15 / 封顶25）
     gasTon/dieselTon = 会计月累计吨数；days = 会计月天数；monthlyHead = 月均在岗人数 */
  function efficiency(gasTon, dieselTon, monthlyHead, days) {
    var H = C.hr;
    days = days > 0 ? days : 30;
    var totalSge = gasTon * H.sgeGas + dieselTon * H.sgeDiesel;
    var daySge = totalSge / days;
    var denom = monthlyHead - H.baseHeadcount;
    var eff = denom > 0 ? daySge / denom : 0;
    var raw = eff / H.benchmark * C.seg.eff.base;
    return {
      days: days, totalSge: r(totalSge, 1), daySge: r(daySge, 1),
      monthlyHead: monthlyHead, denom: r(denom, 2), eff: r(eff, 2),
      multiple: r(eff / H.benchmark, 3),
      raw: r(raw, 2), score: r(cap(raw, C.seg.eff.cap), 2)
    };
  }

  /* 四、二级运营检查段（20） */
  function inspectResult(data, answers) {
    var raw = 0, naScore = 0, naCount = 0, noCount = 0, undecided = 0;
    data.items.forEach(function (it) {
      var a = answers.items[it.no];
      if (a === 'ok') raw += it.score;
      else if (a === 'na') { naScore += it.score; naCount += 1; }
      else if (a === 'no') noCount += 1;
      else undecided += 1;
    });
    var effective = C.inspect.total - naScore;
    var converted = effective > 0 ? r(raw / effective * 100, 2) : 0;
    if (Object.keys(answers.items).length === 0) converted = 0;
    return {
      raw: raw, naScore: naScore, naCount: naCount, noCount: noCount, undecided: undecided,
      effective: effective, converted: converted,
      grade: gradeOf(converted),
      score: r(cap(converted / 100 * C.seg.inspect.base, C.seg.inspect.cap), 2)
    };
  }

  function gradeOf(score) {
    var L = { excellent: 90, good: 80, pass: 70 };
    if (score >= L.excellent) return '优秀';
    if (score >= L.good) return '良好';
    if (score >= L.pass) return '合格';
    return '不合格';
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

  /* 五、神秘访客段（15）；未测按当月参评站均分填补 */
  function mysterySegment(score100, untested, peerAverage) {
    var s = untested ? (peerAverage || 0) : (score100 || 0);
    return { raw: r(s, 2), untested: !!untested, score: r(cap(s / 100 * C.seg.mystery.base, C.seg.mystery.cap), 2) };
  }

  function complaintDeduct(c) {
    var K = C.complaint;
    return (c.escalate || 0) * K.escalate + (c.repeat || 0) * K.repeat + (c.regulator || 0) * K.regulator;
  }

  function progressBonus(growthRate) {
    if (!(growthRate > 0)) return 0;
    return r(Math.min(growthRate * 100 * C.progressPerPct, C.progressCap), 2);
  }

  function composite(p) {
    var sum = (p.oilScore || 0) + (p.nonoilScore || 0) + (p.effScore || 0)
      + (p.inspectScore || 0) + (p.mysteryScore || 0)
      - (p.complaint || 0) + (p.progress || 0);
    /* 定稿：综合封顶 120；投诉扣分不设下限，故不夹下界 */
    return r(Math.min(sum, C.totalCap || 120), 2);
  }

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
    multi: multi, oilSegment: oilSegment, nonoilSegment: nonoilSegment,
    efficiency: efficiency, inspectResult: inspectResult, vetoResult: vetoResult,
    mysterySegment: mysterySegment, complaintDeduct: complaintDeduct,
    progressBonus: progressBonus, composite: composite, rank: rank,
    gradeOf: gradeOf, round: r
  };
})();
