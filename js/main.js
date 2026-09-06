// アプリの初期化とイベント配線。

document.addEventListener("DOMContentLoaded", () => {
  appData = loadData();
  currentYear = currentYearFromToday();

  refreshAll();
  switchTab("dashboard");

  // タブ切り替え
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // 年度セレクタ
  document.getElementById("year-select").addEventListener("change", e => {
    currentYear = parseInt(e.target.value, 10);
    renderDashboard();
    renderRecordsTable();
  });

  // 記録の追加ボタン(ダッシュボード・記録一覧の両方)
  document.getElementById("btn-add-record").addEventListener("click", () => openRecordModal(null));
  document.getElementById("btn-add-record-2").addEventListener("click", () => openRecordModal(null));

  // 記録モーダル
  document.getElementById("record-cancel").addEventListener("click", closeRecordModal);
  document.getElementById("modal-overlay").addEventListener("click", e => {
    if (e.target.id === "modal-overlay") closeRecordModal();
  });
  document.getElementById("record-form").addEventListener("submit", handleRecordFormSubmit);

  // 記録一覧: フィルタと行アクション
  document.getElementById("filter-type").addEventListener("change", renderRecordsTable);
  document.querySelector("#records-table tbody").addEventListener("click", e => {
    const editBtn = e.target.closest(".btn-edit-record");
    const delBtn = e.target.closest(".btn-delete-record");
    if (editBtn) {
      const rec = appData.records.find(r => r.id === editBtn.dataset.id);
      if (rec) openRecordModal(rec);
    } else if (delBtn) {
      deleteRecord(delBtn.dataset.id);
    }
  });

  // 設定: 年度開始月
  document.getElementById("fiscal-start-month").addEventListener("change", e => {
    appData.settings.fiscalYearStartMonth = parseInt(e.target.value, 10);
    saveData(appData);
    currentYear = currentYearFromToday();
    refreshAll();
  });

  // 設定: 休暇種別テーブル
  document.querySelector("#types-table tbody").addEventListener("change", e => {
    if (e.target.closest(".btn-delete-type")) return;
    saveTypesFromTable();
  });
  document.querySelector("#types-table tbody").addEventListener("click", e => {
    const delBtn = e.target.closest(".btn-delete-type");
    if (delBtn) {
      const row = delBtn.closest("tr");
      deleteType(row.dataset.id);
    }
  });
  document.getElementById("btn-add-type").addEventListener("click", addNewType);

  // データ管理
  document.getElementById("btn-export").addEventListener("click", () => exportDataToFile(appData));
  document.getElementById("btn-import").addEventListener("click", () => {
    document.getElementById("import-file").click();
  });
  document.getElementById("import-file").addEventListener("change", e => {
    const file = e.target.files[0];
    if (file) handleImportFile(file);
    e.target.value = "";
  });
  document.getElementById("btn-reset").addEventListener("click", resetAllData);
});
