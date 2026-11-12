/* 全局配置 V5 —— 《高速公路加油站目标责任考核方案》V1.0
   定稿：2026-11-12 16:53（另一空间 worktree main-116434f9）
   五段结构（基准 100 / 封顶 120）：
     油品销量40(封顶48) + 非油销量10(封顶12) + 油品人效15(封顶25)
     + 二级运营检查20 + 神秘访客15
   综合 = 油品段+非油段+人效段+运营段+神访段 − 投诉扣分 + 进步加分
   不设等级，只出 1–15 名排名。
*/
window.CFG = {
  version: 'V5',

  stations: [
    '富平', '汉中', '秦岭', '华山', '白河', '宁陕', '韩城', '南沙',
    '旬阳', '天汉水城', '洋县', '玉华宫', '富县', '照金', '略阳'
  ],

  /* 五段分值 */
  seg: {
    oil:      { base: 40, cap: 48 },
    nonoil:   { base: 10, cap: 12 },
    eff:      { base: 15, cap: 25 },
    inspect:  { base: 20, cap: 20 },
    mystery:  { base: 15, cap: 15 }
  },

  /* 少扣多奖：完成率≥100% 用 bonus 斜率，<100% 用 penalty 斜率 */
  scoreRule: { bonus: 1.5, penalty: 0.5 },

  /* 会计月：上月 26 日 — 本月 25 日，天数按实际计（28/29/30/31） */
  period: { startDay: 26, endDay: 25 },

  /* 油品人效段 */
  hr: {
    sgeGas: 56,          /* 取整值，精确 55.65 */
    sgeDiesel: 28,       /* 取整值，精确 28.80 */
    baseHeadcount: 4,    /* 24h 两班倒、每班至少 2 人的最低开班配置 */
    benchmark: 65,       /* 15 站算术平均 65.15，取整；当年固定 */
    fullAt: 1.67,        /* 人效达基准 1.67 倍（108.6）封顶 */
    headcountMode: '月均在岗＝当月各日在岗之和 ÷ 会计月天数',
    engineDetail: {
      gasLitrePerTon: 1333, dieselLitrePerTon: 1200,
      gasLitrePerCar: 31.5, dieselLitrePerCar: 150,
      gasCarWeight: 1.0, dieselCarWeight: 1.8,
      gasLitreWeight: 0.01, dieselLitreWeight: 0.012
    }
  },

  /* 非油销量段：销售不含烟草、毛利含烟草 */
  nonoil: {
    salesWeight: 5, marginWeight: 5, capEach: 6,
    salesExcludesTobacco: true,
    marginIncludesTobacco: true,
    /* 含烟草毛利率目标值（%），按站分别下达，取自定稿表5 / 财务科核算数据 */
    marginTarget: {
      '汉中': 33.0, '富平': 27.0, '天汉水城': 28.0, '韩城': 26.0, '白河': 27.0,
      '华山': 22.0, '旬阳': 11.0, '宁陕': 26.0, '南沙': 22.0, '洋县': 27.0,
      '略阳': 11.0, '富县': 20.0, '玉华宫': 18.0, '秦岭': 25.0, '照金': 10.0
    }
  },

  /* 现场管理段 */
  inspect: { total: 100, items: 73, veto: 6, naAdjust: true },
  mystery: {
    total: 100,
    dims: ['环境卫生与设施设备', '员工仪容仪表', '现场服务'],
    untestedFill: '当月参评站平均分'
  },

  /* 投诉扣分（前三档按分扣减、不设下限；重大投诉一票否决） */
  complaint: { escalate: 10, repeat: 20, regulator: 50, major: 'veto' },

  progressCap: 3,
  progressPerPct: 0.2,

  /* 一票否决 6 项 */
  vetoNames: [
    '资质证照办理', '核心检测报告', '散装汽油销售管控',
    '危险废物管理', '油品质量合规', '重大投诉'
  ],

  /* 打分人：下拉选名字 + 个人口令。名单独立放 data/inspectors.json，改名单不动代码。 */
  inspectorsFile: 'data/inspectors.json',

  /* 登录仅为署名动作，前端校验可被绕过；不做服务端鉴权。 */
  authNote: '前端登录仅用于记录打分人，不是安全边界。',

  submitPass: 'SFYD-2027'
};
