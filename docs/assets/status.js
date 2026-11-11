/* 运营状态读取与判定（只读，全站共用）
   数据源：data/station_status.json —— 由管理端签发变更单、科室推送后生效
*/
window.Status = (function () {

  var DATA = null;

  function load() {
    return fetch('data/station_status.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('no status'); return r.json(); })
      .then(function (j) { DATA = j; return j; })
      .catch(function () {
        var c = localStorage.getItem('statusCache');
        if (c) { try { DATA = JSON.parse(c); } catch (e) { } }
        return DATA;
      });
  }

  function typeOf(code) {
    if (!DATA) return null;
    return (DATA.statusTypes || {})[code] || null;
  }

  /* 某站在某月（YYYY-MM）生效的最新指令；to 为空表示持续有效 */
  function forMonth(station, month) {
    if (!DATA || !month) return null;
    var hit = null;
    (DATA.records || []).forEach(function (r) {
      if (r.station !== station || r.active === false) return;
      if (r.from && r.from.slice(0, 7) > month) return;
      if (r.to && r.to.slice(0, 7) < month) return;
      if (!hit || String(r.setAt || '') > String(hit.setAt || '')) hit = r;
    });
    return hit;
  }

  /* 是否退出当月排名 */
  function excluded(station, month) {
    var r = forMonth(station, month);
    if (!r) return false;
    var t = typeOf(r.status);
    return !!(t && t.exclude);
  }

  /* 当月实际经营天数：部分停业/不可抗力按比例；关停返回 0 */
  function days(station, month) {
    var r = forMonth(station, month);
    var dim = daysInMonth(month);
    if (!r) return dim;
    if (excluded(station, month)) return 0;
    if (r.affectedDays != null && r.affectedDays !== '') {
      var d = Math.max(0, Math.min(dim, Number(r.affectedDays)));
      return d;
    }
    return dim;
  }

  function daysInMonth(month) {
    var p = String(month).split('-');
    return new Date(Number(p[0]), Number(p[1]), 0).getDate();
  }

  function label(station, month) {
    var r = forMonth(station, month);
    if (!r) return null;
    var t = typeOf(r.status);
    return {
      code: r.status,
      text: t ? t.label : r.status,
      reason: r.reason || '',
      from: r.from || '',
      to: r.to || '',
      operator: r.operator || '',
      id: r.id || ''
    };
  }

  /* 当前所有生效指令（按 setAt 倒序） */
  function all() {
    return ((DATA && DATA.records) || []).slice().sort(function (a, b) {
      return String(b.setAt || '').localeCompare(String(a.setAt || ''));
    });
  }

  return {
    load: load, forMonth: forMonth, excluded: excluded,
    days: days, label: label, typeOf: typeOf, all: all,
    daysInMonth: daysInMonth
  };
})();
