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

    /**
     * 現在のページが機能の実行対象か判定する。
     * @returns {boolean} 条件を満たす場合はtrue。
     */
    function isTargetPage() {
        // TODO: 対象URLやDOM条件を返す
        return true;
    }

    /**
     * 機能の表示に必要なスタイルをページへ追加する。
     * @returns {void} 戻り値はない。
     */
    function injectStyles() {
        // TODO: 必要なら ensureStyleElement('一意なID', `CSS`) で重複なく注入する
    }

    /**
     * 保存された設定を読み取り、機能内の状態へ反映する。
     * @returns {Promise<object>} 追加機能で使用する設定。必要な保存キーを実装時に定義する。
     */
    async function loadSettings() {
        // TODO: chrome.storage.sync / local から設定を読む
        return {};
    }

    /**
     * 設定と対象ページを確認し、機能の初期化を開始する。
     * @returns {Promise<void>} 処理の完了を待つPromise。
     */
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
