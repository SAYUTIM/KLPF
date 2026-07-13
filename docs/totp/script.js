(() => {
    'use strict';

    const progress = document.querySelector('.reading-progress');
    const sections = Array.from(document.querySelectorAll('main section[id]'));
    const navLinks = Array.from(document.querySelectorAll('nav a[href^="#"], .toc a[href^="#"]'));

    function updateProgress() {
        const available = document.documentElement.scrollHeight - window.innerHeight;
        const ratio = available > 0 ? Math.min(1, window.scrollY / available) : 0;
        progress.style.width = `${ratio * 100}%`;
        document.querySelectorAll('.observe:not(.is-visible)').forEach((element) => {
            if (element.getBoundingClientRect().top < window.innerHeight * .92) {
                element.classList.add('is-visible');
            }
        });
    }

    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('is-visible');
            revealObserver.unobserve(entry.target);
        });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

    document.querySelectorAll('.observe').forEach((element) => revealObserver.observe(element));

    const sectionObserver = new IntersectionObserver((entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting)
            .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        if (!visible) return;
        navLinks.forEach((link) => {
            link.classList.toggle('is-active', link.getAttribute('href') === `#${visible.target.id}`);
        });
    }, { rootMargin: '-20% 0px -65% 0px', threshold: [0, .2, .6] });

    sections.forEach((section) => sectionObserver.observe(section));

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
