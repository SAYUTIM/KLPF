// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/** @file Manifestと動的content script設定の互換契約を検証する。 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { CONTENT_SCRIPTS_CONFIG, GAS_SETUP_CONFIG } from '../scripts.config.js';

const projectRoot = path.resolve(import.meta.dirname, '..');

async function readJson(relativePath) {
    return JSON.parse(await readFile(path.join(projectRoot, relativePath), 'utf8'));
}

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
    assert.equal(manifest.version, '4.4.2');
    assert.equal(packageJson.version, manifest.version);
    assert.equal(manifest.manifest_version, 3);
});

test('permissions and remote origins remain on the reviewed compatibility contract', async () => {
    const manifest = await readJson('manifest.json');
    assert.deepEqual(manifest.permissions, [
        'tabs',
        'storage',
        'scripting',
        'offscreen',
        'contextMenus',
    ]);
    assert.deepEqual(manifest.host_permissions, [
        'https://study.ns.kogakuin.ac.jp/*',
        'https://ku-port.sc.kogakuin.ac.jp/*',
        'https://auth.kogakuin.ac.jp/*',
        'https://meet.google.com/*',
        'https://script.google.com/*',
        'https://slink.secioss.com/*',
    ]);
    assert.deepEqual(manifest.optional_host_permissions, ['https://*/*']);
});

test('dynamic content script ids and storage keys are unique', () => {
    const ids = CONTENT_SCRIPTS_CONFIG.map(config => config.id);
    const storageKeys = CONTENT_SCRIPTS_CONFIG.map(config => config.storageKey);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(new Set(storageKeys).size, storageKeys.length);
});

test('dynamic feature ids, storage keys and defaults remain backward compatible', () => {
    const contract = CONTENT_SCRIPTS_CONFIG.map(config => ({
        id: config.id,
        storageKey: config.storageKey,
        enabledByDefault: Boolean(config.enabledByDefault),
    }));
    assert.deepEqual(contract, [
        { id: 'AutoLoginScript', storageKey: 'autoLogin', enabledByDefault: true },
        { id: 'TimeDisplayScript', storageKey: 'showTime', enabledByDefault: false },
        { id: 'AutoAttendScript', storageKey: 'autoAttend', enabledByDefault: false },
        { id: 'MeetJoinScript', storageKey: 'autoMeet', enabledByDefault: true },
        { id: 'KuPortDialogCloseScript', storageKey: 'kuportDialogOutsideClose', enabledByDefault: true },
        { id: 'SearchSubject', storageKey: 'searchSubject', enabledByDefault: true },
        { id: 'DarkMode', storageKey: 'darkMode', enabledByDefault: false },
        { id: 'Homework', storageKey: 'homework', enabledByDefault: true },
        { id: 'HomeAttendanceBadge', storageKey: 'homeAttendanceBadge', enabledByDefault: true },
        { id: 'AttendanceRateDisplay', storageKey: 'attendanceRateDisplay', enabledByDefault: false },
        { id: 'logoutblock', storageKey: 'logoutblock', enabledByDefault: true },
        { id: 'kyozaiopen', storageKey: 'kyozaiopen', enabledByDefault: true },
    ]);
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
