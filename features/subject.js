//Copyright (c) 2024-2025 SAYU
//This software is released under the MIT License, see LICENSE.

(function() {
    'use strict';

    const style = document.createElement('style');
    style.textContent = `.lms-weekly-area { visibility: hidden; }`;
    if (document.head) document.head.appendChild(style);
    else document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));

    document.addEventListener('DOMContentLoaded', () => {
        const form = document.querySelector('#homeHomlForm');
        const weeklyArea = document.querySelector('.lms-weekly-area');
        const termCell = Array.from(form?.querySelectorAll('th') || []).find(th => th.textContent.trim() === '期')?.nextElementSibling;

        if (!form || !weeklyArea || !termCell) {
            console.error('KU-LMS Filter: 必須要素が見つからないため、スクリプトを停止します。');
            if (weeklyArea) weeklyArea.style.visibility = 'visible';
            return;
        }

        addAutoFilterCheckbox(termCell);
        loadSettingsAndApplyFilter(form);
        setupEventListeners(form);

        weeklyArea.style.visibility = 'visible';
    });

    const STORAGE_KEY = 'couse_filter_settings';

    function loadSettingsAndApplyFilter(form) {
        const savedSettings = localStorage.getItem(STORAGE_KEY);
        if (savedSettings) {
            const settings = JSON.parse(savedSettings);
            const autoCheckbox = form.querySelector('#autoFilterCheckbox');
            if (autoCheckbox) autoCheckbox.checked = settings.isAutoActive || false;
            
            form.querySelector('select[name="yobi"]').value = settings.yobi || 'all';
            form.querySelector('select[name="jigen"]').value = settings.jigen || 'all';
            form.querySelector('input[name="kougiName"]').value = settings.kougiName || '';
            form.querySelector('input[name="kyoinName"]').value = settings.kyoinName || '';
            
            const kiCheckboxes = form.querySelectorAll('input[name="checkKiList"]');
            kiCheckboxes.forEach(cb => {
                cb.checked = settings.checkKiList ? settings.checkKiList.includes(cb.value) : false;
                if (autoCheckbox) cb.disabled = autoCheckbox.checked;
            });
        }
        applyClientSideFilter(form);
    }

    function setupEventListeners(form) {
        form.addEventListener('input', () => {
            const autoCheckbox = form.querySelector('#autoFilterCheckbox');
            form.querySelectorAll('input[name="checkKiList"]').forEach(cb => cb.disabled = autoCheckbox.checked);
            applyClientSideFilter(form);
            saveCurrentFilterState(form);
        });

        const clearButton = form.querySelector('button[onclick^="clearDate"]');
        if (clearButton) {
            clearButton.addEventListener('click', () => {
                localStorage.removeItem(STORAGE_KEY);
                document.querySelectorAll('.lms-card, .lms-daybox').forEach(el => el.style.display = '');
            });
        }
    }

    function saveCurrentFilterState(form) {
        const settings = {
            isAutoActive: form.querySelector('#autoFilterCheckbox').checked,
            yobi: form.querySelector('select[name="yobi"]').value,
            jigen: form.querySelector('select[name="jigen"]').value,
            kougiName: form.querySelector('input[name="kougiName"]').value.trim(),
            kyoinName: form.querySelector('input[name="kyoinName"]').value.trim(),
            checkKiList: Array.from(form.querySelectorAll('input[name="checkKiList"]:checked')).map(cb => cb.value)
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }
    
    function applyClientSideFilter(form) {
        const isAutoActive = form.querySelector('#autoFilterCheckbox')?.checked || false;
        const nowQ = determineNowQ();
        const manualSettings = {
            yobi: form.querySelector('select[name="yobi"]').value,
            jigen: form.querySelector('select[name="jigen"]').value,
            kougiName: form.querySelector('input[name="kougiName"]').value.trim().toLowerCase(),
            kyoinName: form.querySelector('input[name="kyoinName"]').value.trim().toLowerCase(),
            checkKiList: Array.from(form.querySelectorAll('input[name="checkKiList"]:checked')).map(cb => cb.value)
        };
        
        document.querySelectorAll('.lms-card').forEach(card => {
            const cardInfo = extractCardInfo(card);
            let shouldBeVisible = true;
            if (isAutoActive) {
                if (!isTermMatch(cardInfo.semesterText, nowQ)) shouldBeVisible = false;
            } else if (manualSettings.checkKiList.length > 0) {
                if (!manualSettings.checkKiList.includes(cardInfo.semesterCode)) shouldBeVisible = false;
            }
            if (shouldBeVisible) {
                if (manualSettings.yobi !== 'all' && manualSettings.yobi !== cardInfo.dayCode) shouldBeVisible = false;
                if (manualSettings.jigen !== 'all' && manualSettings.jigen !== cardInfo.periodCode) shouldBeVisible = false;
                if (manualSettings.kougiName && !cardInfo.courseName.toLowerCase().includes(manualSettings.kougiName)) shouldBeVisible = false;
                if (manualSettings.kyoinName && !cardInfo.instructor.toLowerCase().includes(manualSettings.kyoinName)) shouldBeVisible = false;
            }
            card.style.display = shouldBeVisible ? '' : 'none';
        });
        hideEmptyDayBoxes();
    }

    function addAutoFilterCheckbox(targetCell) {
        if (document.getElementById('autoFilterCheckbox')) return;
        targetCell.insertAdjacentHTML('afterbegin', `
            <label class="lms-form-checkbox-label" style="font-weight: bold; color: #d9534f; padding-right: 10px;">
                <span class="lms-checkbox"><input type="checkbox" id="autoFilterCheckbox"><label for="autoFilterCheckbox"><span class="fj-icon fj-icon-check"></span></label></span>自動
            </label>
        `);
    }

    function hideEmptyDayBoxes() {
        document.querySelectorAll('.lms-daybox').forEach(dayBox => {
            const allCards = dayBox.querySelectorAll('.lms-card');
            if (allCards.length === 0) return;
            const visibleCards = Array.from(allCards).filter(c => c.style.display !== 'none');
            dayBox.style.display = visibleCards.length > 0 ? '' : 'none';
        });
    }

    function determineNowQ() {
        const month = new Date().getMonth() + 1;
        if (month >= 4 && month <= 5) return 1;
        if (month >= 6 && month <= 7) return 2;
        if (month >= 8 && month <= 10) return 3;
        if (month >= 11 || month <= 3) return 4;
        return 0; 
    }

    function isTermMatch(cardTermText, nowQ) {
        const q1Terms = ["1Q", "前期", "通年"], q2Terms = ["2Q", "前期", "通年"];
        const q3Terms = ["3Q", "後期", "通年"], q4Terms = ["4Q", "後期", "通年"];
        const otherTerms = ["その他", "集中・特週", "自己学習", "講義"];
        if (otherTerms.includes(cardTermText)) return true;
        switch (nowQ) {
            case 1: return q1Terms.includes(cardTermText);
            case 2: return q2Terms.includes(cardTermText);
            case 3: return q3Terms.includes(cardTermText);
            case 4: return q4Terms.includes(cardTermText);
            default: return false;
        }
    }

    function extractCardInfo(card) {
        const info = { courseName: card.querySelector('.lms-cardname')?.textContent.trim() || '', instructor: card.querySelector('.lms-carduser')?.textContent.trim() || '', dayCode: '', periodCode: '', semesterCode: '', semesterText: '' };
        const infoText = (card.querySelector('.courseCardInfo')?.textContent || '').replace(/\s+/g, ' ');
        const match = infoText.match(/(\d+)限(.*)/);
        if (match) {
            info.periodCode = ('0' + match[1]).slice(-2);
            info.semesterText = match[2].trim();
        } else { info.semesterText = infoText.trim(); }
        info.semesterCode = semesterTextToCode(info.semesterText);
        const dayText = card.closest('.lms-daybox')?.querySelector('.lms-category-title h3')?.textContent.trim();
        info.dayCode = dayTextToCode(dayText);
        return info;
    }

    function semesterTextToCode(text) { return { "通年": "01", "前期": "02", "後期": "03", "1Q": "04", "2Q": "05", "3Q": "06", "4Q": "07", "集中・特週": "08", "自己学習": "09", "その他": "10", "講義": "11" }[text] || ''; }
    function dayTextToCode(text) { return { "月曜日": "1", "火曜日": "2", "水曜日": "3", "木曜日": "4", "金曜日": "5", "土曜日": "6", "日曜日": "7", "その他": "Z" }[text] || ''; }

})();
