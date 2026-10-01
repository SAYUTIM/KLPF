// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 設定バックアップJSONの互換契約を定義する純粋関数群。
 * DOMやChrome APIから分離し、既存バックアップを将来も読み込めることをテスト可能にする。
 */

export const EXPORT_APP_NAME = 'KLPF';
export const EXPORT_SCHEMA_VERSION = 1;

/**
 * 値がnullや配列ではないオブジェクトか判定する。
 * @param {*} value - 検証・変換する入力値。
 * @returns {boolean} 条件を満たす場合はtrue。
 */
export function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * sync/localの保存内容を既存schemaVersion 1の形式へまとめる。
 */
export function createExportPayload(syncData, localData, exportedAt = new Date()) {
    return {
        app: EXPORT_APP_NAME,
        schemaVersion: EXPORT_SCHEMA_VERSION,
        exportedAt: exportedAt.toISOString(),
        sync: syncData,
        local: localData,
    };
}

/**
 * インポート前にバックアップの識別子と必須領域を検証する。
 * @throws {Error} 既存のKLPFバックアップ形式でない場合。
 */
export function validateImportPayload(payload) {
    if (!isPlainObject(payload)) throw new Error('JSONの形式が不正です。');
    if (payload.app !== EXPORT_APP_NAME) {
        throw new Error('KLPF用のバックアップファイルではありません。');
    }
    if (payload.schemaVersion !== EXPORT_SCHEMA_VERSION) {
        throw new Error('対応していないバックアップ形式です。');
    }
    if (!isPlainObject(payload.sync) || !isPlainObject(payload.local)) {
        throw new Error('バックアップファイルに必要なデータが不足しています。');
    }
    return payload;
}
