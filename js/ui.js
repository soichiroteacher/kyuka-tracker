// 画面描画とイベント処理。

let appData = null;
let currentYear = null;
let editingRecordId = null;

function currentYearFromToday() {
  return yearOfDate(localDateStr(), appData.settings.fiscalYearStartMonth);
}

function getAvailableYears() {
  const recordYears = appData.records.map(r => {
    const type = findType(r.typeId);
    const startMonth = type ? effectiveStartMonth(appData, type) : appData.settings.fiscalYearStartMonth;
    return yearOfDate(r.date, startMonth);
  });
  const thisYear = currentYearFromToday();
  const years = new Set([thisYear - 1, thisYear, thisYear + 1, ...recordYears]);
  return Array.from(years).sort((a, b) => b - a);
}

function findType(id) {
  return appData.leaveTypes.find(t => t.id === id);
}

// ---------- 年度セレクタ ----------

function populateYearSelect() {
  const sel = document.getElementById("year-select");
  const years = getAvailableYears();
  sel.innerHTML = years
    .map(y => `<option value="${y}">${yearLabel(y, appData.settings.fiscalYearStartMonth)}</option>`)
    .join("");
  if (!years.includes(currentYear)) currentYear = currentYearFromToday();
  sel.value = String(currentYear);
}

// ---------- タブ切り替え ----------

function switchTab(tab) {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  document.querySelectorAll(".tab-panel").forEach(panel => {
    panel.classList.toggle("active", panel.id === `tab-${tab}`);
  });
}

// ---------- ダッシュボード ----------

function renderDashboard() {
  const container = document.getElementById("dashboard-cards");
  if (appData.leaveTypes.length === 0) {
    container.innerHTML = `<p class="empty-msg">休暇種別が設定されていません。「設定」タブから追加してください。</p>`;
    return;
  }
  container.innerHTML = appData.leaveTypes.map(type => {
    const balance = computeBalance(appData, type, currentYear);
    const unlimited = balance.granted === null;
    let stateClass = "";
    let barPct = 100;
    if (!unlimited) {
      const total = balance.granted + balance.carryover;
      barPct = total > 0 ? Math.max(0, Math.min(100, (balance.remaining / total) * 100)) : 0;
      if (balance.remaining <= 0) stateClass = "empty";
      else if (total > 0 && balance.remaining / total <= 0.2) stateClass = "low";
    }
    const remainingHtml = unlimited
      ? `<div class="remaining">${formatAmount(balance.used)}<small> 取得</small></div>`
      : `<div class="remaining">${formatAmount(balance.remaining)}<small> 残り</small></div>`;
    const totalAvailable = unlimited ? 0 : balance.granted + balance.carryover;
    const grantHtml = balance.carryover > 0
      ? `付与 ${formatAmount(balance.granted)} + 繰越 ${formatAmount(balance.carryover)} = ${formatAmount(totalAvailable)}`
      : `付与 ${formatAmount(balance.granted)}`;
    const detailHtml = unlimited
      ? `<div class="detail">付与上限なし(利用実績の記録用)</div>`
      : `<div class="detail">${grantHtml} / 取得 ${formatAmount(balance.used)}</div>`;
    const barHtml = unlimited ? "" : `<div class="progress-bar"><div style="width:${barPct}%"></div></div>`;
    const cycleHtml = type.cycleStartMonth
      ? `<div class="detail cycle-note">サイクル: ${cycleRangeLabel(effectiveStartMonth(appData, type))}(個別設定)</div>`
      : "";

    // 手動調整の状態と、調整画面への入口(付与上限のある種別のみ)。
    let adjustNoteHtml = "";
    let adjustBtnHtml = "";
    if (!unlimited) {
      const adjusted = [balance.hasGrantOverride ? "付与" : null, balance.hasCarryoverOverride ? "繰越" : null].filter(Boolean);
      if (adjusted.length > 0) {
        adjustNoteHtml = `<div class="detail cycle-note">手動で調整済み(${adjusted.join("・")})</div>`;
      } else if (type.carryoverMax && balance.carryover === 0) {
        adjustNoteHtml = `<div class="detail cycle-note">繰越は未入力(0として計算中)</div>`;
      }
      adjustBtnHtml = `<button type="button" class="link-btn btn-adjust-balance" data-type-id="${escapeHtml(type.id)}">付与・繰越を調整</button>`;
    }
    return `
      <div class="leave-card ${stateClass}" style="--card-color:${type.color || "#2563eb"}">
        <h3>${escapeHtml(type.name)}</h3>
        ${remainingHtml}
        ${detailHtml}
        ${barHtml}
        ${cycleHtml}
        ${adjustNoteHtml}
        ${adjustBtnHtml}
      </div>`;
  }).join("");
}

