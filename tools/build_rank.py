# -*- coding: utf-8 -*-
"""生成 V6 四项制 docs/data/rank.json

用法：
  # 演示数据（页面会显示「示例数据」黄条，不算正式发榜）
  python tools/build_rank.py --month 2026-11

  # 科室正式核算数据
  python tools/build_rank.py --month 2026-11 --input rank_source.json

--input 格式（每站可以只给部分字段，缺省用演示值兜底）：
{
  "month": "2026-11",
  "stations": [
    {
      "name": "汉中",
      "oilActual": 1234, "oilTask": 1100,          // 或直接 "oilScore": 46.0
      "nonoilSalesRate": 1.05,                     // 销售完成率，不含烟草
      "nonoilMarginRate": 0.98,                    // 毛利率完成率，含烟草
      "primaryScore100": 96,                       // 一级考核百分制；不给或 primaryNA=true 即 NA
      "primaryNA": false,
      "inspectScore100": 97.96,                    // 二级运营检查折算百分制；或直接 "inspectScore"
      "mysteryScore100": 96,                       // 神访百分制；或直接 "mysteryScore"
      "mysteryUntested": false,                    // true 时按当月参评站均分填补
      "mysteryNA": false,                          // true 时按其余项得分率折算补齐（南沙）
      "complaint": 0, "progress": 0, "vetoed": false
    }
  ]
}

V6 口径（与 docs/assets/config.js / engine.js 完全一致）：
  油品40(封顶50) + 非油10(封顶12) + 人效12(封顶20) + 现场管理38
  （一级5 + 二级28 + 神访5）− 投诉 + 进步，综合封顶 120
  人效段唯一数源 = docs/data/efficiency.json（当月会计月实际累计 ÷ 已计天数 ÷（月均在岗−4）），
  与 eff.html 人效看板同源同值；stations.json 的三年日均仅作参考，不再参与计分。
  NA 统一折算：某项 NA 时，该项得分 = 该项基准分 ×（其余项得分 ÷ 其余项基准满分）。
"""
import argparse
import datetime as dt
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIONS = os.path.join(ROOT, "docs", "data", "stations.json")
EFFICIENCY = os.path.join(ROOT, "docs", "data", "efficiency.json")
OUT = os.path.join(ROOT, "docs", "data", "rank.json")

# 与 config.js 保持一致
OIL_BASE, OIL_CAP = 40, 50
NON_BASE, NON_CAP, NON_EACH_CAP = 10, 12, 6
NON_SALES_W, NON_MARGIN_W = 5, 5
EFF_BASE, EFF_CAP = 12, 20
PRIMARY_BASE, PRIMARY_CAP = 5, 5
INSPECT_BASE, INSPECT_CAP = 28, 28
MYSTERY_BASE, MYSTERY_CAP = 5, 5
TOTAL_BASE, TOTAL_CAP = 100, 120

# 不参与神秘访客的服务区（与 config.mysteryExempt 一致）
MYSTERY_EXEMPT = ["南沙"]


def r(v, n=2):
    return round(float(v), n)


def oil(o):
    if o.get("oilScore") is not None:
        return min(max(0, float(o["oilScore"])), OIL_CAP)
    task = float(o.get("oilTask", 0) or 0)
    if task <= 0:
        return 0
    return min(max(0, OIL_BASE * float(o.get("oilActual", 0)) / task), OIL_CAP)


def nonoil(o):
    if o.get("nonoilScore") is not None:
        return min(max(0, float(o["nonoilScore"])), NON_CAP)
    s = min(max(0, NON_SALES_W * float(o.get("nonoilSalesRate", 1))), NON_EACH_CAP)
    m = min(max(0, NON_MARGIN_W * float(o.get("nonoilMarginRate", 1))), NON_EACH_CAP)
    return min(s + m, NON_CAP)


def inspect(o):
    if o.get("inspectScore") is not None:
        return min(max(0, float(o["inspectScore"])), INSPECT_CAP)
    return min(max(0, float(o.get("inspectScore100", 100)) / 100 * INSPECT_BASE), INSPECT_CAP)


