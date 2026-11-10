/* 计分引擎：与纸质表口径逐条对应
   answers = { items: {序号: 'ok'|'no'|'na'}, veto: {序号: 'ok'|'no'}, notes: {} }
*/
window.Engine = (function () {
  var C = window.CFG;

  function gradeOf(score) {
    var L = C.inspect.gradeLines;
    if (score >= L.excellent) return '优秀';
    if (score >= L.good) return '良好';
    if (score >= L.pass) return '合格';
    return '不合格';
  }

  /* 运营检查折算：实得 ÷（100 − NA项标准分）× 100 */
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
    var converted = effective > 0 ? Math.round(raw / effective * 100 * 100) / 100 : 0;
    if (Object.keys(answers.items).length === 0) converted = 0;

    return {
      raw: raw,
      naScore: naScore,
      naCount: naCount,
      noCount: noCount,
      undecided: undecided,
      effective: effective,
      converted: converted,
      grade: gradeOf(converted),
      segment: Math.round(converted * C.inspect.weight * 100) / 100
    };
  }

  function vetoResult(data, answers) {
    var failed = [];
    var undecided = 0;
    data.veto.forEach(function (v) {
      var a = answers.veto[v.no];
      if (a === 'no') failed.push(v.name);
      else if (!a) undecided += 1;
    });
    return { failed: failed, vetoed: failed.length > 0, undecided: undecided };
  }

  /* 三段综合得分（人效段、非油段由站端报数另算，此处只需检查段） */
  function composite(parts) {
    var eff = parts.effSegment || 0;
    var nonoil = parts.nonoilSegment || 0;
    var insp = parts.inspectSegment || 0;
    var complaint = parts.complaint || 0;
    var progress = parts.progress || 0;
    var total = eff + nonoil + insp - complaint + progress;
    return Math.round(total * 100) / 100;
  }

  /* 人效四步：供算例页与演示 */
  function efficiency(o) {
    var H = C.hr;
    var sge = o.gasTon * H.sgeGas + o.dieselTon * H.sgeDiesel;
    var shortage = o.avgRegistered > 0
      ? (o.avgRegistered - o.onDuty) / o.avgRegistered : 0;
    var denomBase = o.onDuty;
    var corrected = false;
    if (shortage > H.shortageThreshold) {
      denomBase = Math.max(o.onDuty, o.avgRegistered * 0.8);
      corrected = true;
    }
    var denom = Math.max(denomBase - H.baseHeadcount, 0.01);
    var eff = sge / denom;
    var rate = eff / H.benchmark;
    return {
      sge: Math.round(sge * 10) / 10,
      shortage: shortage,
      denomBase: Math.round(denomBase * 10) / 10,
      corrected: corrected,
      denom: Math.round(denom * 100) / 100,
      efficiency: Math.round(eff * 100) / 100,
      rate: rate,
      grade: rate >= 1.10 ? '优秀' : rate >= 1.0 ? '良好' : rate >= 0.9 ? '合格' : rate >= 0.8 ? '待改进' : '不合格'
    };
  }

  return {
    gradeOf: gradeOf,
    inspectResult: inspectResult,
    vetoResult: vetoResult,
    composite: composite,
    efficiency: efficiency
  };
})();
