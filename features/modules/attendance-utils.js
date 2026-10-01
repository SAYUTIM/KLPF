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

    /**
     * 文字列へ変換し、連続する空白を1つにまとめて前後の空白を除く。
     * @param {*} value - 検証・変換する入力値。
     * @returns {string} 照合用に整えた文字列。
     */
    function normalizeText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    /**
     * 科目名の表記を出席記録との照合用にそろえる。
     * @param {*} value - 検証・変換する入力値。
     * @returns {string} 照合用に整えた文字列。
     */
    function normalizeCourseName(value) {
        return normalizeText(value)
            .normalize('NFKC')
            .replace(/[･・]/g, '・')
            .replace(/\s+/g, '')
            .toLowerCase();
    }

    /**
     * 学期の値と表示名から年度・クォーターを解析する。
     * @param {*} value - 検証・変換する入力値。
     * @param {string} [label=""] - 値の検索または読み上げに使うラベル。
     * @returns {object} 年度・クォーター・学期の値と表示名。
     */
    function parseAcademicTerm(value, label = '') {
        const normalizedValue = normalizeText(value).normalize('NFKC');
        const normalizedLabel = normalizeText(label).normalize('NFKC');
        const valueMatch = normalizedValue.match(/^(\d{4})\|0?([1-4])$/);
        const yearMatch = normalizedValue.match(/^(\d{4})$/)
            || normalizedLabel.match(/(\d{4})\s*年度?/);
        const quarterMatch = normalizedLabel.match(/([1-4])\s*Q/i)
            || normalizedLabel.match(/Q\s*([1-4])/i);

        return {
            academicYear: valueMatch?.[1] || yearMatch?.[1] || '',
            quarter: valueMatch ? Number(valueMatch[2]) : quarterMatch ? Number(quarterMatch[1]) : null,
            termValue: normalizedValue,
            academicTerm: normalizedLabel,
        };
    }

    /**
     * 出席表の科目欄から科目名とコードを取り出す。
     * @param {*} value - 検証・変換する入力値。
     * @returns {object} 科目コード・科目名・照合用科目名。
     */
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

    /**
     * 出席率の文字列を数値へ変換する。
     * @param {*} value - 検証・変換する入力値。
     * @returns {number|null} 0〜100の出席率。読み取れなければnull。
     */
    function parseRate(value) {
        const match = String(value || '').normalize('NFKC').match(/(\d+(?:\.\d+)?)\s*%/);
        if (!match) return null;

        const rate = Number(match[1]);
        return Number.isFinite(rate) ? Math.max(0, Math.min(100, rate)) : null;
    }

    /**
     * 出席表のセルから最終出席日を読み取る。
     * @param {Element[]} cells - 解析対象の表のセル一覧。
     * @returns {string} 最終出席日のMM/DD表記。なければ空文字列。
     */
    function parseLastAttendanceDate(cells) {
        for (let index = cells.length - 1; index >= MINIMUM_ATTENDANCE_COLUMNS; index -= 1) {
            const mark = normalizeText(cells[index].querySelector('.syuketsuKbnMark')?.textContent);
            if (mark !== ATTENDANCE_MARK) continue;

            const date = normalizeText(cells[index].querySelector('.jugyoDate')?.textContent);
            if (ATTENDANCE_DATE_PATTERN.test(date)) return date;
        }
        return '';
    }

    /**
     * 出席表の1行を科目・時限・出席率などの記録へ変換する。
     * @param {Element} row - 解析対象の表の行。
     * @param {boolean} [includeSessionCount=false] - 授業回数も出席記録へ含めるかどうか。
     * @returns {object|null} 有効な出席記録。必要なセルや科目名がなければnull。
     */
    function createAttendanceRecord(row, includeSessionCount = false) {
        const cells = Array.from(row.cells || []);
        if (cells.length < MINIMUM_ATTENDANCE_COLUMNS) return null;

        const course = parseCourseLabel(cells[1].textContent);
        if (!course.normalizedName) return null;

        const schedule = normalizeText(cells[0].textContent).replace(/\s+/g, '');
        const record = {
            schedule,
            courseCode: course.courseCode,
            courseName: course.courseName,
            normalizedName: course.normalizedName,
            rate: parseRate(cells[2].textContent),
            lastAttendanceDate: parseLastAttendanceDate(cells),
        };
        if (includeSessionCount) {
            record.lessonCount = cells.slice(MINIMUM_ATTENDANCE_COLUMNS).filter(cell => {
                const date = normalizeText(cell.querySelector('.jugyoDate')?.textContent);
                const mark = normalizeText(cell.querySelector('.syuketsuKbnMark')?.textContent)
                    .normalize('NFKC');
                return ATTENDANCE_DATE_PATTERN.test(date) && mark !== '*';
            }).length;
        }
        return record;
    }

    /**
     * 出席表の各行を解析し、有効な出席記録の配列へまとめる。
     * @param {Element} container - 対象の表や一覧を含む要素。
     * @param {object} [options={}] - 出席表の解析条件。
     * @param {boolean} [options.includeSessionCount=false] - 授業回数を記録に含めるかどうか。
     * @returns {object[]} 時間割と科目名ごとに重複をまとめた出席記録。
     */
    function parseAttendanceRecords(container, options = {}) {
        const records = new Map();
        for (const row of container.querySelectorAll('tbody tr')) {
            const record = createAttendanceRecord(row, options.includeSessionCount === true);
            if (!record) continue;
            records.set(`${record.schedule}|${record.normalizedName}`, record);
        }
        return Array.from(records.values());
    }

    globalScope.KLPFAttendanceUtils = Object.freeze({
        normalizeText,
        normalizeCourseName,
        parseAcademicTerm,
        parseAttendanceRecords,
    });
})(globalThis);
