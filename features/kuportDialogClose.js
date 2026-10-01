// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file ku-port のポップアップで、枠外クリック時に閉じるボタンと同じ挙動を実行する。
 * 表示状態と重なり順をDOMから確認し、背景クリックを既存の閉じるボタン操作へ変換する。
 */

(function() {
    'use strict';

    const DIALOG_SELECTOR = '.ui-dialog[role="dialog"]';
    const OVERLAY_SELECTOR = '.ui-widget-overlay';
    const CLOSE_BUTTON_SELECTOR = '.ui-dialog-titlebar-close';

    /**
     * 要素が画面上で表示されているか判定する。
     * @param {Element} element - 操作または読み取りの対象要素。
     * @returns {boolean} 条件を満たす場合はtrue。
     */
    function isVisible(element) {
        if (!element) return false;

        const style = window.getComputedStyle(element);
        return style.display !== 'none'
            && style.visibility !== 'hidden'
            && element.getClientRects().length > 0;
    }

    /**
     * 表示中のKu-Portダイアログを列挙する。
     * @returns {Element[]} 表示中のダイアログ。
     */
    function getVisibleDialogs() {
        return safeQuerySelectorAll(DIALOG_SELECTOR).filter((dialog) => {
            if (!isVisible(dialog)) return false;
            if (dialog.getAttribute('aria-hidden') === 'true') return false;
            return true;
        });
    }

    /**
     * 表示中のダイアログから最前面のものを選ぶ。
     * @returns {Element|null} 最前面のダイアログ。表示中のものがなければnull。
     */
    function getTopmostDialog() {
        const dialogs = getVisibleDialogs();
        if (dialogs.length === 0) return null;

        return dialogs.reduce((topmost, current) => {
            const topmostZIndex = Number.parseInt(window.getComputedStyle(topmost).zIndex, 10) || 0;
            const currentZIndex = Number.parseInt(window.getComputedStyle(current).zIndex, 10) || 0;
            return currentZIndex >= topmostZIndex ? current : topmost;
        });
    }

    /**
     * 最前面のKu-Portダイアログの閉じるボタンを押す。
     * @returns {boolean} 閉じる操作を実行した場合はtrue。
     */
    function closeTopmostDialog() {
        const dialog = getTopmostDialog();
        if (!dialog) return false;

        const closeButton = safeQuerySelector(CLOSE_BUTTON_SELECTOR, dialog);
        if (!closeButton || !isVisible(closeButton)) return false;

        closeButton.click();
        return true;
    }

    /**
     * ダイアログ外のクリックを検知し、最前面のダイアログを閉じる。
     * @param {Event} event - 操作または通知のイベント。
     * @returns {void} 戻り値はない。
     */
    function handleOverlayClick(event) {
        const overlay = event.target.closest(OVERLAY_SELECTOR);
        if (!overlay || !isVisible(overlay)) return;

        if (!closeTopmostDialog()) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }

    document.addEventListener('click', handleOverlayClick, true);
})();
