# -*- coding: utf-8 -*-
"""按《目标责任考核方案》V1.0 生成 docs/data/stations.json

人效：当量 = 汽油×39 + 柴油×27；分母 = 在岗 − 4；得分 = 12×人效÷49（≤49）或 12+8×(人效−49)÷49（>49），封顶20
数据源：三年平均日均吨、2026年9月实际在岗（合计248人），汽柴油分项由方案附录B反解
校验：15 站人效算术平均须等于 V6 定稿基准 49.26（容差 0.1）
"""
import json
import os

SGE_GAS, SGE_DSL, BASE_HEAD = 39, 27, 4
BENCH, EFF_BASE, EFF_SURGE, EFF_CAP = 49, 12, 8, 20
OIL_CAP, NONOIL_CAP, INSPECT_BASE = 50, 12, 28

# 站名, 汽油吨, 柴油吨, 在岗人数, 非油段(表5), V5 参考人效段（仅留档，不再校验）
RAW = [
    ("华山",     23.98, 40.42, 30, 10.78, 21.9),
    ("汉中",     13.95,  5.75, 14, 12.00, 21.7),
    ("宁陕",     19.85,  3.85, 17, 10.93, 21.6),
    ("富平",     24.44,  5.66, 21, 12.00, 20.7),
    ("韩城",     18.47,  5.73, 18, 11.73, 19.6),
    ("秦岭",     28.23,  6.07, 27, 10.89, 17.5),
    ("白河",      9.00,  5.20, 13, 12.00, 16.6),
    ("玉华宫",    9.03,  1.97, 12,  9.63, 21.6),   # 按定稿：月均在岗 12 人 → 分母 8（V6 基准 49.26 即按此口径）
    ("天汉水城",  8.10, 12.20, 17, 12.00, 14.1),
    ("南沙",      5.29, 12.81, 15, 10.51, 13.7),
    ("旬阳",      5.86,  6.84, 14, 10.64, 12.0),
    ("洋县",     13.41,  4.49, 21, 11.59, 11.9),
    ("富县",      4.02,  0.98, 12, 10.97,  7.3),
    ("照金",      2.40,  0.90, 11,  9.71,  5.2),
    ("略阳",      1.13,  0.87,  8, 11.08,  5.0),
]

stations, errors = [], []

# 口径统一：分母一律 = 实际在岗 − 4，不设缺员修正例外
for name, gas, dsl, head, nonoil, pub_eff_score in RAW:
    sge = gas * SGE_GAS + dsl * SGE_DSL
    denom = head - BASE_HEAD
    eff = sge / denom if denom > 0 else 0
    raw_score = EFF_BASE * eff / BENCH if eff <= BENCH else EFF_BASE + EFF_SURGE * (eff - BENCH) / BENCH
    score = min(raw_score, EFF_CAP)

    stations.append({
        "name": name,
        "gasTon": gas, "dieselTon": dsl,
        "totalTon": round(gas + dsl, 2),
        "headcount": head,
        "denom": denom,
        "sge": round(sge, 1),
        "eff": round(eff, 2),
        "multiple": round(eff / BENCH, 3),
        "effScoreRaw": round(raw_score, 2),
        "effScore": round(score, 2),
        "nonoilScore": nonoil,
        "inspectScore": round(INSPECT_BASE * 0.9, 2),   # 检查 90 分 → 27
    })

if errors:
    raise SystemExit("校验未通过：\n  - " + "\n  - ".join(errors))

stations.sort(key=lambda s: -s["eff"])
for i, s in enumerate(stations, 1):
    s["effRank"] = i

total_eff = sum(s["eff"] for s in stations) / len(stations)
if abs(total_eff - 49.26) > 0.1:
    errors.append("15 站人效算术平均 %.2f，与 V6 定稿基准 49.26 偏离过大" % total_eff)

payload = {
    "version": "V6",
    "basis": "《高速公路加油站目标责任考核方案》V1.0（V6）：油品40／非油10／人效12／现场管理38，基准100、封顶120",
    "note": "人效 = (汽油×39 + 柴油×27) ÷ (实际在岗 − 4)；人效段 = 12×人效÷49（≤49）或 12+8×(人效−49)÷49（>49），封顶20。"
            "15 站分母一律按在岗−4，不做缺员修正例外。本表不含油品段（任务逐月下达）与投诉、进步分。",
    "benchmark": BENCH,
    "benchmarkMeasured": round(total_eff, 2),
    "seg": {"oil": 40, "nonoil": 10, "eff": 12, "inspect": 28},
    "stations": stations,
}

out = r"D:/加油站综合考核系统/docs/data/stations.json"
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, indent=1)

print("OK ->", out)
print("基准人效(全公司算术平均) = %.2f（定稿取 49）" % total_eff)
print("%-3s %-8s %6s %6s %5s %5s %7s %6s %7s %s" % (
    "No", "站名", "汽油", "柴油", "在岗", "分母", "当量", "人效", "人效段", "非油段"))
for s in stations:
    print("%-3d %-8s %6.2f %6.2f %5d %5d %7.1f %6.2f %7.2f %6.2f" % (
        s["effRank"], s["name"], s["gasTon"], s["dieselTon"], s["headcount"],
        s["denom"], s["sge"], s["eff"], s["effScore"], s["nonoilScore"]))
