// Copyright (c) 2025 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 設定ページの初期化を行うエントリーポイント
 * @module main
 */

import { loadAndApplySettings, addEventListenersToSettings, saveSettings } from './modules/settings.js';
import { initializeUI } from './modules/ui.js';

/**
 * アプリケーションを初期化する。
 */
async function main() {
    // UIの初期化（DOMのキャッシュ、イベントリスナーの設定など）
    initializeUI();

    // 保存されている設定を読み込み、UIに適用する
    await loadAndApplySettings();

    // 各設定項目に変更があった場合に保存処理を紐付ける
    addEventListenersToSettings();
}

// 実行開始
main();


/**
 * ストレージの変更を監視し、UIにリアルタイムで反映させる。
 */
chrome.storage.onChanged.addListener((changes, area) => {
    // GASのWebhook URLが更新された場合の処理
    if (area === 'sync' && changes.gaswebhookurl) {
        const newUrl = changes.gaswebhookurl.newValue;
        if (newUrl) {
            const urlInput = document.getElementById('homework-webhook-url');
            const notificationCheckbox = document.getElementById('homework-notification');

            if (urlInput) {
                urlInput.value = newUrl;
            }
            if (notificationCheckbox && !notificationCheckbox.checked) {
                notificationCheckbox.checked = true;
                // UIの更新と設定の保存をトリガーする
                notificationCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    }
});
