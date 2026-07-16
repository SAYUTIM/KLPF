// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 拡張機能とGitHub Releaseのバージョン比較に使う共通処理。
 */

export function parseVersionParts(value) {
    const normalized = String(value || '').trim().replace(/^v/i, '');
    return normalized.split(/[.-]/).slice(0, 3).map((part) => {
        const numericPart = Number.parseInt(part, 10);
        return Number.isFinite(numericPart) ? numericPart : 0;
    });
}

export function isVersionNewer(candidateVersion, currentVersion) {
    const candidateParts = parseVersionParts(candidateVersion);
    const currentParts = parseVersionParts(currentVersion);
    const partCount = Math.max(candidateParts.length, currentParts.length, 3);

    for (let index = 0; index < partCount; index += 1) {
        const candidatePart = candidateParts[index] || 0;
        const currentPart = currentParts[index] || 0;
        if (candidatePart !== currentPart) return candidatePart > currentPart;
    }
    return false;
}
