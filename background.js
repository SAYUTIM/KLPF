// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file Manifest V3 Service Workerのエントリーポイント。
 * 出席率取得のライフサイクルとChromeイベントを結び、独立した登録・更新・URL検証
 * モジュールへ処理を委譲する。
 */

import { parseKuportDocument, createKuportLoginContext, closeKuportParser } from './background/modules/kuport-runtime.js';
import { createFormBody } from './background/modules/kuport-form.js';

import { CONTENT_SCRIPTS_CONFIG, GAS_SETUP_CONFIG, CONTEXT_MENU_ID } from './scripts.config.js';
import {
    CONTENT_SCRIPT_BY_STORAGE_KEY,
    applyAutoAttendDependency,
    enableAutomaticSubjectFilter,
    initializeScripts,
    registerContentScript,
    unregisterContentScript,
} from './background/modules/content-scripts.js';
import { queueHomeUpdateNoticeClaim } from './background/modules/update-notice.js';
import { assertKuportUrl, isAllowedWebhookUrl } from './background/modules/url-utils.js';
import {
    ATTENDANCE_FETCH_JOB_KEY,
    checkManualRefreshCooldown,
    clearAttendanceFetchJob,
    getAttendanceFetchJob,
    getManualRefreshCooldownRemaining,
    recordAttendanceRefreshCooldown,
    throwIfAttendanceFetchAborted,
} from './background/modules/attendance-state.js';

const ATTENDANCE_CACHE_KEY = 'klpf-attendance-rate-cache';
const ATTENDANCE_CACHE_VERSION = 3;
const ATTENDANCE_BROWSER_SESSION_KEY = 'klpf-attendance-browser-session';
const ATTENDANCE_RATE_FEATURE_KEY = 'attendanceRateDisplay';
const ATTENDANCE_RATE_CONSENT_KEY = 'attendanceRateAccessConsent';
const ATTENDANCE_FETCH_JOB_TIMEOUT_MS = 2 * 60 * 1000;
const ATTENDANCE_BACKGROUND_JOB_TAB_ID = -1;
const KUPORT_ENTRY_URL = 'https://ku-port.sc.kogakuin.ac.jp/';
const KUPORT_URL_PATTERN = 'https://ku-port.sc.kogakuin.ac.jp/*';

const LMS_HOME_URL_PATTERNS = [
    'https://study.ns.kogakuin.ac.jp/lms/homeHoml/*',
    'https://study.ns.kogakuin.ac.jp/lms/tpicTpil/doBack*',
    'https://study.ns.kogakuin.ac.jp/lms/klmsKlil/doBack*',
];
const KUPORT_TRANSITION_HOSTS = new Set([
    'ku-port.sc.kogakuin.ac.jp',
    'auth.kogakuin.ac.jp',
    'slink.secioss.com',
]);

const startingBackgroundAttendanceTabs = new Set();
let attendanceFetchAbortController = null;

async function reportAttendanceDebug(stage, details = {}) {
    const message = {
        type: 'klpf-attendance-debug',
        stage,
        details,
        timestamp: Date.now(),
    };
    const tabs = await chrome.tabs.query({ url: LMS_HOME_URL_PATTERNS });
    await Promise.all(tabs.map(async tab => {
        try {
            await chrome.tabs.sendMessage(tab.id, message);
        } catch {
            // 対象タブでcontent scriptが準備中の場合はService Workerのログだけ残す。
        }
    }));
}

async function closeCreatedAttendanceContext(job) {
    if (!job?.createdByExtension) return;
    if (Number.isInteger(job.createdWindowId)) {
        try {
            await chrome.windows.remove(job.createdWindowId);
            return;
        } catch {
            // ウィンドウが先に閉じられた場合はタブ側の削除も試す。
        }
    }
    await chrome.tabs.remove(job.tabId);
}

async function finishAttendanceFetch(tabId, status) {
    const job = await getAttendanceFetchJob();
    if (!job || job.tabId !== tabId) return;

    if (status === 'completed' && !job.manual) {
        await recordAttendanceRefreshCooldown();
    }
    await clearAttendanceFetchJob();
    await chrome.storage.session.set({
        [ATTENDANCE_BROWSER_SESSION_KEY]: {
            status,
            finishedAt: Date.now(),
        },
    });
    if (job.createdByExtension && job.phase !== 'background-fetch') {
        try {
            await closeCreatedAttendanceContext(job);
        } catch (error) {
            console.debug('[KLPF] 出席率取得用の一時画面を閉じられませんでした。', error);
        }
    }
    await reportAttendanceDebug('処理終了', { status });
}

