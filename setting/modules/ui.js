// Copyright (c) 2024-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 設定ページのUI操作と視覚効果を管理するモジュール
 * @module modules/ui
 */

import { CONTENT_SCRIPTS_CONFIG } from '../../scripts.config.js';

// --- 定数定義 ---
const PARTICLE_COUNT = 75;
const LOADING_SCREEN_DURATION = 2000; // ms（進行80%から始まる全画面スイープの完了を待つ）
const FADE_OUT_DURATION = 1300; // ms
const STATUS_MESSAGE_DURATION = 3000; // ms
const ANIMATION_DURATION = 500; // ms, CSSのtransitionと合わせる
const OPTIONS_VIEW_MODE_STORAGE_KEY = 'optionsViewMode';
const OPTIONS_VIEW_MODE_VIVID = 'vivid';
const OPTIONS_VIEW_MODE_CALM = 'calm';
const OPTIONS_VIEW_COVER_DURATION = 220;
const OPTIONS_VIEW_REVEAL_DURATION = 440;
const ALL_FEATURES_DISABLED_KEY = 'klpfInlineAllFeaturesDisabled';
const PREVIOUS_FEATURE_SETTINGS_KEY = 'klpfInlinePreviousFeatureSettings';
const ATTENDANCE_RATE_CONSENT_KEY = 'attendanceRateAccessConsent';

// --- DOM要素のキャッシュ ---
const elements = {
    statusMessage: null,
    loadingScreen: null,
    particleCanvas: null,
    customCursor: null,
    updateNotification: null,
    updateNotificationTitle: null,
    optionsViewToggle: null,
    optionsViewToggleLabel: null,
    optionsViewTransition: null,
    allFeaturesToggle: null,
    allFeaturesToggleStatus: null,
    settingsHeadingTitle: null,
    // 機能スイッチ
    autoLoginCheckbox: null,
    autoAttendCheckbox: null,
    autoMeetCheckbox: null,
    darkModeCheckbox: null,
    customThemeCheckbox: null,
    homeworkSwitch: null,
    homeworkNotificationCheckbox: null,
    // Webhook URL
    homeworkWebhookUrlInput: null,
    // オプションパネル
    optionsPanel: null,
    autoLoginOptions: null,
    autoAttendOptions: null,
    homeworkOptions: null,
    // モーダル
    validationModal: null,
    modalMessage: null,
    modalLink: null,
    modalCloseButton: null,
    // TOTP
    totpSecretInput: null,
    totpStatus: null,
};

let currentOptionsViewMode = null;
let optionsViewStorageListenerRegistered = false;
let optionsViewTransitionInProgress = false;
let calmNavigationInitialized = false;
let calmNavigationScrollFrame = null;
let allFeaturesStorageListenerRegistered = false;
let allFeaturesToggleInProgress = false;
const featureToggleAnimationCleanups = new WeakMap();

/**
 * DOM要素を一度だけ検索し、キャッシュする。
 */
function cacheDOMElements() {
    elements.statusMessage = document.getElementById("status");
    elements.loadingScreen = document.querySelector('.loading');
    elements.particleCanvas = document.getElementById('particle-canvas');
    elements.customCursor = document.querySelector('.custom-cursor');
    elements.updateNotification = document.getElementById('update-notification');
    elements.updateNotificationTitle = document.getElementById('update-notification-title');
    elements.optionsViewToggle = document.getElementById('options-view-toggle');
    elements.optionsViewToggleLabel = document.getElementById('options-view-toggle-label');
    elements.optionsViewTransition = document.querySelector('.options-view-transition');
    elements.allFeaturesToggle = document.getElementById('all-features-toggle');
    elements.allFeaturesToggleStatus = document.getElementById('all-features-toggle-status');
    elements.settingsHeadingTitle = document.querySelector('.settings-heading .box_color');

    // 機能スイッチ
    elements.autoLoginCheckbox = document.getElementById("auto-login");
    elements.autoAttendCheckbox = document.getElementById("auto-attend");
    elements.autoMeetCheckbox = document.getElementById('auto-meet');
    elements.darkModeCheckbox = document.getElementById('dark-mode');
    //elements.customThemeCheckbox = document.getElementById('custom-theme');
    elements.homeworkSwitch = document.getElementById('home-work');
    elements.homeworkNotificationCheckbox = document.getElementById('homework-notification');

    // Webhook URL
    elements.homeworkWebhookUrlInput = document.getElementById('homework-webhook-url');

    // オプションパネル
    elements.optionsPanel = document.getElementById('options-panel');
    elements.autoLoginOptions = document.getElementById("auto-login-options");
    elements.autoAttendOptions = document.getElementById("auto-attend-options");
    elements.homeworkOptions = document.getElementById('homework-options');

    // モーダル
    elements.validationModal = document.getElementById('validation-modal');
    elements.modalMessage = document.getElementById('modal-message');
    elements.modalLink = document.getElementById('modal-link');
    elements.modalCloseButton = document.getElementById('modal-close-button');

    // TOTP
    elements.totpSecretInput = document.getElementById('totp-secret');
    elements.totpStatus = document.getElementById('totp-status');
}

