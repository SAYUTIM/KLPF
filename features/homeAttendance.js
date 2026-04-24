// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file ホーム画面の科目カードに出席バッジを表示するモジュール
 */

(function() {
    'use strict';

    const FEATURE_NAME = 'KLPF';
    const STYLE_ID = 'klpf-home-attendance-style';
    const CARD_INFO_CLASS = 'klpf-attendance-card-info';
    const BADGE_CLASS = 'klpf-attendance-badge';
    const HOME_INFO_FORM_SELECTOR = 'form#homehomlInfo[name="homeHomlActionForm"]';
    const HOME_MAIN_FORM_SELECTOR = 'form#homeHomlForm[name="homeHomlActionForm"]';
    const COURSE_CARD_SELECTOR = '.lms-card';
    const COURSE_LINK_SELECTOR = '.lms-cardname a[onclick*="formSubmit"]';
    const COURSE_INFO_SELECTOR = '.courseCardInfo';
    const ATTENDANCE_IFRAME_SELECTOR = '#iframeCosa';
    const ATTENDANCE_IFRAME_FORM_SELECTOR = 'form[name="corsCosaActionForm"]';
    const ATTENDANCE_IFRAME_TARGET = 'dispCosa';
    const PAGE_BRIDGE_SCRIPT_ID = 'klpf-home-attendance-page-bridge';
    const PAGE_BRIDGE_RESOURCE_PATH = 'features/pageWorld/homeAttendance.js';
    const OPEN_POPUP_EVENT_NAME = 'klpf-home-attendance-open-popup';
    const PROBE_CONCURRENCY = 1;
    const CACHE_KEY = 'klpf-home-attendance-cache';
    const CACHE_TTL_MS = 5 * 60 * 1000;

    let activeProbeController = null;
    let hasUserInteracted = false;

    function isHomePage() {
        return window.location.href.startsWith(LMS_HOME_URL)
            || !!safeQuerySelector(HOME_INFO_FORM_SELECTOR)
            || !!safeQuerySelector(HOME_MAIN_FORM_SELECTOR);
    }

    function extractCourseId(link) {
        const onclick = link?.getAttribute('onclick') || '';
        const match = onclick.match(/formSubmit\s*\(\s*'([^']+)'\s*\)/);
        return match ? match[1] : null;
    }

    function collectCourseEntries() {
        const entries = new Map();

        safeQuerySelectorAll(COURSE_CARD_SELECTOR).forEach(card => {
            const courseInfo = safeQuerySelector(COURSE_INFO_SELECTOR, card);
            const link = safeQuerySelector(COURSE_LINK_SELECTOR, card);
            const courseId = extractCourseId(link);

            if (!courseInfo || !link || !courseId) return;

            const entry = entries.get(courseId) || { courseId, targets: [] };
            entry.targets.push({ card, courseInfo });
            entries.set(courseId, entry);
        });

        return Array.from(entries.values());
    }

    function buildLinkKougiUrl(formAction) {
        const actionUrl = new URL(formAction);
        const sidPart = actionUrl.pathname.match(/;SID=.*$/)?.[0] || '';
        return `${actionUrl.origin}/lms/homeHoml/linkKougi${sidPart}`;
    }

    // ---- キャッシュ / 出席判定 ----

    function readCache() {
        try {
            const raw = sessionStorage.getItem(CACHE_KEY);
            if (!raw) return null;

            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return null;
            if (typeof parsed.timestamp !== 'number' || !Array.isArray(parsed.detectedCourseIds)) return null;
            if ((Date.now() - parsed.timestamp) > CACHE_TTL_MS) return null;

            return parsed;
        } catch (error) {
            // console.warn(`[${FEATURE_NAME}] 出席キャッシュの読み込みに失敗しました。`, error);
            return null;
        }
    }

    function writeCache(linkKougiUrl, courseIds, detectedCourseIds) {
        try {
            sessionStorage.setItem(CACHE_KEY, JSON.stringify({
                timestamp: Date.now(),
                linkKougiUrl,
                courseIds,
                detectedCourseIds,
            }));
        } catch (error) {
            // console.warn(`[${FEATURE_NAME}] 出席キャッシュの保存に失敗しました。`, error);
        }
    }

    function getCachedDetectedCourseIds(linkKougiUrl, courseIds) {
        const cache = readCache();
        if (!cache) return null;
        if (cache.linkKougiUrl !== linkKougiUrl) return null;
        if (JSON.stringify(cache.courseIds) !== JSON.stringify(courseIds)) return null;
        return cache.detectedCourseIds;
    }

    function abortActiveProbe() {
        if (activeProbeController) {
            activeProbeController.abort();
            activeProbeController = null;
        }
    }

    function markUserInteraction() {
        hasUserInteracted = true;
        abortActiveProbe();
    }

    function setupAbortOnUserInteraction(homeForm) {
        document.addEventListener('pointerdown', (event) => {
            if (event.target.closest(COURSE_CARD_SELECTOR) || event.target.closest(COURSE_LINK_SELECTOR)) {
                markUserInteraction();
            }
        }, true);

        document.addEventListener('click', (event) => {
            if (event.target.closest(COURSE_CARD_SELECTOR) || event.target.closest(COURSE_LINK_SELECTOR)) {
                markUserInteraction();
            }
        }, true);

        homeForm.addEventListener('submit', markUserInteraction, true);
        window.addEventListener('pagehide', markUserInteraction, { once: true });
    }

    function serializeFormFields(form) {
        const fields = {};
        const formData = new FormData(form);

        for (const [key, value] of formData.entries()) {
            fields[key] = typeof value === 'string' ? value : '';
        }

        return fields;
    }

    function buildRequestBody(formFields, courseId) {
        const params = new URLSearchParams();
        const mergedFields = { ...formFields, kougiId: courseId };

        if (!('groupId' in mergedFields)) {
            mergedFields.groupId = '';
        }

        for (const [key, value] of Object.entries(mergedFields)) {
            params.set(key, typeof value === 'string' ? value : '');
        }

        return params.toString();
    }

    function buildProbeContext(homeForm) {
        return {
            formFields: serializeFormFields(homeForm),
            linkKougiUrl: buildLinkKougiUrl(homeForm.action),
        };
    }

    // ---- UI / クリック / ポップアップ ----

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .${CARD_INFO_CLASS} {
                position: relative;
                padding-right: 68px;
                z-index: 1;
            }
            .${BADGE_CLASS} {
                position: absolute;
                top: 50%;
                right: 8px;
                transform: translateY(-50%);
                display: inline-flex;
                align-items: center;
                justify-content: center;
                height: 22px;
                min-height: 22px;
                padding: 0 9px;
                border-radius: 999px;
                border: 1px solid #c94747;
                font-size: 11px;
                font-weight: 600;
                line-height: 1;
                letter-spacing: 0.02em;
                white-space: nowrap;
                color: #fff7f7;
                background: #cf4b4b;
                box-shadow: none;
                cursor: pointer;
                appearance: none;
                -webkit-appearance: none;
                outline: none;
                pointer-events: auto;
                z-index: 10;
            }
            .${BADGE_CLASS}:disabled {
                opacity: 0.75;
                cursor: wait;
            }
        `;
        document.head.appendChild(style);
    }

    function injectPageBridge() {
        if (document.getElementById(PAGE_BRIDGE_SCRIPT_ID)) {
            return;
        }

        const script = document.createElement('script');
        script.id = PAGE_BRIDGE_SCRIPT_ID;
        script.src = chrome.runtime.getURL(PAGE_BRIDGE_RESOURCE_PATH);
        script.async = false;
        (document.head || document.documentElement).appendChild(script);
    }

    function buildPopupDetail(homeForm) {
        const sid = homeForm.action.match(/;SID=[^/?#]*/)?.[0] || `;SID=${getSid() || ''}`;
        return {
            action: `${window.location.origin}/lms/corsCosa/${sid}`,
            iframeSelector: ATTENDANCE_IFRAME_SELECTOR,
            iframeId: ATTENDANCE_IFRAME_TARGET,
            formSelector: ATTENDANCE_IFRAME_FORM_SELECTOR,
            targetName: ATTENDANCE_IFRAME_TARGET,
        };
    }

    function openAttendancePopupViaPage(homeForm) {
        document.dispatchEvent(new CustomEvent(OPEN_POPUP_EVENT_NAME, {
            detail: buildPopupDetail(homeForm),
        }));
    }

    async function setCurrentCourseContext(linkKougiUrl, formFields, courseId) {
        const response = await fetch(linkKougiUrl, {
            method: 'POST',
            credentials: 'include',
            cache: 'no-store',
            redirect: 'follow',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            },
            body: buildRequestBody(formFields, courseId),
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        await response.text();
    }

    async function openAttendancePopupForCourse(courseId, badge) {
        const homeForm = safeQuerySelector(HOME_MAIN_FORM_SELECTOR);
        if (!homeForm) {
            throw new Error('出席ポップアップを開くために必要な要素が見つかりません。');
        }

        markUserInteraction();
        badge.disabled = true;

        try {
            const { formFields, linkKougiUrl } = buildProbeContext(homeForm);
            await setCurrentCourseContext(linkKougiUrl, formFields, courseId);
            openAttendancePopupViaPage(homeForm);
        } finally {
            badge.disabled = false;
        }
    }

    async function tryOpenAttendancePopup(courseId, badge) {
        try {
            await openAttendancePopupForCourse(courseId, badge);
        } catch (error) {
            console.error(`[${FEATURE_NAME}] 出席ポップアップの表示に失敗しました。`, error);
        }
    }

    function isEventInsideElement(event, element) {
        const rect = element.getBoundingClientRect();
        return event.clientX >= rect.left
            && event.clientX <= rect.right
            && event.clientY >= rect.top
            && event.clientY <= rect.bottom;
    }

    function handleCardBadgeInteraction(event) {
        const card = event.currentTarget;
        if (!(card instanceof HTMLElement)) {
            return;
        }

        const badge = safeQuerySelector(`.${BADGE_CLASS}`, card);
        if (!(badge instanceof HTMLButtonElement) || !isEventInsideElement(event, badge)) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (event.type !== 'click' || badge.disabled) {
            return;
        }

        const courseId = card.dataset.klpfCourseId || '';
        if (!courseId) {
            return;
        }

        void tryOpenAttendancePopup(courseId, badge);
    }

    function setupCardBadgeInterception(card) {
        if (card.dataset.klpfAttendanceInterceptBound === 'true') {
            return;
        }

        card.addEventListener('pointerdown', handleCardBadgeInteraction, true);
        card.addEventListener('click', handleCardBadgeInteraction, true);
        card.dataset.klpfAttendanceInterceptBound = 'true';
    }

    function handleAttendanceBadgePointerDown(event) {
        event.preventDefault();
        event.stopPropagation();
    }

    function handleAttendanceBadgeClick(event, courseId) {
        event.preventDefault();
        event.stopPropagation();

        const badge = event.currentTarget;
        if (!(badge instanceof HTMLButtonElement) || badge.disabled) {
            return;
        }

        void tryOpenAttendancePopup(courseId, badge);
    }

    function hasAttendanceButton(htmlText) {
        const doc = new DOMParser().parseFromString(htmlText, 'text/html');
        const buttons = Array.from(doc.querySelectorAll('input[value="出席"]'));

        return buttons.some(button => {
            const onclick = button.getAttribute('onclick') || button.getAttribute('onClick') || '';
            return onclick.includes('syussekiSentakuAdd()');
        });
    }

    async function probeCourseAttendance(linkKougiUrl, formFields, courseId, signal) {
        const response = await fetch(linkKougiUrl, {
            method: 'POST',
            credentials: 'include',
            cache: 'no-store',
            redirect: 'follow',
            signal,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            },
            body: buildRequestBody(formFields, courseId),
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const htmlText = await response.text();
        const hasAttendance = hasAttendanceButton(htmlText);
        // console.log(`[${FEATURE_NAME}] 科目 ${courseId}: ${hasAttendance ? '出席あり' : '出席なし'}`);
        return hasAttendance;
    }

    async function probeAttendances(linkKougiUrl, formFields, courseIds, concurrency, signal, onResult) {
        const queue = [...courseIds];
        const detectedCourseIds = [];
        const workerCount = Math.min(concurrency, queue.length);

        async function worker() {
            while (queue.length > 0) {
                if (signal?.aborted) return;

                const courseId = queue.shift();
                if (!courseId) return;

                try {
                    const hasAttendance = await probeCourseAttendance(linkKougiUrl, formFields, courseId, signal);
                    if (signal?.aborted) return;

                    if (typeof onResult === 'function') {
                        onResult(courseId, hasAttendance);
                    }
                    if (hasAttendance) {
                        detectedCourseIds.push(courseId);
                    }
                } catch (error) {
                    if (error?.name === 'AbortError') {
                        return;
                    }
                    // console.warn(`[${FEATURE_NAME}] 科目 ${courseId} の出席判定に失敗しました。`, error);
                }
            }
        }

        await Promise.all(Array.from({ length: workerCount }, () => worker()));
        return detectedCourseIds;
    }

    function ensureBadge(card, courseInfo, courseId) {
        let badge = safeQuerySelector(`.${BADGE_CLASS}`, courseInfo);
        if (badge) return badge;

        courseInfo.classList.add(CARD_INFO_CLASS);
        setupCardBadgeInterception(card);

        badge = document.createElement('button');
        badge.type = 'button';
        badge.className = BADGE_CLASS;
        badge.textContent = '出席';
        badge.setAttribute('aria-label', '出席ポップアップを開く');
        badge.addEventListener('pointerdown', handleAttendanceBadgePointerDown);
        badge.addEventListener('click', event => handleAttendanceBadgeClick(event, courseId));
        courseInfo.appendChild(badge);
        return badge;
    }

    function cleanupBadge(courseInfo) {
        const badge = safeQuerySelector(`.${BADGE_CLASS}`, courseInfo);
        if (badge) {
            badge.remove();
        }
        courseInfo.classList.remove(CARD_INFO_CLASS);
    }

    function showAttendanceBadge(targets) {
        targets.forEach(({ card, courseInfo }) => {
            const courseId = card.dataset.klpfCourseId || '';
            ensureBadge(card, courseInfo, courseId);
            card.dataset.klpfAttendance = 'true';
        });
    }

    function hideAttendanceBadge(targets) {
        targets.forEach(({ card, courseInfo }) => {
            cleanupBadge(courseInfo);
            delete card.dataset.klpfAttendance;
        });
    }

    function applyAttendanceState(entry, hasAttendance) {
        entry.targets.forEach(({ card }) => {
            card.dataset.klpfCourseId = entry.courseId;
        });
        if (hasAttendance) {
            showAttendanceBadge(entry.targets);
        } else {
            hideAttendanceBadge(entry.targets);
        }
    }

    async function main() {
        if (!isHomePage()) return;

        await waitForElement(COURSE_CARD_SELECTOR, document, 10000);
        if (!safeQuerySelector(HOME_MAIN_FORM_SELECTOR)) return;

        injectStyles();
        injectPageBridge();

        const courseEntries = collectCourseEntries();
        if (courseEntries.length === 0) return;
        const homeForm = safeQuerySelector(HOME_MAIN_FORM_SELECTOR);
        if (!homeForm) return;
        setupAbortOnUserInteraction(homeForm);

        const { formFields, linkKougiUrl } = buildProbeContext(homeForm);
        const courseIds = courseEntries.map(entry => entry.courseId);
        const courseEntryMap = new Map(courseEntries.map(entry => [entry.courseId, entry]));
        // console.log(`[${FEATURE_NAME}] ホーム出席表示を開始します。対象科目数: ${courseEntries.length}, 並列数: ${Math.min(PROBE_CONCURRENCY, courseEntries.length)}`);

        try {
            const cachedDetectedCourseIds = getCachedDetectedCourseIds(linkKougiUrl, courseIds);

            if (cachedDetectedCourseIds) {
                // console.log(`[${FEATURE_NAME}] 出席判定キャッシュを使用しました。件数: ${cachedDetectedCourseIds.length}`);
                const cachedDetectedCourseIdSet = new Set(cachedDetectedCourseIds);
                for (const entry of courseEntries) {
                    applyAttendanceState(entry, cachedDetectedCourseIdSet.has(entry.courseId));
                }
            }

            activeProbeController = new AbortController();
            const detectedCourseIds = new Set(await probeAttendances(
                linkKougiUrl,
                formFields,
                courseIds,
                PROBE_CONCURRENCY,
                activeProbeController.signal,
                (courseId, hasAttendance) => {
                    const entry = courseEntryMap.get(courseId);
                    if (!entry) return;
                    applyAttendanceState(entry, hasAttendance);
                },
            ));
            activeProbeController = null;
            if (hasUserInteracted) return;

            writeCache(linkKougiUrl, courseIds, Array.from(detectedCourseIds));

            for (const entry of courseEntries) {
                applyAttendanceState(entry, detectedCourseIds.has(entry.courseId));
            }
        } catch (error) {
            if (error?.name === 'AbortError') {
                return;
            }
            console.error(`[${FEATURE_NAME}] ホーム画面の出席バッジ表示に失敗しました。`, error);
        }
    }

    const safeRun = () => main().catch(error => {
        console.error(`[${FEATURE_NAME}] ホーム画面の出席バッジ機能でエラーが発生しました。`, error);
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', safeRun, { once: true });
    } else {
        safeRun();
    }
})();
