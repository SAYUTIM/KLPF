// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file Ku-PortのJSF通信に使う文字列フィールドをURLSearchParamsへ変換する。
 * 同名フィールドの順序を維持し、文字列以外を送信本文へ混ぜない。
 */

/**
 * 文字列の名前・値の組を同名フィールドの順序を保ったPOST本文へ変換する。
 * @param {Array<Array<string>>} fields - 名前と文字列値の組。FormData.entries()から文字列だけを取り出して渡す。
 * @returns {URLSearchParams} 文字列フィールドを順序通りに含む送信本文。
 */
export function createFormBody(fields) {
    const body = new URLSearchParams();
    for (const [name, value] of fields || []) {
        if (typeof name === 'string' && typeof value === 'string') body.append(name, value);
    }
    return body;
}
