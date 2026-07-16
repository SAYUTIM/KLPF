// Copyright (c) 2025-2026 SAYU
// This software is released under the MIT License, see LICENSE.

const HEADER_OFFSET_EXTRA = 22;
const COPY_FEEDBACK_DURATION_MS = 1800;

function getHeaderOffset() {
  const header = document.querySelector('.site-header');
  return (header?.getBoundingClientRect().height || 0) + HEADER_OFFSET_EXTRA;
}

function scrollToSection(target) {
  const top = target.getBoundingClientRect().top + window.scrollY - getHeaderOffset();
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

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

function initializeScrollProgress() {
  const progress = document.querySelector('.scroll-progress');
  if (!progress) return;

  const updateProgress = () => {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0;
    progress.style.transform = `scaleX(${ratio})`;
  };

  updateProgress();
  window.addEventListener('scroll', updateProgress, { passive: true });
  window.addEventListener('resize', updateProgress);
}

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