function initFeatureMetadata() {
    document.querySelectorAll('.switch-container[data-feature-key]').forEach((container) => {
        const copy = container.querySelector('.switch-copy');
        if (!copy) return;

        const label = copy.querySelector('.switch-label');
        if (label) label.dataset.toggleText = label.textContent.trim();

        if (!copy.querySelector('.switch-description')) {
            const description = document.createElement('p');
            description.className = 'switch-description';
            description.textContent = container.getAttribute('title') || '';
            copy.appendChild(description);
        }
    });
}

function getResolvedFeatureSettings(storedSettings = {}) {
    return CONTENT_SCRIPTS_CONFIG.reduce((settings, feature) => {
        settings[feature.storageKey] = typeof storedSettings[feature.storageKey] === 'boolean'
            ? storedSettings[feature.storageKey]
            : feature.enabledByDefault === true;
        return settings;
    }, {});
}

function applyAllFeaturesDisabledState(disabled) {
    const isDisabled = disabled === true;
    document.body.classList.toggle('is-all-features-disabled', isDisabled);

    if (elements.allFeaturesToggle) {
        elements.allFeaturesToggle.checked = !isDisabled;
        elements.allFeaturesToggle.setAttribute('aria-checked', String(!isDisabled));
    }
    if (elements.allFeaturesToggleStatus) {
        elements.allFeaturesToggleStatus.textContent = isDisabled ? 'OFF' : 'ON';
    }

    document.querySelectorAll('.feature-category, #options-panel').forEach((region) => {
        region.inert = isDisabled;
        region.setAttribute('aria-disabled', String(isDisabled));
    });
}

function playAllFeaturesToggleAnimation(direction) {
    const title = elements.settingsHeadingTitle;
    if (!title) return Promise.resolve();

    const animationClass = direction === 'disable'
        ? 'is-master-disabling'
        : 'is-master-enabling';
    const fallbackDuration = direction === 'disable' ? 1550 : 2250;
    title.classList.remove(
        'is-master-enabling',
        'is-master-disabling',
    );
    void title.offsetWidth;
    title.classList.add(animationClass);

    return new Promise((resolve) => {
        let fallbackTimer = null;
        let hasFinished = false;
        const finish = () => {
            if (hasFinished) return;
            hasFinished = true;
            if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
            title.removeEventListener('animationend', finish);
            title.classList.remove(animationClass);
            resolve();
        };
        title.addEventListener('animationend', finish);
        fallbackTimer = window.setTimeout(finish, fallbackDuration);
    });
}

function playFeatureToggleAnimation(checkbox) {
    const label = checkbox.closest('.switch-container')?.querySelector('.switch-label');
    if (!label) return;

    featureToggleAnimationCleanups.get(label)?.();
    const animationClass = checkbox.checked
        ? 'is-feature-enabling'
        : 'is-feature-disabling';
    const fallbackDuration = checkbox.checked ? 2250 : 1550;
    let fallbackTimer = null;
    let hasFinished = false;

    const finish = () => {
        if (hasFinished) return;
        hasFinished = true;
        if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
        label.removeEventListener('animationend', finish);
        label.classList.remove('is-feature-enabling', 'is-feature-disabling');
        featureToggleAnimationCleanups.delete(label);
    };

    label.classList.remove('is-feature-enabling', 'is-feature-disabling');
    void label.offsetWidth;
    label.classList.add(animationClass);
    label.addEventListener('animationend', finish);
    fallbackTimer = window.setTimeout(finish, fallbackDuration);
    featureToggleAnimationCleanups.set(label, finish);
}

async function disableAllFeatures() {
    const featureKeys = CONTENT_SCRIPTS_CONFIG.map(feature => feature.storageKey);
    const storedSettings = await chrome.storage.sync.get(featureKeys);
    const previousSettings = getResolvedFeatureSettings(storedSettings);
    const disabledSettings = Object.fromEntries(featureKeys.map(key => [key, false]));

    await chrome.storage.local.set({
        [ALL_FEATURES_DISABLED_KEY]: true,
        [PREVIOUS_FEATURE_SETTINGS_KEY]: previousSettings,
    });
    await chrome.storage.sync.set(disabledSettings);
}

