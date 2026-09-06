// 年度判定と残時間の計算ロジック。

// 東京都の1日の勤務時間(7時間45分)。休暇はすべて時間単位で記録するため、
// 「〇日」相当の付与量をこの係数で時間数に換算する。
const HOURS_PER_DAY = 7.75;

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

// 種別ごとの実際の年度開始月。種別に cycleStartMonth が設定されていればそれを優先し、
// なければ「基本設定」の年度開始月に従う(看護休暇など、所属先の年度設定と別に
// 暦年で切り替わる休暇に個別対応するため)。
function effectiveStartMonth(data, type) {
  if (type.cycleStartMonth) return type.cycleStartMonth;
  return data.settings.fiscalYearStartMonth;
}

// 開始月に応じたサイクルの期間表示(例: 1月なら「1月~12月」、4月なら「4月~翌3月」)
function cycleRangeLabel(startMonth) {
  if (startMonth === 1) return "1月~12月";
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  return `${startMonth}月~翌${endMonth}月`;
}

function recordsForType(data, typeId) {
  return data.records.filter(r => r.typeId === typeId);
}

function usedInYear(data, type, year) {
  const startMonth = effectiveStartMonth(data, type);
  return recordsForType(data, type.id)
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
  const used = usedInYear(data, type, year);

  if (grant === null || grant === undefined) {
    const result = { granted: null, carryover: 0, used, remaining: null };
    cache[cacheKey] = result;
    return result;
  }

  let carryover = 0;
  if (type.carryoverMax) {
    const prevYear = year - 1;
    const earliestYear = earliestRelevantYear(data, type, year);
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
function earliestRelevantYear(data, type, targetYear) {
  const startMonth = effectiveStartMonth(data, type);
  const years = recordsForType(data, type.id).map(r => yearOfDate(r.date, startMonth));
  const minRecordYear = years.length ? Math.min(...years) : targetYear;
  return Math.max(minRecordYear, targetYear - 5);
}

function formatAmount(hours) {
  const rounded = Math.round(hours * 100) / 100;
  return `${rounded}時間`;
}

// 時間数を日換算した目安の表示(例: 155時間 → 約20.0日相当)
function formatAsDaysHint(hours) {
  const days = Math.round((hours / HOURS_PER_DAY) * 10) / 10;
  return `約${days}日相当`;
}
