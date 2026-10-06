// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file Manifest V3のService Workerとして、設定・Chromeイベントと3機能の取得ジョブを管理する。
 * 出席率・掲示板・シラバスの待機要求を直列化し、認証画面の所有確認、取消、結果保存を担当する。
 * フォーム通信はbackground/kuport、HTML解析はoffscreen、表示はfeaturesへ委譲する。
 */

import { createSyllabusTransport } from './background/kuport/syllabus.js';
import { createBulletinTransport, BULLETIN_MAX_ITEMS } from './background/kuport/bulletin.js';
import { createPriorityQueue } from './background/modules/priority-queue.js';
import { createKuportJobStore } from './background/modules/kuport-job-state.js';
import { createKuportAccountManager, KUPORT_CACHE_OWNER_KEY, KUPORT_ACCOUNT_TRANSITION_KEY } from './background/modules/kuport-account.js';
import './features/modules/syllabus-cache.js';
import { registerKuportJobTimeouts } from './background/modules/kuport-job-timeouts.js';

import {
    isKuportUrl,
    findOpenKuportTabs,
    parseKuportDocument,
    createKuportLoginContext,
    closeKuportLoginContext,
    createKuportJobFinisher,
    closeKuportParser,
} from './background/modules/kuport-runtime.js';

import { createFormBody } from './background/modules/kuport-form.js';

import { getAuthAccessState, claimAutoLoginAttempt, resetAutoLoginAttempts, recordAutoLoginSuccess, AUTH_ATTEMPTS_KEY, KUPORT_DEPENDENT_KEYS } from './background/modules/auth-access.js';
import { CONTENT_SCRIPTS_CONFIG, FEATURE_SETTINGS_CONFIG, GAS_SETUP_CONFIG, CONTEXT_MENU_ID } from './scripts.config.js';
import {
    CONTENT_SCRIPT_BY_STORAGE_KEY,
    applyAutoAttendDependency,
    enableAutomaticSubjectFilter,
    initializeScripts,
    registerContentScript,
    syncContentScriptWithSettings,
    unregisterContentScript,
} from './background/modules/content-scripts.js';
import { queueHomeUpdateNoticeClaim } from './background/modules/update-notice.js';
import { assertKuportUrl, isAllowedWebhookUrl } from './background/modules/url-utils.js';
import {
    ATTENDANCE_FETCH_JOB_KEY,
    attendanceJobs,
    checkManualRefreshCooldown,
    getAttendanceFetchJob,
    getManualRefreshCooldownRemaining,
    recordAttendanceRefreshCooldown,
    resetAttendanceRefreshCooldown,
    throwIfAttendanceFetchAborted,
} from './background/modules/attendance-state.js';

