// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 設定値と動的content script登録を同期する。
 * 登録内容が同一の場合はChrome APIの解除・再登録を省き、設定変更時の処理を軽くする。
 */

import { CONTENT_SCRIPTS_CONFIG } from '../../scripts.config.js';

const SUBJECT_FILTER_STORAGE_KEY = 'klpf-course-filter-settings';
const ATTENDANCE_RATE_FEATURE_KEY = 'attendanceRateDisplay';
const ATTENDANCE_RATE_CONSENT_KEY = 'attendanceRateAccessConsent';

export const CONTENT_SCRIPT_BY_STORAGE_KEY = new Map(
    CONTENT_SCRIPTS_CONFIG.map(config => [config.storageKey, config]),
);

function createRegistration(config) {
    const registration = {
        id: config.id,
        js: config.js,
        matches: config.matches,
        runAt: config.runAt,
    };
    if (Array.isArray(config.css) && config.css.length > 0) registration.css = config.css;
    return registration;
}

function hasSameRegistration(current, expected) {
    return current.id === expected.id
        && current.runAt === expected.runAt
        && JSON.stringify(current.js || []) === JSON.stringify(expected.js || [])
        && JSON.stringify(current.css || []) === JSON.stringify(expected.css || [])
        && JSON.stringify(current.matches || []) === JSON.stringify(expected.matches || []);
}

/**
 * 未登録、または内容が変わったcontent scriptだけを登録する。
 * @param {object} config - scripts.config.js内の機能設定。
 */
export async function registerContentScript(config) {
    const expected = createRegistration(config);
    try {
        const [current] = await chrome.scripting.getRegisteredContentScripts({ ids: [config.id] });
        if (current && hasSameRegistration(current, expected)) return;
        if (current) await chrome.scripting.unregisterContentScripts({ ids: [config.id] });
        await chrome.scripting.registerContentScripts([expected]);
        console.debug(`[KLPF] スクリプト登録: ${config.id}`);
    } catch (error) {
        console.error(`[KLPF] スクリプト登録失敗: ${config.id}`, error);
    }
}

/**
 * 指定された動的content scriptが存在するときだけ解除する。
 * @param {string} scriptId - scripts.config.jsで定義したID。
 */
export async function unregisterContentScript(scriptId) {
    try {
        const scripts = await chrome.scripting.getRegisteredContentScripts({ ids: [scriptId] });
        if (scripts.length === 0) return;
        await chrome.scripting.unregisterContentScripts({ ids: [scriptId] });
        console.debug(`[KLPF] スクリプト解除: ${scriptId}`);
    } catch (error) {
        console.error(`[KLPF] スクリプト解除失敗: ${scriptId}`, error);
    }
}

export async function enableAutomaticSubjectFilter() {
    const result = await chrome.storage.local.get(SUBJECT_FILTER_STORAGE_KEY);
    let settings = {};

    try {
        const parsed = result[SUBJECT_FILTER_STORAGE_KEY]
            ? JSON.parse(result[SUBJECT_FILTER_STORAGE_KEY])
            : {};
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) settings = parsed;
    } catch (error) {
        console.debug('[KLPF] 既存の講義フィルター設定を読み込めなかったため初期化します。', error);
    }

    settings.isAutoActive = true;
    await chrome.storage.local.set({
        [SUBJECT_FILTER_STORAGE_KEY]: JSON.stringify(settings),
    });
}

export async function applyAutoAttendDependency(isEnabled) {
    const meetConfig = CONTENT_SCRIPT_BY_STORAGE_KEY.get('autoMeet');
    if (!meetConfig) return;
    if (isEnabled) await registerContentScript(meetConfig);
    else await unregisterContentScript(meetConfig.id);
}

/**
 * 保存済み設定を読み、全ての動的content scriptを期待状態へ同期する。
 */
export async function initializeScripts() {
    console.debug('[KLPF] 拡張機能の初期化...');
    const storageKeys = [
        ...CONTENT_SCRIPTS_CONFIG.map(config => config.storageKey),
        ATTENDANCE_RATE_CONSENT_KEY,
    ];
    const result = await chrome.storage.sync.get(storageKeys);
    if (chrome.runtime.lastError) {
        console.error('[KLPF] ストレージ読み込み失敗:', chrome.runtime.lastError);
        return;
    }

    if (result[ATTENDANCE_RATE_CONSENT_KEY] !== true
        && result[ATTENDANCE_RATE_FEATURE_KEY] === true) {
        result[ATTENDANCE_RATE_FEATURE_KEY] = false;
        await chrome.storage.sync.set({ [ATTENDANCE_RATE_FEATURE_KEY]: false });
    }

    for (const config of CONTENT_SCRIPTS_CONFIG) {
        const isEnabled = result[config.storageKey] ?? Boolean(config.enabledByDefault);
        if (isEnabled) await registerContentScript(config);
        else await unregisterContentScript(config.id);
    }

    if (result.autoAttend === true) await applyAutoAttendDependency(true);
}
