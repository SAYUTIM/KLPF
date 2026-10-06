// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 設定データの管理を担当するモジュール
 * @module modules/settings
 * 入力要素と設定定義を対応させ、認証情報をlocal、機能設定をsyncへ保存・復元する。
 * 出席率の有効化では同意画面を経由し、保存結果をUI向けイベントで通知する。
 */

import { FEATURE_SETTINGS_CONFIG } from '../../scripts.config.js';

const ATTENDANCE_RATE_FEATURE_KEY = 'attendanceRateDisplay';
const ATTENDANCE_RATE_CONSENT_KEY = 'attendanceRateAccessConsent';
let attendanceConsentResolver = null;

/**
 * 設定項目の定義。
 * HTML要素のID、ストレージキー、値の型をマッピングする。
 * @type {Array<object>}
 */
export const SETTINGS_CONFIG = [
    // 認証情報 (localストレージに保存)
    { id: 'username',        key: 'username',      type: 'value',   storage: 'local' },
    { id: 'password',        key: 'password',      type: 'value',   storage: 'local' },
    { id: 'totp-secret',     key: 'totpSecret',    type: 'value',   storage: 'local' },

    // 機能の有効/無効 (syncストレージで同期)
    { id: 'auto-login',      key: 'autoLogin',     type: 'checked', storage: 'sync' },
    { id: 'show-time',       key: 'showTime',      type: 'checked', storage: 'sync' },
    { id: 'auto-attend',     key: 'autoAttend',    type: 'checked', storage: 'sync' },
    { id: 'auto-meet',       key: 'autoMeet',      type: 'checked', storage: 'sync' },
    { id: 'kuport-dialog-outside-close', key: 'kuportDialogOutsideClose', type: 'checked', storage: 'sync' },
    { id: 'search-subject',  key: 'searchSubject', type: 'checked', storage: 'sync' },
    { id: 'home-attendance-badge', key: 'homeAttendanceBadge', type: 'checked', storage: 'sync' },
    { id: 'attendance-rate-display', key: 'attendanceRateDisplay', type: 'checked', storage: 'sync' },
    { id: 'syllabus-lookup-enabled', key: 'syllabusLookupEnabled', type: 'checked', storage: 'sync' },
    { id: 'bulletin-board-enabled', key: 'bulletinBoardEnabled', type: 'checked', storage: 'sync' },
    { id: 'dark-mode',       key: 'darkMode',      type: 'checked', storage: 'sync' },
    { id: 'home-work',        key: 'homework',      type: 'checked', storage: 'sync' },
    { id: 'logout-block',    key: 'logoutblock',   type: 'checked', storage: 'sync' },
    { id: 'kyozai-open',    key: 'kyozaiopen',   type: 'checked', storage: 'sync' },
    { id: 'hide-home-update-notification', key: 'hideHomeUpdateNotification', type: 'checked', storage: 'sync' },

    // 自動出席の詳細設定 (syncストレージで同期)
    { id: 'class-term',      key: 'attendC',       type: 'value',   storage: 'sync' },
    { id: 'meet-id',         key: 'attendM',       type: 'value',   storage: 'sync' },
    { id: 'day-select',      key: 'attendD',       type: 'value',   storage: 'sync' },
    { id: 'class-period',    key: 'attendT',       type: 'value',   storage: 'sync' },
    { id: 'attend-button',   key: 'attendA',       type: 'checked', storage: 'sync' },

    // 課題リストアップの詳細設定 (syncストレージで同期)
    { id: 'homework-notification', key: 'gasWebhook',    type: 'checked', storage: 'sync' },
    { id: 'homework-webhook-url',  key: 'gaswebhookurl', type: 'value',   storage: 'sync' },
];

const DEFAULT_ENABLED_MAP = new Map(
    FEATURE_SETTINGS_CONFIG.map((config) => [config.storageKey, !!config.enabledByDefault]),
);