// ---------- 付与・繰越の調整(年度ごと) ----------
// 使い始めが年の途中でも実際の残りに合わせられるよう、選択中の年度について
// 付与量・前年度からの繰越を手動で入力できる。空欄なら設定/自動計算どおり。

let editingBalanceTypeId = null;

function fillAmountFields(prefix, hours) {
  const split = hours === null ? null : splitAmount(hours);
  document.getElementById(`${prefix}-days`).value = split ? split.days : "";
  document.getElementById(`${prefix}-hours`).value = split ? split.hrs : "";
  document.getElementById(`${prefix}-mins`).value = split ? split.mins : "";
}

// 全て空欄なら null(=調整しない)、不正な値なら NaN、それ以外は時間数を返す。
function readAmountFields(prefix) {
  const raw = ["days", "hours", "mins"].map(s => document.getElementById(`${prefix}-${s}`).value.trim());
  if (raw.every(v => v === "")) return null;
  const [d, h, m] = raw.map(v => (v === "" ? 0 : Number(v)));
  if ([d, h, m].some(n => !Number.isInteger(n) || n < 0)) return NaN;
  return joinAmount(d, h, m);
}

function openBalanceModal(typeId) {
  const type = findType(typeId);
  if (!type) return;
  editingBalanceTypeId = typeId;

  const balance = computeBalance(appData, type, currentYear);
  const key = adjustmentKey(currentYear, typeId);
  const startMonth = effectiveStartMonth(appData, type);

  document.getElementById("balance-modal-title").textContent = `${type.name}の付与・繰越を調整`;
  document.getElementById("balance-modal-desc").textContent =
    `${yearLabel(currentYear, startMonth)}(${cycleRangeLabel(startMonth)})の分だけに適用されます。`;
  fillAmountFields("grant", hasOwn(appData.manualGrants, key) ? appData.manualGrants[key] : null);
  fillAmountFields("carry", hasOwn(appData.manualCarryovers, key) ? appData.manualCarryovers[key] : null);
  document.getElementById("grant-hint").textContent =
    `空欄なら設定どおり(${type.annualGrant === null ? "上限なし" : formatAmount(type.annualGrant)})。`;
  document.getElementById("carry-hint").textContent =
    `空欄なら前年度の残りから自動計算(現在の自動計算: ${formatAmount(balance.autoCarryover)})。0を入れると繰越なしになります。`;

  document.getElementById("balance-modal-overlay").classList.remove("hidden");
  document.getElementById("carry-days").focus();
}

function closeBalanceModal() {
  document.getElementById("balance-modal-overlay").classList.add("hidden");
  editingBalanceTypeId = null;
}

function handleBalanceFormSubmit(e) {
  e.preventDefault();
  if (!findType(editingBalanceTypeId)) return;
  const grant = readAmountFields("grant");
  const carry = readAmountFields("carry");
  if (Number.isNaN(grant) || Number.isNaN(carry)) {
    alert("0以上の整数で入力してください。");
    return;
  }
  const key = adjustmentKey(currentYear, editingBalanceTypeId);
  if (grant === null) delete appData.manualGrants[key]; else appData.manualGrants[key] = grant;
  if (carry === null) delete appData.manualCarryovers[key]; else appData.manualCarryovers[key] = carry;
  saveData(appData);
  closeBalanceModal();
  refreshAll();
}

