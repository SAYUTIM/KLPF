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
    const CARD_INFO_TEXT_CLASS = 'klpf-attendance-card-info-text';
    const BADGE_CLASS = 'klpf-attendance-badge';
    const HOME_INFO_FORM_SELECTOR = 'form#homehomlInfo[name="homeHomlActionForm"]';
    const HOME_MAIN_FORM_SELECTOR = 'form#homeHomlForm[name="homeHomlActionForm"]';
    const COURSE_CARD_SELECTOR = '.lms-card';
    const COURSE_LINK_SELECTOR = '.lms-cardname a[onclick*="formSubmit"]';
    const COURSE_INFO_SELECTOR = '.courseCardInfo';
    const PROBE_CONCURRENCY = 1;
    const CACHE_KEY = 'klpf-home-attendance-cache';
    const CACHE_TTL_MS = 5 * 60 * 1000;

    function isHomePage() {
        return window.location.href.startsWith(LMS_HOME_URL)
            || !!safeQuerySelector(HOME_INFO_FORM_SELECTOR)
            || !!safeQuerySelector(HOME_MAIN_FORM_SELECTOR);
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .${CARD_INFO_CLASS} {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                flex-wrap: wrap;
            }
            .${CARD_INFO_TEXT_CLASS} {
                flex: 1 1 auto;
                min-width: 0;
            }
            .${BADGE_CLASS} {
                display: none;
                flex: 0 0 auto;
            }
            .${BADGE_CLASS}[data-visible="true"] {
                display: inline-flex;
                align-items: center;
            }
            .${BADGE_CLASS}::before {
                content: "出席";
                display: inline-flex;
                align-items: center;
                justify-content: center;
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
            }
        `;
        document.head.appendChild(style);
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

    function hasAttendanceButton(htmlText) {
        const doc = new DOMParser().parseFromString(htmlText, 'text/html');
        const buttons = Array.from(doc.querySelectorAll('input[value="出席"]'));

        return buttons.some(button => {
            const onclick = button.getAttribute('onclick') || button.getAttribute('onClick') || '';
            return onclick.includes('syussekiSentakuAdd()');
        });
    }

    async function probeCourseAttendance(linkKougiUrl, formFields, courseId) {
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

        const htmlText = await response.text();
        const hasAttendance = hasAttendanceButton(htmlText);
        // console.log(`[${FEATURE_NAME}] 科目 ${courseId}: ${hasAttendance ? '出席あり' : '出席なし'}`);
        return hasAttendance;
    }

    async function probeAttendances(linkKougiUrl, formFields, courseIds, concurrency, onResult) {
        const queue = [...courseIds];
        const detectedCourseIds = [];
        const workerCount = Math.min(concurrency, queue.length);

        async function worker() {
            while (queue.length > 0) {
                const courseId = queue.shift();
                if (!courseId) return;

                try {
                    const hasAttendance = await probeCourseAttendance(linkKougiUrl, formFields, courseId);
                    if (typeof onResult === 'function') {
                        onResult(courseId, hasAttendance);
                    }
                    if (hasAttendance) {
                        detectedCourseIds.push(courseId);
                    }
                } catch (error) {
                    // console.warn(`[${FEATURE_NAME}] 科目 ${courseId} の出席判定に失敗しました。`, error);
                }
            }
        }

        await Promise.all(Array.from({ length: workerCount }, () => worker()));
        return detectedCourseIds;
    }

    function ensureBadge(courseInfo) {
        let badge = safeQuerySelector(`.${BADGE_CLASS}`, courseInfo);
        if (badge) return badge;

        courseInfo.classList.add(CARD_INFO_CLASS);

        let textWrapper = safeQuerySelector(`.${CARD_INFO_TEXT_CLASS}`, courseInfo);
        if (!textWrapper) {
            textWrapper = document.createElement('span');
            textWrapper.className = CARD_INFO_TEXT_CLASS;

            while (courseInfo.firstChild) {
                textWrapper.appendChild(courseInfo.firstChild);
            }

            courseInfo.appendChild(textWrapper);
        }

        badge = document.createElement('span');
        badge.className = BADGE_CLASS;
        badge.dataset.visible = 'false';
        badge.setAttribute('aria-hidden', 'true');
        courseInfo.appendChild(badge);
        return badge;
    }

    function showAttendanceBadge(targets) {
        targets.forEach(({ card, courseInfo }) => {
            const badge = ensureBadge(courseInfo);
            badge.dataset.visible = 'true';
            card.dataset.klpfAttendance = 'true';
        });
    }

    function hideAttendanceBadge(targets) {
        targets.forEach(({ card, courseInfo }) => {
            const badge = ensureBadge(courseInfo);
            badge.dataset.visible = 'false';
            delete card.dataset.klpfAttendance;
        });
    }

    function applyAttendanceState(entry, hasAttendance) {
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

        const courseEntries = collectCourseEntries();
        if (courseEntries.length === 0) return;
        const homeForm = safeQuerySelector(HOME_MAIN_FORM_SELECTOR);
        if (!homeForm) return;
        const formFields = serializeFormFields(homeForm);
        const linkKougiUrl = buildLinkKougiUrl(homeForm.action);
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

            const detectedCourseIds = new Set(await probeAttendances(
                linkKougiUrl,
                formFields,
                courseIds,
                PROBE_CONCURRENCY,
                (courseId, hasAttendance) => {
                    const entry = courseEntryMap.get(courseId);
                    if (!entry) return;
                    applyAttendanceState(entry, hasAttendance);
                },
            ));

            writeCache(linkKougiUrl, courseIds, Array.from(detectedCourseIds));

            for (const entry of courseEntries) {
                applyAttendanceState(entry, detectedCourseIds.has(entry.courseId));
            }
        } catch (error) {
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
