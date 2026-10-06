// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file ホーム左カラムの編集、課題の非表示・復元、課題カレンダーを管理する。
 *
 * homework.jsが生成した課題DOMを再利用し、保存済みレイアウトの適用と
 * FullCalendarを使った一覧・編集UIをこのファイル内で完結させる。
 */

(function() {
    'use strict';

    const COLUMN_SELECTOR = 'div.lms-menu-column.lms-home';
    const LAYOUT_STORAGE_KEY = 'klpf-home-dashboard-layout';
    const HIDDEN_HOMEWORK_STORAGE_KEY = 'klpf-hidden-homework-items';
    const DELETED_HOMEWORK_STORAGE_KEY = 'klpf-deleted-homework-keys';
    const OPEN_HOME_EDITOR_EVENT = 'klpf-open-home-editor';
    const INITIALIZED_ATTRIBUTE = 'klpfDashboardInitialized';
    const DEFAULT_ORDER = ['profile', 'study', 'activity', 'calendar', 'homework'];
    const MODULES = {
        profile: { label: 'プロフィール', description: '利用者名とプロフィール画像' },
        study: { label: '学習実績', description: '学習実績とプロフィール詳細' },
        activity: { label: '利用状況', description: '履修・課題一覧と前回ログイン' },
        calendar: { label: '課題カレンダー', description: '提出日を科目名で表示' },
        homework: { label: '課題リスト', description: '提出期限がある課題の一覧' },
    };
    const MODULE_SELECTORS = {
        profile: ['.homeProfHeader', '.homeProfContents'],
        study: ['.lms-study'],
        activity: ['.last_login_date'],
        calendar: ['#klpf-home-calendar'],
        homework: ['#homework'],
    };

    let column = null;
    let editorLastFocusedElement = null;
    let overlay = null;
    let moduleList = null;
    let restoredList = null;
    let calendarElement = null;
    let editorCalendarElement = null;
    let editorDayDetailsElement = null;
    let compactCalendar = null;
    let editorCalendar = null;
    let observer = null;
    let applyScheduled = false;
    let layoutState = { order: [...DEFAULT_ORDER], hidden: [] };
    let hiddenHomeworkItems = [];
    let deletedHomeworkKeys = [];
    let selectedEditorDate = null;

    /**
     * 保存されたホームの表示順と非表示項目を有効な構成へそろえる。
     * @param {*} value - 検証・変換する入力値。
     * @returns {object} 既定モジュールに対応する表示順と非表示状態。
     */
    function normalizeLayout(value) {
        const order = Array.isArray(value?.order)
            ? value.order.filter(key => Object.hasOwn(MODULES, key))
            : [];
        for (const key of DEFAULT_ORDER) {
            if (!order.includes(key)) order.push(key);
        }

        const hidden = Array.isArray(value?.hidden)
            ? value.hidden.filter(key => Object.hasOwn(MODULES, key))
            : [];
        return { order, hidden: [...new Set(hidden)] };
    }

    /**
     * 保存された非表示課題の情報を扱いやすい形式へそろえる。
     * @param {*} value - 検証・変換する入力値。
     * @returns {object[]} 重複を除いた非表示課題の情報一覧。
     */
    function normalizeHiddenHomework(value) {
        if (!Array.isArray(value)) return [];
        const seen = new Set();
        return value.filter(item => {
            if (!item || typeof item !== 'object' || typeof item.key !== 'string' || seen.has(item.key)) {
                return false;
            }
            seen.add(item.key);
            return true;
        }).map(item => ({
            key: item.key,
            lessonName: typeof item.lessonName === 'string' ? item.lessonName : '',
            homeworkName: typeof item.homeworkName === 'string' ? item.homeworkName : '',
            deadline: typeof item.deadline === 'string' ? item.deadline : '',
        }));
    }

    /**
     * 保存された設定と表示状態を読み取り、機能内の状態へ反映する。
     * @returns {Promise<void>} 処理の完了を待つPromise。
     */
    async function loadState() {
        const result = await chrome.storage.local.get([
            LAYOUT_STORAGE_KEY,
            HIDDEN_HOMEWORK_STORAGE_KEY,
            DELETED_HOMEWORK_STORAGE_KEY,
        ]);
        layoutState = normalizeLayout(result[LAYOUT_STORAGE_KEY]);
        hiddenHomeworkItems = normalizeHiddenHomework(result[HIDDEN_HOMEWORK_STORAGE_KEY]);
        deletedHomeworkKeys = Array.isArray(result[DELETED_HOMEWORK_STORAGE_KEY])
            ? [...new Set(result[DELETED_HOMEWORK_STORAGE_KEY].filter(key => typeof key === 'string'))]
            : [];
    }

    /**
     * ホームの表示順と非表示項目を保存する。
     * @returns {Promise<void>} 処理の完了を待つPromise。
     */
    async function saveLayout() {
        await chrome.storage.local.set({ [LAYOUT_STORAGE_KEY]: layoutState });
    }

    /**
     * 非表示にした課題の情報を保存する。
     * @returns {Promise<void>} 処理の完了を待つPromise。
     */
    async function saveHiddenHomework() {
        await chrome.storage.local.set({ [HIDDEN_HOMEWORK_STORAGE_KEY]: hiddenHomeworkItems });
    }

    /**
     * 削除扱いにした課題の識別キーを保存する。
     * @returns {Promise<void>} 処理の完了を待つPromise。
     */
    async function saveDeletedHomework() {
        await chrome.storage.local.set({ [DELETED_HOMEWORK_STORAGE_KEY]: deletedHomeworkKeys });
    }

    /**
     * 表示文・クラス・読み上げラベルを設定したボタンを作る。
     * @param {string} text - 表示または照合する文字列。
     * @param {string} className - 作成または更新する要素のCSSクラス。
     * @param {string} label - 値の検索または読み上げに使うラベル。
     * @returns {HTMLButtonElement} 作成した操作ボタン。
     */
    function createButton(text, className, label) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = text;
        button.setAttribute('aria-label', label);
        button.title = label;
        return button;
    }

    /**
     * ホームの表示モジュールに属する要素を取得する。
     * @param {string} key - 対象の課題・モジュール・操作を識別するキー。
     * @returns {Element[]} 指定した表示モジュールの要素。
     */
    function getModuleElements(key) {
        if (!column) return [];
        return MODULE_SELECTORS[key].flatMap(selector => Array.from(column.querySelectorAll(selector)));
    }

    /**
     * 保存状態に従ってホームの表示順と各モジュールの表示可否を反映する。
     * @returns {void} 戻り値はない。
     */
    function applyLayout() {
        if (!column) return;
        column.classList.add('klpf-dashboard-column');

        layoutState.order.forEach((key, index) => {
            const isHidden = layoutState.hidden.includes(key);
            for (const element of getModuleElements(key)) {
                element.style.order = String((index + 1) * 10);
                element.classList.toggle('klpf-dashboard-hidden', isHidden);
                element.dataset.klpfDashboardModule = key;
            }
        });
    }

    /**
     * 課題を非表示・復元するための識別キーを作る。
     * @param {HTMLElement} item - 対象課題の表示要素。
     * @returns {string} 課題の識別キー。
     */
    function getHomeworkKey(item) {
        const id = item.dataset.kyozaiId || '';
        const type = item.dataset.kyozaiSyCd || '';
        if (id || type) return `${id}:${type}`;
        return `text:${(item.textContent || '').replace(/\s+/g, ' ').trim()}`;
    }

    /**
     * 課題要素から科目名・件名・期限などの表示情報を読み取る。
     * @param {HTMLElement} item - 対象課題の表示要素。
     * @returns {object} 課題の識別子・科目名・件名・期限の情報。
     */
    function readHomeworkMetadata(item) {
        const content = Array.from(item.children).filter(child => !child.classList.contains('klpf-homework-remove'));
        return {
            key: getHomeworkKey(item),
            deadline: (content[0]?.textContent || '').replace(/^📅\s*/, '').trim(),
            lessonName: (content[1]?.textContent || '').trim(),
            homeworkName: (content[2]?.textContent || '').replace(/^📝\s*/, '').trim(),
        };
    }

    /**
     * 課題キーが非表示または削除対象として保存されているか判定する。
     * @param {string} key - 対象の課題・モジュール・操作を識別するキー。
     * @returns {boolean} 条件を満たす場合はtrue。
     */
    function isHomeworkHidden(key) {
        return deletedHomeworkKeys.includes(key) || hiddenHomeworkItems.some(item => item.key === key);
    }

    /**
     * 課題を非表示として記録し、一覧とカレンダーを更新する。
     * @param {HTMLElement} item - 対象課題の表示要素。
     * @returns {Promise<void>} 処理の完了を待つPromise。
     */
    async function hideHomework(item) {
        const metadata = readHomeworkMetadata(item);
        if (!isHomeworkHidden(metadata.key)) {
            hiddenHomeworkItems.push(metadata);
            await saveHiddenHomework();
        }
        applyHomeworkVisibility();
        refreshCalendars();
        renderRestoredHomeworkList();
    }

    /**
     * 非表示にした課題を復元し、一覧とカレンダーを更新する。
     * @param {string} key - 対象の課題・モジュール・操作を識別するキー。
     * @returns {Promise<void>} 処理の完了を待つPromise。
     */
    async function restoreHomework(key) {
        hiddenHomeworkItems = hiddenHomeworkItems.filter(item => item.key !== key);
        await saveHiddenHomework();
        applyHomeworkVisibility();
        refreshCalendars();
        renderRestoredHomeworkList();
    }

    /**
     * 課題を削除対象として記録し、非表示課題の復元一覧から除く。
     * @param {string} key - 対象の課題・モジュール・操作を識別するキー。
     * @returns {Promise<void>} 処理の完了を待つPromise。
     */
    async function permanentlyDeleteHomework(key) {
        hiddenHomeworkItems = hiddenHomeworkItems.filter(item => item.key !== key);
        if (!deletedHomeworkKeys.includes(key)) deletedHomeworkKeys.push(key);
        await Promise.all([saveHiddenHomework(), saveDeletedHomework()]);
        applyHomeworkVisibility();
        refreshCalendars();
        renderRestoredHomeworkList();
    }

    /**
     * 課題要素に非表示操作と識別情報を追加する。
     * @param {HTMLElement} item - 対象課題の表示要素。
     * @returns {void} 戻り値はない。
     */
    function decorateHomeworkItem(item) {
        if (item.querySelector(':scope > .klpf-homework-remove')) return;
        const removeButton = createButton('×', 'klpf-homework-remove', 'この課題を非表示');
        removeButton.addEventListener('pointerdown', event => {
            event.preventDefault();
            event.stopPropagation();
        });
        removeButton.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            void hideHomework(item);
        });
        item.appendChild(removeButton);
    }

    /**
     * 課題の保存状態を一覧の表示可否へ反映する。
     * @returns {void} 戻り値はない。
     */
    function applyHomeworkVisibility() {
        const homeworkContainer = column?.querySelector('#homework');
        if (!homeworkContainer) return;

        for (const item of homeworkContainer.querySelectorAll('.homeworkItem')) {
            decorateHomeworkItem(item);
            item.classList.toggle('klpf-homework-user-hidden', isHomeworkHidden(getHomeworkKey(item)));
        }
    }

    /**
     * 課題の期限文字列をカレンダー用の日付へ解析する。
     * @param {*} value - 検証・変換する入力値。
     * @returns {object|null} 提出日dateと表示用時刻time。無効な期限ならnull。
     */
    function parseDeadline(value) {
        const match = value.match(/(\d{4})\s*[\/年.-]\s*(\d{1,2})\s*[\/月.-]\s*(\d{1,2})(?:\s*日)?(?:[^\d]+(\d{1,2}):(\d{2}))?/);
        if (!match) return null;

        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const hasTime = match[4] !== undefined;
        const rawHour = hasTime ? Number(match[4]) : 0;
        const minute = hasTime ? Number(match[5]) : 0;
        const date = new Date(year, month - 1, day);
        const isValidDate = date.getFullYear() === year
            && date.getMonth() === month - 1
            && date.getDate() === day;
        const isValidTime = !hasTime
            || (rawHour >= 0 && rawHour <= 23 && minute >= 0 && minute <= 59)
            || (rawHour === 24 && minute === 0);
        if (!isValidDate || !isValidTime) return null;

        /**
         * 数字を時刻表示用の2桁文字列へそろえる。
         * @param {number} number - 日付表示用に桁をそろえる数字。
         * @returns {string} 表示または識別に使う文字列。
         */
        const pad = number => String(number).padStart(2, '0');
        return {
            date: `${year}-${pad(month)}-${pad(day)}`,
            time: hasTime ? `${pad(rawHour)}:${pad(minute)}` : '',
        };
    }

    /**
     * 課題一覧から期限と科目名をカレンダーの予定へ変換する。
     * @returns {object[]} FullCalendarへ渡す課題予定。
     */
    function collectCalendarEvents() {
        const homeworkContainer = column?.querySelector('#homework');
        if (!homeworkContainer) return [];

        return Array.from(homeworkContainer.querySelectorAll('.homeworkItem'))
            .filter(item => !isHomeworkHidden(getHomeworkKey(item)))
            .map(item => {
                const metadata = readHomeworkMetadata(item);
                const deadline = parseDeadline(metadata.deadline);
                if (!deadline) return null;
                return {
                    id: metadata.key,
                    title: metadata.lessonName || metadata.homeworkName || '課題',
                    // カレンダーではLMSに記載された提出日をそのまま使う。
                    // 24:00をDateへ渡すと翌日00:00へ正規化されるため、時刻は表示情報として保持する。
                    start: deadline.date,
                    allDay: true,
                    backgroundColor: '#c44d4d',
                    borderColor: '#a83c3c',
                    extendedProps: {
                        homeworkName: metadata.homeworkName,
                        deadlineTime: deadline.time,
                    },
                };
            })
            .filter(Boolean);
    }

    /**
     * カレンダーの日付キーを表示用の文字列へ変換する。
     * @param {string} dateKey - カレンダーの日付キー。
     * @returns {string} 表示または識別に使う文字列。
     */
    function formatCalendarDate(dateKey) {
        const [, month, day] = dateKey.split('-').map(Number);
        return `${month}月${day}日`;
    }

    /**
     * 日付をカレンダーで扱う日付キーへ変換する。
     * @param {Date} date - 変換対象の日付。
     * @returns {string} YYYY-MM-DD形式の日付キー。
     */
    function dateToCalendarKey(date) {
        /**
         * 数字を時刻表示用の2桁文字列へそろえる。
         * @param {number} number - 日付表示用に桁をそろえる数字。
         * @returns {string} 表示または識別に使う文字列。
         */
        const pad = number => String(number).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    /**
     * 小型カレンダーの予定印を描画し、4件以上は残り件数で表示する。
     * @returns {void} 戻り値はない。
     */
    function renderCompactMarkers() {
        if (!calendarElement) return;
        calendarElement.querySelectorAll('.klpf-compact-event-summary').forEach(element => element.remove());

        const eventsByDate = new Map();
        for (const event of collectCalendarEvents()) {
            if (!eventsByDate.has(event.start)) eventsByDate.set(event.start, []);
            eventsByDate.get(event.start).push(event);
        }

        for (const [dateKey, events] of eventsByDate) {
            const dayFrame = calendarElement.querySelector(`.fc-daygrid-day[data-date="${dateKey}"] .fc-daygrid-day-frame`);
            if (!dayFrame) continue;

            const summary = document.createElement('div');
            summary.className = 'klpf-compact-event-summary';
            const names = events.map(event => event.title).join('、');
            summary.setAttribute('aria-label', `${formatCalendarDate(dateKey)}の課題${events.length}件：${names}`);
            summary.title = `${events.length}件：${names}`;

            const visibleDots = events.length >= 4 ? 1 : events.length;
            for (let index = 0; index < visibleDots; index += 1) {
                const dot = document.createElement('span');
                dot.className = 'klpf-compact-event-dot';
                dot.setAttribute('aria-hidden', 'true');
                summary.appendChild(dot);
            }

            if (events.length > 3) {
                const remainder = document.createElement('span');
                remainder.className = 'klpf-compact-event-remainder';
                remainder.textContent = `+${events.length - visibleDots}`;
                remainder.setAttribute('aria-hidden', 'true');
                summary.appendChild(remainder);
            }
            dayFrame.appendChild(summary);
        }
    }

    /**
     * カレンダーの描画に合わせて予定印の更新を予約する。
     * @returns {void} 戻り値はない。
     */
    function scheduleCompactMarkers() {
        window.requestAnimationFrame(renderCompactMarkers);
    }

    /**
     * 編集画面で選択した日付の課題一覧を表示する。
     * @param {string} dateKey - カレンダーの日付キー。
     * @returns {void} 戻り値はない。
     */
    function renderEditorDayDetails(dateKey) {
        if (!editorDayDetailsElement) return;
        selectedEditorDate = dateKey;
        const events = collectCalendarEvents().filter(event => event.start === dateKey);
        editorDayDetailsElement.replaceChildren();

        const heading = document.createElement('h4');
        heading.textContent = `${formatCalendarDate(dateKey)}の課題（${events.length}件）`;
        editorDayDetailsElement.appendChild(heading);

        if (events.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'klpf-calendar-day-empty';
            empty.textContent = 'この日に提出する課題はありません。';
            editorDayDetailsElement.appendChild(empty);
        } else {
            const list = document.createElement('div');
            list.className = 'klpf-calendar-day-list';
            for (const event of events) {
                const row = document.createElement('div');
                row.className = 'klpf-calendar-day-row';
                const lesson = document.createElement('strong');
                lesson.textContent = event.title;
                const detail = document.createElement('span');
                const time = event.extendedProps.deadlineTime;
                detail.textContent = [time && `${time}まで`, event.extendedProps.homeworkName]
                    .filter(Boolean)
                    .join(' · ');
                row.append(lesson, detail);
                list.appendChild(row);
            }
            editorDayDetailsElement.appendChild(list);
        }
        editorDayDetailsElement.hidden = false;
    }

    /**
     * 小型表示または編集表示に合わせたFullCalendar設定を作る。
     * @param {boolean} compact - ホーム用の小型カレンダーとして表示するかどうか。
     * @returns {object} 表示方式に応じたFullCalendarの設定。
     */
    function calendarOptions(compact) {
        return {
            initialView: 'dayGridMonth',
            locale: 'ja',
            firstDay: 0,
            height: compact ? 'auto' : '100%',
            expandRows: !compact,
            dayMaxEvents: compact ? false : 3,
            eventDisplay: compact ? 'none' : 'block',
            fixedWeekCount: !compact,
            headerToolbar: compact
                ? { left: 'prev', center: 'title', right: 'next' }
                : { left: 'prev,next today', center: 'title', right: 'dayGridMonth,listMonth' },
            buttonText: { today: '今日', month: '月', list: '一覧' },
            allDayText: '期限',
            listDayFormat: { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' },
            listDaySideFormat: false,
            /**
             * カレンダーの省略された予定数を表す表示内容を作る。
             * @param {object} info - FullCalendarが渡す日付・予定・描画要素などの情報。
             * @returns {string} 省略された予定数の表示文。
             */
            moreLinkContent(info) {
                return `+${info.num}件`;
            },
            /**
             * カレンダーの省略リンクを押した日付の詳細を開く。
             * @param {object} info - FullCalendarが渡す日付・予定・描画要素などの情報。
             * @returns {string} FullCalendarで開くポップオーバーの指定。
             */
            moreLinkClick(info) {
                const dateKey = info.date ? dateToCalendarKey(info.date) : null;
                if (!compact && dateKey) renderEditorDayDetails(dateKey);
                return 'popover';
            },
            /**
             * カレンダーの日付セルに表示する内容を作る。
             * @param {object} info - FullCalendarが渡す日付・予定・描画要素などの情報。
             * @returns {string} 日付セルの日番号。
             */
            dayCellContent(info) {
                return String(info.date.getDate());
            },
            events: collectCalendarEvents(),
            /**
             * カレンダーの表示範囲変更に合わせて予定印を更新する。
             * @returns {void} 戻り値はない。
             */
            datesSet() {
                if (compact) scheduleCompactMarkers();
            },
            /**
             * カレンダーで選択した日付の詳細を表示する。
             * @param {object} info - FullCalendarが渡す日付・予定・描画要素などの情報。
             * @returns {void} 戻り値はない。
             */
            dateClick(info) {
                if (!compact) renderEditorDayDetails(info.dateStr.slice(0, 10));
            },
            /**
             * カレンダーで選択した課題の詳細を表示する。
             * @param {object} info - FullCalendarが渡す日付・予定・描画要素などの情報。
             * @returns {void} 戻り値はない。
             */
            eventClick(info) {
                info.jsEvent.preventDefault();
                if (!compact) renderEditorDayDetails(info.event.startStr.slice(0, 10));
            },
            /**
             * 予定の描画後に表示情報と操作を補う。
             * @param {object} info - FullCalendarが渡す日付・予定・描画要素などの情報。
             * @returns {void} 戻り値はない。
             */
            eventDidMount(info) {
                const homeworkName = info.event.extendedProps.homeworkName || '';
                const deadlineTime = info.event.extendedProps.deadlineTime || '';
                const detail = [deadlineTime && `${deadlineTime}まで`, homeworkName].filter(Boolean).join(' · ');
                info.el.title = detail ? `${info.event.title}：${detail}` : info.event.title;

                if (info.view.type === 'listMonth') {
                    const timeCell = info.el.querySelector('.fc-list-event-time');
                    if (timeCell) {
                        timeCell.textContent = deadlineTime || '期限日';
                        timeCell.removeAttribute('aria-labelledby');
                    }
                }
            },
        };
    }

    /**
     * ホーム用の小型課題カレンダーを描画する。
     * @returns {void} 戻り値はない。
     */
    function renderCompactCalendar() {
        if (!calendarElement || typeof FullCalendar === 'undefined') return;
        compactCalendar?.destroy();
        compactCalendar = new FullCalendar.Calendar(calendarElement, calendarOptions(true));
        compactCalendar.render();
        scheduleCompactMarkers();
    }

    /**
     * 編集画面用の課題カレンダーを描画する。
     * @returns {void} 戻り値はない。
     */
    function renderEditorCalendar() {
        if (!editorCalendarElement || overlay?.hidden || typeof FullCalendar === 'undefined') return;
        editorCalendar?.destroy();
        editorCalendar = new FullCalendar.Calendar(editorCalendarElement, calendarOptions(false));
        editorCalendar.render();
        if (selectedEditorDate) renderEditorDayDetails(selectedEditorDate);
    }

    /**
     * 課題と表示状態に合わせて各カレンダーを更新する。
     * @returns {void} 戻り値はない。
     */
    function refreshCalendars() {
        const events = collectCalendarEvents();
        if (compactCalendar) {
            compactCalendar.removeAllEvents();
            compactCalendar.addEventSource(events);
            scheduleCompactMarkers();
        }
        if (editorCalendar) {
            editorCalendar.removeAllEvents();
            editorCalendar.addEventSource(events);
        }
        if (selectedEditorDate) renderEditorDayDetails(selectedEditorDate);
    }

    /**
     * カレンダーの拡大表示を開く操作要素を作る。
     * @returns {HTMLElement} カレンダーの操作領域。
     */
    function createCalendarActions() {
        const actions = document.createElement('div');
        actions.className = 'klpf-home-calendar-actions';
        const expandButton = createButton('拡大表示 ↗', 'klpf-calendar-expand', 'カレンダーを拡大');
        expandButton.addEventListener('click', openEditor);
        actions.appendChild(expandButton);
        return actions;
    }

    /**
     * ホームへ追加するカレンダーモジュールを作る。
     * @returns {void} 戻り値はない。
     */
    function createCalendarModule() {
        const existingModule = column.querySelector('#klpf-home-calendar');
        if (existingModule) {
            calendarElement = existingModule.querySelector('#klpf-home-calendar-body');
            existingModule.querySelector('.klpf-calendar-upcoming')?.remove();
            existingModule.querySelector('.klpf-home-calendar-header')?.remove();
            existingModule.querySelector('.klpf-home-calendar-actions')?.remove();
            existingModule.appendChild(createCalendarActions());
            return;
        }

        const module = document.createElement('section');
        module.id = 'klpf-home-calendar';
        module.className = 'klpf-home-calendar-module';

        calendarElement = document.createElement('div');
        calendarElement.id = 'klpf-home-calendar-body';
        module.append(calendarElement, createCalendarActions());
        column.appendChild(module);
        renderCompactCalendar();
    }

    /**
     * 指定モジュールを表示順の前後へ移動し、保存する。
     * @param {string} key - 対象の課題・モジュール・操作を識別するキー。
     * @param {string|number} direction - 移動またはアニメーションの方向。
     * @returns {void} 戻り値はない。
     */
    function moveModule(key, direction) {
        const currentIndex = layoutState.order.indexOf(key);
        const nextIndex = currentIndex + direction;
        if (currentIndex < 0 || nextIndex < 0 || nextIndex >= layoutState.order.length) return;
        [layoutState.order[currentIndex], layoutState.order[nextIndex]] = [
            layoutState.order[nextIndex],
            layoutState.order[currentIndex],
        ];
        void saveLayout();
        applyLayout();
        renderModuleList();
    }

    /**
     * 指定モジュールの表示可否を切り替え、保存する。
     * @param {string} key - 対象の課題・モジュール・操作を識別するキー。
     * @returns {void} 戻り値はない。
     */
    function toggleModule(key) {
        const hidden = new Set(layoutState.hidden);
        if (hidden.has(key)) hidden.delete(key);
        else hidden.add(key);
        layoutState.hidden = [...hidden];
        void saveLayout();
        applyLayout();
        renderModuleList();
    }

    /**
     * 編集画面へモジュールの表示順と操作ボタンを描画する。
     * @returns {void} 戻り値はない。
     */
    function renderModuleList() {
        if (!moduleList) return;
        moduleList.replaceChildren();

        layoutState.order.forEach((key, index) => {
            const definition = MODULES[key];
            const isHidden = layoutState.hidden.includes(key);
            const row = document.createElement('div');
            row.className = `klpf-editor-module-row${isHidden ? ' is-hidden' : ''}`;

            const text = document.createElement('div');
            text.className = 'klpf-editor-module-copy';
            const label = document.createElement('strong');
            label.textContent = definition.label;
            const description = document.createElement('span');
            description.textContent = definition.description;
            text.append(label, description);

            const actions = document.createElement('div');
            actions.className = 'klpf-editor-module-actions';
            const up = createButton('↑', 'klpf-editor-icon-button', `${definition.label}を上へ`);
            const down = createButton('↓', 'klpf-editor-icon-button', `${definition.label}を下へ`);
            const toggle = createButton(isHidden ? '+' : '×', 'klpf-editor-icon-button klpf-editor-toggle', isHidden ? `${definition.label}を追加` : `${definition.label}を非表示`);
            up.disabled = index === 0;
            down.disabled = index === layoutState.order.length - 1;
            up.addEventListener('click', () => moveModule(key, -1));
            down.addEventListener('click', () => moveModule(key, 1));
            toggle.addEventListener('click', () => toggleModule(key));
            actions.append(up, down, toggle);
            row.append(text, actions);
            moduleList.appendChild(row);
        });
    }

    /**
     * 編集画面へ非表示課題の復元一覧を描画する。
     * @returns {void} 戻り値はない。
     */
    function renderRestoredHomeworkList() {
        if (!restoredList) return;
        restoredList.replaceChildren();

        if (hiddenHomeworkItems.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'klpf-editor-empty';
            empty.textContent = '非表示にした課題はありません。';
            restoredList.appendChild(empty);
            return;
        }

        for (const item of hiddenHomeworkItems) {
            const row = document.createElement('div');
            row.className = 'klpf-restored-homework-row';
            const copy = document.createElement('div');
            const lesson = document.createElement('strong');
            lesson.textContent = item.lessonName || '課題';
            const detail = document.createElement('span');
            detail.textContent = [item.deadline, item.homeworkName].filter(Boolean).join(' · ');
            copy.append(lesson, detail);
            const restore = createButton('+', 'klpf-editor-icon-button klpf-restore-button', `${item.lessonName || '課題'}を元に戻す`);
            restore.addEventListener('click', () => void restoreHomework(item.key));
            const remove = createButton('', 'klpf-editor-icon-button klpf-permanent-delete', `${item.lessonName || '課題'}を完全に削除`);
            const trashIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            trashIcon.setAttribute('viewBox', '0 0 24 24');
            trashIcon.setAttribute('aria-hidden', 'true');
            const trashPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            trashPath.setAttribute('d', 'M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5');
            trashIcon.appendChild(trashPath);
            remove.appendChild(trashIcon);
            remove.addEventListener('click', () => void permanentlyDeleteHomework(item.key));
            const actions = document.createElement('div');
            actions.className = 'klpf-restored-homework-actions';
            actions.append(restore, remove);
            row.append(copy, actions);
            restoredList.appendChild(row);
        }
    }

    /**
     * ホーム編集画面を閉じ、フォーカスとスクロール状態を復元する。
     * @returns {void} 戻り値はない。
     */
    function closeEditor() {
        if (!overlay) return;
        overlay.hidden = true;
        document.documentElement.classList.remove('klpf-dashboard-editing');
        if (editorLastFocusedElement instanceof HTMLElement && editorLastFocusedElement.isConnected) {
            editorLastFocusedElement.focus();
        }
        editorLastFocusedElement = null;
    }

    /**
     * ホーム編集画面を開き、現在のレイアウトと課題を表示する。
     * @returns {void} 戻り値はない。
     */
    function openEditor() {
        if (!overlay) createEditor();
        editorLastFocusedElement = document.activeElement;
        overlay.hidden = false;
        document.documentElement.classList.add('klpf-dashboard-editing');
        renderModuleList();
        renderRestoredHomeworkList();
        window.requestAnimationFrame(renderEditorCalendar);
        overlay.querySelector('.klpf-dashboard-editor-close')?.focus();
    }

    /**
     * ホーム編集画面の見出しと閉じるボタンを作る。
     * @returns {HTMLElement} ホーム編集画面の見出し領域。
     */
    function createEditorHeader() {
        const header = document.createElement('header');
        header.className = 'klpf-dashboard-editor-header';
        const headingGroup = document.createElement('div');
        const eyebrow = document.createElement('span');
        eyebrow.textContent = 'HOME LAYOUT';
        const title = document.createElement('h2');
        title.id = 'klpf-dashboard-editor-title';
        title.textContent = 'ホームを編集';
        headingGroup.append(eyebrow, title);
        const close = createButton('×', 'klpf-dashboard-editor-close', '編集を終了');
        close.addEventListener('click', closeEditor);
        header.append(headingGroup, close);
        return header;
    }

    /**
     * ホーム編集画面の表示順・表示可否の操作領域を作る。
     * @returns {HTMLElement} ホーム編集画面の操作領域。
     */
    function createEditorControls() {
        const controls = document.createElement('div');
        controls.className = 'klpf-dashboard-editor-controls';

        const moduleSection = document.createElement('section');
        const moduleTitle = document.createElement('h3');
        moduleTitle.textContent = '表示モジュール';
        moduleList = document.createElement('div');
        moduleList.className = 'klpf-editor-module-list';
        moduleSection.append(moduleTitle, moduleList);

        const restoreSection = document.createElement('section');
        const restoreTitle = document.createElement('h3');
        restoreTitle.textContent = '非表示にした課題';
        restoredList = document.createElement('div');
        restoredList.className = 'klpf-restored-homework-list';
        restoreSection.append(restoreTitle, restoredList);
        controls.append(moduleSection, restoreSection);
        return controls;
    }

    /**
     * ホーム編集画面のカレンダープレビューを作る。
     * @returns {HTMLElement} カレンダーのプレビュー領域。
     */
    function createEditorCalendarPreview() {
        const preview = document.createElement('section');
        preview.className = 'klpf-dashboard-calendar-preview';
        const previewTitle = document.createElement('div');
        const previewHeading = document.createElement('h3');
        previewHeading.textContent = '課題カレンダー';
        previewTitle.append(previewHeading);
        editorCalendarElement = document.createElement('div');
        editorCalendarElement.id = 'klpf-dashboard-editor-calendar';
        editorDayDetailsElement = document.createElement('section');
        editorDayDetailsElement.className = 'klpf-calendar-day-details';
        editorDayDetailsElement.hidden = true;
        editorDayDetailsElement.setAttribute('aria-live', 'polite');
        preview.append(previewTitle, editorCalendarElement, editorDayDetailsElement);
        return preview;
    }

    /**
     * ホームの表示構成を既定値へ戻して保存する。
     * @returns {void} 戻り値はない。
     */
    function resetDashboardLayout() {
        layoutState = { order: [...DEFAULT_ORDER], hidden: [] };
        void saveLayout();
        applyLayout();
        renderModuleList();
    }

    /**
     * ホーム編集画面の下部操作領域を作る。
     * @returns {HTMLElement} ホーム編集画面の下部領域。
     */
    function createEditorFooter() {
        const footer = document.createElement('div');
        footer.className = 'klpf-dashboard-editor-footer';
        const reset = createButton('標準に戻す', 'klpf-dashboard-reset', '表示と順序を標準に戻す');
        reset.addEventListener('click', resetDashboardLayout);
        const done = createButton('完了', 'klpf-dashboard-done', '編集を完了');
        done.addEventListener('click', closeEditor);
        footer.append(reset, done);
        return footer;
    }

    /**
     * 背景のクリックを検知してホーム編集画面を閉じる。
     * @param {Event} event - 操作または通知のイベント。
     * @returns {void} 戻り値はない。
     */
    function handleEditorOverlayClick(event) {
        if (event.target === overlay) closeEditor();
    }

    /**
     * キーボード操作に合わせてホーム編集画面を閉じる。
     * @param {Event} event - 操作または通知のイベント。
     * @returns {void} 戻り値はない。
     */
    function handleEditorKeydown(event) {
        if (event.key === 'Escape' && overlay && !overlay.hidden) closeEditor();
    }

    /**
     * ホーム編集画面の各領域を組み立て、操作イベントを登録する。
     * @returns {void} 戻り値はない。
     */
    function createEditor() {
        overlay = document.createElement('div');
        overlay.id = 'klpf-dashboard-editor-overlay';
        overlay.className = 'klpf-dashboard-editor-overlay';
        overlay.hidden = true;

        const panel = document.createElement('section');
        panel.className = 'klpf-dashboard-editor';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-labelledby', 'klpf-dashboard-editor-title');

        const body = document.createElement('div');
        body.className = 'klpf-dashboard-editor-body';
        body.append(createEditorControls(), createEditorCalendarPreview());

        panel.append(createEditorHeader(), body, createEditorFooter());
        overlay.appendChild(panel);
        overlay.addEventListener('click', handleEditorOverlayClick);
        document.addEventListener('keydown', handleEditorKeydown);
        document.body.appendChild(overlay);
    }

    /**
     * DOM変更が続く場合のレイアウト適用をまとめて予約する。
     * @returns {void} 戻り値はない。
     */
    function scheduleApply() {
        if (applyScheduled) return;
        applyScheduled = true;
        queueMicrotask(() => {
            applyScheduled = false;
            applyLayout();
            applyHomeworkVisibility();
            refreshCalendars();
        });
    }

    /**
     * ホームのDOM変更を監視し、課題とレイアウトを更新する。
     * @returns {void} 戻り値はない。
     */
    function observeDashboard() {
        observer?.disconnect();
        observer = new MutationObserver(mutations => {
            const homeworkChanged = mutations.some(mutation => Array.from(mutation.addedNodes).some(node => {
                if (!(node instanceof Element)) return false;
                return node.matches('#homework, .homeworkItem')
                    || !!node.querySelector('#homework, .homeworkItem');
            }));
            if (homeworkChanged) scheduleApply();
        });
        observer.observe(column, { childList: true, subtree: true });
    }

    /**
     * ホーム編集の監視・タイマー・追加要素を片付ける。
     * @returns {void} 戻り値はない。
     */
    function cleanupDashboard() {
        observer?.disconnect();
        observer = null;
        document.removeEventListener(OPEN_HOME_EDITOR_EVENT, openEditor);
        document.removeEventListener('keydown', handleEditorKeydown);
    }

    /**
     * 設定と対象ページを確認し、機能の初期化を開始する。
     * @returns {Promise<void>} 処理の完了を待つPromise。
     */
    async function main() {
        column = await waitForElement(COLUMN_SELECTOR, document, 10000);
        if (!column) return;
        if (column.dataset[INITIALIZED_ATTRIBUTE] === 'true') return;
        column.dataset[INITIALIZED_ATTRIBUTE] = 'true';

        await loadState();
        createCalendarModule();
        document.querySelectorAll('#klpf-dashboard-edit-button').forEach(button => button.remove());
        document.querySelectorAll('#klpf-dashboard-editor-overlay').forEach(element => element.remove());
        createEditor();
        applyLayout();
        applyHomeworkVisibility();
        renderCompactCalendar();
        observeDashboard();
        document.addEventListener(OPEN_HOME_EDITOR_EVENT, openEditor);
        window.addEventListener('pagehide', cleanupDashboard);
        window.addEventListener('pageshow', event => {
            if (!event.persisted) return;
            void loadState().then(() => {
                applyLayout();
                applyHomeworkVisibility();
                refreshCalendars();
                observeDashboard();
                document.addEventListener(OPEN_HOME_EDITOR_EVENT, openEditor);
                document.addEventListener('keydown', handleEditorKeydown);
            }).catch(error => {
                console.error('[KLPF] ホームダッシュボードを復帰できませんでした。', error);
            });
        });
    }

    main().catch(error => {
        console.error('[KLPF] ホームダッシュボードの初期化に失敗しました。', error);
    });
})();
