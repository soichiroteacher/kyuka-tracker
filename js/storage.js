// データの永続化(localStorage)と初期データを扱うモジュール。
// ブラウザだけで完結させるため、サーバーやビルド処理は使わない。

// ブラウザの保存領域でのデータの名前。アプリ名(フォルダ名 leave-manager)にそろえている。
const STORAGE_KEY = "leave-manager-data-v1";
// 2026-09-27 より前の名前(GitHubのリポジトリ名が kyuka-tracker だったころ)。
// 新しい名前のデータがまだ無いときだけ、ここから写して使う(loadData)。
// 写したあとも古い名前のデータは消さずに残す(万一のときの控え。消しても動作には影響しない)。
const OLD_STORAGE_KEY = "kyuka-tracker-data-v1";

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// 東京都教職員(地方公務員)向けの一般的な休暇制度を参考にした初期値。
// 実際の付与時間数は所属の規程に合わせて「設定」タブから調整してください。
//
// すべての休暇は1時間単位で取得できるものとし、時間数で一元管理する。
// 都の勤務時間(1日=7時間45分 = HOURS_PER_DAY)を基準に、
// 「〇日」相当の付与量はあらかじめ時間数に換算して設定している。
//
// cycleStartMonth: この種別が年度切り替えに使う開始月(1〜12)。
// null の場合は「基本設定」の年度開始月に従う。子の看護休暇・短期の介護休暇は
// 所属先の年度設定に関わらず暦年(1月始まり)で切り替わることが多いため固定している。
function defaultLeaveTypes() {
  return [
    { id: "nenkyu", name: "年次有給休暇(年休)", annualGrant: 20 * HOURS_PER_DAY, carryoverMax: 20 * HOURS_PER_DAY, color: "#2563eb", cycleStartMonth: null },
    { id: "byoki", name: "病気休暇", annualGrant: null, carryoverMax: null, color: "#dc2626", cycleStartMonth: null },
    { id: "kibiki", name: "忌引休暇", annualGrant: null, carryoverMax: null, color: "#4b5563", cycleStartMonth: null },
    { id: "kekkon", name: "結婚休暇", annualGrant: 5 * HOURS_PER_DAY, carryoverMax: null, color: "#db2777", cycleStartMonth: null },
    { id: "shussan", name: "産前産後休暇", annualGrant: null, carryoverMax: null, color: "#ea580c", cycleStartMonth: null },
    { id: "ikuji-sanka", name: "育児参加休暇", annualGrant: 5 * HOURS_PER_DAY, carryoverMax: null, color: "#0891b2", cycleStartMonth: null },
    { id: "kango", name: "子の看護休暇", annualGrant: 40, carryoverMax: null, color: "#16a34a", cycleStartMonth: 1 },
    { id: "kaigo-tanki", name: "短期の介護休暇", annualGrant: 40, carryoverMax: null, color: "#65a30d", cycleStartMonth: 1 },
    { id: "kaki", name: "夏季休暇", annualGrant: 5 * HOURS_PER_DAY, carryoverMax: null, color: "#f59e0b", cycleStartMonth: null },
    { id: "volunteer", name: "ボランティア休暇", annualGrant: 5 * HOURS_PER_DAY, carryoverMax: null, color: "#7c3aed", cycleStartMonth: null }
  ];
}

function defaultData() {
  return {
    version: 1,
    settings: { fiscalYearStartMonth: 1 },
    leaveTypes: defaultLeaveTypes(),
    manualGrants: {},
    manualCarryovers: {},
    records: []
  };
}

// 旧バージョン(種別ごとに「日」単位/「時間」単位が混在)からの移行。
// 「日」単位だった種別は、都の勤務時間(1日=7時間45分)を基準にすべて時間数へ換算し、
// 過去の記録・繰越上限・年度別の手動付与量も同じ係数で換算する。
function migrateLeaveData(parsed) {
  if (!parsed.settings) parsed.settings = { fiscalYearStartMonth: 1 };
  if (!Array.isArray(parsed.leaveTypes)) parsed.leaveTypes = defaultLeaveTypes();
  if (!parsed.manualGrants) parsed.manualGrants = {};
  if (!parsed.manualCarryovers) parsed.manualCarryovers = {};
  if (!Array.isArray(parsed.records)) parsed.records = [];

  const toHours = v => Math.round(v * HOURS_PER_DAY * 100) / 100;
  const dayTypeIds = new Set(parsed.leaveTypes.filter(t => t.unit === "day").map(t => t.id));

  parsed.leaveTypes.forEach(t => {
    if (!("cycleStartMonth" in t)) t.cycleStartMonth = null;
    if (dayTypeIds.has(t.id)) {
      if (t.annualGrant !== null && t.annualGrant !== undefined) t.annualGrant = toHours(t.annualGrant);
      if (t.carryoverMax !== null && t.carryoverMax !== undefined) t.carryoverMax = toHours(t.carryoverMax);
    }
    delete t.unit;
  });

  Object.keys(parsed.manualGrants).forEach(key => {
    const typeId = key.slice(key.indexOf("_") + 1);
    if (dayTypeIds.has(typeId)) parsed.manualGrants[key] = toHours(parsed.manualGrants[key]);
  });

  parsed.records.forEach(r => {
    if (dayTypeIds.has(r.typeId)) r.amount = toHours(r.amount);
  });

  return parsed;
}

function loadData() {
  // 以前の名前で保存されたデータしか無ければ、新しい名前に写してから読み込む。
  if (localStorage.getItem(STORAGE_KEY) === null) {
    const old = localStorage.getItem(OLD_STORAGE_KEY);
    if (old !== null) localStorage.setItem(STORAGE_KEY, old);
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const data = defaultData();
    saveData(data);
    return data;
  }
  try {
    const parsed = migrateLeaveData(JSON.parse(raw));
    return parsed;
  } catch (e) {
    console.error("保存データの読み込みに失敗しました。初期データを使用します。", e);
    const data = defaultData();
    saveData(data);
    return data;
  }
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function exportDataToFile(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  // 共通ルールに合わせ「アプリ名_バックアップ_日付.json」にする(以前は kyuka-data-日付.json。どちらも読み込める)
  a.download = `休暇管理_バックアップ_${localDateStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