const ATTENDANCE_CACHE_KEY = 'klpf-attendance-rate-cache';
const ATTENDANCE_CACHE_VERSION = 6;
const ATTENDANCE_BROWSER_SESSION_KEY = 'klpf-attendance-browser-session';
const ATTENDANCE_RATE_FEATURE_KEY = 'attendanceRateDisplay';
const ATTENDANCE_RATE_CONSENT_KEY = 'attendanceRateAccessConsent';
const ATTENDANCE_FETCH_JOB_TIMEOUT_MS = 2 * 60 * 1000;
const ATTENDANCE_TERM_COMPONENT_ID = 'funcForm:kaikoNendoGakki';
const KUPORT_ENTRY_URL = 'https://ku-port.sc.kogakuin.ac.jp/';
const KUPORT_URL_PATTERN = 'https://ku-port.sc.kogakuin.ac.jp/*';
const SYLLABUS_LOOKUP_ENABLED_KEY = 'syllabusLookupEnabled';
const SYLLABUS_LOOKUP_JOB_KEY = 'klpf-syllabus-lookup-job';
const INLINE_ALL_FEATURES_DISABLED_KEY = 'klpfInlineAllFeaturesDisabled';
const SYLLABUS_LOOKUP_TIMEOUT_MS = 2 * 60 * 1000;
const BULLETIN_BOARD_ENABLED_KEY = 'bulletinBoardEnabled';
const BULLETIN_CACHE_KEY = 'klpf-bulletin-board-cache';
const BULLETIN_SESSION_KEY = 'klpf-bulletin-updated-this-session';
const BULLETIN_CACHE_VERSION = 2;
const BULLETIN_FETCH_JOB_KEY = 'klpf-bulletin-fetch-job';
const syllabusJobs = createKuportJobStore(SYLLABUS_LOOKUP_JOB_KEY);
const bulletinJobs = createKuportJobStore(BULLETIN_FETCH_JOB_KEY);
const BULLETIN_FETCH_TIMEOUT_MS = 2 * 60 * 1000;
const LMS_HOME_URL_PATTERNS = [
    'https://study.ns.kogakuin.ac.jp/lms/homeHoml/*',
    'https://study.ns.kogakuin.ac.jp/lms/tpicTpic/doBack*',
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
let attendanceRefreshRequestPromise = null;
let attendanceRefreshRequestYear = '';
let syllabusLookupStartPromise = null;
let syllabusFetchAbortController = null;
const startingSyllabusFetchRequests = new Set();
const pendingSyllabusBootstraps = new Map();
let bulletinFetchAbortController = null;
let bulletinFetchStartPromise = null;
const startingBulletinFetchRequests = new Set();
const pendingBulletinBootstraps = new Map();
let kuportAccountRevision = 0;

const { fetchSyllabus: fetchKuportSyllabusInBackground } = createSyllabusTransport({
    reportPhase: reportSyllabusLookupPhase,
    ensureActive: ensureSyllabusJobActive,
});
const { probeSession: probeKuportSessionForBulletin, fetchBulletin: fetchKuportBulletinInBackground } = createBulletinTransport({
    reportPhase: reportBulletinPhase,
    ensureActive: ensureBulletinJobActive,
    throwIfAborted: throwIfBulletinFetchAborted,
});

/**
 * セッションストレージから進行中のシラバス取得ジョブを読み出す。
 * @returns {Promise<object|null>} 進行中のジョブ。保存されていなければnull。
 */
async function getSyllabusLookupJob() {
    return syllabusJobs.get();
}

/**
 * 対応するシラバス取得ジョブを終了し、所有タブを閉じて要求元へ結果を通知する。
 * @param {string} requestId - 処理と結果を対応付ける取得要求ID。
 * @param {object} [options={}] - この処理に必要な設定と依存処理。
 * @param {boolean} [options.ok=false] - 取得が成功したかどうか。
 * @param {object|null} [options.result=null] - 取得したデータ。失敗などで結果がない場合はnull。
 * @param {string|object} [options.message=""] - 表示する案内文、または受信した機能メッセージ。
 * @returns {Promise<boolean>} 対応するジョブを終了した場合はtrue。
 */
const finishSyllabusLookup = createKuportJobFinisher(async (requestId, { ok = false, result = null, message = '' } = {}) => {
    const fetchedAt = Date.now();
    const job = await syllabusJobs.finish(requestId, async current => {
        syllabusFetchAbortController?.abort();
        await closeKuportLoginContext(current);
        if (ok) {
            try {
                await globalThis.KLPFSyllabusCache.save(current.course, result, fetchedAt);
            } catch (error) {
                console.debug('[KLPF] シラバスキャッシュを保存できませんでした。', error);
            }
        }
    });
    if (!job) return false;
    try {
        await chrome.tabs.sendMessage(job.sourceTabId, {
            type: 'syllabus-lookup-result',
            requestId: job.requestId,
            ok,
            result,
            fetchedAt,
            message,
        });
    } catch {
        // 元のKU-LMSタブが閉じられている場合も取得用ウィンドウは閉じる。
    }
    return true;
});

/**
 * シラバス取得の中断が要求されていればAbortErrorを投げる。
 * @param {AbortSignal} signal - 取得の中断を通知するシグナル。
 * @returns {void} 戻り値はない。
 */
function throwIfSyllabusFetchAborted(signal) {
    if (!signal?.aborted) return;
    const error = new Error('シラバス取得が中止されました。');
    error.name = 'AbortError';
    throw error;
}

/**
 * 各取得機能の有効設定と共通の認証条件を確認する。
 * @param {string} key - 機能設定の保存キー。
 * @returns {Promise<void>} 継続不可能なら例外で停止する。
 */
async function ensureKuportFeatureAvailable(key) {
    const [access, settings] = await Promise.all([getAuthAccessState(), chrome.storage.sync.get(key)]);
    if (!access.ready || settings[key] === false
        || (key === ATTENDANCE_RATE_FEATURE_KEY && settings[key] !== true)) {
        throw new Error(access.reason || '機能がOFFになったため、取得を中止しました。');
    }
}

/**
 * 利用条件を画面へ再通知し、利用できなくなった取得を終了する。
 * @returns {Promise<void>} 通知と終了処理の完了。
 */
async function updateKuportAccess() {
    const access = await getAuthAccessState();
    const tabs = await chrome.tabs.query({ url: 'https://study.ns.kogakuin.ac.jp/*' });
    await Promise.all(tabs.map(tab => chrome.tabs.sendMessage(tab.id, { type: 'kuport-access-changed' }).catch(() => {})));
    const [syllabus, bulletin, attendance, settings] = await Promise.all([
        getSyllabusLookupJob(), getBulletinFetchJob(), getAttendanceFetchJob(),
        chrome.storage.sync.get(KUPORT_DEPENDENT_KEYS),
    ]);
    if (syllabus && (!access.ready || settings[SYLLABUS_LOOKUP_ENABLED_KEY] === false)) {
        await finishSyllabusLookup(syllabus.requestId, { message: access.reason || 'シラバス表示がOFFになりました。' });
    }
    if (bulletin && (!access.ready || settings[BULLETIN_BOARD_ENABLED_KEY] === false)) {
        await finishBulletinFetch(bulletin.requestId, { message: access.reason || '掲示板表示がOFFになりました。' });
    }
    if (attendance && (!access.ready || settings[ATTENDANCE_RATE_FEATURE_KEY] !== true)) {
        attendanceFetchAbortController?.abort();
        await finishAttendanceFetch(attendance.tabId, 'feature-disabled');
        await clearAttendanceBrowserSessionYear(attendance.academicYear);
    }
}

/**
 * シラバスの要求ID・中断状態・外部Ku-Portタブを確認し、継続できない場合は停止する。
 * @param {string} requestId - 処理と結果を対応付ける取得要求ID。
 * @param {AbortSignal} signal - 取得の中断を通知するシグナル。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
async function ensureSyllabusJobActive(requestId, signal) {
    await ensureKuportFeatureAvailable(SYLLABUS_LOOKUP_ENABLED_KEY);
    throwIfSyllabusFetchAborted(signal);
    const job = await getSyllabusLookupJob();
    if (!job || job.requestId !== requestId) {
        const error = new Error('シラバス取得ジョブが終了しました。');
        error.name = 'AbortError';
        throw error;
    }
    const openTabs = await findOpenKuportTabs(job.tabIds || []);
    if (openTabs.length > 0) {
        const error = new Error('Ku-Portが別のタブで開かれたため、シラバス取得を中止しました。');
        error.name = 'ExternalKuportError';
        throw error;
    }
}

/**
 * 対応する要求元タブへシラバス取得の処理段階を通知する。
 * @param {string} requestId - 処理と結果を対応付ける取得要求ID。
 * @param {string} phase - 要求元へ通知する取得の処理段階。
 * @returns {Promise<boolean>} 対応するジョブへ進捗を通知した場合はtrue。
 */
async function reportSyllabusLookupPhase(requestId, phase) {
    const job = await syllabusJobs.update(requestId, current => ({
        ...current,
        phase: String(phase || current.phase).slice(0, 80),
        lastProgressAt: Date.now(),
    }));
    if (!job) return false;
    try {
        await chrome.tabs.sendMessage(job.sourceTabId, {
            type: 'syllabus-lookup-phase',
            requestId,
            phase,
        });
    } catch {
        // 元のKU-LMSタブが閉じられた場合も通信処理はキャンセル時に終了する。
    }
    return true;
}

/**
 * シラバスの認証準備または直接取得を開始し、同一要求の重複開始を防ぐ。
 * @param {string} requestId - 処理と結果を対応付ける取得要求ID。
 * @param {object|null} [suppliedBootstrap=null] - 引き渡し済みの認証フォーム。未取得ならnull。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
async function startSyllabusDirectFetch(requestId, suppliedBootstrap = null) {
    if (startingSyllabusFetchRequests.has(requestId)) {
        // 認証フォームの引き渡しが、ウィンドウ開始処理の後片付けより先に届く場合がある。
        // 受け取ったフォームを保持し、開始処理の終了後に引き渡しを再開する。
        if (suppliedBootstrap || !pendingSyllabusBootstraps.has(requestId)) {
            pendingSyllabusBootstraps.set(requestId, suppliedBootstrap);
        }
        return;
    }
    startingSyllabusFetchRequests.add(requestId);
    const abortController = new AbortController();
    syllabusFetchAbortController = abortController;
    let timedOut = false;
    let unregisteredContext = null;
    const timeoutId = setTimeout(() => {
        timedOut = true;
        abortController.abort();
    }, SYLLABUS_LOOKUP_TIMEOUT_MS);
    try {
        await ensureKuportFeatureAvailable(SYLLABUS_LOOKUP_ENABLED_KEY);
        let job = await getSyllabusLookupJob();
        if (!job || job.requestId !== requestId) return;
        const bootstrap = suppliedBootstrap;
        if (!bootstrap) await reportSyllabusLookupPhase(requestId, 'opening-kuport');
        if (!bootstrap) {
            const settings = await chrome.storage.sync.get('autoLogin');
            if (settings.autoLogin === false) {
                await finishSyllabusLookup(requestId, {
                    message: '自動ログインが無効なため、Ku-Portセッションを開始できませんでした。',
                });
                return;
            }
            const existingTabs = await findOpenKuportTabs(job.tabIds || []);
            if (existingTabs.length > 0) {
                await finishSyllabusLookup(requestId, {
                    message: 'Ku-Portが別のタブで開かれたため、シラバス取得を中止しました。',
                });
                return;
            }
            const context = await createKuportLoginContext();
            unregisteredContext = { createdWindowId: context.createdWindowId, helperTabId: context.tab?.id };
            if (!Number.isInteger(context.tab?.id)) {
                await finishSyllabusLookup(requestId, {
                    message: 'Ku-Portのログイン用画面を作成できませんでした。',
                });
                return;
            }
            throwIfSyllabusFetchAborted(abortController.signal);
            const stillActiveJob = await getSyllabusLookupJob();
            if (!stillActiveJob || stillActiveJob.requestId !== requestId) {
                return;
            }
            job = await syllabusJobs.update(requestId, current => ({
                ...current,
                createdWindowId: context.createdWindowId,
                windowIds: Number.isInteger(context.createdWindowId) ? [context.createdWindowId] : [],
                helperTabId: context.tab.id,
                tabIds: [context.tab.id],
                phase: 'opening-kuport',
                awaitingSession: true,
                lastProgressAt: Date.now(),
            }));
            if (!job) return;
            unregisteredContext = null;
            throwIfSyllabusFetchAborted(abortController.signal);
            const tabsOpenedDuringProbe = await findOpenKuportTabs(job.tabIds);
            if (tabsOpenedDuringProbe.length > 0) {
                await finishSyllabusLookup(requestId, {
                    message: 'Ku-Portが別のタブで開かれたため、シラバス取得を中止しました。',
                });
                return;
            }
            await chrome.tabs.update(context.tab.id, { url: KUPORT_ENTRY_URL });
            return;
        }

        job = await getSyllabusLookupJob();
        if (!job || job.requestId !== requestId) return;
        await ensureSyllabusJobActive(requestId, abortController.signal);
        const helperJob = job;
        const directJob = await syllabusJobs.update(requestId, current => ({
            ...current,
            awaitingSession: false,
            phase: 'opening-student-schedule',
            lastProgressAt: Date.now(),
        }));
        if (!directJob) return;
        // 認証画面のIDは終了まで保持し、終了操作に失敗した場合も閉じ直せるようにする。
        if (Number.isInteger(helperJob.createdWindowId) || Number.isInteger(helperJob.helperTabId)) {
            await closeKuportLoginContext(helperJob);
        }
        await ensureSyllabusJobActive(requestId, abortController.signal);
        const result = await fetchKuportSyllabusInBackground(
            requestId,
            bootstrap,
            directJob.course,
            abortController.signal,
        );
        await ensureSyllabusJobActive(requestId, abortController.signal);
        await finishSyllabusLookup(requestId, { ok: true, result });
    } catch (error) {
        if (error.name === 'AbortError') {
            // 取消とウィンドウ登録が重なって保存されたジョブも終了対象にする。
            await finishSyllabusLookup(requestId, {
                message: timedOut ? 'シラバス取得が時間切れになりました。' : 'シラバス取得を中止しました。',
            });
            return;
        }
        if (error.name === 'ExternalKuportError') {
            await finishSyllabusLookup(requestId, {
                message: error.message,
            });
            return;
        }
        console.error('[KLPF] シラバスのバックグラウンド通信に失敗しました。', error);
        await finishSyllabusLookup(requestId, {
            message: error.message || 'シラバスの通信取得に失敗しました。',
        });
    } finally {
        clearTimeout(timeoutId);
        if (unregisteredContext) await closeKuportLoginContext(unregisteredContext);
        if (syllabusFetchAbortController === abortController) syllabusFetchAbortController = null;
        try {
            await closeKuportParser();
        } catch {
            // 解析用ドキュメントが作られていない場合は無視する。
        }
        startingSyllabusFetchRequests.delete(requestId);
        if (pendingSyllabusBootstraps.has(requestId)) {
            const pendingBootstrap = pendingSyllabusBootstraps.get(requestId);
            pendingSyllabusBootstraps.delete(requestId);
            const currentJob = await getSyllabusLookupJob();
            if (currentJob?.requestId === requestId && currentJob.awaitingSession) {
                await startSyllabusDirectFetch(requestId, pendingBootstrap);
            }
        }
    }
}

/**
 * 設定と競合状態を確認し、シラバス取得ジョブを開始する。
 * @param {object} options - この処理に必要な設定と依存処理。
 * @param {number} options.sourceTabId - 要求元のKU-LMSタブID。
 * @param {string} options.requestId - 処理と結果を対応付ける取得要求ID。
 * @param {object} options.course - 授業カードから読み取った科目・年度学期・曜日時限・教員情報。
 * @returns {Promise<object>} 開始または拒否の状態と要求ID・理由などの情報。
 */
async function beginSyllabusLookup({ sourceTabId, requestId, course }) {
    const access = await getAuthAccessState();
    if (!access.ready) return { status: 'auto-login-unavailable', message: access.reason };
    if (!Number.isInteger(sourceTabId) || typeof requestId !== 'string' || !course) {
        return { status: 'error', message: '授業情報を読み取れませんでした。' };
    }

    const [featureSettings, localSettings] = await Promise.all([
        chrome.storage.sync.get(SYLLABUS_LOOKUP_ENABLED_KEY),
        chrome.storage.local.get(INLINE_ALL_FEATURES_DISABLED_KEY),
    ]);
    if (featureSettings[SYLLABUS_LOOKUP_ENABLED_KEY] === false
        || localSettings[INLINE_ALL_FEATURES_DISABLED_KEY] === true) {
        return { status: 'feature-disabled' };
    }
    const requestedAcademicYear = normalizeAttendanceAcademicYear(course.academicYear);
    const currentAcademicYear = getCurrentAcademicYear();
    if (!requestedAcademicYear || requestedAcademicYear !== currentAcademicYear) {
        return {
            status: 'unsupported-academic-year',
            academicYear: requestedAcademicYear,
            currentAcademicYear,
        };
    }
    if (attendanceRefreshRequestPromise || bulletinFetchStartPromise) return { status: 'busy' };
    if (await hasActiveBulletinFetch()) return { status: 'busy' };

    const existingSyllabusJob = await getSyllabusLookupJob();
    if (existingSyllabusJob) {
        const isExpired = !Number.isFinite(existingSyllabusJob.startedAt)
            || Date.now() - existingSyllabusJob.startedAt > SYLLABUS_LOOKUP_TIMEOUT_MS;
        if (!isExpired) return { status: 'busy' };
        await finishSyllabusLookup(existingSyllabusJob.requestId, {
            message: 'シラバス取得が時間切れになりました。',
        });
    }

    const attendanceJobStatus = await prepareAttendanceRefreshJob();
    if (attendanceJobStatus) return { status: 'busy' };
    if (await findOpenKuportTabs().then((tabs) => tabs.length > 0)) {
        return { status: 'kuport-open' };
    }

    const job = {
        requestId,
        sourceTabId,
        course,
        transport: 'direct-fetch',
        createdWindowId: null,
        windowIds: [],
        helperTabId: null,
        tabIds: [],
        phase: 'opening-kuport',
        startedAt: Date.now(),
    };
    await syllabusJobs.create(job);
    void startSyllabusDirectFetch(requestId).catch(async (error) => {
        console.error('[KLPF] シラバス取得ジョブを開始できませんでした。', error);
        await finishSyllabusLookup(requestId, {
            message: error.message || 'シラバス取得を開始できませんでした。',
        });
    }).catch(error => {
        console.error('[KLPF] シラバス取得の終了処理に失敗しました。', error);
    });
    return { status: 'started', phase: 'opening-kuport', transport: 'direct-fetch' };
}

// 待機中は出席率、掲示板、シラバスの順に優先する。実行中の通信には割り込まない。
const queueKuportOperation = createPriorityQueue(waitForKuportIdle);
const cancelledQueuedKuportRequests = new Set();
const waitingKuportRequests = new Map();

/**
 * 要求元が一致する待機中のKu-Port取得要求にキャンセルを記録する。
 * @param {string} requestId - 処理と結果を対応付ける取得要求ID。
 * @param {number} sourceTabId - 要求元のKU-LMSタブID。
 * @returns {void} 戻り値はない。
 */
function cancelQueuedKuportRequest(requestId, sourceTabId) {
    if (waitingKuportRequests.get(requestId) === sourceTabId) {
        cancelledQueuedKuportRequests.add(requestId);
    }
}

/**
 * 3機能の取得ジョブがなくなるまで待ち、次の通信を開始できる状態にする。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
async function waitForKuportIdle() {
    for (;;) {
        const attendance = await prepareAttendanceRefreshJob();
        const syllabus = await getSyllabusLookupJob();
        if (syllabus && (!Number.isFinite(syllabus.startedAt)
            || Date.now() - syllabus.startedAt > SYLLABUS_LOOKUP_TIMEOUT_MS)) {
            await finishSyllabusLookup(syllabus.requestId, { message: 'シラバス取得が時間切れになりました。' });
            continue;
        }
        const bulletin = await hasActiveBulletinFetch();
        if (!attendance && !syllabus && !bulletin) return;
        await new Promise(resolve => { setTimeout(resolve, 300); });
    }
}

/**
 * Ku-Port取得要求を優先順位付きキューに登録し、待機中の取消を反映する。
 * @param {object|object[]} options - 呼び出し時の設定、または年度学期の選択肢一覧。
 * @param {Function} start - 待機後に取得を開始する処理。
 * @param {number} priority - 小さい値を先に実行する優先順位。
 * @returns {Promise<object>} キュー内で取得開始処理を実行した結果。
 */
function enqueueKuportRequest(options, start, priority) {
    const accountRevision = kuportAccountRevision;
    const requestId = options?.requestId;
    if (typeof requestId === 'string') waitingKuportRequests.set(requestId, options.sourceTabId);
    return queueKuportOperation(priority, async () => {
        waitingKuportRequests.delete(requestId);
        if (cancelledQueuedKuportRequests.delete(requestId) || accountRevision !== kuportAccountRevision) {
            return { status: 'cancelled' };
        }
        if (Number.isInteger(options?.sourceTabId)) {
            try { await chrome.tabs.get(options.sourceTabId); }
            catch { return { status: 'cancelled' }; }
        }
        return start(options);
    }).finally(() => {
        waitingKuportRequests.delete(requestId);
        cancelledQueuedKuportRequests.delete(requestId);
    });
}

/**
 * シラバス取得要求を共通キューへ登録する。
 * @param {object|object[]} options - 呼び出し時の設定、または年度学期の選択肢一覧。
 * @returns {Promise<object>} シラバス取得の開始結果。
 */
function requestSyllabusLookup(options) {
    return enqueueKuportRequest(options, startQueuedRequestSyllabusLookup, 3);
}
/**
 * 掲示板取得要求を共通キューへ登録する。
 * @param {object|object[]} options - 呼び出し時の設定、または年度学期の選択肢一覧。
 * @returns {Promise<object>} 掲示板取得の開始結果。
 */
function requestBulletinFetch(options) {
    return enqueueKuportRequest(options, startQueuedRequestBulletinFetch, 2);
}
/**
 * 出席率更新要求を共通キューへ登録する。
 * @param {object|object[]} [options] - 呼び出し時の設定、または年度学期の選択肢一覧。
 * @returns {Promise<object>} 出席率更新の開始結果。
 */
function requestAttendanceRateRefresh(options = {}) {
    return enqueueKuportRequest(options, startQueuedRequestAttendanceRateRefresh, 1);
}

/**
 * シラバス開始処理を共有し、同時に到着した要求の二重開始を防ぐ。
 * @param {object|object[]} options - 呼び出し時の設定、または年度学期の選択肢一覧。
 * @returns {Promise<object>} シラバス取得の開始結果を待つ共有Promise。
 */
function startQueuedRequestSyllabusLookup(options) {
    if (syllabusLookupStartPromise) return Promise.resolve({ status: 'busy' });
    const startPromise = beginSyllabusLookup(options);
    syllabusLookupStartPromise = startPromise;
    return startPromise.finally(() => {
        if (syllabusLookupStartPromise === startPromise) syllabusLookupStartPromise = null;
    });
}

/**
 * 認証用タブから開かれた子タブをシラバスジョブの所有対象へ追加する。
 * @param {object} job - 要求ID・所有タブ・取得状態を持つジョブ情報。
 * @param {object} tab - Chromeから受け取ったタブ情報。
 * @returns {Promise<object|null>} 所有情報を更新したジョブ。対象外の子タブならnull。
 */
async function trackSyllabusLookupChildTab(job, tab) {
    if (!job || !Number.isInteger(tab?.id) || job.tabIds?.includes(tab.id)) return job;
    if (!job.tabIds?.includes(tab.openerTabId)) return null;

    return syllabusJobs.update(job.requestId, current => ({
        ...current,
        tabIds: Array.from(new Set([...(current.tabIds || []), tab.id])),
    }));
}

/**
 * 所有していないKu-Portタブが開かれた場合、シラバス取得を中断する。
 * @param {object} tab - Chromeから受け取ったタブ情報。
 * @returns {Promise<boolean>} 外部タブの検出により中断した場合はtrue。
 */
async function cancelSyllabusLookupForExternalKuport(tab) {
    const job = await getSyllabusLookupJob();
    if (!job) return false;
    // 取得用に拡張機能が作成・追跡しているタブは、外部Ku-Portとして扱わない。
    // この判定がないと、ログイン用の最小化ウィンドウがKu-Portへ遷移した瞬間に
    // 自分自身を「別タブ」と誤認して、シラバス取得を中止してしまう。
    if (job.tabIds?.includes(tab?.id)) return false;
    if (await trackSyllabusLookupChildTab(job, tab)) return false;
    await finishSyllabusLookup(job.requestId, {
        message: 'Ku-Portが別のタブで開かれたため、シラバス取得を中止しました。',
    });
    return true;
}

/**
 * 要求元または所有タブの削除に合わせてシラバス取得を終了する。
 * @param {number} tabId - 処理対象のChromeタブID。
 * @returns {Promise<boolean>} 対象タブの削除により終了した場合はtrue。
 */
async function cancelSyllabusLookupForRemovedTab(tabId) {
    const job = await getSyllabusLookupJob();
    if (!job || (job.sourceTabId !== tabId && !job.tabIds?.includes(tabId))) return false;
    // 認証完了後に自分で閉じた補助タブの通知では、直接通信を中止しない。
    if (job.sourceTabId !== tabId && job.awaitingSession === false) return false;
    await finishSyllabusLookup(job.requestId, {
        message: job.sourceTabId === tabId
            ? 'KU-LMSの授業画面が閉じられたため、シラバス取得を中止しました。'
            : 'Ku-Portの取得用ウィンドウが閉じられたため、シラバス取得を中止しました。',
    });
    return true;
}

/**
 * 所有するKu-Portタブへ認証フォームの引き渡しスクリプトを注入する。
 * @param {number} tabId - 処理対象のChromeタブID。
 * @param {object} tab - Chromeから受け取ったタブ情報。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
async function injectSyllabusSessionBridge(tabId, tab) {
    let job = await getSyllabusLookupJob();
    if (job?.awaitingSession === false) return;
    if (!job?.tabIds?.includes(tabId)) {
        job = await trackSyllabusLookupChildTab(job, tab);
    }
    if (!job?.tabIds?.includes(tabId)) return;
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['features/syllabusSessionBridge.js'],
        });
    } catch (error) {
        console.debug('[KLPF] シラバス取得用のセッション確認スクリプトを注入できませんでした。', error);
        const currentJob = await getSyllabusLookupJob();
        if (currentJob?.tabIds?.includes(tabId)) {
            await finishSyllabusLookup(currentJob.requestId, {
                message: 'Ku-Portのセッション確認を開始できませんでした。',
            });
        }
    }
}

// --- KU-Port掲示板の直接取得 ---

/**
 * セッションストレージから進行中の掲示板取得ジョブを読み出す。
 * @returns {Promise<object|null>} 進行中のジョブ。保存されていなければnull。
 */
async function getBulletinFetchJob() {
    return bulletinJobs.get();
}

/**
 * 掲示板の取得ジョブが進行中か判定する。
 * @returns {Promise<boolean>} 条件を満たす場合はtrue。
 */
async function hasActiveBulletinFetch() {
    const job = await getBulletinFetchJob();
    if (!job) return false;
    if (Number.isFinite(job.startedAt) && Date.now() - job.startedAt <= BULLETIN_FETCH_TIMEOUT_MS) return true;
    await finishBulletinFetch(job.requestId, { message: '掲示板取得が時間切れになりました。' });
    return false;
}

/**
 * 掲示板取得の中断が要求されていればAbortErrorを投げる。
 * @param {AbortSignal} signal - 取得の中断を通知するシグナル。
 * @returns {void} 戻り値はない。
 */
function throwIfBulletinFetchAborted(signal) {
    if (!signal?.aborted) return;
    const error = new Error('掲示板取得が中止されました。');
    error.name = 'AbortError';
    throw error;
}

/**
 * 掲示板の要求ID・中断状態・外部Ku-Portタブを確認し、継続できない場合は停止する。
 * @param {string} requestId - 処理と結果を対応付ける取得要求ID。
 * @param {AbortSignal} signal - 取得の中断を通知するシグナル。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
async function ensureBulletinJobActive(requestId, signal) {
    await ensureKuportFeatureAvailable(BULLETIN_BOARD_ENABLED_KEY);
    throwIfBulletinFetchAborted(signal);
    const job = await getBulletinFetchJob();
    if (!job || job.requestId !== requestId) {
        const error = new Error('掲示板取得ジョブが終了しました。');
        error.name = 'AbortError';
        throw error;
    }
    const openTabs = await findOpenKuportTabs(job.tabIds || []);
    if (openTabs.length > 0) {
        const error = new Error('Ku-Portが別のタブで開かれたため、掲示板取得を中止しました。');
        error.name = 'ExternalKuportError';
        throw error;
    }
}

/**
 * 掲示板取得の処理段階をKU-LMSタブへ通知する。
 * @param {string} requestId - 処理と結果を対応付ける取得要求ID。
 * @param {string} phase - 要求元へ通知する取得の処理段階。
 * @returns {Promise<boolean>} 対応するジョブへ進捗を通知した場合はtrue。
 */
async function reportBulletinPhase(requestId, phase) {
    const job = await bulletinJobs.update(requestId, current => ({
        ...current,
        phase: String(phase || current.phase).slice(0, 80),
        lastProgressAt: Date.now(),
    }));
    if (!job) return false;
    try {
        await chrome.tabs.sendMessage(job.sourceTabId, {
            type: 'bulletin-board-phase',
            requestId,
            phase,
        });
    } catch {
        // 元のKU-LMSタブが閉じられた場合は取得側で終了させる。
    }
    return true;
}

/**
 * 掲示板ジョブを終了し、所有タブを閉じて取得結果をKU-LMSへ通知する。
 * @param {string} requestId - 処理と結果を対応付ける取得要求ID。
 * @param {object} [options={}] - この処理に必要な設定と依存処理。
 * @param {boolean} [options.ok=false] - 取得が成功したかどうか。
 * @param {object|null} [options.result=null] - 取得したデータ。失敗などで結果がない場合はnull。
 * @param {string|object} [options.message=""] - 表示する案内文、または受信した機能メッセージ。
 * @returns {Promise<boolean>} 対応するジョブを終了した場合はtrue。
 */
const finishBulletinFetch = createKuportJobFinisher(async (requestId, { ok = false, result = null, message = '' } = {}) => {
    const job = await bulletinJobs.finish(requestId, async current => {
        bulletinFetchAbortController?.abort();
        await closeKuportLoginContext(current);
    });
    if (!job) return false;
    try {
        await chrome.tabs.sendMessage(job.sourceTabId, {
            type: 'bulletin-board-result',
            requestId,
            ok,
            result,
            message,
        });
    } catch {
        // 元のKU-LMSタブが閉じられている場合も取得用ウィンドウは閉じる。
    }
    return true;
});

/**
 * 掲示板の認証準備または直接取得を開始し、結果をキャッシュへ保存する。
 * @param {string} requestId - 処理と結果を対応付ける取得要求ID。
 * @param {object|null} [suppliedBootstrap=null] - 引き渡し済みの認証フォーム。未取得ならnull。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
async function startBulletinDirectFetch(requestId, suppliedBootstrap = null) {
    if (startingBulletinFetchRequests.has(requestId)) {
        // 認証フォームの引き渡しが、ウィンドウ開始処理の後片付けより先に届く場合がある。
        // 受け取ったフォームを保持し、開始処理の終了後に引き渡しを再開する。
        if (suppliedBootstrap || !pendingBulletinBootstraps.has(requestId)) {
            pendingBulletinBootstraps.set(requestId, suppliedBootstrap);
        }
        return;
    }
    startingBulletinFetchRequests.add(requestId);
    const abortController = new AbortController();
    bulletinFetchAbortController = abortController;
    let timedOut = false;
    let unregisteredContext = null;
    const timeoutId = setTimeout(() => {
        timedOut = true;
        abortController.abort();
    }, BULLETIN_FETCH_TIMEOUT_MS);
    try {
        await ensureKuportFeatureAvailable(BULLETIN_BOARD_ENABLED_KEY);
        let job = await getBulletinFetchJob();
        if (!job || job.requestId !== requestId) return;
        let bootstrap = suppliedBootstrap;
        // 所有する認証ウィンドウの遷移が完了してからセッションを確認する。
        if (!bootstrap && job.awaitingSession) {
            bootstrap = await probeKuportSessionForBulletin(abortController.signal);
        }
        if (!bootstrap) {
            if (job.awaitingSession && Number.isInteger(job.helperTabId)) return;
            const settings = await chrome.storage.sync.get('autoLogin');
            if (settings.autoLogin === false) {
                await finishBulletinFetch(requestId, {
                    message: '自動ログインが無効なため、Ku-Portセッションを開始できませんでした。',
                });
                return;
            }
            const existingTabs = await findOpenKuportTabs(job.tabIds || []);
            if (existingTabs.length > 0) {
                await finishBulletinFetch(requestId, {
                    message: 'Ku-Portが別のタブで開かれたため、掲示板取得を中止しました。',
                });
                return;
            }
            const context = await createKuportLoginContext();
            unregisteredContext = { createdWindowId: context.createdWindowId, helperTabId: context.tab?.id };
            if (!Number.isInteger(context.tab?.id)) {
                await finishBulletinFetch(requestId, {
                    message: 'Ku-Portのログイン用画面を作成できませんでした。',
                });
                return;
            }
            throwIfBulletinFetchAborted(abortController.signal);
            const stillActiveJob = await getBulletinFetchJob();
            if (!stillActiveJob || stillActiveJob.requestId !== requestId) return;
            job = await bulletinJobs.update(requestId, current => ({
                ...current,
                createdWindowId: context.createdWindowId,
                windowIds: Number.isInteger(context.createdWindowId) ? [context.createdWindowId] : [],
                helperTabId: context.tab.id,
                tabId: context.tab.id,
                tabIds: [context.tab.id],
                phase: 'opening-kuport',
                awaitingSession: true,
                lastProgressAt: Date.now(),
            }));
            if (!job) return;
            unregisteredContext = null;
            throwIfBulletinFetchAborted(abortController.signal);
            const tabsOpenedDuringProbe = await findOpenKuportTabs(job.tabIds);
            if (tabsOpenedDuringProbe.length > 0) {
                await finishBulletinFetch(requestId, {
                    message: 'Ku-Portが別のタブで開かれたため、掲示板取得を中止しました。',
                });
                return;
            }
            await chrome.tabs.update(context.tab.id, { url: KUPORT_ENTRY_URL });
            return;
        }

        job = await getBulletinFetchJob();
        if (!job || job.requestId !== requestId) return;
        await ensureBulletinJobActive(requestId, abortController.signal);
        const helperJob = job;
        const directJob = await bulletinJobs.update(requestId, current => ({
            ...current,
            awaitingSession: false,
            phase: 'opening-bulletin-board',
            lastProgressAt: Date.now(),
        }));
        if (!directJob) return;
        if (Number.isInteger(helperJob.createdWindowId) || Number.isInteger(helperJob.helperTabId)) {
            await closeKuportLoginContext(helperJob);
        }
        await ensureBulletinJobActive(requestId, abortController.signal);
        const result = await fetchKuportBulletinInBackground(requestId, bootstrap, abortController.signal);
        await ensureBulletinJobActive(requestId, abortController.signal);
        const saved = await bulletinJobs.update(requestId, async current => {
            await ensureBulletinJobActive(requestId, abortController.signal);
            await chrome.storage.local.set({
                [BULLETIN_CACHE_KEY]: {
                    version: BULLETIN_CACHE_VERSION,
                    fetchedAt: result.fetchedAt,
                    items: result.items,
                },
            });
            await chrome.storage.session.set({ [BULLETIN_SESSION_KEY]: true });
            return current;
        });
        if (!saved) return;
        await finishBulletinFetch(requestId, { ok: true, result });
    } catch (error) {
        if (error.name === 'AbortError') {
            // 取消とウィンドウ登録が重なって保存されたジョブも終了対象にする。
            await finishBulletinFetch(requestId, {
                message: timedOut ? '掲示板取得が時間切れになりました。' : '掲示板取得を中止しました。',
            });
            return;
        }
        if (error.name === 'ExternalKuportError') {
            await finishBulletinFetch(requestId, { message: error.message });
            return;
        }
        console.error('[KLPF] Ku-port掲示板のバックグラウンド通信に失敗しました。', error);
        await finishBulletinFetch(requestId, {
            message: error.message || '掲示板の通信取得に失敗しました。',
        });
    } finally {
        clearTimeout(timeoutId);
        if (unregisteredContext) await closeKuportLoginContext(unregisteredContext);
        if (bulletinFetchAbortController === abortController) bulletinFetchAbortController = null;
        try {
            await closeKuportParser();
        } catch {
            // 解析用ドキュメントが作られていない場合は無視する。
        }
        startingBulletinFetchRequests.delete(requestId);
        if (pendingBulletinBootstraps.has(requestId)) {
            const pendingBootstrap = pendingBulletinBootstraps.get(requestId);
            pendingBulletinBootstraps.delete(requestId);
            const currentJob = await getBulletinFetchJob();
            if (currentJob?.requestId === requestId && currentJob.awaitingSession) {
                await startBulletinDirectFetch(requestId, pendingBootstrap);
            }
        }
    }
}

/**
 * 設定とブラウザセッションの更新状態を確認し、必要な掲示板取得を開始する。
 * @param {object} [options={}] - この処理に必要な設定と依存処理。
 * @param {number} options.sourceTabId - 要求元のKU-LMSタブID。
 * @param {string} options.requestId - 処理と結果を対応付ける取得要求ID。
 * @returns {Promise<object>} 開始・キャッシュ利用・拒否などの状態情報。
 */
async function beginBulletinFetch({ sourceTabId, requestId } = {}) {
    const access = await getAuthAccessState();
    if (!access.ready) return { status: 'auto-login-unavailable', message: access.reason };
    if (!Number.isInteger(sourceTabId) || typeof requestId !== 'string') {
        return { status: 'error', message: '掲示板の表示先を確認できませんでした。' };
    }
    const [featureSettings, localSettings] = await Promise.all([
        chrome.storage.sync.get([BULLETIN_BOARD_ENABLED_KEY, 'autoLogin']),
        chrome.storage.local.get(INLINE_ALL_FEATURES_DISABLED_KEY),
    ]);
    if (featureSettings[BULLETIN_BOARD_ENABLED_KEY] === false
        || localSettings[INLINE_ALL_FEATURES_DISABLED_KEY] === true) {
        return { status: 'feature-disabled' };
    }
    if (attendanceRefreshRequestPromise || syllabusLookupStartPromise) return { status: 'busy' };

    const attendanceJobStatus = await prepareAttendanceRefreshJob();
    if (attendanceJobStatus) return { status: 'busy' };
    const syllabusJob = await getSyllabusLookupJob();
    if (syllabusJob) {
        const expired = !Number.isFinite(syllabusJob.startedAt)
            || Date.now() - syllabusJob.startedAt > SYLLABUS_LOOKUP_TIMEOUT_MS;
        if (!expired) return { status: 'busy' };
    }
    const existingJob = await getBulletinFetchJob();
    if (existingJob) {
        const expired = !Number.isFinite(existingJob.startedAt)
            || Date.now() - existingJob.startedAt > BULLETIN_FETCH_TIMEOUT_MS;
        if (!expired) return { status: 'already-running' };
        await finishBulletinFetch(existingJob.requestId, { message: '掲示板取得が時間切れになりました。' });
    }
    {
        const stored = await chrome.storage.local.get(BULLETIN_CACHE_KEY);
        const cache = stored[BULLETIN_CACHE_KEY];
        if (cache?.version === BULLETIN_CACHE_VERSION
            && Number.isFinite(cache.fetchedAt)
            && (await chrome.storage.session.get(BULLETIN_SESSION_KEY))[BULLETIN_SESSION_KEY] === true
            && Array.isArray(cache.items)) {
            return {
                status: 'cached',
                result: { fetchedAt: cache.fetchedAt, items: cache.items.slice(0, BULLETIN_MAX_ITEMS) },
            };
        }
    }
    if (await findOpenKuportTabs().then(tabs => tabs.length > 0)) return { status: 'kuport-open' };

    const job = {
        requestId,
        sourceTabId,
        transport: 'direct-fetch',
        createdWindowId: null,
        windowIds: [],
        helperTabId: null,
        tabId: null,
        tabIds: [],
        phase: 'opening-kuport',
        startedAt: Date.now(),
    };
    await bulletinJobs.create(job);
    void startBulletinDirectFetch(requestId).catch(async error => {
        console.error('[KLPF] 掲示板取得ジョブを開始できませんでした。', error);
        await finishBulletinFetch(requestId, {
            message: error.message || '掲示板取得を開始できませんでした。',
        });
    }).catch(error => {
        console.error('[KLPF] 掲示板取得の終了処理に失敗しました。', error);
    });
    return { status: 'started', phase: 'opening-kuport', transport: 'direct-fetch' };
}

/**
 * 掲示板開始処理を共有し、同時に到着した要求の二重開始を防ぐ。
 * @param {object|object[]} options - 呼び出し時の設定、または年度学期の選択肢一覧。
 * @returns {Promise<object>} 掲示板の取得開始結果を待つ共有Promise。
 */
function startQueuedRequestBulletinFetch(options) {
    if (bulletinFetchStartPromise) return Promise.resolve({ status: 'already-running' });
    const startPromise = beginBulletinFetch(options);
    bulletinFetchStartPromise = startPromise;
    return startPromise.finally(() => {
        if (bulletinFetchStartPromise === startPromise) bulletinFetchStartPromise = null;
    });
}

/**
 * 所有タブの読み込み完了後にフォームを読み取り、掲示板の直接取得を続行する。
 * @param {number} tabId - 処理対象のChromeタブID。
 * @param {object} changeInfo - Chromeのタブ更新イベントの変更内容。
 * @param {object} tab - Chromeから受け取ったタブ情報。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
async function continueBulletinFetch(tabId, changeInfo, tab) {
    const job = await getBulletinFetchJob();
    if (!job || job.tabId !== tabId || changeInfo.status !== 'complete') return;
    if (job.awaitingSession === false) return;
    const url = changeInfo.url || tab.url || '';
    let hostname = '';
    try {
        hostname = new URL(url).hostname;
    } catch {
        return;
    }
    if (!hostname) return;
    if (!KUPORT_TRANSITION_HOSTS.has(hostname)) {
        await finishBulletinFetch(job.requestId, { message: 'Ku-Portのログイン遷移を確認できませんでした。' });
        return;
    }
    if (hostname !== 'ku-port.sc.kogakuin.ac.jp') return;
    if (tab.title === 'Error Page') {
        await finishBulletinFetch(job.requestId, { message: 'Ku-Portのログインに失敗しました。' });
        return;
    }
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['features/bulletinSessionBridge.js'],
        });
        await ensureBulletinJobActive(job.requestId, bulletinFetchAbortController?.signal);
        const response = await chrome.tabs.sendMessage(tabId, {
            type: 'klpf-bulletin-session-bootstrap',
        });
        if (response?.status === 'session-ready') {
            void startBulletinDirectFetch(job.requestId, response).catch(error => {
                console.error('[KLPF] 掲示板取得の終了処理に失敗しました。', error);
            });
            return;
        }
        if (response?.status === 'menu-not-ready') {
            // ログイン後にメニュー画面が表示された場合は、画面内に掲示カードが
            // なくてもService Worker側で掲示板URLを直接確認する。
            void startBulletinDirectFetch(job.requestId).catch(error => {
                console.error('[KLPF] 掲示板取得の終了処理に失敗しました。', error);
            });
            return;
        }
        await finishBulletinFetch(job.requestId, {
            message: response?.status === 'kuport-error'
                ? 'Ku-Portのログイン状態を確認できませんでした。'
                : 'Ku-Portのセッション情報を取得できませんでした。',
        });
    } catch {
        // ページ内のAutoLogin/掲示板ブリッジの初期化を待つ。
    }
}

/**
 * 所有していないKu-Portタブが開かれた場合、掲示板取得を中断する。
 * @param {object} tab - Chromeから受け取ったタブ情報。
 * @returns {Promise<boolean>} 外部タブの検出により中断した場合はtrue。
 */
async function cancelBulletinFetchForExternalKuport(tab) {
    const job = await getBulletinFetchJob();
    if (!job) return false;
    if (job.tabIds?.includes(tab?.id)) return false;
    await finishBulletinFetch(job.requestId, {
        message: 'Ku-Portが別のタブで開かれたため、掲示板取得を中止しました。',
    });
    return true;
}

/**
 * 要求元または所有タブの削除に合わせて掲示板取得を終了する。
 * @param {number} tabId - 処理対象のChromeタブID。
 * @returns {Promise<boolean>} 対象タブの削除により終了した場合はtrue。
 */
async function cancelBulletinFetchForRemovedTab(tabId) {
    const job = await getBulletinFetchJob();
    if (!job || (job.sourceTabId !== tabId && !job.tabIds?.includes(tabId))) return false;
    // 認証完了後に自分で閉じた補助タブの通知では、直接通信を中止しない。
    if (job.sourceTabId !== tabId && job.awaitingSession === false) return false;
    await finishBulletinFetch(job.requestId, {
        message: job.sourceTabId === tabId
            ? 'KU-LMSのホーム画面が閉じられたため、掲示板取得を中止しました。'
            : 'Ku-Portの取得用ウィンドウが閉じられたため、掲示板取得を中止しました。',
    });
    return true;
}

/**
 * 出席率取得の診断状態をKU-LMSへ通知する。
 * @param {string} stage - 診断状態を通知する処理段階。
 * @param {object} [details] - 処理段階とともに通知する診断情報。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
async function reportAttendanceDebug(stage, details = {}) {
    const message = {
        type: 'klpf-attendance-debug',
        stage,
        details,
        timestamp: Date.now(),
    };
    // 診断通知の失敗によって、認証画面の終了などの本処理を止めない。
    const tabs = await chrome.tabs.query({ url: LMS_HOME_URL_PATTERNS }).catch(() => []);
    await Promise.all(tabs.map(async tab => {
        try {
            await chrome.tabs.sendMessage(tab.id, message);
        } catch {
            // 対象タブでcontent scriptが準備中の場合はService Workerのログだけ残す。
        }
    }));
}

/**
 * 出席率取得用に作成したウィンドウまたはタブを閉じる。
 * @param {object} job - 要求ID・所有タブ・取得状態を持つジョブ情報。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
async function closeCreatedAttendanceContext(job) {
    if (!job?.createdByExtension) return;
    await closeKuportLoginContext({ ...job, helperTabId: job.tabId });
}

/**
 * 出席率取得を終了し、ジョブと認証用画面を片付けて状態を通知する。
 * @param {number} tabId - 処理対象のChromeタブID。
 * @param {*} status - 処理の終了状態。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
const finishAttendanceFetch = createKuportJobFinisher(async (tabId, status) => {
    const job = await attendanceJobs.finish(tabId, async current => {
        attendanceFetchAbortController?.abort();
        await closeCreatedAttendanceContext(current);
        if (status === 'completed' && !current.manual) {
            await recordAttendanceRefreshCooldown();
        }
    });
    if (!job) return;
    await setAttendanceBrowserSessionYear(job.academicYear, {
        status,
        finishedAt: Date.now(),
    });
    await reportAttendanceDebug('処理終了', {
        status,
        academicYear: job.academicYear,
    });
});

/**
 * 入力を有効な4桁の年度文字列へそろえる。
 * @param {*} value - 検証・変換する入力値。
 * @returns {string} 照合用に整えた文字列。
 */
function normalizeAttendanceAcademicYear(value) {
    const year = String(value || '').trim().normalize('NFKC');
    return /^\d{4}$/.test(year) ? year : '';
}

/**
 * 現在の日付から4月始まりの年度を求める。
 * @returns {string} 4月始まりの年度を表す4桁の文字列。
 */
function getCurrentAcademicYear() {
    const now = new Date();
    return String(now.getFullYear() - (now.getMonth() < 3 ? 1 : 0));
}

/**
 * ブラウザセッション内の出席率取得状態を読み出す。
 * @returns {Promise<object>} ブラウザセッション内の年度別取得状態。
 */
async function getAttendanceBrowserSession() {
    const stored = await chrome.storage.session.get(ATTENDANCE_BROWSER_SESSION_KEY);
    const session = stored[ATTENDANCE_BROWSER_SESSION_KEY];
    return session && typeof session === 'object' ? session : { years: {} };
}

/**
 * 指定年度のブラウザセッション内取得状態を読み出す。
 * @param {string} academicYear - 取得または表示の対象年度。
 * @returns {Promise<object|null>} 指定年度の取得状態。記録がなければnull。
 */
async function getAttendanceBrowserSessionYear(academicYear) {
    const year = normalizeAttendanceAcademicYear(academicYear);
    if (!year) return null;
    const session = await getAttendanceBrowserSession();
    return session.years?.[year] || null;
}

/**
 * 指定年度のブラウザセッション内取得状態を保存する。
 * @param {string} academicYear - 取得または表示の対象年度。
 * @param {*} value - 検証・変換する入力値。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
async function setAttendanceBrowserSessionYear(academicYear, value) {
    const year = normalizeAttendanceAcademicYear(academicYear);
    if (!year) return;
    const session = await getAttendanceBrowserSession();
    await chrome.storage.session.set({
        [ATTENDANCE_BROWSER_SESSION_KEY]: {
            years: {
                ...(session.years || {}),
                [year]: value,
            },
            academicYear: year,
        },
    });
}

/**
 * 指定年度のブラウザセッション内取得状態を削除する。
 * @param {string} academicYear - 取得または表示の対象年度。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
async function clearAttendanceBrowserSessionYear(academicYear) {
    const year = normalizeAttendanceAcademicYear(academicYear);
    if (!year) return;
    const session = await getAttendanceBrowserSession();
    const years = { ...(session.years || {}) };
    delete years[year];
    if (Object.keys(years).length === 0) {
        await chrome.storage.session.remove(ATTENDANCE_BROWSER_SESSION_KEY);
        return;
    }
    await chrome.storage.session.set({
        [ATTENDANCE_BROWSER_SESSION_KEY]: {
            years,
            academicYear: Object.keys(years).pop(),
        },
    });
}

/**
 * 出席率キャッシュから年度ごとの更新時刻を取り出す。
 * @param {object} cache - 読み出した取得結果と更新時刻のキャッシュ。
 * @returns {object} 年度をキーとする更新時刻の対応表。
 */
function getAttendanceCacheUpdateTimes(cache) {
    const updateTimes = { ...(cache?.updatedAtByYear || {}) };
    const cachedYear = normalizeAttendanceAcademicYear(cache?.academicYear);
    if (cachedYear && Number.isFinite(cache?.updatedAt)
        && !Number.isFinite(updateTimes[cachedYear])) {
        updateTimes[cachedYear] = cache.updatedAt;
    }
    return updateTimes;
}

/**
 * 出席率キャッシュから年度ごとの取得完了時刻を取り出す。
 * @param {object} cache - 読み出した取得結果と更新時刻のキャッシュ。
 * @returns {object} 年度をキーとする全クォーター取得完了時刻の対応表。
 */
function getAttendanceCacheCompletionTimes(cache) {
    // 単一クォーターの読み取りでもupdatedAtByYearは更新されるため、
    // 年度全体の取得完了時刻はこのバックグラウンド処理だけで保存する。
    return { ...(cache?.completedAtByYear || {}) };
}

/**
 * 科目・曜日・時限・学期から出席記録をまとめるためのキーを作る。
 * @param {object} record - 科目・曜日時限・出席率などの出席記録。
 * @returns {string} 出席記録の統合用キー。
 */
function getAttendanceRecordKey(record) {
    return [record.academicYear, record.quarter, record.schedule, record.normalizedName].join('|');
}

/**
 * 所有するKu-Portタブへ出席表の読み取りまたは認証フォームの引き渡しを依頼する。
 * @param {number} tabId - 処理対象のChromeタブID。
 * @param {string} [mode="capture"] - 読み取りまたは表示の処理モード。
 * @returns {Promise<object|null>} タブ側の処理状態を示す応答。送信できなければnull。
 */
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

/**
 * 学期選択肢の値と表示名から年度・クォーターを解析する。
 * @param {string} [termValue=""] - Ku-Portの学期選択肢の値。
 * @param {string} [termLabel=""] - Ku-Portの学期選択肢の表示名。
 * @returns {object} 年度とクォーター。解析できない項目は空文字列またはnull。
 */
function parseAttendanceTerm(termValue = '', termLabel = '') {
    const value = String(termValue || '').trim().normalize('NFKC');
    const label = String(termLabel || '').trim().normalize('NFKC');
    const valueMatch = value.match(/^(\d{4})\|0?([1-4])$/);
    const yearMatch = value.match(/^(\d{4})$/) || label.match(/(\d{4})\s*年度?/);
    const quarterMatch = label.match(/([1-4])\s*Q/i) || label.match(/Q\s*([1-4])/i);
    return {
        academicYear: valueMatch?.[1] || yearMatch?.[1] || '',
        quarter: valueMatch ? Number(valueMatch[2]) : quarterMatch ? Number(quarterMatch[1]) : null,
    };
}

/**
 * 認証フォームから出席画面へ進み、対象年度の各クォーターを順番に取得する。
 * @param {object} bootstrap - 認証後に読み取った送信先とフォームフィールド。
 * @param {AbortSignal} signal - 取得の中断を通知するシグナル。
 * @param {string} [requestedAcademicYear=""] - 取得要求で指定された年度。
 * @param {number} tabId - 保存処理を対応付ける取得ジョブのタブID。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
async function fetchKuportAttendanceInBackground(bootstrap, signal, requestedAcademicYear, tabId) {
    await reportAttendanceDebug('バックグラウンド通信開始');
    throwIfAttendanceFetchAborted(signal);
    await ensureKuportFeatureAvailable(ATTENDANCE_RATE_FEATURE_KEY);
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
    await ensureKuportFeatureAvailable(ATTENDANCE_RATE_FEATURE_KEY);

    const attendancePageHtml = await attendancePageResponse.text();
    const attendanceForm = await parseKuportDocument('parse-attendance-form', {
        html: attendancePageHtml,
        baseUrl: attendancePageResponse.url,
    });
    throwIfAttendanceFetchAborted(signal);
    await ensureKuportFeatureAvailable(ATTENDANCE_RATE_FEATURE_KEY);
    await reportAttendanceDebug('出席フォーム解析成功', {
        academicTerm: attendanceForm.academicTerm || '',
    });
    const attendanceAction = assertKuportUrl(attendanceForm.action);
    const termOptions = Array.isArray(attendanceForm.termOptions) ? attendanceForm.termOptions : [];
    const selectedTerm = termOptions.find(option => option.value === attendanceForm.selectedTermValue)
        || termOptions.find(option => option.label === attendanceForm.academicTerm);
    const selectedTermInfo = parseAttendanceTerm(
        selectedTerm?.value || attendanceForm.selectedTermValue || '',
        selectedTerm?.label || attendanceForm.academicTerm || '',
    );
    const academicYear = normalizeAttendanceAcademicYear(requestedAcademicYear)
        || selectedTermInfo.academicYear;
    const yearTerms = termOptions.map(option => ({
        ...option,
        ...parseAttendanceTerm(option.value, option.label),
    })).filter(option => option.academicYear === academicYear && Number.isInteger(option.quarter));
    const termsByQuarter = new Map(yearTerms.map(option => [option.quarter, option]));
    const availableQuarters = [1, 2, 3, 4].filter(quarter => termsByQuarter.has(quarter));
    if (!academicYear || availableQuarters.length === 0) {
        throw new Error('Ku-portの表示条件から同じ年度の四半期を確認できませんでした。');
    }
    const termFieldName = attendanceForm.termFieldName || 'funcForm:kaikoNendoGakki_input';
    let latestViewState = attendanceForm.fields
        ?.find(([name]) => name === 'javax.faces.ViewState')?.[1] || '';
    const records = [];

    for (const quarter of availableQuarters) {
        throwIfAttendanceFetchAborted(signal);
        await ensureKuportFeatureAvailable(ATTENDANCE_RATE_FEATURE_KEY);
        const term = termsByQuarter.get(quarter);
        const displayBody = createFormBody(attendanceForm.fields);
        displayBody.set(termFieldName, term.value);
        if (latestViewState) displayBody.set('javax.faces.ViewState', latestViewState);
        displayBody.set('javax.faces.partial.ajax', 'true');
        displayBody.set('javax.faces.source', 'funcForm:btnHyoji');
        displayBody.set(
            'javax.faces.partial.execute',
            `${ATTENDANCE_TERM_COMPONENT_ID} funcForm:btnHyoji`
        );
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
            throw new Error(`Ku-port ${quarter}Q出席表取得エラー: ${attendanceResponse.status}`);
        }
        const response = await parseKuportDocument('parse-attendance-response', {
            html: await attendanceResponse.text(),
        });
        if (response.viewState) latestViewState = response.viewState;
        if (Array.isArray(response.records)) {
            records.push(...response.records.map(record => ({
                ...record,
                academicYear,
                quarter,
                termValue: term.value,
                academicTerm: term.label,
            })));
        }
        await reportAttendanceDebug(`${quarter}Q出席表Ajax取得成功`, {
            status: attendanceResponse.status,
            recordCount: response.records?.length || 0,
        });
    }

    throwIfAttendanceFetchAborted(signal);
    await ensureKuportFeatureAvailable(ATTENDANCE_RATE_FEATURE_KEY);
    if (records.length === 0) throw new Error('Ku-portの出席表に科目が見つかりませんでした。');
    await reportAttendanceDebug('存在する四半期の出席表解析成功', {
        recordCount: records.length,
        quarters: availableQuarters,
        numericRateCount: records.filter(record => Number.isFinite(record.rate)).length,
    });
    throwIfAttendanceFetchAborted(signal);
    await ensureKuportFeatureAvailable(ATTENDANCE_RATE_FEATURE_KEY);

    const saved = await attendanceJobs.update(tabId, async current => {
        throwIfAttendanceFetchAborted(signal);
        await ensureKuportFeatureAvailable(ATTENDANCE_RATE_FEATURE_KEY);
        const stored = await chrome.storage.local.get(ATTENDANCE_CACHE_KEY);
        const existingCache = stored[ATTENDANCE_CACHE_KEY];
        const mergedRecords = new Map();
        for (const record of Array.isArray(existingCache?.records) ? existingCache.records : []) {
            if (String(record.academicYear) === String(academicYear)) continue;
            mergedRecords.set(getAttendanceRecordKey(record), record);
        }
        for (const record of records) mergedRecords.set(getAttendanceRecordKey(record), record);

        const updatedAt = Date.now();
        const updatedAtByYear = getAttendanceCacheUpdateTimes(existingCache);
        updatedAtByYear[academicYear] = updatedAt;
        const completedAtByYear = getAttendanceCacheCompletionTimes(existingCache);
        completedAtByYear[academicYear] = updatedAt;
        await chrome.storage.local.set({
            [ATTENDANCE_CACHE_KEY]: {
                version: ATTENDANCE_CACHE_VERSION,
                updatedAt,
                updatedAtByYear,
                completedAtByYear,
                academicYear,
                academicTerm: `${academicYear}年度 ${availableQuarters.map(quarter => `${quarter}Q`).join('・')}`,
                records: Array.from(mergedRecords.values()),
            },
        });
        return current;
    });
    if (!saved) throwIfAttendanceFetchAborted({ aborted: true });
    await reportAttendanceDebug('新しい出席率キャッシュを保存', {
        recordCount: records.length,
        academicYear,
    });
}

/**
 * 同一タブの重複実行を防ぎながら出席率の直接取得とキャッシュ保存を行う。
 * @param {number} tabId - 処理対象のChromeタブID。
 * @param {object} bootstrap - 認証後に読み取った送信先とフォームフィールド。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
async function startBackgroundAttendanceFetch(tabId, bootstrap) {
    if (startingBackgroundAttendanceTabs.has(tabId)) return;
    startingBackgroundAttendanceTabs.add(tabId);

    const abortController = new AbortController();
    attendanceFetchAbortController = abortController;
    try {
        const job = await getAttendanceFetchJob();
        if (!job || job.tabId !== tabId || job.phase !== 'login-tab') return;
        const updated = await attendanceJobs.update(tabId, current => ({
            ...current,
            phase: 'background-fetch',
        }));
        if (!updated) return;
        if (job.createdByExtension) {
            await reportAttendanceDebug('Ku-portログイン完了・一時画面を閉じます');
            await closeCreatedAttendanceContext(job);
        }
        await fetchKuportAttendanceInBackground(
            bootstrap,
            abortController.signal,
            job.academicYear,
            tabId,
        );
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

/**
 * 進行中の出席率ジョブを確認し、期限切れのジョブを片付ける。
 * @returns {Promise<object|null>} 継続中ならalready-runningの状態情報。ジョブがなければnull。
 */
async function prepareAttendanceRefreshJob() {
    const currentJob = await getAttendanceFetchJob();
    if (!currentJob) return null;

    const isExpired = !Number.isFinite(currentJob.startedAt)
        || Date.now() - currentJob.startedAt > ATTENDANCE_FETCH_JOB_TIMEOUT_MS;
    if (isExpired) {
        await finishAttendanceFetch(currentJob.tabId, 'timeout');
        return null;
    }
    if (currentJob.phase === 'background-fetch') {
        return {
            status: 'already-running',
            academicYear: currentJob.academicYear,
        };
    }
    try {
        await chrome.tabs.get(currentJob.tabId);
        return {
            status: 'already-running',
            academicYear: currentJob.academicYear,
        };
    } catch {
        await finishAttendanceFetch(currentJob.tabId, 'login-tab-closed');
    }
    return null;
}

/**
 * 出席率取得の対象タブと所有情報・年度をセッションストレージへ保存する。
 * @param {number} tabId - 処理対象のChromeタブID。
 * @param {object} [options={}] - この処理に必要な設定と依存処理。
 * @param {boolean} [options.createdByExtension=false] - 対象画面を拡張機能が作成したかどうか。
 * @param {number|null} [options.createdWindowId=null] - 拡張機能が作成した認証ウィンドウのID。
 * @param {boolean} [options.manual=false] - ユーザー操作による更新要求かどうか。
 * @param {string} [options.academicYear=""] - 取得または表示の対象年度。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
async function setAttendanceFetchJob(
    tabId,
    {
        createdByExtension = false,
        createdWindowId = null,
        manual = false,
        academicYear = '',
    } = {}
) {
    const year = normalizeAttendanceAcademicYear(academicYear);
    if (year) {
        await setAttendanceBrowserSessionYear(year, {
            status: 'running',
            startedAt: Date.now(),
        });
    }
    await attendanceJobs.create({
            tabId,
            startedAt: Date.now(),
            createdByExtension,
            createdWindowId,
            manual,
            academicYear: year,
            phase: 'login-tab',
    });
}

/**
 * 競合を確認し、出席率取得用の認証画面とジョブを作成する。
 * @param {object} [options={}] - この処理に必要な設定と依存処理。
 * @param {boolean} [options.abortIfKuportOpen=false] - 既存Ku-Portタブがあれば開始を中止するかどうか。
 * @param {boolean} [options.manual=false] - ユーザー操作による更新要求かどうか。
 * @param {string} [options.academicYear=""] - 取得または表示の対象年度。
 * @returns {Promise<object>} 開始のstatus。既存Ku-Portタブがある場合はkuport-open。
 */
async function startAttendanceLoginFlow({
    abortIfKuportOpen = false,
    manual = false,
    academicYear = '',
} = {}) {
    await ensureKuportFeatureAvailable(ATTENDANCE_RATE_FEATURE_KEY);
    const createdContext = await createKuportLoginContext();
    const tab = createdContext.tab;
    let started = false;
    try {
        if (!Number.isInteger(tab?.id)) throw new Error('Ku-Portのログイン用画面を作成できませんでした。');
        await setAttendanceFetchJob(tab.id, {
            createdByExtension: true,
            createdWindowId: createdContext.createdWindowId,
            manual,
            academicYear,
        });
        try {
            await ensureKuportFeatureAvailable(ATTENDANCE_RATE_FEATURE_KEY);
        } catch (error) {
            await finishAttendanceFetch(tab.id, 'feature-disabled');
            await clearAttendanceBrowserSessionYear(academicYear);
            return { status: 'feature-disabled', message: error.message };
        }
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
        const currentJob = await getAttendanceFetchJob();
        if (currentJob?.tabId !== tab.id) return { status: 'cancelled' };
        await chrome.tabs.update(tab.id, { url: KUPORT_ENTRY_URL });
        started = true;
        return { status: 'started' };
    } catch (error) {
        try {
            if (Number.isInteger(tab?.id)) await finishAttendanceFetch(tab.id, 'start-error');
        } catch (cleanupError) {
            console.error('[KLPF] 出席率取得の開始失敗を処理できませんでした。', cleanupError);
        }
        throw error;
    } finally {
        if (!started) {
            // ジョブ保存前の失敗でも、作成済みの画面を必ず終了対象にする。
            await closeKuportLoginContext({
                createdWindowId: createdContext.createdWindowId,
                helperTabId: tab?.id,
            });
        }
    }
}

/**
 * 設定・同意・対象年度・更新間隔を確認し、出席率の更新を実行する。
 * @param {object} [options={}] - この処理に必要な設定と依存処理。
 * @param {boolean} [options.manual=false] - ユーザー操作による更新要求かどうか。
 * @param {string} [options.academicYear=""] - 取得または表示の対象年度。
 * @returns {Promise<object>} 更新要求の受付状態と、必要に応じて拒否理由や待機秒数。
 */
async function executeAttendanceRateRefresh({ manual = false, academicYear = '' } = {}) {
    const access = await getAuthAccessState();
    if (!access.ready) return { status: 'auto-login-unavailable', message: access.reason };
    if (syllabusLookupStartPromise || bulletinFetchStartPromise) return { status: 'kuport-operation-busy' };
    if (await hasActiveBulletinFetch()) return { status: 'kuport-operation-busy' };
    const syllabusJob = await getSyllabusLookupJob();
    if (syllabusJob) {
        const syllabusJobExpired = !Number.isFinite(syllabusJob.startedAt)
            || Date.now() - syllabusJob.startedAt > SYLLABUS_LOOKUP_TIMEOUT_MS;
        if (!syllabusJobExpired) return { status: 'kuport-operation-busy' };
        await finishSyllabusLookup(syllabusJob.requestId, {
            message: 'シラバス取得が時間切れになりました。',
        });
    }

    const year = normalizeAttendanceAcademicYear(academicYear);
    const currentAcademicYear = getCurrentAcademicYear();
    if (year !== currentAcademicYear) {
        return {
            status: 'unsupported-academic-year',
            academicYear: year,
            currentAcademicYear,
        };
    }
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

    if (!manual && year) {
        const browserSessionYear = await getAttendanceBrowserSessionYear(year);
        if (browserSessionYear) {
            const previousStatus = browserSessionYear.status;
            if (previousStatus === 'running') {
                const currentJob = await getAttendanceFetchJob();
                const jobIsActive = currentJob?.academicYear === year
                    && Number.isFinite(currentJob.startedAt)
                    && Date.now() - currentJob.startedAt <= ATTENDANCE_FETCH_JOB_TIMEOUT_MS;
                if (jobIsActive) return { status: 'already-running', academicYear: year };
                await clearAttendanceBrowserSessionYear(year);
            } else {
                await reportAttendanceDebug('このブラウザ起動中は取得済み', {
                    status: previousStatus,
                    academicYear: year,
                });
                return {
                    status: 'browser-session-already-checked',
                    previousStatus,
                    academicYear: year,
                };
            }
        }
    }

    const runningStatus = await prepareAttendanceRefreshJob();
    if (runningStatus) return runningStatus;

    if (manual) {
        const openKuportTabs = await chrome.tabs.query({ url: KUPORT_URL_PATTERN });
        if (openKuportTabs.length > 0) {
            await reportAttendanceDebug('Ku-portが開いているため手動更新を中止', {
                academicYear: year,
            });
            return { status: 'kuport-open' };
        }
        const remainingSeconds = await checkManualRefreshCooldown();
        if (remainingSeconds > 0) return { status: 'cooldown', remainingSeconds };
        await reportAttendanceDebug('出席状況の手動更新を開始', {
            academicYear: year,
        });

        return startAttendanceLoginFlow({
            abortIfKuportOpen: true,
            manual: true,
            academicYear: year,
        });
    }

    const existingTabs = await chrome.tabs.query({ url: KUPORT_URL_PATTERN });
    if (existingTabs.length > 0) {
        await setAttendanceBrowserSessionYear(year, {
            status: 'skipped-kuport-already-open',
            finishedAt: Date.now(),
        });
        await reportAttendanceDebug('Ku-portが既に開いているため自動取得中止', {
            academicYear: year,
        });
        return { status: 'kuport-already-open' };
    }

    return startAttendanceLoginFlow({ academicYear: year });
}

/**
 * 同年度の更新要求を共有し、出席率の二重取得を防ぐ。
 * @param {object|object[]} [options] - 呼び出し時の設定、または年度学期の選択肢一覧。
 * @returns {Promise<object>} 出席率の取得開始結果を待つ共有Promise。
 */
function startQueuedRequestAttendanceRateRefresh(options = {}) {
    if (attendanceRefreshRequestPromise) {
        return Promise.resolve({
            status: 'already-running',
            academicYear: attendanceRefreshRequestYear,
        });
    }

    attendanceRefreshRequestYear = normalizeAttendanceAcademicYear(options.academicYear);
    const requestPromise = executeAttendanceRateRefresh(options);
    attendanceRefreshRequestPromise = requestPromise;
    return requestPromise.finally(() => {
        if (attendanceRefreshRequestPromise === requestPromise) {
            attendanceRefreshRequestPromise = null;
            attendanceRefreshRequestYear = '';
        }
    });
}

/**
 * 所有していないKu-Portタブが開かれた場合、出席率取得を中断する。
 * @param {number} tabId - 処理対象のChromeタブID。
 * @returns {Promise<boolean>} 外部タブの検出により中断した場合はtrue。
 */
async function cancelAttendanceFetchForUserKuport(tabId) {
    const job = await getAttendanceFetchJob();
    if (!job || job.tabId === tabId) return false;

    attendanceFetchAbortController?.abort();
    await finishAttendanceFetch(job.tabId, 'cancelled-kuport-opened');
    await reportAttendanceDebug('Ku-portが別タブで開かれたため出席状況の取得中止', {
        academicYear: job.academicYear,
    });
    return true;
}

/**
 * 所有タブの遷移状態を確認し、出席率取得の認証処理を続行する。
 * @param {number} tabId - 処理対象のChromeタブID。
 * @param {object} changeInfo - Chromeのタブ更新イベントの変更内容。
 * @param {object} tab - Chromeから受け取ったタブ情報。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
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
 * 設定ページを開くコンテキストメニューを作り直す。
 * 更新前のメニューが残っている場合も、Chromeへ重複IDのエラーを記録させない。
 * @returns {void} 戻り値はない。
 */
function replaceOptionsContextMenu() {
    chrome.contextMenus.remove(CONTEXT_MENU_ID, () => {
        // 未作成の場合のlastErrorは想定内。コールバック内で参照して処理済みにする。
        void chrome.runtime.lastError;
        chrome.contextMenus.create({
            id: CONTEXT_MENU_ID,
            title: '[KLPF] 設定を開く',
            contexts: ['page'],
        }, () => {
            const error = chrome.runtime.lastError;
            if (error) console.error('[KLPF] コンテキストメニューを作成できませんでした。', error);
        });
    });
}

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
    }

    replaceOptionsContextMenu();
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
        await syncContentScriptWithSettings(CONTENT_SCRIPT_BY_STORAGE_KEY.get(ATTENDANCE_RATE_FEATURE_KEY));
    }

    for (const [key, { newValue }] of Object.entries(changes)) {
        const config = CONTENT_SCRIPT_BY_STORAGE_KEY.get(key);
        if (!config) continue;

        if (newValue) {
            if (key === ATTENDANCE_RATE_FEATURE_KEY) {
                const consent = await chrome.storage.sync.get(ATTENDANCE_RATE_CONSENT_KEY);
                if (consent[ATTENDANCE_RATE_CONSENT_KEY] !== true) {
                    await chrome.storage.sync.set({ [ATTENDANCE_RATE_FEATURE_KEY]: false });
                    await syncContentScriptWithSettings(config);
                    continue;
                }
            }
            if (key === 'searchSubject') {
                await enableAutomaticSubjectFilter();
            }

            // 登録内容が同一ならモジュール側でChrome API呼び出しを省略する。
            await syncContentScriptWithSettings(config);

            // 「自動出席」が有効な場合、「Meet自動参加」も有効にする依存関係を処理
            if (key === 'autoAttend') {
                await applyAutoAttendDependency();
            }
        } else {
            // 機能が無効になった場合、スクリプトを解除する
            await syncContentScriptWithSettings(config);

            // 自動出席をOFFにしても、Meetミュート参加の設定がONなら登録を維持する。
            if (key === 'autoAttend') {
                await applyAutoAttendDependency();
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
            if (isKuportUrl(url)) {
                const attendanceCancelled = await cancelAttendanceFetchForUserKuport(tabId);
                const syllabusCancelled = await cancelSyllabusLookupForExternalKuport(tab);
                const bulletinCancelled = await cancelBulletinFetchForExternalKuport(tab);
                if (attendanceCancelled || syllabusCancelled || bulletinCancelled) return;
                if (changeInfo.status === 'complete') await injectSyllabusSessionBridge(tabId, tab);
            }
        } catch {
            // URLがまだ確定していない更新は通常の継続判定へ渡す。
        }
        await continueAttendanceFetch(tabId, changeInfo, tab);
        await continueBulletinFetch(tabId, changeInfo, tab);
    })().catch(error => {
        console.error('[KLPF] Ku-port取得処理の継続に失敗しました。', error);
    });
});

