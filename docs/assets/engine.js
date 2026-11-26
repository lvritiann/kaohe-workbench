/* 计分引擎 V6 —— 《目标责任考核方案》V1.0（2026-11-16 定稿）四项制
   油品40(封顶50) + 非油10(封顶12) + 人效12(封顶20) + 现场管理38（一级5+二级28+神访5）
   基准 100、封顶 120；不设等级，只按综合得分出 1–15 名（同分油品段优先）
   V6：取消少扣多奖斜率，改为「完成多少得多少分」；NA 折算统一走 naFill()
*/
window.Engine = (function () {
  var C = window.CFG;

  function r(n, d) { var p = Math.pow(10, d); return Math.round(n * p) / p; }
  function cap(v, c) { return Math.min(v, c); }
  function clamp0(v) { return v > 0 ? v : 0; }

  /* 当前会计月 'YYYY-MM'：26 日及以后算下个月 */
  function currentMonth() {
    var t = new Date(), y = t.getFullYear(), m = t.getMonth() + 1;
    if (t.getDate() >= 26) { m += 1; if (m > 12) { m = 1; y += 1; } }
    return y + '-' + (m < 10 ? '0' + m : m);
  }

  /* 会计月天数：上月 26 日 — 本月 25 日，实际 28/29/30/31 天不等。
     例：2026-03 → 28 天；2027-03 → 28 天；2028-03（闰年含 2/29）→ 29 天。
     ★ 任何地方都不得把天数写死成 30 或 31。 */
  function accountDays(month) {
    var mm = String(month || currentMonth()).split('-');
    var y = parseInt(mm[0], 10), m = parseInt(mm[1], 10);
    if (!(y > 1900) || !(m >= 1 && m <= 12)) {
      mm = currentMonth().split('-'); y = parseInt(mm[0], 10); m = parseInt(mm[1], 10);
    }
    var sy = (m === 1) ? y - 1 : y;
    var sm = (m === 1) ? 12 : m - 1;
    var start = new Date(sy, sm - 1, 26);
    var end = new Date(y, m - 1, 25);
    return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  }

  /* 直接计分：得分 ＝ 基准分 × 完成率，到封顶即止（V6 取消打折/加倍） */
  function direct(rate, base, capScore) {
    if (!(rate > 0)) return 0;
    return cap(base * rate, capScore);
  }

  /* 一、油品销量段（40 / 封顶50） */
  function oilSegment(actualTon, taskTon) {
    if (!(taskTon > 0)) return { rate: 0, raw: 0, score: 0 };
    var rate = actualTon / taskTon;
    var raw = clamp0(C.seg.oil.base * rate);
    return { rate: r(rate, 4), raw: r(raw, 2), score: r(cap(raw, C.seg.oil.cap), 2) };
  }

  /* 二、非油销量段（10 / 封顶12）
     salesRate = 不含烟草销售完成率；marginRate = 含烟草毛利率完成率；各 5 分、各封顶 6 */
  function nonoilSegment(salesRate, marginRate) {
    var w = C.nonoil;
    var s = cap(clamp0(w.salesWeight * (salesRate || 0)), w.capEach);
    var m = cap(clamp0(w.marginWeight * (marginRate || 0)), w.capEach);
    return {
      salesRate: r(salesRate || 0, 4), marginRate: r(marginRate || 0, 4),
      salesScore: r(s, 2), marginScore: r(m, 2),
      score: r(cap(s + m, C.seg.nonoil.cap), 2)
    };
  }

  /* 三、油品人效段（12 / 封顶20）
     人效 ≤ 基准49：得分 ＝ 12 × 人效 ÷ 49
     人效 > 基准49：得分 ＝ 12 ＋ 8 ×（人效 − 49）÷ 49
     人效达基准 2 倍（98）封顶 20 */
  function efficiency(gasTon, dieselTon, monthlyHead, days) {
    var H = C.hr;
    days = days > 0 ? days : accountDays(currentMonth());   /* 按会计月实算，不写死 30 */
    var totalSge = (gasTon || 0) * H.sgeGas + (dieselTon || 0) * H.sgeDiesel;
    var daySge = totalSge / days;
    var denom = (monthlyHead || 0) - H.baseHeadcount;
    var eff = denom > 0 ? daySge / denom : 0;
    var b = H.benchmark;
    var raw = eff <= b
      ? H.baseScore * eff / b
      : H.baseScore + H.surgeScore * (eff - b) / b;
    return {
      days: days, totalSge: r(totalSge, 1), daySge: r(daySge, 1),
      monthlyHead: monthlyHead, denom: r(denom, 2), eff: r(eff, 2),
      multiple: r(eff / b, 3),
      raw: r(raw, 2), score: r(cap(clamp0(raw), C.seg.eff.cap), 2)
    };
  }

  /* NA 折算通用函数：某项无数据（NA）时，按该站「其余项得分率」把这一项补齐
     rawOther  = 该站其余项实际得分合计
     baseOther = 该站其余项基准满分合计（100 − 该项基准分）
     itemBase  = 该项基准分
     例：一级考核 NA → naFill(其余项得分, 95, 5)；南沙神访 NA → naFill(其余项得分, 95, 5) */
  function naFill(rawOther, baseOther, itemBase) {
    if (!(baseOther > 0)) return 0;
    return r(cap(clamp0(rawOther) / baseOther * itemBase, itemBase), 2);
  }

  /* 四之一、一级考核（5）—— 百分制折算；未开展记 NA 由 naFill 补齐 */
  function primarySegment(score100, naRaw, naBase) {
    if (score100 == null || score100 === '' || isNaN(score100)) {
      var filled = naFill(naRaw || 0, naBase || C.naBase.primary, C.seg.primary.base);
      return { raw: filled, na: true, score: r(filled, 2) };
    }
    var v = clamp0(Number(score100));
    return { raw: r(v, 2), na: false, score: r(cap(v / 100 * C.seg.primary.base, C.seg.primary.cap), 2) };
  }

  /* 四之二、二级运营检查（28）—— 100 分制，NA 项标准分从分母剔除 */
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

  /* 四之三、神秘访客（5）—— 未测按当月参评站均分填补；NA（南沙）由 naFill 补齐 */
  function mysterySegment(score100, untested, peerAverage, naRaw, naBase) {
    if (naRaw != null) {
      var filled = naFill(naRaw, naBase || C.naBase.mystery, C.seg.mystery.base);
      return { raw: filled, untested: true, na: true, score: r(filled, 2) };
    }
    var s = untested ? (peerAverage || 0) : (score100 || 0);
    return {
      raw: r(s, 2), untested: !!untested, na: false,
      score: r(cap(clamp0(s) / 100 * C.seg.mystery.base, C.seg.mystery.cap), 2)
    };
  }

  /* 现场管理段 NA 补齐（一级考核 / 神秘访客）
     两者都是 5 分项，口径完全一致：某项 NA 时，该项得分 = 该项基准分 ×（其余项得分 ÷ 其余项基准满分）
     其余项基准满分 = 100 − 所有 NA 项的基准分之和（一项 NA 为 95，两项 NA 为 90）
     同时 NA 时用同一个得分率补齐，避免两项互相引用形成循环。
     p = { oilScore, nonoilScore, effScore, inspectScore, primaryScore, primaryNA, mysteryScore, mysteryNA } */
  function fillOnSiteNA(p) {
    p = p || {};
    var items = [
      { k: 'primary', na: !!p.primaryNA, base: C.seg.primary.base, score: p.primaryScore || 0 },
      { k: 'mystery', na: !!p.mysteryNA, base: C.seg.mystery.base, score: p.mysteryScore || 0 }
    ];
    var naBase = 0;
    items.forEach(function (i) { if (i.na) naBase += i.base; });
    if (!naBase) return { primaryScore: items[0].score, mysteryScore: items[1].score, naBase: 0, rate: null, otherScore: 0, otherBase: 0 };

    var otherScore = (p.oilScore || 0) + (p.nonoilScore || 0) + (p.effScore || 0) + (p.inspectScore || 0);
    items.forEach(function (i) { if (!i.na) otherScore += i.score; });
    var otherBase = totalBase() - naBase;
    var rate = otherBase > 0 ? otherScore / otherBase : 0;

    var out = { naBase: naBase, rate: r(rate, 4), otherScore: r(otherScore, 2), otherBase: otherBase };
    items.forEach(function (i) {
      out[i.k + 'Score'] = i.na ? r(cap(i.base * rate, i.base), 2) : r(i.score, 2);
    });
    return out;
  }

  /* 基准分合计（100）与封顶合计（120） */
  function totalBase() {
    return C.seg.oil.base + C.seg.nonoil.base + C.seg.eff.base + C.seg.onSite.base;
  }

  /* 投诉三档扣分 ＋ 重大投诉一票否决（方案第八章（一））
       一般升级投诉 10 分／件 · 重复投诉 20 分／件 · 监管介入 50 分／件
       前三档不设下限（可使综合得分为负）；重大投诉不扣分，直接一票否决。

     入口既接受件数对象 {escalate, repeat, regulator, major}，
     也接受旧口径的总扣分 {complaint: 25}（rank_source.json 老格式），
     两者同时存在时以件数为准 —— 件数可复算，总数不可复算。 */
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  function complaintOf(src) {
    var K = C.complaint;
    src = src || {};
    var e = num(src.escalate), p = num(src.repeat), g = num(src.regulator);
    var major = !!src.major;
    var byTier = e * K.escalate + p * K.repeat + g * K.regulator;
    var legacy = num(src.complaint);
    var hasCounts = (e + p + g) > 0;
    var deduct = hasCounts ? byTier : (legacy > 0 ? legacy : byTier);
    return {
      escalate: e, repeat: p, regulator: g, major: major,
      count: e + p + g,
      byTier: r(byTier, 2),
      legacy: r(legacy, 2),
      deduct: r(deduct, 2),
      basis: hasCounts ? 'tiers' : (legacy > 0 ? 'legacy' : 'tiers'),
      vetoed: major
    };
  }

  /* 兼容旧调用：只给件数对象时返回扣分数 */
  function complaintDeduct(c) { return complaintOf(c).deduct; }

  function progressBonus(growthRate) {
    if (!(growthRate > 0)) return 0;
    return r(Math.min(growthRate * 100 * C.progressPerPct || 0, C.progressCap), 2);
  }

  /* 现场管理段合计 = 一级 + 二级 + 神访 */
  function onSiteScore(p) {
    return r((p.primaryScore || 0) + (p.inspectScore || 0) + (p.mysteryScore || 0), 2);
  }

  /* 综合 = 油品 + 非油 + 人效 + 现场管理段 − 投诉扣分 + 进步加分；封顶 120（投诉不设下限）
     ★ 投诉以件数计（complaintOf），重大投诉或显式 vetoed → 当期记 0 分
        （与 build_rank.py / 方案第八章（一）、第九章一致） */
  function composite(p) {
    p = p || {};
    if (p.vetoed) return 0;
    var c = complaintOf(p);
    if (c.vetoed) return 0;
    var na = fillOnSiteNA(p);
    var sum = (p.oilScore || 0) + (p.nonoilScore || 0) + (p.effScore || 0)
      + (p.inspectScore || 0) + na.primaryScore + na.mysteryScore
      - c.deduct + (p.progress || 0);
    return r(Math.min(sum, C.totalCap || 120), 2);
  }

  /* 两侧等权平均（服务区级） */
  function serviceAverage(a, b) { return r(((a || 0) + (b || 0)) / 2, 2); }

  /* 把同一服务区两侧的打分结果合成为服务区级：
     primaryScore / inspectScore / mysteryScore 分别等权平均；converted / mystery100 一并平均便于展示 */
  function combineSides(sideA, sideB) {
    sideA = sideA || {}; sideB = sideB || {};
    var hasP = sideA.primaryScore != null || sideB.primaryScore != null;
    return {
      primaryScore: hasP ? serviceAverage(sideA.primaryScore, sideB.primaryScore) : null,
      inspectScore: serviceAverage(sideA.inspectScore, sideB.inspectScore),
      mysteryScore: serviceAverage(sideA.mysteryScore, sideB.mysteryScore),
      converted: serviceAverage(sideA.converted, sideB.converted),
      mystery100: serviceAverage(
        sideA.mystery100 != null ? sideA.mystery100 : sideA.raw,
        sideB.mystery100 != null ? sideB.mystery100 : sideB.raw)
    };
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
    direct: direct, oilSegment: oilSegment, nonoilSegment: nonoilSegment,
    efficiency: efficiency, naFill: naFill,
    accountDays: accountDays, currentMonth: currentMonth,
    primarySegment: primarySegment, inspectResult: inspectResult, vetoResult: vetoResult,
    mysterySegment: mysterySegment, complaintDeduct: complaintDeduct,
    complaintOf: complaintOf,
    progressBonus: progressBonus, onSiteScore: onSiteScore, composite: composite,
    fillOnSiteNA: fillOnSiteNA, totalBase: totalBase,
    rank: rank, serviceAverage: serviceAverage, combineSides: combineSides,
    gradeOf: gradeOf, round: r
  };
})();
