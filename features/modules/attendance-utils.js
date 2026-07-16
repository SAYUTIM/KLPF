// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file KU-PORTの出席表を解析するための共通処理。
 *
 * KU-PORT上のcontent scriptとOffscreen Documentの両方から読み込まれるため、
 * ES Modulesにはせず、`globalThis.KLPFAttendanceUtils`として公開する。
 */

(function initializeAttendanceUtils(globalScope) {
    'use strict';

    const COURSE_CODE_PATTERN = /^[A-Z]\d{7}/;
    const ATTENDANCE_MARK = '〇';
    const ATTENDANCE_DATE_PATTERN = /^\d{2}\/\d{2}$/;
    const MINIMUM_ATTENDANCE_COLUMNS = 3;

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
        const courseCode = rawLabel.match(COURSE_CODE_PATTERN)?.[0] || '';
        const courseName = rawLabel
            .replace(COURSE_CODE_PATTERN, '')
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
        for (let index = cells.length - 1; index >= MINIMUM_ATTENDANCE_COLUMNS; index -= 1) {
            const mark = normalizeText(cells[index].querySelector('.syuketsuKbnMark')?.textContent);
            if (mark !== ATTENDANCE_MARK) continue;

            const date = normalizeText(cells[index].querySelector('.jugyoDate')?.textContent);
            if (ATTENDANCE_DATE_PATTERN.test(date)) return date;
        }
        return '';
    }

    function createAttendanceRecord(row) {
        const cells = Array.from(row.cells || []);
        if (cells.length < MINIMUM_ATTENDANCE_COLUMNS) return null;

        const course = parseCourseLabel(cells[1].textContent);
        if (!course.normalizedName) return null;

        const schedule = normalizeText(cells[0].textContent).replace(/\s+/g, '');
        return {
            schedule,
            courseCode: course.courseCode,
            courseName: course.courseName,
            normalizedName: course.normalizedName,
            rate: parseRate(cells[2].textContent),
            lastAttendanceDate: parseLastAttendanceDate(cells),
        };
    }

    function parseAttendanceRecords(container) {
        const records = new Map();
        for (const row of container.querySelectorAll('tbody tr')) {
            const record = createAttendanceRecord(row);
            if (!record) continue;
            records.set(`${record.schedule}|${record.normalizedName}`, record);
        }
        return Array.from(records.values());
    }

    globalScope.KLPFAttendanceUtils = Object.freeze({
        normalizeText,
        normalizeCourseName,
        parseAttendanceRecords,
    });
})(globalThis);