chrome.tabs.onRemoved.addListener((tabId) => {
    void (async () => {
        await cancelSyllabusLookupForRemovedTab(tabId);
        await cancelBulletinFetchForRemovedTab(tabId);
        const job = await getAttendanceFetchJob();
        if (job?.tabId !== tabId || job.phase === 'background-fetch') return;
        await finishAttendanceFetch(tabId, 'login-tab-closed');
    })().catch(error => {
        console.error('[KLPF] タブ終了後のKu-Port取得を片付けられませんでした。', error);
    });
});

chrome.tabs.onCreated.addListener((tab) => {
    void (async () => {
        const job = await getSyllabusLookupJob();
        if (job?.tabIds?.includes(tab.openerTabId) && Number.isInteger(tab.id)) {
            await trackSyllabusLookupChildTab(job, tab);
        }
        if (isKuportUrl(tab.pendingUrl || tab.url || '')) {
            await cancelAttendanceFetchForUserKuport(tab.id);
            await cancelSyllabusLookupForExternalKuport(tab);
            await cancelBulletinFetchForExternalKuport(tab);
        }
    })().catch((error) => {
        console.debug('[KLPF] シラバス取得で開いたKu-Port画面を追跡できませんでした。', error);
    });
});

chrome.windows.onRemoved.addListener((windowId) => {
    void (async () => {
        const job = await getSyllabusLookupJob();
        if (job?.awaitingSession !== false && job?.windowIds?.includes(windowId)) {
            await finishSyllabusLookup(job.requestId, {
                message: 'Ku-Portの取得用ウィンドウが閉じられたため、シラバス取得を中止しました。',
            });
        }
        const bulletinJob = await getBulletinFetchJob();
        if (bulletinJob?.awaitingSession !== false && bulletinJob?.windowIds?.includes(windowId)) {
            await finishBulletinFetch(bulletinJob.requestId, {
                message: 'Ku-Portの取得用ウィンドウが閉じられたため、掲示板取得を中止しました。',
            });
        }
    })().catch(error => {
        console.error('[KLPF] ウィンドウ終了後のKu-Port取得を片付けられませんでした。', error);
    });
});

