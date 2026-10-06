// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file KU-LMSホームへ表示する更新通知の取得状態を管理する。
 * 同時に複数タブから要求されても一日一回だけ通知されるよう、要求を直列化する。
 */

import { isVersionNewer } from '../../features/modules/version-utils.js';

const HOME_UPDATE_CHECK_KEY = 'klpf-home-update-check';
const HOME_UPDATE_NOTICE_DISABLED_KEY = 'hideHomeUpdateNotification';
const LATEST_RELEASE_API_URL = 'https://api.github.com/repos/SAYUTIM/KLPF/releases/latest';

let noticeQueue = Promise.resolve();

/**
 * ローカルタイムゾーンで日次キャッシュに使う日付キーを返す。
 * @param {Date} date - キーへ変換する日時。
 * @returns {string} YYYY-MM-DD形式の日付。
 */
export function getLocalDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * 日次のリリース確認を行い、未通知の更新があれば本日の通知権を記録して返す。
 * @returns {Promise<object>} 通知可否のstatusと、更新がある場合のlatestVersion。
 */
async function claimHomeUpdateNotice() {
    const noticePreference = await chrome.storage.sync.get(HOME_UPDATE_NOTICE_DISABLED_KEY);
    if (noticePreference[HOME_UPDATE_NOTICE_DISABLED_KEY] === true) {
        return { status: 'disabled' };
    }

    const today = getLocalDateKey();
    const stored = await chrome.storage.local.get(HOME_UPDATE_CHECK_KEY);
    let updateState = stored[HOME_UPDATE_CHECK_KEY] || {};

    if (updateState.checkedDate !== today) {
        const response = await fetch(LATEST_RELEASE_API_URL, { cache: 'no-store' });
        if (!response.ok) throw new Error(`GitHub Release API: ${response.status}`);
        const latestRelease = await response.json();
        const latestVersion = String(latestRelease.tag_name || '').trim();
        updateState = {
            checkedDate: today,
            latestVersion,
            notifiedDate: updateState.notifiedDate || '',
        };
        await chrome.storage.local.set({ [HOME_UPDATE_CHECK_KEY]: updateState });
    }

    // 同じ日のキャッシュでも、拡張機能を更新した後は現在の版と比較し直す。
    if (!updateState.latestVersion || !isVersionNewer(updateState.latestVersion, chrome.runtime.getManifest().version)) {
        return { status: 'up-to-date' };
    }
    if (updateState.notifiedDate === today) {
        return { status: 'already-notified' };
    }

    updateState.notifiedDate = today;
    await chrome.storage.local.set({ [HOME_UPDATE_CHECK_KEY]: updateState });
    return {
        status: 'update-available',
        latestVersion: updateState.latestVersion,
    };
}

/**
 * 更新通知の権利を直列に取得し、複数タブへの重複表示を防ぐ。
 * @returns {Promise<object>} 通知可否と最新バージョン。
 */
export function queueHomeUpdateNoticeClaim() {
    const queuedClaim = noticeQueue.then(claimHomeUpdateNotice);
    noticeQueue = queuedClaim.catch(() => undefined);
    return queuedClaim;
}
