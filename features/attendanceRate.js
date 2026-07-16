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
    const CACHE_VERSION = 3;
    const STYLE_ID = 'klpf-attendance-rate-style';
    const RATE_CLASS = 'klpf-attendance-rate';
    const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

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
    let scheduledCapture = null;
    let scheduledRender = null;
    let storageChangeListener = null;
    let runtimeMessageListener = null;
    let autoFetchRequested = false;
    let sessionBootstrapReported = false;
    let refreshDisplayState = 'cache';

    async function captureKuportAttendance() {
        scheduledCapture = null;
        const container = document.getElementById(ATTENDANCE_TABLE_ID);
        if (!container) return false;

        const records = parseAttendanceRecords(container);
        if (records.length === 0) return false;
        const termSelect = document.getElementById(TERM_SELECT_ID);
        const academicTerm = termSelect instanceof HTMLSelectElement
            ? normalizeText(termSelect.selectedOptions[0]?.textContent)
            : '';

        await chrome.storage.local.set({
            [CACHE_KEY]: {
                version: CACHE_VERSION,
                updatedAt: Date.now(),
                academicTerm,
                records,
            },
        });
        if (autoFetchRequested) {
            void chrome.runtime.sendMessage({ type: 'attendance-rate-fetch-complete' }).catch(() => {});
        }
        return true;
    }

    function findAttendanceMenuLink() {
        return Array.from(document.querySelectorAll('a.ui-menuitem-link')).find(link =>
            normalizeText(link.textContent) === '学生出欠状況確認'
            && !link.classList.contains('ui-state-disabled')
        ) || null;
    }

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

    function scheduleCapture() {
        if (scheduledCapture !== null) clearTimeout(scheduledCapture);
        scheduledCapture = setTimeout(() => {
            void captureKuportAttendanceSafely();
        }, CAPTURE_DEBOUNCE_MS);
    }

    async function captureKuportAttendanceSafely() {
        try {
            return await captureKuportAttendance();
        } catch (error) {
            console.error(`[${FEATURE_NAME}] Ku-portの出席率保存に失敗しました。`, error);
            return false;
        }
    }

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

    function observeAttendanceTable(container) {
        observer?.disconnect();
        observer = new MutationObserver(scheduleCapture);
        observer.observe(container, { childList: true, subtree: true, characterData: true });
    }

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

    function getCardSchedule(card) {
        const weekday = normalizeText(card.closest('.lms-daybox')?.querySelector('h3')?.textContent);
        const period = normalizeText(card.querySelector('.courseCardInfo')?.textContent).match(/(\d+)限/)?.[1] || '';
        return `${DAY_ABBREVIATIONS[weekday] || ''}${period}`;
    }

    function findAttendanceRecord(card, records) {
        const courseName = normalizeCourseName(card.querySelector('.lms-cardname')?.textContent);
        if (!courseName) return null;

        const candidates = records.filter(record => record.normalizedName === courseName);
        const schedule = getCardSchedule(card);
        return candidates.find(record => record.schedule === schedule)
            || (candidates.length === 1 ? candidates[0] : null);
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
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
        `;
        (document.head || document.documentElement).appendChild(style);
    }

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

    function getRateLevelClass(rate) {
        if (rate >= 80) return 'is-good';
        if (rate >= 60) return 'is-warning';
        return 'is-danger';
    }

    function getRefreshStateLabel() {
        if (refreshDisplayState === 'latest') return '最新';
        if (['cache', 'cache-fallback'].includes(refreshDisplayState)) return 'キャッシュ';
        return '更新中';
    }

    function getRefreshStateDescription() {
        const descriptions = {
            latest: 'Ku-portから最新データを取得済み',
            'cache-fallback': 'Ku-portの更新に失敗または中断したため保存済みデータを表示',
            cache: '保存済みデータを表示',
            'loading-cache': '保存済みデータを表示しながらKu-portを更新中',
        };
        return descriptions[refreshDisplayState] || descriptions['loading-cache'];
    }

    function createAttendanceAccessibleLabel(record, cache) {
        const updatedAt = formatUpdatedAt(cache.updatedAt);
        return [
            `Ku-port集計 ${record.rate}%`,
            record.lastAttendanceDate && `最終カードタッチ ${record.lastAttendanceDate}`,
            getRefreshStateDescription(),
            cache.academicTerm,
            updatedAt && `データ更新 ${updatedAt}`,
        ].filter(Boolean).join('・');
    }

    function createAttendanceElements(record, cache) {
        const lastAttendanceElement = document.createElement('div');
        lastAttendanceElement.className = `${RATE_CLASS} klpf-attendance-last-row`;
        const lastDate = document.createElement('span');
        lastDate.className = 'klpf-attendance-last-date';
        lastDate.textContent = `最終カードタッチ ${record.lastAttendanceDate || '—'}`;
        lastAttendanceElement.appendChild(lastDate);

        const rateElement = document.createElement('div');
        rateElement.className = `${RATE_CLASS} klpf-attendance-rate-row is-${refreshDisplayState}`;
        rateElement.classList.add(getRateLevelClass(record.rate));
        const rateLabel = document.createElement('span');
        rateLabel.className = 'klpf-attendance-rate-value';
        rateLabel.textContent = `出席率 ${record.rate}%`;
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

    function setRefreshDisplayState(state) {
        if (refreshDisplayState === state) return;
        refreshDisplayState = state;
        scheduleRender();
    }

    function renderAttendanceRates(cache) {
        scheduledRender = null;
        observer?.disconnect();
        try {
            const records = Array.isArray(cache?.records) ? cache.records : [];
            const isFresh = Number.isFinite(cache?.updatedAt)
                && Date.now() - cache.updatedAt <= CACHE_MAX_AGE_MS;

            for (const card of document.querySelectorAll('.lms-card')) {
                card.querySelectorAll(`.${RATE_CLASS}`).forEach(element => element.remove());
                if (!isFresh) continue;

                const record = findAttendanceRecord(card, records);
                if (!record || !Number.isFinite(record.rate)) continue;
                const roleSlots = card.querySelectorAll('.lms-cardrole');
                if (roleSlots.length === 0) continue;
                const { lastAttendanceElement, rateElement } = createAttendanceElements(record, cache);
                roleSlots[0].appendChild(lastAttendanceElement);
                (roleSlots[1] || roleSlots[0]).appendChild(rateElement);
            }
        } finally {
            const weeklyArea = document.querySelector('.lms-weekly-area');
            observer?.observe(weeklyArea || document.documentElement, { childList: true, subtree: true });
        }
    }

    async function loadAndRenderAttendanceRates() {
        const stored = await chrome.storage.local.get(CACHE_KEY);
        const cache = stored[CACHE_KEY];
        renderAttendanceRates(cache);
    }

    function scheduleRender() {
        if (scheduledRender !== null) return;
        scheduledRender = requestAnimationFrame(() => {
            void loadAndRenderAttendanceRates().catch(error => {
                scheduledRender = null;
                console.error(`[${FEATURE_NAME}] 出席率表示の更新に失敗しました。`, error);
            });
        });
    }

    function startLmsDisplay() {
        injectStyles();
        observer = new MutationObserver(scheduleRender);
        void loadAndRenderAttendanceRates();
        storageChangeListener = (changes, area) => {
            if (area === 'local' && changes[CACHE_KEY]) {
                setRefreshDisplayState('latest');
                scheduleRender();
            }
        };
        chrome.storage.onChanged.addListener(storageChangeListener);
        runtimeMessageListener = message => {
            if (message.type !== 'klpf-attendance-debug') return false;
            if (message.stage === '新しい出席率キャッシュを保存') {
                setRefreshDisplayState('latest');
            } else if (message.stage === '出席状況の手動更新を開始') {
                setRefreshDisplayState('loading-cache');
            } else if (message.stage === '処理終了') {
                setRefreshDisplayState(
                    message.details?.status === 'completed' ? 'latest' : 'cache-fallback'
                );
            } else if (/取得中止|自動取得中止|取得失敗/.test(message.stage)) {
                setRefreshDisplayState('cache-fallback');
            }
            return false;
        };
        chrome.runtime.onMessage.addListener(runtimeMessageListener);
        chrome.runtime.sendMessage({ type: 'request-attendance-rate-refresh' }, response => {
            if (chrome.runtime.lastError) return;
            if (response?.status === 'auto-login-disabled') {
                showAttendanceRefreshError(AUTO_LOGIN_REQUIRED_MESSAGE);
                setRefreshDisplayState('cache-fallback');
            } else if (response?.status === 'browser-session-already-checked') {
                setRefreshDisplayState(
                    response.previousStatus === 'completed' ? 'cache' : 'cache-fallback'
                );
            } else if (['started', 'started-existing-session', 'already-running'].includes(response?.status)) {
                setRefreshDisplayState('loading-cache');
            } else if (!['started', 'already-running'].includes(response?.status)) {
                setRefreshDisplayState('cache-fallback');
            }
        });
    }

    function cleanup() {
        observer?.disconnect();
        observer = null;
        if (storageChangeListener) chrome.storage.onChanged.removeListener(storageChangeListener);
        storageChangeListener = null;
        if (runtimeMessageListener) chrome.runtime.onMessage.removeListener(runtimeMessageListener);
        runtimeMessageListener = null;
        if (scheduledCapture !== null) clearTimeout(scheduledCapture);
        scheduledCapture = null;
        if (scheduledRender !== null) cancelAnimationFrame(scheduledRender);
        scheduledRender = null;
    }

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
