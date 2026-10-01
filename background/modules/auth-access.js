// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 自動ログインとKu-Port取得の利用条件を管理する。
 * syncの有効設定、localの認証情報、sessionの送信履歴を参照する。
 * 送信許可を直列化し、複数タブからのログイン連打も同じ制限で停止する。
 * 認証情報は履歴や応答に含めない。
 */

export const AUTH_ATTEMPTS_KEY = 'klpfAutoLoginAttempts';
export const KUPORT_DEPENDENT_KEYS = ['attendanceRateDisplay', 'syllabusLookupEnabled', 'bulletinBoardEnabled'];
let attemptQueue = Promise.resolve();

/**
 * 自動ログインに必要な保存設定と停止状態を取得する。
 * @returns {Promise<{ready: boolean, reason: string}>} 利用可否と表示用の理由。
 */
export async function getAuthAccessState() {
    const [sync, local, session] = await Promise.all([
        chrome.storage.sync.get('autoLogin'),
        chrome.storage.local.get(['username', 'password', 'klpfInlineAllFeaturesDisabled']),
        chrome.storage.session.get(AUTH_ATTEMPTS_KEY),
    ]);
    let reason = '';
    if (local.klpfInlineAllFeaturesDisabled === true) reason = 'すべての機能がOFFです。';
    else if (sync.autoLogin === false) reason = '自動ログインをONにしてください。';
    else if (typeof local.username !== 'string' || !local.username.trim()
        || typeof local.password !== 'string' || !local.password) reason = '自動ログインのユーザー名とパスワードを設定してください。';
    else if (session[AUTH_ATTEMPTS_KEY]?.blocked === true) reason = 'ログインの繰り返しを検出して停止しました。認証情報を確認し、自動ログインをOFF→ONにしてください。';
    return { ready: !reason, reason };
}

/**
 * 指定した認証段階の自動送信を許可し、送信前に履歴を保存する。
 * 同じ段階が10秒内に4回目、または10分内に6回目へ進む場合は停止する。
 * 成否を判別できない画面でも再送ループを防ぐため、送信回数で保守的に制限する。
 * @param {string} stage - 許可済みの認証段階名。
 * @param {number} tabId - 自動送信した認証タブのID。
 * @returns {Promise<{ready: boolean, reason: string}>} 自動送信の可否。
 */
export function claimAutoLoginAttempt(stage, tabId) {
    const operation = attemptQueue.then(async () => {
        const access = await getAuthAccessState();
        if (!access.ready) return access;
        const stored = await chrome.storage.session.get(AUTH_ATTEMPTS_KEY);
        const history = stored[AUTH_ATTEMPTS_KEY] || {};
        const now = Date.now();
        const attempts = (history.stages?.[stage] || []).filter(time => Number.isFinite(time)
            && time <= now && now - time < 10 * 60 * 1000);
        const blocked = attempts.filter(time => now - time < 10000).length >= 3 || attempts.length >= 5;
        await chrome.storage.session.set({ [AUTH_ATTEMPTS_KEY]: {
            blocked, stages: { ...history.stages, [stage]: blocked ? attempts : [...attempts, now] },
            pendingTabs: [...new Set([...(history.pendingTabs || []), tabId])],
        } });
        return blocked ? { ready: false, reason: '自動ログインの再送上限に達したため停止しました。' } : access;
    });
    attemptQueue = operation.catch(() => {});
    return operation;
}

/**
 * 設定修正または認証成功のあと、直列処理の順序を守って送信履歴を解除する。
 * @returns {Promise<void>} 履歴削除の完了。
 */
export function resetAutoLoginAttempts() {
    const operation = attemptQueue.then(() => chrome.storage.session.remove(AUTH_ATTEMPTS_KEY));
    attemptQueue = operation.catch(() => {});
    return operation;
}

/**
 * 自動送信を行ったタブが認証後の画面へ到達した場合だけ履歴を解除する。
 * 開いたままのホームの再読み込みが別タブの失敗履歴を消すことを防ぐ。
 * @param {number} tabId - 認証後の画面へ到達したタブID。
 * @returns {Promise<void>} 履歴確認と必要な削除の完了。
 */
export function recordAutoLoginSuccess(tabId) {
    const operation = attemptQueue.then(async () => {
        const stored = await chrome.storage.session.get(AUTH_ATTEMPTS_KEY);
        if (stored[AUTH_ATTEMPTS_KEY]?.pendingTabs?.includes(tabId)) {
            await chrome.storage.session.remove(AUTH_ATTEMPTS_KEY);
        }
    });
    attemptQueue = operation.catch(() => {});
    return operation;
}