/**
 * 設定定義から保存先のストレージ領域名を取得する。
 * @param {object} config - 機能または設定項目の定義。
 * @returns {string} 保存先の領域名。省略時はsync。
 */
function getStorageArea(config) {
    return config.storage || 'sync';
}

/**
 * 設定定義から保存値に必要な型を求める。
 * @param {object} config - 機能または設定項目の定義。
 * @returns {string} 保存値の型を表す文字列。
 */
function getExpectedType(config) {
    return config.type === 'checked' ? 'boolean' : 'string';
}

/**
 * 設定定義に対応する既定値を返す。
 * @param {object} config - 機能または設定項目の定義。
 * @returns {boolean|string} 設定項目の既定値。
 */
function getFallbackValue(config) {
    if (config.type === 'value') {
        return '';
    }

    if (getStorageArea(config) === 'sync' && DEFAULT_ENABLED_MAP.has(config.key)) {
        return DEFAULT_ENABLED_MAP.get(config.key);
    }

    return false;
}

/**
 * 読み取った設定値を対応する入力要素へ反映する。
 * @param {Element} element - 操作または読み取りの対象要素。
 * @param {object} config - 機能または設定項目の定義。
 * @param {*} value - 検証・変換する入力値。
 * @returns {void} 戻り値はない。
 */
function applySettingToElement(element, config, value) {
    if (config.type === 'checked') {
        element.checked = value;
        return;
    }

    element.value = value;
}

/**
 * 設定定義から読み込み対象の保存キーを列挙する。
 * @returns {object} 領域ごとに分類した保存キー一覧。
 */
export function getSettingsStorageKeys() {
    return SETTINGS_CONFIG.reduce((keys, config) => {
        keys[getStorageArea(config)].add(config.key);
        return keys;
    }, {
        sync: new Set(['optionsOrder']),
        local: new Set(),
    });
}

/**
 * 設定を対応するストレージ領域に保存する。
 * @returns {Promise<void>}
 */
export async function saveSettings() {
    const settingsToSave = {
        sync: {},
        local: {}
    };

    for (const config of SETTINGS_CONFIG) {
        const element = document.getElementById(config.id);
        if (element) {
            const storageArea = getStorageArea(config);
            settingsToSave[storageArea][config.key] = element[config.type];
        }
    }

    try {
        // localとsyncの両方に保存
        if (settingsToSave.sync.autoLogin === false) {
            for (const key of ['attendanceRateDisplay', 'syllabusLookupEnabled', 'bulletinBoardEnabled']) {
                settingsToSave.sync[key] = false;
            }
        }
        await Promise.all([
            chrome.storage.sync.set(settingsToSave.sync),
            chrome.storage.local.set(settingsToSave.local)
        ]);
        // UIに変更を通知
        document.dispatchEvent(new CustomEvent("settings-saved"));
    } catch (error) {
        console.error("設定の保存に失敗。", error);
        // TODO: ユーザーへのエラー通知UIを実装
        document.dispatchEvent(new CustomEvent("settings-error", { detail: "設定の保存に失敗しました。" }));
    }
}

/**
 * 出席率取得の説明と同意画面を表示し、利用者の選択を待つ。
 * @returns {Promise<boolean>} 出席率取得へ同意した場合はtrue。
 */
function showAttendanceConsentModal() {
    const modal = document.getElementById('attendance-consent-modal');
    if (!modal) return Promise.resolve(false);

    modal.classList.add('visible');
    document.getElementById('attendance-consent-confirm')?.focus();
    return new Promise((resolve) => {
        attendanceConsentResolver = resolve;
    });
}

/**
 * 出席率の同意画面を閉じ、待機中の処理へ結果を返す。
 * @param {boolean} accepted - 出席率取得への同意を受け付けたかどうか。
 * @returns {void} 戻り値はない。
 */
function resolveAttendanceConsent(accepted) {
    document.getElementById('attendance-consent-modal')?.classList.remove('visible');
    attendanceConsentResolver?.(accepted);
    attendanceConsentResolver = null;
}

