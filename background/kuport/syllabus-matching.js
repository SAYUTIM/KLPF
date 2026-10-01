// Copyright (c) 2024-2026 SAYU
// MIT License; see LICENSE.

/**
 * @file 授業カードとKu-Port時間割の学期・科目を照合する純粋関数を提供する。
 * 前期・後期・通年を学期候補へ変換し、科目名、曜日・時限、教員名の順に対象ボタンを絞る。
 * DOM、通信、保存状態にはアクセスせず、呼び出し元が読み取った値を受け取る。
 */

/**
 * 学期の比較用に全角・空白・大文字の表記をそろえる。
 * @param {*} value - 検証・変換する入力値。
 * @returns {string} 照合用に整えた文字列。
 */
function normalizeSyllabusTermText(value) {
    return String(value || '').normalize('NFKC').replace(/[\s\u3000]+/g, '').toLowerCase();
}

/**
 * 学期選択肢の値または表示名から1〜4Qの番号を取り出す。
 * @param {object} option - 年度学期の選択肢の値と表示名。
 * @returns {string} クォーター番号の文字列。判定できなければ空文字列。
 */
function getSyllabusOptionQuarter(option) {
    return String(option?.value || '').match(/(?:^|\|)0?([1-4])$/)?.[1]
        || normalizeSyllabusTermText(option?.label).match(/([1-4])q/)?.[1]
        || '';
}

/**
 * 授業カードの学期表記に対応するKu-Portの選択肢を重複なく列挙する。
 * @param {object} course - 授業カードから読み取った科目・年度学期・曜日時限・教員情報。
 * @param {Array<{value: string, label: string}>} options - Ku-Portから解析した学期選択肢。値と表示名を渡す。
 * @returns {object[]} 試す順に並べた重複のない学期選択肢。
 */
export function getSyllabusTermCandidates(course, options) {
    const termText = normalizeSyllabusTermText(course?.termText);
    const optionList = (Array.isArray(options) ? options : [])
        .filter(option => String(option?.value || '').trim() !== '');
    const quarter = termText.match(/([1-4])q/)?.[1] || '';
    let candidates = [];
    if (quarter) {
        candidates = optionList.filter(option => getSyllabusOptionQuarter(option) === quarter);
    } else if (termText.includes('前期') || termText.includes('春学期')) {
        candidates = optionList.filter(option => ['1', '2'].includes(getSyllabusOptionQuarter(option))
            || /前期|春学期/.test(normalizeSyllabusTermText(option.label)));
    } else if (termText.includes('後期') || termText.includes('秋学期')) {
        candidates = optionList.filter(option => ['3', '4'].includes(getSyllabusOptionQuarter(option))
            || /後期|秋学期/.test(normalizeSyllabusTermText(option.label)));
    } else if (termText.includes('通年') || termText.includes('年間')) {
        candidates = optionList.filter(option => ['1', '2', '3', '4'].includes(getSyllabusOptionQuarter(option))
            || /通年|年間|全期|全学期/.test(normalizeSyllabusTermText(option.label)));
    }
    if (candidates.length === 0 && optionList.length === 1) candidates = optionList;
    return Array.from(new Map(candidates.map(option => [String(option.value), option])).values());
}

/**
 * 科目名や教員名の照合用に全角・空白・括弧の表記をそろえる。
 * @param {*} value - 検証・変換する入力値。
 * @returns {string} 照合用に整えた文字列。
 */
function normalizeSyllabusMatch(value) {
    return String(value || '').normalize('NFKC')
        .replace(/[\s\u3000]+/g, '')
        .replace(/[「」『』【】［］\[\]（）()]/g, '')
        .toLowerCase();
}

/**
 * 文字列から日〜土曜日を取り出し、曜日名の表記をそろえる。
 * @param {*} value - 検証・変換する入力値。
 * @returns {string} 照合用に整えた文字列。
 */
