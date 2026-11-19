# -*- coding: utf-8 -*-
"""通过 GitHub Git Data API 推送（github.com:443 被阻断，git push 走不通时用）

用法：
    python tools/_api_push.py -m "提交说明" 文件1 文件2 ...

说明文件也可以用 --msg-file 指向一个 utf-8 文本文件（长说明用它更省事）。
路径写相对仓库根目录的，用 / 分隔。
"""
import base64
import sys
import time
import json
import os
import urllib.request

ROOT = r"D:/加油站综合考核系统"
TOKEN = open(os.path.join(ROOT, ".gh_token.txt"), encoding="utf-8").read().strip()
OWNER, REPO = "lvritiann", "kaohe-workbench"
BRANCH = "main"
API = "https://api.github.com"


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


def parse_args(argv):
    msg, msg_file, files = "", None, []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("-m", "--message"):
            i += 1
            msg = argv[i]
        elif a == "--msg-file":
            i += 1
            msg_file = argv[i]
        else:
            files.append(a)
        i += 1
    if msg_file:
        msg = open(msg_file, encoding="utf-8").read().rstrip()
    if not files:
        sys.exit("没有指定要推的文件")
    return msg, files


def main():
    msg, files = parse_args(sys.argv[1:])

    ref = call("GET", f"/repos/{OWNER}/{REPO}/git/ref/heads/{BRANCH}")
    head_sha = ref["object"]["sha"]
    head = call("GET", f"/repos/{OWNER}/{REPO}/git/commits/{head_sha}")
    base_tree = head["tree"]["sha"]
    print("远端 HEAD:", head_sha[:8])

    entries = []
    for rel in files:
        abs_path = os.path.join(ROOT, rel.replace("/", os.sep))
        raw = open(abs_path, "rb").read()
        blob = call("POST", f"/repos/{OWNER}/{REPO}/git/blobs",
                    {"content": base64.b64encode(raw).decode(), "encoding": "base64"})
        entries.append({"path": rel, "mode": "100644", "type": "blob", "sha": blob["sha"]})
        print("  blob", rel, len(raw), "bytes")

    tree = call("POST", f"/repos/{OWNER}/{REPO}/git/trees",
                {"base_tree": base_tree, "tree": entries})
    commit = call("POST", f"/repos/{OWNER}/{REPO}/git/commits",
                  {"message": msg, "tree": tree["sha"], "parents": [head_sha]})
    print("新 commit:", commit["sha"][:8])
    call("PATCH", f"/repos/{OWNER}/{REPO}/git/refs/heads/{BRANCH}",
         {"sha": commit["sha"], "force": False})
    print("已更新 ref heads/%s" % BRANCH)
    print("https://github.com/%s/%s/commit/%s" % (OWNER, REPO, commit["sha"]))


if __name__ == "__main__":
    main()