async function restoreAllFeatures() {
    const [{ [PREVIOUS_FEATURE_SETTINGS_KEY]: previousSettings = {} }, consentSettings] = await Promise.all([
        chrome.storage.local.get(PREVIOUS_FEATURE_SETTINGS_KEY),
        chrome.storage.sync.get(ATTENDANCE_RATE_CONSENT_KEY),
    ]);
    const restoredSettings = getResolvedFeatureSettings(previousSettings);

    if (consentSettings[ATTENDANCE_RATE_CONSENT_KEY] !== true) {
        restoredSettings.attendanceRateDisplay = false;
    }

    // KU-LMS内の設定画面が復元値を再びOFFへ戻さないよう、停止状態を先に解除する。
    await chrome.storage.local.set({ [ALL_FEATURES_DISABLED_KEY]: false });
    await chrome.storage.sync.set(restoredSettings);
    await chrome.storage.local.set({
        [PREVIOUS_FEATURE_SETTINGS_KEY]: restoredSettings,
    });
}

async function handleAllFeaturesToggle() {
    if (!elements.allFeaturesToggle || allFeaturesToggleInProgress) return;
    allFeaturesToggleInProgress = true;
    elements.allFeaturesToggle.disabled = true;
    const shouldEnable = elements.allFeaturesToggle.checked;

    try {
        if (shouldEnable) {
            await restoreAllFeatures();
            applyAllFeaturesDisabledState(false);
            await playAllFeaturesToggleAnimation('enable');
        } else {
            const animation = playAllFeaturesToggleAnimation('disable');
            await disableAllFeatures();
            applyAllFeaturesDisabledState(true);
            await animation;
        }
    } catch (error) {
        await chrome.storage.local.set({ [ALL_FEATURES_DISABLED_KEY]: shouldEnable });
        applyAllFeaturesDisabledState(shouldEnable);
        document.dispatchEvent(new CustomEvent('settings-error', {
            detail: '拡張機能全体の状態を変更できませんでした。',
        }));
        console.error('拡張機能全体の状態変更に失敗しました。', error);
    } finally {
        allFeaturesToggleInProgress = false;
        elements.allFeaturesToggle.disabled = false;
    }
}

async function initAllFeaturesState() {
    try {
        const stored = await chrome.storage.local.get({ [ALL_FEATURES_DISABLED_KEY]: false });
        applyAllFeaturesDisabledState(stored[ALL_FEATURES_DISABLED_KEY] === true);
    } catch (error) {
        applyAllFeaturesDisabledState(false);
        console.error('拡張機能全体の状態を読み込めませんでした。', error);
    }

    if (allFeaturesStorageListenerRegistered) return;
    allFeaturesStorageListenerRegistered = true;
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes[ALL_FEATURES_DISABLED_KEY]) return;
        applyAllFeaturesDisabledState(changes[ALL_FEATURES_DISABLED_KEY].newValue === true);
    });
}

function setActiveCalmNavigation(sectionId) {
    document.querySelectorAll('.calm-navigation-link').forEach((link) => {
        const isActive = link.dataset.section === sectionId;
        link.classList.toggle('is-active', isActive);
        if (isActive) {
            link.setAttribute('aria-current', 'location');
        } else {
            link.removeAttribute('aria-current');
        }
    });
}

function initCalmNavigation() {
    if (calmNavigationInitialized) return;
    calmNavigationInitialized = true;

    const links = [...document.querySelectorAll('.calm-navigation-link[data-section]')];
    const sections = links
        .map(link => document.getElementById(link.dataset.section))
        .filter(Boolean);

    links.forEach((link) => {
        link.addEventListener('click', (event) => {
            const section = document.getElementById(link.dataset.section);
            if (!section) return;

            event.preventDefault();
            setActiveCalmNavigation(link.dataset.section);
            section.scrollIntoView({
                behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
                block: 'start',
            });
            history.replaceState(null, '', `#${link.dataset.section}`);
        });
    });

    const updateActiveSection = () => {
        calmNavigationScrollFrame = null;
        const isAtPageBottom = window.scrollY + window.innerHeight
            >= document.documentElement.scrollHeight - 2;
        if (isAtPageBottom && sections.length) {
            setActiveCalmNavigation(sections.at(-1).id);
            return;
        }
        const activeSection = sections.reduce((current, section) => (
            section.getBoundingClientRect().top <= 130 ? section : current
        ), sections[0]);
        if (activeSection) setActiveCalmNavigation(activeSection.id);
    };
    window.addEventListener('scroll', () => {
        if (calmNavigationScrollFrame) return;
        calmNavigationScrollFrame = requestAnimationFrame(updateActiveSection);
    }, { passive: true });
    updateActiveSection();
}

