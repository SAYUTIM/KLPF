// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 出席率取得ジョブと手動更新クールダウンのsession保存を管理する。
 * Service Workerが停止・再起動しても競合判定を継続できるよう、メモリとstorage.sessionを併用する。
 */
import { createKuportJobStore } from './kuport-job-state.js';

export const ATTENDANCE_FETCH_JOB_KEY = 'klpf-attendance-fetch-job';
export const attendanceJobs = createKuportJobStore(ATTENDANCE_FETCH_JOB_KEY, 'tabId');
const ATTENDANCE_MANUAL_REFRESH_KEY = 'klpf-attendance-manual-refresh';
const ATTENDANCE_MANUAL_REFRESH_COOLDOWN_MS = 30 * 1000;

let lastAttendanceRefreshAt = 0;

/**
 * セッションストレージから進行中の出席率取得ジョブを読み出す。
 * @returns {Promise<object|null>} 進行中のジョブ。保存されていなければnull。
 */
export async function getAttendanceFetchJob() {
    return attendanceJobs.get();
}

/**
 * 出席率取得の中断が要求されていればAbortErrorを投げる。
 * @param {AbortSignal} signal - 取得の中断を通知するシグナル。
 * @returns {void} 戻り値はない。
 */
export function throwIfAttendanceFetchAborted(signal) {
    if (!signal?.aborted) return;
    const error = new Error('Ku-portが別タブで開かれたため取得を中断しました。');
    error.name = 'AbortError';
    throw error;
}

/**
 * 手動更新の受付時刻をメモリとセッションストレージへ記録する。
 * @param {number} [requestedAt] - 更新要求を受け付けた時刻（ミリ秒）。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
export async function recordAttendanceRefreshCooldown(requestedAt = Date.now()) {
    lastAttendanceRefreshAt = requestedAt;
    await chrome.storage.session.set({
        [ATTENDANCE_MANUAL_REFRESH_KEY]: { requestedAt },
    });
}

/**
 * 手動更新の待機秒数を返し、更新可能な場合は今回の受付時刻を記録する。
 * @returns {Promise<number>} 残り待機秒数。0なら今回の手動更新を受け付けた。
 */
export async function checkManualRefreshCooldown() {
    const requestedAt = Date.now();
    const memoryElapsed = requestedAt - lastAttendanceRefreshAt;
    if (memoryElapsed < ATTENDANCE_MANUAL_REFRESH_COOLDOWN_MS) {
        return Math.ceil((ATTENDANCE_MANUAL_REFRESH_COOLDOWN_MS - memoryElapsed) / 1000);
    }
    lastAttendanceRefreshAt = requestedAt;

    const stored = await chrome.storage.session.get(ATTENDANCE_MANUAL_REFRESH_KEY);
    const lastRequestedAt = stored[ATTENDANCE_MANUAL_REFRESH_KEY]?.requestedAt;
    const elapsed = Number.isFinite(lastRequestedAt) ? requestedAt - lastRequestedAt : Infinity;
    if (elapsed < ATTENDANCE_MANUAL_REFRESH_COOLDOWN_MS) {
        lastAttendanceRefreshAt = lastRequestedAt;
        return Math.ceil((ATTENDANCE_MANUAL_REFRESH_COOLDOWN_MS - elapsed) / 1000);
    }
    await recordAttendanceRefreshCooldown(requestedAt);
    return 0;
}

/**
 * 受付時刻を変更せず、手動更新までの残り秒数を取得する。
 * @returns {Promise<number>} 残り待機秒数。更新可能な場合は0。
 */
export async function getManualRefreshCooldownRemaining() {
    const stored = await chrome.storage.session.get(ATTENDANCE_MANUAL_REFRESH_KEY);
    const storedRequestedAt = stored[ATTENDANCE_MANUAL_REFRESH_KEY]?.requestedAt;
    const lastRequestedAt = Math.max(
        lastAttendanceRefreshAt,
        Number.isFinite(storedRequestedAt) ? storedRequestedAt : 0,
    );
    if (!lastRequestedAt) return 0;
    return Math.max(
        0,
        Math.ceil(
            (ATTENDANCE_MANUAL_REFRESH_COOLDOWN_MS - (Date.now() - lastRequestedAt)) / 1000,
        ),
    );
}
