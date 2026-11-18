# -*- coding: utf-8 -*-
"""通过 GitHub Git Data API 推送（github.com 被代理阻断时用）"""
import base64
import time
import json
import os
import urllib.request

ROOT = r"D:/加油站综合考核系统"
TOKEN = open(os.path.join(ROOT, ".gh_token.txt"), encoding="utf-8").read().strip()
OWNER, REPO = "lvritiann", "kaohe-workbench"
BRANCH = "main"
API = "https://api.github.com"
PROXY = "http://127.0.0.1:54216"

FILES = [
    "README.md", ".gitignore",
    "docs/assets/score.js", "docs/sw.js",
    "tools/read_check_zip.py",
    "tools/_t_chain.py", "tools/_t_record.py", "tools/_t_expect.js",
    "tools/_api_push.py",
]

MSG = """fix(v6): 修通现场检查落表链路（含阻断级「零扣分站丢 28 分」）

独立验收发现 1 个阻断 + 4 个 P2，全部已修，43+40 条回归断言通过。

阻断项：检查了、零扣分的站整块落不进记录表
- read_check_zip.py 原用 `if not items:`，把「deductions 存在但为空」和
  「旧包无该字段」混同，空清单只输出表头并误报「请改用新版打分页」。
  现按 `"deductions" in m` 判存在性，空清单补一条序号为空的占位行。
- record_sync.py 的跳过判据由「有没有扣分项」改为「meta 里有没有该站该月」，
  于是「检查了零扣分」写 100/28，「没去现场」才整块留空。

其余修复
- record_sync: 块步长按标题行探测，探测数≠30 直接拒绝写入（原写死 78，
  年度表实为 79 行/块，第 2 站起逐站错位、末站整块写到别人身上）
- record_sync: 明细「月份」十种形态归一；「表类型」白名单；
  序号未消费/站名不在清单/块标准分合计≠100 全部告警，不再静默丢分
- record_sync: 得分与结果矛盾时按结果列计分并告警（原会静默改判「符合」，
  记录表比分打页高）；照片名/附件ID 带进记录表 H/I 列
- score.js: manifest 新增 deductions[]（扣分/NA/否决逐项），
  nowMonth() 改走 Engine.currentMonth() 支持 26 日滚动到下一会计月
- read_check_zip.py: TSV 改为一行一个扣分项（原按照片出行，
  没拍照的扣分项会漏记并按满分处理）；新增会计月一致性校验
- sw.js: kaohe-v6-5 -> kaohe-v6-6
- README: 新增「十二、落表链路」——块结构、五条铁律、折算口径表、
  上表操作硬性步骤（占位行不可过滤）、回归测试跑法；排错补 15-20 条
- 新增回归测试 tools/_t_chain.py(43)、tools/_t_record.py(40)、
  tools/_t_expect.js（直接 require 线上 engine.js 作标准答案）"""



def call(method, path, body=None):
    req = urllib.request.Request(API + path, method=method)
    data = json.dumps(body).encode() if body is not None else None
    if data:
        req.data = data
        req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "kaohe-deploy")
    # 直连 api.github.com（不走上游代理，代理对 github 域不稳定）
    op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    last = None
    for attempt in range(3):
        try:
            with op.open(req, timeout=60) as r:
                return json.loads(r.read().decode())
        except Exception as e:      # noqa: BLE001
            last = e
            time.sleep(2 + attempt * 3)
    raise last


ref = call("GET", f"/repos/{OWNER}/{REPO}/git/ref/heads/{BRANCH}")
head_sha = ref["object"]["sha"]
head = call("GET", f"/repos/{OWNER}/{REPO}/git/commits/{head_sha}")
base_tree = head["tree"]["sha"]
print("远端 HEAD:", head_sha[:8])

entries = []
for rel in FILES:
    raw = open(os.path.join(ROOT, rel.replace("/", os.sep)), "rb").read()
    blob = call("POST", f"/repos/{OWNER}/{REPO}/git/blobs",
                {"content": base64.b64encode(raw).decode(), "encoding": "base64"})
    entries.append({"path": rel, "mode": "100644", "type": "blob", "sha": blob["sha"]})
    print("  blob", rel, len(raw), "bytes")

tree = call("POST", f"/repos/{OWNER}/{REPO}/git/trees",
            {"base_tree": base_tree, "tree": entries})
commit = call("POST", f"/repos/{OWNER}/{REPO}/git/commits",
              {"message": MSG, "tree": tree["sha"], "parents": [head_sha]})
print("新 commit:", commit["sha"][:8])
call("PATCH", f"/repos/{OWNER}/{REPO}/git/refs/heads/{BRANCH}",
     {"sha": commit["sha"], "force": False})
print("已更新 ref heads/%s" % BRANCH)
