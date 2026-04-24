// Copyright (c) 2025 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 設定ページの初期化を行うエントリーポイント
 * @module main
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

function isSettingsChange(changes, area) {
    const targetKeys = settingsStorageKeys[area];
    if (!targetKeys) return false;
    return Object.keys(changes).some((key) => targetKeys.has(key));
}

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
