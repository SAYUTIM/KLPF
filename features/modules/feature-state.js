// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 自動操作の有効設定と一括OFFを監視する共通部品。
 * Chromeストレージを読み、設定変更時は進行中の操作を先に停止してから最新状態を通知する。
 * ページが履歴キャッシュから復帰した場合も設定を読み直す。
 */
(() => {
    if (globalThis.KLPFFeatureState) return;
    const ALL_DISABLED_KEY = 'klpfInlineAllFeaturesDisabled';

    /**
     * 指定した設定を監視し、有効状態と設定値を通知する。
     * @param {string[]} keys - 監視するsyncストレージのキー。
     * @param {Function} isEnabled - syncの設定値から有効状態を判定する関数。
     * @param {Function} onChange - 有効状態とsyncの設定値を受け取る関数。
     * @returns {{refresh: Function, enabled: boolean}} 再確認関数と現在の有効状態。
     */
    function watch(keys, isEnabled, onChange) {
        let enabled = false;
        let revision = 0;
        const notify = (value, settings = {}) => {
            enabled = value;
            onChange(value, settings);
        };
        const refresh = async () => {
            const currentRevision = ++revision;
            try {
                const [sync, local] = await Promise.all([
                    chrome.storage.sync.get(keys),
                    chrome.storage.local.get(ALL_DISABLED_KEY),
                ]);
                if (revision !== currentRevision) return;
                notify(local[ALL_DISABLED_KEY] !== true && isEnabled(sync), sync);
            } catch (error) {
                if (revision !== currentRevision) return;
                notify(false);
                console.debug('[KLPF] 自動操作の設定を確認できませんでした。', error);
            }
        };
        chrome.storage.onChanged.addListener((changes, area) => {
            if (!(area === 'sync' && keys.some(key => changes[key]))
                && !(area === 'local' && changes[ALL_DISABLED_KEY])) return;
            // 非同期の設定確認が終わるまで、以前の設定で自動操作を続けない。
            notify(false);
            void refresh();
        });
        window.addEventListener('pageshow', event => {
            if (event.persisted) void refresh();
        });
        void refresh();
        return { refresh, get enabled() { return enabled; } };
    }
    globalThis.KLPFFeatureState = Object.freeze({ watch });
})();
