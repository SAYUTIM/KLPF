// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/** @file Manifestと注入設定のバージョン整合性、重複、参照先、読み込み順を検証する。 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { CONTENT_SCRIPTS_CONFIG, GAS_SETUP_CONFIG } from '../scripts.config.js';

const projectRoot = path.resolve(import.meta.dirname, '..');

/**
 * プロジェクト内のJSONファイルを読み取り、解析する。
 * @param {string} relativePath - プロジェクトルートからの相対パス。
 * @returns {Promise<object>} JSONを解析した値。
 */
async function readJson(relativePath) {
    return JSON.parse(await readFile(path.join(projectRoot, relativePath), 'utf8'));
}

/**
 * 宣言されたリソースが実際に存在することを検査する。
 * @param {string[]} paths - 存在を確認するリソースのパス一覧。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
async function assertFilesExist(paths) {
    for (const relativePath of paths) {
        const content = await readFile(path.join(projectRoot, relativePath));
        assert.ok(content.length > 0, `${relativePath} should exist and not be empty`);
    }
}

test('manifest and package versions stay aligned', async () => {
    const [manifest, packageJson] = await Promise.all([
        readJson('manifest.json'),
        readJson('package.json'),
    ]);
    assert.equal(packageJson.version, manifest.version);
    assert.equal(manifest.manifest_version, 3);
});

test('dynamic content script ids and storage keys are unique', () => {
    const ids = CONTENT_SCRIPTS_CONFIG.map(config => config.id);
    const storageKeys = CONTENT_SCRIPTS_CONFIG.map(config => config.storageKey);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(new Set(storageKeys).size, storageKeys.length);
});

test('all manifest and script configuration resources exist', async () => {
    const manifest = await readJson('manifest.json');
    const configuredResources = CONTENT_SCRIPTS_CONFIG.flatMap(config => [
        ...config.js,
        ...(config.css || []),
    ]);
    const staticResources = manifest.content_scripts.flatMap(config => [
        ...config.js,
        ...(config.css || []),
    ]);
    const publicResources = manifest.web_accessible_resources.flatMap(config => config.resources);
    await assertFilesExist([
        manifest.background.service_worker,
        manifest.options_page,
        ...configuredResources,
        ...staticResources,
        ...publicResources,
        ...GAS_SETUP_CONFIG.js,
    ]);
});

test('shared classic modules are loaded before their feature entry point', () => {
    for (const config of CONTENT_SCRIPTS_CONFIG) {
        const moduleIndexes = config.js
            .map((file, index) => ({ file, index }))
            .filter(({ file }) => file.includes('/modules/'));
        const featureIndexes = config.js
            .map((file, index) => ({ file, index }))
            .filter(({ file }) => file.startsWith('features/') && !file.includes('/modules/'));
        if (moduleIndexes.length === 0 || featureIndexes.length === 0) continue;
        assert.ok(
            Math.max(...moduleIndexes.map(item => item.index))
                < Math.min(...featureIndexes.map(item => item.index)),
            `${config.id} must load shared modules before feature scripts`,
        );
    }
});
