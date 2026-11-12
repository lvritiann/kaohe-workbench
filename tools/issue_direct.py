# -*- coding: utf-8 -*-
"""纯命令行直推：从环境变量读取参数 → 生成变更单 → 校验 → 合并台账 → 推送

由「直推.bat」调用，不依赖浏览器、不依赖静态页面。
"""
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import status_push as sp


def env(k, default=""):
    return (os.environ.get(k) or default).strip()


def main():
    now = datetime.datetime.now()
    rec = {
        "id": "ST-" + now.strftime("%Y%m%d-%H%M%S"),
        "station": env("STATION"),
        "status": env("STATUS_CODE", "temp_closed"),
        "from": env("FROM_DATE") or now.strftime("%Y-%m-%d"),
        "to": env("TO_DATE") or None,
        "reason": env("REASON"),
        "affectedDays": int(env("AFFECTED_DAYS")) if env("AFFECTED_DAYS") else None,
        "operator": env("OPERATOR"),
        "setAt": now.strftime("%Y-%m-%d %H:%M"),
        "evidence": env("EVIDENCE"),
        "active": True,
    }

    print("=" * 52)
    print("  运营状态直推")
    print("=" * 52)
    print("  油站  :", rec["station"])
    print("  状态  :", rec["status"])
    print("  期间  :", rec["from"], "起", ("至 " + rec["to"]) if rec["to"] else "（持续）")
    print("  原因  :", rec["reason"])
    print("  签发人:", rec["operator"])
    print("  编号  :", rec["id"])
    print("=" * 52)

    if "--dry-run" in sys.argv:
        errs = sp.validate_record(rec)
        if errs:
            print("[校验失败]", "；".join(errs))
            return 1
        print("[DRY-RUN] 参数校验通过，未写台账、未推送。")
        return 0

    res = sp.apply_record(rec)
    print("")
    for s in res["steps"]:
        print("  -", s)
    print("")
    print(("  [OK] " if res["ok"] else "  [FAIL] ") + res["message"])
    print("")
    print("  变更单留档：inbox/status/_direct/" + rec["id"] + ".json")
    os.makedirs(sp.INBOX + "/_direct", exist_ok=True)
    sp.write_json(os.path.join(sp.INBOX, "_direct", rec["id"] + ".json"), rec)
    return 0 if res["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
