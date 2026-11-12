# 加油站综合考核工作台

陕西高速延长石油有限责任公司 · 计划经营科｜覆盖 15 座高速公路加油站。

规则源：《高速公路加油站目标责任考核方案》V1.0（2026-11-12 16:53 定稿，另一空间 worktree `main-116434f9`）。
**本工作台一律以 V5 五段制为准；仓库内任何「三段加权」「四段制」「55.65/28.80」「等级制」的历史表述均已作废。**

## 一、V5 计分口径

| 段 | 项目 | 基准 | 封顶 | 算法 |
|---|---|---|---|---|
| 一 | 油品销量 | 40 | 48 | 40 × 完成率倍数 |
| 二 | 非油销量 | 10 | 12 | 销售5 + 毛利5，各封顶6 |
| 三 | 油品人效 | 15 | 25 | 人效 ÷ 65 × 15 |
| 四 | 二级运营检查 | 20 | 20 | 检查折算百分制 × 20% |
| 五 | 神秘访客 | 15 | 15 | 神访百分制 × 15%，未测按当月参评站均分填补 |

- **综合** ＝ 五段之和 − 投诉扣分 + 进步加分；基准 100、封顶 120；**不设等级，只出 1–15 名**，同分油品段高者排前。
- **少扣多奖**：完成率 ≥100% 用 `1 + 1.5×(rate−1)`；<100% 用 `1 + 0.5×(rate−1)`。
- **人效** ＝ (会计月当量总量 ÷ 会计月天数) ÷ (月均在岗人数 − 4)；当量 SGE ＝ 汽油吨×**56** ＋ 柴油吨×**28**；月均在岗 ＝ 各日在岗之和 ÷ 会计月天数；基准 **65**（15 站算术平均 65.15 取整，当年固定）。
- **会计月** ＝ 上月 26 日 — 本月 25 日，天数按实计（28/29/30/31）。
- **非油**：销售完成率**不含烟草**，毛利率完成率**含烟草**；毛利率 ＝ 全月毛利额 ÷ 全月销售额，不按日均毛利率平均。
- **投诉**：升级 10 分/件、重复 20 分/件、监管转办 50 分/件，不设下限；重大投诉触发一票否决。
- **进步加分**：年度人效同比每升 1% 加 0.2 分，上限 3 分。
- **一票否决 6 项**：资质证照办理、核心检测报告、散装汽油销售管控、危险废物管理、油品质量合规、重大投诉。触发即当期综合得分 0、排名垫底、当年不得评优。
- **玉华宫**按定稿附录B：月均在岗 12 人 → 分母 8 → 人效 70.10 → 人效段 16.18。

## 二、页面

| 页面 | 用途 |
|---|---|
| `index.html` | 首页、五段分值、运营状态摘要、全部入口 |
| `score.html` | 现场打分：6 项否决 + 73 项判定，默认满分反向打分，支持照片 |
| `rank.html` | 综合排名榜，五段拆解，停业站单列不参与排名 |
| `eff.html` | **人效看板**：当月实时人效、15 站排序、历史月度趋势 |
| `calc.html` | 五段得分可复算，站长自核 |
| `inbox.html` | 待交箱（本机登记，防漏交） |
| `status.html` | 运营管理：停业/复营指令签发 |
| `direct.html` | 直推客户端：浏览器直连 GitHub 台账，无需服务器 |

手机端优先，支持日间/暗色主题；Service Worker 离线缓存，站点无信号也能打分。

## 三、数据流

```
金山日报「202610销售及库存日报（新)」
   └─ AirScript tools/airscript/eff_push.js（每日定时）
        └─ HTTP PUT → GitHub docs/data/efficiency.json → eff.html 人效看板
                                                     └─ 月度留痕 history[]

现场打分 score.html（选打分人 + 口令）
   └─ 导出 检查表_站名_月份_时间戳.zip
        ├─ 检查表.xlsx（评分表 / 汇总）
        ├─ photos/（压缩至长边 1280px）
        └─ manifest.json（站点、月份、检查人、扣分项、折算分）
   └─ 科室 python tools/read_check_zip.py <zip>
        └─ inbox/检查表/<包名>/ + wps_upload_queue.json
   └─ 导入金山「考核工作台数据源」→ 检查明细 + 照片附件列
   └─ 科室汇总五段 → tools/build_rank.py → docs/data/rank.json → rank.html

运营状态 status.html / status_push.bat / direct.html
   └─ docs/data/station_status.json（停业站当月不排名）
```