/**
 * 出席率の有効化時に同意を確認し、設定へ反映する。
 * @param {Element} element - 操作または読み取りの対象要素。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
async function handleAttendanceRateToggle(element) {
    element.disabled = true;
    try {
        if (element.checked) {
            const stored = await chrome.storage.sync.get(ATTENDANCE_RATE_CONSENT_KEY);
            if (stored[ATTENDANCE_RATE_CONSENT_KEY] !== true) {
                const accepted = await showAttendanceConsentModal();
                if (accepted) {
                    await chrome.storage.sync.set({ [ATTENDANCE_RATE_CONSENT_KEY]: true });
                } else {
                    element.checked = false;
                }
            }
        }
        await saveSettings();
    } finally {
        element.disabled = globalThis.KLPFKuportAccess?.ready !== true;
    }
}

/**
 * ストレージから設定を読み込み、UIに反映させる。
 * @returns {Promise<void>}
 */
export async function loadAndApplySettings() {
    const keys = {
        sync: [...SETTINGS_CONFIG.filter(c => getStorageArea(c) === 'sync').map(c => c.key), 'optionsOrder'],
        local: SETTINGS_CONFIG.filter(c => getStorageArea(c) === 'local').map(c => c.key)
    };

    try {
        const [syncSettings, localSettings] = await Promise.all([
            chrome.storage.sync.get(keys.sync),
            chrome.storage.local.get(keys.local)
        ]);

        const allSettings = { ...syncSettings, ...localSettings };
        const missingDefaultSyncSettings = {};

        for (const config of SETTINGS_CONFIG) {
            const element = document.getElementById(config.id);
            if (!element) continue;

            const storedValue = allSettings[config.key];
            if (storedValue !== undefined) {
                const expectedType = getExpectedType(config);
                if (typeof storedValue === expectedType) {
                    applySettingToElement(element, config, storedValue);
                } else {
                    console.warn(`設定キー"${config.key}"の型が不正。期待値: ${expectedType}, 実際値: ${typeof storedValue}`);
                    applySettingToElement(element, config, getFallbackValue(config));
                }
                continue;
            }

            const fallbackValue = getFallbackValue(config);
            applySettingToElement(element, config, fallbackValue);

            if (getStorageArea(config) === 'sync' && config.type === 'checked' && DEFAULT_ENABLED_MAP.has(config.key)) {
                const defaultValue = fallbackValue;
                missingDefaultSyncSettings[config.key] = defaultValue;
            }
        }

        if (Object.keys(missingDefaultSyncSettings).length > 0) {
            await chrome.storage.sync.set(missingDefaultSyncSettings);
        }

        // UIに読み込み完了を通知
        document.dispatchEvent(new CustomEvent("settings-loaded"));
    } catch (error) {
        console.error("設定の読み込みに失敗。", error);
        // TODO: ユーザーへのエラー通知UIを実装
        document.dispatchEvent(new CustomEvent("settings-error", { detail: "設定の読み込みに失敗しました。" }));
    }
}

/**
 * 全ての設定要素にイベントリスナーを登録する。
 */
export function addEventListenersToSettings() {
    document.getElementById('attendance-consent-confirm')?.addEventListener('click', () => {
        resolveAttendanceConsent(true);
    });
    document.getElementById('attendance-consent-cancel')?.addEventListener('click', () => {
        resolveAttendanceConsent(false);
    });

    for (const config of SETTINGS_CONFIG) {
        const element = document.getElementById(config.id);
        if (element) {
            const eventType = config.type === 'value' ? 'input' : 'change';
            if (config.key === ATTENDANCE_RATE_FEATURE_KEY) {
                element.addEventListener(eventType, () => void handleAttendanceRateToggle(element));
            } else {
                element.addEventListener(eventType, saveSettings);
            }
        }
    }
}
