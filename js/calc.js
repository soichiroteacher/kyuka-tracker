// 年度判定と残日数(残時間)の計算ロジック。

// 指定した日付が、年度開始月(startMonth)を基準にどの年度に属するかを返す。
function yearOfDate(dateStr, startMonth) {
  const d = new Date(dateStr + "T00:00:00");
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  if (startMonth === 1) return y;
  return m >= startMonth ? y : y - 1;
}

// 年度の表示ラベル(例: 開始月1月なら「2026年」、4月なら「2026年度」)
function yearLabel(year, startMonth) {
  return startMonth === 1 ? `${year}年` : `${year}年度`;
}

function recordsForType(data, typeId) {
  return data.records.filter(r => r.typeId === typeId);
}

function usedInYear(data, typeId, year) {
  const startMonth = data.settings.fiscalYearStartMonth;
  return recordsForType(data, typeId)
    .filter(r => yearOfDate(r.date, startMonth) === year)
    .reduce((sum, r) => sum + r.amount, 0);
}

function grantForYear(data, type, year) {
  const key = `${year}_${type.id}`;
  if (Object.prototype.hasOwnProperty.call(data.manualGrants, key)) {
    return data.manualGrants[key];
  }
  return type.annualGrant;
}

// 指定年度の付与量・繰越・使用量・残量を計算する。
// 繰越がある種別は、記録が存在する最も古い年度(なければ対象年度)まで遡って再帰的に計算する。
function computeBalance(data, type, year, _cache) {
  const cache = _cache || {};
  const cacheKey = `${type.id}_${year}`;
  if (cache[cacheKey]) return cache[cacheKey];

  const grant = grantForYear(data, type, year);
  const used = usedInYear(data, type.id, year);

  if (grant === null || grant === undefined) {
    const result = { granted: null, carryover: 0, used, remaining: null };
    cache[cacheKey] = result;
    return result;
  }

  let carryover = 0;
  if (type.carryoverMax) {
    const prevYear = year - 1;
    const earliestYear = earliestRelevantYear(data, type.id, year);
    if (prevYear >= earliestYear) {
      const prev = computeBalance(data, type, prevYear, cache);
      if (prev.remaining !== null) {
        carryover = Math.max(0, Math.min(prev.remaining, type.carryoverMax));
      }
    }
  }

  const remaining = grant + carryover - used;
  const result = { granted: grant, carryover, used, remaining };
  cache[cacheKey] = result;
  return result;
}

// 繰越計算の起点(無限に遡らないよう、記録の最古年度か対象年度の5年前の遅い方まで)
function earliestRelevantYear(data, typeId, targetYear) {
  const startMonth = data.settings.fiscalYearStartMonth;
  const years = recordsForType(data, typeId).map(r => yearOfDate(r.date, startMonth));
  const minRecordYear = years.length ? Math.min(...years) : targetYear;
  return Math.max(minRecordYear, targetYear - 5);
}

function formatAmount(amount, unit) {
  const rounded = Math.round(amount * 100) / 100;
  return unit === "hour" ? `${rounded}時間` : `${rounded}日`;
}

function unitLabel(unit) {
  return unit === "hour" ? "時間" : "日";
}