async function askKuportTabToCapture(tabId, mode = 'capture') {
    try {
        return await chrome.tabs.sendMessage(tabId, {
            type: mode === 'bootstrap'
                ? 'klpf-attendance-session-bootstrap'
                : mode === 'navigate'
                    ? 'klpf-attendance-auto-fetch'
                    : 'klpf-attendance-capture-now',
        });
    } catch {
        return null;
    }
}





async function fetchKuportAttendanceInBackground(bootstrap, signal) {
    await reportAttendanceDebug('バックグラウンド通信開始');
    throwIfAttendanceFetchAborted(signal);
    const menuAction = assertKuportUrl(bootstrap.action);
    const menuBody = createFormBody(bootstrap.fields);
    menuBody.set('menuForm:mainMenu', 'menuForm:mainMenu');
    menuBody.set('menuForm:mainMenu_menuid', '7_0_0_0');

    const attendancePageResponse = await fetch(menuAction, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: menuBody,
        redirect: 'follow',
        signal,
    });
    if (!attendancePageResponse.ok) {
        throw new Error(`Ku-port画面遷移エラー: ${attendancePageResponse.status}`);
    }
    await reportAttendanceDebug('出席画面へのJSF遷移成功', {
        status: attendancePageResponse.status,
    });
    throwIfAttendanceFetchAborted(signal);

    const attendancePageHtml = await attendancePageResponse.text();
    const attendanceForm = await parseKuportDocument('parse-attendance-form', {
        html: attendancePageHtml,
        baseUrl: attendancePageResponse.url,
    });
    throwIfAttendanceFetchAborted(signal);
    await reportAttendanceDebug('出席フォーム解析成功', {
        academicTerm: attendanceForm.academicTerm || '',
    });
    const attendanceAction = assertKuportUrl(attendanceForm.action);
    const displayBody = createFormBody(attendanceForm.fields);
    displayBody.set('javax.faces.partial.ajax', 'true');
    displayBody.set('javax.faces.source', 'funcForm:btnHyoji');
    displayBody.set('javax.faces.partial.execute', '@this');
    displayBody.set(
        'javax.faces.partial.render',
        'funcForm:btnHyoji funcForm:conditionArea funcForm:jugyoKaisuInfo funcForm:jugyoKaisuTbl'
    );
    displayBody.set('funcForm:btnHyoji', 'funcForm:btnHyoji');

    const attendanceResponse = await fetch(attendanceAction, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'Faces-Request': 'partial/ajax',
            'X-Requested-With': 'XMLHttpRequest',
        },
        body: displayBody,
        redirect: 'follow',
        signal,
    });
    if (!attendanceResponse.ok) {
        throw new Error(`Ku-port出席表取得エラー: ${attendanceResponse.status}`);
    }
    await reportAttendanceDebug('出席表Ajax取得成功', {
        status: attendanceResponse.status,
    });
    throwIfAttendanceFetchAborted(signal);

    const attendanceResponseText = await attendanceResponse.text();
    const records = await parseKuportDocument('parse-attendance-records', {
        html: attendanceResponseText,
    });
    throwIfAttendanceFetchAborted(signal);
    if (!Array.isArray(records) || records.length === 0) {
        throw new Error('Ku-portの出席表に科目が見つかりませんでした。');
    }
    await reportAttendanceDebug('出席表解析成功', {
        recordCount: records.length,
        numericRateCount: records.filter(record => Number.isFinite(record.rate)).length,
    });
    throwIfAttendanceFetchAborted(signal);

    await chrome.storage.local.set({
        [ATTENDANCE_CACHE_KEY]: {
            version: ATTENDANCE_CACHE_VERSION,
            updatedAt: Date.now(),
            academicTerm: attendanceForm.academicTerm || '',
            records,
        },
    });
    await reportAttendanceDebug('新しい出席率キャッシュを保存', {
        recordCount: records.length,
    });
}

