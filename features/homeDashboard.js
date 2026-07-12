// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file ホーム左カラムの編集、課題の非表示・復元、課題カレンダーを管理する。
 */

(function() {
    'use strict';

    const COLUMN_SELECTOR = 'div.lms-menu-column.lms-home';
    const LAYOUT_STORAGE_KEY = 'klpf-home-dashboard-layout';
    const HIDDEN_HOMEWORK_STORAGE_KEY = 'klpf-hidden-homework-items';
    const DEFAULT_ORDER = ['profile', 'study', 'activity', 'calendar', 'homework'];
    const MODULES = {
        profile: { label: 'プロフィール', description: '利用者名とプロフィール画像' },
        study: { label: '学習実績', description: '学習実績とプロフィール詳細' },
        activity: { label: '利用状況', description: '履修・課題一覧と前回ログイン' },
        calendar: { label: '課題カレンダー', description: '提出日を科目名で表示' },
        homework: { label: '課題リスト', description: '提出期限がある課題の一覧' },
    };

    let column = null;
    let editButton = null;
    let overlay = null;
    let moduleList = null;
    let restoredList = null;
    let calendarElement = null;
    let editorCalendarElement = null;
    let compactCalendar = null;
    let editorCalendar = null;
    let observer = null;
    let applyScheduled = false;
    let layoutState = { order: [...DEFAULT_ORDER], hidden: [] };
    let hiddenHomeworkItems = [];

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

    async function loadState() {
        const result = await chrome.storage.local.get([
            LAYOUT_STORAGE_KEY,
            HIDDEN_HOMEWORK_STORAGE_KEY,
        ]);
        layoutState = normalizeLayout(result[LAYOUT_STORAGE_KEY]);
        hiddenHomeworkItems = normalizeHiddenHomework(result[HIDDEN_HOMEWORK_STORAGE_KEY]);
    }

    async function saveLayout() {
        await chrome.storage.local.set({ [LAYOUT_STORAGE_KEY]: layoutState });
    }

    async function saveHiddenHomework() {
        await chrome.storage.local.set({ [HIDDEN_HOMEWORK_STORAGE_KEY]: hiddenHomeworkItems });
    }

    function createButton(text, className, label) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = text;
        button.setAttribute('aria-label', label);
        button.title = label;
        return button;
    }

    function getModuleElements(key) {
        if (!column) return [];
        const selectors = {
            profile: ['.homeProfHeader', '.homeProfContents'],
            study: ['.lms-study'],
            activity: ['.last_login_date'],
            calendar: ['#klpf-home-calendar'],
            homework: ['#homework'],
        };
        return selectors[key].flatMap(selector => Array.from(column.querySelectorAll(selector)));
    }

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

    function getHomeworkKey(item) {
        const id = item.dataset.kyozaiId || '';
        const type = item.dataset.kyozaiSyCd || '';
        if (id || type) return `${id}:${type}`;
        return `text:${(item.textContent || '').replace(/\s+/g, ' ').trim()}`;
    }

    function readHomeworkMetadata(item) {
        const content = Array.from(item.children).filter(child => !child.classList.contains('klpf-homework-remove'));
        return {
            key: getHomeworkKey(item),
            deadline: (content[0]?.textContent || '').replace(/^📅\s*/, '').trim(),
            lessonName: (content[1]?.textContent || '').trim(),
            homeworkName: (content[2]?.textContent || '').replace(/^📝\s*/, '').trim(),
        };
    }

    function isHomeworkHidden(key) {
        return hiddenHomeworkItems.some(item => item.key === key);
    }

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

    async function restoreHomework(key) {
        hiddenHomeworkItems = hiddenHomeworkItems.filter(item => item.key !== key);
        await saveHiddenHomework();
        applyHomeworkVisibility();
        refreshCalendars();
        renderRestoredHomeworkList();
    }

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

    function applyHomeworkVisibility() {
        const homeworkContainer = column?.querySelector('#homework');
        if (!homeworkContainer) return;

        for (const item of homeworkContainer.querySelectorAll('.homeworkItem')) {
            decorateHomeworkItem(item);
            item.classList.toggle('klpf-homework-user-hidden', isHomeworkHidden(getHomeworkKey(item)));
        }
    }

    function parseDeadline(value) {
        const match = value.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})(?:[^\d]+(\d{1,2}):(\d{2}))?/);
        if (!match) return null;

        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const hasTime = match[4] !== undefined;
        const rawHour = hasTime ? Number(match[4]) : 0;
        const hour = rawHour === 24 ? 23 : rawHour;
        const minute = rawHour === 24 ? 59 : (hasTime ? Number(match[5]) : 0);
        const date = new Date(year, month - 1, day, hour, minute);
        if (Number.isNaN(date.getTime())) return null;

        const pad = number => String(number).padStart(2, '0');
        const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
        return hasTime ? `${datePart}T${pad(date.getHours())}:${pad(date.getMinutes())}:00` : datePart;
    }

    function collectCalendarEvents() {
        const homeworkContainer = column?.querySelector('#homework');
        if (!homeworkContainer) return [];

        return Array.from(homeworkContainer.querySelectorAll('.homeworkItem'))
            .filter(item => !isHomeworkHidden(getHomeworkKey(item)))
            .map(item => {
                const metadata = readHomeworkMetadata(item);
                const start = parseDeadline(metadata.deadline);
                if (!start) return null;
                return {
                    id: metadata.key,
                    title: metadata.lessonName || metadata.homeworkName || '課題',
                    start,
                    allDay: !start.includes('T'),
                    backgroundColor: '#c44d4d',
                    borderColor: '#a83c3c',
                    extendedProps: { homeworkName: metadata.homeworkName },
                };
            })
            .filter(Boolean);
    }

    function calendarOptions(compact) {
        return {
            initialView: 'dayGridMonth',
            locale: 'ja',
            firstDay: 1,
            height: 'auto',
            dayMaxEvents: compact ? 1 : 3,
            fixedWeekCount: false,
            headerToolbar: compact
                ? { left: 'prev', center: 'title', right: 'next' }
                : { left: 'prev,next today', center: 'title', right: 'dayGridMonth,listMonth' },
            buttonText: { today: '今日', month: '月', list: '一覧' },
            events: collectCalendarEvents(),
            eventDidMount(info) {
                const homeworkName = info.event.extendedProps.homeworkName || '';
                info.el.title = homeworkName ? `${info.event.title}：${homeworkName}` : info.event.title;
            },
        };
    }

    function renderCompactCalendar() {
        if (!calendarElement || typeof FullCalendar === 'undefined') return;
        compactCalendar?.destroy();
        compactCalendar = new FullCalendar.Calendar(calendarElement, calendarOptions(true));
        compactCalendar.render();
    }

    function renderEditorCalendar() {
        if (!editorCalendarElement || overlay?.hidden || typeof FullCalendar === 'undefined') return;
        editorCalendar?.destroy();
        editorCalendar = new FullCalendar.Calendar(editorCalendarElement, calendarOptions(false));
        editorCalendar.render();
    }

    function refreshCalendars() {
        const events = collectCalendarEvents();
        for (const calendar of [compactCalendar, editorCalendar]) {
            if (!calendar) continue;
            calendar.removeAllEvents();
            calendar.addEventSource(events);
        }
    }

    function createCalendarModule() {
        if (column.querySelector('#klpf-home-calendar')) {
            calendarElement = column.querySelector('#klpf-home-calendar-body');
            return;
        }

        const module = document.createElement('section');
        module.id = 'klpf-home-calendar';
        module.className = 'klpf-home-calendar-module';

        const header = document.createElement('div');
        header.className = 'klpf-home-calendar-header';
        const title = document.createElement('h3');
        title.textContent = '課題カレンダー';
        const expandButton = createButton('↗', 'klpf-calendar-expand', 'カレンダーを拡大');
        expandButton.addEventListener('click', openEditor);
        header.append(title, expandButton);

        calendarElement = document.createElement('div');
        calendarElement.id = 'klpf-home-calendar-body';
        module.append(header, calendarElement);
        column.appendChild(module);
        renderCompactCalendar();
    }

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

    function toggleModule(key) {
        const hidden = new Set(layoutState.hidden);
        if (hidden.has(key)) hidden.delete(key);
        else hidden.add(key);
        layoutState.hidden = [...hidden];
        void saveLayout();
        applyLayout();
        renderModuleList();
    }

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
            row.append(copy, restore);
            restoredList.appendChild(row);
        }
    }

    function closeEditor() {
        if (!overlay) return;
        overlay.hidden = true;
        document.documentElement.classList.remove('klpf-dashboard-editing');
        editButton?.focus();
    }

    function openEditor() {
        if (!overlay) createEditor();
        overlay.hidden = false;
        document.documentElement.classList.add('klpf-dashboard-editing');
        renderModuleList();
        renderRestoredHomeworkList();
        window.requestAnimationFrame(renderEditorCalendar);
        overlay.querySelector('.klpf-dashboard-editor-close')?.focus();
    }

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

        const header = document.createElement('header');
        header.className = 'klpf-dashboard-editor-header';
        const headingGroup = document.createElement('div');
        const eyebrow = document.createElement('span');
        eyebrow.textContent = 'HOME LAYOUT';
        const title = document.createElement('h2');
        title.id = 'klpf-dashboard-editor-title';
        title.textContent = 'ホームを編集';
        const subtitle = document.createElement('p');
        subtitle.textContent = '表示する情報と順序、非表示にした課題を管理できます。';
        headingGroup.append(eyebrow, title, subtitle);
        const close = createButton('×', 'klpf-dashboard-editor-close', '編集を終了');
        close.addEventListener('click', closeEditor);
        header.append(headingGroup, close);

        const body = document.createElement('div');
        body.className = 'klpf-dashboard-editor-body';
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

        const preview = document.createElement('section');
        preview.className = 'klpf-dashboard-calendar-preview';
        const previewTitle = document.createElement('div');
        const previewHeading = document.createElement('h3');
        previewHeading.textContent = '課題カレンダー';
        const previewCopy = document.createElement('p');
        previewCopy.textContent = '提出日には授業科目名を表示します。';
        previewTitle.append(previewHeading, previewCopy);
        editorCalendarElement = document.createElement('div');
        editorCalendarElement.id = 'klpf-dashboard-editor-calendar';
        preview.append(previewTitle, editorCalendarElement);
        body.append(controls, preview);

        const footer = document.createElement('div');
        footer.className = 'klpf-dashboard-editor-footer';
        const reset = createButton('標準に戻す', 'klpf-dashboard-reset', '表示と順序を標準に戻す');
        reset.addEventListener('click', () => {
            layoutState = { order: [...DEFAULT_ORDER], hidden: [] };
            void saveLayout();
            applyLayout();
            renderModuleList();
        });
        const done = createButton('完了', 'klpf-dashboard-done', '編集を完了');
        done.addEventListener('click', closeEditor);
        footer.append(reset, done);

        panel.append(header, body, footer);
        overlay.appendChild(panel);
        overlay.addEventListener('click', event => {
            if (event.target === overlay) closeEditor();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !overlay.hidden) closeEditor();
        });
        document.body.appendChild(overlay);
    }

    function createEditButton() {
        if (column.querySelector('#klpf-dashboard-edit-button')) return;
        editButton = createButton('🖋', 'klpf-dashboard-edit-button', 'ホームの表示を編集');
        editButton.id = 'klpf-dashboard-edit-button';
        editButton.addEventListener('click', openEditor);
        column.appendChild(editButton);
    }

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

    async function main() {
        column = await waitForElement(COLUMN_SELECTOR, document, 10000);
        if (!column) return;

        await loadState();
        createCalendarModule();
        createEditButton();
        createEditor();
        applyLayout();
        applyHomeworkVisibility();
        renderCompactCalendar();
        observeDashboard();
    }

    main().catch(error => {
        console.error('[KLPF] ホームダッシュボードの初期化に失敗しました。', error);
    });
})();
