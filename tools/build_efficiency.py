# -*- coding: utf-8 -*-
"""生成 V5 口径 docs/data/efficiency.json（本地兜底 / 月度留痕）

用法：
  # 用定稿附录B 日均基准 × 会计月天数（基准值，dataMode=baseline）
  python tools/build_efficiency.py --month 2026-11

  # 用 AirScript 落盘的会计月累计数据（dataMode=live）
  python tools/build_efficiency.py --month 2026-11 --input live.json

--input 格式（吨数为会计月累计值，不是日均）：
{
  "month": "2026-11",
  "elapsed": 18,                     // 已过天数，可选
  "stations": [
    {"name": "华山", "gasTon": 743.38, "dieselTon": 1253.02, "monthlyHead": 30}
  ]
}

口径：人效 = (会计月当量 ÷ 天数) ÷ (月均在岗 − 4)
     当量 = 汽油×56 + 柴油×28；基准 65；人效段 = 人效 ÷ 65 × 15，封顶 25
     会计月 = 上月26日 — 本月25日，天数按实计
history 逐月累积：同月覆盖、异月追加，≥2 期后 eff.html 自动画趋势线。
"""
import argparse
import calendar
import datetime as dt
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIONS = os.path.join(ROOT, "docs", "data", "stations.json")
OUT = os.path.join(ROOT, "docs", "data", "efficiency.json")

SGE_GAS, SGE_DIESEL = 56, 28
BASE_HEAD, BENCHMARK = 4, 65
EFF_BASE, EFF_CAP = 15, 25


def r(v, n=2):
    return round(float(v), n)


def period_of(month):
    """'2026-11' -> 会计月 2026-10-26 ~ 2026-11-25"""
    y, m = (int(x) for x in month.split("-"))
    py, pm = (y - 1, 12) if m == 1 else (y, m - 1)
    start = dt.date(py, pm, 26)
    end = dt.date(y, m, 25)
    return start, end, (end - start).days + 1


def load_baseline():
    with open(STATIONS, encoding="utf-8") as f:
        return json.load(f)["stations"]


