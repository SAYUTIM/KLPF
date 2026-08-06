// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/** @file 動的content script登録の差分更新と既定値をChrome APIモックで検証する。 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { CONTENT_SCRIPTS_CONFIG } from '../scripts.config.js';
import { SETTINGS_CONFIG, getSettingsStorageKeys } from '../setting/modules/settings.js';

function createChromeMock(initialRegistrations = []) {
    const registrations = new Map(initialRegistrations.map(item => [item.id, item]));
    const calls = { registered: [], unregistered: [] };
    return {
        calls,
        api: {
            runtime: { lastError: null },
            scripting: {
                async getRegisteredContentScripts({ ids }) {
                    return ids.map(id => registrations.get(id)).filter(Boolean);
                },
                async unregisterContentScripts({ ids }) {
                    ids.forEach((id) => registrations.delete(id));
                    calls.unregistered.push(...ids);
                },
                async registerContentScripts(items) {
                    items.forEach((item) => registrations.set(item.id, item));
                    calls.registered.push(...items);
                },
            },
            storage: {
                local: {
                    async get() { return {}; },
                    async set() {},
                },
                sync: {
                    async get() { return {}; },
                    async set() {},
                },
            },
        },
    };
}

test('unchanged content script registration does not call mutation APIs', async () => {
    const config = CONTENT_SCRIPTS_CONFIG[0];
    const current = {
        id: config.id,
        js: config.js,
        matches: config.matches,
        runAt: config.runAt,
    };
    const mock = createChromeMock([current]);
    globalThis.chrome = mock.api;
    const { registerContentScript } = await import('../background/modules/content-scripts.js');
    await registerContentScript(config);
    assert.deepEqual(mock.calls, { registered: [], unregistered: [] });
});

test('changed registration is replaced exactly once', async () => {
    const config = CONTENT_SCRIPTS_CONFIG[1];
    const mock = createChromeMock([{
        id: config.id,
        js: ['features/old.js'],
        matches: config.matches,
        runAt: config.runAt,
    }]);
    globalThis.chrome = mock.api;
    const { registerContentScript } = await import('../background/modules/content-scripts.js');
    await registerContentScript(config);
    assert.deepEqual(mock.calls.unregistered, [config.id]);
    assert.equal(mock.calls.registered.length, 1);
    assert.deepEqual(mock.calls.registered[0].js, config.js);
});

test('every dynamic feature setting remains represented by the options contract', async () => {
    const storageKeys = getSettingsStorageKeys();
    const settingKeys = new Set(SETTINGS_CONFIG.map(config => config.key));
    for (const config of CONTENT_SCRIPTS_CONFIG) {
        assert.ok(settingKeys.has(config.storageKey), `${config.storageKey} is missing from settings`);
        assert.ok(storageKeys.sync.has(config.storageKey));
    }

    const optionsHtml = await readFile(
        new URL('../setting/options.html', import.meta.url),
        'utf8',
    );
    const dom = new JSDOM(optionsHtml);
    for (const config of SETTINGS_CONFIG) {
        assert.ok(
            dom.window.document.getElementById(config.id),
            `#${config.id} is missing from setting/options.html`,
        );
    }
});