async function startBackgroundAttendanceFetch(tabId, bootstrap) {
    if (startingBackgroundAttendanceTabs.has(tabId)) return;
    startingBackgroundAttendanceTabs.add(tabId);

    const abortController = new AbortController();
    attendanceFetchAbortController = abortController;
    try {
        const job = await getAttendanceFetchJob();
        if (!job || job.tabId !== tabId || job.phase !== 'login-tab') return;
        await chrome.storage.session.set({
            [ATTENDANCE_FETCH_JOB_KEY]: {
                ...job,
                phase: 'background-fetch',
            },
        });
        if (job.createdByExtension) {
            await reportAttendanceDebug('Ku-portログイン完了・一時画面を閉じます');
            await closeCreatedAttendanceContext(job);
        }
        await fetchKuportAttendanceInBackground(bootstrap, abortController.signal);
        await finishAttendanceFetch(tabId, 'completed');
    } catch (error) {
        if (error.name === 'AbortError') return;
        await reportAttendanceDebug('バックグラウンド取得失敗', {
            error: error.message,
        });
        console.error('[KLPF] Ku-portのバックグラウンド取得に失敗しました。', error);
        await finishAttendanceFetch(tabId, 'background-fetch-error');
    } finally {
        if (attendanceFetchAbortController === abortController) {
            attendanceFetchAbortController = null;
        }
        startingBackgroundAttendanceTabs.delete(tabId);
        try {
            await closeKuportParser();
        } catch {
            // offscreen documentが作られる前の失敗は無視する。
        }
    }
}



async function prepareAttendanceRefreshJob() {
    const currentJob = await getAttendanceFetchJob();
    if (!currentJob) return null;

    const isExpired = !Number.isFinite(currentJob.startedAt)
        || Date.now() - currentJob.startedAt > ATTENDANCE_FETCH_JOB_TIMEOUT_MS;
    if (!isExpired && currentJob.phase === 'background-fetch') {
        return { status: 'already-running' };
    }
    try {
        if (!isExpired) {
            await chrome.tabs.get(currentJob.tabId);
            return { status: 'already-running' };
        }
        if (currentJob.createdByExtension) await closeCreatedAttendanceContext(currentJob);
    } catch {
        // 既に閉じられている場合もジョブ情報だけ削除する。
    }
    await clearAttendanceFetchJob();
    return null;
}

async function setAttendanceFetchJob(
    tabId,
    { createdByExtension = false, createdWindowId = null, manual = false } = {}
) {
    await chrome.storage.session.set({
        [ATTENDANCE_BROWSER_SESSION_KEY]: {
            status: 'running',
            startedAt: Date.now(),
        },
        [ATTENDANCE_FETCH_JOB_KEY]: {
            tabId,
            startedAt: Date.now(),
            createdByExtension,
            createdWindowId,
            manual,
            phase: 'login-tab',
        },
    });
}

async function startAttendanceLoginFlow({ abortIfKuportOpen = false, manual = false } = {}) {
    const createdContext = await createKuportLoginContext();
    const tab = createdContext.tab;
    await setAttendanceFetchJob(tab.id, {
        createdByExtension: true,
        createdWindowId: createdContext.createdWindowId,
        manual,
    });
    if (abortIfKuportOpen) {
        const existingTabs = await chrome.tabs.query({ url: KUPORT_URL_PATTERN });
        if (existingTabs.length > 0) {
            await cancelAttendanceFetchForUserKuport(existingTabs[0].id);
            return { status: 'kuport-open' };
        }
    }

    await reportAttendanceDebug(
        createdContext.displayMode === 'minimized-window'
            ? 'Ku-port最小化ウィンドウで自動ログイン開始'
            : 'Ku-port非アクティブタブで自動ログイン開始'
    );
    await chrome.tabs.update(tab.id, { url: KUPORT_ENTRY_URL });
    return { status: 'started' };
}