def build_rows(base, live, days, eff_days):
    """统一产出 15 站 V5 人效行。live 里吨数为会计月累计；base 里为日均吨。

    days     = 完整会计月天数（写进 period.days）
    eff_days = 实际已计天数（月内滚动用已过天数，月末自然等于 days）
    """
    live_map = {}
    if live:
        for x in live.get("stations", []):
            live_map[x["name"]] = x

    rows = []
    for b in base:
        name = b["name"]
        lv = live_map.get(name)
        if lv:
            g = float(lv.get("gasTon", 0))
            d = float(lv.get("dieselTon", 0))
            head = float(lv.get("monthlyHead", b["headcount"]))
            sge = g * SGE_GAS + d * SGE_DIESEL
            day_sge = sge / eff_days
        else:
            g = float(b["gasTon"]) * eff_days
            d = float(b["dieselTon"]) * eff_days
            head = float(b["headcount"])
            sge = g * SGE_GAS + d * SGE_DIESEL
            day_sge = sge / eff_days

        denom = head - BASE_HEAD
        eff = day_sge / denom if denom > 0 else 0
        score = min(eff / BENCHMARK * EFF_BASE, EFF_CAP)

        rows.append({
            "name": name,
            "monthlyHead": r(head, 2),
            "denom": r(denom, 2),
            "days": eff_days,
            "monthGas": r(g, 2),
            "monthDiesel": r(d, 2),
            "monthTons": r(g + d, 2),
            "monthSge": r(sge, 2),
            "daySge": r(day_sge, 2),
            "monthEff": r(eff, 2),
            "multiple": r(eff / BENCHMARK, 4),
            "effScore": r(score, 2),
            "dataSource": "live" if lv else "baseline",
            "today": {
                "gasTon": r(float(b["gasTon"]), 2),
                "dieselTon": r(float(b["dieselTon"]), 2),
                "eff": r(float(b["eff"]), 2),
                "note": "定稿附录B 日均参考值"
            }
        })

    srt = sorted(rows, key=lambda x: x["monthEff"], reverse=True)
    for i, x in enumerate(srt):
        x["rank"] = i + 1
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", required=True, help="会计月归属月 YYYY-MM")
    ap.add_argument("--input", default="", help="AirScript 落盘的累计数据 json")
    ap.add_argument("--days", type=int, default=0, help="覆盖会计月天数（默认自动算）")
    args = ap.parse_args()

    start, end, auto_days = period_of(args.month)
    days = args.days or auto_days

    live = None
    if args.input:
        with open(args.input, encoding="utf-8") as f:
            live = json.load(f)
        if live.get("days"):
            days = int(live["days"])

    elapsed = int((live or {}).get("elapsed", 0) or 0)
    eff_days = elapsed if (live and elapsed > 0) else days
    base = load_baseline()
    rows = build_rows(base, live, days, eff_days)

    effs = [x["monthEff"] for x in rows]
    company = {
        "avgEff": r(sum(effs) / len(effs), 2),
        "maxEff": max(effs),
        "minEff": min(effs),
        "count": len(rows)
    }

    # 历史台账：读旧文件的 history（旧版无此字段则从空开始），同月覆盖、异月追加
    history = []
    if os.path.isfile(OUT):
        try:
            with open(OUT, encoding="utf-8") as f:
                old = json.load(f)
            if old.get("version") == "V5":
                history = [h for h in old.get("history", []) if h.get("month") != args.month]
        except Exception:
            pass
    history.append({
        "month": args.month,
        "avgEff": company["avgEff"],
        "maxEff": company["maxEff"],
        "minEff": company["minEff"],
        "dataMode": "live" if live else "baseline",
        "stations": {x["name"]: x["monthEff"] for x in rows}
    })
    history.sort(key=lambda h: h["month"])

    now = dt.datetime.now()
    payload = {
        "version": "V5",
        "month": args.month,
        "date": now.strftime("%Y-%m-%d"),
        "updatedAt": now.strftime("%Y-%m-%d %H:%M"),
        "dataMode": "live" if live else "baseline",
        "source": ("金山日报 · AirScript 会计月累计数据"
                   if live else "《目标责任考核方案》V1.0 附录B 表18（定稿日均基准）"),
        "basis": "人效 = (会计月当量 ÷ 会计月天数) ÷ (月均在岗 − 4)；当量 = 汽油×56 + 柴油×28；人效段 = 人效 ÷ 65 × 15，封顶 25",
        "note": ("接入金山日报后由 tools/airscript/eff_push.js 每日覆盖；也可用本脚本本地生成。"
                 "baseline 仅作口径演示，不作为正式考核发榜依据。"),
        "period": {
            "start": start.isoformat(), "end": end.isoformat(), "days": days,
            "elapsed": elapsed
        },
        "params": {
            "sgeGas": SGE_GAS, "sgeDiesel": SGE_DIESEL,
            "baseHead": BASE_HEAD, "benchmark": BENCHMARK,
            "effBase": EFF_BASE, "effCap": EFF_CAP
        },
        "company": company,
        "stations": rows,
        "history": history
    }

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)

    print("已生成 %s" % OUT)
    print("  会计月 %s ~ %s，共 %d 天" % (start, end, days))
    print("  模式 %s / %d 站 / 平均人效 %.2f / 最高 %.2f / 最低 %.2f"
          % (payload["dataMode"], len(rows), company["avgEff"], company["maxEff"], company["minEff"]))
    print("  历史台账 %d 期（%s）" % (len(history), "、".join(h["month"] for h in history)))
    print("  前3：%s" % "、".join("%s %.2f" % (x["name"], x["monthEff"])
                                for x in sorted(rows, key=lambda x: x["rank"])[:3]))


if __name__ == "__main__":
    main()
