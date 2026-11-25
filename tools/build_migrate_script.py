# -*- coding: utf-8 -*-
"""生成 tools/airscript/record_migrate_80.py（金山 PY 脚本），把 80 项题库内嵌进去。

为什么不手写：80 项的序号/大类/项目/分值必须与 docs/data/items.json 完全一致，
手工抄一次就是一次错的机会。这里从 items.json 直接生成。
"""
import io
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "docs", "data", "items.json")
OUT = os.path.join(ROOT, "tools", "airscript", "record_migrate_80.py")

BODY = '''# -*- coding: utf-8 -*-
"""考核记录表：73 项 → 80 项 一次性改造（金山文档 PY 脚本编辑器）

背景：2026-11-25 起题库换成《二级运营检查表8.21.xlsx》，检查项 73 → 80 项，
      每个站块从 78 行变成 85 行。考核记录表是预建模板（12 月 × 30 站块），
      必须同步加 7 行，否则 record_sync 会按旧偏移把分数写到错行。

★ 这个脚本只跑一次，每个年度工作簿各跑一次。
★ 先 dry 跑，看日志确认 30 块、73 项、目标月份都对，再改 run。

用的所在工作簿：打开哪一个就改哪一个，不需要指定文件 ID。
建议顺序：
    ① 先在《考核记录_2027.xlsx》上跑（全新年度，可放心改）
    ② 再在《考核记录_2026.xlsx》上只改 2026-12 一张表（1–11 月是历史数据，不动）

改完自查：
    - 日志最后一行应打印「30 块全部为 80 项」
    - 随便打开一个月 sheet，块内 合计 行的标准分合计应为 100
    - 再跑一次 record_sync.py，日志出现「块起点探测：30 块 · 步长 85/86」
"""

MODE = 'dry'          # 'dry' = 只报告不动手；'run' = 真正写
TARGET_MONTHS = []    # [] = 本簿全部 12 张月表；只改某几张就写 ['2026-12']
FORCE = False         # 已填过得分（E 列有数）的表默认跳过；确认要覆盖就设 True

TITLE_KEY = '二级运营检查记录'
OLD_COUNT = 73
NEW_COUNT = 80
TOTAL_WORDS = ('合计', '小计')
PROBE_ROWS = 2500

# (序号, 大类, 检查项目, 标准分) —— 与 docs/data/items.json 逐条对应
ITEMS = __ITEMS__


def _say(*a):
    try:
        print(*a)
    except Exception:
        pass


def _val(rng):
    v = rng.Value2
    if isinstance(v, (list, tuple)):
        return v[0][0] if v and isinstance(v[0], (list, tuple)) else (v[0] if v else None)
    return v


def _col_a(ws, r1, r2):
    vals = ws.Range('A%d:A%d' % (r1, r2)).Value2 or ()
    out = []
    for row in vals:
        out.append(row[0] if isinstance(row, (list, tuple)) else row)
    return out


def _block_starts(ws):
    out = []
    for i, v in enumerate(_col_a(ws, 1, PROBE_ROWS)):
        if isinstance(v, str) and TITLE_KEY in v:
            out.append(i + 1)
    return out


def _item_range(ws, r0, next_r0):
    """→ (item_start, item_end, tail_row, count, how)，与 record_sync 同口径。"""
    limit = (next_r0 - 1) if next_r0 else (r0 + 100)
    a = r0 + 3
    vals = _col_a(ws, r0, max(limit, r0 + 1))
    for i, v in enumerate(vals):
        if isinstance(v, str) and v.strip() in TOTAL_WORDS:
            tr = r0 + i
            return a, tr - 1, tr + 1, tr - a, 'probe'
    last = None
    for i, v in enumerate(vals):
        try:
            n = int(v)
        except Exception:
            continue
        if 1 <= n <= 200:
            last = r0 + i
    if last and last >= a:
        return a, last, last + 2, last - a + 1, 'seq'
    return a, r0 + 76, r0 + 78, 73, 'fallback'


def _insert_rows(ws, at, n):
    """在 at 行之前插入 n 行。金山 PY 的插入方法名各版本不一，逐个试。
    → (ok, 用过的方法名)"""
    tries = [
        ('Rows(at:at+n-1).Insert', lambda: ws.Rows('%d:%d' % (at, at + n - 1)).Insert()),
        ('Range(Aat).EntireRow.Insert', lambda: ws.Range('A%d' % at).EntireRow.Insert()),
        ('Range(Aat).EntireRow.Insert(shift)', lambda: ws.Range('A%d' % at).EntireRow.Insert(1)),
        ('Rows(at).Insert', lambda: ws.Rows('%d' % at).Insert()),
    ]
    for name, fn in tries:
        try:
            fn()
            return True, name
        except Exception:
            continue
    return False, ''


def _sheet_has_scores(ws, r0, item_end):
    """E 列（得分）是否已有内容 —— 有就说明这张表已经录过数，不该改版式。"""
    try:
        vals = ws.Range('E%d:E%d' % (r0 + 3, item_end)).Value2 or ()
    except Exception:
        return False
    for row in vals:
        v = row[0] if isinstance(row, (list, tuple)) else row
        if v is not None and str(v).strip() != '':
            return True
    return False


def _migrate_sheet(ws, name):
    starts = _block_starts(ws)
    if len(starts) != 30:
        _say('  [跳过] %s：块标题探测到 %d 块，期望 30 块，不动' % (name, len(starts)))
        return 0, 0

    # 先看清现状：每块多少项
    counts = []
    for i, r0 in enumerate(starts):
        nxt = starts[i + 1] if i + 1 < len(starts) else (r0 + 100)
        a, b, tail, cnt, how = _item_range(ws, r0, nxt)
        counts.append(cnt)
    bad = [c for c in counts if c not in (OLD_COUNT, NEW_COUNT)]
    if bad:
        _say('  [跳过] %s：存在异常块（项数 %s），不动' % (name, sorted(set(bad))))
        return 0, 0

    need = [c == OLD_COUNT for c in counts]
    if not any(need):
        _say('  [跳过] %s：30 块已是 %d 项，无需改造' % (name, NEW_COUNT))
        return 0, 0

    if not FORCE:
        for i, r0 in enumerate(starts):
            if not need[i]:
                continue
            nxt = starts[i + 1] if i + 1 < len(starts) else (r0 + 100)
            a, b, tail, cnt, how = _item_range(ws, r0, nxt)
            if _sheet_has_scores(ws, r0, b):
                _say('  [拒绝] %s：第 %d 块（行 %d）已有得分数据，说明这张表录过数。'
                     % (name, i + 1, r0))
                _say('         历史月份不应改版式。确认要覆盖请设 FORCE = True（会清掉旧得分）。')
                return 0, 0

    _say('  %s：30 块 · 待改 %d 块 · 已是新口径 %d 块'
         % (name, sum(1 for x in need if x), sum(1 for x in need if not x)))

    if MODE != 'run':
        _say('          （dry 模式，未做任何改动）')
        return 0, sum(1 for x in need if x)

    done = 0
    method = ''
    # ★ 必须从最后一个块往上改：在上方插行会把它下面的块整体下移
    for i in range(len(starts) - 1, -1, -1):
        if not need[i]:
            continue
        r0 = starts[i]
        nxt = starts[i + 1] if i + 1 < len(starts) else (r0 + 100)
        a, b, tail, cnt, how = _item_range(ws, r0, nxt)
        if cnt != OLD_COUNT:
            continue
        total_row = b + 1                       # 旧合计行
        add = NEW_COUNT - OLD_COUNT
        ok, m = _insert_rows(ws, total_row, add)
        if not ok:
            _say('  [失败] 第 %d 块插行失败，本表中止（已改的 %d 块保留）' % (i + 1, done))
            return done, sum(1 for x in need if x)
        method = m
        # 插完行后，明细区变成 a .. a+NEW_COUNT-1
        _rewrite_items(ws, a, i)
        done += 1

    _say('  插行方法：%s · 已改 %d 块' % (method, done))

    # 改完自查
    starts2 = _block_starts(ws)
    cs = []
    for i, r0 in enumerate(starts2):
        nxt = starts2[i + 1] if i + 1 < len(starts2) else (r0 + 100)
        a, b, tail, cnt, how = _item_range(ws, r0, nxt)
        cs.append(cnt)
    if len(starts2) == 30 and all(c == NEW_COUNT for c in cs):
        _say('  自查通过：30 块全部为 %d 项' % NEW_COUNT)
    else:
        _say('  [WARN] 自查未通过：块数 %d，项数分布 %s' % (len(starts2), sorted(set(cs))))
    return done, sum(1 for x in need if x)


def _rewrite_items(ws, a, block_idx):
    """把一个块的 A/B/C/D 四列（序号/大类/项目/标准分）按新题库重写。"""
    ws.Range('A%d:A%d' % (a, a + NEW_COUNT - 1)).NumberFormat = '@'
    for k, (no, cat, name, std) in enumerate(ITEMS):
        r = a + k
        ws.Range('A%d' % r).Value2 = no
        ws.Range('B%d' % r).Value2 = cat
        ws.Range('C%d' % r).Value2 = name
        ws.Range('D%d' % r).Value2 = std
    # 合计行（明细之后第 1 行）写上标准分合计，便于人工核对
    total_row = a + NEW_COUNT
    try:
        ws.Range('D%d' % total_row).Value2 = sum(x[3] for x in ITEMS)
    except Exception:
        pass


def main():
    _say('=' * 58)
    _say('考核记录表 73→80 项改造 · MODE=%s · FORCE=%s' % (MODE, FORCE))
    _say('题库：%d 项 / 合计 %d 分' % (NEW_COUNT, sum(x[3] for x in ITEMS)))
    _say('=' * 58)

    try:
        names = []
        S = Application.Sheets
        n = S.Count or S.length or 0
        for i in range(1, n + 1):
            try:
                nm = S.Item(i).Name
                if nm:
                    names.append(str(nm))
            except Exception:
                pass
    except Exception:
        names = []

    if not names:
        _say('取不到工作表列表，请确认在《考核记录_xxxx.xlsx》里运行')
        return

    targets = [t for t in TARGET_MONTHS] if TARGET_MONTHS else names
    miss = [t for t in targets if t not in names]
    if miss:
        _say('[WARN] 本簿没有这些表：%s' % '、'.join(miss))
    targets = [t for t in targets if t in names]
    _say('本次处理 %d 张表：%s' % (len(targets), '、'.join(targets)))

    tot_done, tot_plan = 0, 0
    for nm in targets:
        try:
            ws = Application.Sheets.Item(nm)
        except Exception:
            ws = Application.Sheets(nm)
        _say('')
        _say('--- %s ---' % nm)
        d, p = _migrate_sheet(ws, nm)
        tot_done += d
        tot_plan += p

    _say('')
    _say('=' * 58)
    if MODE == 'run':
        _say('完成：应改 %d 块，实改 %d 块' % (tot_plan, tot_done))
        if tot_done != tot_plan:
            _say('[WARN] 有块未改，请重跑或检查日志')
    else:
        _say('dry 跑完：共需改 %d 块。确认无误后把 MODE 改成 run 再跑一次。' % tot_plan)


main()
'''


def main():
    d = json.load(io.open(SRC, encoding="utf-8"))
    rows = []
    for it in d["items"]:
        rows.append((it["no"], it["cat"], it["name"], it["score"]))
    assert len(rows) == 80, "items.json 应为 80 项，实为 %d" % len(rows)
    assert sum(r[3] for r in rows) == 100, "合计应为 100"

    # 每行一条，便于在金山编辑器里肉眼核对
    lines = []
    for no, cat, name, score in rows:
        lines.append("    (%d, %r, %r, %d),"
                     % (no, cat, name, score))
    items_block = "[\n" + "\n".join(lines) + "\n]"

    code = BODY.replace("__ITEMS__", items_block)
    io.open(OUT, "w", encoding="utf-8").write(code)
    print("已生成:", OUT)
    print("内嵌 %d 项 / 合计 %d 分" % (len(rows), sum(r[3] for r in rows)))
    print("行数:", code.count("\n") + 1)


if __name__ == "__main__":
    main()