async function tryManualRefreshFromBackgroundSession() {
    const sessionProbeController = new AbortController();
    attendanceFetchAbortController = sessionProbeController;
    await setAttendanceFetchJob(ATTENDANCE_BACKGROUND_JOB_TAB_ID, { manual: true });
    try {
        await reportAttendanceDebug('既存Ku-portセッションをバックグラウンドで確認');
        let response = await fetch(KUPORT_ENTRY_URL, {
            credentials: 'include',
            cache: 'no-store',
            redirect: 'follow',
            signal: sessionProbeController.signal,
        });
        let bootstrap = null;
        for (let step = 0; step <= 2; step += 1) {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const responseHtml = await response.text();
            try {
                bootstrap = await parseKuportDocument('parse-menu-bootstrap', {
                    html: responseHtml,
                    baseUrl: response.url,
                });
                break;
            } catch (menuError) {
                if (step === 2 || new URL(response.url).hostname !== 'ku-port.sc.kogakuin.ac.jp') {
                    throw menuError;
                }
                const navigation = await parseKuportDocument('parse-auto-navigation-form', {
                    html: responseHtml,
                    baseUrl: response.url,
                });
                const navigationAction = assertKuportUrl(navigation.action);
                response = await fetch(navigationAction, {
                    method: 'POST',
                    credentials: 'include',
                    cache: 'no-store',
                    redirect: 'follow',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
                    body: createFormBody(navigation.fields),
                    signal: sessionProbeController.signal,
                });
            }
        }
        if (!bootstrap) throw new Error('Ku-portのログイン済みセッションを確認できませんでした。');
        throwIfAttendanceFetchAborted(sessionProbeController.signal);
        if (attendanceFetchAbortController === sessionProbeController) {
            attendanceFetchAbortController = null;
        }
        void startBackgroundAttendanceFetch(ATTENDANCE_BACKGROUND_JOB_TAB_ID, {
            status: 'session-ready',
            action: bootstrap.action,
            fields: bootstrap.fields,
        });
        await reportAttendanceDebug('既存Ku-portセッションを再利用して手動更新');
        return { status: 'started-existing-session' };
    } catch (error) {
        if (attendanceFetchAbortController === sessionProbeController) {
            attendanceFetchAbortController = null;
        }
        if (error.name === 'AbortError') return { status: 'kuport-open' };
        const job = await getAttendanceFetchJob();
        if (job?.tabId === ATTENDANCE_BACKGROUND_JOB_TAB_ID) await clearAttendanceFetchJob();
        await chrome.storage.session.remove(ATTENDANCE_BROWSER_SESSION_KEY);
        await reportAttendanceDebug('既存Ku-portセッションを利用できないため再ログインへ切替', {
            error: error.message,
        });
        try {
            await closeKuportParser();
        } catch {
            // 解析用ドキュメントが作成されていない場合は無視する。
        }
        return null;
    }
}

async function requestAttendanceRateRefresh({ manual = false } = {}) {
    const attendanceSettings = await chrome.storage.sync.get([
        ATTENDANCE_RATE_FEATURE_KEY,
        ATTENDANCE_RATE_CONSENT_KEY,
        'autoLogin',
    ]);
    if (attendanceSettings[ATTENDANCE_RATE_CONSENT_KEY] !== true) {
        return { status: 'consent-required' };
    }
    if (attendanceSettings[ATTENDANCE_RATE_FEATURE_KEY] !== true) {
        return { status: 'feature-disabled' };
    }
    if (attendanceSettings.autoLogin === false) {
        return { status: 'auto-login-disabled' };
    }

    if (!manual) {
        const browserSession = await chrome.storage.session.get(ATTENDANCE_BROWSER_SESSION_KEY);
        if (browserSession[ATTENDANCE_BROWSER_SESSION_KEY]) {
            const previousStatus = browserSession[ATTENDANCE_BROWSER_SESSION_KEY].status;
            await reportAttendanceDebug('このブラウザ起動中は取得済み', {
                status: previousStatus,
            });
            if (previousStatus === 'running') return { status: 'already-running' };
            return {
                status: 'browser-session-already-checked',
                previousStatus,
            };
        }
    }

    const runningStatus = await prepareAttendanceRefreshJob();
    if (runningStatus) return runningStatus;

    if (manual) {
        const openKuportTabs = await chrome.tabs.query({ url: KUPORT_URL_PATTERN });
        if (openKuportTabs.length > 0) {
            await reportAttendanceDebug('Ku-portが開いているため手動更新を中止');
            return { status: 'kuport-open' };
        }
        const remainingSeconds = await checkManualRefreshCooldown();
        if (remainingSeconds > 0) return { status: 'cooldown', remainingSeconds };
        await reportAttendanceDebug('出席状況の手動更新を開始');

        const backgroundResult = await tryManualRefreshFromBackgroundSession();
        if (backgroundResult) return backgroundResult;
        const tabsOpenedDuringProbe = await chrome.tabs.query({ url: KUPORT_URL_PATTERN });
        if (tabsOpenedDuringProbe.length > 0) {
            await reportAttendanceDebug('Ku-portが開かれたため再ログインを中止');
            return { status: 'kuport-open' };
        }
        return startAttendanceLoginFlow({ abortIfKuportOpen: true, manual: true });
    }

    const existingTabs = await chrome.tabs.query({ url: KUPORT_URL_PATTERN });
    if (existingTabs.length > 0) {
        await chrome.storage.session.set({
            [ATTENDANCE_BROWSER_SESSION_KEY]: {
                status: 'skipped-kuport-already-open',
                finishedAt: Date.now(),
            },
        });
        await reportAttendanceDebug('Ku-portが既に開いているため自動取得中止');
        return { status: 'kuport-already-open' };
    }

    return startAttendanceLoginFlow();
}

