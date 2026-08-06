// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 出席率取得ジョブと手動更新クールダウンのsession保存を管理する。
 * Service Workerが停止・再起動しても競合判定を継続できるよう、メモリとstorage.sessionを併用する。
 */

export const ATTENDANCE_FETCH_JOB_KEY = 'klpf-attendance-fetch-job';
const ATTENDANCE_MANUAL_REFRESH_KEY = 'klpf-attendance-manual-refresh';
const ATTENDANCE_MANUAL_REFRESH_COOLDOWN_MS = 30 * 1000;

let lastAttendanceRefreshAt = 0;

export async function getAttendanceFetchJob() {
    const stored = await chrome.storage.session.get(ATTENDANCE_FETCH_JOB_KEY);
    return stored[ATTENDANCE_FETCH_JOB_KEY] || null;
}

export async function clearAttendanceFetchJob() {
    await chrome.storage.session.remove(ATTENDANCE_FETCH_JOB_KEY);
}

export function createFormBody(fields) {
    const body = new URLSearchParams();
    for (const [name, value] of fields || []) {
        if (typeof name === 'string' && typeof value === 'string') body.append(name, value);
    }
    return body;
}

export function throwIfAttendanceFetchAborted(signal) {
    if (!signal?.aborted) return;
    const error = new Error('Ku-portが別タブで開かれたため取得を中断しました。');
    error.name = 'AbortError';
    throw error;
}

export async function recordAttendanceRefreshCooldown(requestedAt = Date.now()) {
    lastAttendanceRefreshAt = requestedAt;
    await chrome.storage.session.set({
        [ATTENDANCE_MANUAL_REFRESH_KEY]: { requestedAt },
    });
}

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
