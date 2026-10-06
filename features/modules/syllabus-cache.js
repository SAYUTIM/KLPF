// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file シラバスキャッシュのキー・有効期限・保存形式を共有する。
 * 表示側は読み取り、Service Workerは保存を担当し、複数のLMSタブによる上書きを防ぐ。
 * classic scriptとService Workerの副作用importから同じ実装を利用する。
 */
(() => {
    if (globalThis.KLPFSyllabusCache) return;
    const key = 'klpf-syllabus-cache';
    const version = 1;
    const maxAgeMs = 30 * 24 * 60 * 60 * 1000;
    const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

    /**
     * 年度・科目・教員・曜日時限・学期からキャッシュキーを作る。
     * @param {object} course - LMSカードから読み取った授業情報。
     * @returns {string} 同じ授業を識別するキー。
     */
    function courseKey(course) {
        return JSON.stringify(['academicYear', 'courseName', 'instructor', 'dayText', 'period', 'termText', 'courseInfoText']
            .map(field => normalize(course?.[field])));
    }

    /**
     * 保存項目が有効な形式で、取得から30日以内か判定する。
     * @param {object} entry - キャッシュの1項目。
     * @param {number} [now] - 現在時刻（ミリ秒）。
     * @returns {boolean} 有効ならtrue。
     */
    function isFresh(entry, now = Date.now()) {
        const fetchedAt = Number(entry?.fetchedAt);
        return Number.isFinite(fetchedAt) && fetchedAt > 0 && fetchedAt <= now
            && now - fetchedAt <= maxAgeMs && !!entry.result && typeof entry.result === 'object';
    }

    /**
     * 授業に対応する有効な保存項目を取得する。
     * @param {object} course - 対象の授業情報。
     * @returns {Promise<object|null>} 保存項目。未保存・期限切れならnull。
     */
    async function get(course) {
        const cache = (await chrome.storage.local.get(key))[key];
        const entry = cache?.version === version ? cache.entries?.[courseKey(course)] : null;
        return isFresh(entry) ? entry : null;
    }

    /**
     * Workerのジョブ操作内で取得結果を保存し、期限切れと80件を超える項目を除く。
     * @param {object} course - 対象の授業情報。
     * @param {object} result - 解析したタイトル・本文・項目行。
     * @param {number} [fetchedAt] - 取得時刻（ミリ秒）。
     * @returns {Promise<void>} 保存の完了。
     */
    async function save(course, result, fetchedAt = Date.now()) {
        const cache = (await chrome.storage.local.get(key))[key];
        const entries = cache?.version === version && cache.entries && typeof cache.entries === 'object'
            ? { ...cache.entries } : {};
        entries[courseKey(course)] = {
            fetchedAt,
            course: Object.fromEntries(['academicYear', 'courseName', 'instructor'].map(field => [field, String(course?.[field] || '')])),
            result: {
                title: String(result?.title || 'シラバス照会'),
                text: String(result?.text || '').slice(0, 60000),
                rows: Array.isArray(result?.rows) ? result.rows : [],
            },
        };
        await chrome.storage.local.set({ [key]: {
            version,
            entries: Object.fromEntries(Object.entries(entries).filter(([, entry]) => isFresh(entry))
                .sort(([, left], [, right]) => Number(right.fetchedAt) - Number(left.fetchedAt)).slice(0, 80)),
        } });
    }
    globalThis.KLPFSyllabusCache = { get, save };
})();