// --- UI初期化処理 ---

/**
 * ローディング画面を初期化し、フェードアウトさせる。
 */
function initLoadingScreen() {
    if (!elements.loadingScreen) return;
    window.setTimeout(() => {
        elements.loadingScreen.classList.add('is-leaving');
        window.setTimeout(() => {
            elements.loadingScreen.hidden = true;
        }, FADE_OUT_DURATION);
    }, LOADING_SCREEN_DURATION);
}

/**
 * パーティクルエフェクトを初期化する。
 */
function initParticleEffect() {
    if (!elements.particleCanvas || currentOptionsViewMode !== OPTIONS_VIEW_MODE_VIVID) return;
    const missingParticleCount = Math.max(0, PARTICLE_COUNT - elements.particleCanvas.childElementCount);
    for (let i = 0; i < missingParticleCount; i++) {
        createPowderParticle({ randomizeProgress: true });
    }
}

function normalizeOptionsViewMode(value) {
    return value === OPTIONS_VIEW_MODE_CALM
        ? OPTIONS_VIEW_MODE_CALM
        : OPTIONS_VIEW_MODE_VIVID;
}

function updateOptionsViewToggle() {
    const isCalm = currentOptionsViewMode === OPTIONS_VIEW_MODE_CALM;
    if (elements.optionsViewToggle) {
        elements.optionsViewToggle.setAttribute('aria-pressed', String(isCalm));
        elements.optionsViewToggle.title = isCalm
            ? '旧表示へ戻す'
            : 'モダン表示へ切り替える';
    }
    if (elements.optionsViewToggleLabel) {
        elements.optionsViewToggleLabel.textContent = isCalm
            ? '旧表示に戻す'
            : 'モダン表示に切り替え';
    }
}

async function applyOptionsViewMode(mode, { waitForPanelAnimation = true } = {}) {
    const normalizedMode = normalizeOptionsViewMode(mode);
    if (currentOptionsViewMode === normalizedMode) {
        updateOptionsViewToggle();
        return;
    }

    currentOptionsViewMode = normalizedMode;
    document.body.dataset.optionsView = normalizedMode;
    updateOptionsViewToggle();

    if (normalizedMode === OPTIONS_VIEW_MODE_CALM) {
        elements.particleCanvas?.replaceChildren();
    } else {
        initParticleEffect();
    }
    await reorderAndShowPanels({ waitForAnimation: waitForPanelAnimation });
    requestAnimationFrame(() => window.dispatchEvent(new Event('scroll')));
}

function waitForOptionsViewTransition(duration) {
    return new Promise(resolve => setTimeout(resolve, duration));
}

async function animateOptionsViewOverlay(overlay, keyframes, duration) {
    const animation = overlay.animate(keyframes, {
        duration,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        fill: 'forwards',
    });
    await animation.finished;
    return animation;
}

async function transitionOptionsViewMode(nextMode) {
    const normalizedMode = normalizeOptionsViewMode(nextMode);
    const transitionOverlay = elements.optionsViewTransition;
    if (!transitionOverlay) {
        await applyOptionsViewMode(normalizedMode, { waitForPanelAnimation: false });
        return;
    }

    const targetClass = normalizedMode === OPTIONS_VIEW_MODE_VIVID
        ? 'is-options-view-switching-to-vivid'
        : 'is-options-view-switching-to-calm';
    document.body.classList.remove(
        'is-options-view-revealing',
        'is-options-view-switching-to-vivid',
        'is-options-view-switching-to-calm',
    );
    transitionOverlay.getAnimations().forEach(animation => animation.cancel());
    transitionOverlay.style.backgroundColor = normalizedMode === OPTIONS_VIEW_MODE_VIVID
        ? '#000000'
        : '#ffffff';
    transitionOverlay.style.opacity = '0';
    transitionOverlay.style.transition = 'none';

    try {
        document.body.classList.add('is-options-view-switching', targetClass);

        const coverAnimation = await animateOptionsViewOverlay(
            transitionOverlay,
            [{ opacity: 0 }, { opacity: 1 }],
            OPTIONS_VIEW_COVER_DURATION,
        );
        transitionOverlay.style.opacity = '1';
        coverAnimation.cancel();

        // レイアウトとエフェクトは、画面が完全に覆われている間に準備する。
        await applyOptionsViewMode(normalizedMode, { waitForPanelAnimation: false });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await waitForOptionsViewTransition(80);

        document.body.classList.add('is-options-view-revealing');
        const revealAnimation = await animateOptionsViewOverlay(
            transitionOverlay,
            [{ opacity: 1 }, { opacity: 0 }],
            OPTIONS_VIEW_REVEAL_DURATION,
        );
        transitionOverlay.style.opacity = '0';
        revealAnimation.cancel();
    } finally {
        document.body.classList.remove(
            'is-options-view-switching',
            'is-options-view-revealing',
            targetClass,
        );
        transitionOverlay.getAnimations().forEach(animation => animation.cancel());
        transitionOverlay.style.removeProperty('background-color');
        transitionOverlay.style.removeProperty('opacity');
        transitionOverlay.style.removeProperty('transition');
    }
}

