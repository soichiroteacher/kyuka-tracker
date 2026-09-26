// 年度判定と残時間の計算ロジック。

// 東京都の1日の勤務時間(7時間45分)。休暇はすべて時間単位で記録するため、
// 「〇日」相当の付与量をこの係数で時間数に換算する。
const HOURS_PER_DAY = 7.75;

// ローカル(日本時間など、端末の時刻)基準の "YYYY-MM-DD"。
// toISOString() はUTC基準のため、日本時間の朝9時前だと前日の日付になってしまう。
function localDateStr(d) {
  const date = d || new Date();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mm}-${dd}`;
}

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

function hasOwn(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

// 年度ごとの手動調整(付与量・繰越)のキー。
function adjustmentKey(year, typeId) {
  return `${year}_${typeId}`;
}

// その年度の付与量。手動で調整されていればそれを優先し、なければ設定の年間付与量。
function grantForYear(data, type, year) {
  const key = adjustmentKey(year, type.id);
  if (hasOwn(data.manualGrants, key)) return data.manualGrants[key];
  return type.annualGrant;
}

// 指定年度の付与量・繰越・使用量・残量を計算する。
// 繰越は、手動で入力されていればそれを使い、なければ前年度の残りから自動計算する
// (自動計算は、記録・手動調整が存在する最も古い年度まで遡って再帰的に計算する)。
function computeBalance(data, type, year, _cache) {
  const cache = _cache || {};
  const cacheKey = `${type.id}_${year}`;
  if (cache[cacheKey]) return cache[cacheKey];

  const key = adjustmentKey(year, type.id);
  const grant = grantForYear(data, type, year);
  const used = usedInYear(data, type, year);

  if (grant === null || grant === undefined) {
    const result = { granted: null, carryover: 0, used, remaining: null };
    cache[cacheKey] = result;
    return result;
  }

  let autoCarryover = 0;
  if (type.carryoverMax) {
    const prevYear = year - 1;
    const earliestYear = earliestRelevantYear(data, type, year);
    if (prevYear >= earliestYear) {
      const prev = computeBalance(data, type, prevYear, cache);
      if (prev.remaining !== null) {
        autoCarryover = Math.max(0, Math.min(prev.remaining, type.carryoverMax));
      }
    }
  }

  const hasCarryoverOverride = hasOwn(data.manualCarryovers, key);
  const carryover = hasCarryoverOverride ? data.manualCarryovers[key] : autoCarryover;

  const remaining = grant + carryover - used;
  const result = {
    granted: grant,
    carryover,
    autoCarryover,
    hasGrantOverride: hasOwn(data.manualGrants, key),
    hasCarryoverOverride,
    used,
    remaining
  };
  cache[cacheKey] = result;
  return result;
}

// 繰越計算の起点(無限に遡らないよう、記録・手動調整の最古年度か対象年度の5年前の遅い方まで)
function earliestRelevantYear(data, type, targetYear) {
  const startMonth = effectiveStartMonth(data, type);
  const years = recordsForType(data, type.id).map(r => yearOfDate(r.date, startMonth));
  const suffix = `_${type.id}`;
  [data.manualGrants, data.manualCarryovers].forEach(map => {
    Object.keys(map || {}).forEach(key => {
      if (key.endsWith(suffix)) years.push(parseInt(key, 10));
    });
  });
  const minYear = years.length ? Math.min(...years) : targetYear;
  return Math.max(minYear, targetYear - 5);
}

// 時間数を「〇日〇時間〇分」形式で表示する。都の勤務時間(1日=7時間45分=465分)を
// 基準に日・時間・分へ分解するので、分数値になりがちな端数もきれいな分単位で表せる。
function splitAmount(hours) {
  const MINUTES_PER_DAY = HOURS_PER_DAY * 60;
  const negative = hours < 0;
  let totalMinutes = Math.round(Math.abs(hours) * 60);

  const days = Math.floor(totalMinutes / MINUTES_PER_DAY);
  totalMinutes -= days * MINUTES_PER_DAY;
  return { negative, days, hrs: Math.floor(totalMinutes / 60), mins: totalMinutes % 60 };
}

// 「〇日〇時間〇分」の入力値を時間数に戻す(splitAmount の逆)。
function joinAmount(days, hrs, mins) {
  return days * HOURS_PER_DAY + hrs + mins / 60;
}

function formatAmount(hours) {
  const { negative, days, hrs, mins } = splitAmount(hours);
  const parts = [];
  if (days > 0) parts.push(`${days}日`);
  if (hrs > 0) parts.push(`${hrs}時間`);
  if (mins > 0) parts.push(`${mins}分`);
  if (parts.length === 0) parts.push("0時間");

  return (negative ? "-" : "") + parts.join("");
}
