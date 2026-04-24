// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file ホーム出席表示の page world 側ブリッジ
 */

(function() {
    'use strict';

    const OPEN_POPUP_EVENT_NAME = 'klpf-home-attendance-open-popup';
    const BACKDROP_SELECTORS = [
        '#block',
        '.ui-widget-overlay',
        '.ui-dialog-mask',
        '.ui-overlay-mask',
        '.blockUI',
        '.modalBlock',
    ].join(', ');

    let popupObserver = null;

    function isPopupVisible(detail) {
        const frameContainer = document.querySelector(detail.iframeSelector);
        return !!frameContainer && frameContainer.style.display !== 'none';
    }

    function disconnectPopupObserver() {
        if (!popupObserver) {
            return;
        }

        popupObserver.disconnect();
        popupObserver = null;
    }

    function cleanupBlockingBackdrops() {
        const candidates = document.querySelectorAll(BACKDROP_SELECTORS);
        candidates.forEach((element) => {
            element.style.display = 'none';
            element.style.visibility = 'hidden';
            element.style.opacity = '0';
            element.style.pointerEvents = 'none';
        });

        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
        document.documentElement.style.pointerEvents = '';
        document.body.style.pointerEvents = '';
    }

    function cleanupBlockingBackdropsRepeatedly() {
        cleanupBlockingBackdrops();
        window.setTimeout(cleanupBlockingBackdrops, 0);
        window.setTimeout(cleanupBlockingBackdrops, 50);
        window.setTimeout(cleanupBlockingBackdrops, 150);
    }

    function syncPopupClosedState(detail) {
        if (isPopupVisible(detail)) {
            return;
        }

        cleanupBlockingBackdropsRepeatedly();
        disconnectPopupObserver();
    }

    function watchPopupLifecycle(detail) {
        disconnectPopupObserver();

        const frameContainer = document.querySelector(detail.iframeSelector);
        if (!frameContainer) {
            return;
        }

        popupObserver = new MutationObserver(() => syncPopupClosedState(detail));
        popupObserver.observe(frameContainer, {
            attributes: true,
            attributeFilter: ['style', 'class'],
        });
    }

    function closeAttendancePopup(detail) {
        const frameContainer = document.querySelector(detail.iframeSelector);
        const form = document.querySelector(detail.formSelector);
        const frame = document.getElementById(detail.iframeId);

        disconnectPopupObserver();

        if (typeof closeIframe === 'function') {
            try {
                closeIframe();
                cleanupBlockingBackdropsRepeatedly();
                return;
            } catch (error) {
                console.error('[KLPF] closeIframe の呼び出しに失敗しました。', error);
            }
        }

        if (frameContainer) {
            frameContainer.style.display = 'none';
        }
        if (frame) {
            frame.removeAttribute('src');
            frame.src = 'about:blank';
        }
        if (form) {
            form.reset();
        }
        cleanupBlockingBackdropsRepeatedly();
    }

    function installPostprocess(detail) {
        window.Postprocess = function() {
            closeAttendancePopup(detail);
        };
    }

    function ensureAttendancePopupElements(detail) {
        let frameContainer = document.querySelector(detail.iframeSelector);
        let frame = document.getElementById(detail.iframeId);
        let form = document.querySelector(detail.formSelector);

        if (frameContainer && frame && form) {
            return { frameContainer, frame, form };
        }

        frameContainer = document.createElement('div');
        frameContainer.id = detail.iframeSelector.replace('#', '');
        frameContainer.className = 'cs_iframe ui-draggable';

        const head = document.createElement('div');
        head.className = 'ifrVoxHead ui-draggable-handle';

        const headerImage = document.createElement('img');
        headerImage.src = '/lms/img/cs/blank.gif';
        headerImage.width = 100;
        headerImage.height = 30;
        headerImage.style.width = '100%';
        head.appendChild(headerImage);

        frame = document.createElement('iframe');
        frame.name = detail.targetName;
        frame.id = detail.iframeId;
        frame.width = '800';

        form = document.createElement('form');
        form.name = 'corsCosaActionForm';
        form.method = 'post';
        form.action = detail.action;

        frameContainer.appendChild(head);
        frameContainer.appendChild(frame);
        frameContainer.appendChild(form);
        (document.body || document.documentElement).appendChild(frameContainer);

        return { frameContainer, frame, form };
    }

    function openAttendancePopup(detail) {
        const { frameContainer, frame, form } = ensureAttendancePopupElements(detail);

        form.action = detail.action;
        form.setAttribute('target', detail.targetName);
        installPostprocess(detail);
        watchPopupLifecycle(detail);

        if (typeof dispIframe === 'function') {
            dispIframe(detail.iframeSelector);
            return;
        }

        const frameWidth = parseInt(frame.getAttribute('width') || '800', 10);
        const top = Math.max(window.scrollY + 120, 80);
        const left = Math.max(Math.round((window.innerWidth - frameWidth) / 2), 24);
        const frameHeight = 198;
        const containerHeight = frameHeight + 32;

        frameContainer.style.display = 'block';
        frameContainer.style.top = `${top}px`;
        frameContainer.style.left = `${left}px`;
        frameContainer.style.height = `${containerHeight}px`;
        frame.style.height = `${frameHeight}px`;
        form.submit();
    }

    document.addEventListener(OPEN_POPUP_EVENT_NAME, (event) => {
        try {
            if (!event.detail) {
                return;
            }
            openAttendancePopup(event.detail);
        } catch (error) {
            console.error('[KLPF] 出席ポップアップブリッジの実行に失敗しました。', error);
        }
    });
})();