function normalizeSyllabusDay(value) {
    const match = String(value || '').normalize('NFKC').match(/[月火水木金土日](?:曜日|曜)?/);
    return match ? `${match[0].charAt(0)}曜日` : '';
}

/**
 * 文字列から時限番号を取り出す。
 * @param {*} value - 検証・変換する入力値。
 * @returns {string} 照合用に整えた文字列。
 */
function normalizeSyllabusPeriod(value) {
    const match = String(value || '').normalize('NFKC')
        .match(/(?:^|[^0-9])([1-9]|1[0-5])\s*(?:限|時限)?(?:$|[^0-9])/);
    return match?.[1] || '';
}

/**
 * 科目名、曜日・時限、教員名の順に候補を絞り、対象のシラバスボタンを選ぶ。
 * @param {object} course - 授業カードから読み取った科目・年度学期・曜日時限・教員情報。
 * @param {object[]} buttons - 科目照合の候補となる解析済みシラバスボタン。
 * @returns {object|null} 一致するボタン情報。候補なしはnull、曖昧な場合はerrorを持つオブジェクト。
 */
export function findSyllabusCourseButton(course, buttons) {
    const targetName = normalizeSyllabusMatch(course?.courseName);
    if (!targetName) return { error: '授業名を確認できませんでした。' };
    let matches = (Array.isArray(buttons) ? buttons : []).filter(button => {
        const name = normalizeSyllabusMatch(button.courseName);
        const text = normalizeSyllabusMatch(button.text);
        return name === targetName || name.includes(targetName) || text.includes(targetName);
    });
    // 同名科目が時間割に複数ある場合は、まずLMSカードの曜日と時限が
    // 一致する枠だけを候補に残す。時間割側の値を取得できなかった候補は、
    // 誤ったシラバスを開く可能性があるため一致扱いにしない。
    const targetDay = normalizeSyllabusDay(course?.dayText);
    if (targetDay) {
        matches = matches.filter(button => normalizeSyllabusDay(button.dayText) === targetDay);
    }
    const targetPeriod = normalizeSyllabusPeriod(course?.period);
    if (targetPeriod) {
        matches = matches.filter(button => normalizeSyllabusPeriod(button.period) === targetPeriod);
    }

    // 曜日・時限で候補を絞った後、最後に教員名を照合する。
    // 教員名が一致しない候補へはフォールバックしない。
    const instructor = normalizeSyllabusMatch(course?.instructor);
    if (instructor) {
        matches = matches.filter(button =>
            normalizeSyllabusMatch(button.text).includes(instructor));
    }
    if (matches.length === 0) return null;
    if (matches.length > 1) {
        const codes = matches.map(button => button.courseCode).filter(Boolean);
        if (codes.length === matches.length && new Set(codes).size === 1) return matches[0];
        return { error: '同じ授業名の候補が複数あり、対象を一意にできませんでした。' };
    }
    return matches[0];
}

/**
 * 取得済み時間割の年度・学期が要求された選択肢に合っているか判定する。
 * @param {object} timetable - 解析済みの時間割、選択年度学期、送信情報。
 * @param {string} year - 照合対象の年度。
 * @param {object} option - 年度学期の選択肢の値と表示名。
 * @returns {boolean} 条件を満たす場合はtrue。
 */
export function isSyllabusTermSelected(timetable, year, option) {
    const selectedYear = normalizeSyllabusMatch(timetable?.selectedYear);
    const selectedTerm = String(timetable?.selectedTermValue || '').trim();
    const requestedYear = normalizeSyllabusMatch(year);
    const requestedTerm = String(option?.value || '').trim();
    if (!selectedYear || selectedYear !== requestedYear || !selectedTerm) return false;
    if (selectedTerm === requestedTerm) return true;
    const selectedQuarter = selectedTerm.match(/(?:^|\|)0?([1-4])$/)?.[1] || '';
    return !!selectedQuarter && getSyllabusOptionQuarter(option) === selectedQuarter;
}
