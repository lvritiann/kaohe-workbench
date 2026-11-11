/* 计分引擎 V3
   检查部分：与纸质表口径逐条对应
   人效部分：车次＋升数 SGE 模型 + 站点修正系数（依据《油品人效考核测算表》）
*/
window.Engine = (function () {
  var C = window.CFG;

  function r(n, d) { var p = Math.pow(10, d); return Math.round(n * p) / p; }

  /* ---------------- 运营检查 ---------------- */

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
      segment: r(converted * C.inspect.weight, 2)
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

  function composite(parts) {
    var total = (parts.effSegment || 0) + (parts.nonoilSegment || 0) + (parts.inspectSegment || 0)
      - (parts.complaint || 0) + (parts.progress || 0);
    return r(total, 2);
  }

  /* ---------------- 人效 V3 ---------------- */

  /* 预期人效 = a×ln(日均吨) + b；日均吨过小时取下限保护 */
  function expectedEff(dayTon) {
    if (!(dayTon > 0)) return 0;
    return C.hr.regA * Math.log(dayTon) + C.hr.regB;
  }

  /* 修正系数 = 基准 ÷ 预期人效，夹在 [floor, cap] */
  function coeffFor(dayTon) {
    var exp = expectedEff(dayTon);
    if (!(exp > 0)) return C.hr.coeffCap;
    var k = C.hr.benchmark / exp;
    if (k > C.hr.coeffCap) k = C.hr.coeffCap;
    if (k < C.hr.coeffFloor) k = C.hr.coeffFloor;
    return r(k, 3);
  }

  function gradeByRate(rate) {
    var L = C.hr.lines;
    if (rate >= L.excellent) return '优秀';
    if (rate >= L.good) return '良好';
    if (rate >= L.pass) return '合格';
    if (rate >= L.warn) return '待改进';
    return '不合格';
  }

  /* 人效测算
     o = { gasTon, dieselTon, head, station?, days? }
     days 用于把总量折算成日均（月累计口径时传当月营业天数）
  */
  function efficiency(o) {
    var H = C.hr;
    var gasTon = o.gasTon || 0;
    var dieselTon = o.dieselTon || 0;
    var head = o.head || 0;
    var days = o.days && o.days > 0 ? o.days : 1;

    /* 吨 → 升 */
    var gasLitre = gasTon * H.gasLitrePerTon;
    var dieselLitre = dieselTon * H.dieselLitrePerTon;

    /* 升 → 车次（估算） */
    var gasCars = gasLitre / H.gasLitrePerCar;
    var dieselCars = dieselLitre / H.dieselLitrePerCar;

    /* SGE = 车次×车次系数 + 升数×升数系数 */
    var gasSge = gasCars * H.sge.gasCarWeight + gasLitre * H.sge.gasLitreWeight;
    var dieselSge = dieselCars * H.sge.dieselCarWeight + dieselLitre * H.sge.dieselLitreWeight;
    var totalSge = gasSge + dieselSge;

    /* 日均 SGE */
    var daySge = totalSge / days;

    /* 实际人效（不扣人数、不做规模修正） */
    var eff = head > 0 ? daySge / head : 0;

    /* 修正系数：优先用当年发布值；未发布时按回归公式现算 */
    var dayTon = (gasTon + dieselTon) / days;
    var coeff, coeffFrom;
    if (o.station && C.stationCoeff[o.station]) {
      coeff = C.stationCoeff[o.station].coeff;
      coeffFrom = '当年发布';
    } else {
      coeff = coeffFor(dayTon);
      coeffFrom = '按回归现算';
    }

    var adjEff = eff * coeff;
    var rate = adjEff / H.benchmark;

    return {
      days: days,
      gasTon: r(gasTon, 4), dieselTon: r(dieselTon, 4),
      gasLitre: r(gasLitre, 0), dieselLitre: r(dieselLitre, 0),
      gasCars: r(gasCars, 1), dieselCars: r(dieselCars, 1),
      gasSge: r(gasSge, 1), dieselSge: r(dieselSge, 1), totalSge: r(totalSge, 1),
      daySge: r(daySge, 1),
      head: head,
      eff: r(eff, 2),
      dayTon: r(dayTon, 2),
      expectedEff: r(expectedEff(dayTon), 1),
      coeff: coeff,
      coeffFrom: coeffFrom,
      adjEff: r(adjEff, 2),
      rate: r(rate, 4),
      grade: gradeByRate(rate)
    };
  }

  /* 人效段得分：修正后人效 ÷ 当月最高修正后人效 × 50 */
  function effSegment(adjEff, maxAdjEff, full) {
    if (!(maxAdjEff > 0)) return 0;
    return r(adjEff / maxAdjEff * (full || C.weights.eff * 100), 2);
  }

  return {
    gradeOf: gradeOf,
    inspectResult: inspectResult,
    vetoResult: vetoResult,
    composite: composite,
    efficiency: efficiency,
    expectedEff: expectedEff,
    coeffFor: coeffFor,
    gradeByRate: gradeByRate,
    effSegment: effSegment,
    round: r
  };
})();
