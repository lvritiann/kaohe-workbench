# -*- coding: utf-8 -*-
"""record_migrate_80_auto.py 回归测试（模拟金山表格，不碰真表）

验证七种情形：
  1. 2027 簿（12 张月表）→ 一次运行全改 80 项
  2. 2026 簿 → 只改 2026-12，1–11 月历史表一格不动
  3. 幂等：再跑一次不重复插行、报「无需改造」
  4. 半成品自愈：80 行但内容写错 → 自动补写
  5. 有得分数据的月表 → 整张拒绝
  6. 块数 ≠ 30 → 该表不动，其它表照常
  7. 时间预算耗尽 → 块边界暂停；再跑一次能续完

用法：python tools/_t_migrate_auto.py
"""
import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from _t_migrate import FakeApp, FakeSheets, FakeWS, build_sheet   # noqa: E402

SRC = os.path.join(ROOT, "tools", "airscript", "record_migrate_80_auto.py")
FAIL = []


def chk(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        FAIL.append(msg)


def load_mod():
    src = io.open(SRC, encoding="utf-8").read()
    src = src.replace("\nmain()\n", "\n")
    ns = {"__name__": "migrate_auto_test"}
    exec(compile(src, SRC, "exec"), ns)
    return ns


def run(book, budget=None):
    """跑一次，返回 (模块命名空间, 输出文本)"""
    ns = load_mod()
    if budget is not None:
        ns["TIME_BUDGET_SEC"] = budget
    ns["Application"] = FakeApp(FakeSheets(book))
    buf = io.StringIO()
    old = sys.stdout
    try:
        sys.stdout = buf
        ns["main"]()
    finally:
        sys.stdout = old
    return ns, buf.getvalue()


def tail(txt, n=8):
    lines = [l for l in txt.split("\n") if l.strip()]
    return "\n".join("    | " + l for l in lines[-n:])


def shapes(ws, ns):
    """→ [(r0, a, b, tail, cnt, how)]"""
    starts = ns["_block_starts"](ws)
    out = []
    for i, r0 in enumerate(starts):
        nxt = starts[i + 1] if i + 1 < len(starts) else (r0 + 100)
        out.append((r0,) + tuple(ns["_item_range"](ws, r0, nxt)))
    return out


def counts(ws, ns):
    return [s[4] for s in shapes(ws, ns)]


def d_sum(ws):
    ns = load_mod()
    st = ns["_block_starts"](ws)
    tot = 0
    for i, r0 in enumerate(st):
        nxt = st[i + 1] if i + 1 < len(st) else (r0 + 100)
        a, b, _t, cnt, _h = ns["_item_range"](ws, r0, nxt)
        tot += ns["_d_sum"](ws, a, b)
    return tot


def book(pairs):
    return [build_sheet(nm, filled=f, blank_tail=bt) for nm, f, bt in pairs]


def main():
    # ================= 1. 2027 簿：12 张全改 =================
    print("\n[1] 2027 簿 · 12 张月表一次全改")
    b = book([("2027-%02d" % m, False, False) for m in range(1, 13)])
    ns, out = run(b)
    bad = [(s.Name, sorted(set(counts(s, ns)))) for s in b if sorted(set(counts(s, ns))) != [80]]
    chk(not bad, "12 张全部变成 80 项（异常：%s）" % (bad or "无"))
    if bad:
        print(tail(out))
    chk(all(len(ns["_block_starts"](s)) == 30 for s in b), "每张仍是 30 块")
    chk(abs(d_sum(b[0]) - 30 * 100) < 0.01, "第 1 张 30 块标准分合计 = %s（应 3000）" % d_sum(b[0]))
    a0 = ns["_block_starts"](b[0])[0] + 3
    chk(b[0].Range("C%d" % a0).Value2 == "安全组织与持证安全员", "第 1 项名称正确")
    chk(b[0].Range("C%d" % (a0 + 79)).Value2 == "住宿登记与消防管理", "第 80 项名称正确")
    chk(b[0].Range("A%d" % (a0 + 80)).Value2 == "合计", "80 项后紧跟合计行")
    chk("全部完成" in out, "日志报「全部完成」")

    # ================= 2. 2026 簿：只改 12 月 =================
    print("\n[2] 2026 簿 · 只改 2026-12，历史表不动")
    b = book([("2026-%02d" % m, False, False) for m in range(1, 13)])
    before = [len(s.grid) for s in b]
    ns, out = run(b)
    hist = [s for s in b if not s.Name.endswith("-12")]
    dec = [s for s in b if s.Name.endswith("-12")][0]
    chk(all(sorted(set(counts(s, ns))) == [73] for s in hist),
        "1–11 月仍是 73 项")
    chk(all(len(s.grid) == before[i] for i, s in enumerate(b) if not s.Name.endswith("-12")),
        "1–11 月行数一格未变")
    chk(sorted(set(counts(dec, ns))) == [80], "2026-12 已改成 80 项")
    chk("历史月表 11 张" in out, "日志说明历史月表 11 张不动")

    # ================= 3. 幂等 =================
    print("\n[3] 幂等 · 再跑一次")
    n_before = [len(s.grid) for s in b]
    ns2, out2 = run(b)
    chk([len(s.grid) for s in b] == n_before, "行数完全没变（没重复插行）")
    chk("无需改造" in out2 or "没有需要改造的表" in out2, "日志报无需改造")
    if not ("无需改造" in out2 or "没有需要改造的表" in out2):
        print(tail(out2))

    # ================= 4. 半成品自愈 =================
    print("\n[4] 半成品自愈 · 插了行但内容没写")
    b = book([("2027-03", False, False)])
    ws = b[0]
    # 先把一块「插行成功但内容没写」造出来：插 7 行，C 列留旧值
    ns = load_mod()
    st = ns["_block_starts"](ws)
    r0 = st[0]
    a, bb, _t, cnt, _h = ns["_item_range"](ws, r0, st[1])
    ws.Rows("%d:%d" % (bb + 1, bb + 7)).Insert()
    # 现在这块 80 行，但第 74–80 行是空的 → 属半成品
    ns2, out2 = run(b)
    c = sorted(set(counts(ws, ns2)))
    chk(c == [80], "项数 80（实际 %s）" % c)
    chk("补写 1 块半成品" in out2, "预检识别出 1 块半成品")
    chk(abs(ns2["_d_sum"](ws, a, a + 79) - 100) < 0.01,
        "该块标准分合计 = %s（应 100）" % ns2["_d_sum"](ws, a, a + 79))
    chk(ws.Range("C%d" % (a + 73)).Value2 == ns2["ITEMS"][73][2], "第 74 项已补写")
    if "补写 1 块半成品" not in out2:
        print(tail(out2))

    # ================= 5. 有得分 → 拒绝 =================
    print("\n[5] 已录过数的月表 · 整张拒绝")
    b = book([("2027-04", True, False)])       # filled=True → E 列有值
    ns, out = run(b)
    chk(sorted(set(counts(b[0], ns))) == [73], "仍为 73 项（未被改）")
    chk("已有得分数据" in out, "日志说明原因：已有得分数据")

    # ================= 6. 块数 ≠ 30 =================
    print("\n[6] 块数异常的表 · 不动，其它表照常")
    good = build_sheet("2027-05", filled=False)
    broken = build_sheet("2027-06", nblocks=28, filled=False)
    ns, out = run([broken, good])
    chk(sorted(set(counts(broken, ns))) == [73], "异常表保持 73 项")
    chk("应为 30 块" in out, "日志报块数不对")
    chk(sorted(set(counts(good, ns))) == [80], "另一张正常表已改成 80 项")

    # ================= 7. 时间预算耗尽 → 续跑 =================
    print("\n[7] 时间预算耗尽 · 块边界暂停 + 续跑")
    b = book([("2027-07", False, False)])
    ws = b[0]
    ns, out = run(b, budget=-1)          # 负数 = 立即超预算
    chk(sorted(set(counts(ws, ns))) == [73], "第一次一块都没改（保护生效）")
    chk("暂停" in out or "时间预算" in out, "日志提示暂停")
    chk("再点一次" in out, "日志提示可续跑")
    ns2, out2 = run(b)                    # 正常预算续跑
    chk(sorted(set(counts(ws, ns2))) == [80], "续跑后全部变 80 项")
    chk("全部完成" in out2, "续跑报全部完成")

    # ================= 8. 结构不明 → 插行前拦下，不留残留 =================
    print("\n[8] 「合计」行缺失的块 · 插行前拦下，不留空行")
    b = book([("2027-08", False, False)])
    ws = b[0]
    ns = load_mod()
    st = ns["_block_starts"](ws)
    a1 = st[0] + 3
    ws.Range("A%d" % (a1 + 73)).Value2 = ""      # 抹掉第 1 块的「合计」字样
    rows_before = len(ws.grid)
    ns2, out2 = run(b)
    chk("结构不明" in out2, "日志报「结构不明」，拦下了")
    cs = counts(ws, ns2)
    chk(cs[1:] == [80] * 29, "第 2–30 块已改成 80 项（实际 %s）" % sorted(set(cs[1:])))
    chk(cs[0] == 73, "第 1 块保持 73 项未动（实际 %d 项）" % cs[0])
    # ★ 关键：拦下时不能留下插入的行，否则每跑一次多 7 行
    grown = len(ws.grid) - rows_before
    expect = 29 * 7                              # 只有 2–30 块各插 7 行
    chk(grown == expect, "总行数只增 %d 行（29 块 × 7，应 %d）" % (grown, expect))
    # 再跑一次，行数不应再增长（第 1 块每次都失败、每次都不插行）
    rows_after1 = len(ws.grid)
    run(b)
    chk(len(ws.grid) == rows_after1,
        "重复运行不再增长（%d → %d）" % (rows_after1, len(ws.grid)))

    print("\n" + "=" * 60)
    if FAIL:
        print("失败 %d 项：" % len(FAIL))
        for f in FAIL:
            print("  -", f)
        sys.exit(1)
    print("全部通过")


if __name__ == "__main__":
    main()
