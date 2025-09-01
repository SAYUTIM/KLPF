// Copyright (c) 2024-2025 SAYU
// This software is released under the MIT License, see LICENSE.

import { CONTENT_SCRIPTS_CONFIG, GAS_SETUP_CONFIG, CONTEXT_MENU_ID } from './scripts.config.js';

/**
 * コンテンツスクリプトを登録する。
 * @param {ContentScriptConfig} config - 登録するスクリプトの設定。
 */
async function registerContentScript(config) {
    try {
        await chrome.scripting.registerContentScripts([{
            id: config.id,
            js: config.js,
            matches: config.matches,
            runAt: config.runAt,
        }]);
        console.log(`[KLPF] スクリプト登録: ${config.id}`);
    } catch (error) {
        console.error(`[KLPF] スクリプト登録失敗: ${config.id}`, error);
    }
}

/**
 * コンテンツスクリプトの登録を解除する。
 * @param {string} scriptId - 解除するスクリプトのID。
 */
async function unregisterContentScript(scriptId) {
    try {
        const scripts = await chrome.scripting.getRegisteredContentScripts({ ids: [scriptId] });
        if (scripts.length > 0) {
            await chrome.scripting.unregisterContentScripts({ ids: [scriptId] });
            console.log(`[KLPF] スクリプト解除: ${scriptId}`);
        }
    } catch (error) {
        console.error(`[KLPF] スクリプト解除失敗: ${scriptId}`, error);
    }
}

/**
 * 全機能の状態をストレージから読み込み、必要に応じてスクリプトを登録/解除する。
 */
async function initializeScripts() {
    console.log('[KLPF] 拡張機能の初期化...');
    const storageKeys = CONTENT_SCRIPTS_CONFIG.map(config => config.storageKey);

    const result = await chrome.storage.sync.get(storageKeys);
    if (chrome.runtime.lastError) {
        console.error('[KLPF] ストレージ読み込み失敗:', chrome.runtime.lastError);
        return;
    }

    for (const config of CONTENT_SCRIPTS_CONFIG) {
        const isEnabled = result[config.storageKey] || false;
        await unregisterContentScript(config.id); // 念のため既存のスクリプトを解除

        if (isEnabled) {
            await registerContentScript(config);

            // 「自動出席」が有効な場合、「Meet自動参加」も有効にする依存関係を処理
            if (config.storageKey === 'autoAttend') {
                const meetConfig = CONTENT_SCRIPTS_CONFIG.find(c => c.storageKey === 'autoMeet');
                if (meetConfig) {
                    await unregisterContentScript(meetConfig.id);
                    await registerContentScript(meetConfig);
                }
            }
        }
    }
}

// --- イベントリスナーの登録 ---

/**
 * 拡張機能のインストールまたは更新時に実行される。
 */
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('[KLPF] 拡張機能がインストールされました。');
        const defaults = {};
        const defaultOptionsOrder = [];
        CONTENT_SCRIPTS_CONFIG.forEach(config => {
            if (config.enabledByDefault) {
                defaults[config.storageKey] = true;
                if (config.optionsPanelId) {
                    defaultOptionsOrder.push(config.optionsPanelId);
                }
            }
        });
        defaults.optionsOrder = defaultOptionsOrder;
        chrome.storage.sync.set(defaults, () => {
            console.log('[KLPF] デフォルト設定を保存しました。');
            // initializeScripts(); // onChangedが処理するため、インストール時は不要
        });
    } else {
        initializeScripts();
    }

    // コンテキストメニューを作成
    chrome.contextMenus.create({
        id: CONTEXT_MENU_ID,
        title: "[KLPF] 設定を開く",
        contexts: ["page"],
    });
});

/**
 * ストレージの変更を監視する。
 */
chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'sync') return;

    for (const [key, { newValue }] of Object.entries(changes)) {
        const config = CONTENT_SCRIPTS_CONFIG.find(c => c.storageKey === key);
        if (!config) continue;

        if (newValue) {
            // 重複エラーを防ぐため、登録前に必ず解除する
            await unregisterContentScript(config.id);
            await registerContentScript(config);

            // 「自動出席」が有効な場合、「Meet自動参加」も有効にする依存関係を処理
            if (key === 'autoAttend') {
                const meetConfig = CONTENT_SCRIPTS_CONFIG.find(c => c.storageKey === 'autoMeet');
                if (meetConfig) {
                    await unregisterContentScript(meetConfig.id);
                    await registerContentScript(meetConfig);
                }
            }
        } else {
            // 機能が無効になった場合、スクリプトを解除する
            await unregisterContentScript(config.id);

            // 「自動出席」が無効な場合、「Meetミュート参加」も解除する
            if (key === 'autoAttend') {
                const meetConfig = CONTENT_SCRIPTS_CONFIG.find(c => c.storageKey === 'autoMeet');
                if (meetConfig) {
                    await unregisterContentScript(meetConfig.id);
                }
            }
        }
    }
});

/**
 * コンテキストメニューがクリックされたときに実行される。
 */
chrome.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId === CONTEXT_MENU_ID) {
        chrome.tabs.create({ url: "setting/options.html" });
    }
});

/**
 * コンテンツスクリプトやポップアップからのメッセージを受信する。
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "openTab") {
        chrome.tabs.create({ url: message.url });
        return;
    }

    if (message.type === 'send-homework') {
        (async () => {
            try {
                const result = await chrome.storage.sync.get(["gaswebhookurl", "gasWebhook"]);
                if (!result.gaswebhookurl || !result.gasWebhook) {
                    throw new Error('GAS Webhook URLが未設定です。');
                }

                const response = await fetch(result.gaswebhookurl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(message.data)
                });

                if (!response.ok) {
                    throw new Error(`HTTPエラー ステータス: ${response.status}`);
                }

                console.log('[KLPF] 課題データをGASに送信しました。');
                sendResponse({ success: true });
            } catch (error) {
                console.error('[KLPF] GASへのデータ送信に失敗しました:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true; // 非同期処理を示す
    }

    if (message.type === 'inject') {
        if (message.data === "gassetup") registerContentScript(GAS_SETUP_CONFIG);
        if (message.data === "gassetupstop") unregisterContentScript(GAS_SETUP_CONFIG.id);
    }
    
    return false;
});
