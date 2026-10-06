// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 保存したログインIDとKu-Portキャッシュの対応を管理する。
 * IDが変わったときは取得ジョブを終了してから3機能のキャッシュと取得済み状態を消す。
 * 移行中はsessionに停止状態を残し、Worker再起動後も未完了の移行を再開する。
 */
export const KUPORT_CACHE_OWNER_KEY = 'klpfKuportCacheAccount';
export const KUPORT_ACCOUNT_TRANSITION_KEY = 'klpfKuportAccountTransition';

/**
 * キャッシュ所有者の変更処理を直列化する窓口を作る。
 * @param {Function} stopJobs - 実行中の3機能を終了し、保存処理も完了させる関数。
 * @returns {{sync: Function}} 最新の保存IDへキャッシュ所有者を合わせる操作。
 */
export function createKuportAccountManager(stopJobs) {
    let pending = Promise.resolve();
    return {
        sync() {
            const operation = pending.then(async () => {
                const local = await chrome.storage.local.get(['username', KUPORT_CACHE_OWNER_KEY]);
                const session = await chrome.storage.session.get(KUPORT_ACCOUNT_TRANSITION_KEY);
                const username = String(local.username || '').trim();
                if (local[KUPORT_CACHE_OWNER_KEY] === username && !session[KUPORT_ACCOUNT_TRANSITION_KEY]) return;
                await chrome.storage.session.set({ [KUPORT_ACCOUNT_TRANSITION_KEY]: true });
                await stopJobs();
                await chrome.storage.local.remove([
                    'klpf-attendance-rate-cache', 'klpf-bulletin-board-cache', 'klpf-syllabus-cache',
                ]);
                await chrome.storage.session.remove([
                    'klpf-attendance-browser-session', 'klpf-bulletin-updated-this-session', 'klpf-attendance-manual-refresh',
                ]);
                // 停止待ちの間にIDが再変更された場合も、旧データを消してから最新IDを保存する。
                const latest = await chrome.storage.local.get('username');
                await chrome.storage.local.set({ [KUPORT_CACHE_OWNER_KEY]: String(latest.username || '').trim() });
                await chrome.storage.session.remove(KUPORT_ACCOUNT_TRANSITION_KEY);
            });
            pending = operation.catch(() => {});
            return operation;
        },
    };
}