function resetBalanceOverrides() {
  if (!findType(editingBalanceTypeId)) return;
  const key = adjustmentKey(currentYear, editingBalanceTypeId);
  delete appData.manualGrants[key];
  delete appData.manualCarryovers[key];
  saveData(appData);
  closeBalanceModal();
  refreshAll();
}

// ---------- 記録一覧 ----------

function populateFilterType() {
  const sel = document.getElementById("filter-type");
  const current = sel.value;
  sel.innerHTML = `<option value="">すべての種別</option>` +
    appData.leaveTypes.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");
  sel.value = current;
}

function renderRecordsTable() {
  const filterType = document.getElementById("filter-type").value;
  const tbody = document.querySelector("#records-table tbody");
  let records = appData.records.filter(r => {
    const type = findType(r.typeId);
    const startMonth = type ? effectiveStartMonth(appData, type) : appData.settings.fiscalYearStartMonth;
    return yearOfDate(r.date, startMonth) === currentYear;
  });
  if (filterType) records = records.filter(r => r.typeId === filterType);
  records = records.slice().sort((a, b) => b.date.localeCompare(a.date));

  document.getElementById("records-empty").classList.toggle("hidden", records.length > 0);

  tbody.innerHTML = records.map(r => {
    const type = findType(r.typeId);
    const typeName = type ? escapeHtml(type.name) : "(削除された種別)";
    return `
      <tr data-id="${r.id}">
        <td>${r.date}</td>
        <td>${typeName}</td>
        <td>${formatAmount(r.amount)}</td>
        <td class="note-cell">${escapeHtml(r.note || "")}</td>
        <td>
          <button class="icon-btn btn-edit-record" data-id="${r.id}" title="編集">✎</button>
          <button class="icon-btn btn-delete-record" data-id="${r.id}" title="削除">🗑</button>
        </td>
      </tr>`;
  }).join("");
}

// ---------- 記録の追加・編集モーダル ----------

function populateRecordTypeSelect() {
  const sel = document.getElementById("record-type");
  sel.innerHTML = appData.leaveTypes.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");
}

// 記録は内部的には常に時間数で保持する。入力時だけ「日」か「時間」を選べ、
// 「日」を選んだ場合は都の勤務時間(1日=7時間45分)で時間数に換算して保存する。
function updateRecordAmountUnitUI() {
  const unit = document.getElementById("record-unit").value;
  const amountInput = document.getElementById("record-amount");
  const label = document.getElementById("record-amount-unit-label");
  // 休暇は「〇日」か「〇時間」のどちらかで取る(半日という取り方はない。2026-09-27 ユーザー確認)。
  // そのため、日も時間も1単位刻みにする。
  if (unit === "day") {
    label.textContent = "日";
    amountInput.step = "1";
    amountInput.min = "1";
  } else {
    label.textContent = "時間";
    amountInput.step = "1";
    amountInput.min = "1";
  }
}

// 編集画面に表示する「入力時の単位と数量」を求める。
// 新しい記録は入力時の単位・数量(inputUnit / inputQuantity)を持つ。
// 古い記録には無いので、ちょうど整数日ぶんなら「日」、それ以外は「時間」として扱う。
function describeRecordInput(record) {
  if (record.inputUnit && typeof record.inputQuantity === "number") {
    return { unit: record.inputUnit, quantity: record.inputQuantity };
  }
  const days = record.amount / HOURS_PER_DAY;
  if (Number.isInteger(days)) return { unit: "day", quantity: days };
  return { unit: "hour", quantity: record.amount };
}

// 編集を開いた時点の入力値。画面上で何も変えずに保存した場合は、保存済みの時間数を
// 丸めずにそのまま残すために使う。
let editingOriginal = null;

