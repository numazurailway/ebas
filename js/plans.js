/*
 * EBAS plans.js
 * 複数の精算案（プリセット）を生成する。計算ロジック自体は calc.js に委譲する。
 */
(function (global) {
  'use strict';

  var calc = global.EBAS.calc;

  // 比較案は常に「方式B：性別固定重み」の設定値だけを変えて同一軸で比較する。
  // ユーザーが選択中の性別調整方式（A/B/C）とは独立した、参考用のプリセットである。
  var PLAN_PRESETS = [
    {
      id: 'drinker_heavy',
      label: '飲み多め負担案',
      description: '飲酒ありの参加者の負担を大きくする案',
      genderConfig: { maleWeight: 1.0, femaleWeight: 0.9 },
    },
    {
      id: 'gender_gap_large',
      label: '性別差大きめ案',
      description: '性別による負担差を大きくする案',
      genderConfig: { maleWeight: 1.0, femaleWeight: 0.6 },
    },
    {
      id: 'even_split',
      label: '均等寄り案',
      description: '性別差をほぼ付けず、均等に近い負担にする案',
      genderConfig: { maleWeight: 1.0, femaleWeight: 1.0 },
    },
  ];

  /**
   * カテゴリ×性別の人数と全体会計から、比較用の複数プリセット案を生成する。
   * @param {Object} categoryGenderCounts
   * @param {number} totalBill
   * @param {number} roundingUnit
   * @param {string} roundingMethod
   * @returns {Array<{id:string, label:string, description:string, result:Object}>}
   */
  function generateComparisonPlans(categoryGenderCounts, totalBill, roundingUnit, roundingMethod) {
    return PLAN_PRESETS.map(function (preset) {
      var groups = calc.resolveGroupsModeB(categoryGenderCounts, preset.genderConfig);
      var result = calc.calculateSplit(groups, totalBill, roundingUnit, roundingMethod);
      return {
        id: preset.id,
        label: preset.label,
        description: preset.description,
        result: result,
      };
    });
  }

  global.EBAS = global.EBAS || {};
  global.EBAS.plans = {
    PLAN_PRESETS: PLAN_PRESETS,
    generateComparisonPlans: generateComparisonPlans,
  };
})(window);
