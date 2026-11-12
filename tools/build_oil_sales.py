# -*- coding: utf-8 -*-
"""从「成品油经营数据中转簿 → 站级明细」生成 15 站分柴汽销量台账。

数据源（成品油驾驶舱底表）：
  D:/高速延长公司综合管理平台/_publish/成品油经营数据中转簿.xlsx
  sheet「站级明细」：会计月 | 站名 | 路段 | 零售吨 | 柴油吨 | 汽油吨 | 升 | 含税金额元 | 万元
  sheet「月汇总」  ：会计月 | 区间 | ... | 天数 | ...

口径：
  * 会计月 = 上月26日 — 本月25日，标签取止月（与 V5 考核一致）
  * 站级明细按站区分行（华山南/华山北），去末尾「东南西北」后缀合并为 15 站
  * 只取吨数，不取金额（含税金额属敏感经营数据，不落到公开/共享文件）
  * 全量台账只放本机 inbox/（已 gitignore），不推 GitHub

产出：
  inbox/油源/oil_sales_all.json        全量：站 × 会计月 的柴油/汽油/零售吨
  inbox/油源/oil_sales_<最新月>.tsv    最近完整会计月 15 行，可直接粘进金山「月度汇总」
"""
import datetime as dt
import json
import os
import re

import openpyxl

SRC = r"D:/高速延长公司综合管理平台/_publish/成品油经营数据中转簿.xlsx"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "inbox", "油源")
STATIONS = [
    "富平", "汉中", "秦岭", "华山", "白河", "宁陕", "韩城", "南沙",
    "旬阳", "天汉水城", "洋县", "玉华宫", "富县", "照金", "略阳"
]


def r(v, n=2):
    return round(float(v), n)


def norm_station(s):
    """华山南/天汉水城东/略阳西 -> 华山/天汉水城/略阳"""
    s = re.sub(r"\s+", "", str(s))
    s = re.sub(r"(东|西|南|北)$", "", s)
    s = re.sub(r"(东站|西站|南站|北站)$", "", s)
    return s


def main():
    if not os.path.isfile(SRC):
        raise SystemExit("找不到中转簿：%s" % SRC)
    os.makedirs(OUT_DIR, exist_ok=True)

    wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)

    # 会计月天数
    days = {}
    if "月汇总" in wb.sheetnames:
        for row in wb["月汇总"].iter_rows(min_row=2, values_only=True):
            if row and row[0]:
                try:
                    days[str(row[0])] = int(row[10])
                except (TypeError, ValueError):
                    pass

    ws = wb["站级明细"]
    hdr = [str(x).strip() if x is not None else "" for x in
           next(ws.iter_rows(min_row=1, max_row=1, values_only=True))]
    idx = {name: hdr.index(name) for name in hdr if name}
    need = ["会计月", "站名", "零售吨", "柴油吨", "汽油吨"]
    for k in need:
        if k not in idx:
            raise SystemExit("站级明细缺列：%s（实际表头 %s）" % (k, hdr))

    agg = {}
    skipped = {}
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row or not row[idx["会计月"]]:
            continue
        month = str(row[idx["会计月"]]).strip()
        raw = str(row[idx["站名"]] or "").strip()
        name = norm_station(raw)
        if name not in STATIONS:
            skipped[raw] = skipped.get(raw, 0) + 1
            continue
        key = (month, name)
        a = agg.setdefault(key, {"diesel": 0.0, "gas": 0.0, "retail": 0.0, "areas": 0})
        for fld, col in (("diesel", "柴油吨"), ("gas", "汽油吨"), ("retail", "零售吨")):
            v = row[idx[col]]
            if isinstance(v, (int, float)):
                a[fld] += float(v)
        a["areas"] += 1

    months = sorted({m for m, _ in agg})
    latest = months[-1] if months else ""

    stations = []
    for name in STATIONS:
        by = {}
        for m in months:
            a = agg.get((m, name))
            if not a:
                continue
            d = days.get(m) or 30
            by[m] = {
                "dieselTon": r(a["diesel"]),
                "gasTon": r(a["gas"]),
                "retailTon": r(a["retail"]),
                "days": d,
                "dayGas": r(a["gas"] / d, 3),
                "dayDiesel": r(a["diesel"] / d, 3),
                "dayTon": r(a["retail"] / d, 3),
                "areas": a["areas"]
            }
        stations.append({"name": name, "months": len(by), "byMonth": by})

    payload = {
        "version": "V5",
        "generatedAt": dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "source": "成品油经营数据中转簿.xlsx → 站级明细（成品油驾驶舱 youpin-sales-cockpit 底表）",
        "sourcePath": SRC,
        "basis": "会计月=上月26日—本月25日；双站区去后缀合并为15站；单位吨；不含金额",
        "note": "全量台账仅存本机 inbox/，不推公开仓库。油品段与人效段可从这里取真实柴汽分项。",
        "months": months,
        "latest": latest,
        "stationCount": len(STATIONS),
        "skippedStationAreas": skipped,
        "stations": stations
    }
    with open(os.path.join(OUT_DIR, "oil_sales_all.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)

    # 最近完整会计月 TSV（可直接粘贴金山「月度汇总」）
    cols = ["会计月", "站名", "会计月起始", "会计月截止", "天数",
            "汽油销量(吨)", "柴油销量(吨)", "零售合计(吨)", "日均汽油(吨)",
            "日均柴油(吨)", "日均合计(吨)", "数据来源"]
    y, m = (int(x) for x in latest.split("-"))
    start = dt.date(y - (1 if m == 1 else 0), 12 if m == 1 else m - 1, 26)
    end = dt.date(y, m, 25)
    dcount = days.get(latest) or (end - start).days + 1
    lines = ["\t".join(cols)]
    for s in stations:
        v = s["byMonth"].get(latest)
        if not v:
            continue
        lines.append("\t".join([
            latest, s["name"], start.isoformat(), end.isoformat(), str(dcount),
            str(v["gasTon"]), str(v["dieselTon"]), str(v["retailTon"]),
            str(v["dayGas"]), str(v["dayDiesel"]), str(v["dayTon"]),
            "成品油经营数据中转簿·站级明细"
        ]))
    tsv = os.path.join(OUT_DIR, "oil_sales_%s.tsv" % latest)
    with open(tsv, "w", encoding="utf-8-sig") as f:
        f.write("\n".join(lines) + "\n")

    print("已生成 %s" % os.path.join(OUT_DIR, "oil_sales_all.json"))
    print("  会计月 %d 期：%s ~ %s" % (len(months), months[0], months[-1]))
    print("  15 站，合计 %d 条站月记录" % sum(len(s["byMonth"]) for s in stations))
    print("  最新会计月 %s（%s ~ %s，%d 天）→ %s" % (latest, start, end, dcount, tsv))
    print("  未匹配站区：%s" % (skipped or "无"))
    print("  最新月 15 站（汽油/柴油/合计 吨）：")
    for s in stations:
        v = s["byMonth"].get(latest)
        if v:
            print("    %-6s %9.2f / %9.2f / %9.2f" % (s["name"], v["gasTon"], v["dieselTon"], v["retailTon"]))
        else:
            print("    %-6s （本月无数据）" % s["name"])


if __name__ == "__main__":
    main()
