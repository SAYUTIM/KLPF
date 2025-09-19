// Copyright (c) 2024-2025 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 設定データの管理を担当するモジュール
 * @module modules/settings
 */

/**
 * 設定項目の定義。
 * HTML要素のID、ストレージキー、値の型をマッピングする。
 * @type {Array<object>}
 */
const SETTINGS_CONFIG = [
    // 認証情報 (localストレージに保存)
    { id: 'username',        key: 'username',      type: 'value',   storage: 'local' },
    { id: 'password',        key: 'password',      type: 'value',   storage: 'local' },

    // 機能の有効/無効 (syncストレージで同期)
    { id: 'auto-login',      key: 'autoLogin',     type: 'checked', storage: 'sync' },
    { id: 'show-time',       key: 'showTime',      type: 'checked', storage: 'sync' },
    { id: 'auto-attend',     key: 'autoAttend',    type: 'checked', storage: 'sync' },
    { id: 'auto-meet',       key: 'autoMeet',      type: 'checked', storage: 'sync' },
    { id: 'search-subject',  key: 'searchSubject', type: 'checked', storage: 'sync' },
    { id: 'dark-mode',       key: 'darkMode',      type: 'checked', storage: 'sync' },
    { id: 'home-work',        key: 'homework',      type: 'checked', storage: 'sync' },
    { id: 'logout-block',    key: 'logoutblock',   type: 'checked', storage: 'sync' },
    //{ id: 'custom-theme',    key: 'customtheme',   type: 'checked', storage: 'sync' },
    { id: 'kyozai-open',    key: 'kyozaiopen',   type: 'checked', storage: 'sync' },

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
            const storageArea = config.storage || 'sync'; // デフォルトはsync
            settingsToSave[storageArea][config.key] = element[config.type];
        }
    }

    try {
        // localとsyncの両方に保存
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
 * ストレージから設定を読み込み、UIに反映させる。
 * @returns {Promise<void>}
 */
export async function loadAndApplySettings() {
    const keys = {
        sync: [...SETTINGS_CONFIG.filter(c => (c.storage || 'sync') === 'sync').map(c => c.key), 'optionsOrder'],
        local: SETTINGS_CONFIG.filter(c => c.storage === 'local').map(c => c.key)
    };

    try {
        const [syncSettings, localSettings] = await Promise.all([
            chrome.storage.sync.get(keys.sync),
            chrome.storage.local.get(keys.local)
        ]);

        const allSettings = { ...syncSettings, ...localSettings };

        for (const config of SETTINGS_CONFIG) {
            const element = document.getElementById(config.id);
            if (element && allSettings[config.key] !== undefined) {
                // 型の整合性を確認
                const expectedType = config.type === 'checked' ? 'boolean' : 'string';
                if (typeof allSettings[config.key] === expectedType) {
                    element[config.type] = allSettings[config.key];
                } else {
                    console.warn(`設定キー"${config.key}"の型が不正。期待値: ${expectedType}, 実際値: ${typeof allSettings[config.key]}`);
                }
            }
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
    for (const config of SETTINGS_CONFIG) {
        const element = document.getElementById(config.id);
        if (element) {
            const eventType = config.type === 'value' ? 'input' : 'change';
            element.addEventListener(eventType, saveSettings);
        }
    }
}
