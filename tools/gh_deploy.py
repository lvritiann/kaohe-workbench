# -*- coding: utf-8 -*-
"""用 PAT 建仓库、推代码、开 Pages（绕过 gh 的 read:org 依赖）
令牌只从 .gh_token.txt 读取，不打印、不写入 git 配置。
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = r"D:/加油站综合考核系统"
TOKEN_FILE = os.path.join(ROOT, ".gh_token.txt")
REPO = "kaohe-workbench"
DESC = "加油站综合考核工作台 · 现场打分与排名（体系A V2.1）"
API = "https://api.github.com"


def token():
    with open(TOKEN_FILE, "r", encoding="utf-8") as f:
        t = f.read().strip()
    if not t:
        sys.exit("令牌文件为空")
    return t


def call(method, path, tok, body=None, allow=()):
    url = API + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "token " + tok)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode("utf-8")
            return r.status, (json.loads(raw) if raw.strip() else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "ignore")
        if e.code in allow:
            try:
                return e.code, json.loads(raw)
            except Exception:
                return e.code, {"raw": raw}
        sys.exit("API 失败 %s %s -> %s %s" % (method, path, e.code, raw[:300]))


def main():
    tok = token()

    st, me = call("GET", "/user", tok)
    login = me["login"]
    print("账号：%s" % login)

    st, repo = call("GET", "/repos/%s/%s" % (login, REPO), tok, allow=(404,))
    if st == 404:
        st, repo = call("POST", "/user/repos", tok, {
            "name": REPO,
            "description": DESC,
            "private": False,
            "has_issues": True,
            "has_wiki": False,
            "auto_init": False,
        })
        print("已创建仓库：%s" % repo["html_url"])
    else:
        print("仓库已存在：%s" % repo["html_url"])

    # 推代码：令牌只出现在本次命令中，不写入 .git/config
    remote = "https://github.com/%s/%s.git" % (login, REPO)
    auth_url = "https://x-access-token:%s@github.com/%s/%s.git" % (tok, login, REPO)

    subprocess.run(["git", "remote", "remove", "origin"], cwd=ROOT,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(["git", "remote", "add", "origin", remote], cwd=ROOT, check=True)
    subprocess.run(["git", "branch", "-M", "main"], cwd=ROOT, check=True)

    print("推送中…")
    p = subprocess.run(["git", "push", "-u", auth_url, "main", "--force"],
                       cwd=ROOT, capture_output=True, text=True, timeout=180)
    if p.returncode != 0:
        msg = (p.stderr or "").replace(tok, "***")
        sys.exit("推送失败：\n" + msg[-1200:])
    print("推送完成")

    # 开启 Pages：main 分支 /docs 目录
    src = {"source": {"branch": "main", "path": "/docs"}}
    st, pg = call("POST", "/repos/%s/%s/pages" % (login, REPO), tok, src, allow=(409, 422))
    if st in (409, 422):
        st, pg = call("PUT", "/repos/%s/%s/pages" % (login, REPO), tok, src, allow=(409,))

    url = pg.get("html_url")
    print("Pages 状态：%s" % pg.get("status", "building"))
    print("网址：%s" % (url or "https://%s.github.io/%s/" % (login, REPO)))

    # 等待构建完成（最多 ~2 分钟）
    for _ in range(12):
        time.sleep(10)
        st, pg = call("GET", "/repos/%s/%s/pages" % (login, REPO), tok, allow=(404,))
        s = pg.get("status")
        print("  ... %s" % s)
        if s == "built":
            break

    st, pg = call("GET", "/repos/%s/%s/pages" % (login, REPO), tok, allow=(404,))
    final = pg.get("html_url") or "https://%s.github.io/%s/" % (login, REPO)
    print("\n部署完成：%s" % final)
    print("仓库地址：https://github.com/%s/%s" % (login, REPO))


if __name__ == "__main__":
    main()