def demo_input(base):
    """确定性演示值：不引入随机数，便于复算与回归比对。"""
    out = []
    for i, b in enumerate(base):
        # 演示口径：宁陕的油品任务量上调到较高水平（其余站保持 1000），
        # 完成率随之下降，油品段得分与综合名次同步下降；只影响这一条模拟记录。
        task = 2000 if b["name"] == "宁陕" else 1000
        # 一级考核每年一次随机抽查：演示中每 4 站取 1 站已抽查，其余为 NA
        scored = (i % 4 == 0)
        out.append({
            "name": b["name"],
            "oilActual": 1000 * (0.90 + (i * 7 % 21) / 100.0),
            "oilTask": task,
            "nonoilSalesRate": 0.92 + (i * 3 % 9) / 100.0,
            "nonoilMarginRate": 0.95 + (i * 5 % 11) / 100.0,
            "primaryScore100": (100 - (i * 5 % 11)) if scored else None,
            "primaryNA": not scored,
            "inspectScore100": 100 - (i * 3 % 13),
            "mysteryScore100": 100 - (i * 2 % 11),
            "mysteryUntested": False,
            "mysteryNA": b["name"] in MYSTERY_EXEMPT,
            "complaint": 0,
            "progress": 0,
            "vetoed": False
        })
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", default="", help="归属月 YYYY-MM，默认按会计月推算")
    ap.add_argument("--input", default="", help="科室核算数据 json")
    args = ap.parse_args()

    today = dt.date.today()
    if args.month:
        month = args.month
    else:
        y, m = today.year, today.month
        if m == 12 and today.day >= 26:
            month = "%d-01" % (y + 1)
        elif today.day >= 26:
            month = "%d-%02d" % (y, m + 1)
        else:
            month = "%d-%02d" % (y, m)

    with open(STATIONS, encoding="utf-8") as f:
        base = json.load(f)["stations"]

    # 人效段唯一数源：当月实况（会计月累计当量 ÷ 已计天数 ÷ (月均在岗 − 4)）
    if not os.path.exists(EFFICIENCY):
        raise SystemExit(
            "缺少 docs/data/efficiency.json：人效段无当月数据源。\n"
            "请先跑金山「eff_push.js」或在本地执行 tools/build_efficiency.py 生成。")
    with open(EFFICIENCY, encoding="utf-8") as f:
        eff_doc = json.load(f)
    eff_map = {x["name"]: x for x in eff_doc["stations"]}
    eff_meta = {
        "month": eff_doc.get("month"),
        "dataMode": eff_doc.get("dataMode"),
        "days": (eff_doc.get("period") or {}).get("elapsed"),
        "benchmark": (eff_doc.get("params") or {}).get("benchmark"),
    }

    src, official = None, False
    if args.input:
        with open(args.input, encoding="utf-8") as f:
            src = json.load(f)
        official = True
        month = src.get("month", month)
    src_rows = demo_input(base)
    if src:
        by_name = {x["name"]: x for x in src.get("stations", [])}
        for row in src_rows:
            row.update(by_name.get(row["name"], {}))

    # 未开展神访的站：按当月「已测参评站」均分填补
    tested = [float(x.get("mysteryScore100", 100))
              for x in src_rows if not x.get("mysteryUntested") and not x.get("mysteryNA")]
    peer_avg = sum(tested) / len(tested) if tested else 0

    rows = []
    for o in src_rows:
        name = o["name"]
        if name not in eff_map:
            continue
        e = eff_map[name]

        oil_s = r(oil(o))
        non_s = r(nonoil(o))
        eff_s = r(min(float(e["effScore"]), EFF_CAP))
        insp_s = r(inspect(o))

        # ---- 一级考核 / 神秘访客：先判 NA，NA 项最后统一按其余项得分率补齐 ----
        prim_na = bool(o.get("primaryNA")) or o.get("primaryScore100") is None
        myst_na = bool(o.get("mysteryNA"))

        prim_s = 0.0 if prim_na else r(min(max(0, float(o["primaryScore100"])) / 100 * PRIMARY_BASE, PRIMARY_CAP))

        if myst_na:
            myst_s = 0.0
        elif o.get("mysteryScore") is not None:
            myst_s = r(min(max(0, float(o["mysteryScore"])), MYSTERY_CAP))
        else:
            raw = peer_avg if o.get("mysteryUntested") else float(o.get("mysteryScore100", 100))
            myst_s = r(min(max(0, raw) / 100 * MYSTERY_BASE, MYSTERY_CAP))

        # 非 NA 项得分合计 / 非 NA 项基准合计 → NA 项按得分率补齐
        na_base = (PRIMARY_BASE if prim_na else 0) + (MYSTERY_BASE if myst_na else 0)
        if na_base > 0:
            other_sum = oil_s + non_s + eff_s + insp_s + (0 if prim_na else prim_s) + (0 if myst_na else myst_s)
            other_base = TOTAL_BASE - na_base
            rate = (other_sum / other_base) if other_base > 0 else 0
            if prim_na:
                prim_s = r(min(PRIMARY_BASE * rate, PRIMARY_CAP))
            if myst_na:
                myst_s = r(min(MYSTERY_BASE * rate, MYSTERY_CAP))

        complaint = r(float(o.get("complaint", 0) or 0))
        progress = r(float(o.get("progress", 0) or 0))
        vetoed = bool(o.get("vetoed"))
        on_site = r(prim_s + insp_s + myst_s)
        total = 0 if vetoed else r(min(
            oil_s + non_s + eff_s + on_site - complaint + progress, TOTAL_CAP))

        rows.append({
            "name": name, "vetoed": vetoed, "complaint": complaint, "progress": progress,
            "oilScore": oil_s, "nonoilScore": non_s, "effScore": eff_s,
            "primaryScore": prim_s, "primaryNA": prim_na,
            "inspectScore": insp_s, "mysteryScore": myst_s, "mysteryNA": myst_na,
            "onSiteScore": on_site,
            "total": total
        })

    # 与 Engine.rank 一致：否决置末 → 综合降序 → 油品段降序
    rows.sort(key=lambda x: (1 if x["vetoed"] else 0, -x["total"], -x["oilScore"]))
    for i, x in enumerate(rows):
        x["rank"] = i + 1

    out = {
        "version": "V6",
        "month": month,
        "updatedAt": dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "dataMode": "official" if official else "demo",
        "basis": "油品40(50) + 非油10(12) + 人效12(20) + 现场管理38(一级5+二级28+神访5) − 投诉 + 进步，封顶120；不设等级",
        "effSource": {
            "file": "docs/data/efficiency.json",
            "mode": eff_meta["dataMode"],
            "month": eff_meta["month"],
            "elapsedDays": eff_meta["days"],
            "benchmark": eff_meta["benchmark"],
            "formula": "人效 = 会计月累计当量 ÷ 已计天数 ÷（月均在岗 − 4）；当量 = 汽油×39 + 柴油×27"
        },
        "note": ("科室核算数据；人效段与 eff.html 人效看板同源（当月会计月实际累计）"
                 if official else
                 "演示数据：油品/非油/一级/运营/神访为模拟值，人效段取自 efficiency.json 当月实况。"
                 "正式发榜请用 --input 传入科室核算数据。"),
        "peerMysteryAverage": r(peer_avg),
        "stations": rows
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    print("已生成 %s（%s · %d 站）" % (OUT, out["dataMode"], len(rows)))
    for x in rows:
        print("%2d %-8s 油%5.2f 非%5.2f 效%5.2f 一级%5s 检%5.2f 访%4.2f 计%6.2f%s"
              % (x["rank"], x["name"], x["oilScore"], x["nonoilScore"], x["effScore"],
                 "NA" if x["primaryNA"] else "%.2f" % x["primaryScore"],
                 x["inspectScore"], x["mysteryScore"], x["total"],
                 "  否决" if x["vetoed"] else ""))


if __name__ == "__main__":
    main()
