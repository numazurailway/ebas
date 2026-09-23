/*
 * EBAS calc.js
 * 重み → 金額の計算ロジック。DOM には一切触れない純粋関数のみで構成する。
 */
(function (global) {
  'use strict';

  // ---- カテゴリ定数 ----
  var CATEGORY = {
    DRINK: 'drink',
    NO_DRINK: 'no_drink',
    PARTIAL: 'partial',
    NO_CHARGE: 'no_charge',
  };

  var CATEGORY_LABELS = {
    drink: 'アルコールあり',
    no_drink: 'アルコールなし',
    partial: '途中参加',
    no_charge: '無賃扱い',
  };

  var CATEGORY_ORDER = [CATEGORY.DRINK, CATEGORY.NO_DRINK, CATEGORY.PARTIAL, CATEGORY.NO_CHARGE];

  // カテゴリごとの基本重み（性別調整前）
  var BASE_CATEGORY_WEIGHT = {
    drink: 1.0,
    no_drink: 0.8,
    partial: 0.5,
    no_charge: 0.0,
  };

  var GENDER_LABELS = { male: '男性', female: '女性' };

  // ---- 性別調整方式 ----
  var GENDER_MODE = {
    DISCOUNT: 'discount',
    FIXED_WEIGHT: 'fixed_weight',
    MATRIX: 'matrix',
  };

  var DEFAULT_DISCOUNT_CONFIG = { discountedGender: 'female', discountRate: 0.2 };
  var DEFAULT_FIXED_GENDER_WEIGHT = { maleWeight: 1.0, femaleWeight: 0.7 };
  var DEFAULT_CATEGORY_GENDER_MATRIX = {
    weights: {
      drink: { male: 1.0, female: 0.8 },
      no_drink: { male: 0.8, female: 0.6 },
      partial: { male: 0.5, female: 0.4 },
    },
  };

  // ---- 端数処理定数 ----
  var ROUNDING_UNIT = { YEN_1: 1, YEN_10: 10, YEN_100: 100, YEN_500: 500, YEN_1000: 1000, YEN_5000: 5000, YEN_10000: 10000 };
  var ROUNDING_METHOD = { UP: 'up', DOWN: 'down', NEAREST: 'nearest' };
  var DEFAULT_ROUNDING_UNIT = ROUNDING_UNIT.YEN_10;
  var DEFAULT_ROUNDING_METHOD = ROUNDING_METHOD.NEAREST;


  /**
   * 精算対象金額と負担対象人数から表示可能な端数処理単位を返す。
   * 金額単体では精算対象金額の1/10以下となる一般的な円単位を候補にし、
   * 負担対象人数がいる場合は1人あたりの金額が粗くなりすぎないよう上限を抑える。
   * @param {number} totalBill
   * @param {number} [payerCount]
   * @returns {Array<number>}
   */
  function getDynamicRoundingUnits(totalBill, payerCount) {
    var availableUnits = [1, 10, 100, 500, 1000, 5000, 10000];
    var bill = Math.max(0, Number(totalBill) || 0);
    var maxAmount = bill / 10;
    var count = Math.max(0, Number(payerCount) || 0);
    if (count > 0) {
      maxAmount = Math.min(maxAmount, bill / (count * 8));
    }

    return availableUnits.filter(function (unit) {
      return unit <= Math.max(1, maxAmount);
    });
  }

  /**
   * 指定した単位・方式で金額を丸める。
   * @param {number} amount
   * @param {number} unit
   * @param {string} method
   * @returns {number}
   */
  function roundAmount(amount, unit, method) {
    var scaled = amount / unit;
    var roundedScaled;
    switch (method) {
      case ROUNDING_METHOD.UP:
        roundedScaled = Math.ceil(scaled);
        break;
      case ROUNDING_METHOD.DOWN:
        roundedScaled = Math.floor(scaled);
        break;
      case ROUNDING_METHOD.NEAREST:
        roundedScaled = Math.round(scaled);
        break;
      default:
        throw new Error('Unknown rounding method: ' + method);
    }
    return roundedScaled * unit;
  }

  // ---- 性別調整方式ごとのリゾルバ（すべて DOM 非依存の純粋関数） ----

  /**
   * drink/no_drink/partial の3カテゴリ×2性別を、性別ごとの重み倍率から生成する共通ヘルパー。
   * @param {Object} categoryGenderCounts
   * @param {{male:number, female:number}} genderMultiplier
   * @returns {Array<{id:string, label:string, count:number, weight:number}>}
   */
  function buildPartialLabel(detail) {
    return CATEGORY_LABELS.partial + '（' + CATEGORY_LABELS[detail.category] + '）・' + GENDER_LABELS[detail.gender];
  }

  function getPartialDetails(categoryGenderCounts) {
    return Array.isArray(categoryGenderCounts.partialDetails) ? categoryGenderCounts.partialDetails : [];
  }

  function buildCategoryGenderGroups(categoryGenderCounts, genderMultiplier) {
    var groups = [];
    var categories = [CATEGORY.DRINK, CATEGORY.NO_DRINK, CATEGORY.PARTIAL];
    var genders = ['male', 'female'];
    for (var i = 0; i < categories.length; i++) {
      var category = categories[i];
      var baseWeight = BASE_CATEGORY_WEIGHT[category];
      for (var j = 0; j < genders.length; j++) {
        var gender = genders[j];
        var counts = categoryGenderCounts[category] || { male: 0, female: 0 };
        groups.push({
          id: category + '_' + gender,
          label: CATEGORY_LABELS[category] + '・' + GENDER_LABELS[gender],
          count: counts[gender] || 0,
          weight: baseWeight * genderMultiplier[gender],
        });
      }
    }

    getPartialDetails(categoryGenderCounts).forEach(function (detail, index) {
      groups.push({
        id: 'partial_' + detail.category + '_' + detail.gender + '_' + index,
        label: buildPartialLabel(detail),
        count: detail.count || 0,
        weight: BASE_CATEGORY_WEIGHT.partial * genderMultiplier[detail.gender],
      });
    });
    return groups;
  }

  function buildNoChargeGroup(categoryGenderCounts) {
    return {
      id: CATEGORY.NO_CHARGE,
      label: CATEGORY_LABELS.no_charge,
      count: categoryGenderCounts.no_charge || 0,
      weight: 0,
    };
  }

  /**
   * 方式A：割引率。指定した性別だけ (1 - discountRate) を掛ける。
   */
  function resolveGroupsModeA(categoryGenderCounts, discountConfig) {
    var cfg = discountConfig || DEFAULT_DISCOUNT_CONFIG;
    var multiplier = { male: 1, female: 1 };
    multiplier[cfg.discountedGender] = 1 - cfg.discountRate;
    var groups = buildCategoryGenderGroups(categoryGenderCounts, multiplier);
    groups.push(buildNoChargeGroup(categoryGenderCounts));
    return groups;
  }

  /**
   * 方式B：性別固定重み。性別ごとの重みをカテゴリ基本重みに掛け合わせる。
   */
  function resolveGroupsModeB(categoryGenderCounts, fixedWeightConfig) {
    var cfg = fixedWeightConfig || DEFAULT_FIXED_GENDER_WEIGHT;
    var multiplier = { male: cfg.maleWeight, female: cfg.femaleWeight };
    var groups = buildCategoryGenderGroups(categoryGenderCounts, multiplier);
    groups.push(buildNoChargeGroup(categoryGenderCounts));
    return groups;
  }

  /**
   * 方式C：カテゴリ×性別の直接重み行列。カテゴリ基本重みは使わない。
   */
  function resolveGroupsModeC(categoryGenderCounts, matrixConfig) {
    var cfg = matrixConfig || DEFAULT_CATEGORY_GENDER_MATRIX;
    var groups = [];
    var categories = [CATEGORY.DRINK, CATEGORY.NO_DRINK, CATEGORY.PARTIAL];
    var genders = ['male', 'female'];
    for (var i = 0; i < categories.length; i++) {
      var category = categories[i];
      var counts = categoryGenderCounts[category] || { male: 0, female: 0 };
      var cellWeights = cfg.weights[category];
      for (var j = 0; j < genders.length; j++) {
        var gender = genders[j];
        groups.push({
          id: category + '_' + gender,
          label: CATEGORY_LABELS[category] + '・' + GENDER_LABELS[gender],
          count: counts[gender] || 0,
          weight: cellWeights[gender],
        });
      }
    }
    getPartialDetails(categoryGenderCounts).forEach(function (detail, index) {
      groups.push({
        id: 'partial_' + detail.category + '_' + detail.gender + '_' + index,
        label: buildPartialLabel(detail),
        count: detail.count || 0,
        weight: cfg.weights.partial[detail.gender],
      });
    });
    groups.push(buildNoChargeGroup(categoryGenderCounts));
    return groups;
  }

  /**
   * 性別調整方式に応じてリゾルバを呼び分ける。ui.js は常にこれ経由で呼ぶ。
   */
  function resolveGroups(mode, categoryGenderCounts, modeConfig) {
    switch (mode) {
      case GENDER_MODE.DISCOUNT:
        return resolveGroupsModeA(categoryGenderCounts, modeConfig);
      case GENDER_MODE.FIXED_WEIGHT:
        return resolveGroupsModeB(categoryGenderCounts, modeConfig);
      case GENDER_MODE.MATRIX:
        return resolveGroupsModeC(categoryGenderCounts, modeConfig);
      default:
        throw new Error('Unknown gender mode: ' + mode);
    }
  }

  /**
   * 参加人数がいるグループを重みの大きい順（同点は元の並び順）に並べ、
   * 1人ずつの「席」の配列にする。端数の配分先を決めるのに使う。
   * @param {Array} groupResults
   * @returns {Array<{group:Object, memberIndex:number}>}
   */
  function buildWeightOrderedSeats(groupResults) {
    var eligible = groupResults.filter(function (g) {
      return g.count > 0;
    });
    var sorted = eligible.slice().sort(function (a, b) {
      return b.weight - a.weight;
    });
    var seats = [];
    sorted.forEach(function (g) {
      for (var i = 0; i < g.count; i++) {
        seats.push({ group: g, memberIndex: i });
      }
    });
    return seats;
  }

  /**
   * 席の配列を先頭（pointer）から順に見て、負の金額にならない席へ amount を加算する。
   * @returns {boolean} 加算できた場合 true
   */
  function applySeatAdjustment(seats, pointer, amount) {
    for (var tries = 0; tries < seats.length; tries++) {
      var index = pointer.value % seats.length;
      pointer.value += 1;
      var seat = seats[index];
      var current = seat.group.memberAmounts[seat.memberIndex];
      var next = current + amount;
      if (next >= 0) {
        seat.group.memberAmounts[seat.memberIndex] = next;
        return true;
      }
    }
    return false;
  }

  /**
   * 端数処理後に生じた差額を、重みの大きいグループの参加者から1人ずつ「単位」刻みで配分する。
   * 差額が単位で割り切れない端数は、最後の1人にそのまま反映する。
   * @param {Array} groupResults
   * @param {number} diff
   * @param {number} unit
   */
  function distributeDiffAmongMembers(groupResults, diff, unit) {
    var seats = buildWeightOrderedSeats(groupResults);
    if (seats.length === 0) {
      return;
    }

    var absDiff = Math.abs(diff);
    var unitStep = diff < 0 ? -unit : unit;
    var stepsNeeded = Math.floor(absDiff / unit);
    var remainder = diff - stepsNeeded * unitStep;

    var pointer = { value: 0 };
    for (var s = 0; s < stepsNeeded; s++) {
      if (!applySeatAdjustment(seats, pointer, unitStep)) {
        break;
      }
    }
    if (remainder !== 0) {
      applySeatAdjustment(seats, pointer, remainder);
    }
  }

  /**
   * 1人あたり金額の配列を、金額ごとに「何人がいくら払うか」の内訳にまとめる。
   * @param {Array<number>} memberAmounts
   * @returns {Array<{amount:number, count:number}>} 金額の高い順
   */
  function summarizeMemberAmounts(memberAmounts) {
    var counts = {};
    var order = [];
    memberAmounts.forEach(function (amount) {
      var key = String(amount);
      if (!(key in counts)) {
        counts[key] = 0;
        order.push(amount);
      }
      counts[key] += 1;
    });
    return order
      .sort(function (a, b) {
        return b - a;
      })
      .map(function (amount) {
        return { amount: amount, count: counts[String(amount)] };
      });
  }

  /**
   * 正規化済みグループと全体会計から、各グループの1人あたり金額・小計を計算する。
   * 端数処理後に生じた差額は、参加人数がいるグループの中で重みが大きい方から
   * 参加者1人ずつに「単位」刻みで配分する（同点の場合は CATEGORY_ORDER 順で先に現れた方から）。
   * これにより「1人あたり×人数」の合計が常に小計と一致する
   * （1グループ内で金額が複数種類になる場合は groups[].perPersonAmounts に内訳を持つ）。
   *
   * @param {Array<{id, label, count, weight}>} groups
   * @param {number} totalBill
   * @param {number} [roundingUnit]
   * @param {string} [roundingMethod]
   * @returns {{ok:boolean, error?:string, groups?:Array, unitPrice?:number, totalBill?:number, roundedTotal?:number, discrepancy?:number, reconciledGroupIds?:Array<string>, reconciledGroupId?:string|null}}
   */
  function calculateSplit(groups, totalBill, roundingUnit, roundingMethod) {
    var unit = roundingUnit || DEFAULT_ROUNDING_UNIT;
    var method = roundingMethod || DEFAULT_ROUNDING_METHOD;

    var weightedSum = 0;
    for (var i = 0; i < groups.length; i++) {
      weightedSum += groups[i].count * groups[i].weight;
    }

    if (!(weightedSum > 0)) {
      return { ok: false, error: 'ZERO_WEIGHT_SUM' };
    }

    var unitPrice = totalBill / weightedSum;

    var groupResults = groups.map(function (g) {
      var rawPerPerson = unitPrice * g.weight;
      var roundedPerPerson = g.count > 0 ? roundAmount(rawPerPerson, unit, method) : 0;
      return {
        id: g.id,
        label: g.label,
        count: g.count,
        weight: g.weight,
        rawPerPerson: rawPerPerson,
        roundedPerPerson: roundedPerPerson,
        memberAmounts: g.count > 0 ? new Array(g.count).fill(roundedPerPerson) : [],
        subtotal: roundedPerPerson * g.count,
        adjustment: 0,
        perPersonAmounts: [],
      };
    });

    var roundedTotalBeforeReconcile = groupResults.reduce(function (sum, g) {
      return sum + g.subtotal;
    }, 0);
    var diff = totalBill - roundedTotalBeforeReconcile;

    if (diff !== 0) {
      distributeDiffAmongMembers(groupResults, diff, unit);
    }

    var reconciledGroupIds = [];
    buildWeightOrderedSeats(groupResults)
      .map(function (seat) { return seat.group; })
      .filter(function (g, index, arr) { return arr.indexOf(g) === index; })
      .forEach(function (g) {
        var newSubtotal = g.memberAmounts.reduce(function (sum, amount) {
          return sum + amount;
        }, 0);
        g.adjustment = newSubtotal - g.roundedPerPerson * g.count;
        g.subtotal = newSubtotal;
        g.perPersonAmounts = summarizeMemberAmounts(g.memberAmounts);
        if (g.adjustment !== 0) {
          reconciledGroupIds.push(g.id);
        }
      });

    var roundedTotal = groupResults.reduce(function (sum, g) {
      return sum + g.subtotal;
    }, 0);

    return {
      ok: true,
      groups: groupResults,
      unitPrice: unitPrice,
      totalBill: totalBill,
      roundedTotal: roundedTotal,
      discrepancy: roundedTotal - totalBill,
      reconciledGroupIds: reconciledGroupIds,
      reconciledGroupId: reconciledGroupIds.length > 0 ? reconciledGroupIds[0] : null,
    };
  }

  global.EBAS = global.EBAS || {};
  global.EBAS.calc = {
    CATEGORY: CATEGORY,
    CATEGORY_LABELS: CATEGORY_LABELS,
    CATEGORY_ORDER: CATEGORY_ORDER,
    BASE_CATEGORY_WEIGHT: BASE_CATEGORY_WEIGHT,
    GENDER_LABELS: GENDER_LABELS,
    GENDER_MODE: GENDER_MODE,
    DEFAULT_DISCOUNT_CONFIG: DEFAULT_DISCOUNT_CONFIG,
    DEFAULT_FIXED_GENDER_WEIGHT: DEFAULT_FIXED_GENDER_WEIGHT,
    DEFAULT_CATEGORY_GENDER_MATRIX: DEFAULT_CATEGORY_GENDER_MATRIX,
    ROUNDING_UNIT: ROUNDING_UNIT,
    ROUNDING_METHOD: ROUNDING_METHOD,
    DEFAULT_ROUNDING_UNIT: DEFAULT_ROUNDING_UNIT,
    DEFAULT_ROUNDING_METHOD: DEFAULT_ROUNDING_METHOD,
    getDynamicRoundingUnits: getDynamicRoundingUnits,
    roundAmount: roundAmount,
    resolveGroupsModeA: resolveGroupsModeA,
    resolveGroupsModeB: resolveGroupsModeB,
    resolveGroupsModeC: resolveGroupsModeC,
    resolveGroups: resolveGroups,
    calculateSplit: calculateSplit,
  };
})(window);
