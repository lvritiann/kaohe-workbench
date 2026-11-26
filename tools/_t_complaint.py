# -*- coding: utf-8 -*-
"""投诉三档回归测试（Python 侧，验证 build_rank.py）

确认出榜脚本真的按件数算扣分，而不是只采信一个手填总数：
  escalate 10 分/件 · repeat 20 分/件 · regulator 50 分/件 · major 一票否决
旧格式（complaint 直接给总扣分）仍兼容；件数与旧总数同时存在时以件数为准。

用法：python tools/_t_complaint.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import build_rank as B  # noqa: E402

FAIL = []


def chk(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        FAIL.append(msg)


def case(o, exp_deduct, exp_major, msg):
    d, m, det = B.complaint_of(o)
    ok = (abs(d - exp_deduct) < 1e-9) and (m is exp_major)
    chk(ok, "%s → 扣 %s / 否决 %s（实际 %s / %s）" % (msg, exp_deduct, exp_major, d, m))
    return det


def main():
    print("\n[1] 三档单算")
    case({"complaints": {"escalate": 1}}, 10, False, "升级投诉 1 件")
    case({"complaints": {"repeat": 1}}, 20, False, "重复投诉 1 件")
    case({"complaints": {"regulator": 1}}, 50, False, "监管介入 1 件")
    case({"complaints": {"repeat": 2}}, 40, False, "重复投诉 2 件")

    print("\n[2] 三档混合")
    det = case({"complaints": {"escalate": 2, "repeat": 1, "regulator": 1}}, 90, False,
               "2×10 + 1×20 + 1×50")
    chk(det["count"] == 4, "总件数 4（实际 %s）" % det["count"])
    chk(det["basis"] == "tiers", "来源 tiers（实际 %s）" % det["basis"])
    chk(abs(det["byTier"] - 90) < 1e-9, "分档小计 90（实际 %s）" % det["byTier"])

    print("\n[3] 重大投诉 = 一票否决")
    case({"complaints": {"major": True}}, 0, True, "只有 major")
    case({"complaints": {"major": True, "escalate": 5}}, 50, True, "major + 5 件升级（扣分照算但已否决）")

    print("\n[4] 旧格式兼容")
    det = case({"complaint": 25}, 25, False, "complaint:25")
    chk(det["basis"] == "legacy", "来源 legacy（实际 %s）" % det["basis"])
    case({"complaint": 0}, 0, False, "complaint:0")

    print("\n[5] 件数优先于旧总数")
    det = case({"complaint": 999, "complaints": {"escalate": 1}}, 10, False,
               "件数 1 件 + 旧总数 999")
    chk(det["basis"] == "tiers", "来源 tiers（实际 %s）" % det["basis"])
    chk(abs(det["legacy"] - 999) < 1e-9, "旧值仍记录在案（%s）" % det["legacy"])

    print("\n[6] 空输入不炸")
    case({}, 0, False, "完全没有投诉字段")
    case({"complaints": None}, 0, False, "complaints 为 None")
    case({"complaints": {}}, 0, False, "complaints 空对象")

    print("\n[7] 档位常量与方案第八章一致")
    chk(B.COMP_ESC == 10, "升级投诉 10（实际 %s）" % B.COMP_ESC)
    chk(B.COMP_REP == 20, "重复投诉 20（实际 %s）" % B.COMP_REP)
    chk(B.COMP_REG == 50, "监管介入 50（实际 %s）" % B.COMP_REG)

    print("\n[8] 综合得分公式：投诉扣分真被减掉")
    # 直接验算式：100 − 90 + 0 = 10，封顶 120
    d, m, _ = B.complaint_of({"complaints": {"escalate": 2, "repeat": 1, "regulator": 1}})
    total = B.r(min(100 - d + 0, B.TOTAL_CAP))
    chk(abs(total - 10) < 1e-9, "四项满配 100 − 90 = 10（实际 %s）" % total)
    d2, _, _ = B.complaint_of({"complaints": {"regulator": 3}})
    total2 = B.r(min(100 - d2, B.TOTAL_CAP))
    chk(abs(total2 + 50) < 1e-9, "监管 3 件 → 100 − 150 = −50，不设下限（实际 %s）" % total2)

    print("\n" + "=" * 58)
    if FAIL:
        print("失败 %d 项：" % len(FAIL))
        for f in FAIL:
            print("  -", f)
        sys.exit(1)
    print("全部通过")


if __name__ == "__main__":
    main()
