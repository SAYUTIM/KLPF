// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file Ku-Port取得の共通利用条件を画面側へ提供する。
 * バックグラウンドから認証情報を含まない利用可否を取得し、設定変更を購読する。
 * classic scriptとして先に注入し、設定ページでは副作用importで同じ実装を利用する。
 */
(() => {
    if (globalThis.KLPFKuportAccess) return;
    const listeners = new Set();
    let current = { ready: false, reason: '自動ログインの設定を確認中です。' };
    let revision = 0;
    /**
     * 現在の利用可否を購読中の画面へ通知する。
     * @returns {void} 通知の送信。
     */
    function notify() {
        for (const listener of listeners) {
            try { listener(current); } catch (error) {
                console.debug('[KLPF] Ku-Portの利用状態を画面へ反映できませんでした。', error);
            }
        }
    }
    const access = {
        get ready() { return current.ready; },
        get reason() { return current.reason; },
        /**
         * 利用条件の変更を購読し、現在の状態も直ちに通知する。
         * @param {Function} listener - 利用可否を受け取るコールバック。
         * @returns {Function} 購読解除関数。
         */
        subscribe(listener) {
            listeners.add(listener);
            listener(current);
            return () => listeners.delete(listener);
        },
        /**
         * 最新状態を取得する。取得できない場合は利用を停止する。
         * @returns {Promise<object>} 利用可否と理由。
         */
        async refresh() {
            const requestRevision = ++revision;
            let next;
            try {
                next = await chrome.runtime.sendMessage({ type: 'get-kuport-access-state' });
            } catch { next = null; }
            if (requestRevision !== revision) return current;
            current = next && typeof next.ready === 'boolean'
                ? next : { ready: false, reason: '拡張機能を再読み込みしてください。' };
            notify();
            return current;
        },
    };
    globalThis.KLPFKuportAccess = access;
    chrome.storage.onChanged.addListener((changes, area) => {
        const keys = area === 'sync' ? ['autoLogin']
            : area === 'local' ? ['username', 'password', 'totpSecret', 'klpfInlineAllFeaturesDisabled', 'klpfKuportCacheAccount']
                : area === 'session' ? ['klpfAutoLoginAttempts', 'klpfKuportAccountTransition'] : [];
        if (keys.some(key => changes[key])) {
            current = { ready: false, reason: '自動ログインの設定を確認中です。' };
            notify();
            void access.refresh();
        }
    });
    // sessionはcontent scriptから直接読まない。停止・解除はWorkerからも通知する。
    chrome.runtime.onMessage.addListener(message => {
        if (message?.type === 'kuport-access-changed') void access.refresh();
    });
    window.addEventListener('pageshow', event => {
        if (event.persisted) void access.refresh();
    });
    void access.refresh();
})();
