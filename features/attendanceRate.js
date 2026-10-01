// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file KU-PORTの出席情報を保存し、KU-LMSホームの授業カードへ表示する。
 *
 * KU-PORTでは出席表の監視とキャッシュ保存、KU-LMSでは授業カードとの照合と
 * 表示状態（キャッシュ・更新中・最新）の管理を担当する。
 */

(function() {
    'use strict';

    const attendanceUtils = globalThis.KLPFAttendanceUtils;
    if (!attendanceUtils) {
        console.error('[KLPF 出席率表示] 出席表解析モジュールを読み込めませんでした。');
        return;
    }

    const {
        normalizeText,
        normalizeCourseName,
        parseAttendanceRecords,
    } = attendanceUtils;

    const FEATURE_NAME = 'KLPF 出席率表示';
    const AUTO_LOGIN_REQUIRED_MESSAGE = '自動ログインが有効ではないため、出席状況の更新を開始できませんでした。';
    const ATTENDANCE_REFRESH_TOAST_ID = 'klpf-attendance-refresh-toast';
    const KUPORT_HOST = 'ku-port.sc.kogakuin.ac.jp';
    const LMS_HOST = 'study.ns.kogakuin.ac.jp';
    const ATTENDANCE_TABLE_ID = 'funcForm:jugyoKaisuInfo';
    const TERM_SELECT_ID = 'funcForm:kaikoNendoGakki_input';
    const CACHE_KEY = 'klpf-attendance-rate-cache';
    const CACHE_VERSION = 6;
    const STYLE_ID = 'klpf-attendance-rate-style';
    const RATE_CLASS = 'klpf-attendance-rate';
    let displayEnabled = false;
    let unsubscribeAccess = null;
    let accessRevision = 0;
    const LMS_YEAR_FILTER_SELECTOR = '.lms-search-condition-detail';
    const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

    /**
     * 出席率更新に失敗した理由を通知欄へ表示する。
     * @param {string|object} message - 表示する案内文、または受信した機能メッセージ。
     * @returns {void} 戻り値はない。
     */
    function showAttendanceRefreshError(message) {
        let toast = document.getElementById(ATTENDANCE_REFRESH_TOAST_ID);
        if (!toast) {
            toast = document.createElement('div');
            toast.id = ATTENDANCE_REFRESH_TOAST_ID;
            toast.setAttribute('role', 'alert');
            toast.setAttribute('aria-live', 'assertive');
            Object.assign(toast.style, {
                position: 'fixed',
                right: '18px',
                bottom: '18px',
                zIndex: '2147483647',
                maxWidth: 'min(360px, calc(100vw - 36px))',
                padding: '10px 14px',
                borderRadius: '8px',
                background: '#b42318',
                color: '#ffffff',
                fontSize: '13px',
                lineHeight: '1.5',
                boxShadow: '0 6px 20px rgba(0, 0, 0, .2)',
                transition: 'opacity .2s ease, transform .2s ease',
            });
            (document.body || document.documentElement).appendChild(toast);
        }

        toast.textContent = message;
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
        window.clearTimeout(showAttendanceRefreshError.timer);
        showAttendanceRefreshError.timer = window.setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(6px)';
        }, 5000);
    }
    const CAPTURE_DEBOUNCE_MS = 250;
    const KUPORT_MESSAGE_TYPES = new Set([
        'klpf-attendance-auto-fetch',
        'klpf-attendance-capture-now',
        'klpf-attendance-session-bootstrap',
    ]);
    const DAY_ABBREVIATIONS = {
        月曜日: '月',
        火曜日: '火',
        水曜日: '水',
        木曜日: '木',
        金曜日: '金',
        土曜日: '土',
        日曜日: '日',
    };

    let observer = null;
    let yearFilterObserver = null;
    let scheduledCapture = null;
    let scheduledRender = null;
    let storageChangeListener = null;
    let runtimeMessageListener = null;
    let lastObservedAcademicYear = '';
    let deferredAcademicYear = '';
    const requestedAcademicYears = new Set();
    let autoFetchRequested = false;
    let sessionBootstrapReported = false;
    let refreshDisplayState = 'cache';

    /**
     * 表示中の出席表を解析し、学期情報とともに保存する。
     * @returns {Promise<boolean>} 出席表を取得・保存できた場合はtrue。
     */
    async function captureKuportAttendance() {
        scheduledCapture = null;
        const container = document.getElementById(ATTENDANCE_TABLE_ID);
        if (!container) return false;

        const termSelect = document.getElementById(TERM_SELECT_ID);
        const academicTerm = termSelect instanceof HTMLSelectElement
            ? normalizeText(termSelect.selectedOptions[0]?.textContent)
            : '';
        const termInfo = attendanceUtils.parseAcademicTerm(
            termSelect instanceof HTMLSelectElement ? termSelect.value : '',
            academicTerm,
        );
        if (termInfo.academicYear !== getCurrentAcademicYear()
            || !Number.isInteger(termInfo.quarter)) return false;
        const records = parseAttendanceRecords(container, { includeSessionCount: true });
        if (records.length === 0) return false;
        await saveAttendanceRecords(termInfo, academicTerm, records);
        if (autoFetchRequested) {
            void chrome.runtime.sendMessage({ type: 'attendance-rate-fetch-complete' }).catch(() => {});
        }
        return true;
    }

    /**
     * 取得した出席記録を年度・学期別のキャッシュへ統合する。
     * @param {object} termInfo - 解析済みの年度・学期情報。
     * @param {string} academicTerm - 出席表で選択されている年度学期の表示名。
     * @param {object[]} records - 照合または保存の対象となる出席記録。
     * @returns {Promise<void>} 処理の完了を待つPromise。
     */
    async function saveAttendanceRecords(termInfo, academicTerm, records) {
        const stored = await chrome.storage.local.get(CACHE_KEY);
        const existingCache = stored[CACHE_KEY];
        const mergedRecords = new Map();
        for (const record of Array.isArray(existingCache?.records) ? existingCache.records : []) {
            mergedRecords.set(
                `${record.academicYear}|${record.quarter}|${record.schedule}|${record.normalizedName}`,
                record,
            );
        }
        for (const record of records) {
            const termRecord = {
                ...record,
                academicYear: termInfo.academicYear,
                quarter: termInfo.quarter,
                termValue: termInfo.termValue,
                academicTerm,
            };
            mergedRecords.set(
                `${termRecord.academicYear}|${termRecord.quarter}|${termRecord.schedule}|${termRecord.normalizedName}`,
                termRecord,
            );
        }
        const updatedAt = Date.now();
        const updatedAtByYear = { ...(existingCache?.updatedAtByYear || {}) };
        const completedAtByYear = { ...(existingCache?.completedAtByYear || {}) };
        if (existingCache?.academicYear && Number.isFinite(existingCache.updatedAt)
            && !Number.isFinite(updatedAtByYear[existingCache.academicYear])) {
            updatedAtByYear[existingCache.academicYear] = existingCache.updatedAt;
        }
        updatedAtByYear[termInfo.academicYear] = updatedAt;
        await chrome.storage.local.set({
            [CACHE_KEY]: {
                version: CACHE_VERSION,
                updatedAt,
                updatedAtByYear,
                completedAtByYear,
                academicYear: termInfo.academicYear,
                academicTerm: existingCache?.academicYear === termInfo.academicYear
                    ? existingCache.academicTerm || `${termInfo.academicYear}年度`
                    : `${termInfo.academicYear}年度`,
                records: Array.from(mergedRecords.values()),
            },
        });
    }

    /**
     * 出席状況へ遷移するKu-Portのメニューリンクを探す。
     * @returns {Element|undefined} 操作可能な出席画面へのリンク。見つからなければundefined。
     */
    function findAttendanceMenuLink() {
        return Array.from(document.querySelectorAll('a.ui-menuitem-link')).find(link =>
            normalizeText(link.textContent) === '学生出欠状況確認'
            && !link.classList.contains('ui-state-disabled')
        ) || null;
    }

    /**
     * 認証後のメニューフォームから直接通信に必要な送信情報を作る。
     * @returns {object|null} 有効な送信フォーム情報。準備できていなければnull。
     */
    function createSessionBootstrap() {
        const menuLink = findAttendanceMenuLink();
        const menuForm = document.getElementById('menuForm');
        if (!menuLink || !(menuForm instanceof HTMLFormElement)) return null;

        const fields = Array.from(new FormData(menuForm).entries())
            .filter(([name, value]) => typeof name === 'string' && typeof value === 'string');
        return {
            status: 'session-ready',
            action: menuForm.action,
            fields,
        };
    }

    /**
     * 認証フォームが用意できた場合、バックグラウンドへ引き渡す。
     * @returns {void} 戻り値はない。
     */
    function reportSessionBootstrapIfReady() {
        if (sessionBootstrapReported) return;
        const bootstrap = createSessionBootstrap();
        if (!bootstrap) return;
        sessionBootstrapReported = true;
        void chrome.runtime.sendMessage({
            type: 'kuport-attendance-session-ready',
            action: bootstrap.action,
            fields: bootstrap.fields,
        }).catch(() => {});
    }

    /**
     * 出席率取得ジョブを確認し、出席表の取得または画面への遷移を処理する。
     * @param {boolean} shouldNavigate - 出席表がない場合に取得用の画面へ進むかどうか。
     * @returns {Promise<object>} 出席表読み取りまたは画面遷移の状態を示す応答。
     */
    async function handleKuportFetchRequest(shouldNavigate) {
        const pageText = normalizeText(document.body?.textContent);
        if (/ログインに失敗しました|不正なアクセスがありました/.test(pageText)) {
            return { status: 'kuport-error' };
        }
        if (document.getElementById(ATTENDANCE_TABLE_ID)) {
            const captured = await captureKuportAttendance();
            return { status: captured ? 'captured' : 'waiting-for-table' };
        }
        if (!shouldNavigate) return { status: 'not-attendance-page' };

        const menuLink = findAttendanceMenuLink();
        if (!menuLink) return { status: 'menu-not-ready' };
        autoFetchRequested = true;
        menuLink.click();
        return { status: 'navigating' };
    }

    /**
     * 出席率取得用の認証フォームをバックグラウンドへ引き渡す。
     * @returns {Promise<object>} 認証フォームの引き渡し状態を示す応答。
     */
    async function handleKuportSessionBootstrap() {
        const pageText = normalizeText(document.body?.textContent);
        if (/ログインに失敗しました|不正なアクセスがありました/.test(pageText)) {
            return { status: 'kuport-error' };
        }
        if (document.getElementById(ATTENDANCE_TABLE_ID)) {
            const captured = await captureKuportAttendance();
            return { status: captured ? 'captured' : 'waiting-for-table' };
        }
        return createSessionBootstrap() || { status: 'menu-not-ready' };
    }

    /**
     * 出席表の連続したDOM変更をまとめ、読み取りを予約する。
     * @returns {void} 戻り値はない。
     */
    function scheduleCapture() {
        if (scheduledCapture !== null) clearTimeout(scheduledCapture);
        scheduledCapture = setTimeout(() => {
            void captureKuportAttendanceSafely();
        }, CAPTURE_DEBOUNCE_MS);
    }

    /**
     * 出席表を読み取り、失敗を診断状態として通知する。
     * @returns {Promise<boolean>} 読み取り処理が成功した場合はtrue。
     */
    async function captureKuportAttendanceSafely() {
        try {
            return await captureKuportAttendance();
        } catch (error) {
            console.error(`[${FEATURE_NAME}] Ku-portの出席率保存に失敗しました。`, error);
            return false;
        }
    }

    /**
     * バックグラウンドから届く出席率取得要求を受け付ける。
     * @returns {void} 戻り値はない。
     */
    function registerKuportMessageListener() {
        if (runtimeMessageListener) return;

        runtimeMessageListener = (message, _sender, sendResponse) => {
            if (!KUPORT_MESSAGE_TYPES.has(message.type)) return false;

            const isAutoFetch = message.type === 'klpf-attendance-auto-fetch';
            if (isAutoFetch) autoFetchRequested = true;
            const request = message.type === 'klpf-attendance-session-bootstrap'
                ? handleKuportSessionBootstrap()
                : handleKuportFetchRequest(isAutoFetch);
            request
                .then(sendResponse)
                .catch(error => sendResponse({ status: 'error', error: error.message }));
            return true;
        };
        chrome.runtime.onMessage.addListener(runtimeMessageListener);
    }

    /**
     * 出席表が現れるまでKu-PortのDOM変更を監視する。
     * @returns {void} 戻り値はない。
     */
    function observeKuportPageUntilAttendanceTable() {
        observer?.disconnect();
        observer = new MutationObserver(() => {
            reportSessionBootstrapIfReady();
            if (!document.getElementById(ATTENDANCE_TABLE_ID)) return;

            observer?.disconnect();
            observer = null;
            startKuportCapture();
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    /**
     * 出席表の内容変更を監視してキャッシュの読み取りを予約する。
     * @param {Element} container - 対象の表や一覧を含む要素。
     * @returns {void} 戻り値はない。
     */
    function observeAttendanceTable(container) {
        observer?.disconnect();
        observer = new MutationObserver(scheduleCapture);
        observer.observe(container, { childList: true, subtree: true, characterData: true });
    }

    /**
     * 所有ジョブを確認し、Ku-Port側の出席表読み取りを開始する。
     * @returns {void} 戻り値はない。
     */
    function startKuportCapture() {
        registerKuportMessageListener();

        reportSessionBootstrapIfReady();

        const container = document.getElementById(ATTENDANCE_TABLE_ID);
        if (!container) {
            observeKuportPageUntilAttendanceTable();
            return;
        }

        void captureKuportAttendanceSafely();
        observeAttendanceTable(container);
    }

    /**
     * 授業カードから曜日と時限を読み取る。
     * @param {HTMLElement} card - 対象授業のカード要素。
     * @returns {string} 出席記録との照合に使う曜日・時限文字列。
     */
    function getCardSchedule(card) {
        const weekday = normalizeText(card.closest('.lms-daybox')?.querySelector('h3')?.textContent);
        const period = normalizeText(card.querySelector('.courseCardInfo')?.textContent).match(/(\d+)限/)?.[1] || '';
        return `${DAY_ABBREVIATIONS[weekday] || ''}${period}`;
    }

    /**
     * 授業カードの学期表記を対応するクォーターへ変換する。
     * @param {HTMLElement} card - 対象授業のカード要素。
     * @returns {number[]} 授業カードが属するクォーター番号。
     */
    function getCardQuarters(card) {
        const infoText = normalizeText(card.querySelector('.courseCardInfo')?.textContent)
            .normalize('NFKC');
        const quarterMatch = infoText.match(/([1-4])\s*Q/i) || infoText.match(/Q\s*([1-4])/i);
        if (quarterMatch) return [Number(quarterMatch[1] || quarterMatch[2])];
        if (/前期|春学期/.test(infoText)) return [1, 2];
        if (/後期|秋学期/.test(infoText)) return [3, 4];
        if (/通年|年間/.test(infoText)) return [1, 2, 3, 4];
        return [];
    }

    /**
     * 授業名・曜日・時限・年度などを照合し、カードに対応する出席記録を探す。
     * @param {HTMLElement} card - 対象授業のカード要素。
     * @param {object[]} records - 照合または保存の対象となる出席記録。
     * @param {string} academicYear - 取得または表示の対象年度。
     * @returns {object|null} カードに対応する出席記録。見つからなければnull。
     */
    function findAttendanceRecord(card, records, academicYear) {
        const courseName = normalizeCourseName(card.querySelector('.lms-cardname')?.textContent);
        if (!courseName) return null;

        const candidates = records.filter(record => record.normalizedName === courseName);
        const schedule = getCardSchedule(card);
        const exactScheduleCandidates = candidates.filter(record => record.schedule === schedule);
        const distinctSchedules = new Set(candidates.map(record => record.schedule));
        const scheduleCandidates = exactScheduleCandidates.length > 0
            ? exactScheduleCandidates
            : distinctSchedules.size === 1 ? candidates : [];
        const quarters = getCardQuarters(card);
        if (scheduleCandidates.length === 0 || quarters.length === 0) return null;

        const quarterRecords = new Map();
        for (const record of scheduleCandidates) {
            if (String(record.academicYear) !== String(academicYear) || !quarters.includes(record.quarter)) continue;
            if (!quarterRecords.has(record.quarter)) quarterRecords.set(record.quarter, record);
        }
        const quarterRates = Array.from(quarterRecords.values())
            .filter(record => Number.isFinite(record.rate))
            .sort((left, right) => left.quarter - right.quarter);
        if (quarterRates.length === 0) return null;

        const allTermRatesAvailable = quarterRates.length === quarters.length;
        const allLessonCountsAvailable = quarterRates.every(record =>
            Number.isFinite(record.lessonCount) && record.lessonCount > 0
        );
        const totalLessons = quarterRates.reduce((sum, record) => sum + (record.lessonCount || 0), 0);
        const rate = quarters.length === 1
            ? quarterRates[0].rate
            : allTermRatesAvailable && allLessonCountsAvailable && totalLessons > 0
                ? Math.round(quarterRates.reduce(
                    (sum, record) => sum + record.rate * record.lessonCount,
                    0,
                ) / totalLessons)
                : null;
        const colorRate = Number.isFinite(rate)
            ? rate
            : quarterRates.reduce((sum, record) => sum + record.rate, 0) / quarterRates.length;

        const lastAttendanceDate = Array.from(quarterRecords.values())
            .sort((left, right) => right.quarter - left.quarter)
            .find(record => record.lastAttendanceDate)?.lastAttendanceDate || '';
        return {
            rate,
            colorRate,
            lastAttendanceDate,
            quarterRates,
            quarterSummary: quarterRates
                .map(record => `${record.quarter}Q ${record.rate}%`)
                .join('・'),
        };
    }

    /**
     * 機能の表示に必要なスタイルをページへ追加する。
     * @returns {void} 戻り値はない。
     */
    function injectStyles() {
        ensureStyleElement(STYLE_ID, `
            .${RATE_CLASS} {
                --klpf-attendance-rate-color: #007eb4;
                display: flex;
                align-items: center;
                gap: 5px;
                min-width: 0;
                width: 100%;
                max-width: 100%;
                height: 16px;
                box-sizing: border-box;
                margin: 0;
                padding: 1px 5px;
                overflow: hidden;
                border: 0;
                color: #232323;
                background: transparent;
                font-size: 9px;
                line-height: 12px;
            }
            .${RATE_CLASS} .klpf-attendance-last-date {
                color: #007eb4;
                font-size: 12px;
                font-weight: 400;
                white-space: nowrap;
            }
            .${RATE_CLASS} .klpf-attendance-rate-value {
                color: var(--klpf-attendance-rate-color);
                font-size: 10px;
                font-weight: 400;
                white-space: nowrap;
            }
            .${RATE_CLASS} .klpf-attendance-sync-state {
                display: inline-flex;
                align-items: center;
                gap: 3px;
                margin-left: auto;
                color: #64748b;
                font-size: 9px;
                font-weight: 400;
                white-space: nowrap;
            }
            .${RATE_CLASS} .klpf-attendance-sync-state::before {
                width: 5px;
                height: 5px;
                border-radius: 50%;
                background: currentColor;
                content: '';
            }
            .${RATE_CLASS}.is-loading-cache .klpf-attendance-sync-state::before {
                animation: klpf-attendance-status-pulse 1s ease-in-out infinite;
            }
            .${RATE_CLASS}.is-cache-fallback .klpf-attendance-sync-state {
                color: #9a6700;
            }
            .${RATE_CLASS}.is-latest {
                animation: klpf-attendance-fresh-pop .45s ease-out;
            }
            .${RATE_CLASS}.is-latest .klpf-attendance-sync-state {
                color: #007eb4;
            }
            .${RATE_CLASS}.is-good {
                --klpf-attendance-rate-color: #007eb4;
            }
            .${RATE_CLASS}.is-warning {
                --klpf-attendance-rate-color: #9a6700;
            }
            .${RATE_CLASS}.is-danger {
                --klpf-attendance-rate-color: #b42318;
            }
            @keyframes klpf-attendance-status-pulse {
                0%, 100% { opacity: .35; transform: scale(.8); }
                50% { opacity: 1; transform: scale(1.2); }
            }
            @keyframes klpf-attendance-fresh-pop {
                0% { transform: scale(.96); opacity: .65; }
                100% { transform: scale(1); opacity: 1; }
            }
            @media (prefers-reduced-motion: reduce) {
                .${RATE_CLASS},
                .${RATE_CLASS} .klpf-attendance-sync-state::before {
                    animation: none !important;
                }
            }
        `);
    }

    /**
     * 保存された更新時刻を表示用の文字列へ変換する。
     * @param {*} value - 検証・変換する入力値。
     * @returns {string} 表示または識別に使う文字列。
     */
    function formatUpdatedAt(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleString('ja-JP', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    /**
     * 出席率に対応する表示クラスを選ぶ。
     * @param {number} rate - 表示対象の出席率。
     * @returns {string} 出席率の段階に対応するCSSクラス。
     */
    function getRateLevelClass(rate) {
        if (rate >= 80) return 'is-good';
        if (rate >= 60) return 'is-warning';
        return 'is-danger';
    }

    /**
     * 出席率の取得状態に対応する短い表示文を返す。
     * @returns {string} 更新状態の短い表示文。
     */
    function getRefreshStateLabel() {
        if (refreshDisplayState === 'latest') return '最新';
        if (['cache', 'cache-fallback'].includes(refreshDisplayState)) return 'キャッシュ';
        return '更新中';
    }

    /**
     * 出席率の取得状態に対応する補足説明を返す。
     * @returns {string} 更新状態の補足説明。
     */
    function getRefreshStateDescription() {
        const descriptions = {
            latest: 'Ku-portから最新データを取得済み',
            'cache-fallback': 'Ku-portの更新に失敗または中断したため保存済みデータを表示',
            cache: '保存済みデータを表示',
            'loading-cache': '保存済みデータを表示しながらKu-portを更新中',
        };
        return descriptions[refreshDisplayState] || descriptions['loading-cache'];
    }

    /**
     * 出席記録と更新状態から読み上げ用の説明を作る。
     * @param {object} record - 科目・曜日時限・出席率などの出席記録。
     * @param {object} cache - 読み出した取得結果と更新時刻のキャッシュ。
     * @returns {string} 出席率と取得状態の読み上げ用説明。
     */
    function createAttendanceAccessibleLabel(record, cache) {
        const updatedAt = formatUpdatedAt(cache.updatedAt);
        return [
            Number.isFinite(record.rate) && record.quarterRates.length > 1
                ? `期間合算 ${record.rate}%`
                : null,
            `Ku-port出席率 ${record.quarterSummary}`,
            record.lastAttendanceDate && `最終カードタッチ ${record.lastAttendanceDate}`,
            getRefreshStateDescription(),
            `${cache.academicYear}年度`,
            updatedAt && `データ更新 ${updatedAt}`,
        ].filter(Boolean).join('・');
    }

    /**
     * 出席率と更新状態を表示するカード内の要素を作る。
     * @param {object} record - 科目・曜日時限・出席率などの出席記録。
     * @param {object} cache - 読み出した取得結果と更新時刻のキャッシュ。
     * @returns {object} 出席率と更新時刻の表示要素。
     */
    function createAttendanceElements(record, cache) {
        const lastAttendanceElement = document.createElement('div');
        lastAttendanceElement.className = `${RATE_CLASS} klpf-attendance-last-row`;
        const lastDate = document.createElement('span');
        lastDate.className = 'klpf-attendance-last-date';
        lastDate.textContent = `最終カードタッチ ${record.lastAttendanceDate || '—'}`;
        lastAttendanceElement.appendChild(lastDate);

        const rateElement = document.createElement('div');
        rateElement.className = `${RATE_CLASS} klpf-attendance-rate-row is-${refreshDisplayState}`;
        rateElement.classList.add(getRateLevelClass(record.colorRate));
        const rateLabel = document.createElement('span');
        rateLabel.className = 'klpf-attendance-rate-value';
        rateLabel.textContent = Number.isFinite(record.rate)
            ? `出席率 ${record.rate}%`
            : record.quarterSummary;
        rateElement.appendChild(rateLabel);

        const stateLabel = document.createElement('span');
        stateLabel.className = 'klpf-attendance-sync-state';
        stateLabel.textContent = getRefreshStateLabel();
        rateElement.appendChild(stateLabel);

        const accessibleLabel = createAttendanceAccessibleLabel(record, cache);
        for (const element of [lastAttendanceElement, rateElement]) {
            element.title = accessibleLabel;
            element.setAttribute('aria-label', accessibleLabel);
        }
        return { lastAttendanceElement, rateElement };
    }

    /**
     * 出席率の更新表示状態を切り替え、カード表示を更新する。
     * @param {object} state - 機能内で共有する現在の状態。
     * @returns {void} 戻り値はない。
     */
    function setRefreshDisplayState(state) {
        if (refreshDisplayState === state) return;
        refreshDisplayState = state;
        scheduleRender();
    }

    /**
     * KU-LMSの検索条件から表示対象の年度を読み取る。
     * @returns {string} 検索条件の4桁の年度。読み取れなければ空文字列。
     */
    function getSelectedAcademicYear() {
        const label = document.querySelector(LMS_YEAR_FILTER_SELECTOR)?.textContent || '';
        return normalizeText(label).normalize('NFKC').match(/(\d{4})\s*年度?/)?.[1] || '';
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
     * 指定年度の出席記録をキャッシュから取り出す。
     * @param {object} cache - 読み出した取得結果と更新時刻のキャッシュ。
     * @param {string} academicYear - 取得または表示の対象年度。
     * @returns {object} 指定年度の出席記録と更新時刻を含むキャッシュ。
     */
    function getAttendanceCacheForYear(cache, academicYear) {
        const year = String(academicYear || '');
        const records = Array.isArray(cache?.records) ? cache.records : [];
        const updatedAt = Number.isFinite(cache?.updatedAtByYear?.[year])
            ? cache.updatedAtByYear[year]
            : String(cache?.academicYear) === year ? cache.updatedAt : null;
        return {
            ...cache,
            academicYear: year,
            updatedAt,
            completedAt: Number.isFinite(cache?.completedAtByYear?.[year])
                ? cache.completedAtByYear[year]
                : null,
            records: records.filter(record => String(record.academicYear) === year),
        };
    }

    /**
     * 現在の年度・カードに対応する出席率を描画する。
     * @param {object} cache - 読み出した取得結果と更新時刻のキャッシュ。
     * @returns {void} 戻り値はない。
     */
    function renderAttendanceRates(cache) {
        scheduledRender = null;
        observer?.disconnect();
        try {
            const selectedYearCache = getAttendanceCacheForYear(
                cache,
                getSelectedAcademicYear(),
            );
            const records = displayEnabled && globalThis.KLPFKuportAccess.ready && getSelectedAcademicYear() === getCurrentAcademicYear()
                ? selectedYearCache.records
                : [];
            for (const card of document.querySelectorAll('.lms-card')) {
                card.querySelectorAll(`.${RATE_CLASS}`).forEach(element => element.remove());

                // 今年度のキャッシュは更新処理の待機中も表示し続ける。
                const record = findAttendanceRecord(card, records, selectedYearCache.academicYear);
                if (!record) continue;
                const roleSlots = card.querySelectorAll('.lms-cardrole');
                if (roleSlots.length === 0) continue;
                const { lastAttendanceElement, rateElement } = createAttendanceElements(
                    record,
                    selectedYearCache,
                );
                roleSlots[0].appendChild(lastAttendanceElement);
                (roleSlots[1] || roleSlots[0]).appendChild(rateElement);
            }
        } finally {
            const weeklyArea = document.querySelector('.lms-weekly-area');
            observer?.observe(weeklyArea || document.documentElement, { childList: true, subtree: true });
        }
    }

    /**
     * 保存済みの出席率を読み取り、授業カードへ反映する。
     * @returns {Promise<void>} 処理の完了を待つPromise。
     */
    async function loadAndRenderAttendanceRates() {
        const stored = await chrome.storage.local.get(CACHE_KEY);
        const cache = stored[CACHE_KEY];
        renderAttendanceRates(cache);
    }

    /**
     * 連続した変更をまとめ、次の表示更新を予約する。
     * @returns {void} 戻り値はない。
     */
    function scheduleRender() {
        if (scheduledRender !== null) return;
        scheduledRender = requestAnimationFrame(() => {
            void loadAndRenderAttendanceRates().catch(error => {
                scheduledRender = null;
                console.error(`[${FEATURE_NAME}] 出席率表示の更新に失敗しました。`, error);
            });
        });
    }

    /**
     * 現在表示中の年度についてバックグラウンドへ出席率更新を要求する。
     * @returns {Promise<void>} 処理の完了を待つPromise。
     */
    async function requestAttendanceForSelectedYear() {
        if (!displayEnabled || !globalThis.KLPFKuportAccess.ready) return;
        const academicYear = getSelectedAcademicYear();
        if (!academicYear || academicYear !== getCurrentAcademicYear()
            || deferredAcademicYear === academicYear
            || requestedAcademicYears.has(academicYear)) return;

        const stored = await chrome.storage.local.get(CACHE_KEY);
        if (!displayEnabled || !globalThis.KLPFKuportAccess.ready) return;
        const yearCache = getAttendanceCacheForYear(stored[CACHE_KEY], academicYear);
        if (Number.isFinite(yearCache.completedAt)
            && Date.now() - yearCache.completedAt <= CACHE_MAX_AGE_MS) {
            requestedAcademicYears.add(academicYear);
            return;
        }

        requestedAcademicYears.add(academicYear);
        setRefreshDisplayState('loading-cache');
        let response;
        try {
            response = await chrome.runtime.sendMessage({
                type: 'request-attendance-rate-refresh',
                academicYear,
            });
        } catch (error) {
            requestedAcademicYears.delete(academicYear);
            console.debug(`[${FEATURE_NAME}] ${academicYear}年度の更新を開始できませんでした。`, error);
            if (getSelectedAcademicYear() === academicYear) {
                setRefreshDisplayState('cache-fallback');
            }
            return;
        }

        if (response?.status === 'already-running'
            && response.academicYear
            && response.academicYear !== academicYear) {
            requestedAcademicYears.delete(academicYear);
            deferredAcademicYear = academicYear;
            return;
        }
        if (getSelectedAcademicYear() !== academicYear) return;

        if (response?.status === 'auto-login-disabled') {
            showAttendanceRefreshError(AUTO_LOGIN_REQUIRED_MESSAGE);
            setRefreshDisplayState('cache-fallback');
        } else if (response?.status === 'consent-required') {
            showAttendanceRefreshError('出席率表示のデータ取得への同意が必要です。設定を確認してください。');
            setRefreshDisplayState('cache-fallback');
        } else if (response?.status === 'feature-disabled') {
            showAttendanceRefreshError('出席率表示が無効になっています。設定を確認してください。');
            setRefreshDisplayState('cache-fallback');
        } else if (response?.status === 'unsupported-academic-year') {
            showAttendanceRefreshError(
                `出席率表示は${response.currentAcademicYear || getCurrentAcademicYear()}年度のみ利用できます。`
            );
            setRefreshDisplayState('cache-fallback');
        } else if (response?.status === 'kuport-already-open' || response?.status === 'kuport-open') {
            showAttendanceRefreshError('Ku-portが開いているため、出席状況の自動更新を中止しました。');
            setRefreshDisplayState('cache-fallback');
        } else if (response?.status === 'browser-session-already-checked') {
            setRefreshDisplayState(
                response.previousStatus === 'completed' ? 'cache' : 'cache-fallback'
            );
        } else if (['started', 'started-existing-session', 'already-running'].includes(response?.status)) {
            setRefreshDisplayState('loading-cache');
        } else if (response?.status === 'error') {
            const detail = String(response.error || '').replace(/\s+/g, ' ').trim().slice(0, 140);
            showAttendanceRefreshError(
                detail ? `出席状況の更新を開始できませんでした。${detail}` : '出席状況の更新を開始できませんでした。'
            );
            setRefreshDisplayState('cache-fallback');
        } else {
            setRefreshDisplayState('cache-fallback');
        }
    }

    /**
     * 表示年度の変更を確認し、出席率表示と取得要求を切り替える。
     * @returns {void} 戻り値はない。
     */
    function checkAcademicYearFilter() {
        const academicYear = getSelectedAcademicYear();
        if (!academicYear || academicYear === lastObservedAcademicYear) return;
        lastObservedAcademicYear = academicYear;
        setRefreshDisplayState('cache');
        scheduleRender();
        void requestAttendanceForSelectedYear();
    }

    /**
     * DOM変更が年度検索条件に関係するか判定する。
     * @param {MutationRecord} mutation - 監視対象に発生したDOM変更。
     * @returns {boolean} 年度条件に関係するDOM変更ならtrue。
     */
    function mutationTouchesAcademicYearFilter(mutation) {
        const target = mutation.target instanceof Element
            ? mutation.target
            : mutation.target.parentElement;
        if (target?.closest(LMS_YEAR_FILTER_SELECTOR)) return true;
        for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
            if (node instanceof Element
                && (node.matches(LMS_YEAR_FILTER_SELECTOR)
                    || node.querySelector(LMS_YEAR_FILTER_SELECTOR))) return true;
        }
        return false;
    }

    /**
     * 出席率の設定と共通認証条件を読み直し、キャッシュの表示と自動取得を再開・停止する。
     * @returns {Promise<void>} 最新状態の反映完了。
     */
    async function reloadAccessState() {
        const revision = ++accessRevision;
        const settings = await chrome.storage.sync.get('attendanceRateDisplay');
        if (revision !== accessRevision) return;
        displayEnabled = settings.attendanceRateDisplay === true && globalThis.KLPFKuportAccess.ready;
        if (!displayEnabled) {
            requestedAcademicYears.clear();
            deferredAcademicYear = '';
        }
        scheduleRender();
        if (displayEnabled) void requestAttendanceForSelectedYear();
    }

    /**
     * KU-LMS側の出席率表示と更新要求の監視を開始する。
     * @returns {void} 戻り値はない。
     */
    function startLmsDisplay() {
        unsubscribeAccess = globalThis.KLPFKuportAccess.subscribe(() => void reloadAccessState().catch(error => console.debug('[KLPF] 出席率の利用条件を確認できませんでした。', error)));
        injectStyles();
        observer = new MutationObserver(scheduleRender);
        void loadAndRenderAttendanceRates();
        yearFilterObserver = new MutationObserver(mutations => {
            if (mutations.some(mutationTouchesAcademicYearFilter)) checkAcademicYearFilter();
        });
        yearFilterObserver.observe(document.documentElement, {
            childList: true,
            subtree: true,
            characterData: true,
        });
        checkAcademicYearFilter();
        storageChangeListener = (changes, area) => {
            if (area === 'sync' && changes.attendanceRateDisplay) {
                void reloadAccessState().catch(error => console.debug('[KLPF] 出席率の設定を反映できませんでした。', error));
            }
            if (area === 'local' && changes[CACHE_KEY]) {
                const savedYear = String(changes[CACHE_KEY].newValue?.academicYear || '');
                if (savedYear === getSelectedAcademicYear()) setRefreshDisplayState('latest');
                scheduleRender();
            }
        };
        chrome.storage.onChanged.addListener(storageChangeListener);
        runtimeMessageListener = message => {
            if (message.type !== 'klpf-attendance-debug') return false;
            const selectedYear = getSelectedAcademicYear();
            const messageYear = String(message.details?.academicYear || '');
            if (message.stage === '新しい出席率キャッシュを保存'
                && (!messageYear || messageYear === selectedYear)) {
                setRefreshDisplayState('latest');
            } else if (message.stage === '出席状況の手動更新を開始'
                && (!messageYear || messageYear === selectedYear)) {
                setRefreshDisplayState('loading-cache');
            } else if (message.stage === '処理終了') {
                if (!messageYear || messageYear === selectedYear) {
                    setRefreshDisplayState(
                        message.details?.status === 'completed' ? 'latest' : 'cache-fallback'
                    );
                }
                if (selectedYear && messageYear && messageYear !== selectedYear) {
                    if (deferredAcademicYear === selectedYear) deferredAcademicYear = '';
                    requestedAcademicYears.delete(selectedYear);
                    void requestAttendanceForSelectedYear();
                }
            } else if (/取得中止|自動取得中止|取得失敗/.test(message.stage)
                && (!messageYear || messageYear === selectedYear)) {
                setRefreshDisplayState('cache-fallback');
                if (message.stage === 'バックグラウンド取得失敗') {
                    const detail = String(message.details?.error || '')
                        .replace(/\s+/g, ' ').trim().slice(0, 140);
                    showAttendanceRefreshError(
                        detail ? `出席状況の更新に失敗しました。${detail}` : '出席状況の更新に失敗しました。'
                    );
                }
            }
            return false;
        };
        chrome.runtime.onMessage.addListener(runtimeMessageListener);
    }

    /**
     * 登録した監視・イベント・タイマーを終了する。
     * @returns {void} 戻り値はない。
     */
    function cleanup() {
        unsubscribeAccess?.();
        unsubscribeAccess = null;
        observer?.disconnect();
        observer = null;
        yearFilterObserver?.disconnect();
        yearFilterObserver = null;
        if (storageChangeListener) chrome.storage.onChanged.removeListener(storageChangeListener);
        storageChangeListener = null;
        if (runtimeMessageListener) chrome.runtime.onMessage.removeListener(runtimeMessageListener);
        runtimeMessageListener = null;
        if (scheduledCapture !== null) clearTimeout(scheduledCapture);
        scheduledCapture = null;
        if (scheduledRender !== null) cancelAnimationFrame(scheduledRender);
        scheduledRender = null;
        requestedAcademicYears.clear();
        deferredAcademicYear = '';
    }

    /**
     * 設定と対象ページを確認し、機能の初期化を開始する。
     * @returns {void} 戻り値はない。
     */
    function main() {
        if (location.hostname === KUPORT_HOST) startKuportCapture();
        else if (location.hostname === LMS_HOST) startLmsDisplay();
        window.addEventListener('pagehide', cleanup, { once: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main, { once: true });
    } else {
        main();
    }
})();
