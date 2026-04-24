// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file LMSの自動ログアウトを防止する機能を提供する content script
 */

(function() {
    'use strict';

    const FEATURE_NAME = 'KLPF';
    const PAGE_WORLD_SCRIPT_ID = 'klpf-logout-block-page-world';
    const PAGE_WORLD_RESOURCE_PATH = 'features/pageWorld/logoutBlock.js';

    if (window.self !== window.top) {
        return;
    }

    function injectPageWorldScript() {
        if (document.getElementById(PAGE_WORLD_SCRIPT_ID)) {
            return;
        }

        const script = document.createElement('script');
        script.id = PAGE_WORLD_SCRIPT_ID;
        script.src = chrome.runtime.getURL(PAGE_WORLD_RESOURCE_PATH);
        script.async = false;
        (document.head || document.documentElement).appendChild(script);
    }

    try {
        injectPageWorldScript();
        console.log(`[${FEATURE_NAME}] 自動ログアウト防止機能を初期化しました。`);
    } catch (error) {
        console.error(`[${FEATURE_NAME}] 自動ログアウト防止機能の初期化に失敗しました。`, error);
    }
})();
