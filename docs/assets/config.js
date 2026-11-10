/* 全局配置：站名、口径参数、提交口令
   参数全部来自《附件1-体系A综合考核方案（V2.1）》附录A，改这里等于改口径，务必同步文档。
*/
window.CFG = {
  version: 'V2.1',

  stations: [
    '富平', '汉中', '秦岭', '华山', '白河', '宁陕', '韩城', '南沙',
    '旬阳', '天汉水城', '洋县', '玉华宫', '富县', '照金', '略阳'
  ],

  // 二级运营检查
  inspect: {
    total: 100,
    gradeLines: { excellent: 90, good: 80, pass: 70 },
    weight: 0.30
  },

  // 三段权重
  weights: { eff: 0.50, nonoil: 0.20, inspect: 0.30 },

  // 人效口径
  hr: {
    baseHeadcount: 4,
    sgeGas: 55.65,
    sgeDiesel: 28.80,
    benchmark: 65.26,
    passLine: 58.73,
    excellentLine: 71.79,
    shortageThreshold: 0.20
  },

  // 提交口令：仅用于防止随手提交，不是安全边界（静态站点无服务端，任何人可绕过）。
  // 真正的可信来自：文件名带站与年月、科室导入时校验、现场纸质签字留证。
  submitPass: 'SFYD-2027',

  // 得分制
  nonoilCap: 2.0,
  nonoilBase: 20,
  complaintPerCase: 10,
  progressCap: 3
};
