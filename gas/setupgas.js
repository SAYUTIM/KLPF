// Copyright (c) 2025-2026 SAYU
// This software is released under the MIT License, see LICENSE.

/**
 * @file GAS通知機能のセットアップガイドで、目次移動とコードコピーを補助する。
 * セットアップ案内ページのDOMで目次、スクロール進捗、コードコピーを提供する。
 */

const HEADER_OFFSET_EXTRA = 22;
const COPY_FEEDBACK_DURATION_MS = 1800;

/**
 * 固定ヘッダーの高さを取得し、スクロール位置の補正に使う。
 * @returns {number} 固定ヘッダーの補正量（ピクセル）。
 */
function getHeaderOffset() {
  const header = document.querySelector('.site-header');
  return (header?.getBoundingClientRect().height || 0) + HEADER_OFFSET_EXTRA;
}

/**
 * ヘッダーの高さを考慮して指定したセクションへスクロールする。
 * @param {Element} target - スクロール先のセクション要素。
 * @returns {void} 戻り値はない。
 */
function scrollToSection(target) {
  const top = target.getBoundingClientRect().top + window.scrollY - getHeaderOffset();
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

/**
 * ページ内リンクの滑らかなスクロールを登録する。
 * @returns {void} 戻り値はない。
 */
function initializeSmoothAnchorNavigation() {
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (event) => {
      const targetId = anchor.getAttribute('href')?.slice(1);
      const target = targetId ? document.getElementById(targetId) : null;
      if (!target) return;

      event.preventDefault();
      history.replaceState(null, '', `#${targetId}`);
      scrollToSection(target);
    });
  });
}

/**
 * 表示中のセクションに合わせて目次の選択状態を更新する。
 * @returns {void} 戻り値はない。
 */
function initializeTableOfContents() {
  const links = [...document.querySelectorAll('.table-of-contents a[data-section]')];
  const sections = links
    .map((link) => document.getElementById(link.dataset.section))
    .filter(Boolean);
  if (!links.length || !sections.length) return;

  const setActiveLink = (sectionId) => {
    links.forEach((link) => {
      const isActive = link.dataset.section === sectionId;
      link.classList.toggle('is-active', isActive);
      if (isActive) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  };

  const updateActiveSection = () => {
    const threshold = getHeaderOffset() + 70;
    let activeSection = sections[0];
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= threshold) activeSection = section;
    }

    const isAtPageBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    if (isAtPageBottom) activeSection = sections[sections.length - 1];
    setActiveLink(activeSection.id);
  };

  updateActiveSection();
  window.addEventListener('scroll', updateActiveSection, { passive: true });
  window.addEventListener('resize', updateActiveSection);
}

/**
 * ページのスクロール量を進捗バーへ反映する監視を登録する。
 * @returns {void} 戻り値はない。
 */
function initializeScrollProgress() {
  const progress = document.querySelector('.scroll-progress');
  if (!progress) return;

  /**
   * ページのスクロール量を進捗表示へ反映する。
   * @returns {void} 戻り値はない。
   */
  const updateProgress = () => {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0;
    progress.style.transform = `scaleX(${ratio})`;
  };

  updateProgress();
  window.addEventListener('scroll', updateProgress, { passive: true });
  window.addEventListener('resize', updateProgress);
}

/**
 * 指定した文字列をクリップボードへコピーする。
 * @param {string} text - 表示または照合する文字列。
 * @returns {Promise<void>} 処理の完了を待つPromise。
 */
async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

/**
 * コードのコピーボタンを初期化し、操作結果を表示する。
 * @returns {void} 戻り値はない。
 */
function initializeCopyButtons() {
  document.querySelectorAll('[data-copy-target]').forEach((button) => {
    const defaultLabel = button.textContent;
    button.addEventListener('click', async () => {
      const target = document.getElementById(button.dataset.copyTarget);
      if (!target) return;

      try {
        await copyText(target.textContent.trim());
        button.textContent = 'コピーしました';
        button.classList.add('copied');
      } catch (error) {
        console.error('[KLPF] コードのコピーに失敗しました。', error);
        button.textContent = 'コピーできませんでした';
      }

      window.setTimeout(() => {
        button.textContent = defaultLabel;
        button.classList.remove('copied');
      }, COPY_FEEDBACK_DURATION_MS);
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initializeSmoothAnchorNavigation();
  initializeTableOfContents();
  initializeScrollProgress();
  initializeCopyButtons();
});
