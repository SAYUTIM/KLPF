// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file content scriptとOffscreen Documentで共有するフォーム直列化処理。
 * FormDataで読み取った値を文字列の組またはオブジェクトへ変換し、File値を送信データへ混ぜない。
 * フォームの送信先は基準URLから解決する。classic scriptとしてKLPFFormUtilsへ公開する。
 */

(function initializeFormUtils(globalScope) {
    'use strict';

    /**
     * フォームを同名フィールドの順序を保った文字列の名前・値の組へ変換する。
     * @param {HTMLFormElement} form - 読み取りまたは送信の対象フォーム。
     * @returns {Array<Array<string>>} 文字列の名前・値の組。同名フィールドも順序を維持する。
     */
    function serializeFormEntries(form) {
        return Array.from(new FormData(form).entries())
            .filter(([name, value]) => typeof name === 'string' && typeof value === 'string');
    }

    /**
     * フォームを名前をキーとするオブジェクトへ変換する。同名の値は後の値で置き換える。
     * @param {HTMLFormElement} form - 読み取りまたは送信の対象フォーム。
     * @returns {Object<string, string>} フィールド名をキーにした文字列値のオブジェクト。
     */
    function serializeFormObject(form) {
        const fields = {};
        for (const [name, value] of new FormData(form).entries()) {
            fields[name] = typeof value === 'string' ? value : '';
        }
        return fields;
    }

    /**
     * フォームの相対送信先を基準URLから絶対URLへ解決する。
     * @param {HTMLFormElement} form - 読み取りまたは送信の対象フォーム。
     * @param {string} baseUrl - 相対URLを解決するための応答元URL。
     * @returns {string} フォームの絶対送信先URL。
     */
    function resolveFormAction(form, baseUrl) {
        return new URL(form.getAttribute('action') || baseUrl, baseUrl).href;
    }

    globalScope.KLPFFormUtils = Object.freeze({
        serializeFormEntries,
        serializeFormObject,
        resolveFormAction,
    });
})(globalThis);
