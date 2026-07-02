/*
 * EBAS ui.js
 * DOM操作・イベント配線。計算そのものは calc.js / plans.js に委譲する。
 */
(function (global, document) {
  'use strict';

  var calc = global.EBAS.calc;
  var plansModule = global.EBAS.plans;

  var STORAGE_KEY = 'ebas_state_v1';

  var state = {
    totalBill: 0,
    categoryGenderCounts: {
      drink: { male: 0, female: 0 },
      no_drink: { male: 0, female: 0 },
      partial: { male: 0, female: 0 },
      no_charge: 0,
    },
    partialParticipation: {
      drink: { male: false, female: false },
      no_drink: { male: false, female: false },
    },
    partialCounts: {
      drink: { male: 0, female: 0 },
      no_drink: { male: 0, female: 0 },
    },
    genderMode: calc.GENDER_MODE.DISCOUNT,
    modeConfigs: {
      discount: shallowCopy(calc.DEFAULT_DISCOUNT_CONFIG),
      fixed_weight: shallowCopy(calc.DEFAULT_FIXED_GENDER_WEIGHT),
      matrix: deepCopyMatrix(calc.DEFAULT_CATEGORY_GENDER_MATRIX),
    },
    roundingUnit: calc.DEFAULT_ROUNDING_UNIT,
    customRoundingUnit: 500,
    roundingMethod: calc.DEFAULT_ROUNDING_METHOD,
  };

  function shallowCopy(obj) {
    var copy = {};
    for (var key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        copy[key] = obj[key];
      }
    }
    return copy;
  }

  function deepCopyMatrix(matrixConfig) {
    var weights = {};
    for (var category in matrixConfig.weights) {
      if (Object.prototype.hasOwnProperty.call(matrixConfig.weights, category)) {
        weights[category] = shallowCopy(matrixConfig.weights[category]);
      }
    }
    return { weights: weights };
  }

  function normalizeCategoryGenderCounts(counts) {
    var normalized = {
      drink: {
        male: (counts.drink && counts.drink.male) || 0,
        female: (counts.drink && counts.drink.female) || 0,
      },
      no_drink: {
        male: (counts.no_drink && counts.no_drink.male) || 0,
        female: (counts.no_drink && counts.no_drink.female) || 0,
      },
      partial: {
        male: (counts.partial && counts.partial.male) || 0,
        female: (counts.partial && counts.partial.female) || 0,
      },
      no_charge: counts.no_charge || counts.absent || 0,
    };
    return normalized;
  }

  function normalizePartialParticipation(flags) {
    flags = flags || {};
    return {
      drink: {
        male: Boolean(flags.drink && flags.drink.male),
        female: Boolean(flags.drink && flags.drink.female),
      },
      no_drink: {
        male: Boolean(flags.no_drink && flags.no_drink.male),
        female: Boolean(flags.no_drink && flags.no_drink.female),
      },
    };
  }

  function normalizePartialCounts(counts) {
    counts = counts || {};
    return {
      drink: {
        male: (counts.drink && counts.drink.male) || 0,
        female: (counts.drink && counts.drink.female) || 0,
      },
      no_drink: {
        male: (counts.no_drink && counts.no_drink.male) || 0,
        female: (counts.no_drink && counts.no_drink.female) || 0,
      },
    };
  }

  // ---- localStorage 永続化 ----

  function persistState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // localStorage が使えない環境でもアプリは動作を継続する
    }
  }

  function loadPersistedState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return;
      if (typeof saved.totalBill === 'number') state.totalBill = saved.totalBill;
      if (saved.categoryGenderCounts) state.categoryGenderCounts = normalizeCategoryGenderCounts(saved.categoryGenderCounts);
      if (saved.partialParticipation) state.partialParticipation = normalizePartialParticipation(saved.partialParticipation);
      if (saved.partialCounts) state.partialCounts = normalizePartialCounts(saved.partialCounts);
      if (saved.genderMode) state.genderMode = saved.genderMode;
      if (saved.modeConfigs) state.modeConfigs = saved.modeConfigs;
      if (saved.roundingUnit) state.roundingUnit = saved.roundingUnit;
      if (saved.customRoundingUnit) state.customRoundingUnit = saved.customRoundingUnit;
      if (saved.roundingMethod) state.roundingMethod = saved.roundingMethod;
    } catch (e) {
      // 保存データが壊れている場合はデフォルト状態のまま続行する
    }
  }

  // ---- フォームへの初期値反映（保存状態の復元用） ----

  function syncFormFromState() {
    document.getElementById('input-total-bill').value = state.totalBill;

    document.querySelectorAll('.count-row').forEach(function (row) {
      var category = row.dataset.category;
      var gender = row.dataset.gender;
      var display = row.querySelector('[data-role="count-display"]');
      var isPartialRow = row.dataset.partial === 'true';
      var value = isPartialRow ? state.partialCounts[category][gender] : (gender ? state.categoryGenderCounts[category][gender] : state.categoryGenderCounts[category]);
      var partialToggle = row.querySelector('[data-role="partial-toggle"]');
      display.textContent = value;
      if (partialToggle) partialToggle.checked = Boolean(state.partialParticipation[category][gender]);
      if (isPartialRow) row.hidden = !state.partialParticipation[category][gender];
    });

    document.querySelector('input[name="gender-mode"][value="' + state.genderMode + '"]').checked = true;
    ['discount', 'fixed_weight', 'matrix'].forEach(function (mode) {
      document.getElementById('mode-config-' + mode).hidden = mode !== state.genderMode;
    });

    document.getElementById('discount-gender').value = state.modeConfigs.discount.discountedGender;
    document.getElementById('discount-rate').value = Math.round(state.modeConfigs.discount.discountRate * 100);
    document.getElementById('fixed-weight-male').value = state.modeConfigs.fixed_weight.maleWeight;
    document.getElementById('fixed-weight-female').value = state.modeConfigs.fixed_weight.femaleWeight;
    document.querySelectorAll('.matrix-weight').forEach(function (input) {
      var category = input.dataset.category;
      var gender = input.dataset.gender;
      input.value = state.modeConfigs.matrix.weights[category][gender];
    });

    updateRoundingUnitOptions();
    syncRoundingUnitControls();
    document.getElementById('select-rounding-method').value = state.roundingMethod;
  }

  // ---- イベントハンドラ ----

  function handleCountChange(category, gender, delta, displayEl, isPartialRow) {
    var newValue;
    if (isPartialRow) {
      var partialCurrent = state.partialCounts[category][gender];
      newValue = Math.max(0, partialCurrent + delta);
      state.partialCounts[category][gender] = newValue;
    } else if (gender) {
      var current = state.categoryGenderCounts[category][gender];
      newValue = Math.max(0, current + delta);
      state.categoryGenderCounts[category][gender] = newValue;
    } else {
      newValue = Math.max(0, state.categoryGenderCounts[category] + delta);
      state.categoryGenderCounts[category] = newValue;
    }
    displayEl.textContent = newValue;
    render();
  }

  function resetParticipantCounts() {
    state.categoryGenderCounts = normalizeCategoryGenderCounts({});
    state.partialCounts = normalizePartialCounts({});
    syncFormFromState();
    render();
  }

  function handleGenderModeChange(newMode) {
    state.genderMode = newMode;
    ['discount', 'fixed_weight', 'matrix'].forEach(function (mode) {
      document.getElementById('mode-config-' + mode).hidden = mode !== newMode;
    });
    render();
  }

  function getDynamicRoundingUnits(totalBill) {
    var maxUnit = 1;
    if (totalBill >= 1000) {
      maxUnit = 100;
    } else if (totalBill >= 100) {
      maxUnit = 10;
    }
    return [1, 10, 100].filter(function (unit) {
      return unit <= maxUnit;
    });
  }

  function updateRoundingUnitOptions() {
    var select = document.getElementById('select-rounding-unit');
    var units = getDynamicRoundingUnits(state.totalBill);
    Array.prototype.forEach.call(select.options, function (option) {
      if (option.value === 'custom') return;
      option.hidden = units.indexOf(Number(option.value)) === -1;
    });
    if (state.roundingUnit !== 'custom' && units.indexOf(Number(state.roundingUnit)) === -1) {
      state.roundingUnit = units[units.length - 1];
    }
  }

  function syncRoundingUnitControls() {
    var select = document.getElementById('select-rounding-unit');
    var customInput = document.getElementById('input-custom-rounding-unit');
    select.value = state.roundingUnit === 'custom' ? 'custom' : String(state.roundingUnit);
    customInput.hidden = state.roundingUnit !== 'custom';
    customInput.value = state.customRoundingUnit;
  }

  function getActiveRoundingUnit() {
    return state.roundingUnit === 'custom' ? Math.max(1, Number(state.customRoundingUnit) || 1) : Number(state.roundingUnit);
  }

  function buildCalculationCounts() {
    var calculationCounts = normalizeCategoryGenderCounts(state.categoryGenderCounts);
    calculationCounts.partialDetails = [];
    ['drink', 'no_drink'].forEach(function (category) {
      ['male', 'female'].forEach(function (gender) {
        if (!state.partialParticipation[category][gender]) return;
        var count = state.partialCounts[category][gender] || 0;
        if (count <= 0) return;
        calculationCounts.partialDetails.push({ category: category, gender: gender, count: count });
      });
    });
    return calculationCounts;
  }

  function openCommanderConfirmDialog(onDecision) {
    var dialog = document.getElementById('commander-confirm-dialog');
    if (!dialog || typeof dialog.showModal !== 'function') {
      onDecision(window.confirm('手動指定の端数処理単位を使用します。司令に確認しましたか？'));
      return;
    }

    function handleClose() {
      dialog.removeEventListener('close', handleClose);
      onDecision(dialog.returnValue === 'yes');
    }

    dialog.addEventListener('close', handleClose);
    dialog.showModal();
  }

  function wireEvents() {
    document.getElementById('input-total-bill').addEventListener('input', function (e) {
      state.totalBill = Number(e.target.value) || 0;
      updateRoundingUnitOptions();
      syncRoundingUnitControls();
      render();
    });

    document.querySelectorAll('.count-row').forEach(function (row) {
      var category = row.dataset.category;
      var gender = row.dataset.gender || null;
      var displayEl = row.querySelector('[data-role="count-display"]');
      var isPartialRow = row.dataset.partial === 'true';
      row.querySelector('.btn-decrement').addEventListener('click', function () {
        handleCountChange(category, gender, -1, displayEl, isPartialRow);
      });
      row.querySelector('.btn-increment').addEventListener('click', function () {
        handleCountChange(category, gender, 1, displayEl, isPartialRow);
      });
      var partialToggle = row.querySelector('[data-role="partial-toggle"]');
      if (partialToggle) {
        partialToggle.addEventListener('change', function (e) {
          state.partialParticipation[category][gender] = e.target.checked;
          document.querySelectorAll('.count-row--partial[data-category="' + category + '"][data-gender="' + gender + '"]').forEach(function (partialRow) {
            partialRow.hidden = !e.target.checked;
          });
          render();
        });
      }
    });

    document.getElementById('button-reset-counts').addEventListener('click', resetParticipantCounts);

    document.querySelectorAll('input[name="gender-mode"]').forEach(function (radio) {
      radio.addEventListener('change', function (e) {
        if (e.target.checked) handleGenderModeChange(e.target.value);
      });
    });

    document.getElementById('discount-gender').addEventListener('change', function (e) {
      state.modeConfigs.discount.discountedGender = e.target.value;
      render();
    });
    document.getElementById('discount-rate').addEventListener('input', function (e) {
      state.modeConfigs.discount.discountRate = (Number(e.target.value) || 0) / 100;
      render();
    });
    document.getElementById('fixed-weight-male').addEventListener('input', function (e) {
      state.modeConfigs.fixed_weight.maleWeight = Number(e.target.value) || 0;
      render();
    });
    document.getElementById('fixed-weight-female').addEventListener('input', function (e) {
      state.modeConfigs.fixed_weight.femaleWeight = Number(e.target.value) || 0;
      render();
    });
    document.querySelectorAll('.matrix-weight').forEach(function (input) {
      input.addEventListener('input', function (e) {
        var category = e.target.dataset.category;
        var gender = e.target.dataset.gender;
        state.modeConfigs.matrix.weights[category][gender] = Number(e.target.value) || 0;
        render();
      });
    });

    document.getElementById('select-rounding-unit').addEventListener('change', function (e) {
      if (e.target.value === 'custom') {
        openCommanderConfirmDialog(function (approved) {
          if (approved) {
            state.roundingUnit = 'custom';
          }
          syncRoundingUnitControls();
          render();
        });
        syncRoundingUnitControls();
        return;
      }
      state.roundingUnit = Number(e.target.value);
      syncRoundingUnitControls();
      render();
    });
    document.getElementById('input-custom-rounding-unit').addEventListener('input', function (e) {
      state.customRoundingUnit = Math.max(1, Number(e.target.value) || 1);
      render();
    });
    document.getElementById('select-rounding-method').addEventListener('change', function (e) {
      state.roundingMethod = e.target.value;
      render();
    });
  }

  // ---- 描画 ----

  function formatYen(amount) {
    return Math.round(amount).toLocaleString('ja-JP') + '円';
  }

  function buildResultTable(title, splitResult) {
    var wrapper = document.createElement('div');
    wrapper.className = 'result-block';

    var heading = document.createElement('h4');
    heading.textContent = title;
    wrapper.appendChild(heading);

    if (!splitResult.ok) {
      var errorMsg = document.createElement('p');
      errorMsg.className = 'result-error';
      errorMsg.textContent = '参加人数を入力してください（負担できる人数がいません）。';
      wrapper.appendChild(errorMsg);
      return wrapper;
    }

    var table = document.createElement('table');
    table.className = 'result-table';
    var thead = document.createElement('thead');
    thead.innerHTML = '<tr><th scope="col">区分</th><th scope="col">人数</th><th scope="col">1人あたり</th><th scope="col">小計</th></tr>';
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    splitResult.groups.forEach(function (g) {
      if (g.count === 0) return;
      var row = document.createElement('tr');
      row.innerHTML =
        '<td>' + g.label + '</td>' +
        '<td>' + g.count + '人</td>' +
        '<td>' + formatYen(g.roundedPerPerson) + '</td>' +
        '<td>' + formatYen(g.subtotal) + '</td>';
      tbody.appendChild(row);
    });
    table.appendChild(tbody);

    var tfoot = document.createElement('tfoot');
    var totalRow = document.createElement('tr');
    totalRow.innerHTML = '<td colspan="3">合計（検算）</td><td>' + formatYen(splitResult.roundedTotal) + '</td>';
    tfoot.appendChild(totalRow);
    table.appendChild(tfoot);

    wrapper.appendChild(table);

    var adjustedGroups = splitResult.groups.filter(function (g) {
      return (Number(g.adjustment) || 0) !== 0;
    });
    adjustedGroups.forEach(function (adjustedGroup) {
      var adjustment = Number(adjustedGroup.adjustment) || 0;
      var sign = adjustment >= 0 ? '+' : '';
      var note = document.createElement('p');
      note.className = 'result-note';
      note.textContent = '端数調整: ' + sign + Math.round(adjustment).toLocaleString('ja-JP') + '円 → 「' + adjustedGroup.label + '」グループの合計に反映';
      wrapper.appendChild(note);
    });

    var verify = document.createElement('p');
    verify.className = 'result-verify';
    verify.textContent = '過不足: ' + formatYen(splitResult.discrepancy) + '（0円であれば全体会計と一致）';
    wrapper.appendChild(verify);

    return wrapper;
  }

  function render() {
    updateRoundingUnitOptions();
    var activeRoundingUnit = getActiveRoundingUnit();
    var calculationCounts = buildCalculationCounts();
    var groups = calc.resolveGroups(state.genderMode, calculationCounts, state.modeConfigs[state.genderMode]);
    var currentResult = calc.calculateSplit(groups, state.totalBill, activeRoundingUnit, state.roundingMethod);

    var currentContainer = document.getElementById('results-current');
    currentContainer.innerHTML = '';
    currentContainer.appendChild(buildResultTable('現在の設定', currentResult));

    var plans = plansModule.generateComparisonPlans(calculationCounts, state.totalBill, activeRoundingUnit, state.roundingMethod);
    var plansContainer = document.getElementById('results-plans');
    plansContainer.innerHTML = '';
    plans.forEach(function (plan) {
      plansContainer.appendChild(buildResultTable(plan.label, plan.result));
    });

    persistState();
  }

  // ---- 自己チェック（?selfcheck 指定時のみ実行、通常のページロードでは動かない） ----

  function runSelfChecks() {
    var results = [];
    function assertEqual(name, actual, expected) {
      var pass = actual === expected;
      results.push({ name: name, pass: pass, actual: actual, expected: expected });
      console.assert(pass, name, { actual: actual, expected: expected });
    }

    // 均等割・端数なし
    var evenGroups = [{ id: 'a', label: 'A', count: 3, weight: 1 }];
    var evenResult = calc.calculateSplit(evenGroups, 3000, 100, 'up');
    assertEqual('even split discrepancy', evenResult.discrepancy, 0);

    // 割り切れないケース
    var unevenGroups = [
      { id: 'a', label: 'A', count: 3, weight: 1 },
      { id: 'b', label: 'B', count: 2, weight: 0.5 },
    ];
    var unevenResult = calc.calculateSplit(unevenGroups, 10000, 100, 'up');
    assertEqual('uneven split discrepancy', unevenResult.discrepancy, 0);
    assertEqual('uneven split reconciled to highest weight group', unevenResult.reconciledGroupId, 'a');

    // 重み合計0
    var zeroResult = calc.calculateSplit([{ id: 'a', label: 'A', count: 0, weight: 0 }], 1000, 100, 'up');
    assertEqual('zero weight sum returns error', zeroResult.ok, false);
    assertEqual('zero weight sum error code', zeroResult.error, 'ZERO_WEIGHT_SUM');

    // roundAmount パターン
    assertEqual('round up 100', calc.roundAmount(1234, 100, 'up'), 1300);
    assertEqual('round down 100', calc.roundAmount(1234, 100, 'down'), 1200);
    assertEqual('round nearest 100', calc.roundAmount(1250, 100, 'nearest'), 1300);
    assertEqual('round up 1', calc.roundAmount(1234, 1, 'up'), 1234);
    assertEqual('round down 10', calc.roundAmount(1234, 10, 'down'), 1230);

    // 比較プリセットは常に検算が一致する
    var counts = {
      drink: { male: 3, female: 2 },
      no_drink: { male: 1, female: 1 },
      partial: { male: 1, female: 0 },
      no_charge: 1,
    };
    var plans = plansModule.generateComparisonPlans(counts, 50000, 100, 'up');
    plans.forEach(function (plan) {
      assertEqual('plan ' + plan.id + ' discrepancy', plan.result.ok ? plan.result.discrepancy : 0, 0);
    });

    var failed = results.filter(function (r) { return !r.pass; });
    console.log('EBAS selfcheck: ' + (results.length - failed.length) + '/' + results.length + ' passed');
    if (failed.length > 0) {
      console.error('EBAS selfcheck failures:', failed);
    }
  }

  function initUI() {
    loadPersistedState();
    syncFormFromState();
    wireEvents();
    render();

    if (new URLSearchParams(location.search).has('selfcheck')) {
      runSelfChecks();
    }
  }

  document.addEventListener('DOMContentLoaded', initUI);
})(window, document);