function openRecordModal(record) {
  populateRecordTypeSelect();
  editingRecordId = record ? record.id : null;
  document.getElementById("record-modal-title").textContent = record ? "休暇記録を編集" : "休暇記録を追加";
  document.getElementById("record-id").value = record ? record.id : "";
  document.getElementById("record-date").value = record ? record.date : localDateStr();
  document.getElementById("record-type").value = record ? record.typeId : (appData.leaveTypes[0] ? appData.leaveTypes[0].id : "");

  // 新規追加時は「1日単位で取る」ケースが基本のため「日」をデフォルトにする。
  let unit = "day";
  let quantity = 1;
  editingOriginal = null;
  if (record) {
    const described = describeRecordInput(record);
    unit = described.unit;
    quantity = described.quantity;
    editingOriginal = { unit, quantity, amount: record.amount };
  }
  document.getElementById("record-unit").value = unit;
  updateRecordAmountUnitUI();
  const amountInput = document.getElementById("record-amount");
  amountInput.value = quantity;
  // 古いデータに刻みに合わない値(以前は入力できた0.5日など)が残っていても、開いただけで入力エラーにならないようにする。
  if (!Number.isInteger(quantity)) { amountInput.step = "any"; amountInput.min = "0"; }

  document.getElementById("record-note").value = record ? (record.note || "") : "";
  document.getElementById("modal-overlay").classList.remove("hidden");
  document.getElementById("record-date").focus();
}

function closeRecordModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
  editingRecordId = null;
  editingOriginal = null;
}

function handleRecordFormSubmit(e) {
  e.preventDefault();
  const date = document.getElementById("record-date").value;
  const typeId = document.getElementById("record-type").value;
  const unit = document.getElementById("record-unit").value;
  const rawAmount = parseFloat(document.getElementById("record-amount").value);
  const note = document.getElementById("record-note").value.trim();

  if (!date || !typeId || isNaN(rawAmount) || rawAmount <= 0) return;

  // 「日」も「時間」も1単位で取るので、整数に丸める。「日」は都の勤務時間(1日=7時間45分)で
  // 時間数に換算して保存する(7.75 は2進数で正確に表せるので、足し引きしても誤差が出ない)。
  let quantity = Math.round(rawAmount);
  let amount = unit === "day" ? quantity * HOURS_PER_DAY : quantity;

  // 単位も数量も変えていない編集(メモの修正など)では、保存済みの時間数を変えない。
  if (editingRecordId && editingOriginal && unit === editingOriginal.unit && rawAmount === editingOriginal.quantity) {
    quantity = editingOriginal.quantity;
    amount = editingOriginal.amount;
  }

  if (editingRecordId) {
    const rec = appData.records.find(r => r.id === editingRecordId);
    if (rec) {
      rec.date = date;
      rec.typeId = typeId;
      rec.amount = amount;
      rec.inputUnit = unit;
      rec.inputQuantity = quantity;
      rec.note = note;
    }
  } else {
    appData.records.push({ id: uid(), date, typeId, amount, inputUnit: unit, inputQuantity: quantity, note, createdAt: Date.now() });
  }
  saveData(appData);
  closeRecordModal();
  const type = findType(typeId);
  currentYear = yearOfDate(date, type ? effectiveStartMonth(appData, type) : appData.settings.fiscalYearStartMonth);
  refreshAll();
}

function deleteRecord(id) {
  if (!confirm("この記録を削除しますか？")) return;
  appData.records = appData.records.filter(r => r.id !== id);
  saveData(appData);
  refreshAll();
}

// ---------- 設定: 年度開始月 ----------

function populateFiscalMonthSelect() {
  const sel = document.getElementById("fiscal-start-month");
  sel.innerHTML = Array.from({ length: 12 }, (_, i) => i + 1)
    .map(m => `<option value="${m}">${m}月始まり</option>`).join("");
  sel.value = String(appData.settings.fiscalYearStartMonth);
}

// ---------- 設定: 休暇種別テーブル ----------

function cycleStartMonthOptions(selected) {
  const followOption = `<option value="" ${!selected ? "selected" : ""}>基本設定に従う</option>`;
  const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1)
    .map(m => `<option value="${m}" ${selected === m ? "selected" : ""}>${m}月始まり</option>`)
    .join("");
  return followOption + monthOptions;
}