chrome.storage.onChanged.addListener((changes, area) => {
    const featureDisabled = area === 'sync'
        && changes[SYLLABUS_LOOKUP_ENABLED_KEY]?.newValue === false;
    const allFeaturesDisabled = area === 'local'
        && changes[INLINE_ALL_FEATURES_DISABLED_KEY]?.newValue === true;
    if (featureDisabled || allFeaturesDisabled) {
        void getSyllabusLookupJob().then((job) => {
            if (!job) return;
            return finishSyllabusLookup(job.requestId, {
                message: 'シラバス表示がOFFになったため、取得を中止しました。',
            });
        }).catch((error) => {
            console.debug('[KLPF] シラバス取得の停止を反映できませんでした。', error);
        });
    }

    const bulletinDisabled = area === 'sync'
        && changes[BULLETIN_BOARD_ENABLED_KEY]?.newValue === false;
    if (!bulletinDisabled && !allFeaturesDisabled) return;
    void getBulletinFetchJob().then((job) => {
        if (!job) return;
        return finishBulletinFetch(job.requestId, {
            message: '掲示板表示がOFFになったため、取得を中止しました。',
        });
    }).catch((error) => {
        console.debug('[KLPF] 掲示板取得の停止を反映できませんでした。', error);
    });
});

// 自動ログインの停止は保存設定にも反映する。一括停止前の退避データは変更しない。
chrome.storage.onChanged.addListener((changes, area) => {
    const authChanged = (area === 'sync' && changes.autoLogin)
        || (area === 'local' && ['username', 'password', 'totpSecret'].some(key => changes[key]));
    if (authChanged) {
        void (async () => {
            if (area === 'local' && changes.username) await kuportAccount.sync();
            await resetAutoLoginAttempts();
            const settings = await chrome.storage.sync.get('autoLogin');
            if (settings.autoLogin === false) {
                await chrome.storage.sync.set(Object.fromEntries(KUPORT_DEPENDENT_KEYS.map(key => [key, false])));
            }
            await updateKuportAccess();
        })().catch(error => console.debug('[KLPF] 自動ログイン設定の反映に失敗しました。', error));
    } else if ((area === 'sync' && KUPORT_DEPENDENT_KEYS.some(key => changes[key]))
        || (area === 'local' && (changes[INLINE_ALL_FEATURES_DISABLED_KEY] || changes[KUPORT_CACHE_OWNER_KEY]))
        || (area === 'session' && changes[KUPORT_ACCOUNT_TRANSITION_KEY])
        || (area === 'session' && changes[AUTH_ATTEMPTS_KEY]
            && changes[AUTH_ATTEMPTS_KEY].oldValue?.blocked !== changes[AUTH_ATTEMPTS_KEY].newValue?.blocked)) {
        void (async () => {
            const settings = await chrome.storage.sync.get(['autoLogin', ...KUPORT_DEPENDENT_KEYS]);
            if (settings.autoLogin === false && KUPORT_DEPENDENT_KEYS.some(key => settings[key] === true)) {
                await chrome.storage.sync.set(Object.fromEntries(KUPORT_DEPENDENT_KEYS.map(key => [key, false])));
            }
            await updateKuportAccess();
        })().catch(error => console.debug('[KLPF] 取得の利用条件を反映できませんでした。', error));
    }
});

