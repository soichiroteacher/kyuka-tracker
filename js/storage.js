// データの永続化(localStorage)と初期データを扱うモジュール。
// ブラウザだけで完結させるため、サーバーやビルド処理は使わない。

const STORAGE_KEY = "kyuka-tracker-data-v1";

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// 東京都教職員(地方公務員)向けの一般的な休暇制度を参考にした初期値。
// 実際の付与日数・時間数は所属の規程に合わせて「設定」タブから調整してください。
function defaultLeaveTypes() {
  return [
    { id: "nenkyu", name: "年次有給休暇(年休)", unit: "day", annualGrant: 20, carryoverMax: 20, color: "#2563eb" },
    { id: "byoki", name: "病気休暇", unit: "day", annualGrant: null, carryoverMax: null, color: "#dc2626" },
    { id: "kibiki", name: "忌引休暇", unit: "day", annualGrant: null, carryoverMax: null, color: "#4b5563" },
    { id: "kekkon", name: "結婚休暇", unit: "day", annualGrant: 5, carryoverMax: null, color: "#db2777" },
    { id: "shussan", name: "産前産後休暇", unit: "day", annualGrant: null, carryoverMax: null, color: "#ea580c" },
    { id: "ikuji-sanka", name: "育児参加休暇", unit: "day", annualGrant: 5, carryoverMax: null, color: "#0891b2" },
    { id: "kango", name: "子の看護休暇", unit: "hour", annualGrant: 40, carryoverMax: null, color: "#16a34a" },
    { id: "kaigo-tanki", name: "短期の介護休暇", unit: "hour", annualGrant: 40, carryoverMax: null, color: "#65a30d" },
    { id: "kaki", name: "夏季休暇", unit: "day", annualGrant: 5, carryoverMax: null, color: "#f59e0b" },
    { id: "volunteer", name: "ボランティア休暇", unit: "day", annualGrant: 5, carryoverMax: null, color: "#7c3aed" }
  ];
}

function defaultData() {
  return {
    version: 1,
    settings: { fiscalYearStartMonth: 1 },
    leaveTypes: defaultLeaveTypes(),
    manualGrants: {},
    records: []
  };
}

function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const data = defaultData();
    saveData(data);
    return data;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.settings) parsed.settings = { fiscalYearStartMonth: 1 };
    if (!Array.isArray(parsed.leaveTypes)) parsed.leaveTypes = defaultLeaveTypes();
    if (!parsed.manualGrants) parsed.manualGrants = {};
    if (!Array.isArray(parsed.records)) parsed.records = [];
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
  const today = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `kyuka-data-${today}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
