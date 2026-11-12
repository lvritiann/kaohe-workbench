# -*- coding: utf-8 -*-
"""生成 V5 五段制 docs/data/rank.json

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
      "inspectScore100": 97.96,                    // 运营检查折算百分制；或直接 "inspectScore"
      "mysteryScore100": 100,                      // 神访百分制；或直接 "mysteryScore"
      "mysteryUntested": false,                    // true 时按当月参评站均分填补
      "complaint": 0, "progress": 0, "vetoed": false
    }
  ]
}

口径与 docs/assets/config.js / engine.js 完全一致：
  油品40(48) + 非油10(12) + 人效15(25) + 运营20 + 神访15 − 投诉 + 进步，综合封顶120
  人效段固定取 docs/data/stations.json（定稿附录B），不由本脚本重算。
"""
import argparse
import datetime as dt
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIONS = os.path.join(ROOT, "docs", "data", "stations.json")
OUT = os.path.join(ROOT, "docs", "data", "rank.json")

# 与 config.js 保持一致
OIL_BASE, OIL_CAP = 40, 48
NON_BASE, NON_CAP, NON_EACH_CAP = 10, 12, 6
NON_SALES_W, NON_MARGIN_W = 5, 5
EFF_CAP, INSPECT_BASE, MYSTERY_BASE = 25, 20, 15
BONUS, PENALTY, TOTAL_CAP = 1.5, 0.5, 120


def r(v, n=2):
    return round(float(v), n)


def multi(rate):
    return 1 + (BONUS if rate >= 1 else PENALTY) * (rate - 1)


def oil(o):
    if o.get("oilScore") is not None:
        return min(max(0, float(o["oilScore"])), OIL_CAP)
    task = float(o.get("oilTask", 0) or 0)
    if task <= 0:
        return 0
    return min(max(0, OIL_BASE * multi(float(o.get("oilActual", 0)) / task)), OIL_CAP)


def nonoil(o):
    if o.get("nonoilScore") is not None:
        return min(max(0, float(o["nonoilScore"])), NON_CAP)
    s = min(max(0, NON_SALES_W * multi(float(o.get("nonoilSalesRate", 1)))), NON_EACH_CAP)
    m = min(max(0, NON_MARGIN_W * multi(float(o.get("nonoilMarginRate", 1)))), NON_EACH_CAP)
    return min(s + m, NON_CAP)


def inspect(o):
    if o.get("inspectScore") is not None:
        return min(max(0, float(o["inspectScore"])), INSPECT_BASE)
    return min(max(0, float(o.get("inspectScore100", 100)) / 100 * INSPECT_BASE), INSPECT_BASE)


def mystery(o, peer_avg):
    if o.get("mysteryScore") is not None:
        return min(max(0, float(o["mysteryScore"])), MYSTERY_BASE)
    raw = peer_avg if o.get("mysteryUntested") else float(o.get("mysteryScore100", 100))
    return min(max(0, raw / 100 * MYSTERY_BASE), MYSTERY_BASE)


def demo_input(base):
    """确定性演示值：不引入随机数，便于复算与回归比对。"""
    out = []
    for i, b in enumerate(base):
        out.append({
            "name": b["name"],
            "oilActual": 1000 * (0.90 + (i * 7 % 21) / 100.0),
            "oilTask": 1000,
            "nonoilSalesRate": 0.92 + (i * 3 % 9) / 100.0,
            "nonoilMarginRate": 0.95 + (i * 5 % 11) / 100.0,
            "inspectScore100": 100 - (i * 3 % 13),
            "mysteryScore100": 100 - (i * 2 % 11),
            "mysteryUntested": False,
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
    eff_map = {x["name"]: x for x in base}

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
              for x in src_rows if not x.get("mysteryUntested")]
    peer_avg = sum(tested) / len(tested) if tested else 0

    rows = []
    for o in src_rows:
        name = o["name"]
        if name not in eff_map:
            continue
        e = eff_map[name]
        seg = {
            "oilScore": r(oil(o)),
            "nonoilScore": r(nonoil(o)),
            "effScore": r(min(float(e["effScore"]), EFF_CAP)),
            "inspectScore": r(inspect(o)),
            "mysteryScore": r(mystery(o, peer_avg))
        }
        complaint = r(float(o.get("complaint", 0) or 0))
        progress = r(float(o.get("progress", 0) or 0))
        vetoed = bool(o.get("vetoed"))
        total = 0 if vetoed else r(min(
            seg["oilScore"] + seg["nonoilScore"] + seg["effScore"]
            + seg["inspectScore"] + seg["mysteryScore"] - complaint + progress,
            TOTAL_CAP))
        row = {"name": name, "vetoed": vetoed, "complaint": complaint, "progress": progress}
        row.update(seg)
        row["total"] = total
        rows.append(row)

    # 与 Engine.rank 一致：否决置末 → 综合降序 → 油品段降序
    rows.sort(key=lambda x: (x["vetoed"], -x["total"], -x["oilScore"]))
    for i, x in enumerate(rows):
        x["rank"] = i + 1

    payload = {
        "version": "V5",
        "month": month,
        "updatedAt": dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "dataMode": "official" if official else "demo",
        "basis": "油品40(48) + 非油10(12) + 人效15(25) + 运营20 + 神访15 − 投诉 + 进步，封顶120；不设等级",
        "note": ("计划经营科正式核算数据。" if official else
                 "演示数据：油品/非油/运营/神访为模拟值，人效段取自定稿附录B。"
                 "正式发榜请用 --input 传入科室核算数据。"),
        "peerMysteryAverage": r(peer_avg),
        "stations": rows
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)

    print("已生成 %s" % OUT)
    print("  %s / %s / %d 站 / 神访填补均分 %.2f" % (month, payload["dataMode"], len(rows), peer_avg))
    print("  前三：%s" % "、".join("%s %.2f" % (x["name"], x["total"]) for x in rows[:3]))
    print("  榜首五段：%s" % ("%.2f / %.2f / %.2f / %.2f / %.2f" % (
        rows[0]["oilScore"], rows[0]["nonoilScore"], rows[0]["effScore"],
        rows[0]["inspectScore"], rows[0]["mysteryScore"])))


if __name__ == "__main__":
    main()
