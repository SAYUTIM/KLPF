// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

import { CONTENT_SCRIPTS_CONFIG, GAS_SETUP_CONFIG, CONTEXT_MENU_ID } from './scripts.config.js';

const SUBJECT_FILTER_STORAGE_KEY = 'klpf-course-filter-settings';

async function enableAutomaticSubjectFilter() {
    const result = await chrome.storage.local.get(SUBJECT_FILTER_STORAGE_KEY);
    let settings = {};

    try {
        const parsed = result[SUBJECT_FILTER_STORAGE_KEY]
            ? JSON.parse(result[SUBJECT_FILTER_STORAGE_KEY])
            : {};
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            settings = parsed;
        }
    } catch (error) {
        console.warn('[KLPF] 既存の講義フィルター設定を読み込めなかったため初期化します。', error);
    }

    settings.isAutoActive = true;
    await chrome.storage.local.set({
        [SUBJECT_FILTER_STORAGE_KEY]: JSON.stringify(settings),
    });
}

function isAllowedGasWebhookUrl(value) {
    if (typeof value !== 'string') return false;

    try {
        const url = new URL(value);
        return url.protocol === 'https:'
            && url.hostname === 'script.google.com'
            && url.pathname.startsWith('/a/macros/g.kogakuin.jp/s/');
    } catch {
        return false;
    }
}

/**
 * コンテンツスクリプトを登録する。
 * @param {ContentScriptConfig} config - 登録するスクリプトの設定。
 */
async function registerContentScript(config) {
    try {
        const registration = {
            id: config.id,
            js: config.js,
            matches: config.matches,
            runAt: config.runAt,
        };
        if (Array.isArray(config.css) && config.css.length > 0) {
            registration.css = config.css;
        }

        await chrome.scripting.registerContentScripts([registration]);
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

async function replaceContentScriptRegistration(config) {
    await unregisterContentScript(config.id);
    await registerContentScript(config);
}

async function applyAutoAttendDependency(isEnabled) {
    const meetConfig = CONTENT_SCRIPTS_CONFIG.find(config => config.storageKey === 'autoMeet');
    if (!meetConfig) return;

    if (isEnabled) {
        await replaceContentScriptRegistration(meetConfig);
    } else {
        await unregisterContentScript(meetConfig.id);
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
        const isEnabled = result[config.storageKey] !== undefined
            ? result[config.storageKey]
            : !!config.enabledByDefault;
        await unregisterContentScript(config.id); // 念のため既存のスクリプトを解除

        if (isEnabled) {
            await registerContentScript(config);

            // 「自動出席」が有効な場合、「Meet自動参加」も有効にする依存関係を処理
            if (config.storageKey === 'autoAttend') {
                await applyAutoAttendDependency(true);
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
            if (key === 'searchSubject') {
                await enableAutomaticSubjectFilter();
            }

            // 重複エラーを防ぐため、登録前に必ず解除する
            await replaceContentScriptRegistration(config);

            // 「自動出席」が有効な場合、「Meet自動参加」も有効にする依存関係を処理
            if (key === 'autoAttend') {
                await applyAutoAttendDependency(true);
            }
        } else {
            // 機能が無効になった場合、スクリプトを解除する
            await unregisterContentScript(config.id);

            // 「自動出席」が無効な場合、「Meetミュート参加」も解除する
            if (key === 'autoAttend') {
                await applyAutoAttendDependency(false);
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
                if (result.gasWebhook !== true) {
                    throw new Error('課題通知が無効です。');
                }
                if (!isAllowedGasWebhookUrl(result.gaswebhookurl)) {
                    throw new Error('GAS Webhook URLが未設定または許可対象外です。');
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

    if (message.type === 'refresh-content-scripts') {
        (async () => {
            try {
                await initializeScripts();
                sendResponse({ success: true });
            } catch (error) {
                console.error('[KLPF] コンテンツスクリプトの再初期化に失敗しました:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }

    if (message.type === 'get-inline-settings-features') {
        sendResponse({
            success: true,
            features: CONTENT_SCRIPTS_CONFIG
                .filter((config) => config.displayName)
                .sort((a, b) => (a.displayOrder ?? 9999) - (b.displayOrder ?? 9999))
                .map((config) => ({
                    key: config.storageKey,
                    label: config.displayName,
                    defaultValue: !!config.enabledByDefault,
                })),
        });
        return true;
    }

    if (message.type === 'inject') {
        if (message.data === "gassetup") registerContentScript(GAS_SETUP_CONFIG);
        if (message.data === "gassetupstop") unregisterContentScript(GAS_SETUP_CONFIG.id);
    }
    
    return false;
});
