# -*- coding: utf-8 -*-
"""运营状态变更单 → 合并台账 → 推送 GitHub

用法（三选一）：
  1. 网页下载 ST-*.json 后，直接双击 status_push.bat（自动从「下载」目录捡取）
  2. 手动把 ST-*.json 放进 inbox/status/ 再双击 bat
  3. 把变更单文本发给我，由我推送

幂等：同一 id 重复执行不会产生重复记录；已处理文件移入 _done/ 留档。
"""
import json
import os
import shutil
import subprocess
import sys
import datetime

ROOT = r"D:/加油站综合考核系统"
INBOX = os.path.join(ROOT, "inbox", "status")
DONE = os.path.join(INBOX, "_done")
LEDGER = os.path.join(ROOT, "docs", "data", "station_status.json")
TOKEN_FILE = os.path.join(ROOT, ".gh_token.txt")

STATIONS = [
    "富平", "汉中", "秦岭", "华山", "白河", "宁陕", "韩城", "南沙",
    "旬阳", "天汉水城", "洋县", "玉华宫", "富县", "照金", "略阳"
]
STATUS = {"normal", "temp_closed", "partial", "force_majeure", "reopened"}


def fail(msg):
    print("[ERROR] " + msg)
    sys.exit(1)


def read_json(path):
    with open(path, encoding="utf-8-sig") as f:
        return json.load(f)


