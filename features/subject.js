//Copyright (c) 2024-2025 SAYU
//This software is released under the MIT License, see LICENSE.

(function() {
    'use strict';

    if (!window.location.href.startsWith("https://study.ns.kogakuin.ac.jp/lms/homeHoml/doIndex;")) return;

    const scheduleNormal = [
        { start: "08:30", end: "10:00", label: "1限" },
        { start: "10:10", end: "11:40", label: "2限" },
        { start: "11:41", end: "12:29", label: "昼休み" },
        { start: "12:30", end: "14:00", label: "3限" },
        { start: "14:10", end: "15:40", label: "4限" },
        { start: "15:50", end: "17:20", label: "5限" },
        { start: "17:30", end: "19:00", label: "6限" }
    ];

    const style = document.createElement('style');
    style.textContent = `
        .lms-weekly-area { visibility: hidden; }
        .red-highlight {
            border: 1px solid red;
        }
    `;

    if (document.head) {
        document.head.appendChild(style);
    } else {
        document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
    }

    document.addEventListener('DOMContentLoaded', () => {
        const form = document.querySelector('#homeHomlForm');
        const weeklyArea = document.querySelector('.lms-weekly-area');
        const termCell = Array.from(form?.querySelectorAll('th') || []).find(th => th.textContent.trim() === '期')?.nextElementSibling;

        if (!form || !weeklyArea || !termCell) {
            if (weeklyArea) weeklyArea.style.visibility = 'visible';
            return;
        }

        addAutoFilterCheckbox(termCell);
        loadSettingsAndApplyFilter(form, () => {
            setupEventListeners(form);
            highlightCurrentClass();
            setInterval(highlightCurrentClass, 60000);
            weeklyArea.style.visibility = 'visible';
        });
    });

    const STORAGE_KEY = 'couse_filter_settings';

    function loadSettingsAndApplyFilter(form, callback) {
        chrome.storage.local.get(STORAGE_KEY, (result) => {
            const savedSettings = result[STORAGE_KEY];
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
            if (callback) callback();
        });
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
            clearButton.addEventListener('click', (e) => {
                e.preventDefault();
                chrome.storage.local.remove(STORAGE_KEY, () => {
                    form.reset();
                    form.querySelectorAll('input[name="checkKiList"]').forEach(cb => cb.disabled = false);
                    applyClientSideFilter(form);
                });
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
        chrome.storage.local.set({ [STORAGE_KEY]: JSON.stringify(settings) });
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
            if(card.classList.contains('red-highlight')) {
                card.classList.remove('red-highlight');
            }

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
    
    function highlightCurrentClass() {
        document.querySelectorAll('.red-highlight').forEach(card => {
            card.classList.remove('red-highlight');
        });

        const now = new Date();
        const dayOfWeek = now.getDay();
        const currentTime = ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);

        
        const dayCodeMap = { 0: "7", 1: "1", 2: "2", 3: "3", 4: "4", 5: "5", 6: "6" };
        const currentDayCode = dayCodeMap[dayOfWeek];
        const dayBox = Array.from(document.querySelectorAll('.lms-daybox')).find(box => {
            const title = box.querySelector('.lms-category-title h3')?.textContent.trim();
            return dayTextToCode(title) === currentDayCode;
        });

        if (!dayBox) return;

        if (currentTime >= "11:50" && currentTime <= "13:20") {
            const allCardsInDay = Array.from(dayBox.querySelectorAll('.lms-card'));
            const card2 = allCardsInDay.find(card => extractCardInfo(card).periodCode === '02');
            const card3 = allCardsInDay.find(card => extractCardInfo(card).periodCode === '03');

            if (card2 && card3) {
                const info2 = extractCardInfo(card2);
                const info3 = extractCardInfo(card3);
                if (info2.courseName === info3.courseName || info2.instructor === info3.instructor) {
                    card3.classList.add('red-highlight');
                    return;
                }
            }
        }
        
        const currentPeriod = scheduleNormal.find(p => currentTime >= p.start && currentTime <= p.end);

        if (!currentPeriod || !currentPeriod.label.includes('限')) {
            return;
        }

        const periodCodeToHighlight = ('0' + currentPeriod.label.replace('限', '')).slice(-2);
        const cardToHighlight = Array.from(dayBox.querySelectorAll('.lms-card')).find(card => {
            return card.style.display !== 'none' && extractCardInfo(card).periodCode === periodCodeToHighlight;
        });

        if (cardToHighlight) {
            cardToHighlight.classList.add('red-highlight');
        }
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
        const q1Terms = ["1Q", "前期", "通年"],
              q2Terms = ["2Q", "前期", "通年"];
        const q3Terms = ["3Q", "後期", "通年"],
              q4Terms = ["4Q", "後期", "通年"];
        const otherTerms = ["その他", "集中・特週", "自己学習", "講義"];

        if (otherTerms.some(term => cardTermText.includes(term))) return true;

        switch (nowQ) {
            case 1: return q1Terms.some(term => cardTermText.includes(term));
            case 2: return q2Terms.some(term => cardTermText.includes(term));
            case 3: return q3Terms.some(term => cardTermText.includes(term));
            case 4: return q4Terms.some(term => cardTermText.includes(term));
            default: return false;
        }
    }

    function extractCardInfo(card) {
        const info = {
            courseName: card.querySelector('.lms-cardname')?.textContent.trim() || '',
            instructor: card.querySelector('.lms-carduser')?.textContent.trim() || '',
            dayCode: '',
            periodCode: '',
            semesterCode: '',
            semesterText: ''
        };
        const infoText = (card.querySelector('.courseCardInfo')?.textContent || '').replace(/\s+/g, ' ');
        const match = infoText.match(/(\d+)限(.*)/);
        if (match) {
            info.periodCode = ('0' + match[1]).slice(-2);
            info.semesterText = match[2].trim();
        } else {
            info.semesterText = infoText.trim();
        }
        info.semesterCode = semesterTextToCode(info.semesterText);
        const dayText = card.closest('.lms-daybox')?.querySelector('.lms-category-title h3')?.textContent.trim();
        info.dayCode = dayTextToCode(dayText);
        return info;
    }

    function semesterTextToCode(text) {
        const map = { "通年": "01", "前期": "02", "後期": "03", "1Q": "04", "2Q": "05", "3Q": "06", "4Q": "07", "集中・特週": "08", "自己学習": "09", "その他": "10", "講義": "11" };
        for (const key in map) {
            if (text.includes(key)) return map[key];
        }
        return '';
    }
    
    function dayTextToCode(text) {
        return { "月曜日": "1", "火曜日": "2", "水曜日": "3", "木曜日": "4", "金曜日": "5", "土曜日": "6", "日曜日": "7", "その他": "Z" }[text] || '';
    }

})();