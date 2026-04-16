// Copyright (c) 2024-2025 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file ku-port のポップアップで、枠外クリック時に閉じるボタンと同じ挙動を実行する。
 */

(function() {
    'use strict';

    const DIALOG_SELECTOR = '.ui-dialog[role="dialog"]';
    const OVERLAY_SELECTOR = '.ui-widget-overlay';
    const CLOSE_BUTTON_SELECTOR = '.ui-dialog-titlebar-close';

    function isVisible(element) {
        if (!element) return false;

        const style = window.getComputedStyle(element);
        return style.display !== 'none'
            && style.visibility !== 'hidden'
            && element.getClientRects().length > 0;
    }

    function getVisibleDialogs() {
        return safeQuerySelectorAll(DIALOG_SELECTOR).filter((dialog) => {
            if (!isVisible(dialog)) return false;
            if (dialog.getAttribute('aria-hidden') === 'true') return false;
            return true;
        });
    }

    function getTopmostDialog() {
        const dialogs = getVisibleDialogs();
        if (dialogs.length === 0) return null;

        return dialogs.reduce((topmost, current) => {
            const topmostZIndex = Number.parseInt(window.getComputedStyle(topmost).zIndex, 10) || 0;
            const currentZIndex = Number.parseInt(window.getComputedStyle(current).zIndex, 10) || 0;
            return currentZIndex >= topmostZIndex ? current : topmost;
        });
    }

    function closeTopmostDialog() {
        const dialog = getTopmostDialog();
        if (!dialog) return false;

        const closeButton = safeQuerySelector(CLOSE_BUTTON_SELECTOR, dialog);
        if (!closeButton || !isVisible(closeButton)) return false;

        closeButton.click();
        return true;
    }

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
