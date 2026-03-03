// Copyright (c) 2024-2025 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file TOTP (Time-based One-Time Password) 生成モジュール
 * RFC 6238 準拠の実装
 */

function base32Decode(encoded) {
    const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const cleaned = encoded.replace(/[\s=\-]+/g, '').toUpperCase();
    if (!cleaned) return null;

    const len = cleaned.length;
    const out = new Uint8Array(((len * 5) / 8) | 0);
    let bits = 0;
    let value = 0;
    let index = 0;

    for (let i = 0; i < len; i++) {
        const val = ALPHABET.indexOf(cleaned[i]);
        if (val === -1) return null;
        
        value = (value << 5) | val;
        bits += 5;

        if (bits >= 8) {
            out[index++] = (value >>> (bits - 8)) & 0xff;
            bits -= 8;
        }
    }
    return out;
}

/**
 * TOTPコードを生成する。
 * @param {string} secret - Base32秘密鍵
 * @param {Object} options - オプション (period, digits, algorithm)
 */
async function generateTOTP(secret, { period = 30, digits = 6, algorithm = 'SHA-1' } = {}) {
    try {
        const keyBytes = base32Decode(secret);
        if (!keyBytes || keyBytes.length === 0) return null;

        const epoch = Math.floor(Date.now() / 1000);
        const timeStep = Math.floor(epoch / period);

        // BigIntを使用して8バイトのバッファを作成
        const timeBuffer = new ArrayBuffer(8);
        new DataView(timeBuffer).setBigUint64(0, BigInt(timeStep), false);

        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            keyBytes,
            { name: 'HMAC', hash: { name: algorithm } },
            false,
            ['sign']
        );

        const hmacResult = await crypto.subtle.sign('HMAC', cryptoKey, timeBuffer);
        const hmacBytes = new Uint8Array(hmacResult);

        // 動的切り捨て
        const offset = hmacBytes[hmacBytes.length - 1] & 0x0f;
        const binary =
            ((hmacBytes[offset] & 0x7f) << 24) |
            ((hmacBytes[offset + 1] & 0xff) << 16) |
            ((hmacBytes[offset + 2] & 0xff) << 8) |
            (hmacBytes[offset + 3] & 0xff);

        return (binary % Math.pow(10, digits)).toString().padStart(digits, '0');
    } catch (e) {
        console.error("[KLPF] TOTP生成失敗:", e);
        return null;
    }
}
