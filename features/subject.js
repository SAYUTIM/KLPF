// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 講義一覧ページのフィルタリング保存と現在の講義のハイライト機能
 */

(function() {
    'use strict';

    const STYLE_ID = 'klpf-subject-filter-style';
    const INITIALIZED_ATTRIBUTE = 'klpfSubjectFilterInitialized';
    const HIGHLIGHT_INTERVAL_MS = 60 * 1000;
    const SELECTORS = {
        autoFilter: '#autoFilterCheckbox',
        courseCards: '.lms-card',
        dayBoxes: '.lms-daybox',
        period: 'select[name="jigen"]',
        weekday: 'select[name="yobi"]',
        courseName: 'input[name="kougiName"]',
        instructor: 'input[name="kyoinName"]',
        selectedTerms: 'input[name="checkKiList"]:checked',
        allTerms: 'input[name="checkKiList"]',
    };

    let highlightIntervalId = null;

    if (!window.location.href.startsWith(LMS_HOME_URL)
        && !window.location.href.startsWith(LMS_HOME_BACK_URL)) {
        return;
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .lms-weekly-area { visibility: hidden; }
            .${SUBJECT_HIGHLIGHT_CLASS} {
                border: 2px solid #d9534f !important;
                box-shadow: 0 0 10px rgba(217, 83, 79, 0.5);
            }
            .klpf-search-button-disabled {
                cursor: not-allowed !important;
                opacity: 0.55;
                filter: grayscale(0.25);
            }
            .klpf-search-button-notice {
                display: none;
                margin: 8px auto 0;
                padding: 8px 12px;
                width: fit-content;
                max-width: min(360px, 100%);
                border: 1px solid #7bc5df;
                border-radius: 5px;
                background: #eef9fd;
                color: #24566a;
                font-size: 13px;
                font-weight: 600;
                line-height: 1.5;
            }
            .klpf-search-button-notice.is-visible {
                display: block;
            }
        `;
        document.head.appendChild(style);
    }

    function readFilterSettings(form, normalizeSearchText = false) {
        const normalize = (value) => normalizeSearchText ? value.toLowerCase() : value;
        return {
            isAutoActive: form.querySelector(SELECTORS.autoFilter)?.checked || false,
            yobi: form.querySelector(SELECTORS.weekday)?.value || 'all',
            jigen: form.querySelector(SELECTORS.period)?.value || 'all',
            kougiName: normalize(form.querySelector(SELECTORS.courseName)?.value.trim() || ''),
            kyoinName: normalize(form.querySelector(SELECTORS.instructor)?.value.trim() || ''),
            checkKiList: safeQuerySelectorAll(SELECTORS.selectedTerms, form).map(checkbox => checkbox.value),
        };
    }

    async function loadSettings() {
        try {
            const result = await chrome.storage.local.get(SUBJECT_FILTER_STORAGE_KEY);
            const rawSettings = result[SUBJECT_FILTER_STORAGE_KEY];
            if (!rawSettings) return {};

            const parsed = JSON.parse(rawSettings);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

            return {
                isAutoActive: parsed.isAutoActive === true,
                yobi: typeof parsed.yobi === 'string' ? parsed.yobi : 'all',
                jigen: typeof parsed.jigen === 'string' ? parsed.jigen : 'all',
                kougiName: typeof parsed.kougiName === 'string' ? parsed.kougiName : '',
                kyoinName: typeof parsed.kyoinName === 'string' ? parsed.kyoinName : '',
                checkKiList: Array.isArray(parsed.checkKiList)
                    ? parsed.checkKiList.filter(value => typeof value === 'string')
                    : [],
            };
        } catch (error) {
            console.error("[KLPF] フィルター設定の読み込みに失敗しました。", error);
            return {};
        }
    }

    function saveSettings(form) {
        const settings = readFilterSettings(form);
        chrome.storage.local.set({ [SUBJECT_FILTER_STORAGE_KEY]: JSON.stringify(settings) });
    }

    function extractCardInfo(card) {
        const infoText = (safeQuerySelector('.courseCardInfo', card)?.textContent || '').replace(/\s+/g, ' ');
        const match = infoText.match(/(\d+)限(.*)/);
        const periodCode = match ? ('0' + match[1]).slice(-2) : '';
        const semesterText = match ? match[2].trim() : infoText.trim();
        const dayText = card.closest('.lms-daybox')?.querySelector('.lms-category-title h3')?.textContent.trim();

        return {
            courseName: safeQuerySelector('.lms-cardname', card)?.textContent.trim() || '',
            instructor: safeQuerySelector('.lms-carduser', card)?.textContent.trim() || '',
            dayCode: {"月曜日":"1", "火曜日":"2", "水曜日":"3", "木曜日":"4", "金曜日":"5", "土曜日":"6", "日曜日":"7", "その他":"Z"}[dayText] || '',
            periodCode: periodCode,
            semesterCode: {"通年":"01", "前期":"02", "後期":"03", "1Q":"04", "2Q":"05", "3Q":"06", "4Q":"07", "集中・特週":"08", "自己学習":"09", "その他":"10", "講義":"11"}[semesterText.split(' ')[0]] || '',
            semesterText: semesterText
        };
    }

    function getSearchButtonNotice(searchButton) {
        let notice = document.getElementById('klpfSearchButtonNotice');
        if (notice) return notice;

        notice = document.createElement('p');
        notice.id = 'klpfSearchButtonNotice';
        notice.className = 'klpf-search-button-notice';
        notice.setAttribute('role', 'status');
        notice.setAttribute('aria-live', 'polite');
        notice.textContent = '検索するには、「自動」のチェックを外してください。';
        const buttonArea = searchButton.closest('.lms-footer-contents') || searchButton.parentElement;
        buttonArea.insertAdjacentElement('afterend', notice);
        return notice;
    }

    function setSearchButtonDisabled(isAutoActive) {
        const searchButton = safeQuerySelector('button[onclick="submitSearch();"]');
        if (searchButton) {
            const notice = getSearchButtonNotice(searchButton);
            searchButton.style.removeProperty('display');
            searchButton.classList.toggle('klpf-search-button-disabled', isAutoActive);
            searchButton.setAttribute('aria-disabled', String(isAutoActive));
            searchButton.toggleAttribute('aria-describedby', isAutoActive);
            if (isAutoActive) searchButton.setAttribute('aria-describedby', notice.id);
            searchButton.title = isAutoActive
                ? '検索するには、「自動」のチェックを外してください。'
                : '';

            if (!isAutoActive) {
                notice.classList.remove('is-visible');
            }
        }
    }

    function getCurrentQuarter(month = new Date().getMonth() + 1) {
        if (month >= 4 && month <= 5) return 1;
        if (month >= 6 && month <= 7) return 2;
        if (month >= 8 && month <= 10) return 3;
        return 4;
    }

    function isCurrentSemester(semesterText, quarter = getCurrentQuarter()) {
        const termsByQuarter = [
            ['1Q', '前期', '通年'],
            ['2Q', '前期', '通年'],
            ['3Q', '後期', '通年'],
            ['4Q', '後期', '通年'],
        ];
        const alwaysAvailableTerms = ['その他', '集中・特週', '自己学習', '講義'];

        return alwaysAvailableTerms.some(term => semesterText.includes(term))
            || termsByQuarter[quarter - 1].some(term => semesterText.includes(term));
    }

    function applyClientSideFilter(form) {
        const settings = readFilterSettings(form, true);

        setSearchButtonDisabled(settings.isAutoActive);

        const currentQuarter = getCurrentQuarter();

        safeQuerySelectorAll(SELECTORS.courseCards).forEach(card => {
            const info = extractCardInfo(card);
            let isVisible = true;

            if (settings.isAutoActive) {
                if (!isCurrentSemester(info.semesterText, currentQuarter)) {
                    isVisible = false;
                }
            } else if (settings.checkKiList.length > 0) {
                if (!settings.checkKiList.includes(info.semesterCode)) isVisible = false;
            }

            if (isVisible) {
                if (settings.yobi !== 'all' && settings.yobi !== info.dayCode) isVisible = false;
                if (settings.jigen !== 'all' && settings.jigen !== info.periodCode) isVisible = false;
                if (settings.kougiName && !info.courseName.toLowerCase().includes(settings.kougiName)) isVisible = false;
                if (settings.kyoinName && !info.instructor.toLowerCase().includes(settings.kyoinName)) isVisible = false;
            }
            card.style.display = isVisible ? '' : 'none';
        });

        safeQuerySelectorAll(SELECTORS.dayBoxes).forEach(dayBox => {
            const visibleCards = safeQuerySelectorAll(SELECTORS.courseCards, dayBox).filter(card => card.style.display !== 'none');
            dayBox.style.display = visibleCards.length > 0 ? '' : 'none';
        });
    }

    function highlightCurrentClass() {
        safeQuerySelectorAll(`.${SUBJECT_HIGHLIGHT_CLASS}`).forEach(card => card.classList.remove(SUBJECT_HIGHLIGHT_CLASS));

        const now = new Date();
        const dayOfWeek = now.getDay();
        const currentTime = ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);
        const currentDayCode = {0:"7", 1:"1", 2:"2", 3:"3", 4:"4", 5:"5", 6:"6"}[dayOfWeek];

        const currentPeriod = TIME_SCHEDULE_NORMAL.find(p => currentTime >= p.start && currentTime <= p.end);
        if (!currentPeriod || !currentPeriod.label.includes('限')) return;

        const periodCodeToHighlight = ('0' + currentPeriod.label.replace('限', '')).slice(-2);
        const currentQuarter = getCurrentQuarter(now.getMonth() + 1);

        safeQuerySelectorAll(SELECTORS.courseCards).forEach(card => {
            if (card.style.display === 'none') return;
            const info = extractCardInfo(card);
            if (
                info.dayCode === currentDayCode
                && info.periodCode === periodCodeToHighlight
                && isCurrentSemester(info.semesterText, currentQuarter)
            ) {
                card.classList.add(SUBJECT_HIGHLIGHT_CLASS);
            }
        });
    }

    function addAutoFilterCheckbox(targetCell) {
        if (document.querySelector(SELECTORS.autoFilter)) return;

        const container = document.createElement('span');
        container.className = 'lms-form-checkbox-label';
        container.style.fontWeight = 'bold';
        container.style.color = '#d9534f';
        container.style.paddingRight = '10px';

        const checkboxWrapper = document.createElement('span');
        checkboxWrapper.className = 'lms-checkbox';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = 'autoFilterCheckbox';

        const checkboxLabel = document.createElement('label');
        checkboxLabel.htmlFor = checkbox.id;
        checkboxLabel.setAttribute('aria-label', '履修中科目のみ自動表示');

        const checkIcon = document.createElement('span');
        checkIcon.className = 'fj-icon fj-icon-check';

        checkboxLabel.appendChild(checkIcon);
        checkboxWrapper.append(checkbox, checkboxLabel);
        container.append(checkboxWrapper, document.createTextNode('自動'));
        targetCell.prepend(container);
    }

    function setupEventListeners(form) {
        const searchButton = form.querySelector('button[onclick="submitSearch();"]');
        if (searchButton) {
            form.addEventListener('click', (event) => {
                if (!event.target.closest('button[onclick="submitSearch();"]')) return;
                if (!form.querySelector(SELECTORS.autoFilter)?.checked) return;

                event.preventDefault();
                event.stopImmediatePropagation();
                getSearchButtonNotice(searchButton).classList.add('is-visible');
            }, true);
        }

        form.addEventListener('input', () => {
            const autoCheckbox = form.querySelector(SELECTORS.autoFilter);
            if (autoCheckbox) {
                safeQuerySelectorAll(SELECTORS.allTerms, form).forEach(checkbox => checkbox.disabled = autoCheckbox.checked);
            }
            applyClientSideFilter(form);
            saveSettings(form);
        });

        const clearButton = form.querySelector('button[onclick^="clearDate"]');
        if (clearButton) {
            clearButton.addEventListener('click', (e) => {
                e.preventDefault();
                chrome.storage.local.remove(SUBJECT_FILTER_STORAGE_KEY, () => {
                    form.reset();
                    safeQuerySelectorAll(SELECTORS.allTerms, form).forEach(checkbox => checkbox.disabled = false);
                    applyClientSideFilter(form);
                });
            });
        }
    }

    function applySavedSettings(form, savedSettings) {
        if (Object.keys(savedSettings).length === 0) return;

        const autoCheckbox = form.querySelector(SELECTORS.autoFilter);
        if (autoCheckbox) autoCheckbox.checked = savedSettings.isAutoActive === true;
        form.querySelector(SELECTORS.weekday).value = savedSettings.yobi || 'all';
        form.querySelector(SELECTORS.period).value = savedSettings.jigen || 'all';
        form.querySelector(SELECTORS.courseName).value = savedSettings.kougiName || '';
        form.querySelector(SELECTORS.instructor).value = savedSettings.kyoinName || '';
        safeQuerySelectorAll(SELECTORS.allTerms, form).forEach(checkbox => {
            checkbox.checked = savedSettings.checkKiList?.includes(checkbox.value) || false;
            if (autoCheckbox) checkbox.disabled = autoCheckbox.checked;
        });
    }

    function stopHighlightTimer() {
        if (!highlightIntervalId) return;
        clearInterval(highlightIntervalId);
        highlightIntervalId = null;
    }

    async function main() {
        const form = safeQuerySelector('#homeHomlForm');
        const weeklyArea = safeQuerySelector('.lms-weekly-area');
        const termCell = safeQuerySelectorAll('th', form).find(th => th.textContent.trim() === '期')?.nextElementSibling;

        if (!form || !weeklyArea || !termCell) {
            if(weeklyArea) weeklyArea.style.visibility = 'visible';
            return;
        }

        if (form.dataset[INITIALIZED_ATTRIBUTE] === 'true') {
            weeklyArea.style.visibility = 'visible';
            return;
        }
        form.dataset[INITIALIZED_ATTRIBUTE] = 'true';

        injectStyles();
        addAutoFilterCheckbox(termCell);

        const savedSettings = await loadSettings();
        applySavedSettings(form, savedSettings);

        applyClientSideFilter(form);
        setupEventListeners(form);
        highlightCurrentClass();
        stopHighlightTimer();
        highlightIntervalId = setInterval(highlightCurrentClass, HIGHLIGHT_INTERVAL_MS);
        window.addEventListener('pagehide', stopHighlightTimer, { once: true });

        weeklyArea.style.visibility = 'visible';
        console.log("[KLPF] 講義フィルター機能を初期化しました。");
    }

    const safeRun = () => main().catch(error => {
        console.error("[KLPF] 講義フィルター機能の実行中にエラーが発生しました。", error);
        const weeklyArea = safeQuerySelector('.lms-weekly-area');
        if(weeklyArea) weeklyArea.style.visibility = 'visible';
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', safeRun, { once: true });
    } else {
        safeRun();
    }

})();
