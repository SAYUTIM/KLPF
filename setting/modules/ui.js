// Copyright (c) 2024-2025 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file 設定ページのUI操作と視覚効果を管理するモジュール
 * @module modules/ui
 */

// --- 定数定義 ---
const PARTICLE_COUNT = 75;
const LOADING_SCREEN_DURATION = 1500; // ms
const FADE_OUT_DURATION = 1300; // ms
const STATUS_MESSAGE_DURATION = 3000; // ms
const ANIMATION_DURATION = 500; // ms, CSSのtransitionと合わせる

// --- DOM要素のキャッシュ ---
const elements = {
    statusMessage: null,
    loadingScreen: null,
    particleCanvas: null,
    customCursor: null,
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
};

/**
 * DOM要素を一度だけ検索し、キャッシュする。
 */
function cacheDOMElements() {
    elements.statusMessage = document.getElementById("status");
    elements.loadingScreen = document.querySelector('.loading');
    elements.particleCanvas = document.getElementById('particle-canvas');
    elements.customCursor = document.querySelector('.custom-cursor');

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
}

// --- UI初期化処理 ---

/**
 * ローディング画面を初期化し、フェードアウトさせる。
 */
function initLoadingScreen() {
    if (!elements.loadingScreen) return;
    setTimeout(() => {
        elements.loadingScreen.style.transition = `opacity ${FADE_OUT_DURATION / 1000}s`;
        elements.loadingScreen.style.opacity = 0;
        setTimeout(() => {
            elements.loadingScreen.style.display = 'none';
        }, FADE_OUT_DURATION);
    }, LOADING_SCREEN_DURATION);
}

/**
 * パーティクルエフェクトを初期化する。
 */
function initParticleEffect() {
    if (!elements.particleCanvas) return;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        createPowderParticle();
    }
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

function handleSettingsSaved() {
    showStatusMessage("設定が保存されました", "lightgreen");
}

function handleSettingsError(e) {
    const message = e.detail || "不明なエラーが発生しました";
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
}

function handleDOMContentLoaded() {
    cacheDOMElements();
    initLoadingScreen();
    initParticleEffect();
    initCustomCursor();
    setupInteractions();
    addEventListenersToUI();
}

function addEventListenersToUI() {
    document.addEventListener("settings-saved", handleSettingsSaved);
    document.addEventListener("settings-error", handleSettingsError);
    document.addEventListener("settings-loaded", handleSettingsLoaded);

    const switches = document.querySelectorAll(".switch-container input[type='checkbox']");
    switches.forEach(checkbox => {
        checkbox.addEventListener("change", updateSwitchGradientLabels);
    });

    elements.autoLoginCheckbox?.addEventListener("change", (e) => updateOptionsOrder('auto-login-options', e.target.checked));
    elements.autoAttendCheckbox?.addEventListener("change", (e) => updateOptionsOrder('auto-attend-options', e.target.checked));
    elements.homeworkSwitch?.addEventListener("change", (e) => updateOptionsOrder('homework-options', e.target.checked));

    // --- Feature Description on Click ---
    const labels = document.querySelectorAll('.switch-label');
    labels.forEach(label => {
        label.addEventListener('click', () => {
            const title = label.parentElement.getAttribute('title');
            if (title) {
                showStatusMessage(title, '#87CEFA', 5000);
            }
        });
    });

    // --- Webhook URL Validation ---
    elements.homeworkNotificationCheckbox?.addEventListener('change', (e) => {
        if (e.target.checked) {
            const url = elements.homeworkWebhookUrlInput.value;
            if (!url) {
                e.target.checked = false;
                showModal("この機能をONにするには環境構築が必要です。");
            } else if (!url.startsWith('https://script.google.com/')) {
                e.target.checked = false;
                showModal("URLが不正です。正しいURLを入力してください。");
            }
        }
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
async function reorderAndShowPanels() {
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
    await new Promise(resolve => setTimeout(resolve, ANIMATION_DURATION));

    // FLIPアニメーションで並べ替え
    flipAnimate(allPanelElements, () => {
        const sortedVisibleElements = optionsOrder
            .map(id => document.getElementById(id))
            .filter(Boolean);
        
        const hiddenElements = allPanelElements.filter(el => !optionsOrder.includes(el.id));

        // 表示されているものを順序通りに配置
        sortedVisibleElements.forEach(el => panel.appendChild(el));
        // 非表示のものを末尾に配置
        hiddenElements.forEach(el => panel.appendChild(el));
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

function createPowderParticle() {
    if (!elements.particleCanvas) return;
    const particle = document.createElement('div');
    particle.classList.add('powder-particle');
    particle.style.left = `${Math.floor(Math.random() * window.innerWidth)}px`;
    particle.style.backgroundColor = getRandomRainbowColor();
    const duration = Math.random() * 5 + 7;
    particle.style.animationDuration = `${duration}s`;
    const drift = Math.random() * 30 + 10;
    particle.style.setProperty('--drift-amount', `${drift}px`);
    particle.style.animationDelay = `${Math.random() * 5}s`;
    elements.particleCanvas.appendChild(particle);
    particle.addEventListener('animationend', function() {
        this.remove();
        createPowderParticle();
    });
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