async function handleOptionsViewToggle() {
    if (optionsViewTransitionInProgress) return;
    optionsViewTransitionInProgress = true;
    if (elements.optionsViewToggle) elements.optionsViewToggle.disabled = true;

    const previousMode = currentOptionsViewMode || OPTIONS_VIEW_MODE_CALM;
    const nextMode = previousMode === OPTIONS_VIEW_MODE_CALM
        ? OPTIONS_VIEW_MODE_VIVID
        : OPTIONS_VIEW_MODE_CALM;

    try {
        await transitionOptionsViewMode(nextMode);
        await chrome.storage.local.set({ [OPTIONS_VIEW_MODE_STORAGE_KEY]: nextMode });
    } catch (error) {
        await transitionOptionsViewMode(previousMode);
        document.dispatchEvent(new CustomEvent('settings-error', {
            detail: '表示デザインの保存に失敗しました。',
        }));
        console.error('表示デザインの保存に失敗しました。', error);
    } finally {
        optionsViewTransitionInProgress = false;
        if (elements.optionsViewToggle) elements.optionsViewToggle.disabled = false;
    }
}

async function initOptionsViewMode() {
    try {
        const stored = await chrome.storage.local.get({
            [OPTIONS_VIEW_MODE_STORAGE_KEY]: OPTIONS_VIEW_MODE_CALM,
        });
        await applyOptionsViewMode(stored[OPTIONS_VIEW_MODE_STORAGE_KEY], { waitForPanelAnimation: false });
    } catch (error) {
        await applyOptionsViewMode(OPTIONS_VIEW_MODE_CALM, { waitForPanelAnimation: false });
        console.error('表示デザインの読み込みに失敗しました。', error);
    }

    if (optionsViewStorageListenerRegistered) return;
    optionsViewStorageListenerRegistered = true;
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes[OPTIONS_VIEW_MODE_STORAGE_KEY]) return;
        void applyOptionsViewMode(changes[OPTIONS_VIEW_MODE_STORAGE_KEY].newValue);
    });
}

/**
 * カスタムカーソルを初期化する。
 */
function initCustomCursor() {
    if (!elements.customCursor) return;
    document.addEventListener('mousemove', (e) => {
        elements.customCursor.style.left = e.clientX + 'px';
        elements.customCursor.style.top = e.clientY + 'px';
    });
    document.addEventListener('mousedown', () => elements.customCursor.classList.add('cursor-active'));
    document.addEventListener('mouseup', () => elements.customCursor.classList.remove('cursor-active'));
    const interactiveElements = document.querySelectorAll('a, button, input, select, .switch, .slider, .checkbox-wrapper, label[for], .options-container');
    interactiveElements.forEach(el => {
        el.addEventListener('mouseenter', () => elements.customCursor.classList.add('cursor-interactive'));
        el.addEventListener('mouseleave', () => elements.customCursor.classList.remove('cursor-interactive'));
    });
}

/**
 * 機能間の依存関係や排他制御を設定する。
 */
function setupInteractions() {
    const { autoAttendCheckbox, autoMeetCheckbox, darkModeCheckbox, customThemeCheckbox } = elements;

    autoAttendCheckbox?.addEventListener('change', () => {
        if (autoAttendCheckbox.checked && !autoMeetCheckbox.checked) {
            autoMeetCheckbox.checked = true;
            autoMeetCheckbox.dispatchEvent(new Event('change'));
        }
    });

    darkModeCheckbox?.addEventListener('change', () => {
        if (darkModeCheckbox.checked && customThemeCheckbox?.checked) {
            customThemeCheckbox.checked = false;
            customThemeCheckbox.dispatchEvent(new Event('change'));
        }
    });

    customThemeCheckbox?.addEventListener('change', () => {
        if (customThemeCheckbox.checked && darkModeCheckbox.checked) {
            darkModeCheckbox.checked = false;
            darkModeCheckbox.dispatchEvent(new Event('change'));
        }
    });
}

