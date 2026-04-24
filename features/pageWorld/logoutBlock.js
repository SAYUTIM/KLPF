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

    function hasSessionMonitor() {
        return typeof window.monitoringSessionExpiration?.resetTimer === 'function';
    }

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

    function clickContinueButtonIfVisible() {
        const continueButton = document.querySelector('#sessionExpirationAlertDialog .continueButton');
        if (continueButton instanceof HTMLElement) {
            continueButton.click();
            return true;
        }

        return false;
    }

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

    function startDialogWatcher() {
        if (dialogIntervalId) {
            return;
        }

        dialogIntervalId = window.setInterval(() => {
            clickContinueButtonIfVisible();
        }, SESSION_DIALOG_CHECK_INTERVAL_MS);
    }

    function initialize() {
        startKeepAlive();
        startDialogWatcher();
    }

    initialize();
})();
