// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file ホーム画面の科目カードに出席バッジを表示するモジュール
 * ホームの講義フォームを直列に取得して出席ボタンを検出し、短期キャッシュからバッジを復元する。
 * ページ側のダイアログ呼び出しはpageWorld/homeAttendanceへ委譲し、講義・課題への遷移時は通信を調整する。
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
    const HOMEWORK_NAVIGATION_REQUEST_EVENT = 'klpf-homework-navigation-request';
    const HOMEWORK_NAVIGATION_READY_EVENT = 'klpf-home-attendance-navigation-ready';
    const HOMEWORK_NAVIGATION_FLAG = 'klpfHomeworkNavigation';
    const ATTENDANCE_READY_FLAG = 'klpfHomeAttendanceReady';
    const PROBE_CONCURRENCY = 1;
    const PROBE_TIMEOUT_MS = 30000;
    const CACHE_KEY = 'klpf-home-attendance-cache';
    const CACHE_TTL_MS = 5 * 60 * 1000;

    let activeProbeController = null;
    let activeProbePromise = null;
    let hasAbortListenersBound = false;
    let hasUserInteracted = false;
    let courseNavigationInProgress = false;
    let courseNavigationRevision = 0;
    const pendingHomeworkNavigationRequests = new Set();

    /**
     * 課題画面への遷移要求が待機中か判定する。
     * @returns {boolean} 条件を満たす場合はtrue。
     */
    function isHomeworkNavigationPending() {
        return document.documentElement.dataset[HOMEWORK_NAVIGATION_FLAG] === 'true';
    }

    /**
     * 出席確認の通信終了を待つ課題機能へ遷移可能になったことを通知する。
     * @param {Error|null} [error=null] - 通信の時間切れなど、遷移を中断する理由。
     * @returns {void} 戻り値はない。
     */
    function notifyHomeworkNavigationReady(error = null) {
        for (const requestId of pendingHomeworkNavigationRequests) {
            document.dispatchEvent(new CustomEvent(HOMEWORK_NAVIGATION_READY_EVENT, {
                detail: { requestId, error: error?.message || '' },
            }));
        }
        pendingHomeworkNavigationRequests.clear();
    }

    /**
     * 課題画面への遷移要求を記録し、出席確認との競合を調整する。
     * @param {Event} event - 操作または通知のイベント。
     * @returns {void} 戻り値はない。
     */
    function handleHomeworkNavigationRequest(event) {
        const requestId = event.detail?.requestId;
        if (!requestId) return;

        hasUserInteracted = true;
        pendingHomeworkNavigationRequests.add(requestId);

        if (!activeProbePromise) {
            notifyHomeworkNavigationReady();
        }
    }

    document.documentElement.dataset[ATTENDANCE_READY_FLAG] = 'true';
    document.addEventListener(HOMEWORK_NAVIGATION_REQUEST_EVENT, handleHomeworkNavigationRequest);

    /**
     * 実行中のホーム出席確認が終了または中断するまで待つ。
     * @returns {Promise<void>} 処理の完了を待つPromise。
     */
    async function waitForActiveProbeToSettle() {
        if (!activeProbePromise) return;

        try {
            await activeProbePromise;
        } catch (error) {
            if (error?.name !== 'AbortError') throw error;
        }
    }

    /**
     * 講義フォームへ科目IDを設定し、対象の講義へ遷移する。
     * @param {string} courseId - KU-LMSの科目ID。
     * @returns {void} 戻り値はない。
     */
    function submitCourseNavigation(courseId) {
        const homeForm = safeQuerySelector(HOME_MAIN_FORM_SELECTOR);
        if (!homeForm) {
            throw new Error('講義ページへの遷移に必要なフォームが見つかりません。');
        }

        const courseIdInput = safeQuerySelector('input[name="kougiId"]', homeForm);
        const groupIdInput = safeQuerySelector('input[name="groupId"]', homeForm);
        if (!courseIdInput) {
            throw new Error('講義IDを設定するフォーム項目が見つかりません。');
        }

        courseIdInput.value = courseId;
        if (groupIdInput) groupIdInput.value = '';
        homeForm.action = buildLinkKougiUrl(homeForm.action);
        homeForm.submit();
    }

    /**
     * 出席確認の通信終了を待ってから対象の講義へ遷移する。
     * @param {string} courseId - KU-LMSの科目ID。
     * @returns {Promise<void>} 処理の完了を待つPromise。
     */
    async function navigateToCourse(courseId) {
        if (courseNavigationInProgress) return;

        courseNavigationInProgress = true;
        const revision = ++courseNavigationRevision;
        hasUserInteracted = true;

        try {
            await waitForActiveProbeToSettle();
            if (revision !== courseNavigationRevision) return;
            submitCourseNavigation(courseId);
        } catch (error) {
            if (revision !== courseNavigationRevision) return;
            courseNavigationInProgress = false;
            console.error(`[${FEATURE_NAME}] 講義ページへの遷移準備に失敗しました。`, error);
        }
    }

    /**
     * 講義リンクへのポインター操作を検知して自動確認を中断する。
     * @param {Event} event - 操作または通知のイベント。
     * @returns {void} 戻り値はない。
     */
    function handleCourseNavigationPointerDown(event) {
        if (!(event.target instanceof Element) || event.target.closest(`.${BADGE_CLASS}`)) {
            return;
        }
        if (event.target.closest(COURSE_LINK_SELECTOR)) {
            hasUserInteracted = true;
        }
    }

    /**
     * 講義リンクのクリックを受け付け、通信終了後の遷移へ切り替える。
     * @param {Event} event - 操作または通知のイベント。
     * @returns {void} 戻り値はない。
     */
    function handleCourseNavigationClick(event) {
        if (!(event.target instanceof Element)) return;
        if (event.target.closest(`.${BADGE_CLASS}`)) return;
        const link = event.target.closest(COURSE_LINK_SELECTOR);
        if (!link) return;

        const courseId = extractCourseId(link);
        if (!courseId) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        void navigateToCourse(courseId);
    }

    document.addEventListener('pointerdown', handleCourseNavigationPointerDown, true);
    document.addEventListener('click', handleCourseNavigationClick, true);
    // 履歴復帰で遷移状態を戻し、離脱前の遅い応答による意図しない遷移を防ぐ。
    const resetCourseNavigation = () => {
        courseNavigationRevision += 1;
        courseNavigationInProgress = false;
    };
    window.addEventListener('pagehide', resetCourseNavigation);
    window.addEventListener('pageshow', event => {
        if (event.persisted) resetCourseNavigation();
    });

    /**
     * 現在のURLが対象のKU-LMSホームか判定する。
     * @returns {boolean} 条件を満たす場合はtrue。
     */
    function isHomePage() {
        return window.location.href.startsWith(LMS_HOME_URL)
            || window.location.href.startsWith(LMS_HOME_BACK_URL)
            || window.location.href.startsWith(LMS_HOME_BACK_LEGACY_URL)
            || window.location.href.startsWith(LMS_HOME_KLIL_BACK_URL)
            || !!safeQuerySelector(HOME_INFO_FORM_SELECTOR)
            || !!safeQuerySelector(HOME_MAIN_FORM_SELECTOR);
    }

    /**
     * 講義リンクの送信処理から科目IDを取り出す。
     * @param {HTMLElement} link - 対象のリンク要素。
     * @returns {string|null} 講義リンクに設定された科目ID。読み取れなければnull。
     */
    function extractCourseId(link) {
        const onclick = link?.getAttribute('onclick') || '';
        const match = onclick.match(/formSubmit\s*\(\s*'([^']+)'\s*\)/);
        return match ? match[1] : null;
    }

    /**
     * 授業カードと科目ID・リンクの組を列挙する。
     * @returns {object[]} 科目IDとカード・リンクの対応一覧。
     */
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

    /**
     * フォームの送信先から講義画面を取得するURLを組み立てる。
     * @param {string} formAction - 講義フォームの送信先。
     * @returns {string} 講義画面を取得する絶対URL。
     */
    function buildLinkKougiUrl(formAction) {
        const actionUrl = new URL(formAction);
        const sidPart = actionUrl.pathname.match(/;SID=.*$/)?.[0] || '';
        return `${actionUrl.origin}/lms/homeHoml/linkKougi${sidPart}`;
    }

    // ---- キャッシュ / 出席判定 ----

    /**
     * ホームの出席ボタン検出結果を保存先から読み出す。
     * @returns {object|null} 保存された検出結果。読み込みに失敗した場合はnull。
     */
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

    /**
     * 対象科目と出席ボタンの検出結果を時刻付きで保存する。
     * @param {string} linkKougiUrl - 講義画面を取得する送信先URL。
     * @param {string[]} courseIds - 確認対象の科目ID一覧。
     * @param {string[]} detectedCourseIds - 出席ボタンが検出された科目ID一覧。
     * @returns {void} 戻り値はない。
     */
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

    /**
     * 対象URL・科目一覧・有効期限が一致する出席ボタン検出結果を取り出す。
     * @param {string} linkKougiUrl - 講義画面を取得する送信先URL。
     * @param {string[]} courseIds - 確認対象の科目ID一覧。
     * @returns {string[]|null} 有効な検出結果の科目ID。キャッシュを使えなければnull。
     */
    function getCachedDetectedCourseIds(linkKougiUrl, courseIds) {
        const cache = readCache();
        if (!cache) return null;
        if (cache.linkKougiUrl !== linkKougiUrl) return null;
        if (JSON.stringify(cache.courseIds) !== JSON.stringify(courseIds)) return null;
        return cache.detectedCourseIds;
    }

    /**
     * 実行中のホーム出席確認を中断する。
     * @returns {void} 戻り値はない。
     */
    function abortActiveProbe() {
        if (activeProbeController) {
            activeProbeController.abort();
            activeProbeController = null;
        }
    }

    /**
     * ユーザー操作を記録し、自動の出席確認を停止する。
     * @returns {void} 戻り値はない。
     */
    function markUserInteraction() {
        hasUserInteracted = true;
        abortActiveProbe();
    }

    /**
     * ユーザー操作が始まった場合に自動確認を中断するイベントを登録する。
     * @param {HTMLFormElement} homeForm - KU-LMSホームの講義操作用フォーム。
     * @returns {void} 戻り値はない。
     */
    function setupAbortOnUserInteraction(homeForm) {
        if (hasAbortListenersBound) {
            return;
        }

        homeForm.addEventListener('submit', markUserInteraction, true);
        window.addEventListener('pagehide', markUserInteraction, { once: true });
        hasAbortListenersBound = true;
    }

    /**
     * 講義フォームの送信情報に対象科目IDを加え、確認用のPOST本文を作る。
     * @param {object} formFields - フォームから読み取った送信フィールド。
     * @param {string} courseId - KU-LMSの科目ID。
     * @returns {string} 対象科目を設定したURLエンコード済みの送信本文。
     */
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

    /**
     * ホームのフォームから出席ボタン確認用のURLと送信フィールドを作る。
     * @param {HTMLFormElement} homeForm - KU-LMSホームの講義操作用フォーム。
     * @returns {object} 講義画面のURLと送信フィールド。
     */
    function buildProbeContext(homeForm) {
        return {
            formFields: globalThis.KLPFFormUtils.serializeFormObject(homeForm),
            linkKougiUrl: buildLinkKougiUrl(homeForm.action),
        };
    }

    // ---- UI / クリック / ポップアップ ----

    /**
     * 機能の表示に必要なスタイルをページへ追加する。
     * @returns {void} 戻り値はない。
     */
    function injectStyles() {
        ensureStyleElement(STYLE_ID, `
            .${CARD_INFO_CLASS} {
                position: relative;
                padding-right: 68px;
                z-index: 2;
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
        `);
    }

    /**
     * ページ固有の出席ダイアログ関数を呼ぶブリッジを注入する。
     * @returns {void} 戻り値はない。
     */
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

    /**
     * 出席ダイアログを開くためのフォーム情報を作る。
     * @param {HTMLFormElement} homeForm - KU-LMSホームの講義操作用フォーム。
     * @returns {object} 出席ポップアップへ渡すフォームと要素の識別情報。
     */
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

    /**
     * ページ側ブリッジへ出席ダイアログの表示を依頼する。
     * @param {HTMLFormElement} homeForm - KU-LMSホームの講義操作用フォーム。
     * @returns {void} 戻り値はない。
     */
    function openAttendancePopupViaPage(homeForm) {
        document.dispatchEvent(new CustomEvent(OPEN_POPUP_EVENT_NAME, {
            detail: buildPopupDetail(homeForm),
        }));
    }

    /**
     * 対象科目のフォーム状態を現在の出席操作へ設定する。
     * @param {string} linkKougiUrl - 講義画面を取得する送信先URL。
     * @param {object} formFields - フォームから読み取った送信フィールド。
     * @param {string} courseId - KU-LMSの科目ID。
     * @returns {Promise<void>} 処理の完了を待つPromise。
     */
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

    /**
     * 対象科目の画面情報を用意し、出席ダイアログを表示する。
     * @param {string} courseId - KU-LMSの科目ID。
     * @param {HTMLElement} badge - 対象カードの出席バッジ。
     * @returns {Promise<void>} 処理の完了を待つPromise。
     */
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

    /**
     * 対象科目の出席ダイアログ表示を試し、結果に応じてバッジを更新する。
     * @param {string} courseId - KU-LMSの科目ID。
     * @param {HTMLElement} badge - 対象カードの出席バッジ。
     * @returns {Promise<void>} 処理の完了を待つPromise。
     */
    async function tryOpenAttendancePopup(courseId, badge) {
        try {
            await openAttendancePopupForCourse(courseId, badge);
        } catch (error) {
            console.error(`[${FEATURE_NAME}] 出席ポップアップの表示に失敗しました。`, error);
        }
    }

    /**
     * ポインター操作が指定要素の範囲内か判定する。
     * @param {Event} event - 操作または通知のイベント。
     * @param {Element} element - 操作または読み取りの対象要素。
     * @returns {boolean} 条件を満たす場合はtrue。
     */
    function isEventInsideElement(event, element) {
        const rect = element.getBoundingClientRect();
        return event.clientX >= rect.left
            && event.clientX <= rect.right
            && event.clientY >= rect.top
            && event.clientY <= rect.bottom;
    }

    /**
     * カード内の出席バッジ操作が講義への遷移を引き起こさないよう処理する。
     * @param {Event} event - 操作または通知のイベント。
     * @returns {void} 戻り値はない。
     */
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

    /**
     * カード内の出席バッジ操作を捕捉するイベントを登録する。
     * @param {HTMLElement} card - 対象授業のカード要素。
     * @returns {void} 戻り値はない。
     */
    function setupCardBadgeInterception(card) {
        if (card.dataset.klpfAttendanceInterceptBound === 'true') {
            return;
        }

        card.addEventListener('pointerdown', handleCardBadgeInteraction, true);
        card.addEventListener('click', handleCardBadgeInteraction, true);
        card.dataset.klpfAttendanceInterceptBound = 'true';
    }

    /**
     * 出席バッジのポインター操作を捕捉し、カード側への伝播を制御する。
     * @param {Event} event - 操作または通知のイベント。
     * @returns {void} 戻り値はない。
     */
    function handleAttendanceBadgePointerDown(event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }

    /**
     * 出席バッジのクリックから対象科目の出席ダイアログを開く。
     * @param {Event} event - 操作または通知のイベント。
     * @param {string} courseId - KU-LMSの科目ID。
     * @returns {void} 戻り値はない。
     */
    function handleAttendanceBadgeClick(event, courseId) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        const badge = event.currentTarget;
        if (!(badge instanceof HTMLButtonElement) || badge.disabled) {
            return;
        }

        void tryOpenAttendancePopup(courseId, badge);
    }

    /**
     * 取得した講義HTMLに出席ボタンが含まれるか判定する。
     * @param {string} htmlText - 解析対象のHTML文字列。
     * @returns {boolean} 条件を満たす場合はtrue。
     */
    function hasAttendanceButton(htmlText) {
        const doc = new DOMParser().parseFromString(htmlText, 'text/html');
        const buttons = Array.from(doc.querySelectorAll('input[value="出席"]'));

        return buttons.some(button => {
            const onclick = button.getAttribute('onclick') || button.getAttribute('onClick') || '';
            return onclick.includes('syussekiSentakuAdd()');
        });
    }

    /**
     * 対象科目の講義HTMLを取得し、出席ボタンの有無を調べる。
     * @param {string} linkKougiUrl - 講義画面を取得する送信先URL。
     * @param {object} formFields - フォームから読み取った送信フィールド。
     * @param {string} courseId - KU-LMSの科目ID。
     * @param {AbortSignal} signal - 取得の中断を通知するシグナル。
     * @returns {Promise<boolean>} 対象科目に出席ボタンがある場合はtrue。
     */
    async function probeCourseAttendance(linkKougiUrl, formFields, courseId, signal) {
        const controller = new AbortController();
        const abort = () => controller.abort(signal.reason);
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
        const timeoutId = setTimeout(() => {
            controller.abort(new DOMException('ホーム出席確認の通信がタイムアウトしました。', 'TimeoutError'));
        }, PROBE_TIMEOUT_MS);
        try {
            const response = await fetch(linkKougiUrl, {
                method: 'POST',
                credentials: 'include',
                cache: 'no-store',
                redirect: 'follow',
                signal: controller.signal,
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
        } catch (error) {
            if (controller.signal.reason?.name === 'TimeoutError') throw controller.signal.reason;
            throw error;
        } finally {
            clearTimeout(timeoutId);
            signal.removeEventListener('abort', abort);
        }
    }

    /**
     * 指定した同時実行数で科目を確認し、出席ボタンの検出結果をまとめる。
     * @param {string} linkKougiUrl - 講義画面を取得する送信先URL。
     * @param {object} formFields - フォームから読み取った送信フィールド。
     * @param {string[]} courseIds - 確認対象の科目ID一覧。
     * @param {number} concurrency - 科目確認を同時に行う上限数。
     * @param {AbortSignal} signal - 取得の中断を通知するシグナル。
     * @param {Function} onResult - 科目ごとの確認結果を受け取る処理。
     * @returns {Promise<string[]>} 出席ボタンが検出された科目ID。
     */
    async function probeAttendances(linkKougiUrl, formFields, courseIds, concurrency, signal, onResult) {
        const queue = [...courseIds];
        const detectedCourseIds = [];
        const workerCount = Math.min(concurrency, queue.length);

        /**
         * 未処理の科目を順番に受け取り、出席ボタンの確認結果を通知する。
         * @returns {Promise<void>} 処理の完了を待つPromise。
         */
        async function worker() {
            while (queue.length > 0) {
                if (signal?.aborted || hasUserInteracted || isHomeworkNavigationPending()) return;

                const courseId = queue.shift();
                if (!courseId) return;

                try {
                    const hasAttendance = await probeCourseAttendance(linkKougiUrl, formFields, courseId, signal);
                    if (signal?.aborted || hasUserInteracted || isHomeworkNavigationPending()) return;

                    if (typeof onResult === 'function') {
                        onResult(courseId, hasAttendance);
                    }
                    if (hasAttendance) {
                        detectedCourseIds.push(courseId);
                    }
                } catch (error) {
                    if (error?.name === 'TimeoutError') throw error;
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

    /**
     * 授業カードに対象科目の出席バッジを用意する。
     * @param {HTMLElement} card - 対象授業のカード要素。
     * @param {HTMLElement} courseInfo - 授業カード内の出席バッジ配置先。
     * @param {string} courseId - KU-LMSの科目ID。
     * @returns {HTMLElement} 対象カードに用意した出席バッジ。
     */
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

    /**
     * 対象カードの出席バッジと操作用の情報を取り除く。
     * @param {HTMLElement} courseInfo - 授業カード内の出席バッジ配置先。
     * @returns {void} 戻り値はない。
     */
    function cleanupBadge(courseInfo) {
        const badge = safeQuerySelector(`.${BADGE_CLASS}`, courseInfo);
        if (badge) {
            badge.remove();
        }
        courseInfo.classList.remove(CARD_INFO_CLASS);
    }

    /**
     * 指定したカードの出席バッジを表示する。
     * @param {Element[]} targets - 出席バッジの表示を切り替える要素一覧。
     * @returns {void} 戻り値はない。
     */
    function showAttendanceBadge(targets) {
        targets.forEach(({ card, courseInfo }) => {
            const courseId = card.dataset.klpfCourseId || '';
            ensureBadge(card, courseInfo, courseId);
            card.dataset.klpfAttendance = 'true';
        });
    }

    /**
     * 指定したカードの出席バッジを非表示にする。
     * @param {Element[]} targets - 出席バッジの表示を切り替える要素一覧。
     * @returns {void} 戻り値はない。
     */
    function hideAttendanceBadge(targets) {
        targets.forEach(({ card, courseInfo }) => {
            cleanupBadge(courseInfo);
            delete card.dataset.klpfAttendance;
        });
    }

    /**
     * 出席ボタンの検出結果をカードのバッジ表示へ反映する。
     * @param {object} entry - 対象授業のカード・科目ID・表示情報。
     * @param {boolean} hasAttendance - 対象科目に出席ボタンが存在するかどうか。
     * @returns {void} 戻り値はない。
     */
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

    /**
     * 設定と対象ページを確認し、機能の初期化を開始する。
     * @returns {Promise<void>} 処理の完了を待つPromise。
     */
    async function main() {
        if (!isHomePage() || isHomeworkNavigationPending()) return;

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

        let probeError = null;
        try {
            const cachedDetectedCourseIds = getCachedDetectedCourseIds(linkKougiUrl, courseIds);

            if (cachedDetectedCourseIds) {
                // console.log(`[${FEATURE_NAME}] 出席判定キャッシュを使用しました。件数: ${cachedDetectedCourseIds.length}`);
                const cachedDetectedCourseIdSet = new Set(cachedDetectedCourseIds);
                for (const entry of courseEntries) {
                    applyAttendanceState(entry, cachedDetectedCourseIdSet.has(entry.courseId));
                }
            }

            if (hasUserInteracted || isHomeworkNavigationPending()) return;

            activeProbeController = new AbortController();
            activeProbePromise = probeAttendances(
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
            );
            const detectedCourseIds = new Set(await activeProbePromise);
            activeProbePromise = null;
            activeProbeController = null;
            if (hasUserInteracted) return;

            writeCache(linkKougiUrl, courseIds, Array.from(detectedCourseIds));

            for (const entry of courseEntries) {
                applyAttendanceState(entry, detectedCourseIds.has(entry.courseId));
            }
        } catch (error) {
            probeError = error?.name === 'TimeoutError' ? error : null;
            if (error?.name === 'AbortError') {
                return;
            }
            console.error(`[${FEATURE_NAME}] ホーム画面の出席バッジ表示に失敗しました。`, error);
        } finally {
            activeProbePromise = null;
            activeProbeController = null;
            notifyHomeworkNavigationReady(probeError);
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