// --- イベントリスナー ---

function handleSettingsSaved(e) {
    const detail = e?.detail;
    if (detail && typeof detail === 'object') {
        showStatusMessage(
            detail.text || "設定が保存されました",
            detail.color || "lightgreen",
            detail.duration || STATUS_MESSAGE_DURATION,
        );
        return;
    }

    showStatusMessage("設定が保存されました", "lightgreen");
}

function handleSettingsError(e) {
    const message = typeof e.detail === 'string'
        ? e.detail
        : e.detail?.message || "不明なエラーが発生しました";
    showStatusMessage(message, "#ff6e6e", STATUS_MESSAGE_DURATION + 2000);
}

/**
 * 汎用的なステータスメッセージを表示する。
 * @param {string} text - 表示するテキスト。
 * @param {string} color - テキストの色。
 * @param {number} duration - 表示時間(ms)。
 */
function showStatusMessage(text, color = 'lightgreen', duration = STATUS_MESSAGE_DURATION) {
    if (!elements.statusMessage) return;

    elements.statusMessage.textContent = text;
    elements.statusMessage.style.color = color;
    elements.statusMessage.style.opacity = 1;

    // 既存のタイマーをクリアして、新しいメッセージが前のメッセージを上書きできるようにする
    if (elements.statusMessage.timer) {
        clearTimeout(elements.statusMessage.timer);
    }

    elements.statusMessage.timer = setTimeout(() => {
        elements.statusMessage.style.opacity = 0;
        elements.statusMessage.timer = null;
    }, duration);
}

function handleSettingsLoaded() {
    updateSwitchGradientLabels();
    reorderAndShowPanels();

    // 設定読み込み後にTOTP鍵を検証
    validateTotpSecret();
}

function handleDOMContentLoaded() {
    cacheDOMElements();
    initFeatureMetadata();
    initCalmNavigation();
    initLoadingScreen();
    initCustomCursor();
    setupInteractions();
    addEventListenersToUI();
    initTotpValidation();
    void initOptionsViewMode();
    void initAllFeaturesState();
}

function addEventListenersToUI() {
    document.addEventListener("settings-saved", handleSettingsSaved);
    document.addEventListener("settings-error", handleSettingsError);
    document.addEventListener("settings-loaded", handleSettingsLoaded);
    elements.optionsViewToggle?.addEventListener('click', () => void handleOptionsViewToggle());
    elements.allFeaturesToggle?.addEventListener('change', () => void handleAllFeaturesToggle());

    const switches = document.querySelectorAll(".switch-container input[type='checkbox']");
    switches.forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            updateSwitchGradientLabels();
            playFeatureToggleAnimation(checkbox);
        });
    });

    elements.autoLoginCheckbox?.addEventListener("change", (e) => updateOptionsOrder('auto-login-options', e.target.checked));
    elements.autoAttendCheckbox?.addEventListener("change", (e) => updateOptionsOrder('auto-attend-options', e.target.checked));
    elements.homeworkSwitch?.addEventListener("change", (e) => updateOptionsOrder('homework-options', e.target.checked));

    // --- Webhook URL Validation ---
    elements.homeworkNotificationCheckbox?.addEventListener('change', async (e) => {
        if (e.target.checked) {
            e.stopImmediatePropagation();
            const value = elements.homeworkWebhookUrlInput.value.trim();
            const webhookUrl = parseWebhookUrl(value);
            if (!value) {
                e.target.checked = false;
                await chrome.storage.sync.set({ gasWebhook: false });
                showModal("この機能をONにするには環境構築が必要です。");
            } else if (!webhookUrl) {
                e.target.checked = false;
                await chrome.storage.sync.set({ gasWebhook: false });
                showModal("HTTPSから始まる正しいWebhook URLを入力してください。");
            } else if (!await requestWebhookOriginPermission(webhookUrl)) {
                e.target.checked = false;
                await chrome.storage.sync.set({ gasWebhook: false });
                showModal("Webhookへの接続が許可されなかったため、通知機能を有効にできませんでした。");
            } else {
                await chrome.storage.sync.set({ gasWebhook: true });
            }
        }
    });
    elements.homeworkWebhookUrlInput?.addEventListener('change', async () => {
        if (!elements.homeworkNotificationCheckbox?.checked) return;

        const webhookUrl = parseWebhookUrl(elements.homeworkWebhookUrlInput.value.trim());
        if (webhookUrl && await requestWebhookOriginPermission(webhookUrl)) return;

        elements.homeworkNotificationCheckbox.checked = false;
        await chrome.storage.sync.set({ gasWebhook: false });
        showModal(webhookUrl
            ? "新しいWebhookへの接続が許可されなかったため、通知機能をOFFにしました。"
            : "Webhook URLが不正なため、通知機能をOFFにしました。");
    });

    // --- Modal Listeners ---
    elements.modalCloseButton?.addEventListener('click', hideModal);
    elements.validationModal?.addEventListener('click', (e) => {
        if (e.target === elements.validationModal) {
            hideModal();
        }
    });
}

