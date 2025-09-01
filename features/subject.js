// Copyright (c) 2024-2025 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 講義一覧ページのフィルタリング保存と現在の講義のハイライト機能
 */

(function() {
    'use strict';

    if (!window.location.href.startsWith(`${LMS_HOME_URL}doIndex;`)) {
        return;
    }

    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .lms-weekly-area { visibility: hidden; }
            .${SUBJECT_HIGHLIGHT_CLASS} {
                border: 2px solid #d9534f !important;
                box-shadow: 0 0 10px rgba(217, 83, 79, 0.5);
            }
        `;
        document.head.appendChild(style);
    }

    async function loadSettings() {
        try {
            const result = await chrome.storage.local.get(SUBJECT_FILTER_STORAGE_KEY);
            return result[SUBJECT_FILTER_STORAGE_KEY] ? JSON.parse(result[SUBJECT_FILTER_STORAGE_KEY]) : {};
        } catch (error) {
            console.error("[KLPF] フィルター設定の読み込みに失敗しました。", error);
            return {};
        }
    }

    function saveSettings(form) {
        const settings = {
            isAutoActive: form.querySelector('#autoFilterCheckbox')?.checked || false,
            yobi: form.querySelector('select[name="yobi"]')?.value || 'all',
            jigen: form.querySelector('select[name="jigen"]')?.value || 'all',
            kougiName: form.querySelector('input[name="kougiName"]')?.value.trim() || '',
            kyoinName: form.querySelector('input[name="kyoinName"]')?.value.trim() || '',
            checkKiList: safeQuerySelectorAll('input[name="checkKiList"]:checked', form).map(cb => cb.value)
        };
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

    function toggleSearchButtonVisibility(isAutoActive) {
        const searchButton = safeQuerySelector('button[onclick="submitSearch();"]');
        if (searchButton) {
            searchButton.style.display = isAutoActive ? 'none' : '';
        }
    }

    function applyClientSideFilter(form) {
        const settings = {
            isAutoActive: form.querySelector('#autoFilterCheckbox')?.checked || false,
            yobi: form.querySelector('select[name="yobi"]').value,
            jigen: form.querySelector('select[name="jigen"]').value,
            kougiName: form.querySelector('input[name="kougiName"]').value.trim().toLowerCase(),
            kyoinName: form.querySelector('input[name="kyoinName"]').value.trim().toLowerCase(),
            checkKiList: safeQuerySelectorAll('input[name="checkKiList"]:checked', form).map(cb => cb.value)
        };

        toggleSearchButtonVisibility(settings.isAutoActive);

        const nowQ = (month => (month >= 4 && month <= 5) ? 1 : (month >= 6 && month <= 7) ? 2 : (month >= 8 && month <= 10) ? 3 : 4)(new Date().getMonth() + 1);

        safeQuerySelectorAll('.lms-card').forEach(card => {
            const info = extractCardInfo(card);
            let isVisible = true;

            if (settings.isAutoActive) {
                const termMatch = [["1Q", "前期", "通年"], ["2Q", "前期", "通年"], ["3Q", "後期", "通年"], ["4Q", "後期", "通年"]];
                const otherTerms = ["その他", "集中・特週", "自己学習", "講義"];
                if (!otherTerms.some(term => info.semesterText.includes(term)) && !termMatch[nowQ - 1].some(term => info.semesterText.includes(term))) {
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

        safeQuerySelectorAll('.lms-daybox').forEach(dayBox => {
            const visibleCards = safeQuerySelectorAll('.lms-card', dayBox).filter(c => c.style.display !== 'none');
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

        safeQuerySelectorAll('.lms-card').forEach(card => {
            if (card.style.display === 'none') return;
            const info = extractCardInfo(card);
            if (info.dayCode === currentDayCode && info.periodCode === periodCodeToHighlight) {
                card.classList.add(SUBJECT_HIGHLIGHT_CLASS);
            }
        });
    }

    function addAutoFilterCheckbox(targetCell) {
        if (document.getElementById('autoFilterCheckbox')) return;
        targetCell.insertAdjacentHTML('afterbegin', `
            <label class="lms-form-checkbox-label" style="font-weight: bold; color: #d9534f; padding-right: 10px;">
                <span class="lms-checkbox"><input type="checkbox" id="autoFilterCheckbox"><label for="autoFilterCheckbox"><span class="fj-icon fj-icon-check"></span></label></span>自動
            </label>
        `);
    }

    function setupEventListeners(form) {
        form.addEventListener('input', () => {
            const autoCheckbox = form.querySelector('#autoFilterCheckbox');
            if (autoCheckbox) {
                safeQuerySelectorAll('input[name="checkKiList"]', form).forEach(cb => cb.disabled = autoCheckbox.checked);
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
                    safeQuerySelectorAll('input[name="checkKiList"]', form).forEach(cb => cb.disabled = false);
                    applyClientSideFilter(form);
                });
            });
        }
    }

    async function main() {
        const form = safeQuerySelector('#homeHomlForm');
        const weeklyArea = safeQuerySelector('.lms-weekly-area');
        const termCell = safeQuerySelectorAll('th', form).find(th => th.textContent.trim() === '期')?.nextElementSibling;

        if (!form || !weeklyArea || !termCell) {
            if(weeklyArea) weeklyArea.style.visibility = 'visible';
            return;
        }

        injectStyles();
        addAutoFilterCheckbox(termCell);

        const savedSettings = await loadSettings();
        if (Object.keys(savedSettings).length > 0) {
            const autoCheckbox = form.querySelector('#autoFilterCheckbox');
            if (autoCheckbox) autoCheckbox.checked = savedSettings.isAutoActive || false;
            form.querySelector('select[name="yobi"]').value = savedSettings.yobi || 'all';
            form.querySelector('select[name="jigen"]').value = savedSettings.jigen || 'all';
            form.querySelector('input[name="kougiName"]').value = savedSettings.kougiName || '';
            form.querySelector('input[name="kyoinName"]').value = savedSettings.kyoinName || '';
            safeQuerySelectorAll('input[name="checkKiList"]', form).forEach(cb => {
                cb.checked = savedSettings.checkKiList ? savedSettings.checkKiList.includes(cb.value) : false;
                if (autoCheckbox) cb.disabled = autoCheckbox.checked;
            });
        }

        applyClientSideFilter(form);
        setupEventListeners(form);
        highlightCurrentClass();
        setInterval(highlightCurrentClass, 60000);

        weeklyArea.style.visibility = 'visible';
        console.log("[KLPF] 講義フィルター機能を初期化しました。");
    }

    const safeRun = () => main().catch(error => {
        console.error("[KLPF] 講義フィルター機能の実行中にエラーが発生しました。", error);
        const weeklyArea = safeQuerySelector('.lms-weekly-area');
        if(weeklyArea) weeklyArea.style.visibility = 'visible';
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', safeRun);
    } else {
        safeRun();
    }

})();