/* 打分页主逻辑 */
(function () {
  var C = window.CFG;
  var E = window.Engine;
  var S = window.Store;
  var UI = window.UI;

  var DATA = null;
  var S_ = {
    station: localStorage.getItem('lastStation') || '',
    month: '',
    inspector: localStorage.getItem('lastInspector') || '',
    items: {},
    veto: {},
    notes: {}
  };

  var $ = function (id) { return document.getElementById(id); };
  var esc = UI.esc;

  function nowMonth() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
  }

  var CHEV = '<svg class="cat__chev" width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M6 9l6 6 6-6"/></svg>';

  function boot() {
    S_.month = nowMonth();
    fetch('data/items.json', { cache: 'no-cache' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        DATA = j;
        localStorage.setItem('itemsCache', JSON.stringify(j));
        render();
      })
      .catch(function () {
        var cached = localStorage.getItem('itemsCache');
        if (cached) { DATA = JSON.parse(cached); render(); UI.toast('离线：使用本机缓存题目'); }
        else {
          $('app').innerHTML = '<div class="err">题目数据加载失败，且本机无缓存。请联网后再打开一次。</div>';
        }
      });
  }

  function ringHtml() {
    var r = 26, c = 2 * Math.PI * r;
    return '<div class="ring">' +
      '<svg width="62" height="62" viewBox="0 0 62 62">' +
      '<circle class="ring__bg" cx="31" cy="31" r="' + r + '" stroke-width="5"/>' +
      '<circle class="ring__fg" id="ringFg" cx="31" cy="31" r="' + r + '" stroke-width="5" ' +
      'stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + c.toFixed(1) + '"/>' +
      '</svg><div class="ring__txt" id="ringTxt">0%</div></div>';
  }

  function render() {
    var h = '';

    h += '<section class="card"><div class="meter">' + ringHtml();
    h += '<div class="meter__main">';
    h += '<div class="meter__num"><span id="meterNum">—</span><small>分</small> <span class="tag" id="meterGrade">待评</span></div>';
    h += '<div class="meter__sub" id="meterSub">已判 0 / ' + DATA.items.length + ' 项</div>';
    h += '</div></div></section>';

    h += '<section class="card"><div class="sect__head" style="margin-bottom:10px"><span class="sect__title">本次检查</span></div>';
    h += '<div class="field"><label>油站</label><select id="fStation"><option value="">请选择油站</option>';
    C.stations.forEach(function (s) {
      h += '<option value="' + esc(s) + '"' + (s === S_.station ? ' selected' : '') + '>' + esc(s) + '</option>';
    });
    h += '</select></div>';
    h += '<div class="field"><label>检查月份</label><input type="month" id="fMonth" value="' + S_.month + '"></div>';
    h += '<div class="field"><label>检查人</label><input type="text" id="fInspector" placeholder="填写姓名" value="' + esc(S_.inspector) + '"></div>';
    h += '</section>';

    h += '<section class="cat veto" id="cat-veto">';
    h += '<div class="cat__head" data-cat="veto">';
    h += '<span class="cat__idx">!</span>';
    h += '<span class="cat__name">一票否决</span>';
    h += '<span class="cat__meta">6 项 <b id="catmeta-veto">0/6</b></span>' + CHEV + '</div>';
    h += '<div class="cat__body">';
    h += '<div style="padding:12px 16px 0"><div class="hint">任一项判定不合格，本单位当期综合得分记 0 分、排名垫底、当年不得评优。</div></div>';
    DATA.veto.forEach(function (v) {
      h += '<div class="veto-item" id="veto-' + v.no + '">';
      h += '<span class="veto-flag">否决 ' + v.no + '</span>';
      h += '<div class="item__top"><span class="item__name">' + esc(v.name) + '</span></div>';
      h += '<div class="item__content">' + esc(v.content) + '</div>';
      h += '<details class="more"><summary>检查方法</summary><div class="std">' + esc(v.method) + '</div></details>';
      h += '<div class="seg" data-kind="veto" data-no="' + v.no + '">';
      h += '<button type="button" data-v="ok">合格</button>';
      h += '<button type="button" data-v="no">不合格</button>';
      h += '<button type="button" data-v="">待判</button>';
      h += '</div></div>';
    });
    h += '</div></section>';

    h += '<div class="sect__head" style="margin-top:22px"><span class="sect__title">运营检查</span>' +
      '<span class="sect__hint">73 项 · 100 分</span></div>';

    DATA.categories.forEach(function (cat, ci) {
      var list = DATA.items.filter(function (i) { return i.cat === cat.title; });
      var idx = ci + 1;
      h += '<section class="cat" id="cat-' + ci + '">';
      h += '<div class="cat__head" data-cat="' + ci + '">';
      h += '<span class="cat__idx">' + (idx < 10 ? '0' + idx : idx) + '</span>';
      h += '<span class="cat__name">' + esc(cat.title.replace(/^[一二三四五六七八九十]+、/, '')) + '</span>';
      h += '<span class="cat__meta">' + cat.score + ' 分 <b id="catmeta-' + ci + '">0/' + list.length + '</b></span>';
      h += CHEV + '</div><div class="cat__body">';
      list.forEach(function (it) { h += itemHtml(it); });
      h += '</div></section>';
    });

    $('app').innerHTML = h;
    bind();
    loadDraft();
    refreshAll();
  }

  function itemHtml(it) {
    var h = '';
    h += '<div class="item" id="item-' + it.no + '">';
    h += '<div class="item__top"><span class="item__no">' + it.no + '</span>';
    h += '<span class="item__name">' + esc(it.name) + '</span>';
    h += '<span class="item__score">' + it.score + '分</span></div>';
    h += '<div class="item__content">' + esc(it.content) + '</div>';
    h += '<details class="more"><summary>判定标准 · 检查方法</summary>';
    h += '<div class="std"><b>判定</b>　' + esc(it.std) + '</div>';
    h += '<div class="std"><b>方法</b>　' + esc(it.method) + '</div></details>';
    h += '<div class="seg" data-kind="item" data-no="' + it.no + '">';
    h += '<button type="button" data-v="ok">符合</button>';
    h += '<button type="button" data-v="no">不符合</button>';
    h += '<button type="button" data-v="na">不适用</button>';
    h += '</div>';
    h += '<div class="note" id="note-' + it.no + '" style="display:none">';
    h += '<input type="text" placeholder="问题说明 / NA 原因（必填）" data-note="' + it.no + '">';
    h += '</div></div>';
    return h;
  }

  function bind() {
    $('fStation').addEventListener('change', function () {
      S_.station = this.value;
      localStorage.setItem('lastStation', S_.station);
      loadDraft(); refreshAll();
    });
    $('fMonth').addEventListener('change', function () {
      S_.month = this.value || nowMonth();
      loadDraft(); refreshAll();
    });
    $('fInspector').addEventListener('input', function () {
      S_.inspector = this.value.trim();
      localStorage.setItem('lastInspector', S_.inspector);
      scheduleSave();
    });

    $('app').addEventListener('click', function (e) {
      var head = e.target.closest('.cat__head');
      if (head) {
        var key = head.getAttribute('data-cat');
        var box = document.getElementById('cat-' + key);
        if (box) box.classList.toggle('open');
        return;
      }
      var btn = e.target.closest('.seg button');
      if (!btn) return;
      var seg = btn.parentNode;
      var kind = seg.getAttribute('data-kind');
      var no = +seg.getAttribute('data-no');
      var val = btn.getAttribute('data-v');
      if (kind === 'veto') {
        if (val) S_.veto[no] = val; else delete S_.veto[no];
      } else {
        if (val) S_.items[no] = val; else delete S_.items[no];
      }
      paintSeg(seg, val);
      if (kind === 'item') toggleNote(no, val);
      refreshAll();
      scheduleSave();
    });

    $('app').addEventListener('input', function (e) {
      var t = e.target.getAttribute && e.target.getAttribute('data-note');
      if (t) { S_.notes[+t] = e.target.value; scheduleSave(); }
    });

    $('btnSubmit').addEventListener('click', onSubmit);
  }

  function paintSeg(seg, val) {
    Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
      b.className = '';
      var v = b.getAttribute('data-v');
      if (v === val && val) b.className = 'on-' + v;
    });
    var box = seg.closest('.veto-item, .item');
    if (box && box.classList.contains('veto-item')) box.classList.toggle('fail', val === 'no');
  }

  function toggleNote(no, val) {
    var box = $('note-' + no);
    if (!box) return;
    var need = (val === 'no' || val === 'na');
    box.style.display = need ? 'block' : 'none';
    if (!need) { box.querySelector('input').value = ''; delete S_.notes[no]; }
  }

  function decided() { return Object.keys(S_.items).length; }

  function refreshAll() {
    var r = E.inspectResult(DATA, S_);
    var v = E.vetoResult(DATA, S_);
    var total = DATA.items.length + DATA.veto.length;
    var doneAll = decided() + (DATA.veto.length - v.undecided);
    var pct = Math.round(doneAll / total * 100);

    var c = 2 * Math.PI * 26;
    var fg = $('ringFg');
    if (fg) fg.setAttribute('stroke-dashoffset', (c * (1 - doneAll / total)).toFixed(1));
    if ($('ringTxt')) $('ringTxt').textContent = pct + '%';

    DATA.categories.forEach(function (cat, ci) {
      var list = DATA.items.filter(function (i) { return i.cat === cat.title; });
      var done = list.filter(function (i) { return S_.items[i.no]; }).length;
      var m = $('catmeta-' + ci);
      if (m) m.textContent = done + '/' + list.length;
      var box = $('cat-' + ci);
      if (box) box.classList.toggle('done', done === list.length);
    });
    var vm = $('catmeta-veto');
    if (vm) vm.textContent = (DATA.veto.length - v.undecided) + '/' + DATA.veto.length;

    DATA.items.forEach(function (it) {
      var seg = document.querySelector('.seg[data-kind="item"][data-no="' + it.no + '"]');
      if (seg) { paintSeg(seg, S_.items[it.no] || ''); if (S_.items[it.no]) toggleNote(it.no, S_.items[it.no]); }
    });
    DATA.veto.forEach(function (vv) {
      var seg = document.querySelector('.seg[data-kind="veto"][data-no="' + vv.no + '"]');
      if (seg) paintSeg(seg, S_.veto[vv.no] || '');
    });

    var has = decided() > 0;
    if ($('meterNum')) $('meterNum').textContent = has ? r.converted.toFixed(1) : '—';
    if ($('barScore')) $('barScore').textContent = has ? r.converted.toFixed(1) : '—';
    var g = $('meterGrade');
    if (g) {
      g.textContent = has ? r.grade : '待评';
      g.className = 'tag ' + (r.grade === '优秀' ? 'ok' : r.grade === '不合格' ? 'no' : '');
    }
    var sub = '已判 ' + decided() + ' / ' + DATA.items.length +
      (r.naCount ? ' · NA ' + r.naCount : '') + (r.noCount ? ' · 不符 ' + r.noCount : '');
    if ($('meterSub')) $('meterSub').textContent = sub;
    if ($('barSub')) $('barSub').textContent = sub;

    var si = $('subInfo');
    if (si) si.textContent = (S_.station || '未选油站') + ' · ' + (S_.month || '') +
      (v.vetoed ? ' · 已触发否决' : '');
  }

  var saveTimer = null;
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(doSave, 400); }
  function doSave() {
    if (!S_.station || !S_.month) return;
    S.saveDraft(S_.station + '|' + S_.month, {
      station: S_.station, month: S_.month, inspector: S_.inspector,
      items: S_.items, veto: S_.veto, notes: S_.notes
    });
  }
  function loadDraft() {
    S_.items = {}; S_.veto = {}; S_.notes = {};
    if (!S_.station || !S_.month) return;
    S.getDraft(S_.station + '|' + S_.month).then(function (d) {
      if (!d) return;
      S_.items = d.items || {};
      S_.veto = d.veto || {};
      S_.notes = d.notes || {};
      if (d.inspector && !S_.inspector) { S_.inspector = d.inspector; if ($('fInspector')) $('fInspector').value = d.inspector; }
      DATA.items.forEach(function (it) {
        if (S_.notes[it.no]) {
          var box = $('note-' + it.no);
          if (box) { box.style.display = 'block'; box.querySelector('input').value = S_.notes[it.no]; }
        }
      });
      refreshAll();
      UI.toast('已恢复上次草稿');
    }).catch(function () { });
  }

  function onSubmit() {
    var r = E.inspectResult(DATA, S_);
    var v = E.vetoResult(DATA, S_);
    var problems = [];

    if (!S_.station) problems.push('未选择油站');
    if (!S_.month) problems.push('未选择检查月份');
    if (!S_.inspector) problems.push('未填写检查人');
    if (r.undecided > 0) problems.push('还有 ' + r.undecided + ' 个判定项未判');
    if (v.undecided > 0) problems.push('还有 ' + v.undecided + ' 个一票否决项未判');

    var missing = [];
    DATA.items.forEach(function (it) {
      var a = S_.items[it.no];
      if ((a === 'no' || a === 'na') && !(S_.notes[it.no] || '').trim()) missing.push(it.no);
    });
    if (missing.length) problems.push('第 ' + missing.join('、') + ' 项不符/不适用但未写说明');

    if (problems.length) {
      showSheet('<div class="sheet__grip"></div><h3>还不能提交</h3><div class="err">' +
        problems.map(esc).join('<br>') + '</div>' +
        '<div class="sheet__acts"><button class="btn btn--primary" onclick="closeSheet()">返回填写</button></div>');
      return;
    }

    var b = '<div class="sheet__grip"></div><h3>提交前确认</h3>';
    b += '<div class="kv"><span>油站 / 月份</span><b>' + esc(S_.station) + ' · ' + esc(S_.month) + '</b></div>';
    b += '<div class="kv"><span>检查人</span><b>' + esc(S_.inspector) + '</b></div>';
    b += '<div class="kv"><span>实得 / 有效满分</span><b>' + r.raw + ' / ' + r.effective + '</b></div>';
    b += '<div class="kv"><span>NA 项</span><b>' + r.naCount + ' 项 · ' + r.naScore + ' 分</b></div>';
    b += '<div class="kv"><span>折算得分</span><b>' + r.converted.toFixed(2) + '（' + r.grade + '）</b></div>';
    b += '<div class="kv kv--total"><span>计入综合得分 ×30%</span><b>' + r.segment.toFixed(2) + '</b></div>';
    if (v.vetoed) {
      b += '<div class="err">已触发一票否决：' + esc(v.failed.join('、')) +
        '<br>提交后本单位当期综合得分记 0 分、排名垫底、当年不得评优。</div>';
    }
    b += '<div class="field" style="margin-top:18px"><label>提交口令</label>' +
      '<input type="password" id="passInput" placeholder="向计划经营科索取" autocomplete="off"></div>';
    b += '<div class="hint" style="margin-top:10px">提交后生成 Excel 文件，请发回计划经营科。文件名含站名与月份，重复提交以最后一次为准。</div>';
    b += '<div class="sheet__acts"><button class="btn btn--ghost" onclick="closeSheet()">返回修改</button>' +
      '<button class="btn btn--primary" id="doSubmit">确认提交</button></div>';
    showSheet(b);

    $('doSubmit').addEventListener('click', function () {
      var pass = ($('passInput').value || '').trim();
      if (pass !== C.submitPass) { UI.toast('口令不正确'); return; }
      doGenerate(r, v);
    });
  }

  function doGenerate(r, v) {
    var ts = new Date();
    var stamp = ts.getFullYear() + ('0' + (ts.getMonth() + 1)).slice(-2) + ('0' + ts.getDate()).slice(-2) +
      ('0' + ts.getHours()).slice(-2) + ('0' + ts.getMinutes()).slice(-2);
    var fname = '检查表_' + S_.station + '_' + S_.month + '_' + stamp + '.xlsx';

    try {
      var wb = buildWorkbook(r, v, ts);
      XLSX.writeFile(wb, fname);
      S.addOutbox({
        station: S_.station, month: S_.month, inspector: S_.inspector,
        submittedAt: ts.getTime(), fileName: fname,
        converted: r.converted, grade: r.grade, vetoed: v.vetoed
      });
      S.removeDraft(S_.station + '|' + S_.month);
      closeSheet();
      showSheet('<div class="sheet__grip"></div><h3>已生成</h3>' +
        '<div class="hint">文件已下载到手机：<br><b style="word-break:break-all;color:#0b2a39">' + esc(fname) +
        '</b><br><br>请通过微信发回计划经营科，科室运行导入脚本后即写入金山表格。</div>' +
        '<div class="sheet__acts"><button class="btn btn--primary" onclick="closeSheet()">知道了</button></div>');
    } catch (err) {
      showSheet('<div class="sheet__grip"></div><h3>生成失败</h3><div class="err">' + esc(err.message) + '</div>' +
        '<div class="sheet__acts"><button class="btn btn--primary" onclick="closeSheet()">关闭</button></div>');
    }
  }

  window.closeSheet = function () { $('mask').classList.remove('show'); };
  function showSheet(html) { $('modal').innerHTML = html; $('mask').classList.add('show'); }

  function buildWorkbook(r, v, ts) {
    var aoa = [];
    aoa.push(['二级运营检查评分表（V2.1）']);
    aoa.push([]);
    aoa.push(['油站名称', S_.station, '检查月份', S_.month]);
    aoa.push(['检查人', S_.inspector, '提交时间', fmt(ts)]);
    aoa.push([]);
    aoa.push(['第一部分  一票否决项']);
    aoa.push(['序号', '否决项', '检查内容', '检查方法', '结果', '备注']);
    DATA.veto.forEach(function (x) {
      aoa.push([x.no, x.name, x.content, x.method, S_.veto[x.no] === 'no' ? '不合格' : '合格', '']);
    });
    aoa.push([]);
    aoa.push(['第二部分  运营检查评分（100 分制）']);
    aoa.push(['大类', '序号', '检查项目', '检查内容', '检查方法', '判定标准', '标准分', '得分', '整改', '备注']);
    DATA.items.forEach(function (it) {
      var a = S_.items[it.no];
      var score = a === 'ok' ? it.score : a === 'na' ? 'NA' : 0;
      aoa.push([it.cat, it.no, it.name, it.content, it.method, it.std, it.score,
        score, a === 'no' ? '是' : '', S_.notes[it.no] || '']);
    });
    aoa.push([]);
    aoa.push(['实得小计', r.raw]);
    aoa.push(['NA 项标准分合计', r.naScore]);
    aoa.push(['有效项总分', r.effective]);
    aoa.push(['折算后得分（百分制）', r.converted]);
    aoa.push(['检查得分等级', r.grade]);
    aoa.push(['计入综合得分（×30%）', r.segment]);

    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 18 }, { wch: 5 }, { wch: 20 }, { wch: 44 }, { wch: 26 },
      { wch: 34 }, { wch: 7 }, { wch: 7 }, { wch: 6 }, { wch: 20 }];

    var s2 = [['大类', '分值', '判定项数', '实得', '不符合项数', 'NA项数']];
    DATA.categories.forEach(function (cat) {
      var list = DATA.items.filter(function (i) { return i.cat === cat.title; });
      var got = 0, no = 0, na = 0;
      list.forEach(function (i) {
        var a = S_.items[i.no];
        if (a === 'ok') got += i.score;
        if (a === 'no') no += 1;
        if (a === 'na') na += 1;
      });
      s2.push([cat.title, cat.score, list.length, got, no, na]);
    });
    s2.push([]);
    s2.push(['合计', DATA.total, DATA.items.length, r.raw, r.noCount, r.naCount]);
    s2.push([]);
    s2.push(['一票否决', v.vetoed ? '已触发：' + v.failed.join('、') : '未触发']);
    var ws2 = XLSX.utils.aoa_to_sheet(s2);
    ws2['!cols'] = [{ wch: 24 }, { wch: 8 }, { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 8 }];

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '评分表');
    XLSX.utils.book_append_sheet(wb, ws2, '汇总');
    return wb;
  }

  function fmt(d) {
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) +
      ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  boot();
})();