// --- Modal --- 

function showModal(message) {
    if (!elements.validationModal || !elements.modalMessage) return;
    elements.modalMessage.textContent = message;
    elements.validationModal.classList.add('visible');
}

function hideModal() {
    if (!elements.validationModal) return;
    elements.validationModal.classList.remove('visible');
}

// --- UI更新ヘルパー ---

/**
 * ページにアップデート通知バーを表示。
 * @param {string} newVersion - 表示する新しいバージョン文字列。
 */
export function showUpdateNotification(newVersion) {
    if (!elements.updateNotification || !elements.updateNotificationTitle) return;
    elements.updateNotificationTitle.textContent = `KLPF ${newVersion} を利用できます`;
    elements.updateNotification.classList.add('visible');
}

function parseWebhookUrl(value) {
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
        return url;
    } catch {
        return null;
    }
}

function requestWebhookOriginPermission(url) {
    const originPattern = `${url.protocol}//${url.hostname}/*`;
    return chrome.permissions.request({ origins: [originPattern] });
}

function updateSwitchGradientLabels() {
    const switches = document.querySelectorAll(".switch-container");
    switches.forEach((switchContainer) => {
        const checkbox = switchContainer.querySelector("input[type='checkbox']");
        const label = switchContainer.querySelector(".switch-label");
        if (!checkbox || !label) return;
        if (checkbox.checked) {
            label.classList.add("gradient-label");
        } else {
            label.classList.remove("gradient-label");
        }
    });
}

/**
 * アニメーション付きで要素を並べ替えるFLIPアニメーション関数
 * @param {HTMLElement[]} items - 並べ替える要素の配列
 * @param {Function} moveAndUpdate - 要素をDOM内で移動させ、スタイルを更新する関数
 */
function flipAnimate(items, moveAndUpdate) {
    // 1. First: 開始位置を記録
    const firstPositions = new Map();
    items.forEach(item => {
        firstPositions.set(item, item.getBoundingClientRect());
    });

    // 2. Last: DOM操作を実行して最終状態にする
    moveAndUpdate();

    // 3. Invert & 4. Play: 変形させてアニメーション
    items.forEach(item => {
        const lastPos = item.getBoundingClientRect();
        const firstPos = firstPositions.get(item);
        if (!firstPos) return;

        const dx = firstPos.left - lastPos.left;
        const dy = firstPos.top - lastPos.top;

        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
            item.style.transform = `translate(${dx}px, ${dy}px)`;
            item.style.transition = 'transform 0s';

            // 強制リフロー
            item.offsetHeight;

            // アニメーションを開始
            item.classList.add('is-moving');
            item.style.transform = '';
            item.style.transition = '';

            item.addEventListener('transitionend', () => {
                item.classList.remove('is-moving');
            }, { once: true });
        }
    });
}

/**
 * オプションパネルの順序をストレージに保存されている順序に基づいて再配置し、表示を更新する。
 */
