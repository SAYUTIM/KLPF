// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file Manifest V3のService Workerとして、設定・Chromeイベントと3機能の取得ジョブを管理する。
 * 出席率・掲示板・シラバスの待機要求を直列化し、認証画面の所有確認、取消、結果保存を担当する。
 * フォーム通信はbackground/kuport、HTML解析はoffscreen、表示はfeaturesへ委譲する。
 */



import {
    isKuportUrl,
    parseKuportDocument,
    createKuportLoginContext,
    closeKuportParser,
} from './background/modules/kuport-runtime.js';

import { createFormBody } from './background/modules/kuport-form.js';

import { getAuthAccessState } from './background/modules/auth-access.js';
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
const ATTENDANCE_CACHE_VERSION = 6;
const ATTENDANCE_BROWSER_SESSION_KEY = 'klpf-attendance-browser-session';
const ATTENDANCE_RATE_FEATURE_KEY = 'attendanceRateDisplay';
const ATTENDANCE_RATE_CONSENT_KEY = 'attendanceRateAccessConsent';
const ATTENDANCE_FETCH_JOB_TIMEOUT_MS = 2 * 60 * 1000;
const ATTENDANCE_TERM_COMPONENT_ID = 'funcForm:kaikoNendoGakki';
const KUPORT_ENTRY_URL = 'https://ku-port.sc.kogakuin.ac.jp/';
const KUPORT_URL_PATTERN = 'https://ku-port.sc.kogakuin.ac.jp/*';
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
 * 出席率更新要求を共通キューへ登録する。
 * @param {object|object[]} [options] - 呼び出し時の設定、または年度学期の選択肢一覧。
 * @returns {Promise<object>} 出席率更新の開始結果。
 */
function requestAttendanceRateRefresh(options = {}) { return startQueuedRequestAttendanceRateRefresh(options); }

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
    const tabs = await chrome.tabs.query({ url: LMS_HOME_URL_PATTERNS });
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

/**
 * 出席率取得を終了し、ジョブと認証用画面を片付けて状態を通知する。
 * @param {number} tabId - 処理対象のChromeタブID。
 * @param {*} status - 処理の終了状態。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
async function finishAttendanceFetch(tabId, status) {
    const job = await getAttendanceFetchJob();
    if (!job || job.tabId !== tabId) return;

    if (status === 'completed' && !job.manual) {
        await recordAttendanceRefreshCooldown();
    }
    await clearAttendanceFetchJob();
    await setAttendanceBrowserSessionYear(job.academicYear, {
        status,
        finishedAt: Date.now(),
    });
    if (job.createdByExtension && job.phase !== 'background-fetch') {
        try {
            await closeCreatedAttendanceContext(job);
        } catch (error) {
            console.debug('[KLPF] 出席率取得用の一時画面を閉じられませんでした。', error);
        }
    }
    await reportAttendanceDebug('処理終了', {
        status,
        academicYear: job.academicYear,
    });
}

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
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
async function fetchKuportAttendanceInBackground(bootstrap, signal, requestedAcademicYear = '') {
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
        await fetchKuportAttendanceInBackground(
            bootstrap,
            abortController.signal,
            job.academicYear,
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
    if (!isExpired && currentJob.phase === 'background-fetch') {
        return {
            status: 'already-running',
            academicYear: currentJob.academicYear,
        };
    }
    try {
        if (!isExpired) {
            await chrome.tabs.get(currentJob.tabId);
            return {
                status: 'already-running',
                academicYear: currentJob.academicYear,
            };
        }
        if (currentJob.createdByExtension) await closeCreatedAttendanceContext(currentJob);
    } catch {
        // 既に閉じられている場合もジョブ情報だけ削除する。
    }
    await clearAttendanceFetchJob();
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
    await chrome.storage.session.set({
        [ATTENDANCE_FETCH_JOB_KEY]: {
            tabId,
            startedAt: Date.now(),
            createdByExtension,
            createdWindowId,
            manual,
            academicYear: year,
            phase: 'login-tab',
        },
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
    await chrome.tabs.update(tab.id, { url: KUPORT_ENTRY_URL });
    return { status: 'started' };
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
    if (null || null) return { status: 'kuport-operation-busy' };
    if (await Promise.resolve(false)) return { status: 'kuport-operation-busy' };



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
    await clearAttendanceFetchJob();
    if (job.createdByExtension && job.phase !== 'background-fetch') {
        try {
            await closeCreatedAttendanceContext(job);
        } catch {
            // ログイン用画面が既に閉じられている場合は無視する。
        }
    }
    await setAttendanceBrowserSessionYear(job.academicYear, {
        status: 'cancelled-kuport-opened',
        finishedAt: Date.now(),
    });
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
            if (isKuportUrl(url)) {
                const attendanceCancelled = await cancelAttendanceFetchForUserKuport(tabId);
                if (attendanceCancelled) return;
            }
        } catch {
            // URLがまだ確定していない更新は通常の継続判定へ渡す。
        }
        await continueAttendanceFetch(tabId, changeInfo, tab);
    })().catch(error => {
        console.error('[KLPF] Ku-port取得処理の継続に失敗しました。', error);
    });
});

chrome.tabs.onRemoved.addListener((tabId) => {
    void (async () => {
        const job = await getAttendanceFetchJob();
        if (job?.tabId !== tabId || job.phase === 'background-fetch') return;
        await clearAttendanceFetchJob();
        await setAttendanceBrowserSessionYear(job.academicYear, {
            status: 'login-tab-closed',
            finishedAt: Date.now(),
        });
    })();
});

/**
 * コンテンツスクリプトやポップアップからのメッセージを受信する。
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;
    if (message.type === 'get-kuport-access-state') {
        getAuthAccessState().then(sendResponse).catch(() => sendResponse({ ready: false, reason: '設定を確認できませんでした。' }));
        return true;
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




            await finishAttendanceFetch(sender.tab.id, 'auto-login-unavailable');
        })();
        sendResponse({ status: 'accepted' });
        return;
    }

    if (message.type === 'inject') {
        if (message.data === "gassetup") registerContentScript(GAS_SETUP_CONFIG);
        if (message.data === "gassetupstop") unregisterContentScript(GAS_SETUP_CONFIG.id);
    }

    return false;
});
