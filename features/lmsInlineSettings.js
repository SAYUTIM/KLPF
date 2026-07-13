// Copyright (c) 2024-2026 SAYU
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
    const HOME_EDITOR_MENU_ITEM_ATTRIBUTE = 'data-klpf-home-editor-menu-item';
    const OPEN_HOME_EDITOR_EVENT = 'klpf-open-home-editor';
    const ROOT_ID = 'klpf-inline-settings-root';
    const THEME_MENU_ITEM_ATTRIBUTE = 'data-klpf-theme-menu-item';
    const CUSTOM_IMAGE_THEME_MENU_ITEM_ATTRIBUTE = 'data-klpf-custom-image-theme-menu-item';
    const OPEN_CUSTOM_IMAGE_THEME_EVENT = 'klpf-open-custom-image-theme';
    const THEME_ROOT_ID = 'klpf-site-theme-root';
    const THEME_STYLE_ID = 'klpf-site-theme-style';
    const THEME_COLORS_STORAGE_KEY = 'klpfSiteThemeColors';
    const LEGACY_THEME_COLOR_STORAGE_KEY = 'klpfSiteThemeColor';
    const THEME_ELEMENT_RULES_STORAGE_KEY = 'klpfSiteThemeElementRules';
    const THEME_RECENT_COLORS_STORAGE_KEY = 'klpfSiteThemeRecentColors';
    const THEME_PRESET_STORAGE_KEY = 'klpfSiteThemePreset';
    const THEME_ALLOWED_PROPERTIES = ['color', 'background-color', 'border-color'];
    const THEME_COLOR_CONFIG = [
        {
            key: 'text',
            label: '科目名・リンク',
            description: '科目名とお知らせリンクの文字色',
            property: 'color',
            selectors: ['.lms-card', '.lms-cardname', '.lms-cardname a', '.lms-cardname a:link', '.lms-cardname a:visited', '.lms-news-subO a', '.lms-news-subO a:link', '.lms-news-subO a:visited'],
            fallback: '#0068B7',
        },
        {
            key: 'cardBorder',
            label: '科目カードの枠線',
            description: '科目カードを囲む線の色',
            property: 'border-color',
            selectors: ['.lms-card'],
            fallback: '#D6E2E8',
        },
        {
            key: 'courseInfoBackground',
            label: '科目情報の背景',
            description: 'courseCardInfoの背景色',
            property: 'background-color',
            selectors: ['.courseCardInfo'],
            fallback: '#F2F6F8',
        },
        {
            key: 'newsBackground',
            label: 'お知らせの背景',
            description: 'lms-news-blockの背景色',
            property: 'background-color',
            selectors: ['.lms-news-block'],
            fallback: '#FFFFFF',
        },
    ];
    const FALLBACK_THEME_COLOR = THEME_COLOR_CONFIG[0].fallback;
    const ALL_DISABLED_KEY = 'klpfInlineAllFeaturesDisabled';
    const PREVIOUS_SETTINGS_KEY = 'klpfInlinePreviousFeatureSettings';

    let features = [];
    let featureKeys = [];

    let rootElement = null;
    let shadowRoot = null;
    let themeRootElement = null;
    let themeShadowRoot = null;
    let persistedThemeColors = {};
    let draftThemeBaseColors = {};
    let persistedElementRules = [];
    let draftElementRules = [];
    let recentThemeColors = [];
    let draftRecentColors = [];
    let selectedThemeTarget = null;
    let selectedThemeProperty = 'color';
    let themeInspectMode = false;
    let themeHoveredElement = null;
    let themeInspectCandidates = [];
    let selectedThemeHierarchy = [];
    let draftColorSelections = new Map();
    let themeLastFocusedElement = null;
    let menuObserver = null;
    let hasLoadedState = false;
    let isThemeOpen = false;
    let isOpen = false;
    let hasPendingReloadPrompt = false;
    let isReloadPromptOpen = false;
    const activeScrollLocks = new Set();
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

    function updatePageScrollLock(name, shouldLock) {
        if (shouldLock) activeScrollLocks.add(name);
        else activeScrollLocks.delete(name);

        let style = document.getElementById('klpf-inline-scroll-lock-style');
        if (!style) {
            style = document.createElement('style');
            style.id = 'klpf-inline-scroll-lock-style';
            (document.head || document.documentElement).appendChild(style);
        }
        style.textContent = `
                html.klpf-inline-modal-open,
                html.klpf-inline-modal-open body { overflow: hidden !important; overscroll-behavior: none !important; }
                [data-klpf-theme-hover] { outline: 3px solid #18a8cc !important; outline-offset: 2px !important; cursor: crosshair !important; }
                [data-klpf-theme-selected] { outline: 2px dashed #168eb5 !important; outline-offset: 2px !important; }
            `;
        document.documentElement.classList.toggle('klpf-inline-modal-open', activeScrollLocks.size > 0);
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

    function normalizeThemeColors(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
        return THEME_COLOR_CONFIG.reduce((colors, config) => {
            const color = normalizeHexColor(value[config.key]);
            if (color) colors[config.key] = color;
            return colors;
        }, {});
    }

    function normalizeElementRules(value) {
        if (!Array.isArray(value)) return [];
        const seen = new Set();
        return value.slice(0, 60).flatMap((rule) => {
            const selector = typeof rule?.selector === 'string' ? rule.selector.trim() : '';
            const property = THEME_ALLOWED_PROPERTIES.includes(rule?.property) ? rule.property : null;
            const color = normalizeHexColor(rule?.color);
            if (!selector || selector.length > 320 || /[{};]/.test(selector) || !property || !color) return [];
            try {
                document.querySelector(selector);
            } catch {
                return [];
            }
            const key = `${selector}\u0000${property}`;
            if (seen.has(key)) return [];
            seen.add(key);
            return [{
                selector,
                property,
                color,
                label: typeof rule.label === 'string' ? rule.label.slice(0, 80) : selector.slice(0, 80),
            }];
        });
    }

    function normalizeRecentColors(value) {
        if (!Array.isArray(value)) return [];
        return [...new Set(value.map(normalizeHexColor).filter(Boolean))].slice(0, 5);
    }

    function normalizeThemePreset(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        return {
            colors: normalizeThemeColors(value.colors),
            elementRules: normalizeElementRules(value.elementRules),
            savedAt: typeof value.savedAt === 'string' ? value.savedAt : '',
        };
    }

    function applyThemeColors(colors, elementRules = persistedElementRules) {
        const normalizedColors = normalizeThemeColors(colors);
        const existingStyle = document.getElementById(THEME_STYLE_ID);

        const rules = THEME_COLOR_CONFIG.flatMap((config) => {
            const color = normalizedColors[config.key];
            if (!color) return [];
            return [`${config.selectors.join(',\n')} { ${config.property}: ${color} !important; }`];
        });
        const orderedElementRules = normalizeElementRules(elementRules)
            .map((rule, index) => {
                let depth = 0;
                try {
                    let element = document.querySelector(rule.selector);
                    while (element?.parentElement) {
                        depth += 1;
                        element = element.parentElement;
                    }
                } catch (_error) {
                    // Keep an unreadable selector at its original relative position.
                }
                return { rule, index, depth };
            })
            .sort((left, right) => left.depth - right.depth || left.index - right.index)
            .map(({ rule }) => rule);

        for (const rule of orderedElementRules) {
            const selectors = rule.selector.split(',').map(selector => selector.trim()).filter(Boolean);
            if (rule.property === 'color') {
                const colorSelectors = selectors.flatMap(selector => [selector, `${selector} *`]);
                rules.push(`${colorSelectors.join(', ')} { color: ${rule.color} !important; }`);
            } else if (rule.property === 'border-color') {
                rules.push(`${selectors.join(', ')} { border-color: ${rule.color} !important; border-style: solid !important; border-width: 1px !important; }`);
            } else {
                rules.push(`${selectors.join(', ')} { ${rule.property}: ${rule.color} !important; }`);
            }
        }

        if (rules.length === 0) {
            existingStyle?.remove();
            return;
        }

        const style = existingStyle || document.createElement('style');
        style.id = THEME_STYLE_ID;
        style.textContent = rules.join('\n');

        if (!existingStyle) {
            (document.head || document.documentElement).appendChild(style);
        }
    }

    async function readStoredThemeColors() {
        const stored = await storageGet('local', [
            THEME_COLORS_STORAGE_KEY,
            LEGACY_THEME_COLOR_STORAGE_KEY,
        ]);
        const colors = normalizeThemeColors(stored[THEME_COLORS_STORAGE_KEY]);
        const legacyTextColor = normalizeHexColor(stored[LEGACY_THEME_COLOR_STORAGE_KEY]);
        if (!colors.text && legacyTextColor) colors.text = legacyTextColor;
        return colors;
    }

    async function loadAndApplyThemeColors() {
        const [colors, stored] = await Promise.all([
            readStoredThemeColors(),
            storageGet('local', [
                THEME_ELEMENT_RULES_STORAGE_KEY,
                THEME_RECENT_COLORS_STORAGE_KEY,
                ALL_DISABLED_KEY,
            ]),
        ]);
        persistedThemeColors = colors;
        persistedElementRules = normalizeElementRules(stored[THEME_ELEMENT_RULES_STORAGE_KEY]);
        recentThemeColors = normalizeRecentColors(stored[THEME_RECENT_COLORS_STORAGE_KEY]);
        if (recentThemeColors.length === 0) {
            recentThemeColors = normalizeRecentColors([
                ...Object.values(persistedThemeColors),
                ...persistedElementRules.map(rule => rule.color),
            ]);
        }
        if (stored[ALL_DISABLED_KEY]) applyThemeColors({}, []);
        else applyThemeColors(persistedThemeColors, persistedElementRules);
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
                --theme-text: ${FALLBACK_THEME_COLOR};
                --theme-card-border: #D6E2E8;
                --theme-course-info: #F2F6F8;
                --theme-news: #FFFFFF;
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
                border: 2px solid var(--theme-card-border);
                border-radius: 15px;
                background: #f8fbfd;
            }

            .theme-preview::before {
                content: "";
                position: absolute;
                inset: 0 auto 0 0;
                width: 4px;
                background: var(--theme-text);
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
                color: var(--theme-text);
            }

            .preview-course {
                margin: 0 0 8px;
                font-size: 16px;
                font-weight: 800;
            }

            .preview-info {
                margin: 0 0 10px;
                padding: 7px 9px;
                border-radius: 7px;
                color: #536575;
                background: var(--theme-course-info);
                font-size: 11px;
            }

            .preview-news {
                display: inline-flex;
                align-items: center;
                gap: 7px;
                padding: 8px 10px;
                border-radius: 7px;
                background: var(--theme-news);
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

            .theme-field-list {
                display: grid;
                gap: 15px;
            }

            .theme-field-row {
                padding-bottom: 15px;
                border-bottom: 1px solid #edf1f5;
            }

            .theme-field-row:last-child {
                padding-bottom: 0;
                border-bottom: 0;
            }

            .theme-field-heading {
                display: flex;
                align-items: baseline;
                justify-content: space-between;
                gap: 12px;
                margin-bottom: 8px;
            }

            .theme-field-heading .theme-label {
                margin: 0;
            }

            .theme-field-description {
                color: var(--muted);
                font-size: 10px;
            }

            .theme-fields {
                display: grid;
                grid-template-columns: 54px minmax(0, 1fr) auto;
                gap: 10px;
            }

            .theme-field-reset {
                min-width: 48px;
                border: 1px solid var(--line);
                border-radius: 10px;
                padding: 0 9px;
                color: #52687a;
                background: #f7f9fb;
                cursor: pointer;
                font-size: 10px;
                font-weight: 800;
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

            .theme-workspace {
                position: fixed;
                inset: 0;
                z-index: 2147483647;
                pointer-events: none;
            }

            .theme-workspace.is-inspecting {
                pointer-events: auto;
                cursor: crosshair;
            }

            .theme-workspace.is-inspecting .theme-panel {
                cursor: default;
            }

            .theme-workspace .theme-panel {
                position: fixed;
                right: 18px;
                bottom: 18px;
                width: min(340px, calc(100vw - 24px));
                max-height: min(610px, calc(100vh - 24px));
                border: 1px solid #cbdde5;
                border-radius: 16px;
                overflow: auto;
                pointer-events: auto;
                box-shadow: 0 18px 54px rgba(8, 42, 61, 0.28);
                will-change: transform;
                animation: themePanelIn 170ms cubic-bezier(0.2, 0.8, 0.2, 1);
            }

            .theme-workspace .theme-panel.is-dragging {
                animation: none;
                user-select: none;
            }

            .theme-workspace .theme-header {
                align-items: center;
                padding: 13px 14px;
                cursor: grab;
                user-select: none;
                touch-action: none;
            }

            .theme-workspace .theme-header:active { cursor: grabbing; }
            .theme-workspace .theme-title { font-size: 16px; }
            .theme-workspace .theme-subtitle { margin-top: 3px; font-size: 10px; }
            .theme-workspace .theme-close { width: 30px; height: 30px; font-size: 18px; }
            .theme-workspace .theme-body { padding: 14px; }

            .theme-target-row {
                display: grid;
                grid-template-columns: minmax(0, 1fr) auto;
                gap: 9px;
                align-items: stretch;
                margin-bottom: 12px;
            }

            .theme-target {
                min-width: 0;
                padding: 9px 10px;
                border: 1px solid var(--line);
                border-radius: 10px;
                background: #f7fafc;
            }

            .theme-target span { display: block; color: var(--muted); font-size: 9px; font-weight: 800; }
            .theme-target strong { display: block; overflow: hidden; margin-top: 3px; color: var(--ink); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }

            .theme-hierarchy {
                display: flex;
                gap: 5px;
                margin: -3px 0 11px;
                padding: 2px 1px 5px;
                overflow-x: auto;
                scrollbar-width: thin;
            }

            .theme-hierarchy[hidden] { display: none; }

            .theme-hierarchy button {
                flex: 0 0 auto;
                min-height: 27px;
                padding: 4px 8px;
                border: 1px solid #d5e1e6;
                border-radius: 7px;
                color: #617582;
                background: #fff;
                cursor: pointer;
                font: 700 10px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace;
            }

            .theme-hierarchy button.is-active {
                border-color: #168eb5;
                color: #075f88;
                background: #e9f7fb;
            }

            .theme-inspect {
                border: 1px solid #0a78ad;
                border-radius: 10px;
                padding: 0 12px;
                color: #0a6f9f;
                background: #edf8fc;
                cursor: pointer;
                font-size: 11px;
                font-weight: 800;
            }

            .theme-inspect.is-active { color: #fff; background: #0a78ad; }

            .theme-property {
                display: grid;
                grid-template-columns: repeat(3, minmax(0, 1fr));
                gap: 3px;
                margin-bottom: 10px;
                padding: 3px;
                border: 1px solid var(--line);
                border-radius: 9px;
                background: #eef4f7;
            }

            .theme-property button {
                height: 32px;
                border: 0;
                border-radius: 6px;
                color: #627483;
                background: transparent;
                cursor: pointer;
                font-size: 11px;
                font-weight: 800;
            }

            .theme-property button.is-active {
                color: #075f88;
                background: #fff;
                box-shadow: 0 1px 5px rgba(13, 61, 82, 0.12);
            }

            .theme-workspace .theme-fields { grid-template-columns: 48px minmax(0, 1fr); }
            .theme-workspace .theme-color-input { width: 48px; height: 40px; }
            .theme-workspace .theme-input { height: 40px; font-size: 13px; }

            .theme-recents-label { margin: 13px 0 7px; color: var(--muted); font-size: 9px; font-weight: 800; letter-spacing: .08em; }
            .theme-recents { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); min-height: 34px; gap: 7px; }
            .theme-recent-color {
                position: relative;
                width: 100%;
                height: 34px;
                padding: 0;
                border: 2px solid #fff;
                border-radius: 8px;
                background: var(--recent-color);
                box-shadow: 0 0 0 1px #c7d5dc;
                cursor: pointer;
            }

            .theme-recent-color::after {
                content: attr(data-color);
                position: absolute;
                bottom: calc(100% + 6px);
                left: 50%;
                z-index: 3;
                padding: 4px 6px;
                border-radius: 5px;
                color: #fff;
                background: #263640;
                font: 700 9px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
                opacity: 0;
                pointer-events: none;
                transform: translate(-50%, 3px);
                transition: opacity 120ms ease, transform 120ms ease;
            }

            .theme-recent-color:hover::after,
            .theme-recent-color:focus-visible::after {
                opacity: 1;
                transform: translate(-50%, 0);
            }
            .theme-recent-placeholder {
                height: 34px;
                border: 1px dashed #cfdae0;
                border-radius: 8px;
                background: #f7fafb;
            }

            .theme-utility-actions {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 7px;
                margin-top: 12px;
            }

            .theme-utility-button {
                min-height: 32px;
                border: 1px solid #d9e3e8;
                border-radius: 8px;
                color: #647682;
                background: #f8fafb;
                cursor: pointer;
                font-size: 10px;
                font-weight: 800;
            }

            .theme-utility-button.wide { grid-column: 1 / -1; }

            .theme-workspace .theme-help { margin-top: 11px; }
            .theme-workspace .theme-actions { padding: 11px 14px 13px; }
            .theme-workspace .theme-button { min-height: 34px; padding: 6px 12px; font-size: 10px; }

            :host-context(html.klpf-theme-inspecting) .theme-panel { box-shadow: 0 0 0 2px #16a2c7, 0 18px 54px rgba(8, 42, 61, 0.28); }

            @media (max-width: 520px) {
                .theme-workspace .theme-panel { right: 8px; bottom: 8px; width: calc(100vw - 16px); max-height: calc(100vh - 16px); border-radius: 14px; }
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
            <div class="theme-workspace">
                <form class="theme-panel" role="dialog" aria-labelledby="klpf-theme-title" novalidate>
                    <header class="theme-header" data-theme-drag-handle>
                        <div>
                            <h2 class="theme-title" id="klpf-theme-title">テーマカラー</h2>
                        </div>
                        <button type="button" class="theme-close" aria-label="閉じる">×</button>
                    </header>
                    <div class="theme-body">
                        <div class="theme-target-row">
                            <div class="theme-target"><span>選択中</span><strong data-theme-target-label>未選択</strong></div>
                            <button type="button" class="theme-inspect" data-theme-inspect>要素を選択</button>
                        </div>
                        <div class="theme-hierarchy" data-theme-hierarchy hidden></div>
                        <div class="theme-property" data-theme-property role="radiogroup" aria-label="変更する色">
                            <button type="button" data-theme-property-value="color" role="radio">文字</button>
                            <button type="button" data-theme-property-value="background-color" role="radio">背景</button>
                            <button type="button" data-theme-property-value="border-color" role="radio">枠線</button>
                        </div>
                        <div class="theme-fields">
                            <input class="theme-color-input" type="color" data-theme-picker aria-label="カラーピッカー">
                            <input class="theme-input" type="text" inputmode="text" maxlength="7" autocomplete="off" spellcheck="false" data-theme-hex aria-label="16進数カラー">
                        </div>
                        <p class="theme-recents-label">最近使った色</p>
                        <div class="theme-recents" data-theme-recents></div>
                        <div class="theme-utility-actions">
                            <button type="button" class="theme-utility-button" data-theme-preset-save>プリセット保存</button>
                            <button type="button" class="theme-utility-button" data-theme-preset-restore>プリセット復元</button>
                            <button type="button" class="theme-utility-button wide" data-theme-reset-selected>規定色に戻す</button>
                        </div>
                        <p class="theme-status" data-theme-status aria-live="polite"></p>
                    </div>
                    <footer class="theme-actions">
                        <button type="button" class="theme-button reset" data-theme-reset-all>すべて規定色に戻す</button>
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

    function getThemeElementLabel(element) {
        if (!(element instanceof Element)) return '未選択';
        const className = [...element.classList].filter(name => !name.startsWith('klpf-')).slice(0, 2).join('.');
        const identity = element.id ? `#${element.id}` : (className ? `.${className}` : '');
        const text = element.textContent?.replace(/\s+/g, ' ').trim().slice(0, 28);
        return `${element.tagName.toLowerCase()}${identity}${text ? ` · ${text}` : ''}`;
    }

    function getThemeHierarchyLabel(element) {
        if (!(element instanceof Element)) return '';
        if (element.id && !element.id.startsWith('fc-dom-')) return `#${element.id}`;
        const className = [...element.classList].find(name => !name.startsWith('klpf-'));
        return className ? `.${className}` : element.tagName.toLowerCase();
    }

    function renderThemeHierarchy() {
        const container = themeShadowRoot?.querySelector('[data-theme-hierarchy]');
        if (!container) return;
        container.replaceChildren();
        const hierarchy = selectedThemeHierarchy.filter(element => element?.isConnected).slice(0, 7);
        container.hidden = hierarchy.length < 2;
        for (const element of hierarchy) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = getThemeHierarchyLabel(element);
            button.title = getThemeElementLabel(element);
            button.classList.toggle('is-active', element === selectedThemeTarget);
            button.addEventListener('click', () => {
                selectedThemeTarget?.removeAttribute('data-klpf-theme-selected');
                selectedThemeTarget = element;
                selectedThemeTarget.setAttribute('data-klpf-theme-selected', '');
                syncSelectedThemeControls();
            });
            container.appendChild(button);
        }
    }

    function buildThemeSelector(element) {
        if (!(element instanceof Element)) return null;
        if (element.id && !element.id.startsWith('klpf-') && !element.id.startsWith('fc-dom-')) {
            const selector = `#${CSS.escape(element.id)}`;
            if (document.querySelectorAll(selector).length === 1) return selector;
        }

        const classes = [...element.classList]
            .filter(name => !name.startsWith('klpf-') && !/^is-|^active$|^hover$/.test(name))
            .slice(0, 3);
        if (classes.length > 0) {
            const selector = `${element.tagName.toLowerCase()}${classes.map(name => `.${CSS.escape(name)}`).join('')}`;
            return selector;
        }

        let classAncestor = element.parentElement;
        while (classAncestor && classAncestor !== document.body) {
            const ancestorClasses = [...classAncestor.classList]
                .filter(name => !name.startsWith('klpf-') && !/^is-|^active$|^hover$/.test(name))
                .slice(0, 2);
            if (ancestorClasses.length > 0) {
                const ancestorSelector = `${classAncestor.tagName.toLowerCase()}${ancestorClasses.map(name => `.${CSS.escape(name)}`).join('')}`;
                return `${ancestorSelector} > ${element.tagName.toLowerCase()}`;
            }
            classAncestor = classAncestor.parentElement;
        }

        const parts = [];
        let current = element;
        while (current && current !== document.body && parts.length < 6) {
            let part = current.tagName.toLowerCase();
            if (current.id && !current.id.startsWith('fc-dom-')) {
                part = `#${CSS.escape(current.id)}`;
                parts.unshift(part);
                return parts.join(' > ');
            }
            const siblings = current.parentElement
                ? [...current.parentElement.children].filter(sibling => sibling.tagName === current.tagName)
                : [];
            if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
            parts.unshift(part);
            current = current.parentElement;
        }
        return parts.length > 0 ? `body > ${parts.join(' > ')}` : null;
    }

    function getSelectedThemeRule() {
        if (!selectedThemeTarget) return null;
        const selector = buildThemeSelector(selectedThemeTarget);
        return draftElementRules.find(rule => rule.selector === selector && rule.property === selectedThemeProperty) || null;
    }

    function renderRecentThemeColors() {
        const container = themeShadowRoot?.querySelector('[data-theme-recents]');
        if (!container) return;
        container.replaceChildren();
        for (let index = 0; index < 5; index += 1) {
            const color = draftRecentColors[index];
            if (!color) {
                const placeholder = document.createElement('span');
                placeholder.className = 'theme-recent-placeholder';
                placeholder.setAttribute('aria-hidden', 'true');
                container.appendChild(placeholder);
                continue;
            }
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'theme-recent-color';
            button.style.setProperty('--recent-color', color);
            button.title = color;
            button.dataset.color = color;
            button.setAttribute('aria-label', `最近使った色 ${color}`);
            button.addEventListener('click', () => previewSelectedThemeColor(color));
            container.appendChild(button);
        }
    }

    async function recordRecentThemeColor(value) {
        const color = normalizeHexColor(value);
        if (!color) return;
        recentThemeColors = normalizeRecentColors([color, ...recentThemeColors]);
        draftRecentColors = [...recentThemeColors];
        renderRecentThemeColors();
        await storageSet('local', { [THEME_RECENT_COLORS_STORAGE_KEY]: recentThemeColors });
    }

    function syncSelectedThemeControls() {
        const label = themeShadowRoot?.querySelector('[data-theme-target-label]');
        const picker = themeShadowRoot?.querySelector('[data-theme-picker]');
        const hex = themeShadowRoot?.querySelector('[data-theme-hex]');
        const propertyButtons = [...themeShadowRoot?.querySelectorAll('[data-theme-property-value]') || []];
        const reset = themeShadowRoot?.querySelector('[data-theme-reset-selected]');
        if (label) label.textContent = getThemeElementLabel(selectedThemeTarget);
        renderThemeHierarchy();
        for (const button of propertyButtons) {
            const isActive = button.dataset.themePropertyValue === selectedThemeProperty;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-checked', String(isActive));
        }

        const disabled = !selectedThemeTarget;
        if (picker) picker.disabled = disabled;
        if (hex) hex.disabled = disabled;
        propertyButtons.forEach(button => { button.disabled = disabled; });
        if (reset) reset.disabled = disabled;
        if (disabled) return;

        const rule = getSelectedThemeRule();
        const computed = getComputedStyle(selectedThemeTarget).getPropertyValue(selectedThemeProperty);
        const color = rule?.color || cssColorToHex(computed) || FALLBACK_THEME_COLOR;
        if (picker) picker.value = color;
        if (hex) {
            hex.value = color;
            hex.setAttribute('aria-invalid', 'false');
        }
    }

    function previewSelectedThemeColor(value) {
        const color = normalizeHexColor(value);
        if (!color || !selectedThemeTarget) return;
        const selector = buildThemeSelector(selectedThemeTarget);
        if (!selector) return;
        const keyMatches = rule => rule.selector === selector && rule.property === selectedThemeProperty;
        const rule = { selector, property: selectedThemeProperty, color, label: getThemeElementLabel(selectedThemeTarget) };
        const index = draftElementRules.findIndex(keyMatches);
        if (index >= 0) draftElementRules[index] = rule;
        else draftElementRules.push(rule);
        const selectionKey = `${selector}\u0000${selectedThemeProperty}`;
        draftColorSelections.delete(selectionKey);
        draftColorSelections.set(selectionKey, color);
        applyThemeColors(draftThemeBaseColors, draftElementRules);
        syncSelectedThemeControls();
    }

    function clearThemeHighlight() {
        themeHoveredElement?.removeAttribute('data-klpf-theme-hover');
        themeHoveredElement = null;
        document.documentElement.classList.remove('klpf-theme-inspecting');
    }

    function stopThemeInspection() {
        themeInspectMode = false;
        clearThemeHighlight();
        const button = themeShadowRoot?.querySelector('[data-theme-inspect]');
        const workspace = themeShadowRoot?.querySelector('.theme-workspace');
        button?.classList.remove('is-active');
        workspace?.classList.remove('is-inspecting');
        if (button) button.textContent = '要素を選択';
        themeInspectCandidates = [];
        workspace?.removeEventListener('pointermove', handleThemeInspectHover);
        workspace?.removeEventListener('pointerdown', handleThemeInspectPointerDown);
        syncSelectedThemeControls();
    }

    function handleThemeInspectHover(event) {
        const workspace = themeShadowRoot?.querySelector('.theme-workspace');
        const panel = themeShadowRoot?.querySelector('.theme-panel');
        if (!workspace || event.composedPath().includes(panel)) return;
        workspace.style.pointerEvents = 'none';
        const element = document.elementsFromPoint(event.clientX, event.clientY)
            .find(candidate => candidate !== themeRootElement && !candidate.closest(`#${THEME_ROOT_ID}`));
        workspace.style.pointerEvents = '';
        if (!element) return;
        const candidates = [];
        let current = element;
        while (current && current !== document.documentElement) {
            if (current !== document.body && current !== themeRootElement && !current.closest(`#${THEME_ROOT_ID}`)) {
                candidates.push(current);
            }
            current = current.parentElement;
        }
        themeInspectCandidates = [...new Set(candidates)];
        themeHoveredElement?.removeAttribute('data-klpf-theme-hover');
        themeHoveredElement = themeInspectCandidates[0] || element;
        themeHoveredElement.setAttribute('data-klpf-theme-hover', '');
        const label = themeShadowRoot?.querySelector('[data-theme-target-label]');
        if (label) label.textContent = getThemeElementLabel(themeHoveredElement);
    }

    function handleThemeInspectPointerDown(event) {
        const panel = themeShadowRoot?.querySelector('.theme-panel');
        if (event.composedPath().includes(panel)) return;
        const element = themeHoveredElement;
        if (!element) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const backgroundTarget = element.closest('.courseCardInfo, .lms-news-block');
        selectedThemeTarget?.removeAttribute('data-klpf-theme-selected');
        selectedThemeTarget = backgroundTarget || element;
        selectedThemeHierarchy = themeInspectCandidates.includes(selectedThemeTarget)
            ? [...themeInspectCandidates]
            : [selectedThemeTarget, ...themeInspectCandidates];
        selectedThemeTarget.setAttribute('data-klpf-theme-selected', '');
        selectedThemeProperty = backgroundTarget ? 'background-color' : 'color';
        stopThemeInspection();
        syncSelectedThemeControls();
        setThemeStatus('要素を選択しました。');
    }

    function startThemeInspection() {
        if (themeInspectMode) {
            stopThemeInspection();
            return;
        }
        themeInspectMode = true;
        document.documentElement.classList.add('klpf-theme-inspecting');
        const button = themeShadowRoot?.querySelector('[data-theme-inspect]');
        const workspace = themeShadowRoot?.querySelector('.theme-workspace');
        button?.classList.add('is-active');
        workspace?.classList.add('is-inspecting');
        if (button) button.textContent = '選択中…';
        workspace?.addEventListener('pointermove', handleThemeInspectHover);
        workspace?.addEventListener('pointerdown', handleThemeInspectPointerDown);
        setThemeStatus('色を変えたい要素をクリックしてください。');
    }

    function addThemeDragging(panel) {
        const handle = themeShadowRoot.querySelector('[data-theme-drag-handle]');
        handle.addEventListener('pointerdown', (event) => {
            if (event.target.closest('button')) return;
            const rect = panel.getBoundingClientRect();
            const startX = event.clientX;
            const startY = event.clientY;
            let offsetX = 0;
            let offsetY = 0;
            let animationFrame = null;
            panel.classList.add('is-dragging');
            handle.setPointerCapture(event.pointerId);
            const move = (moveEvent) => {
                moveEvent.preventDefault();
                offsetX = Math.max(8 - rect.left, Math.min(window.innerWidth - rect.width - 8 - rect.left, moveEvent.clientX - startX));
                offsetY = Math.max(8 - rect.top, Math.min(window.innerHeight - rect.height - 8 - rect.top, moveEvent.clientY - startY));
                if (animationFrame !== null) return;
                animationFrame = window.requestAnimationFrame(() => {
                    animationFrame = null;
                    panel.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0)`;
                });
            };
            const end = () => {
                if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
                panel.style.right = 'auto';
                panel.style.bottom = 'auto';
                panel.style.left = `${rect.left + offsetX}px`;
                panel.style.top = `${rect.top + offsetY}px`;
                panel.style.transform = 'none';
                panel.classList.remove('is-dragging');
                handle.removeEventListener('pointermove', move);
                handle.removeEventListener('pointerup', end);
                handle.removeEventListener('pointercancel', end);
            };
            handle.addEventListener('pointermove', move);
            handle.addEventListener('pointerup', end);
            handle.addEventListener('pointercancel', end);
        });
    }

    function closeThemePanel({ restoreSavedColor = true } = {}) {
        if (!isThemeOpen) return;
        stopThemeInspection();
        selectedThemeTarget?.removeAttribute('data-klpf-theme-selected');
        selectedThemeTarget = null;
        selectedThemeHierarchy = [];
        if (restoreSavedColor) applyThemeColors(persistedThemeColors, persistedElementRules);

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
            if (themeInspectMode) stopThemeInspection();
            else closeThemePanel();
        }
    }

    function addThemePanelListeners() {
        const panel = themeShadowRoot.querySelector('.theme-panel');
        const inspectButton = themeShadowRoot.querySelector('[data-theme-inspect]');
        const picker = themeShadowRoot.querySelector('[data-theme-picker]');
        const hexInput = themeShadowRoot.querySelector('[data-theme-hex]');
        const propertyButtons = [...themeShadowRoot.querySelectorAll('[data-theme-property-value]')];
        const closeButton = themeShadowRoot.querySelector('.theme-close');
        const cancelButton = themeShadowRoot.querySelector('[data-theme-cancel]');
        const resetButton = themeShadowRoot.querySelector('[data-theme-reset-selected]');
        const resetAllButton = themeShadowRoot.querySelector('[data-theme-reset-all]');
        const presetSaveButton = themeShadowRoot.querySelector('[data-theme-preset-save]');
        const presetRestoreButton = themeShadowRoot.querySelector('[data-theme-preset-restore]');

        themeShadowRoot.addEventListener('keydown', handleThemeFocusTrap);
        closeButton.addEventListener('click', () => closeThemePanel());
        cancelButton.addEventListener('click', () => closeThemePanel());
        inspectButton.addEventListener('click', startThemeInspection);
        picker.addEventListener('input', () => previewSelectedThemeColor(picker.value));
        picker.addEventListener('change', () => {
            recordRecentThemeColor(picker.value).catch((error) => {
                console.warn('[KLPF] 最近使った色を保存できませんでした。', error);
            });
        });
        hexInput.addEventListener('input', () => {
            const color = normalizeHexColor(hexInput.value);
            if (!color) {
                hexInput.setAttribute('aria-invalid', 'true');
                return;
            }
            previewSelectedThemeColor(color);
        });
        hexInput.addEventListener('change', () => {
            recordRecentThemeColor(hexInput.value).catch((error) => {
                console.warn('[KLPF] 最近使った色を保存できませんでした。', error);
            });
        });
        for (const propertyButton of propertyButtons) {
            propertyButton.addEventListener('click', () => {
                const value = propertyButton.dataset.themePropertyValue;
                selectedThemeProperty = THEME_ALLOWED_PROPERTIES.includes(value) ? value : 'color';
                syncSelectedThemeControls();
            });
        }
        resetButton.addEventListener('click', () => {
            if (!selectedThemeTarget) return;
            const affectsSelection = (ruleSelector, property) => {
                if (property !== selectedThemeProperty) return false;
                try {
                    return selectedThemeTarget.matches(ruleSelector)
                        || (property === 'color' && !!selectedThemeTarget.closest(ruleSelector));
                } catch {
                    return false;
                }
            };
            draftElementRules = draftElementRules.filter(rule => !affectsSelection(rule.selector, rule.property));
            for (const key of [...draftColorSelections.keys()]) {
                const [ruleSelector, property] = key.split('\u0000');
                if (affectsSelection(ruleSelector, property)) draftColorSelections.delete(key);
            }
            for (const config of THEME_COLOR_CONFIG) {
                if (config.property !== selectedThemeProperty || !draftThemeBaseColors[config.key]) continue;
                if (config.selectors.some(configSelector => affectsSelection(configSelector, config.property))) {
                    delete draftThemeBaseColors[config.key];
                }
            }
            applyThemeColors(draftThemeBaseColors, draftElementRules);
            syncSelectedThemeControls();
            setThemeStatus('選択した色指定をサイト既定へ戻しました。');
        });
        resetAllButton.addEventListener('click', () => {
            draftThemeBaseColors = {};
            draftElementRules = [];
            draftColorSelections.clear();
            applyThemeColors({}, []);
            syncSelectedThemeControls();
            setThemeStatus('すべての色指定をサイト既定へ戻しました。');
        });
        presetSaveButton.addEventListener('click', async () => {
            const preset = {
                colors: normalizeThemeColors(draftThemeBaseColors),
                elementRules: normalizeElementRules(draftElementRules),
                savedAt: new Date().toISOString(),
            };
            try {
                await storageSet('local', { [THEME_PRESET_STORAGE_KEY]: preset });
                setThemeStatus('現在の配色をプリセットに保存しました。');
            } catch (error) {
                setThemeStatus('プリセットを保存できませんでした。', true);
                console.warn('[KLPF] テーマカラープリセットを保存できませんでした。', error);
            }
        });
        presetRestoreButton.addEventListener('click', async () => {
            try {
                const stored = await storageGet('local', THEME_PRESET_STORAGE_KEY);
                const preset = normalizeThemePreset(stored[THEME_PRESET_STORAGE_KEY]);
                if (!preset) {
                    setThemeStatus('保存済みのプリセットがありません。', true);
                    return;
                }
                draftThemeBaseColors = { ...preset.colors };
                draftElementRules = preset.elementRules.map(rule => ({ ...rule }));
                draftColorSelections.clear();
                applyThemeColors(draftThemeBaseColors, draftElementRules);
                syncSelectedThemeControls();
                setThemeStatus('プリセットを復元しました。「保存」で確定します。');
            } catch (error) {
                setThemeStatus('プリセットを復元できませんでした。', true);
                console.warn('[KLPF] テーマカラープリセットを復元できませんでした。', error);
            }
        });

        panel.addEventListener('submit', async (event) => {
            event.preventDefault();
            persistedThemeColors = normalizeThemeColors(draftThemeBaseColors);
            persistedElementRules = normalizeElementRules(draftElementRules);
            recentThemeColors = normalizeRecentColors(draftRecentColors);
            await storageSet('local', {
                [THEME_COLORS_STORAGE_KEY]: persistedThemeColors,
                [THEME_ELEMENT_RULES_STORAGE_KEY]: persistedElementRules,
                [THEME_RECENT_COLORS_STORAGE_KEY]: recentThemeColors,
            });
            await chrome.storage.local.remove(LEGACY_THEME_COLOR_STORAGE_KEY);
            applyThemeColors(persistedThemeColors, persistedElementRules);
            closeThemePanel({ restoreSavedColor: false });
        });
        addThemeDragging(panel);
    }

    async function openThemePanel() {
        if (isThemeOpen) {
            themeShadowRoot?.querySelector('.theme-input')?.focus();
            return;
        }

        await loadState();
        if (state.allDisabled) return;
        themeLastFocusedElement = document.activeElement;
        await loadAndApplyThemeColors();
        draftThemeBaseColors = { ...persistedThemeColors };
        draftElementRules = persistedElementRules.map(rule => ({ ...rule }));
        draftRecentColors = [...recentThemeColors];
        draftColorSelections = new Map();
        selectedThemeTarget = null;
        selectedThemeHierarchy = [];
        isThemeOpen = true;
        updatePageScrollLock('theme-support', false);

        ensureThemeRoot();
        themeShadowRoot.innerHTML = getThemePanelMarkup();
        syncSelectedThemeControls();
        renderRecentThemeColors();
        addThemePanelListeners();
        themeShadowRoot.querySelector('[data-theme-inspect]')?.focus();
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
        hasLoadedState = true;
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
        updatePageScrollLock('settings', false);
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
        updatePageScrollLock('settings', true);
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
            syncOptionalCustomizationState();
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
        syncOptionalCustomizationState();
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
        label.textContent = 'テーマカラー変更';

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

    function buildHomeEditorMenuItem() {
        const item = document.createElement('li');
        item.setAttribute(HOME_EDITOR_MENU_ITEM_ATTRIBUTE, '');

        const link = document.createElement('a');
        link.href = '#';
        const label = document.createElement('span');
        label.textContent = 'ホームの表示を編集';
        link.appendChild(label);
        link.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            document.dispatchEvent(new CustomEvent(OPEN_HOME_EDITOR_EVENT));
        });
        item.appendChild(link);
        return item;
    }

    function buildCustomImageThemeMenuItem() {
        const item = document.createElement('li');
        item.setAttribute(CUSTOM_IMAGE_THEME_MENU_ITEM_ATTRIBUTE, '');

        const link = document.createElement('a');
        link.href = '#';

        const label = document.createElement('span');
        label.textContent = 'カスタム画像テーマ';

        link.appendChild(label);
        link.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            document.dispatchEvent(new CustomEvent(OPEN_CUSTOM_IMAGE_THEME_EVENT));
        });
        item.appendChild(link);
        return item;
    }

    function getSettingsMenus() {
        return [...new Set([
            ...document.querySelectorAll('.selectBoxSettei.lms-user-menu .selectBox.lms-sp-user-menu'),
            document.getElementById('addKojinComment'),
            document.getElementById('addKojinCommentSp'),
        ].filter((element) => element instanceof HTMLElement
            && (element.matches('ul, ol') || element.classList.contains('selectBox'))))];
    }

    function injectMenuItem() {
        const menus = getSettingsMenus();
        const menuSet = new Set(menus);
        document.querySelectorAll(`#${MENU_ITEM_ID}, [${HOME_EDITOR_MENU_ITEM_ATTRIBUTE}], [${THEME_MENU_ITEM_ATTRIBUTE}], [${CUSTOM_IMAGE_THEME_MENU_ITEM_ATTRIBUTE}]`).forEach((item) => {
            if (!menuSet.has(item.parentElement)) item.remove();
        });

        for (const menu of menus) {
            let settingsItem = menu.querySelector(`#${MENU_ITEM_ID}`);
            if (!settingsItem) {
                settingsItem = buildMenuItem();
                menu.appendChild(settingsItem);
            }

            if (!hasLoadedState || state.allDisabled) {
                menu.querySelector(`[${HOME_EDITOR_MENU_ITEM_ATTRIBUTE}]`)?.remove();
                menu.querySelector(`[${THEME_MENU_ITEM_ATTRIBUTE}]`)?.remove();
                menu.querySelector(`[${CUSTOM_IMAGE_THEME_MENU_ITEM_ATTRIBUTE}]`)?.remove();
                continue;
            }

            const canEditHome = !!document.querySelector('div.lms-menu-column.lms-home');
            let homeEditorItem = menu.querySelector(`[${HOME_EDITOR_MENU_ITEM_ATTRIBUTE}]`);
            if (canEditHome) {
                if (!homeEditorItem) homeEditorItem = buildHomeEditorMenuItem();
                if (settingsItem.nextElementSibling !== homeEditorItem) {
                    settingsItem.insertAdjacentElement('afterend', homeEditorItem);
                }
            } else {
                homeEditorItem?.remove();
                homeEditorItem = null;
            }

            let themeItem = menu.querySelector(`[${THEME_MENU_ITEM_ATTRIBUTE}]`);
            if (!themeItem) themeItem = buildThemeMenuItem();

            const themeAnchor = homeEditorItem || settingsItem;
            if (themeAnchor.nextElementSibling !== themeItem) {
                themeAnchor.insertAdjacentElement('afterend', themeItem);
            }

            let customImageThemeItem = menu.querySelector(`[${CUSTOM_IMAGE_THEME_MENU_ITEM_ATTRIBUTE}]`);
            if (!customImageThemeItem) customImageThemeItem = buildCustomImageThemeMenuItem();
            if (menu.lastElementChild !== customImageThemeItem) {
                menu.appendChild(customImageThemeItem);
            }
        }
    }

    function syncOptionalCustomizationState() {
        injectMenuItem();
        if (state.allDisabled) {
            closeThemePanel({ restoreSavedColor: false });
            applyThemeColors({}, []);
            return;
        }

        loadAndApplyThemeColors().catch((error) => {
            console.warn('[KLPF] サイトテーマ色を復元できませんでした。', error);
        });
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
            hasLoadedState = true;
            syncOptionalCustomizationState();
            if (!isOpen) return;
            loadState().then(applyStateToControls);
        }

        if (area === 'local'
            && (changes[THEME_COLORS_STORAGE_KEY]
                || changes[LEGACY_THEME_COLOR_STORAGE_KEY]
                || changes[THEME_ELEMENT_RULES_STORAGE_KEY]
                || changes[THEME_RECENT_COLORS_STORAGE_KEY])) {
            if (!isThemeOpen) {
                loadAndApplyThemeColors().catch((error) => {
                    console.warn('[KLPF] サイトテーマ色の同期に失敗しました。', error);
                });
            }
        }
    });

    loadFeatureDefinitions()
        .then(loadState)
        .then(injectMenuItem)
        .catch((error) => {
            console.warn('[KLPF] KU-LMS内設定の初期状態読み込みに失敗しました。', error);
        });
    loadAndApplyThemeColors().catch((error) => {
        console.warn('[KLPF] サイトテーマ色を読み込めませんでした。', error);
    });

    globalThis[INSTANCE_KEY] = {
        refresh() {
            loadState()
                .then(syncOptionalCustomizationState)
                .catch((error) => {
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