async function cancelAttendanceFetchForUserKuport(tabId) {
    const job = await getAttendanceFetchJob();
    if (!job || job.tabId === tabId) return false;

    attendanceFetchAbortController?.abort();
    await clearAttendanceFetchJob();
    if (job.createdByExtension && job.phase !== 'background-fetch') {
        try {
            await closeCreatedAttendanceContext(job);
        } catch {
            // ログイン用画面が既に閉じられている場合は無視する。
        }
    }
    await chrome.storage.session.set({
        [ATTENDANCE_BROWSER_SESSION_KEY]: {
            status: 'cancelled-kuport-opened',
            finishedAt: Date.now(),
        },
    });
    await reportAttendanceDebug('Ku-portが別タブで開かれたため出席状況の取得中止');
    return true;
}

async function continueAttendanceFetch(tabId, changeInfo, tab) {
    const job = await getAttendanceFetchJob();
    if (!job || job.tabId !== tabId) return;

    if (changeInfo.status !== 'complete') return;
    const url = changeInfo.url || tab.url || '';
    let hostname = '';
    try {
        hostname = new URL(url).hostname;
    } catch {
        // URLが確定するまで待つ。
    }
    if (!hostname) return;
    if (hostname && !KUPORT_TRANSITION_HOSTS.has(hostname)) {
        await finishAttendanceFetch(tabId, 'unexpected-navigation');
        return;
    }
    if (hostname && hostname !== 'ku-port.sc.kogakuin.ac.jp') return;
    if (tab.title === 'Error Page') {
        await finishAttendanceFetch(tabId, 'kuport-error');
        return;
    }

    const response = await askKuportTabToCapture(
        tabId,
        job.createdByExtension ? 'bootstrap' : 'navigate'
    );
    if (response?.status === 'session-ready' && job.createdByExtension) {
        await reportAttendanceDebug('Ku-portホームからJSFセッション情報を取得');
        void startBackgroundAttendanceFetch(tabId, response);
        return;
    }
    if (response?.status === 'captured') {
        await finishAttendanceFetch(tabId, 'completed');
    } else if (response?.status === 'menu-not-ready' && job.createdByExtension) {
        // 自動ログインの次の画面へ遷移するまで待つ。
        return;
    } else if (!['navigating', 'waiting-for-table'].includes(response?.status)) {
        if (startingBackgroundAttendanceTabs.has(tabId)) return;
        const latestJob = await getAttendanceFetchJob();
        if (latestJob?.tabId === tabId && latestJob.phase === 'background-fetch') return;
        await finishAttendanceFetch(tabId, response?.status || 'content-script-unavailable');
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

    if (changes[ATTENDANCE_RATE_CONSENT_KEY]
        && changes[ATTENDANCE_RATE_CONSENT_KEY].newValue !== true) {
        const attendanceSetting = await chrome.storage.sync.get(ATTENDANCE_RATE_FEATURE_KEY);
        if (attendanceSetting[ATTENDANCE_RATE_FEATURE_KEY] === true) {
            await chrome.storage.sync.set({ [ATTENDANCE_RATE_FEATURE_KEY]: false });
        }
        await unregisterContentScript('AttendanceRateDisplay');
    }

    for (const [key, { newValue }] of Object.entries(changes)) {
        const config = CONTENT_SCRIPT_BY_STORAGE_KEY.get(key);
        if (!config) continue;

        if (newValue) {
            if (key === ATTENDANCE_RATE_FEATURE_KEY) {
                const consent = await chrome.storage.sync.get(ATTENDANCE_RATE_CONSENT_KEY);
                if (consent[ATTENDANCE_RATE_CONSENT_KEY] !== true) {
                    await chrome.storage.sync.set({ [ATTENDANCE_RATE_FEATURE_KEY]: false });
                    await unregisterContentScript(config.id);
                    continue;
                }
            }
            if (key === 'searchSubject') {
                await enableAutomaticSubjectFilter();
            }

            // 登録内容が同一ならモジュール側でChrome API呼び出しを省略する。
            await registerContentScript(config);

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

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    void (async () => {
        const url = changeInfo.url || tab.url || '';
        try {
            if (new URL(url).hostname === 'ku-port.sc.kogakuin.ac.jp') {
                const cancelled = await cancelAttendanceFetchForUserKuport(tabId);
                if (cancelled) return;
            }
        } catch {
            // URLがまだ確定していない更新は通常の継続判定へ渡す。
        }
        await continueAttendanceFetch(tabId, changeInfo, tab);
    })().catch(error => {
        console.error('[KLPF] Ku-port出席率取得の継続に失敗しました。', error);
    });
});

chrome.tabs.onRemoved.addListener((tabId) => {
    void (async () => {
        const job = await getAttendanceFetchJob();
        if (job?.tabId !== tabId || job.phase === 'background-fetch') return;
        await clearAttendanceFetchJob();
        await chrome.storage.session.set({
            [ATTENDANCE_BROWSER_SESSION_KEY]: {
                status: 'login-tab-closed',
                finishedAt: Date.now(),
            },
        });
    })();
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
                if (!isAllowedWebhookUrl(result.gaswebhookurl)) {
                    throw new Error('Webhook URLが未設定または許可対象外です。');
                }

                const response = await fetch(result.gaswebhookurl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(message.data)
                });

                if (!response.ok) {
                    throw new Error(`HTTPエラー ステータス: ${response.status}`);
                }

                console.log('[KLPF] 課題データをWebhookに送信しました。');
                sendResponse({ success: true });
            } catch (error) {
                console.error('[KLPF] Webhookへのデータ送信に失敗しました:', error);
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
                    isBeta: !!config.isBeta,
                })),
        });
        return true;
    }

    if (message.type === 'claim-home-update-notice') {
        queueHomeUpdateNoticeClaim()
            .then(sendResponse)
            .catch(error => {
                console.debug('[KLPF] ホーム用の更新確認を実行できませんでした。', error);
                sendResponse({ status: 'error' });
            });
        return true;
    }

    if (message.type === 'request-attendance-rate-refresh') {
        requestAttendanceRateRefresh({ manual: message.manual === true })
            .then(sendResponse)
            .catch(error => {
                console.error('[KLPF] Ku-port出席率取得を開始できませんでした。', error);
                sendResponse({ status: 'error', error: error.message });
            });
        return true;
    }

    if (message.type === 'get-attendance-refresh-cooldown') {
        getManualRefreshCooldownRemaining()
            .then(remainingSeconds => sendResponse({ remainingSeconds }))
            .catch(() => sendResponse({ remainingSeconds: 0 }));
        return true;
    }

    if (message.type === 'kuport-attendance-session-ready' && sender.tab?.id) {
        void startBackgroundAttendanceFetch(sender.tab.id, {
            status: 'session-ready',
            action: message.action,
            fields: message.fields,
        });
        sendResponse({ status: 'accepted' });
        return false;
    }

    if (message.type === 'attendance-rate-fetch-complete' && sender.tab?.id) {
        void finishAttendanceFetch(sender.tab.id, 'completed');
        sendResponse({ status: 'accepted' });
        return;
    }

    if (message.type === 'kuport-auto-login-unavailable' && sender.tab?.id) {
        void finishAttendanceFetch(sender.tab.id, 'auto-login-unavailable');
        sendResponse({ status: 'accepted' });
        return;
    }

    if (message.type === 'inject') {
        if (message.data === "gassetup") registerContentScript(GAS_SETUP_CONFIG);
        if (message.data === "gassetupstop") unregisterContentScript(GAS_SETUP_CONFIG.id);
    }
    
    return false;
});
