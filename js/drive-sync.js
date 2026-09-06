// Googleドライブ同期(任意機能)。
//
// アプリ本体(HTML/CSS/JS)はGitHubなど公開の場所に置く一方、休暇の記録データは
// 利用者自身のGoogleドライブに、このアプリが作成した1つのJSONファイルとしてのみ
// 保存する。使用スコープは drive.file(このアプリが作成・オープンしたファイルにしか
// アクセスできない最小権限)で、ドライブ内の他のファイルには一切触れない。
//
// クライアントIDを設定していない場合は何もしない(通常のローカル保存のみで動作する)。

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_FILE_NAME = "kyuka-tracker-data.json";
const DRIVE_FILE_ID_CACHE_KEY = "kyuka-tracker-drive-file-id";

let gisTokenClient = null;
let driveAccessToken = null;
let driveInitAttempted = false;

const driveState = {
  connected: false,
  syncing: false,
  lastSyncedAt: null,
  error: null
};

function persistLocalOnly(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function getDriveFileIdCache() {
  return localStorage.getItem(DRIVE_FILE_ID_CACHE_KEY);
}

function setDriveFileIdCache(id) {
  if (id) localStorage.setItem(DRIVE_FILE_ID_CACHE_KEY, id);
}

function updateDriveStatus(patch) {
  Object.assign(driveState, patch);
  if (typeof renderDriveStatus === "function") renderDriveStatus();
}

// ページ読み込み時、既にクライアントIDが設定されていれば自動で再接続を試みる
// (以前に同意済みかつGoogleのログインセッションが有効なら、無言でトークンを取得できる)。
function initDriveSync() {
  if (!appData.settings.googleClientId) return;
  if (typeof google === "undefined" || !google.accounts) {
    if (!driveInitAttempted) {
      driveInitAttempted = true;
      setTimeout(() => { driveInitAttempted = false; initDriveSync(); }, 500);
    }
    return;
  }
  gisTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: appData.settings.googleClientId,
    scope: DRIVE_SCOPE,
    callback: handleTokenResponse,
    error_callback: () => { /* サイレント再接続の失敗は無視し、手動サインインを待つ */ }
  });
  gisTokenClient.requestAccessToken({ prompt: "" });
}

// 「Googleドライブに接続」ボタンから呼ばれる、明示的なサインイン。
function connectGoogleDrive(clientId) {
  appData.settings.googleClientId = clientId;
  saveData(appData);
  updateDriveStatus({ error: null });

  if (typeof google === "undefined" || !google.accounts) {
    updateDriveStatus({ error: "Googleログイン機能を読み込み中です。数秒後にもう一度お試しください。" });
    return;
  }
  gisTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: DRIVE_SCOPE,
    callback: handleTokenResponse,
    error_callback: () => updateDriveStatus({ syncing: false, error: "Googleへのサインインに失敗しました。クライアントIDや許可済みオリジンの設定を確認してください。" })
  });
  gisTokenClient.requestAccessToken({ prompt: "consent" });
}

function handleTokenResponse(tokenResponse) {
  if (!tokenResponse || !tokenResponse.access_token) {
    updateDriveStatus({ error: "サインインに失敗しました。" });
    return;
  }
  driveAccessToken = tokenResponse.access_token;
  updateDriveStatus({ connected: true, error: null });
  syncFromDriveThenPush();
}

async function driveFetch(url, options) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options && options.headers),
      Authorization: `Bearer ${driveAccessToken}`
    }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Drive API error ${res.status}: ${text}`);
  }
  return res;
}

async function findDriveFile() {
  const cachedId = getDriveFileIdCache();
  if (cachedId) {
    try {
      const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${cachedId}?fields=id,trashed`);
      const file = await res.json();
      if (!file.trashed) return file.id;
    } catch (e) {
      // キャッシュが無効(削除済み等)な場合は名前で検索し直す
    }
  }
  const q = encodeURIComponent(`name='${DRIVE_FILE_NAME}' and trashed=false`);
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name)`);
  const data = await res.json();
  if (data.files && data.files.length > 0) {
    setDriveFileIdCache(data.files[0].id);
    return data.files[0].id;
  }
  return null;
}

async function createDriveFile(dataObj) {
  const boundary = "kyuka-boundary-" + Date.now();
  const metadata = { name: DRIVE_FILE_NAME, mimeType: "application/json" };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(dataObj)}\r\n` +
    `--${boundary}--`;
  const res = await driveFetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body }
  );
  const file = await res.json();
  setDriveFileIdCache(file.id);
  return file.id;
}

async function downloadDriveFile(fileId) {
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  return res.json();
}

async function uploadDriveFile(fileId, dataObj) {
  await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dataObj)
  });
}

// サインイン直後: ドライブ上に既存ファイルがあればそれを読み込んで採用し、
// なければ今のローカルデータをそのままドライブへ新規作成する。
async function syncFromDriveThenPush() {
  updateDriveStatus({ syncing: true, error: null });
  try {
    const fileId = await findDriveFile();
    if (fileId) {
      const remote = migrateLeaveData(await downloadDriveFile(fileId));
      appData = remote;
      persistLocalOnly(appData);
      if (typeof refreshAll === "function") refreshAll();
    } else {
      await createDriveFile(appData);
    }
    updateDriveStatus({ syncing: false, connected: true, lastSyncedAt: Date.now(), error: null });
  } catch (e) {
    console.error(e);
    updateDriveStatus({ syncing: false, error: "Googleドライブとの同期に失敗しました。" });
  }
}

async function pushToDrive() {
  if (!driveState.connected || !driveAccessToken) return;
  updateDriveStatus({ syncing: true });
  try {
    const fileId = await findDriveFile();
    if (!fileId) {
      await createDriveFile(appData);
    } else {
      await uploadDriveFile(fileId, appData);
    }
    updateDriveStatus({ syncing: false, lastSyncedAt: Date.now(), error: null });
  } catch (e) {
    console.error(e);
    updateDriveStatus({ syncing: false, error: "Googleドライブへの保存に失敗しました。" });
  }
}

// データが変更されるたび(storage.jsのsaveDataから)呼ばれるフック。
// 短時間の連続変更をまとめるため少し待ってから同期する。
let pushDebounceTimer = null;
function onDataSaved() {
  if (!driveState.connected) return;
  clearTimeout(pushDebounceTimer);
  pushDebounceTimer = setTimeout(pushToDrive, 1500);
}

function disconnectGoogleDrive() {
  if (driveAccessToken && typeof google !== "undefined" && google.accounts && google.accounts.oauth2) {
    google.accounts.oauth2.revoke(driveAccessToken, () => {});
  }
  driveAccessToken = null;
  updateDriveStatus({ connected: false, lastSyncedAt: null, error: null });
}

function manualDriveSync() {
  if (!driveState.connected) {
    updateDriveStatus({ error: "先にGoogleドライブへ接続してください。" });
    return;
  }
  pushToDrive();
}
