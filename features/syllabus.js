// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file KU-LMSホームの授業カードにシラバス取得ボタンと表示ポップアップを追加する。
 * DOMとChromeストレージから年度・授業情報・設定・30日キャッシュを読み、通信はService Workerへ依頼する。
 * 今年度の日〜土曜日のカードだけを対象とし、取得中表示・取消・再取得・背景スクロール復元を管理する。
 */

(() => {
    'use strict';

    const FEATURE_ENABLED_KEY = 'syllabusLookupEnabled';
    const ALL_FEATURES_DISABLED_KEY = 'klpfInlineAllFeaturesDisabled';
    const LMS_HOME_PATHS = [
        '/lms/homeHoml/',
        '/lms/tpicTpic/doBack',
        '/lms/tpicTpil/doBack',
        '/lms/klmsKlil/doBack',
    ];
    const COURSE_CARD_SELECTOR = '.lms-card';
    const COURSE_TEACHER_SELECTOR = '.lms-carduser';
    const LMS_YEAR_FILTER_SELECTOR = '.lms-search-condition-detail';
    const BUTTON_ATTRIBUTE = 'data-klpf-syllabus-button';
    const STYLE_ID = 'klpf-syllabus-style';
    const MODAL_ROOT_ID = 'klpf-syllabus-modal-root';
    const PROGRESS_MODAL_ROOT_ID = 'klpf-syllabus-progress-root';
    const NOTICE_ID = 'klpf-syllabus-notice';
    const MAX_SYLLABUS_TEXT_LENGTH = 60000;
    const ESTIMATED_SYLLABUS_DURATION_SECONDS = 9;
    const SYLLABUS_PHASE_INFO = Object.freeze({
        'opening-kuport': { progress: 10, label: 'Ku-Portと通信中' },
        'opening-student-schedule': { progress: 46, label: '学生時間割を開いています' },
        'loading-student-timetable': { progress: 66, label: '時間割を読み込み中' },
        'retrying-student-timetable': { progress: 74, label: '別の学期を確認中' },
        'opening-syllabus-dialog': { progress: 88, label: 'シラバスを開いています' },
    });
    const SYLLABUS_SECTION_LABELS = [
        '開講年度', '開講学期', '科目名（英語）', '科目名', '授業種別',
        '授業情報(授業コード・クラス・授業形態)', '担当教員', '単位数', '曜日時限',
        'キャンパス', '教室', '学年', '学位授与の方針', '具体的な到達目標',
        '受講にあたっての前提条件', '授業の方法とねらい', 'AL・ICT活用', '授業形態',
        '事前学習', '授業内容', '事後学習・事前学習', '事後学習', '成績評価の方法',
        '受講生へのフィードバック方法', '教科書', '参考書', 'オフィスアワー',
        '受講生へのメッセージ', '実務家担当科目', '実務経験の内容',
        '教職課程認定該当学科', 'その他の資格・認定プログラムとの関連', '教育課程コード',
        '授業概要', '授業の概要', '授業の目的', '到達目標', '授業計画', '授業方法',
        ...Array.from({ length: 15 }, (_, index) => `第${index + 1}回`),
    ];
    /**
     * 入力の全角・空白などをそろえ、照合用の文字列へ変換する。
     * @param {*} value - 検証・変換する入力値。
     * @returns {string} 照合用に整えた文字列。
     */
    const normalizeText = (value) => String(value || '')
        .normalize('NFKC')
        .replace(/[\s\u3000]+/g, ' ')
        .trim();

    /**
     * 授業カードのシラバスボタンと通知に使うスタイルを用意する。
     * @returns {void} 戻り値はない。
     */
    function ensureLmsStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .lms-card.klpf-syllabus-card {
                position: relative !important;
                overflow: visible !important;
            }
            [${BUTTON_ATTRIBUTE}] {
                position: absolute;
                top: 0;
                right: 0;
                z-index: 5;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 24px;
                height: 24px;
                min-height: 0;
                min-width: 0;
                box-sizing: border-box;
                margin: 0;
                padding: 0;
                border: 1px solid rgba(0, 114, 164, .36);
                border-radius: 5px;
                background: rgba(255, 255, 255, .95);
                color: #005882;
                cursor: pointer;
                font-size: 0;
                line-height: 0;
                translate: 0 -50%;
                transition: background-color .16s ease, color .16s ease, box-shadow .16s ease;
            }
            [${BUTTON_ATTRIBUTE}]:hover:not(:disabled) {
                background: #005882;
                color: #fff;
                box-shadow: 0 2px 8px rgba(0, 104, 183, .24);
            }
            [${BUTTON_ATTRIBUTE}]:focus-visible {
                outline: 2px solid #005882;
                outline-offset: 2px;
            }
            [${BUTTON_ATTRIBUTE}]:disabled {
                cursor: default;
                opacity: .72;
            }
            [${BUTTON_ATTRIBUTE}] svg {
                width: 18px;
                height: 18px;
            }
            @media (prefers-reduced-motion: reduce) {
                [${BUTTON_ATTRIBUTE}] { transition: none; }
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    let featureEnabled = false;
    let allFeaturesDisabled = false;
    let renderTimer = 0;
    const activeRequests = new Map();
    let pageScrollLockCount = 0;
    let pageScrollRestore = null;

    /**
     * シラバス取得の有効設定と一括停止状態を読み取る。
     * @returns {Promise<void>} 処理の完了を待つPromise。
     */
    async function readFeatureState() {
        const [syncSettings, localSettings] = await Promise.all([
            chrome.storage.sync.get(FEATURE_ENABLED_KEY),
            chrome.storage.local.get(ALL_FEATURES_DISABLED_KEY),
        ]);
        featureEnabled = syncSettings[FEATURE_ENABLED_KEY] !== false;
        allFeaturesDisabled = localSettings[ALL_FEATURES_DISABLED_KEY] === true;
        featureStateLoaded = true;
        renderCourseButtons();
    }

    /**
     * KU-LMSの検索条件から表示対象の年度を読み取る。
     * @returns {string} 検索条件の4桁の年度。読み取れなければ空文字列。
     */
    function getSelectedAcademicYear() {
        const yearText = document.querySelector(LMS_YEAR_FILTER_SELECTOR)?.textContent || '';
        return normalizeText(yearText).match(/(\d{4})\s*年度?/)?.[1] || '';
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
     * 授業カードからシラバス照合に必要な科目・年度・学期・曜日時限・教員を読み取る。
     * @param {HTMLElement} card - 対象授業のカード要素。
     * @returns {object} 授業カードの科目・教員・曜日時限・年度学期の情報。
     */
    function getCourseInfo(card) {
        const infoText = normalizeText(card.querySelector('.courseCardInfo')?.textContent || '');
        const periodMatch = infoText.match(/(\d+)\s*限/);
        const termText = infoText.replace(/\d+\s*限/, '').trim();
        const dayText = normalizeText(
            card.closest('.lms-daybox')?.querySelector('.lms-category-title h3')?.textContent || '',
        );

        return {
            academicYear: getSelectedAcademicYear(),
            courseName: normalizeText(card.querySelector('.lms-cardname')?.textContent || ''),
            instructor: normalizeText([...card.querySelector(COURSE_TEACHER_SELECTOR)?.childNodes || []]
                .filter((node) => node.nodeType === Node.TEXT_NODE)
                .map((node) => node.textContent).join(' ')).replace(/\s*ほか$/, ''),
            dayText,
            period: periodMatch?.[1] || '',
            termText,
            courseInfoText: infoText,
        };
    }

    /**
     * 指定授業に対応する有効なシラバスキャッシュを読み出す。
     * @param {object} course - 授業カードから読み取った科目・年度学期・曜日時限・教員情報。
     * @returns {Promise<object|null>} 有効なキャッシュ。未保存または期限切れならnull。
     */
    async function getCachedSyllabus(course) {
        try {
            return await globalThis.KLPFSyllabusCache.get(course);
        } catch (error) {
            console.debug('[KLPF] シラバスキャッシュを読み込めませんでした。', error);
            return null;
        }
    }

    /**
     * 取得時刻を年月日・時分秒を含む表示文字列へ変換する。
     * @param {*} value - 検証・変換する入力値。
     * @returns {string} 表示または識別に使う文字列。
     */
    function formatSyllabusFetchedDate(value) {
        const date = new Date(Number(value));
        if (!Number.isFinite(date.getTime())) return '';
        /**
         * 数字を時刻表示用の2桁文字列へそろえる。
         * @param {number} number - 日付表示用に桁をそろえる数字。
         * @returns {string} 表示または識別に使う文字列。
         */
        const pad = number => String(number).padStart(2, '0');
        return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`
            + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }

    /**
     * シラバス取得ボタン内に表示するメニューアイコンを作る。
     * @returns {SVGElement} ボタンに追加するメニューアイコン。
     */
    function createMenuIcon() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('aria-hidden', 'true');
        for (const y of [6, 12, 18]) {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', '3');
            line.setAttribute('x2', '21');
            line.setAttribute('y1', String(y));
            line.setAttribute('y2', String(y));
            svg.appendChild(line);
        }
        return svg;
    }

    /**
     * シラバスボタンの取得中状態と操作可否を切り替える。
     * @param {object} button - 操作するボタン、または解析済みのボタン情報。
     * @param {boolean} isLoading - 取得中の状態にするかどうか。
     * @returns {void} 戻り値はない。
     */
    function setButtonLoading(button, isLoading) {
        button.disabled = isLoading;
        button.setAttribute('aria-busy', String(isLoading));
        button.title = isLoading ? 'Ku-Portからシラバスを取得しています' : 'シラバスを表示';
        button.setAttribute('aria-label', button.title);
        button.replaceChildren(createMenuIcon());
    }

    /**
     * カード寸法を変えず、教員名の右側へシラバスボタンを配置する。
     * @param {HTMLElement} card - 対象授業のカード要素。
     * @param {HTMLElement} teacherRow - ボタン位置の基準にする教員名の要素。
     * @param {object} button - 操作するボタン、または解析済みのボタン情報。
     * @returns {void} 戻り値はない。
     */
    function positionSyllabusButton(card, teacherRow, button) {
        const cardRect = card.getBoundingClientRect();
        const rowRect = teacherRow.getBoundingClientRect();
        const cardTop = Number.isFinite(cardRect.top) ? cardRect.top : 0;
        const rowTop = Number.isFinite(rowRect.top) ? rowRect.top : 0;
        const rowHeight = rowRect.height || teacherRow.offsetHeight || 0;
        const relativeTop = rowTop - cardTop + rowHeight / 2;
        const rightGap = Number.isFinite(cardRect.right) && Number.isFinite(rowRect.right)
            ? Math.max(0, cardRect.right - rowRect.right)
            : 0;
        button.style.top = `${relativeTop}px`;
        button.style.right = `${rightGap}px`;
    }

    /**
     * 表示中の全シラバスボタンの位置を更新する。
     * @returns {void} 戻り値はない。
     */
    function positionAllSyllabusButtons() {
        for (const card of document.querySelectorAll(COURSE_CARD_SELECTOR)) {
            const teacherRow = card.querySelector(COURSE_TEACHER_SELECTOR);
            const button = card.querySelector(`[${BUTTON_ATTRIBUTE}]`);
            if (teacherRow && button) positionSyllabusButton(card, teacherRow, button);
        }
    }

    let featureStateLoaded = false;

    /**
     * 利用できなくなったシラバスの進捗・本文画面を閉じ、要求を取消済みにする。
     * @returns {void} UIとスクロールロックを片付ける。
     */
    function stopSyllabusUi() {
        for (const [requestId, request] of activeRequests) {
            request.cancelled = true;
            request.progress?.close();
            setButtonLoading(request.button, false);
            void chrome.runtime.sendMessage({ type: 'cancel-syllabus-lookup', requestId }).catch(() => {});
        }
        activeRequests.clear();
        document.getElementById(MODAL_ROOT_ID)?.shadowRoot?.querySelector('.close')?.click();
    }

    /**
     * 今年度の日〜土曜日の授業カードへシラバスボタンを配置する。
     * @returns {void} 戻り値はない。
     */
    function renderCourseButtons() {
        renderTimer = 0;
        if (!featureStateLoaded) return;
        if (!featureEnabled || allFeaturesDisabled || !globalThis.KLPFKuportAccess.ready) stopSyllabusUi();
        const selectedAcademicYear = getSelectedAcademicYear();
        const shouldShow = featureEnabled
            && globalThis.KLPFKuportAccess.ready
            && !allFeaturesDisabled
            && selectedAcademicYear !== ''
            && selectedAcademicYear === getCurrentAcademicYear();
        for (const card of document.querySelectorAll(COURSE_CARD_SELECTOR)) {
            let button = card.querySelector(`[${BUTTON_ATTRIBUTE}]`);
            const dayText = normalizeText(
                card.closest('.lms-daybox')?.querySelector('.lms-category-title h3')?.textContent || '',
            );
            if (!shouldShow || !/^[日月火水木金土]曜日$/.test(dayText)) {
                card.querySelectorAll(`[${BUTTON_ATTRIBUTE}]`).forEach((element) => element.remove());
                card.classList.remove('klpf-syllabus-card');
                continue;
            }

            const teacherRow = card.querySelector(COURSE_TEACHER_SELECTOR);
            if (!teacherRow) {
                card.querySelectorAll(`[${BUTTON_ATTRIBUTE}]`).forEach((element) => element.remove());
                card.classList.remove('klpf-syllabus-card');
                continue;
            }

            ensureLmsStyles();
            card.classList.add('klpf-syllabus-card');
            if (!button) {
                button = document.createElement('button');
                button.type = 'button';
                button.setAttribute(BUTTON_ATTRIBUTE, '');
                button.title = 'シラバスを表示';
                button.setAttribute('aria-label', 'シラバスを表示');
                button.appendChild(createMenuIcon());
            }
            // 旧版で教員名行に追加されたボタンも、カード直下へ移して高さへの影響をなくす。
            if (button.parentElement !== card) card.appendChild(button);
            positionSyllabusButton(card, teacherRow, button);
        }
    }

    /**
     * カード遷移を防いでシラバスボタンの取得操作を受け付ける。
     * @param {Event} event - 操作または通知のイベント。
     * @returns {void} 戻り値はない。
     */
    function handleSyllabusButtonClick(event) {
        const target = event.target instanceof Element ? event.target : null;
        const button = target?.closest(`[${BUTTON_ATTRIBUTE}]`);
        if (!button) return;

        // KU-LMSはカード全体のクリックで講義へ遷移するため、
        // シラバス操作をキャプチャ段階で捕捉してカード遷移を防ぐ。
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const card = button.closest(COURSE_CARD_SELECTOR);
        if (card) void startSyllabusRequest(button, card);
    }

    /**
     * 授業カードの変更をまとめ、シラバスボタンの再配置を予約する。
     * @returns {void} 戻り値はない。
     */
    function scheduleCardRender() {
        if (renderTimer) return;
        renderTimer = window.requestAnimationFrame(renderCourseButtons);
    }

    /**
     * シラバス取得に関する案内またはエラーを表示する。
     * @param {string|object} message - 表示する案内文、または受信した機能メッセージ。
     * @param {boolean} [isError=true] - エラーとして表示するかどうか。
     * @returns {void} 戻り値はない。
     */
    function showNotice(message, isError = true) {
        let notice = document.getElementById(NOTICE_ID);
        if (!notice) {
            notice = document.createElement('div');
            notice.id = NOTICE_ID;
            notice.setAttribute('role', 'status');
            notice.setAttribute('aria-live', 'polite');
            Object.assign(notice.style, {
                position: 'fixed',
                right: '18px',
                bottom: '18px',
                zIndex: '2147483647',
                maxWidth: 'min(380px, calc(100vw - 36px))',
                padding: '10px 14px',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '13px',
                lineHeight: '1.5',
                boxShadow: '0 6px 20px rgba(0, 0, 0, .2)',
                transition: 'opacity .2s ease, transform .2s ease',
            });
            (document.body || document.documentElement).appendChild(notice);
        }
        notice.textContent = message;
        notice.style.background = isError ? '#b42318' : '#176b4d';
        notice.style.opacity = '1';
        notice.style.transform = 'translateY(0)';
        window.clearTimeout(showNotice.timer);
        showNotice.timer = window.setTimeout(() => {
            notice.style.opacity = '0';
            notice.style.transform = 'translateY(6px)';
        }, 5000);
    }

    /**
     * 取得要求を識別するIDを生成する。
     * @returns {string} 取得要求を識別する一意な文字列。
     */
    function getRequestId() {
        return globalThis.crypto?.randomUUID?.()
            || `syllabus-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    /**
     * キャッシュを確認し、必要な場合は進捗画面を開いてシラバス取得を要求する。
     * @param {object} button - 操作するボタン、または解析済みのボタン情報。
     * @param {HTMLElement} card - 対象授業のカード要素。
     * @param {object} [options={}] - この処理に必要な設定と依存処理。
     * @param {boolean} [options.forceRefresh=false] - 有効なキャッシュがあっても再取得するかどうか。
     * @returns {Promise<void>} 処理の完了を待つPromise。
     */
    async function startSyllabusRequest(button, card, { forceRefresh = false } = {}) {
        if (!globalThis.KLPFKuportAccess.ready || !featureEnabled || allFeaturesDisabled || button.disabled || activeRequests.size > 0) return;
        const course = getCourseInfo(card);
        if (!course.courseName) {
            showNotice('授業名を確認できないため、シラバスを取得できません。');
            return;
        }
        if (!course.academicYear) {
            showNotice('開講年度を確認できないため、シラバスを取得できません。');
            return;
        }
        const currentAcademicYear = getCurrentAcademicYear();
        if (course.academicYear !== currentAcademicYear) {
            showNotice(`シラバス表示は${currentAcademicYear}年度のみ利用できます。`);
            return;
        }

        const requestId = getRequestId();
        const request = { button, card, course, progress: null, cancelled: false, forceRefresh };
        activeRequests.set(requestId, request);
        setButtonLoading(button, true);

        if (!forceRefresh) {
            const cached = await getCachedSyllabus(course);
            if (request.cancelled || !globalThis.KLPFKuportAccess.ready || !featureEnabled || allFeaturesDisabled) {
                setButtonLoading(button, false);
                activeRequests.delete(requestId);
                return;
            }
            if (cached && globalThis.KLPFKuportAccess.ready && featureEnabled && !allFeaturesDisabled && !request.cancelled) {
                activeRequests.delete(requestId);
                setButtonLoading(button, false);
                showSyllabusDialog(course, cached.result, {
                    fetchedAt: cached.fetchedAt,
                    button,
                    card,
                });
                return;
            }
        }

        request.progress = showSyllabusProgress(course, requestId, () => {
            request.cancelled = true;
            activeRequests.delete(requestId);
            setButtonLoading(button, false);
            void chrome.runtime.sendMessage({
                type: 'cancel-syllabus-lookup',
                requestId,
            }).catch((error) => {
                console.debug('[KLPF] シラバス取得の中止を通知できませんでした。', error);
            });
        });
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'request-syllabus-lookup',
                requestId,
                course,
            });
            // 取消済み、または結果通知で終了済みの要求から新しい画面を変更しない。
            if (request.cancelled || activeRequests.get(requestId) !== request) {
                if (request.cancelled && response?.status === 'started') {
                    void chrome.runtime.sendMessage({ type: 'cancel-syllabus-lookup', requestId }).catch(() => {});
                }
                return;
            }
            if (response?.status === 'started') {
                request.progress?.update(response);
                return;
            }
            request.progress?.close();
            activeRequests.delete(requestId);
            setButtonLoading(button, false);
            if (request.cancelled || !globalThis.KLPFKuportAccess.ready || !featureEnabled || allFeaturesDisabled) return;
            showNotice(getStartErrorMessage(response));
        } catch (error) {
            if (request.cancelled || activeRequests.get(requestId) !== request) return;
            request.progress?.close();
            activeRequests.delete(requestId);
            setButtonLoading(button, false);
            showNotice('Ku-Portのシラバス取得を開始できませんでした。');
            console.debug('[KLPF] シラバス取得の開始に失敗しました。', error);
        }
    }

    /**
     * シラバス取得の開始応答から表示するエラー文を選ぶ。
     * @param {object} response - 通信またはメッセージ要求への応答。
     * @returns {string} 取得開始の失敗理由。
     */
    function getStartErrorMessage(response) {
        if (response?.status === 'kuport-open') {
            return 'Ku-Portが既に開いているため、シラバス取得を中止しました。';
        }
        if (response?.status === 'busy') {
            return 'Ku-Portを使う別の取得処理が実行中です。完了後にもう一度お試しください。';
        }
        if (response?.status === 'feature-disabled') {
            return 'シラバス表示がOFFになっています。KU-LMSのメニューからONにしてください。';
        }
        if (response?.status === 'unsupported-academic-year') {
            return `シラバス表示は${response.currentAcademicYear || getCurrentAcademicYear()}年度のみ利用できます。`;
        }
        return response?.message || 'シラバス取得を開始できませんでした。';
    }

    /**
     * 指定したポップアップルートにShadow DOMを用意する。
     * @param {string} rootId - ポップアップルートの要素ID。
     * @returns {ShadowRoot} 指定したポップアップのShadow DOM。
     */
    function getShadowRoot(rootId) {
        let root = document.getElementById(rootId);
        if (!root) {
            root = document.createElement('div');
            root.id = rootId;
            document.documentElement.appendChild(root);
        }
        return root.shadowRoot || root.attachShadow({ mode: 'open' });
    }

    /**
     * シラバス表示用ポップアップのルート要素を用意する。
     * @returns {ShadowRoot} シラバス表示用ポップアップのShadow DOM。
     */
    function getModalRoot() {
        return getShadowRoot(MODAL_ROOT_ID);
    }

    /**
     * スクロール位置とページ寸法を保持して背景のスクロールを止める。
     * @returns {void} 戻り値はない。
     */
    function lockPageScroll() {
        pageScrollLockCount += 1;
        if (pageScrollLockCount !== 1) return;
        const documentElement = document.documentElement;
        const body = document.body;
        const scrollX = window.scrollX || window.pageXOffset || 0;
        const scrollY = window.scrollY || window.pageYOffset || 0;
        pageScrollRestore = {
            documentElement: documentElement?.style.overflow || '',
            documentElementMinHeight: documentElement?.style.minHeight || '',
            body: body?.style.overflow || '',
            bodyPosition: body?.style.position || '',
            bodyTop: body?.style.top || '',
            bodyLeft: body?.style.left || '',
            bodyRight: body?.style.right || '',
            bodyWidth: body?.style.width || '',
            bodyMinHeight: body?.style.minHeight || '',
            scrollX,
            scrollY,
        };
        const documentHeight = Math.max(
            Number(documentElement?.scrollHeight) || 0,
            Number(window.innerHeight) || 0,
        );
        if (documentElement) {
            documentElement.style.overflow = 'hidden';
            documentElement.style.minHeight = '100vh';
        }
        if (body) {
            body.style.overflow = 'hidden';
            body.style.position = 'fixed';
            body.style.top = `-${scrollY}px`;
            body.style.left = `-${scrollX}px`;
            body.style.right = '0';
            body.style.width = '100%';
            // fixed化でbodyが通常フローから外れても、元のページ高さを維持する。
            body.style.minHeight = `${documentHeight}px`;
        }
    }

    /**
     * 保存していたページスタイルとスクロール位置を復元する。
     * @returns {void} 戻り値はない。
     */
    function unlockPageScroll() {
        if (pageScrollLockCount === 0) return;
        pageScrollLockCount -= 1;
        if (pageScrollLockCount > 0) return;
        const documentElement = document.documentElement;
        const body = document.body;
        if (documentElement) {
            documentElement.style.overflow = pageScrollRestore?.documentElement || '';
            documentElement.style.minHeight = pageScrollRestore?.documentElementMinHeight || '';
        }
        if (body) {
            body.style.overflow = pageScrollRestore?.body || '';
            body.style.position = pageScrollRestore?.bodyPosition || '';
            body.style.top = pageScrollRestore?.bodyTop || '';
            body.style.left = pageScrollRestore?.bodyLeft || '';
            body.style.right = pageScrollRestore?.bodyRight || '';
            body.style.width = pageScrollRestore?.bodyWidth || '';
            body.style.minHeight = pageScrollRestore?.bodyMinHeight || '';
        }
        if (pageScrollRestore && typeof window.scrollTo === 'function') {
            try {
                window.scrollTo(pageScrollRestore.scrollX, pageScrollRestore.scrollY);
            } catch {
                // 一部の埋め込み環境ではscrollToが未実装でも表示を継続する。
            }
        }
        pageScrollRestore = null;
    }

    /**
     * 推定残り時間と進捗バー・閉じる操作を持つ取得中ポップアップを表示する。
     * @param {object} course - 授業カードから読み取った科目・年度学期・曜日時限・教員情報。
     * @param {string} requestId - 処理と結果を対応付ける取得要求ID。
     * @param {Function} onCancel - 閉じる操作で取得を取り消すコールバック。
     * @returns {object} 進捗更新と終了操作を行う取得中画面のハンドル。
     */
    function showSyllabusProgress(course, requestId, onCancel) {
        lockPageScroll();
        const shadow = getShadowRoot(PROGRESS_MODAL_ROOT_ID);
        shadow.innerHTML = `
            <style>
                :host { position: fixed; inset: 0; z-index: 2147483647; display: block;
                    width: 100vw; height: 100vh; pointer-events: auto; }
                * { box-sizing: border-box; }
                .overlay { position: fixed; inset: 0; z-index: 2147483647; display: flex;
                    align-items: center; justify-content: center; padding: 20px;
                    background: rgba(15, 23, 42, .52); font-family: "Yu Gothic", Meiryo, sans-serif; }
                .panel { width: min(560px, 100%); overflow: hidden; border: 1px solid #c9d7e5;
                    border-radius: 4px; background: #fff; color: #17212b;
                    box-shadow: 0 18px 60px rgba(0,0,0,.28); }
                .head { display: flex; align-items: center; justify-content: space-between; gap: 14px;
                    padding: 12px 14px; background: #005882; color: #fff; }
                .heading { min-width: 0; }
                h2 { margin: 0; font-size: 16px; line-height: 1.35; }
                .course { margin: 3px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                    color: rgba(255,255,255,.9); font-size: 12px; }
                .close { flex: 0 0 auto; width: 30px; height: 30px; border: 1px solid rgba(255,255,255,.8);
                    border-radius: 3px; background: transparent; color: #fff; font-size: 21px; line-height: 1;
                    cursor: pointer; }
                .close:hover { background: rgba(255,255,255,.16); }
                .body { padding: 18px 18px 20px; }
                .status { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 9px;
                    color: #344054; font-size: 13px; }
                .status-meta { display: inline-flex; flex: 0 0 auto; align-items: baseline; gap: 10px; }
                .eta { color: #005882; font-weight: 700; }
                .track { height: 12px; overflow: hidden; border: 1px solid #a9bfd2; border-radius: 2px;
                    background: #edf3f8; }
                .bar { width: 5%; height: 100%; background: #005882; transition: width .22s ease; }
                @media (max-width: 600px) { .overlay { padding: 8px; } .body { padding: 14px; } }
            </style>
            <div class="overlay" role="presentation">
                <section class="panel" role="dialog" aria-modal="true" aria-labelledby="klpf-syllabus-progress-title">
                    <div class="head">
                        <div class="heading"><h2 id="klpf-syllabus-progress-title">シラバスを取得中</h2><p class="course"></p></div>
                        <button class="close" type="button" aria-label="取得を中止">×</button>
                    </div>
                    <div class="body">
                        <div class="status"><span class="label">取得を開始しています</span><span class="status-meta"><span class="eta">約${ESTIMATED_SYLLABUS_DURATION_SECONDS}秒</span></span></div>
                        <div class="track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="5" aria-label="シラバス取得の進捗">
                            <div class="bar"></div>
                        </div>
                    </div>
                </section>
            </div>
        `;
        const courseLabel = [course.courseName, course.instructor, course.academicYear ? `${course.academicYear}年度` : '']
            .filter(Boolean)
            .join(' ・ ');
        shadow.querySelector('.course').textContent = courseLabel;

        const root = document.getElementById(PROGRESS_MODAL_ROOT_ID);
        const closeButton = shadow.querySelector('.close');
        const bar = shadow.querySelector('.bar');
        const status = shadow.querySelector('.label');
        const eta = shadow.querySelector('.eta');
        const track = shadow.querySelector('.track');
        let closed = false;
        let remainingSecondsFloat = ESTIMATED_SYLLABUS_DURATION_SECONDS;
        let progressValue = 5;
        let lastCountdownAt = Date.now();
        const updateCountdown = () => {
            if (closed) return;
            const now = Date.now();
            const elapsedSeconds = Math.max(0, (now - lastCountdownAt) / 1000);
            lastCountdownAt = now;
            // 進捗率が上がるほど減少速度を上げる。フェーズ切替では値自体を変更しない。
            const speed = 0.9 + progressValue / 70;
            remainingSecondsFloat = Math.max(1, remainingSecondsFloat - elapsedSeconds * speed);
            eta.textContent = `約${Math.max(1, Math.ceil(remainingSecondsFloat))}秒`;
        };
        const countdownTimer = window.setInterval(updateCountdown, 1000);
        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                close();
                onCancel?.();
            }
        };
        const close = () => {
            if (closed) return;
            closed = true;
            window.clearInterval(countdownTimer);
            root?.remove();
            document.removeEventListener('keydown', onKeyDown, true);
            unlockPageScroll();
        };
        const cancel = () => {
            close();
            onCancel?.();
        };
        const update = ({ phase = '', progress = null } = {}) => {
            if (closed) return;
            const info = SYLLABUS_PHASE_INFO[phase] || {};
            const numericProgress = Number(progress ?? info.progress ?? 5);
            const nextProgress = Math.max(5, Math.min(95, Number.isFinite(numericProgress) ? numericProgress : 5));
            progressValue = nextProgress;
            bar.style.width = `${nextProgress}%`;
            status.textContent = info.label || 'シラバスを取得しています';
            track.setAttribute('aria-valuenow', String(nextProgress));
            updateCountdown();
        };
        closeButton.addEventListener('click', cancel, { once: true });
        shadow.querySelector('.overlay').addEventListener('click', (event) => {
            if (event.target === shadow.querySelector('.overlay')) cancel();
        });
        document.addEventListener('keydown', onKeyDown, true);
        closeButton.focus();
        updateCountdown();
        // 要求IDは画面へ表示せず、呼び出し元との対応付けのために保持する。
        // 同じ取得要求に対して進捗更新と終了処理を適用する。
        void requestId;
        return { update, close };
    }

    /**
     * 本文の行から既知の項目見出しと続く内容を読み取る。
     * @param {string} line - 項目見出しか確認する本文の1行。
     * @returns {object|null} 項目名labelと同じ行の本文value。見出しでなければnull。
     */
    function getSyllabusSection(line) {
        const source = String(line || '').trim();
        if (!source) return null;
        const labels = [...SYLLABUS_SECTION_LABELS].sort((left, right) => right.length - left.length);
        for (const label of labels) {
            if (source === label) return { label, value: '' };
            const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const match = source.match(new RegExp(`^${escaped}(?:\\s*[:：]\\s*|\\s+)(.*)$`));
            if (match) return { label, value: match[1].trim() };
        }
        return null;
    }

    /**
     * シラバス本文を既知の見出しごとに分ける。
     * @param {string} text - 表示または照合する文字列。
     * @returns {object[]} 見出しと本文に分けた項目一覧。
     */
    function parseSyllabusSections(text) {
        const source = String(text || '').slice(0, MAX_SYLLABUS_TEXT_LENGTH).replace(/\r\n?/g, '\n').trim();
        if (!source) return [{ label: '取得内容', value: 'シラバスの内容を取得できませんでした。' }];
        const sections = [];
        let current = null;
        const pushCurrent = () => {
            if (!current) return;
            const value = current.lines.join('\n').trim();
            sections.push({ label: current.label, value: value || '（記載なし）' });
        };
        for (const line of source.split('\n')) {
            const section = getSyllabusSection(line);
            if (section) {
                pushCurrent();
                current = { label: section.label, lines: section.value ? [section.value] : [] };
            } else if (current) {
                current.lines.push(line.trim());
            } else {
                current = { label: '概要', lines: [line.trim()] };
            }
        }
        pushCurrent();
        return sections.length > 0 ? sections : [{ label: '取得内容', value: source }];
    }

    /**
     * 表形式の解析結果がない場合に本文から表示用の行を組み立てる。
     * @param {object} course - 授業カードから読み取った科目・年度学期・曜日時限・教員情報。
     * @param {string} text - 表示または照合する文字列。
     * @returns {object[]} 本文と授業情報から補完した表示行。
     */
    function getFallbackSyllabusRows(course, text) {
        const rows = [];
        if (course.courseName) {
            rows.push({
                type: 'row',
                cells: [
                    { header: true, width: 25, text: '科目名' },
                    { header: false, width: 75, text: course.courseName },
                ],
            });
        }
        if (course.instructor) {
            rows.push({
                type: 'row',
                cells: [
                    { header: true, width: 25, text: '担当教員' },
                    { header: false, width: 75, text: course.instructor },
                ],
            });
        }
        if (course.academicYear) {
            rows.push({
                type: 'row',
                cells: [
                    { header: true, width: 25, text: '開講年度' },
                    { header: false, width: 25, text: `${course.academicYear}年度` },
                    { header: true, width: 25, text: '開講学期' },
                    { header: false, width: 25, text: course.termText || '' },
                ],
            });
        }
        for (const section of parseSyllabusSections(text)) {
            rows.push({
                type: 'row',
                cells: [
                    { header: true, width: 25, text: section.label },
                    { header: false, width: 75, text: section.value },
                ],
            });
        }
        return rows;
    }

    /**
     * シラバスの項目名と内容を表の行として描画する。
     * @param {HTMLTableElement} table - シラバス行を追加する表。
     * @param {object[]} rows - シラバスの項目名と内容の行。
     * @returns {void} 戻り値はない。
     */
    function renderSyllabusRows(table, rows) {
        for (const row of rows) {
            if (row?.type === 'spacer') {
                const spacer = document.createElement('div');
                spacer.className = 'syllabus-spacer';
                spacer.style.height = `${Math.max(8, Math.min(Number(row.height) || 26, 80))}px`;
                table.appendChild(spacer);
                continue;
            }
            if (row?.type !== 'row' || !Array.isArray(row.cells) || row.cells.length === 0) continue;
            const rowElement = document.createElement('div');
            rowElement.className = 'rowStyle rowMargin';
            rowElement.style.width = '100%';
            const fallbackWidth = 100 / row.cells.length;
            for (const cell of row.cells) {
                const cellElement = document.createElement('div');
                cellElement.className = cell.header
                    ? 'ui-widget-header colStyle colBorder'
                    : 'ui-widget-content colStyle colBorder';
                const width = Number.isFinite(Number(cell.width)) ? Number(cell.width) : fallbackWidth;
                cellElement.style.width = `${Math.max(1, Math.min(width, 100))}%`;
                cellElement.style.textAlign = cell.header ? 'center' : 'left';
                const value = document.createElement('div');
                value.className = 'fr-box fr-view';
                value.textContent = String(cell.text || '');
                cellElement.appendChild(value);
                rowElement.appendChild(cellElement);
            }
            table.appendChild(rowElement);
        }
    }

    /**
     * シラバス表・取得時刻・注意文・更新操作をポップアップへ表示する。
     * @param {object} course - 授業カードから読み取った科目・年度学期・曜日時限・教員情報。
     * @param {object|null} result - 取得したデータ。失敗などで結果がない場合はnull。
     * @param {object} [options={}] - この処理に必要な設定と依存処理。
     * @param {number} [options.fetchedAt=0] - データを取得した時刻（ミリ秒）。
     * @param {object} [options.button=null] - 操作するボタン、または解析済みのボタン情報。
     * @param {HTMLElement} [options.card=null] - 対象授業のカード要素。
     * @returns {void} 戻り値はない。
     */
    function showSyllabusDialog(course, result, { fetchedAt = 0, button = null, card = null } = {}) {
        if (!globalThis.KLPFKuportAccess.ready || !featureEnabled || allFeaturesDisabled) return;
        lockPageScroll();
        const shadow = getModalRoot();
        const text = String(result?.text || '').slice(0, MAX_SYLLABUS_TEXT_LENGTH);
        const rows = Array.isArray(result?.rows) && result.rows.length > 0
            ? result.rows
            : getFallbackSyllabusRows(course, text);
        const fetchedDate = formatSyllabusFetchedDate(fetchedAt);
        shadow.innerHTML = `
            <style>
                :host { position: fixed; inset: 0; z-index: 2147483647; display: block;
                    width: 100vw; height: 100vh; pointer-events: auto; }
                * { box-sizing: border-box; }
                .overlay { position: fixed; inset: 0; z-index: 2147483647; display: flex;
                    align-items: flex-start; justify-content: center; padding: 51px 18px 18px;
                    background: rgba(0, 0, 0, .42); font-family: Arial, "Yu Gothic", Meiryo, sans-serif; }
                .ui-dialog { display: flex; flex-direction: column; width: min(960px, 100%);
                    height: min(640px, calc(100vh - 69px)); overflow: hidden; border: 1px solid #9aa8b3;
                    border-radius: 4px; background: #f4f4f4; color: #333;
                    box-shadow: 0 8px 28px rgba(0,0,0,.32); }
                .ui-dialog-titlebar { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr) auto auto auto;
                    align-items: center; column-gap: 8px; min-height: 34px; padding: 4px 5px 4px 10px;
                    border-bottom: 1px solid #005882; background: #005882; color: #fff; }
                .ui-dialog-title { min-width: 0; overflow: hidden;
                    text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 700; line-height: 24px; }
                .syllabus-caution { min-width: 0; overflow: hidden; color: rgba(255,255,255,.86);
                    text-align: center; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; font-weight: 400; line-height: 24px; }
                .last-fetched { color: rgba(255,255,255,.86);
                    font-size: 11px; font-weight: 400; line-height: 24px; white-space: nowrap; }
                .ui-dialog-titlebar-icon { display: inline-flex; align-items: center; justify-content: center;
                    width: 24px; height: 24px; margin-left: 0; border: 1px solid rgba(255,255,255,.72); border-radius: 3px;
                    background: transparent; color: #fff; cursor: pointer; text-decoration: none; }
                .ui-dialog-titlebar-icon:hover { border-color: #fff; background: rgba(255,255,255,.16); }
                .ui-dialog-titlebar-icon .ui-icon { display: block; font-size: 17px; line-height: 1; }
                .ui-dialog-content { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 8px 10px 18px;
                    background: #fff; }
                .syllabus-table { width: 100%; }
                .rowStyle { display: flex; align-items: stretch; min-height: 26px; }
                .rowMargin { margin-bottom: 3px; }
                .colStyle { min-width: 0; padding: 3px 6px; border: 1px solid #a8c5d2; overflow-wrap: anywhere;
                    font-size: 12px; line-height: 1.45; }
                .colStyle + .colStyle { margin-left: -1px; }
                .ui-widget-header { background: #005882; color: #fff; font-weight: 700; }
                .ui-widget-content { background: #fff; color: #303c45; }
                .fr-box { min-height: 18px; white-space: pre-wrap; }
                .syllabus-spacer { width: 100%; }
                @media (max-width: 640px) {
                    .overlay { padding: 8px; } .ui-dialog { height: calc(100vh - 16px); }
                    .colStyle { padding: 3px 4px; font-size: 11px; }
                }
            </style>
            <div class="overlay" role="presentation">
                <section class="ui-dialog ui-widget ui-widget-content ui-corner-all ui-shadow ui-hidden-container rx-dialog rx-dialog-large"
                    role="dialog" aria-modal="true" aria-labelledby="klpf-syllabus-title">
                    <div class="ui-dialog-titlebar ui-widget-header ui-helper-clearfix ui-corner-top">
                        <span id="klpf-syllabus-title" class="ui-dialog-title">シラバス照会</span>
                        <span class="syllabus-caution">
                            必ずKu-Portのシラバスも確認してください
                        </span>
                        <span class="last-fetched" aria-label="最後に取得した日"></span>
                        <button class="ui-dialog-titlebar-icon ui-dialog-titlebar-refresh refresh ui-corner-all" type="button" aria-label="シラバスを更新">
                            <span class="ui-icon ui-icon-refresh">↻</span>
                        </button>
                        <button class="ui-dialog-titlebar-icon ui-dialog-titlebar-close ui-corner-all close" type="button" aria-label="閉じる">
                            <span class="ui-icon ui-icon-closethick">×</span>
                        </button>
                    </div>
                    <div class="ui-dialog-content ui-widget-content">
                        <div class="syllabus-table" id="pkx02301:ch:table"></div>
                    </div>
                </section>
            </div>
        `;

        renderSyllabusRows(shadow.querySelector('.syllabus-table'), rows);
        shadow.querySelector('.last-fetched').textContent = fetchedDate
            ? `最終取得: ${fetchedDate}`
            : '最終取得: -';
        const overlay = shadow.querySelector('.overlay');
        const refreshButton = shadow.querySelector('.ui-dialog-titlebar-refresh');
        const closeButton = shadow.querySelector('.ui-dialog-titlebar-close');
        const root = document.getElementById(MODAL_ROOT_ID);
        const onKeyDown = (event) => {
            if (event.key === 'Escape') close();
        };
        let closed = false;
        const close = () => {
            if (closed) return;
            closed = true;
            root?.remove();
            document.removeEventListener('keydown', onKeyDown, true);
            unlockPageScroll();
        };
        closeButton.addEventListener('click', close, { once: true });
        refreshButton.addEventListener('click', () => {
            close();
            if (button?.isConnected && card?.isConnected) {
                void startSyllabusRequest(button, card, { forceRefresh: true });
                return;
            }
            showNotice('授業カードが見つからないため、シラバスを更新できません。');
        }, { once: true });
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) close();
        });
        document.addEventListener('keydown', onKeyDown, true);
        closeButton.focus();
    }

    /**
     * Workerが保存した取得結果と取得日時を受け取り、ポップアップを表示する。
     * @param {string|object} message - 表示する案内文、または受信した機能メッセージ。
     * @returns {void} 戻り値はない。
     */
    function handleSyllabusResult(message) {
        const request = activeRequests.get(message.requestId);
        if (!request) return;
        activeRequests.delete(message.requestId);
        request.progress?.close();
        setButtonLoading(request.button, false);
        if (request.cancelled || !globalThis.KLPFKuportAccess.ready || !featureEnabled || allFeaturesDisabled) return;
        if (message.ok) {
            const fetchedAt = message.fetchedAt || Date.now();
            showSyllabusDialog(request.course, message.result, {
                fetchedAt,
                button: request.button,
                card: request.card,
            });
            return;
        }
        showNotice(message.message || 'シラバスを取得できませんでした。');
    }

    /**
     * 対応する要求の処理段階を取得中ポップアップへ反映する。
     * @param {string|object} message - 表示する案内文、または受信した機能メッセージ。
     * @returns {void} 戻り値はない。
     */
    function handleSyllabusPhase(message) {
        const request = activeRequests.get(message.requestId);
        if (!request || request.cancelled) return;
        request.progress?.update(message);
    }

    /**
     * 設定を読み取り、シラバスボタン・取得結果・DOM変更の監視を初期化する。
     * @returns {void} 戻り値はない。
     */
    function initializeLmsButtons() {
        globalThis.KLPFKuportAccess.subscribe(access => {
            if (!access.ready) {
                stopSyllabusUi();
            }
            renderCourseButtons();
        });
        window.addEventListener('click', handleSyllabusButtonClick, true);
        window.addEventListener('pagehide', stopSyllabusUi);
        void readFeatureState().catch((error) => {
            console.warn('[KLPF] シラバス表示の設定を読み込めませんでした。', error);
        });
        const observer = new MutationObserver(scheduleCardRender);
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            characterData: true,
        });
        window.addEventListener('resize', positionAllSyllabusButtons, { passive: true });
        chrome.storage.onChanged.addListener((changes, area) => {
            let shouldRender = false;
            if (area === 'sync' && changes[FEATURE_ENABLED_KEY]) {
                featureEnabled = changes[FEATURE_ENABLED_KEY].newValue !== false;
                shouldRender = true;
            }
            if (area === 'local' && changes[ALL_FEATURES_DISABLED_KEY]) {
                allFeaturesDisabled = changes[ALL_FEATURES_DISABLED_KEY].newValue === true;
                shouldRender = true;
            }
            if (shouldRender) renderCourseButtons();
        });
        chrome.runtime.onMessage.addListener((message) => {
            if (message?.type === 'syllabus-lookup-phase') handleSyllabusPhase(message);
            if (message?.type === 'syllabus-lookup-result') handleSyllabusResult(message);
        });
    }

    if (window.location.hostname === 'study.ns.kogakuin.ac.jp'
        && LMS_HOME_PATHS.some((path) => window.location.pathname.startsWith(path))) {
        initializeLmsButtons();
    }
})();
