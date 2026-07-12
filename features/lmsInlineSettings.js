// Copyright (c) 2024-2025 SAYU
// This software is released under the MIT License, see LICENSE.

(() => {
    'use strict';

    const INSTANCE_KEY = '__klpfInlineSettingsInstance';
    const existingInstance = globalThis[INSTANCE_KEY];
    if (existingInstance?.refresh) {
        existingInstance.refresh();
        return;
    }

    const MENU_ITEM_ID = 'klpf-inline-settings-menu-item';
    const ROOT_ID = 'klpf-inline-settings-root';
    const THEME_MENU_ITEM_ATTRIBUTE = 'data-klpf-theme-menu-item';
    const THEME_ROOT_ID = 'klpf-site-theme-root';
    const THEME_STYLE_ID = 'klpf-site-theme-style';
    const THEME_COLOR_STORAGE_KEY = 'klpfSiteThemeColor';
    const FALLBACK_THEME_COLOR = '#0068B7';
    const ALL_DISABLED_KEY = 'klpfInlineAllFeaturesDisabled';
    const PREVIOUS_SETTINGS_KEY = 'klpfInlinePreviousFeatureSettings';

    let features = [];
    let featureKeys = [];

    let rootElement = null;
    let shadowRoot = null;
    let themeRootElement = null;
    let themeShadowRoot = null;
    let persistedThemeColor = null;
    let draftThemeColor = FALLBACK_THEME_COLOR;
    let draftThemeUsesDefault = true;
    let themeLastFocusedElement = null;
    let menuObserver = null;
    let isThemeOpen = false;
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

    function normalizeHexColor(value) {
        if (typeof value !== 'string') return null;

        const compactValue = value.trim().replace(/^#/, '');
        if (/^[0-9a-f]{3}$/i.test(compactValue)) {
            return `#${compactValue.split('').map((character) => character.repeat(2)).join('').toUpperCase()}`;
        }
        if (/^[0-9a-f]{6}$/i.test(compactValue)) {
            return `#${compactValue.toUpperCase()}`;
        }
        return null;
    }

    function cssColorToHex(value) {
        const normalizedHex = normalizeHexColor(value);
        if (normalizedHex) return normalizedHex;

        const channels = typeof value === 'string' ? value.match(/[\d.]+/g) : null;
        if (!channels || channels.length < 3) return null;

        return `#${channels.slice(0, 3).map((channel) => {
            const integer = Math.max(0, Math.min(255, Math.round(Number(channel))));
            return integer.toString(16).padStart(2, '0');
        }).join('').toUpperCase()}`;
    }

    function applyThemeColor(color) {
        const normalizedColor = normalizeHexColor(color);
        const existingStyle = document.getElementById(THEME_STYLE_ID);

        if (!normalizedColor) {
            existingStyle?.remove();
            return;
        }

        const style = existingStyle || document.createElement('style');
        style.id = THEME_STYLE_ID;
        style.textContent = `
            .lms-card,
            .lms-cardname,
            .lms-cardname a,
            .lms-cardname a:link,
            .lms-cardname a:visited,
            .lms-news-subO a,
            .lms-news-subO a:link,
            .lms-news-subO a:visited {
                color: ${normalizedColor} !important;
            }
        `;

        if (!existingStyle) {
            (document.head || document.documentElement).appendChild(style);
        }
    }

    function readNativeThemeColor() {
        const target = document.querySelector(
            '.lms-cardname a, .lms-news-subO a, .lms-cardname, .lms-card',
        );
        return cssColorToHex(target ? getComputedStyle(target).color : '') || FALLBACK_THEME_COLOR;
    }

    async function loadAndApplyThemeColor() {
        const stored = await storageGet('local', [THEME_COLOR_STORAGE_KEY]);
        persistedThemeColor = normalizeHexColor(stored[THEME_COLOR_STORAGE_KEY]);
        applyThemeColor(persistedThemeColor);
    }

    function ensureThemeRoot() {
        if (themeRootElement?.isConnected && themeShadowRoot) return;

        themeRootElement = document.getElementById(THEME_ROOT_ID);
        if (!themeRootElement) {
            themeRootElement = document.createElement('div');
            themeRootElement.id = THEME_ROOT_ID;
            document.documentElement.appendChild(themeRootElement);
        }

        themeShadowRoot = themeRootElement.shadowRoot
            || themeRootElement.attachShadow({ mode: 'open' });
    }

    function getThemeStyles() {
        return `
            :host {
                all: initial;
                --theme-color: ${FALLBACK_THEME_COLOR};
                --ink: #152536;
                --muted: #66788a;
                --line: #d9e3ec;
                --surface: #ffffff;
                font-family: Inter, "Segoe UI", "Hiragino Sans", "Yu Gothic", sans-serif;
            }

            * {
                box-sizing: border-box;
            }

            .theme-overlay {
                position: fixed;
                inset: 0;
                z-index: 2147483647;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 24px;
                background: rgba(12, 28, 45, 0.56);
                backdrop-filter: blur(7px);
                animation: themeFade 160ms ease-out;
            }

            .theme-panel {
                width: min(460px, 100%);
                max-height: calc(100vh - 48px);
                overflow: auto;
                border: 1px solid rgba(255, 255, 255, 0.72);
                border-radius: 22px;
                color: var(--ink);
                background: var(--surface);
                box-shadow: 0 24px 72px rgba(8, 30, 52, 0.28);
                animation: themePanelIn 190ms cubic-bezier(0.2, 0.8, 0.2, 1);
            }

            .theme-header {
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: 18px;
                padding: 24px 25px 21px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.18);
                color: #fff;
                background: #075f9f;
            }

            .theme-eyebrow {
                margin: 0 0 5px;
                font-size: 10px;
                font-weight: 800;
                letter-spacing: 0.16em;
                opacity: 0.74;
            }

            .theme-title {
                margin: 0;
                font-size: 21px;
                font-weight: 800;
                letter-spacing: 0.02em;
            }

            .theme-subtitle {
                margin: 7px 0 0;
                font-size: 12px;
                line-height: 1.6;
                opacity: 0.84;
            }

            .theme-close {
                display: inline-grid;
                flex: 0 0 auto;
                width: 36px;
                height: 36px;
                place-items: center;
                border: 1px solid rgba(255, 255, 255, 0.36);
                border-radius: 50%;
                color: #fff;
                background: rgba(255, 255, 255, 0.10);
                cursor: pointer;
                font-size: 23px;
                line-height: 1;
                transition: background 150ms ease, transform 150ms ease;
            }

            .theme-close:hover {
                background: rgba(255, 255, 255, 0.20);
                transform: rotate(90deg);
            }

            .theme-close:focus-visible,
            .theme-input:focus-visible,
            .theme-button:focus-visible {
                outline: 3px solid rgba(45, 156, 219, 0.32);
                outline-offset: 3px;
            }

            .theme-body {
                padding: 22px 25px 16px;
            }

            .theme-preview {
                position: relative;
                overflow: hidden;
                margin-bottom: 21px;
                padding: 17px 18px 16px;
                border: 1px solid var(--line);
                border-radius: 15px;
                background: #f8fbfd;
            }

            .theme-preview::before {
                content: "";
                position: absolute;
                inset: 0 auto 0 0;
                width: 4px;
                background: var(--theme-color);
            }

            .preview-caption {
                margin: 0 0 10px;
                color: #8796a5;
                font-size: 10px;
                font-weight: 800;
                letter-spacing: 0.12em;
            }

            .preview-course,
            .preview-news {
                color: var(--theme-color);
            }

            .preview-course {
                margin: 0 0 8px;
                font-size: 16px;
                font-weight: 800;
            }

            .preview-news {
                display: inline-flex;
                align-items: center;
                gap: 7px;
                font-size: 12px;
                font-weight: 700;
            }

            .preview-news::before {
                content: "";
                width: 6px;
                height: 6px;
                border-radius: 50%;
                background: currentColor;
            }

            .theme-label {
                display: block;
                margin-bottom: 9px;
                color: var(--ink);
                font-size: 12px;
                font-weight: 800;
            }

            .theme-fields {
                display: grid;
                grid-template-columns: 54px 1fr;
                gap: 10px;
            }

            .theme-color-input {
                width: 54px;
                height: 44px;
                padding: 4px;
                border: 1px solid var(--line);
                border-radius: 11px;
                background: #fff;
                cursor: pointer;
            }

            .theme-color-input::-webkit-color-swatch-wrapper {
                padding: 0;
            }

            .theme-color-input::-webkit-color-swatch {
                border: 0;
                border-radius: 7px;
            }

            .theme-input {
                width: 100%;
                height: 44px;
                border: 1px solid var(--line);
                border-radius: 11px;
                padding: 0 13px;
                color: var(--ink);
                background: #fff;
                font: 700 14px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
                letter-spacing: 0.05em;
                text-transform: uppercase;
                transition: border-color 150ms ease, box-shadow 150ms ease;
            }

            .theme-input:focus {
                border-color: #1682c0;
                box-shadow: 0 0 0 3px rgba(22, 130, 192, 0.12);
                outline: 0;
            }

            .theme-input[aria-invalid="true"] {
                border-color: #c83f55;
                box-shadow: 0 0 0 3px rgba(200, 63, 85, 0.10);
            }

            .theme-help {
                margin: 8px 0 0;
                color: var(--muted);
                font-size: 11px;
                line-height: 1.5;
            }

            .theme-status {
                min-height: 18px;
                margin: 10px 0 0;
                color: #0872ad;
                font-size: 11px;
                font-weight: 700;
            }

            .theme-status.is-error {
                color: #bd3148;
            }

            .theme-actions {
                display: flex;
                align-items: center;
                gap: 9px;
                padding: 17px 25px 22px;
                border-top: 1px solid #edf1f5;
            }

            .theme-button {
                min-height: 39px;
                border: 1px solid var(--line);
                border-radius: 999px;
                padding: 8px 15px;
                color: #2d4355;
                background: #fff;
                cursor: pointer;
                font-size: 12px;
                font-weight: 800;
                transition: transform 140ms ease, box-shadow 140ms ease, background 140ms ease;
            }

            .theme-button:hover {
                transform: translateY(-1px);
                box-shadow: 0 6px 18px rgba(24, 55, 82, 0.11);
            }

            .theme-button.reset {
                margin-right: auto;
                color: #52687a;
                background: #f7f9fb;
            }

            .theme-button.primary {
                min-width: 82px;
                border-color: #075f9f;
                color: #fff;
                background: #075f9f;
            }

            .theme-button.primary:hover {
                background: #064f84;
            }

            @media (max-width: 520px) {
                .theme-overlay { padding: 12px; }
                .theme-panel { border-radius: 18px; }
                .theme-header, .theme-body { padding-left: 19px; padding-right: 19px; }
                .theme-actions { flex-wrap: wrap; padding-left: 19px; padding-right: 19px; }
                .theme-button.reset { width: 100%; margin: 0 0 3px; }
                .theme-button:not(.reset) { flex: 1; }
            }

            @media (prefers-reduced-motion: reduce) {
                *, *::before, *::after {
                    animation-duration: 0.01ms !important;
                    transition-duration: 0.01ms !important;
                }
            }

            @keyframes themeFade {
                from { opacity: 0; }
                to { opacity: 1; }
            }

            @keyframes themePanelIn {
                from { opacity: 0; transform: translateY(12px) scale(0.985); }
                to { opacity: 1; transform: translateY(0) scale(1); }
            }
        `;
    }

    function getThemePanelMarkup() {
        return `
            <style>${getThemeStyles()}</style>
            <div class="theme-overlay">
                <form class="theme-panel" role="dialog" aria-modal="true" aria-labelledby="klpf-theme-title" novalidate>
                    <header class="theme-header">
                        <div>
                            <p class="theme-eyebrow">KLPF APPEARANCE</p>
                            <h2 class="theme-title" id="klpf-theme-title">サイトテーマ色</h2>
                            <p class="theme-subtitle">科目名とお知らせリンクの色を変更します。</p>
                        </div>
                        <button type="button" class="theme-close" aria-label="閉じる">×</button>
                    </header>
                    <div class="theme-body">
                        <section class="theme-preview" aria-label="選択色のプレビュー">
                            <p class="preview-caption">LIVE PREVIEW</p>
                            <p class="preview-course">ソフトウェア工学 I</p>
                            <span class="preview-news">授業からのお知らせ</span>
                        </section>
                        <label class="theme-label" for="klpf-theme-hex">テーマ色</label>
                        <div class="theme-fields">
                            <input class="theme-color-input" type="color" aria-label="カラーピッカー">
                            <input class="theme-input" id="klpf-theme-hex" type="text" inputmode="text" maxlength="7" autocomplete="off" spellcheck="false" aria-describedby="klpf-theme-help klpf-theme-status">
                        </div>
                        <p class="theme-help" id="klpf-theme-help">3桁または6桁の16進数で指定できます（例：#0068B7）。変更はページ上ですぐ確認できます。</p>
                        <p class="theme-status" id="klpf-theme-status" aria-live="polite"></p>
                    </div>
                    <footer class="theme-actions">
                        <button type="button" class="theme-button reset" data-theme-reset>サイト既定色に戻す</button>
                        <button type="button" class="theme-button" data-theme-cancel>キャンセル</button>
                        <button type="submit" class="theme-button primary">保存</button>
                    </footer>
                </form>
            </div>
        `;
    }

    function setThemeStatus(message, isError = false) {
        const status = themeShadowRoot?.querySelector('.theme-status');
        if (!status) return;
        status.textContent = message;
        status.classList.toggle('is-error', isError);
    }

    function syncThemePanelColor(color) {
        const normalizedColor = normalizeHexColor(color) || FALLBACK_THEME_COLOR;
        const panel = themeShadowRoot?.querySelector('.theme-panel');
        const colorInput = themeShadowRoot?.querySelector('.theme-color-input');
        const hexInput = themeShadowRoot?.querySelector('.theme-input');

        panel?.style.setProperty('--theme-color', normalizedColor);
        if (colorInput) colorInput.value = normalizedColor;
        if (hexInput) {
            hexInput.value = normalizedColor;
            hexInput.setAttribute('aria-invalid', 'false');
        }
    }

    function closeThemePanel({ restoreSavedColor = true } = {}) {
        if (!isThemeOpen) return;
        if (restoreSavedColor) applyThemeColor(persistedThemeColor);

        isThemeOpen = false;
        themeRootElement?.remove();
        themeRootElement = null;
        themeShadowRoot = null;

        if (themeLastFocusedElement instanceof HTMLElement && themeLastFocusedElement.isConnected) {
            themeLastFocusedElement.focus();
        }
        themeLastFocusedElement = null;
    }

    function handleThemeFocusTrap(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeThemePanel();
            return;
        }
        if (event.key !== 'Tab') return;

        const focusable = [...themeShadowRoot.querySelectorAll('button, input')]
            .filter((element) => !element.disabled);
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && themeShadowRoot.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && themeShadowRoot.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    function addThemePanelListeners() {
        const overlay = themeShadowRoot.querySelector('.theme-overlay');
        const panel = themeShadowRoot.querySelector('.theme-panel');
        const colorInput = themeShadowRoot.querySelector('.theme-color-input');
        const hexInput = themeShadowRoot.querySelector('.theme-input');
        const closeButton = themeShadowRoot.querySelector('.theme-close');
        const cancelButton = themeShadowRoot.querySelector('[data-theme-cancel]');
        const resetButton = themeShadowRoot.querySelector('[data-theme-reset]');

        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) closeThemePanel();
        });
        themeShadowRoot.addEventListener('keydown', handleThemeFocusTrap);
        closeButton.addEventListener('click', () => closeThemePanel());
        cancelButton.addEventListener('click', () => closeThemePanel());

        colorInput.addEventListener('input', () => {
            draftThemeColor = normalizeHexColor(colorInput.value) || FALLBACK_THEME_COLOR;
            draftThemeUsesDefault = false;
            syncThemePanelColor(draftThemeColor);
            applyThemeColor(draftThemeColor);
            setThemeStatus('プレビュー中です。保存すると次回もこの色を使用します。');
        });

        hexInput.addEventListener('input', () => {
            const normalizedColor = normalizeHexColor(hexInput.value);
            if (!normalizedColor) {
                hexInput.setAttribute('aria-invalid', 'true');
                return;
            }

            draftThemeColor = normalizedColor;
            draftThemeUsesDefault = false;
            hexInput.setAttribute('aria-invalid', 'false');
            colorInput.value = normalizedColor;
            panel.style.setProperty('--theme-color', normalizedColor);
            applyThemeColor(normalizedColor);
            setThemeStatus('プレビュー中です。保存すると次回もこの色を使用します。');
        });

        hexInput.addEventListener('change', () => {
            const normalizedColor = normalizeHexColor(hexInput.value);
            if (!normalizedColor) {
                hexInput.setAttribute('aria-invalid', 'true');
                setThemeStatus('3桁または6桁の16進数で入力してください。', true);
                return;
            }
            syncThemePanelColor(normalizedColor);
        });

        resetButton.addEventListener('click', async () => {
            await chrome.storage.local.remove(THEME_COLOR_STORAGE_KEY);
            persistedThemeColor = null;
            applyThemeColor(null);
            draftThemeColor = readNativeThemeColor();
            draftThemeUsesDefault = true;
            syncThemePanelColor(draftThemeColor);
            setThemeStatus('サイト既定色に戻しました。');
        });

        panel.addEventListener('submit', async (event) => {
            event.preventDefault();
            const normalizedColor = normalizeHexColor(hexInput.value);
            if (!normalizedColor) {
                hexInput.setAttribute('aria-invalid', 'true');
                setThemeStatus('3桁または6桁の16進数で入力してください。', true);
                hexInput.focus();
                return;
            }

            if (draftThemeUsesDefault) {
                await chrome.storage.local.remove(THEME_COLOR_STORAGE_KEY);
                persistedThemeColor = null;
                applyThemeColor(null);
                closeThemePanel({ restoreSavedColor: false });
                return;
            }

            persistedThemeColor = normalizedColor;
            draftThemeColor = normalizedColor;
            await storageSet('local', { [THEME_COLOR_STORAGE_KEY]: normalizedColor });
            applyThemeColor(normalizedColor);
            closeThemePanel({ restoreSavedColor: false });
        });
    }

    async function openThemePanel() {
        if (isThemeOpen) {
            themeShadowRoot?.querySelector('.theme-input')?.focus();
            return;
        }

        themeLastFocusedElement = document.activeElement;
        const stored = await storageGet('local', [THEME_COLOR_STORAGE_KEY]);
        persistedThemeColor = normalizeHexColor(stored[THEME_COLOR_STORAGE_KEY]);
        applyThemeColor(persistedThemeColor);
        draftThemeColor = persistedThemeColor || readNativeThemeColor();
        draftThemeUsesDefault = !persistedThemeColor;
        isThemeOpen = true;

        ensureThemeRoot();
        themeShadowRoot.innerHTML = getThemePanelMarkup();
        syncThemePanelColor(draftThemeColor);
        addThemePanelListeners();
        themeShadowRoot.querySelector('.theme-input')?.focus();
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
        link.href = '#';

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

    function buildThemeMenuItem() {
        const item = document.createElement('li');
        item.setAttribute(THEME_MENU_ITEM_ATTRIBUTE, '');

        const link = document.createElement('a');
        link.href = '#';

        const label = document.createElement('span');
        label.textContent = 'サイトテーマ色変更';

        link.appendChild(label);
        link.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            openThemePanel().catch((error) => {
                console.warn('[KLPF] サイトテーマ色の設定画面を開けませんでした。', error);
            });
        });
        item.appendChild(link);
        return item;
    }

    function getSettingsMenus() {
        return [...new Set([
            ...document.querySelectorAll('.selectBoxSettei.lms-user-menu'),
            document.getElementById('addKojinComment'),
            document.getElementById('addKojinCommentSp'),
        ].filter(Boolean))];
    }

    function injectMenuItem() {
        for (const menu of getSettingsMenus()) {
            let settingsItem = menu.querySelector(`#${MENU_ITEM_ID}`);
            if (!settingsItem) {
                settingsItem = buildMenuItem();
                menu.appendChild(settingsItem);
            }

            let themeItem = menu.querySelector(`[${THEME_MENU_ITEM_ATTRIBUTE}]`);
            if (!themeItem) themeItem = buildThemeMenuItem();

            if (settingsItem.nextElementSibling !== themeItem) {
                settingsItem.insertAdjacentElement('afterend', themeItem);
            }
        }
    }

    function observeMenu() {
        injectMenuItem();
        if (menuObserver) return;
        menuObserver = new MutationObserver(injectMenuItem);
        menuObserver.observe(document.documentElement, { childList: true, subtree: true });
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

        if (area === 'local' && changes[THEME_COLOR_STORAGE_KEY]) {
            persistedThemeColor = normalizeHexColor(changes[THEME_COLOR_STORAGE_KEY].newValue);
            if (!isThemeOpen) applyThemeColor(persistedThemeColor);
        }
    });

    loadFeatureDefinitions().then(loadState).catch((error) => {
        console.warn('[KLPF] KU-LMS内設定の初期状態読み込みに失敗しました。', error);
    });
    loadAndApplyThemeColor().catch((error) => {
        console.warn('[KLPF] サイトテーマ色を読み込めませんでした。', error);
    });

    globalThis[INSTANCE_KEY] = {
        refresh() {
            injectMenuItem();
            loadAndApplyThemeColor().catch((error) => {
                console.warn('[KLPF] サイトテーマ色を再適用できませんでした。', error);
            });
        },
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', observeMenu, { once: true });
    } else {
        observeMenu();
    }
})();