def write_json(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


def download_dirs():
    """常见的 Windows 下载目录，按优先级返回存在的那些"""
    home = os.path.expanduser("~")
    cands = [
        os.path.join(home, "Downloads"),
        os.path.join(home, "下载"),
        "C:/Users/DELL/Downloads",
    ]
    out = []
    for p in cands:
        if os.path.isdir(p) and p not in out:
            out.append(p)
    return out


def harvest_downloads(known_ids):
    """把「下载」目录里未处理过的 ST-*.json 自动复制进 inbox/status/

    不改动、不删除用户下载目录里的原件。已处理过的按编号跳过。
    """
    brought = 0
    for d in download_dirs():
        try:
            names = os.listdir(d)
        except Exception:
            continue
        for fn in names:
            if not fn.upper().startswith("ST-") or not fn.lower().endswith(".json"):
                continue
            src = os.path.join(d, fn)
            if not os.path.isfile(src):
                continue
            try:
                rec = read_json(src)
            except Exception:
                continue
            rid = rec.get("id")
            if not rid or rid in known_ids:
                continue
            if os.path.isfile(os.path.join(DONE, fn)):
                continue
            dst = os.path.join(INBOX, fn)
            if not os.path.isfile(dst):
                shutil.copy2(src, dst)
                brought += 1
                print("[PICK] 从下载目录捡取：" + fn)
    return brought


def valid_date(s):
    if not s:
        return True
    try:
        datetime.date.fromisoformat(s)
        return True
    except Exception:
        return False


def main():
    os.makedirs(DONE, exist_ok=True)
    if not os.path.isfile(LEDGER):
        fail("找不到台账：" + LEDGER)

    ledger = read_json(LEDGER)
    records = ledger.get("records", [])
    seen = {r.get("id") for r in records}

    # 自动捡取「下载」目录里的变更单，省掉手动搬文件
    harvest_downloads(seen | {
        os.path.splitext(f)[0] for f in os.listdir(DONE) if f.lower().endswith(".json")
    })

    files = sorted(f for f in os.listdir(INBOX)
                   if f.lower().endswith(".json") and os.path.isfile(os.path.join(INBOX, f)))
    if not files:
        print("没有待处理的变更单。")
        print("① 在网页「运营管理」签发并下载变更单，然后重新双击本脚本；")
        print("② 或把 ST-*.json 手动放进：" + INBOX)
        return
    added = []

    for fn in files:
        src = os.path.join(INBOX, fn)
        try:
            rec = read_json(src)
        except Exception as e:
            fail("变更单格式错误 %s：%s" % (fn, e))

        errs = []
        if rec.get("station") not in STATIONS:
            errs.append("站名不在 15 站名单内")
        if rec.get("status") not in STATUS:
            errs.append("状态类型不合法")
        if not rec.get("from") or not valid_date(rec.get("from")):
            errs.append("起始日期缺失或格式错（应为 YYYY-MM-DD）")
        if not valid_date(rec.get("to")):
            errs.append("结束日期格式错")
        if rec.get("to") and rec.get("from") and rec["to"] < rec["from"]:
            errs.append("结束日期早于起始日期")
        if not rec.get("reason"):
            errs.append("缺原因/依据")
        if not rec.get("operator"):
            errs.append("缺签发人")
        if not rec.get("id"):
            errs.append("缺指令编号")
        if errs:
            fail("%s：%s" % (fn, "；".join(errs)))

        if rec["id"] in seen:
            print("[SKIP] 已存在，跳过：%s" % rec["id"])
        else:
            rec["active"] = True
            # 同一站此前"持续有效"的指令，补上结束日期（前一天），保持台账线性可读
            d0 = datetime.date.fromisoformat(rec["from"])
            closing = (d0 - datetime.timedelta(days=1)).isoformat()
            for old in records:
                if (old.get("station") == rec["station"] and old.get("active")
                        and not old.get("to") and old.get("id") != rec["id"]):
                    old["to"] = closing
            records.append(rec)
            seen.add(rec["id"])
            added.append(rec)
            print("[ADD ] %s  %s  %s  %s起" % (
                rec["id"], rec["station"], rec["status"], rec["from"]))

        if "--dry-run" not in sys.argv:
            shutil.move(src, os.path.join(DONE, fn))

    if not added:
        print("没有新指令，台账未改动。")
        return

    if "--dry-run" in sys.argv:
        print("\n[DRY-RUN] 校验通过，未写台账、未移动文件、未推送。")
        return

    records.sort(key=lambda r: (r.get("from", ""), r.get("setAt", "")))
    ledger["records"] = records
    ledger["updatedAt"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    ledger["issuer"] = "计划经营科"

    # 备份
    bak = LEDGER + ".bak"
    shutil.copy2(LEDGER, bak)
    write_json(LEDGER, ledger)
    print("\n台账已更新：%d 条新增，共 %d 条（备份 %s）" % (len(added), len(records), os.path.basename(bak)))

    # 只推送台账文件
    rel = "docs/data/station_status.json"
    subprocess.run(["git", "add", rel], cwd=ROOT, check=True)
    msg = "chore(status): 运营状态变更 %s" % ", ".join(
        "%s-%s" % (r["station"], r["status"]) for r in added)
    subprocess.run(["git", "-c", "user.name=LiuLongWei", "-c", "user.email=liulongwei@local",
                    "commit", "-m", msg], cwd=ROOT, check=False)

    if os.path.isfile(TOKEN_FILE):
        tok = open(TOKEN_FILE, encoding="utf-8").read().strip()
        url = "https://x-access-token:%s@github.com/lvritiann/kaohe-workbench.git" % tok
        for i in range(4):
            p = subprocess.run(["git", "push", url, "main"], cwd=ROOT,
                               capture_output=True, text=True)
            if p.returncode == 0:
                print("[PUSH] 已推送到 GitHub，约 1 分钟后全网生效。")
                return
            print("[RETRY %d] %s" % (i + 1, (p.stderr or "").strip().splitlines()[-1:] or "网络异常"))
        fail("推送失败，本地台账已更新，等网络恢复后手动 git push origin main")
    else:
        print("[WARN] 未找到令牌文件，本地台账已更新但未推送。")


def validate_record(rec):
    """校验一条变更单，返回错误列表（空列表＝通过）"""
    errs = []
    if rec.get("station") not in STATIONS:
        errs.append("站名不在 15 站名单内")
    if rec.get("status") not in STATUS:
        errs.append("状态类型不合法")
    if not rec.get("from") or not valid_date(rec.get("from")):
        errs.append("起始日期缺失或格式错（应为 YYYY-MM-DD）")
    if not valid_date(rec.get("to")):
        errs.append("结束日期格式错")
    if rec.get("to") and rec.get("from") and rec["to"] < rec["from"]:
        errs.append("结束日期早于起始日期")
    if not rec.get("reason"):
        errs.append("缺原因／依据")
    if not rec.get("operator"):
        errs.append("缺签发人")
    if not rec.get("id"):
        errs.append("缺指令编号")
    if rec.get("affectedDays") not in (None, ""):
        try:
            d = int(rec["affectedDays"])
            if d < 0 or d > 31:
                errs.append("实际经营天数应在 0–31 之间")
        except Exception:
            errs.append("实际经营天数须为整数")
    return errs


def apply_record(rec, dry_run=False):
    """供本地管理台复用：校验 → 合并 → 备份 → 写回 → 推送

    返回 {"ok":bool, "message":str, "steps":[...], "pushed":bool}
    """
    steps = []
    errs = validate_record(rec)
    if errs:
        return {"ok": False, "message": "；".join(errs), "steps": steps, "pushed": False}

    if not os.path.isfile(LEDGER):
        return {"ok": False, "message": "找不到台账：" + LEDGER, "steps": steps, "pushed": False}

    ledger = read_json(LEDGER)
    records = ledger.get("records", [])
    seen = {r.get("id") for r in records}
    if rec["id"] in seen:
        return {"ok": True, "message": "该编号已存在，未重复写入", "steps": ["幂等跳过"], "pushed": False}

    rec = dict(rec)
    rec["active"] = True
    d0 = datetime.date.fromisoformat(rec["from"])
    closing = (d0 - datetime.timedelta(days=1)).isoformat()
    for old in records:
        if (old.get("station") == rec["station"] and old.get("active")
                and not old.get("to") and old.get("id") != rec["id"]):
            old["to"] = closing
            steps.append("关闭同站旧指令 " + str(old.get("id")))

    records.append(rec)
    records.sort(key=lambda r: (r.get("from", ""), r.get("setAt", "")))
    ledger["records"] = records
    ledger["updatedAt"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    ledger["issuer"] = "计划经营科"
    steps.append("新增指令 %s（%s / %s）" % (rec["id"], rec["station"], rec["status"]))

    if dry_run:
        return {"ok": True, "message": "校验通过（演练，未写入）", "steps": steps, "pushed": False}

    shutil.copy2(LEDGER, LEDGER + ".bak")
    write_json(LEDGER, ledger)
    steps.append("台账已写入并备份 .bak")

    rel = "docs/data/station_status.json"
    subprocess.run(["git", "add", rel], cwd=ROOT, check=True)
    msg = "chore(status): %s %s %s" % (rec["station"], rec["status"], rec["from"])
    subprocess.run(["git", "-c", "user.name=LiuLongWei", "-c", "user.email=liulongwei@local",
                    "commit", "-m", msg], cwd=ROOT, check=False)
    steps.append("已提交到本地 Git")

    if not os.path.isfile(TOKEN_FILE):
        steps.append("未找到令牌，跳过推送（本地已生效）")
        return {"ok": True, "message": "台账已更新，但未推送", "steps": steps, "pushed": False}

    tok = open(TOKEN_FILE, encoding="utf-8").read().strip()
    url = "https://x-access-token:%s@github.com/lvritiann/kaohe-workbench.git" % tok
    for i in range(4):
        p = subprocess.run(["git", "push", url, "main"], cwd=ROOT,
                           capture_output=True, text=True)
        if p.returncode == 0:
            steps.append("已推送 GitHub（第 %d 次尝试）" % (i + 1))
            return {"ok": True, "message": "签发并推送成功，约 1 分钟后全网生效",
                    "steps": steps, "pushed": True}
        steps.append("推送重试 %d：%s" % (i + 1, ((p.stderr or "").strip().splitlines() or ["网络异常"])[-1][:60]))
    steps.append("推送失败：本地台账已生效，网络恢复后手动 git push origin main")
    return {"ok": True, "message": "台账已更新，推送未完成（可稍后重试）",
            "steps": steps, "pushed": False}


if __name__ == "__main__":
    main()
