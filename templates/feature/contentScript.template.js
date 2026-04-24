// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file [機能名] を実装する content script テンプレート
 *
 * 使い方:
 * 1. このファイルを features/[YourFeature].js にコピーする
 * 2. TODO を置換する
 * 3. scripts.config.js に登録する
 * 4. 必要なら setting/options.html と setting/modules/settings.js に設定UIを追加する
 */

(function() {
    'use strict';

    const FEATURE_NAME = 'KLPF';

    function isTargetPage() {
        // TODO: 対象URLやDOM条件を返す
        return true;
    }

    function injectStyles() {
        // TODO: 必要なら style を注入する
    }

    async function loadSettings() {
        // TODO: chrome.storage.sync / local から設定を読む
        return {};
    }

    async function main() {
        if (!isTargetPage()) return;

        // TODO: 必要なら待機対象を変更する
        await waitForElement('body', document, 5000);

        injectStyles();
        const settings = await loadSettings();
        void settings;

        // TODO: ここに機能本体を書く
    }

    const safeRun = () => main().catch(error => {
        console.error(`[${FEATURE_NAME}] TODO: 機能名 でエラーが発生しました。`, error);
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', safeRun, { once: true });
    } else {
        safeRun();
    }
})();