/**
 * コンテンツスクリプトやポップアップからのメッセージを受信する。
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;
    if (message.type === 'get-kuport-access-state') {
        // 未完了の切り替えは再試行するが、利用可否は完了を待たずに停止状態を返す。
        void kuportAccount.sync().catch(error => console.debug('[KLPF] キャッシュ所有IDの反映を再試行できませんでした。', error));
        getAuthAccessState().then(sendResponse)
            .catch(() => sendResponse({ ready: false, reason: '設定を確認できませんでした。' }));
        return true;
    }
    if (message.type === 'claim-auto-login-attempt') {
        const stages = ['kuport-entry', 'lms-entry', 'username', 'password', 'otp', 'sso-timeout', 'lms-error'];
        let host = '';
        try { host = new URL(sender.url || '').hostname; } catch { /* 不正な送信元は拒否する。 */ }
        if (!['study.ns.kogakuin.ac.jp', 'ku-port.sc.kogakuin.ac.jp', 'slink.secioss.com'].includes(host)
            || !stages.includes(message.stage) || !Number.isInteger(sender.tab?.id)) {
            sendResponse({ ready: false });
            return false;
        }
        claimAutoLoginAttempt(message.stage, sender.tab.id).then(sendResponse).catch(() => sendResponse({ ready: false }));
        return true;
    }
    if (message.type === 'auto-login-success') {
        let url;
        try { url = new URL(sender.url || ''); } catch { return false; }
        if ((url.hostname === 'ku-port.sc.kogakuin.ac.jp' && url.pathname.startsWith('/uprx/'))
            || (url.hostname === 'study.ns.kogakuin.ac.jp' && url.pathname.startsWith('/lms/homeHoml/'))) {
            void recordAutoLoginSuccess(sender.tab?.id).catch(() => {});
        }
        return false;
    }
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
            features: FEATURE_SETTINGS_CONFIG
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
        requestAttendanceRateRefresh({
            manual: message.manual === true,
            academicYear: message.academicYear,
        })
            .then(sendResponse)
            .catch(error => {
                console.error('[KLPF] Ku-port出席率取得を開始できませんでした。', error);
                sendResponse({ status: 'error', error: error.message });
            });
        return true;
    }

    if (message.type === 'request-syllabus-lookup') {
        requestSyllabusLookup({
            sourceTabId: sender.tab?.id,
            requestId: message.requestId,
            course: message.course,
        })
            .then(sendResponse)
            .catch((error) => {
                console.error('[KLPF] シラバス取得を開始できませんでした。', error);
                sendResponse({ status: 'error', message: 'シラバス取得を開始できませんでした。' });
            });
        return true;
    }

    if (message.type === 'request-bulletin-board') {
        requestBulletinFetch({
            sourceTabId: sender.tab?.id,
            requestId: message.requestId,
            forceRefresh: message.forceRefresh === true,
        })
            .then(sendResponse)
            .catch((error) => {
                console.error('[KLPF] 掲示板取得を開始できませんでした。', error);
                sendResponse({ status: 'error', message: '掲示板取得を開始できませんでした。' });
            });
        return true;
    }

    if (message.type === 'get-bulletin-fetch-job' && sender.tab?.id) {
        getBulletinFetchJob().then((job) => {
            if (!job || !job.tabIds?.includes(sender.tab.id)) {
                sendResponse({ job: null });
                return;
            }
            sendResponse({ job });
        }).catch((error) => {
            console.debug('[KLPF] 掲示板取得ジョブを確認できませんでした。', error);
            sendResponse({ job: null });
        });
        return true;
    }

    if (message.type === 'get-syllabus-lookup-job' && sender.tab?.id) {
        (async () => {
            let job = await getSyllabusLookupJob();
            if (!job) {
                sendResponse({ job: null });
                return;
            }
            const isExpired = !Number.isFinite(job.startedAt)
                || Date.now() - job.startedAt > SYLLABUS_LOOKUP_TIMEOUT_MS;
            if (isExpired) {
                await finishSyllabusLookup(job.requestId, {
                    message: 'シラバス取得が時間切れになりました。',
                });
                sendResponse({ job: null });
                return;
            }
            if (!job.tabIds?.includes(sender.tab.id)
                && job.tabIds?.includes(sender.tab.openerTabId)) {
                // 子タブの通常ウィンドウは所有対象へ加えず、タブだけ追跡する。
                job = await trackSyllabusLookupChildTab(job, sender.tab);
                if (!job) { sendResponse({ job: null }); return; }
            }
            sendResponse({
                job: job.tabIds?.includes(sender.tab.id) ? job : null,
            });
        })().catch((error) => {
            console.debug('[KLPF] シラバス取得ジョブを確認できませんでした。', error);
            sendResponse({ job: null });
        });
        return true;
    }

    if (message.type === 'kuport-syllabus-session-ready' && sender.tab?.id) {
        (async () => {
            const job = await getSyllabusLookupJob();
            if (!job || job.requestId !== message.requestId
                || !job.tabIds?.includes(sender.tab.id)
                || job.awaitingSession === false
                || job.transport !== 'direct-fetch') {
                sendResponse({ status: 'stale' });
                return;
            }
            void startSyllabusDirectFetch(job.requestId, {
                status: 'session-ready',
                action: message.action,
                fields: message.fields,
            }).catch(error => {
                console.error('[KLPF] シラバス取得の終了処理に失敗しました。', error);
            });
            sendResponse({ status: 'accepted' });
        })().catch((error) => {
            console.debug('[KLPF] シラバス用Ku-Portセッションを受け取れませんでした。', error);
            sendResponse({ status: 'error' });
        });
        return true;
    }

    if (message.type === 'cancel-syllabus-lookup' && sender.tab?.id) {
        cancelQueuedKuportRequest(message.requestId, sender.tab.id);
        getSyllabusLookupJob().then(async (job) => {
            if (!job || job.requestId !== message.requestId || job.sourceTabId !== sender.tab.id) {
                sendResponse({ status: 'stale' });
                return;
            }
            await finishSyllabusLookup(job.requestId, {
                message: 'シラバス取得を中止しました。',
            });
            sendResponse({ status: 'accepted' });
        }).catch((error) => {
            console.debug('[KLPF] シラバス取得の中止を処理できませんでした。', error);
            sendResponse({ status: 'error' });
        });
        return true;
    }

    if (message.type === 'kuport-bulletin-session-ready' && sender.tab?.id) {
        (async () => {
            const job = await getBulletinFetchJob();
            if (!job || job.requestId !== message.requestId
                || !job.tabIds?.includes(sender.tab.id)
                || job.awaitingSession === false
                || job.transport !== 'direct-fetch') {
                sendResponse({ status: 'stale' });
                return;
            }
            void startBulletinDirectFetch(job.requestId, {
                status: 'session-ready',
                action: message.action,
                fields: message.fields,
                bulletinSource: message.bulletinSource,
                bulletinExecute: message.bulletinExecute,
                bulletinRender: message.bulletinRender,
            }).catch(error => {
                console.error('[KLPF] 掲示板取得の終了処理に失敗しました。', error);
            });
            sendResponse({ status: 'accepted' });
        })().catch((error) => {
            console.debug('[KLPF] 掲示板用Ku-Portセッションを受け取れませんでした。', error);
            sendResponse({ status: 'error' });
        });
        return true;
    }

    if (message.type === 'cancel-bulletin-board-fetch' && sender.tab?.id) {
        cancelQueuedKuportRequest(message.requestId, sender.tab.id);
        getBulletinFetchJob().then(async (job) => {
            if (!job || job.requestId !== message.requestId || job.sourceTabId !== sender.tab.id) {
                sendResponse({ status: 'stale' });
                return;
            }
            await finishBulletinFetch(job.requestId, { message: '掲示板取得を中止しました。' });
            sendResponse({ status: 'accepted' });
        }).catch((error) => {
            console.debug('[KLPF] 掲示板取得の中止を処理できませんでした。', error);
            sendResponse({ status: 'error' });
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
        void (async () => {
            const syllabusJob = await getSyllabusLookupJob();
            if (syllabusJob?.tabIds?.includes(sender.tab.id)) {
                await finishSyllabusLookup(syllabusJob.requestId, {
                    message: 'Ku-Portへ自動ログインできないため、シラバス取得を中止しました。',
                });
                return;
            }
            const bulletinJob = await getBulletinFetchJob();
            if (bulletinJob?.tabIds?.includes(sender.tab.id)) {
                await finishBulletinFetch(bulletinJob.requestId, {
                    message: 'Ku-Portへ自動ログインできないため、掲示板取得を中止しました。',
                });
                return;
            }
            await finishAttendanceFetch(sender.tab.id, 'auto-login-unavailable');
        })().catch(error => {
            console.error('[KLPF] 自動ログイン停止時の取得を片付けられませんでした。', error);
        });
        sendResponse({ status: 'accepted' });
        return;
    }

    if (message.type === 'inject') {
        if (message.data === "gassetup") registerContentScript(GAS_SETUP_CONFIG);
        if (message.data === "gassetupstop") unregisterContentScript(GAS_SETUP_CONFIG.id);
    }

    return false;
});

