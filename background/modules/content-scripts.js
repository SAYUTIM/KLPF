// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 設定値と動的content script登録を同期する。
 * 登録内容が同一の場合はChrome APIの解除・再登録を省き、設定変更時の処理を軽くする。
 * 同じIDの登録・解除を直列化し、起動と設定変更が重なっても登録の競合を防ぐ。
 */

import { CONTENT_SCRIPTS_CONFIG } from '../../scripts.config.js';

const SUBJECT_FILTER_STORAGE_KEY = 'klpf-course-filter-settings';
const ATTENDANCE_RATE_FEATURE_KEY = 'attendanceRateDisplay';
const ATTENDANCE_RATE_CONSENT_KEY = 'attendanceRateAccessConsent';
const scriptOperations = new Map();

export const CONTENT_SCRIPT_BY_STORAGE_KEY = new Map(
    CONTENT_SCRIPTS_CONFIG.map(config => [config.storageKey, config]),
);

/**
 * 機能定義をChromeのコンテンツスクリプト登録形式へ変換する。
 * @param {object} config - 機能または設定項目の定義。
 * @returns {object} Chromeの登録APIへ渡すID・ファイル・URL・実行時点。
 */
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

/**
 * 登録済みスクリプトと期待する注入ファイル・URL・実行時点が等しいか判定する。
 * @param {object} current - 現在登録されているコンテンツスクリプト情報。
 * @param {object} expected - 機能定義から作成した期待するスクリプト登録。
 * @returns {boolean} 条件を満たす場合はtrue。
 */
function hasSameRegistration(current, expected) {
    return current.id === expected.id
        && current.runAt === expected.runAt
        && JSON.stringify(current.js || []) === JSON.stringify(expected.js || [])
        && JSON.stringify(current.css || []) === JSON.stringify(expected.css || [])
        // URLパターンの順序は注入条件に影響しない。JS・CSSの順序は維持して比較する。
        && JSON.stringify([...(current.matches || [])].sort())
            === JSON.stringify([...(expected.matches || [])].sort());
}

/**
 * 同じスクリプトIDへのChrome API操作を呼び出された順に実行する。
 * @param {string} scriptId - 登録・解除するスクリプトのID。
 * @param {() => Promise<void>} operation - 登録状態の確認と変更を行う処理。
 * @returns {Promise<void>} 今回の処理が完了するまで待つPromise。
 */
function runScriptOperation(scriptId, operation) {
    const previous = scriptOperations.get(scriptId) || Promise.resolve();
    const pending = previous.catch(() => {}).then(operation);
    scriptOperations.set(scriptId, pending);

    const cleanup = () => {
        if (scriptOperations.get(scriptId) === pending) scriptOperations.delete(scriptId);
    };
    void pending.then(cleanup, cleanup);
    return pending;
}

/**
 * 登録状態を比較し、必要なときだけChrome APIで登録・解除する。
 * @param {object} config - scripts.config.js内の機能設定。
 * @param {boolean} isEnabled - スクリプトを登録するかどうか。
 * @returns {Promise<void>} 登録状態の変更が完了するまで待つPromise。
 */
async function updateContentScript(config, isEnabled) {
    try {
        const [current] = await chrome.scripting.getRegisteredContentScripts({ ids: [config.id] });
        if (isEnabled) {
            const expected = createRegistration(config);
            if (current && hasSameRegistration(current, expected)) return;
            if (current) await chrome.scripting.unregisterContentScripts({ ids: [config.id] });
            await chrome.scripting.registerContentScripts([expected]);
            console.debug(`[KLPF] スクリプト登録: ${config.id}`);
        } else if (current) {
            await chrome.scripting.unregisterContentScripts({ ids: [config.id] });
            console.debug(`[KLPF] スクリプト解除: ${config.id}`);
        }
    } catch (error) {
        console.error(`[KLPF] スクリプト${isEnabled ? '登録' : '解除'}失敗: ${config.id}`, error);
    }
}

/**
 * 未登録、または内容が変わったcontent scriptだけを登録する。
 * @param {object} config - scripts.config.js内の機能設定。
 * @returns {Promise<void>} 登録状態の同期が完了するまで待つPromise。
 */
export function registerContentScript(config) {
    return runScriptOperation(config.id, () => updateContentScript(config, true));
}

/**
 * 指定された動的content scriptが存在するときだけ解除する。
 * @param {string} scriptId - scripts.config.jsで定義したID。
 * @returns {Promise<void>} 登録解除の確認が完了するまで待つPromise。
 */
export function unregisterContentScript(scriptId) {
    return runScriptOperation(scriptId, () => updateContentScript({ id: scriptId }, false));
}

/**
 * 最新の保存設定と依存条件を読み、スクリプトの登録状態へ反映する。
 * キューの実行時に設定を読むことで、古いON要求が後からOFF設定を上書きするのを防ぐ。
 * @param {object} config - storageKeyを持つscripts.config.js内の機能設定。
 * @returns {Promise<void>} 最新設定の反映が完了するまで待つPromise。
 */
export function syncContentScriptWithSettings(config) {
    return runScriptOperation(config.id, async () => {
        try {
            const keys = [config.storageKey];
            if (config.storageKey === 'autoMeet') keys.push('autoAttend');
            if (config.storageKey === ATTENDANCE_RATE_FEATURE_KEY) keys.push(ATTENDANCE_RATE_CONSENT_KEY);
            const settings = await chrome.storage.sync.get(keys);
            let isEnabled = settings[config.storageKey] ?? Boolean(config.enabledByDefault);
            if (config.storageKey === 'autoMeet') isEnabled = isEnabled || settings.autoAttend === true;
            if (config.storageKey === ATTENDANCE_RATE_FEATURE_KEY) {
                isEnabled = isEnabled && settings[ATTENDANCE_RATE_CONSENT_KEY] === true;
            }
            await updateContentScript(config, isEnabled);
        } catch (error) {
            console.error(`[KLPF] スクリプト設定の同期失敗: ${config.id}`, error);
        }
    });
}

/**
 * 既存の講義フィルター設定を保ったまま自動絞り込みを有効にする。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
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

/**
 * 自動出席とMeetミュート参加の最新設定に合わせ、Meet機能の登録を切り替える。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
export async function applyAutoAttendDependency() {
    const meetConfig = CONTENT_SCRIPT_BY_STORAGE_KEY.get('autoMeet');
    if (!meetConfig) return;
    await syncContentScriptWithSettings(meetConfig);
}

/**
 * 保存済み設定を読み、全ての動的content scriptを期待状態へ同期する。
 */
export async function initializeScripts() {
    console.debug('[KLPF] 拡張機能の初期化...');
    // 旧版の空のテーマスクリプトを参照する登録が残っていれば解除する。
    await unregisterContentScript('customtheme');
    const storageKeys = [
        ATTENDANCE_RATE_FEATURE_KEY,
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
        await syncContentScriptWithSettings(config);
    }
}
