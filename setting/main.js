// Copyright (c) 2025 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 設定ページの初期化を行うエントリーポイント
 * @module main
 * 設定画面のモジュールを読み込み、DOM初期化とストレージ変更後の再読み込みを結び付ける。
 */

import { loadAndApplySettings, addEventListenersToSettings, getSettingsStorageKeys } from './modules/settings.js';
import { initializeUI } from './modules/ui.js';
import { checkForUpdates } from './modules/updatecheck.js';
import { initializeBackupControls } from './modules/backup.js';

/**
 * アプリケーションを初期化する。
 */
async function main() {
    // UIの初期化（DOMのキャッシュ、イベントリスナーの設定など）
    initializeUI();
    displayManifestVersion();

    // 保存されている設定を読み込み、UIに適用する
    await loadAndApplySettings();

    // 各設定項目に変更があった場合に保存処理を紐付ける
    addEventListenersToSettings();

    // インポート/エクスポート機能を初期化する
    initializeBackupControls();

    // アップデートを確認する
    await checkForUpdates();
}

/**
 * 拡張機能のマニフェストに記載されたバージョンを設定画面へ表示する。
 * @returns {void} 戻り値はない。
 */
function displayManifestVersion() {
    const versionElement = document.getElementById('manifest-version');
    if (!versionElement) return;

    versionElement.textContent = `v${chrome.runtime.getManifest().version}`;
}

// 実行開始
main();


/**
 * ストレージの変更を監視し、UIにリアルタイムで反映させる。
 */
const settingsStorageKeys = getSettingsStorageKeys();
let settingsReloadTimer = null;

/**
 * ストレージ変更が設定画面の再読み込み対象か判定する。
 * @param {object} changes - ストレージキーごとの変更内容。
 * @param {string} area - 読み書きまたは変更通知のストレージ領域名。
 * @returns {boolean} 条件を満たす場合はtrue。
 */
function isSettingsChange(changes, area) {
    const targetKeys = settingsStorageKeys[area];
    if (!targetKeys) return false;
    return Object.keys(changes).some((key) => targetKeys.has(key));
}

/**
 * 連続したストレージ変更をまとめ、設定画面の再読み込みを予約する。
 * @returns {void} 戻り値はない。
 */
function scheduleSettingsReload() {
    if (settingsReloadTimer) {
        clearTimeout(settingsReloadTimer);
    }

    settingsReloadTimer = setTimeout(async () => {
        settingsReloadTimer = null;
        await loadAndApplySettings();
    }, 50);
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (isSettingsChange(changes, area)) {
        scheduleSettingsReload();
    }
});
