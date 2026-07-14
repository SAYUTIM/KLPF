(() => {
    'use strict';

    const progress = document.querySelector('.reading-progress');
    const sections = Array.from(document.querySelectorAll('main section[id]'));
    const navLinks = Array.from(document.querySelectorAll('nav a[href^="#"], .toc a[href^="#"]'));
    const revealElements = Array.from(document.querySelectorAll('.observe'));
    const supportsRevealAnimation = 'IntersectionObserver' in window;
    const SCROLL_DURATION_MS = 650;
    let scrollAnimationFrame = null;

    function smoothScrollTo(targetTop) {
        if (scrollAnimationFrame !== null) cancelAnimationFrame(scrollAnimationFrame);

        const startTop = window.scrollY;
        const distance = targetTop - startTop;
        const startTime = performance.now();

        function animateScroll(now) {
            const progress = Math.min(1, (now - startTime) / SCROLL_DURATION_MS);
            const easedProgress = 1 - Math.pow(1 - progress, 3);
            window.scrollTo(0, startTop + distance * easedProgress);

            if (progress < 1) {
                scrollAnimationFrame = requestAnimationFrame(animateScroll);
            } else {
                scrollAnimationFrame = null;
            }
        }

        scrollAnimationFrame = requestAnimationFrame(animateScroll);
    }

    function getDocumentTop(element) {
        let top = 0;
        let current = element;
        while (current) {
            top += current.offsetTop;
            current = current.offsetParent;
        }
        return top;
    }

    document.querySelectorAll('a[href^="#"]').forEach((link) => {
        link.addEventListener('click', (event) => {
            const href = link.getAttribute('href');
            const target = href === '#' ? null : document.getElementById(href.slice(1));
            if (href !== '#' && !target) return;

            event.preventDefault();
            const header = document.querySelector('.site-header');
            const headerOffset = header ? header.offsetHeight + 16 : 0;
            const targetTop = target
                ? getDocumentTop(target) - headerOffset
                : 0;
            smoothScrollTo(Math.max(0, targetTop));
        });
    });

    function updateProgress() {
        const available = document.documentElement.scrollHeight - window.innerHeight;
        const ratio = available > 0 ? Math.min(1, window.scrollY / available) : 0;
        progress.style.width = `${ratio * 100}%`;
    }

    if (supportsRevealAnimation) {
        document.documentElement.classList.add('has-reveal');
        const revealObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('is-visible');
                revealObserver.unobserve(entry.target);
            });
        }, { rootMargin: '0px 0px -18% 0px', threshold: 0.08 });

        // 初期状態を一度描画してから監視を始め、表示時のtransitionを確実に発火させる。
        requestAnimationFrame(() => {
            document.documentElement.classList.add('reveal-ready');
            requestAnimationFrame(() => {
                revealElements.forEach((element) => revealObserver.observe(element));
            });
        });
    } else {
        revealElements.forEach((element) => element.classList.add('is-visible'));
    }

    if ('IntersectionObserver' in window) {
        const sectionObserver = new IntersectionObserver((entries) => {
            const visible = entries.filter((entry) => entry.isIntersecting)
                .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
            if (!visible) return;
            navLinks.forEach((link) => {
                link.classList.toggle('is-active', link.getAttribute('href') === `#${visible.target.id}`);
            });
        }, { rootMargin: '-20% 0px -65% 0px', threshold: [0, .2, .6] });

        sections.forEach((section) => sectionObserver.observe(section));
    }

    const countdown = document.querySelector('[data-countdown]');
    const deadline = new Date('2026-09-29T19:30:00+09:00');
    const remaining = deadline.getTime() - Date.now();
    if (remaining > 0) {
        const days = Math.ceil(remaining / 86400000);
        countdown.textContent = `運用変更の完了まで、あと${days}日です。17:30より前の設定完了をおすすめします。`;
    } else {
        countdown.textContent = '第2段階の運用変更日時を過ぎています。未設定の場合は学内ネットワークから設定してください。';
    }

    updateProgress();
    window.addEventListener('scroll', updateProgress, { passive: true });
    window.addEventListener('resize', updateProgress);
})();
