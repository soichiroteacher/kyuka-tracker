// 画面描画とイベント処理。

let appData = null;
let currentYear = null;
let editingRecordId = null;

function currentYearFromToday() {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  return yearOfDate(todayStr, appData.settings.fiscalYearStartMonth);
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
      ? `<div class="detail">付与上限なし(利用実績の記録用) / 今年度取得 ${formatAmount(balance.used)}</div>`
      : `<div class="detail">${grantHtml} / 今年度取得 ${formatAmount(balance.used)}</div>`;
    const barHtml = unlimited ? "" : `<div class="progress-bar"><div style="width:${barPct}%"></div></div>`;
    const cycleHtml = type.cycleStartMonth
      ? `<div class="detail cycle-note">サイクル: ${cycleRangeLabel(effectiveStartMonth(appData, type))}(個別設定)</div>`
      : "";
    return `
      <div class="leave-card ${stateClass}" style="--card-color:${type.color || "#2563eb"}">
        <h3>${escapeHtml(type.name)}</h3>
        ${remainingHtml}
        ${detailHtml}
        ${barHtml}
        ${cycleHtml}
      </div>`;
  }).join("");
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

function openRecordModal(record) {
  populateRecordTypeSelect();
  editingRecordId = record ? record.id : null;
  document.getElementById("record-modal-title").textContent = record ? "休暇記録を編集" : "休暇記録を追加";
  document.getElementById("record-id").value = record ? record.id : "";
  document.getElementById("record-date").value = record ? record.date : new Date().toISOString().slice(0, 10);
  document.getElementById("record-type").value = record ? record.typeId : (appData.leaveTypes[0] ? appData.leaveTypes[0].id : "");
  document.getElementById("record-amount").value = record ? record.amount : 1;
  document.getElementById("record-note").value = record ? (record.note || "") : "";
  document.getElementById("modal-overlay").classList.remove("hidden");
  document.getElementById("record-date").focus();
}

function closeRecordModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
  editingRecordId = null;
}

function handleRecordFormSubmit(e) {
  e.preventDefault();
  const date = document.getElementById("record-date").value;
  const typeId = document.getElementById("record-type").value;
  const amount = parseInt(document.getElementById("record-amount").value, 10);
  const note = document.getElementById("record-note").value.trim();

  if (!date || !typeId || isNaN(amount) || amount <= 0) return;

  if (editingRecordId) {
    const rec = appData.records.find(r => r.id === editingRecordId);
    if (rec) {
      rec.date = date;
      rec.typeId = typeId;
      rec.amount = amount;
      rec.note = note;
    }
  } else {
    appData.records.push({ id: uid(), date, typeId, amount, note, createdAt: Date.now() });
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
    const name = row.querySelector(".type-name").value.trim() || "(無題)";
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
  refreshAll();
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
      if (!confirm("現在のデータを、インポートするファイルの内容で上書きします。よろしいですか？")) return;
      appData = migrateLeaveData(parsed);
      saveData(appData);
      currentYear = currentYearFromToday();
      refreshAll();
      alert("インポートが完了しました。");
    } catch (e) {
      alert("ファイルの読み込みに失敗しました。正しいエクスポートファイルか確認してください。");
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

function refreshAll() {
  populateYearSelect();
  populateFilterType();
  renderDashboard();
  renderRecordsTable();
  renderTypesTable();
  populateFiscalMonthSelect();
}
