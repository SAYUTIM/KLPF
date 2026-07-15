// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

(function() {
    'use strict';

    function normalizeText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function normalizeCourseName(value) {
        return normalizeText(value)
            .normalize('NFKC')
            .replace(/[･・]/g, '・')
            .replace(/\s+/g, '')
            .toLowerCase();
    }

    function parseCourseLabel(value) {
        const rawLabel = normalizeText(value);
        const courseCode = rawLabel.match(/^[A-Z]\d{7}/)?.[0] || '';
        const courseName = rawLabel
            .replace(/^[A-Z]\d{7}/, '')
            .replace(/（[^）]*）\s*$/, '')
            .replace(/\[[^\]]*\]|【[^】]*】/g, '')
            .trim();
        return {
            courseCode,
            courseName,
            normalizedName: normalizeCourseName(courseName),
        };
    }

    function parseRate(value) {
        const match = String(value || '').normalize('NFKC').match(/(\d+(?:\.\d+)?)\s*%/);
        if (!match) return null;
        const rate = Number(match[1]);
        return Number.isFinite(rate) ? Math.max(0, Math.min(100, rate)) : null;
    }

    function parseLastAttendanceDate(cells) {
        for (let index = cells.length - 1; index >= 3; index -= 1) {
            const mark = normalizeText(cells[index].querySelector('.syuketsuKbnMark')?.textContent);
            if (mark !== '〇') continue;
            const date = normalizeText(cells[index].querySelector('.jugyoDate')?.textContent);
            if (/^\d{2}\/\d{2}$/.test(date)) return date;
        }
        return '';
    }

    function formFields(form) {
        return Array.from(new FormData(form).entries())
            .filter(([name, value]) => typeof name === 'string' && typeof value === 'string');
    }

    function parseAttendanceForm(html, baseUrl) {
        const document = new DOMParser().parseFromString(html, 'text/html');
        const form = document.getElementById('funcForm');
        if (!(form instanceof HTMLFormElement)) {
            throw new Error('Ku-portの出席フォームが見つかりませんでした。');
        }

        const termSelect = document.getElementById('funcForm:kaikoNendoGakki_input');
        return {
            action: new URL(form.getAttribute('action') || baseUrl, baseUrl).href,
            fields: formFields(form),
            academicTerm: termSelect instanceof HTMLSelectElement
                ? normalizeText(termSelect.selectedOptions[0]?.textContent)
                : '',
        };
    }

    function parseMenuBootstrap(html, baseUrl) {
        const document = new DOMParser().parseFromString(html, 'text/html');
        const form = document.getElementById('menuForm');
        if (!(form instanceof HTMLFormElement)) {
            throw new Error('Ku-portのメニューフォームが見つかりませんでした。');
        }
        return {
            action: new URL(form.getAttribute('action') || baseUrl, baseUrl).href,
            fields: formFields(form),
        };
    }

    function parseAutoNavigationForm(html, baseUrl) {
        const document = new DOMParser().parseFromString(html, 'text/html');
        const form = Array.from(document.forms).find(candidate => {
            if (candidate.method.toLowerCase() !== 'post') return false;
            const editableFields = candidate.querySelectorAll(
                'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea'
            );
            return editableFields.length === 0;
        });
        if (!(form instanceof HTMLFormElement)) {
            throw new Error('Ku-portの自動遷移フォームが見つかりませんでした。');
        }
        return {
            action: new URL(form.getAttribute('action') || baseUrl, baseUrl).href,
            fields: formFields(form),
        };
    }

    function extractPartialHtml(html) {
        if (!html.includes('<partial-response')) return html;
        const xml = new DOMParser().parseFromString(html, 'application/xml');
        if (xml.querySelector('parsererror')) throw new Error('Ku-portのAjax応答を解析できませんでした。');
        return Array.from(xml.querySelectorAll('update'))
            .map(update => update.textContent || '')
            .join('\n');
    }

    function parseAttendanceRecords(html) {
        const source = extractPartialHtml(html);
        const document = new DOMParser().parseFromString(source, 'text/html');
        const records = new Map();

        for (const row of document.querySelectorAll('tbody tr')) {
            const cells = Array.from(row.cells || []);
            if (cells.length < 3) continue;

            const course = parseCourseLabel(cells[1].textContent);
            if (!course.normalizedName) continue;
            const schedule = normalizeText(cells[0].textContent).replace(/\s+/g, '');
            const record = {
                schedule,
                courseCode: course.courseCode,
                courseName: course.courseName,
                normalizedName: course.normalizedName,
                rate: parseRate(cells[2].textContent),
                lastAttendanceDate: parseLastAttendanceDate(cells),
            };
            records.set(`${schedule}|${course.normalizedName}`, record);
        }
        return Array.from(records.values());
    }

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.target !== 'attendance-parser') return false;
        try {
            const data = message.type === 'parse-attendance-form'
                ? parseAttendanceForm(message.html, message.baseUrl)
                : message.type === 'parse-menu-bootstrap'
                    ? parseMenuBootstrap(message.html, message.baseUrl)
                : message.type === 'parse-auto-navigation-form'
                    ? parseAutoNavigationForm(message.html, message.baseUrl)
                : message.type === 'parse-attendance-records'
                    ? parseAttendanceRecords(message.html)
                    : (() => { throw new Error('未対応の解析要求です。'); })();
            sendResponse({ success: true, data });
        } catch (error) {
            sendResponse({ success: false, error: error.message });
        }
        return false;
    });
})();