// 登録済みジョブの開始時刻を使い、認証待ちの間も期限監視を継続する。
registerKuportJobTimeouts([
    {
        key: ATTENDANCE_FETCH_JOB_KEY,
        timeoutMs: ATTENDANCE_FETCH_JOB_TIMEOUT_MS,
        async finish(job) {
            await finishAttendanceFetch(job.tabId, 'timeout');
        },
    },
    {
        key: SYLLABUS_LOOKUP_JOB_KEY,
        timeoutMs: SYLLABUS_LOOKUP_TIMEOUT_MS,
        finish: job => finishSyllabusLookup(job.requestId, { message: 'シラバス取得が時間切れになりました。' }),
    },
    {
        key: BULLETIN_FETCH_JOB_KEY,
        timeoutMs: BULLETIN_FETCH_TIMEOUT_MS,
        finish: job => finishBulletinFetch(job.requestId, { message: '掲示板取得が時間切れになりました。' }),
    },
]);

// 起動時にもキャッシュ所有IDを確認し、旧データの混在を防ぐ。
const kuportAccount = createKuportAccountManager(async () => {
    kuportAccountRevision += 1;
    const [syllabus, bulletin, attendance] = await Promise.all([
        getSyllabusLookupJob(), getBulletinFetchJob(), getAttendanceFetchJob(),
    ]);
    if (syllabus) await finishSyllabusLookup(syllabus.requestId, { message: 'ログインIDが変更されたため取得を中止しました。' });
    if (bulletin) await finishBulletinFetch(bulletin.requestId, { message: 'ログインIDが変更されたため取得を中止しました。' });
    if (attendance) await finishAttendanceFetch(attendance.tabId, 'account-changed');
    await resetAttendanceRefreshCooldown();
});
void kuportAccount.sync().then(updateKuportAccess).catch(error => {
    console.error('[KLPF] ログインIDの変更を反映できませんでした。', error);
});
// 拡張機能の更新・再読み込みなどで動的登録が失われても、保存設定から復旧する。
void initializeScripts().catch(error => {
    console.error('[KLPF] 起動時にコンテンツスクリプトを初期化できませんでした。', error);
});