function renderTypesTable() {
  const tbody = document.querySelector("#types-table tbody");
  tbody.innerHTML = appData.leaveTypes.map(t => `
    <tr class="types-table" data-id="${t.id}">
      <td><input type="text" class="type-name" value="${escapeHtml(t.name)}"></td>
      <td><input type="number" class="type-grant" step="0.25" min="0" placeholder="上限なし" value="${t.annualGrant ?? ""}"></td>
      <td><input type="number" class="type-carryover" step="0.25" min="0" placeholder="なし" value="${t.carryoverMax ?? ""}"></td>
      <td><select class="type-cycle">${cycleStartMonthOptions(t.cycleStartMonth || null)}</select></td>
      <td><input type="color" class="type-color" value="${t.color || "#2563eb"}"></td>
      <td><button class="icon-btn btn-delete-type" title="削除">🗑</button></td>
    </tr>
  `).join("");
}

function readTypesFromTable() {
  const rows = document.querySelectorAll("#types-table tbody tr");
  const types = [];
  rows.forEach(row => {
    const id = row.dataset.id;
    const nameInput = row.querySelector(".type-name");
    const name = nameInput.value.trim() || "(無題)";
    if (nameInput.value !== name) nameInput.value = name;
    const grantRaw = row.querySelector(".type-grant").value;
    const carryoverRaw = row.querySelector(".type-carryover").value;
    const cycleRaw = row.querySelector(".type-cycle").value;
    const color = row.querySelector(".type-color").value;
    types.push({
      id,
      name,
      annualGrant: grantRaw === "" ? null : parseFloat(grantRaw),
      carryoverMax: carryoverRaw === "" ? null : parseFloat(carryoverRaw),
      cycleStartMonth: cycleRaw === "" ? null : parseInt(cycleRaw, 10),
      color
    });
  });
  return types;
}

function saveTypesFromTable() {
  appData.leaveTypes = readTypesFromTable();
  saveData(appData);
  // 表そのものは再描画しない(再描画すると、次の入力欄へ移った直後にフォーカスが外れる)。
  refreshAll({ keepTypesTable: true });
}

function addNewType() {
  appData.leaveTypes.push({
    id: uid(),
    name: "新しい休暇種別",
    annualGrant: null,
    carryoverMax: null,
    cycleStartMonth: null,
    color: "#2563eb"
  });
  saveData(appData);
  renderTypesTable();
}

function deleteType(id) {
  const hasRecords = appData.records.some(r => r.typeId === id);
  if (hasRecords) {
    alert("この種別には記録が存在するため削除できません。先に該当する記録を削除するか、種別を編集してください。");
    return;
  }
  if (!confirm("この休暇種別を削除しますか？")) return;
  appData.leaveTypes = appData.leaveTypes.filter(t => t.id !== id);
  saveData(appData);
  refreshAll();
}

// ---------- データ管理 ----------

function handleImportFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.leaveTypes) || !Array.isArray(parsed.records)) {
        throw new Error("invalid format");
      }
      if (!confirm("今のデータを、選んだバックアップの内容で置き換えます。今のデータは元に戻せません。よろしいですか？")) return;
      appData = migrateLeaveData(parsed);
      saveData(appData);
      currentYear = currentYearFromToday();
      refreshAll();
      alert("バックアップから復元しました。");
    } catch (e) {
      alert("ファイルを読み込めませんでした。「データを書き出す(バックアップ)」で作ったファイル(休暇管理_バックアップ_日付.json)を選んでください。");
    }
  };
  reader.readAsText(file);
}

function resetAllData() {
  if (!confirm("すべてのデータを削除して初期状態に戻します。この操作は取り消せません。よろしいですか？")) return;
  appData = defaultData();
  saveData(appData);
  currentYear = currentYearFromToday();
  refreshAll();
}

// ---------- 共通ユーティリティ ----------

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

function refreshAll(options) {
  populateYearSelect();
  populateFilterType();
  renderDashboard();
  renderRecordsTable();
  if (!(options && options.keepTypesTable)) renderTypesTable();
  populateFiscalMonthSelect();
}