**照片只进金山在线表，GitHub 仓库零照片。**

## 四、关键文件

- `docs/assets/config.js` — 全局口径（唯一规则源）
- `docs/assets/engine.js` — 五段计分引擎
- `docs/data/items.json` — 73 判定项 + 6 否决项（由 `tools/export_items.py` 从权威 Excel 导出并校验）
- `docs/data/stations.json` — 定稿附录B 15 站人效基准
- `docs/data/inspectors.json` — 打分人名单与口令
- `docs/data/efficiency.json` — 实时/月均人效（AirScript 推，或本地生成）
- `docs/data/rank.json` — 月度五段排名
- `docs/data/station_status.json` — 运营状态台账
- `tools/build_efficiency.py` — 本地生成/覆盖 V5 人效数据
- `tools/build_rank.py` — 生成月度五段排名
- `tools/read_check_zip.py` — 拆解现场打分 zip，产出金山上传队列
- `tools/airscript/eff_push.js` — 金山日报簿内 AirScript（**含令牌，已 gitignore，勿外发**）

## 五、部署

GitHub Pages：仓库 `lvritiann/kaohe-workbench`，源 `main` / `docs`。
线上：<https://lvritiann.github.io/kaohe-workbench/>

推送：`git add -A && git commit -m "..." && git push`。令牌放 `.gh_token.txt`，已 gitignore。
每次改 `docs/` 下前端资源后，**同步升级 `docs/sw.js` 的 `CACHE` 版本号**，否则用户手机端一直用旧缓存。

## 六、科室月度 SOP

| 时点 | 动作 |
|---|---|
| 25—31 日 | 现场检查打分，导出 zip |
| 次月 3 日 | 站端报数（油品/非油/人数） |
| 次月 5 日 | 汇总五段，`python tools/build_rank.py` 生成 rank.json |
| 次月 7 日 | 投诉统计并入 |
| 次月 10 日 | 推 GitHub，发榜 |
| 次月 15 日 | 后 3 位交分析报告 |

`build_rank.py` 的演示数据必须替换成科室核算数据后才算正式发榜；页面会自动识别 `dataMode: "demo"` 并显示黄条提示。

## 七、打分人账号

6 组，名单在 `docs/data/inspectors.json`，初始为「检查员01—06」，口令为 6 位数字。
下拉选人 + 输口令即可打分。**这只是署名动作，不是安全边界**（前端校验可绕过，不做服务端鉴权）。
换成真实姓名：只改 JSON 里的 `name`，不需改代码；改完推 GitHub 并升级 sw 版本号。

## 八、排错（高频场景）

1. **打不开登录页**：确认 `data/items.json`、`data/inspectors.json` 存在且为合法 JSON；联网打开一次让 SW 缓存。
2. **口令不对**：6 位数字、无空格；名单改过要强刷一次（缓存版本见 `sw.js`）。
3. **点提交没反应**：每个扣分项必须填原因；提交弹层必须勾「已逐项核对」。
4. **照片没进 zip**：手机需允许相册/相机权限；单张压缩到 1280px，最多 3 张。
5. **分数与定稿对不上**：确认用 56/28（不是 55.65/28.80）、月均在岗−4、会计月天数按实计、毛利含烟草、分母不是当日人数。
6. **人效看板不刷新**：AirScript 末尾的 `main();` 不能删；看 `efficiency.json` 的 `updatedAt`；SW 对 `/data/` 是「先网络后缓存」，断网才用旧值。
7. **照片进金山**：`python tools/read_check_zip.py <zip>` → `wps_upload_queue.json` → 导入「考核工作台数据源」检查明细；GitHub 不推照片。
8. **换打分人 / 改题目**：改对应 JSON → 推 GitHub → 升 sw 版本 → 页面强刷。
9. **离线**：首次联网打开后自动缓存；断网可打分可导出，照片只存本地草稿。
10. **停业站仍出现在榜上**：检查 `station_status.json` 的 `from`/`active` 与 `status.html` 签发的变更单是否已推送。

## 九、口径红线

- 不要用「实际在岗」单点人数代替「月均在岗」。
- 不要再引入 90/80/70/60 等级线，V5 只排名。
- 不要改 SGE 系数、基准 65、扣减 4 人这三项，除非定稿修订。
- `tools/airscript/` 目录含明文令牌，**不入库、不外发**；令牌轮换后需重粘脚本。
