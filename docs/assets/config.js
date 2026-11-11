/* 全局配置 V3 —— 口径依据《油品人效考核测算表》（2025 数据测算，R²=0.9222）
 *
 * 与 V2 的差异（务必注意）：
 *   1. SGE 改为「车次×系数 ＋ 升数×系数」推导；1 吨汽油仍折 55.65、1 吨柴油 28.80，结果一致
 *   2. 分母改为「在册人数」，不再扣减 4 名基础人数
 *   3. 规模差异改由「修正系数」抹平（0.69~1.50，按站固定，每年 1 月重算）
 *   4. 基准人效 56.7（原 65.26）；排名依据为「修正后人效」
 */
window.CFG = {
  version: 'V3',

  stations: [
    '富平', '汉中', '秦岭', '华山', '白河', '宁陕', '韩城', '南沙',
    '旬阳', '天汉水城', '洋县', '玉华宫', '富县', '照金', '略阳'
  ],

  inspect: {
    total: 100,
    gradeLines: { excellent: 90, good: 80, pass: 70 },
    weight: 0.30
  },

  weights: { eff: 0.50, nonoil: 0.20, inspect: 0.30 },

  /* ---------------- 人效口径 V3 ---------------- */
  hr: {
    sge: {
      gasCarWeight: 1.0,      /* 汽油车次系数 */
      gasLitreWeight: 0.01,   /* 汽油升数系数 */
      dieselCarWeight: 1.8,   /* 柴油车次系数：一次柴油作业≈1.8 次汽油 */
      dieselLitreWeight: 0.012
    },

    gasLitrePerCar: 31.5,     /* 汽油平均每车升数（25~38 中值） */
    dieselLitrePerCar: 150,   /* 柴油平均每车升数（80~220 中值） */
    gasLitrePerTon: 1333,     /* 1 吨汽油 = 1333 升 */
    dieselLitrePerTon: 1200,  /* 1 吨柴油 = 1200 升 */

    sgeGas: 55.65,            /* 简化系数，可由上面精确推出 */
    sgeDiesel: 28.80,

    regA: 22.1638,            /* 预期人效 = a×ln(日均吨) + b */
    regB: -11.5326,
    regR2: 0.9222,

    benchmark: 56.7,          /* 基准人效（对应日均 21.7 吨） */
    coeffCap: 1.5,
    coeffFloor: 0.5,

    /* 等级线按达成率划分（修正后人效 ÷ 基准） */
    lines: { excellent: 1.10, good: 1.00, pass: 0.90, warn: 0.80 }
  },

  /* 15 站修正系数与在册人数（2025 年数据测算，当年内固定，每年 1 月重算） */
  stationCoeff: {
    '富平':     { coeff: 0.818, head: 23, dayTon: 38.3, gasShare: 0.80 },
    '汉中':     { coeff: 0.981, head: 16, dayTon: 22.8, gasShare: 0.62 },
    '秦岭':     { coeff: 0.844, head: 25, dayTon: 34.8, gasShare: 0.80 },
    '华山':     { coeff: 0.690, head: 31, dayTon: 68.4, gasShare: 0.33 },
    '白河':     { coeff: 1.192, head: 14, dayTon: 14.4, gasShare: 0.64 },
    '宁陕':     { coeff: 0.965, head: 21, dayTon: 23.8, gasShare: 0.83 },
    '韩城':     { coeff: 0.951, head: 21, dayTon: 24.8, gasShare: 0.76 },
    '南沙':     { coeff: 0.948, head: 15, dayTon: 25.0, gasShare: 0.20 },
    '旬阳':     { coeff: 1.320, head: 12, dayTon: 11.7, gasShare: 0.46 },
    '天汉水城': { coeff: 0.954, head: 17, dayTon: 24.5, gasShare: 0.32 },
    '洋县':     { coeff: 1.050, head: 21, dayTon: 19.2, gasShare: 0.70 },
    '玉华宫':   { coeff: 1.500, head: 15, dayTon: 7.9,  gasShare: 0.83 },
    '富县':     { coeff: 1.500, head: 12, dayTon: 5.0,  gasShare: 0.82 },
    '照金':     { coeff: 1.500, head: 11, dayTon: 3.1,  gasShare: 0.79 },
    '略阳':     { coeff: 1.500, head: 8,  dayTon: 1.7,  gasShare: 0.59 }
  },

  submitPass: 'SFYD-2027',

  nonoilCap: 2.0,
  nonoilBase: 20,
  complaintPerCase: 10,
  progressCap: 3
};
