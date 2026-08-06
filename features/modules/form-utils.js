// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file content scriptとOffscreen Documentで共有するフォーム直列化処理。
 * File値を外部送信へ混ぜず、文字列フィールドだけを既存の順序で返す。
 */

(function initializeFormUtils(globalScope) {
    'use strict';

    function serializeFormEntries(form) {
        return Array.from(new FormData(form).entries())
            .filter(([name, value]) => typeof name === 'string' && typeof value === 'string');
    }

    function serializeFormObject(form) {
        const fields = {};
        for (const [name, value] of new FormData(form).entries()) {
            fields[name] = typeof value === 'string' ? value : '';
        }
        return fields;
    }

    function resolveFormAction(form, baseUrl) {
        return new URL(form.getAttribute('action') || baseUrl, baseUrl).href;
    }

    globalScope.KLPFFormUtils = Object.freeze({
        serializeFormEntries,
        serializeFormObject,
        resolveFormAction,
    });
})(globalThis);