async function reorderAndShowPanels({ waitForAnimation = true } = {}) {
    const { optionsOrder } = await chrome.storage.sync.get({ optionsOrder: [] });
    const panel = elements.optionsPanel;
    if (!panel) return;

    const allPanelIds = [
        elements.autoLoginOptions.id,
        elements.autoAttendOptions.id,
        elements.homeworkOptions.id
    ];
    const allPanelElements = allPanelIds.map(id => document.getElementById(id)).filter(Boolean);

    // 表示/非表示の切り替え
    allPanelElements.forEach(el => {
        if (optionsOrder.includes(el.id)) {
            el.classList.add('visible');
        } else {
            el.classList.remove('visible');
        }
    });

    // アニメーションが落ち着くのを待つ
    if (waitForAnimation) {
        await new Promise(resolve => setTimeout(resolve, ANIMATION_DURATION));
    }

    // 表示モードに合わせて、詳細設定を対応機能の直下または従来パネルへ配置する。
    flipAnimate(allPanelElements, () => {
        if (currentOptionsViewMode === OPTIONS_VIEW_MODE_CALM) {
            allPanelElements.forEach((element) => {
                const host = document.querySelector(`[data-options-host="${element.id}"]`);
                // 入力中のStorage更新では配置は変わらないため、DOMを移動しない。
                // 同じ要素をappendChildし直すと、入力欄のフォーカスが失われる。
                if (host && element.parentElement !== host) {
                    host.appendChild(element);
                }
            });
            return;
        }

        const sortedVisibleElements = optionsOrder
            .map(id => document.getElementById(id))
            .filter(Boolean);
        
        const hiddenElements = allPanelElements.filter(el => !optionsOrder.includes(el.id));
        const desiredOrder = [...sortedVisibleElements, ...hiddenElements];
        const currentOrder = [...panel.children].filter(element => allPanelElements.includes(element));
        const isAlreadyOrdered = desiredOrder.every((element, index) => (
            element.parentElement === panel && currentOrder[index] === element
        ));

        if (!isAlreadyOrdered) {
            desiredOrder.forEach(element => panel.appendChild(element));
        }
    });
}


/**
 * オプションの有効/無効状態が変更されたときに呼び出され、順序を更新する。
 * @param {string} optionId - 対応するオプションパネルのID
 * @param {boolean} isEnabled - 有効になったかどうか
 */
async function updateOptionsOrder(optionId, isEnabled) {
    const { optionsOrder } = await chrome.storage.sync.get({ optionsOrder: [] });
    let order = optionsOrder.filter(id => id !== optionId);

    if (isEnabled) {
        order.push(optionId);
    }

    await chrome.storage.sync.set({ optionsOrder: order });
    await reorderAndShowPanels();
}


// --- エフェクトヘルパー ---

function getRandomRainbowColor() {
    const colors = ['#FF0000', '#FF7F00', '#FFFF00', '#00FF00', '#0000FF', '#4B0082', '#8B00FF'];
    return colors[Math.floor(Math.random() * colors.length)];
}

function createPowderParticle({ randomizeProgress = false } = {}) {
    if (!elements.particleCanvas || currentOptionsViewMode !== OPTIONS_VIEW_MODE_VIVID) return;
    const particle = document.createElement('div');
    particle.classList.add('powder-particle');
    particle.style.left = `${Math.floor(Math.random() * window.innerWidth)}px`;
    particle.style.backgroundColor = getRandomRainbowColor();
    const duration = Math.random() * 5 + 7;
    particle.style.animationDuration = `${duration}s`;
    const drift = Math.random() * 30 + 10;
    particle.style.setProperty('--drift-amount', `${drift}px`);
    if (randomizeProgress) {
        particle.style.bottom = `${Math.random() * window.innerHeight}px`;
        particle.style.animationDelay = `-${Math.random() * duration}s`;
    } else {
        particle.style.animationDelay = `${Math.random() * 5}s`;
    }
    elements.particleCanvas.appendChild(particle);
    particle.addEventListener('animationend', function() {
        this.remove();
        if (currentOptionsViewMode === OPTIONS_VIEW_MODE_VIVID) createPowderParticle();
    });
}

// --- TOTP関連 ---

/**
 * TOTP秘密鍵のバリデーションを初期化する。
 * 入力変更時に鍵が正常かどうかを検証して表示する。
 */
function initTotpValidation() {
    if (!elements.totpSecretInput) return;
    elements.totpSecretInput.addEventListener('input', validateTotpSecret);
}

/**
 * TOTP秘密鍵が正常かどうかを検証し、結果を表示する。
 */
async function validateTotpSecret() {
    const secret = elements.totpSecretInput?.value?.trim();
    if (!elements.totpStatus) return;

    if (!secret) {
        elements.totpStatus.textContent = '';
        elements.totpStatus.className = 'totp-status';
        return;
    }

    if (typeof window.generateTOTP !== 'function') return;

    try {
        const code = await window.generateTOTP(secret);
        if (code) {
            elements.totpStatus.textContent = '✓ 有効な鍵です';
            elements.totpStatus.className = 'totp-status totp-valid';
        } else {
            elements.totpStatus.textContent = '✗ 無効な鍵です';
            elements.totpStatus.className = 'totp-status totp-invalid';
        }
    } catch {
        elements.totpStatus.textContent = '✗ 無効な鍵です';
        elements.totpStatus.className = 'totp-status totp-invalid';
    }
}

/**
 * UIの初期化を実行するエントリーポイント
 */
export function initializeUI() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', handleDOMContentLoaded);
    } else {
        handleDOMContentLoaded();
    }
}
