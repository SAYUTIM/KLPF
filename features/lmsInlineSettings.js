// Copyright (c) 2024-2025 SAYU
// This software is released under the MIT License, see LICENSE.

(() => {
    'use strict';

    const MENU_ITEM_ID = 'klpf-inline-settings-menu-item';
    const ROOT_ID = 'klpf-inline-settings-root';
    const ALL_DISABLED_KEY = 'klpfInlineAllFeaturesDisabled';
    const PREVIOUS_SETTINGS_KEY = 'klpfInlinePreviousFeatureSettings';

    let features = [];
    let featureKeys = [];

    let rootElement = null;
    let shadowRoot = null;
    let isOpen = false;
    let hasPendingReloadPrompt = false;
    let isReloadPromptOpen = false;
    let state = {
        settings: {},
        allDisabled: false,
    };

    async function loadFeatureDefinitions() {
        const response = await chrome.runtime.sendMessage({ type: 'get-inline-settings-features' });
        if (!response?.success || !Array.isArray(response.features)) {
            throw new Error('機能定義を取得できませんでした。');
        }

        features = response.features;
        featureKeys = features.map((feature) => feature.key);
    }

    function storageGet(area, keys) {
        return chrome.storage[area].get(keys);
    }

    function storageSet(area, values) {
        return chrome.storage[area].set(values);
    }

    function getFeatureValue(settings, feature) {
        return typeof settings[feature.key] === 'boolean' ? settings[feature.key] : feature.defaultValue;
    }

    function getCurrentFeatureSettings() {
        return features.reduce((values, feature) => {
            values[feature.key] = getFeatureValue(state.settings, feature);
            return values;
        }, {});
    }

    async function loadState() {
        if (features.length === 0) {
            await loadFeatureDefinitions();
        }

        const [syncSettings, localSettings] = await Promise.all([
            storageGet('sync', featureKeys),
            storageGet('local', [ALL_DISABLED_KEY]),
        ]);

        state = {
            settings: syncSettings,
            allDisabled: !!localSettings[ALL_DISABLED_KEY],
        };
    }

    function ensureRoot() {
        if (rootElement && shadowRoot) return;

        rootElement = document.getElementById(ROOT_ID);
        if (!rootElement) {
            rootElement = document.createElement('div');
            rootElement.id = ROOT_ID;
            document.documentElement.appendChild(rootElement);
        }

        shadowRoot = rootElement.shadowRoot || rootElement.attachShadow({ mode: 'open' });
    }

    function getStyles() {
        return `
            :host {
                all: initial;
                --klpf-blue: #0042a1;
                --klpf-pink: #f0558b;
                --klpf-text: #1a1a1a;
                --klpf-muted: #6b7280;
                --klpf-border: #e5e7eb;
                --klpf-surface: #ffffff;
                --klpf-shadow: 0 20px 80px rgba(0, 0, 0, 0.24);
                font-family: Inter, "Segoe UI", "Hiragino Sans", "Yu Gothic", sans-serif;
            }

            * {
                box-sizing: border-box;
            }

            .overlay {
                position: fixed;
                inset: 0;
                z-index: 2147483646;
                display: none;
                align-items: center;
                justify-content: center;
                padding: 24px;
                background: rgba(15, 23, 42, 0.52);
                backdrop-filter: blur(6px);
            }

            .overlay.is-open {
                display: flex;
                animation: klpfFade 0.18s ease-out;
            }

            .overlay.is-confirm .panel {
                width: min(460px, 100%);
            }

            .panel {
                width: min(560px, 100%);
                max-height: min(720px, calc(100vh - 48px));
                overflow: hidden;
                border: 1px solid rgba(255, 255, 255, 0.45);
                border-radius: 24px;
                background: var(--klpf-surface);
                box-shadow: var(--klpf-shadow);
                animation: klpfPanelIn 0.22s cubic-bezier(0.4, 0, 0.2, 1);
            }

            .header {
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: 16px;
                padding: 24px 26px 18px;
                color: white;
                background: linear-gradient(135deg, var(--klpf-blue), var(--klpf-pink));
            }

            .title {
                margin: 0 0 6px;
                font-size: 24px;
                font-weight: 800;
                letter-spacing: 0.02em;
            }

            .subtitle {
                margin: 0;
                font-size: 13px;
                line-height: 1.6;
                opacity: 0.88;
            }

            .close {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 38px;
                height: 38px;
                border: 1px solid rgba(255, 255, 255, 0.48);
                border-radius: 999px;
                color: white;
                background: rgba(255, 255, 255, 0.12);
                cursor: pointer;
                font-size: 24px;
                line-height: 1;
                transition: transform 0.18s ease, background 0.18s ease;
            }

            .close:hover {
                transform: rotate(90deg);
                background: rgba(255, 255, 255, 0.22);
            }

            .body {
                position: relative;
                padding: 22px 26px 26px;
                max-height: calc(min(720px, 100vh - 48px) - 120px);
                overflow-y: auto;
                background:
                    radial-gradient(700px 220px at 20% 0%, rgba(240, 85, 139, 0.10), transparent 70%),
                    radial-gradient(700px 240px at 100% 10%, rgba(0, 66, 161, 0.12), transparent 70%),
                    #fff;
            }

            .master-card,
            .feature-card {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 18px;
                border: 1px solid var(--klpf-border);
                border-radius: 18px;
                background: rgba(255, 255, 255, 0.88);
                box-shadow: 0 4px 24px rgba(15, 23, 42, 0.06);
            }

            .master-card {
                padding: 18px;
                margin-bottom: 16px;
                border-color: rgba(240, 85, 139, 0.30);
            }

            .master-title,
            .feature-title {
                margin: 0;
                color: var(--klpf-text);
                font-size: 15px;
                font-weight: 700;
            }

            .master-desc,
            .feature-desc {
                margin: 5px 0 0;
                color: var(--klpf-muted);
                font-size: 12px;
                line-height: 1.5;
            }

            .feature-list-wrap {
                position: relative;
            }

            .feature-list {
                display: grid;
                gap: 10px;
            }

            .feature-card {
                padding: 14px 16px;
                transition: transform 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease;
            }

            .feature-card:hover {
                transform: translateY(-2px);
                box-shadow: 0 8px 32px rgba(15, 23, 42, 0.10);
            }

            .feature-list-wrap.is-disabled .feature-card {
                opacity: 0.38;
                filter: grayscale(0.35);
            }

            .disabled-cover {
                position: absolute;
                inset: -6px;
                z-index: 2;
                display: none;
                align-items: center;
                justify-content: center;
                padding: 18px;
                border: 1px solid rgba(148, 163, 184, 0.32);
                border-radius: 20px;
                color: #475569;
                background: rgba(241, 245, 249, 0.70);
                backdrop-filter: blur(2px);
                text-align: center;
                font-size: 13px;
                font-weight: 700;
                pointer-events: auto;
            }

            .feature-list-wrap.is-disabled .disabled-cover {
                display: flex;
            }

            .switch {
                position: relative;
                display: inline-flex;
                flex: 0 0 auto;
                width: 58px;
                height: 32px;
            }

            .switch input {
                width: 0;
                height: 0;
                opacity: 0;
            }

            .slider {
                position: absolute;
                inset: 0;
                border-radius: 999px;
                background: #cbd5e1;
                cursor: pointer;
                transition: background 0.22s ease, box-shadow 0.22s ease;
            }

            .slider::before {
                content: "";
                position: absolute;
                width: 24px;
                height: 24px;
                left: 4px;
                top: 4px;
                border-radius: 50%;
                background: #fff;
                box-shadow: 0 2px 8px rgba(15, 23, 42, 0.25);
                transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
            }

            .switch input:checked + .slider {
                background: linear-gradient(135deg, var(--klpf-blue), var(--klpf-pink));
                box-shadow: 0 6px 18px rgba(0, 66, 161, 0.20);
            }

            .switch input:checked + .slider::before {
                transform: translateX(26px);
            }

            .switch input:disabled + .slider {
                cursor: not-allowed;
            }

            .status {
                min-height: 18px;
                margin: 14px 0 0;
                color: var(--klpf-blue);
                font-size: 12px;
                font-weight: 700;
                opacity: 0;
                transition: opacity 0.2s ease;
            }

            .status.is-visible {
                opacity: 1;
            }

            .prompt-body {
                padding: 28px;
                background: #fff;
            }

            .prompt-title {
                margin: 0 0 10px;
                color: var(--klpf-text);
                font-size: 20px;
                font-weight: 800;
            }

            .prompt-text {
                margin: 0 0 22px;
                color: var(--klpf-muted);
                font-size: 13px;
                line-height: 1.7;
            }

            .prompt-actions {
                display: flex;
                justify-content: flex-end;
                gap: 10px;
            }

            .prompt-button {
                border: 1px solid var(--klpf-border);
                border-radius: 999px;
                padding: 10px 16px;
                cursor: pointer;
                font-size: 13px;
                font-weight: 700;
                transition: transform 0.18s ease, box-shadow 0.18s ease;
            }

            .prompt-button:hover {
                transform: translateY(-2px);
                box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
            }

            .prompt-button.secondary {
                color: var(--klpf-text);
                background: #fff;
            }

            .prompt-button.primary {
                color: #fff;
                border-color: transparent;
                background: linear-gradient(135deg, var(--klpf-blue), var(--klpf-pink));
            }

            @keyframes klpfFade {
                from { opacity: 0; }
                to { opacity: 1; }
            }

            @keyframes klpfPanelIn {
                from { opacity: 0; transform: translateY(18px) scale(0.98); }
                to { opacity: 1; transform: translateY(0) scale(1); }
            }
        `;
    }

    function getPanelMarkup() {
        if (isReloadPromptOpen) {
            return `
                <style>${getStyles()}</style>
                <div class="overlay is-open is-confirm" part="overlay">
                    <section class="panel" role="dialog" aria-modal="true" aria-label="KLPF 設定の反映">
                        <div class="prompt-body">
                            <h2 class="prompt-title">設定を反映しますか？</h2>
                            <p class="prompt-text">変更した設定を有効化するには、Ku-LMS の再読み込みが必要な場合があります。今すぐ再読み込みしますか？</p>
                            <div class="prompt-actions">
                                <button type="button" class="prompt-button secondary" data-close-without-reload>あとで</button>
                                <button type="button" class="prompt-button primary" data-reload-page>再読み込み</button>
                            </div>
                        </div>
                    </section>
                </div>
            `;
        }

        const featureCards = features.map((feature) => {
            const checked = getFeatureValue(state.settings, feature) && !state.allDisabled;
            return `
                <article class="feature-card">
                    <div>
                        <p class="feature-title">${feature.label}</p>
                        <p class="feature-desc">${feature.defaultValue ? '通常は有効' : '必要なときだけ有効'} / オプションページと同期</p>
                    </div>
                    <label class="switch" aria-label="${feature.label}">
                        <input type="checkbox" data-feature-key="${feature.key}" ${checked ? 'checked' : ''} ${state.allDisabled ? 'disabled' : ''}>
                        <span class="slider"></span>
                    </label>
                </article>
            `;
        }).join('');

        return `
            <style>${getStyles()}</style>
            <div class="overlay ${isOpen ? 'is-open' : ''}" part="overlay">
                <section class="panel" role="dialog" aria-modal="true" aria-label="KLPF 設定">
                    <header class="header">
                        <div>
                            <h2 class="title">KLPF 設定</h2>
                            <p class="subtitle">Ku-LMS 上から主要機能の ON/OFF を切り替えます。変更はオプションページと同期されます。</p>
                        </div>
                        <button type="button" class="close" aria-label="閉じる">×</button>
                    </header>
                    <div class="body">
                        <section class="master-card">
                            <div>
                                <p class="master-title">すべての機能を OFF</p>
                                <p class="master-desc">有効にすると下の機能を一括停止します。解除すると停止前の状態へ戻します。</p>
                            </div>
                            <label class="switch" aria-label="すべての機能をOFF">
                                <input type="checkbox" data-master-toggle ${state.allDisabled ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </section>
                        <div class="feature-list-wrap ${state.allDisabled ? 'is-disabled' : ''}">
                            <div class="feature-list">${featureCards}</div>
                            <div class="disabled-cover">すべての機能が OFF です。上のスイッチを解除すると個別設定を変更できます。</div>
                        </div>
                        <p class="status" aria-live="polite"></p>
                    </div>
                </section>
            </div>
        `;
    }

    function showStatus(message) {
        const status = shadowRoot?.querySelector('.status');
        if (!status) return;
        status.textContent = message;
        status.classList.add('is-visible');
        window.clearTimeout(showStatus.timer);
        showStatus.timer = window.setTimeout(() => status.classList.remove('is-visible'), 1800);
    }

    function markSettingsChanged() {
        hasPendingReloadPrompt = true;
    }

    function closePanelImmediately() {
        hasPendingReloadPrompt = false;
        isReloadPromptOpen = false;
        isOpen = false;
        render();
    }

    function requestClosePanel() {
        if (hasPendingReloadPrompt) {
            isReloadPromptOpen = true;
            render();
            return;
        }

        closePanelImmediately();
    }

    async function openPanel() {
        await loadState();
        hasPendingReloadPrompt = false;
        isReloadPromptOpen = false;
        isOpen = true;
        render();
    }

    async function handleFeatureToggle(event) {
        const input = event.target.closest('input[data-feature-key]');
        if (!input || state.allDisabled) return;

        const key = input.dataset.featureKey;
        await storageSet('sync', { [key]: input.checked });
        state.settings[key] = input.checked;
        markSettingsChanged();
        showStatus('設定を保存しました');
    }

    async function handleMasterToggle(event) {
        const input = event.target.closest('input[data-master-toggle]');
        if (!input) return;

        if (input.checked) {
            const previousSettings = getCurrentFeatureSettings();
            const disabledSettings = featureKeys.reduce((values, key) => {
                values[key] = false;
                return values;
            }, {});

            await storageSet('local', {
                [ALL_DISABLED_KEY]: true,
                [PREVIOUS_SETTINGS_KEY]: previousSettings,
            });
            await storageSet('sync', disabledSettings);
            state.allDisabled = true;
            state.settings = disabledSettings;
            markSettingsChanged();
            render();
            showStatus('すべての機能をOFFにしました');
            return;
        }

        const localSettings = await storageGet('local', [PREVIOUS_SETTINGS_KEY]);
        const previousSettings = localSettings[PREVIOUS_SETTINGS_KEY] || {};
        const restoredSettings = features.reduce((values, feature) => {
            values[feature.key] = typeof previousSettings[feature.key] === 'boolean'
                ? previousSettings[feature.key]
                : feature.defaultValue;
            return values;
        }, {});

        state.allDisabled = false;
        await storageSet('local', { [ALL_DISABLED_KEY]: false });
        await storageSet('sync', restoredSettings);
        await storageSet('local', {
            [ALL_DISABLED_KEY]: false,
            [PREVIOUS_SETTINGS_KEY]: restoredSettings,
        });
        state.settings = restoredSettings;
        markSettingsChanged();
        render();
        showStatus('停止前の設定を復元しました');
    }

    function applyStateToControls() {
        if (!shadowRoot || isReloadPromptOpen) return;

        const masterToggle = shadowRoot.querySelector('input[data-master-toggle]');
        if (masterToggle) {
            masterToggle.checked = state.allDisabled;
        }

        const featureListWrap = shadowRoot.querySelector('.feature-list-wrap');
        featureListWrap?.classList.toggle('is-disabled', state.allDisabled);

        for (const feature of features) {
            const input = shadowRoot.querySelector(`input[data-feature-key="${CSS.escape(feature.key)}"]`);
            if (!input) continue;
            input.checked = getFeatureValue(state.settings, feature) && !state.allDisabled;
            input.disabled = state.allDisabled;
        }
    }

    function addPanelListeners() {
        const overlay = shadowRoot.querySelector('.overlay');
        const panel = shadowRoot.querySelector('.panel');
        const closeButton = shadowRoot.querySelector('.close');
        const reloadButton = shadowRoot.querySelector('[data-reload-page]');
        const closeWithoutReloadButton = shadowRoot.querySelector('[data-close-without-reload]');

        overlay?.addEventListener('click', (event) => {
            if (event.target === overlay && !isReloadPromptOpen) requestClosePanel();
        });
        panel?.addEventListener('change', (event) => {
            handleMasterToggle(event);
            handleFeatureToggle(event);
        });
        closeButton?.addEventListener('click', requestClosePanel);
        reloadButton?.addEventListener('click', () => window.location.reload());
        closeWithoutReloadButton?.addEventListener('click', closePanelImmediately);
    }

    function render() {
        ensureRoot();
        shadowRoot.innerHTML = getPanelMarkup();
        addPanelListeners();
    }

    function buildMenuItem() {
        const item = document.createElement('li');
        item.id = MENU_ITEM_ID;

        const link = document.createElement('a');
        link.href = 'javascript:void(0);';

        const label = document.createElement('span');
        label.textContent = 'KLPF 設定';

        link.appendChild(label);
        link.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            openPanel();
        });
        item.appendChild(link);
        return item;
    }

    function injectMenuItem() {
        const menus = [
            document.getElementById('addKojinComment'),
            document.getElementById('addKojinCommentSp'),
        ].filter(Boolean);

        for (const menu of menus) {
            if (menu.querySelector(`#${MENU_ITEM_ID}`)) continue;
            menu.appendChild(buildMenuItem());
        }
    }

    function observeMenu() {
        injectMenuItem();
        const observer = new MutationObserver(injectMenuItem);
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && featureKeys.some((key) => changes[key])) {
            if (state.allDisabled) {
                const forcedOffSettings = featureKeys.reduce((values, key) => {
                    if (changes[key]?.newValue === true) {
                        values[key] = false;
                    }
                    return values;
                }, {});

                if (Object.keys(forcedOffSettings).length > 0) {
                    storageSet('sync', forcedOffSettings);
                    return;
                }
            }

            if (!isOpen) return;
            loadState().then(applyStateToControls);
        }

        if (area === 'local' && changes[ALL_DISABLED_KEY]) {
            state.allDisabled = !!changes[ALL_DISABLED_KEY].newValue;
            if (!isOpen) return;
            loadState().then(applyStateToControls);
        }
    });

    loadFeatureDefinitions().then(loadState).catch((error) => {
        console.warn('[KLPF] KU-LMS内設定の初期状態読み込みに失敗しました。', error);
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', observeMenu, { once: true });
    } else {
        observeMenu();
    }
})();
