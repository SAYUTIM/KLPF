// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file LMSのページ関数を使ってセッションタイマーを延長する page world スクリプト
 */

(function() {
    'use strict';

    const KEEP_ALIVE_INTERVAL_MS = 20 * 60 * 1000;
    const FIRST_KEEP_ALIVE_DELAY_MS = 60 * 1000;
    const SESSION_DIALOG_CHECK_INTERVAL_MS = 30 * 1000;

    let keepAliveIntervalId = null;
    let dialogIntervalId = null;

    /**
     * ページのセッション監視機能が利用可能か判定する。
     * @returns {boolean} 条件を満たす場合はtrue。
     */
    function hasSessionMonitor() {
        return typeof window.monitoringSessionExpiration?.resetTimer === 'function';
    }

    /**
     * ページ側のセッション更新処理を呼び出す。
     * @returns {boolean} セッション更新処理を呼び出せた場合はtrue。
     */
    function keepSession() {
        if (!hasSessionMonitor()) {
            return false;
        }

        try {
            window.monitoringSessionExpiration.resetTimer();
            return true;
        } catch (error) {
            console.error('[KLPF] セッションタイマーの延長に失敗しました。', error);
            return false;
        }
    }

    /**
     * セッション継続ダイアログが表示された場合に継続ボタンを押す。
     * @returns {boolean} 継続ボタンを押した場合はtrue。
     */
    function clickContinueButtonIfVisible() {
        const continueButton = document.querySelector('#sessionExpirationAlertDialog .continueButton');
        if (continueButton instanceof HTMLElement) {
            continueButton.click();
            return true;
        }

        return false;
    }

    /**
     * セッションの定期更新を開始する。
     * @returns {void} 戻り値はない。
     */
    function startKeepAlive() {
        if (keepAliveIntervalId) {
            return;
        }

        window.setTimeout(() => {
            keepSession();
        }, FIRST_KEEP_ALIVE_DELAY_MS);

        keepAliveIntervalId = window.setInterval(() => {
            keepSession();
        }, KEEP_ALIVE_INTERVAL_MS);
    }

    /**
     * セッション継続ダイアログの出現を監視する。
     * @returns {void} 戻り値はない。
     */
    function startDialogWatcher() {
        if (dialogIntervalId) {
            return;
        }

        dialogIntervalId = window.setInterval(() => {
            clickContinueButtonIfVisible();
        }, SESSION_DIALOG_CHECK_INTERVAL_MS);
    }

    /**
     * 対象ページの要素と操作監視を初期化する。
     * @returns {void} 戻り値はない。
     */
    function initialize() {
        startKeepAlive();
        startDialogWatcher();
    }

    initialize();
})();
