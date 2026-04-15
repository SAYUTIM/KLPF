class ModernKLPFSite {
    constructor() {
        this.observer = null;
        this.revealSelector = '.fade-in, .feature-card, .step-card, .stat-number, .download-card';
        this.revealMarginPx = 110;
        this.init();
    }

    init() {
        this.setupLoader();
        this.setupPageLoadBehavior();
        this.setupScrollProgress();
        this.setupIntersectionObserver();
        this.setupMobileMenu();
        this.setupModals();
        this.setupFloatingShapes();
        this.setupSmoothScrolling();
        this.loadData();
    }

    setupLoader() {
        this._revealDone = false;
        this._deferredCounters = [];
        this._loaderEl = document.getElementById('app-loader');
        if (this._loaderEl) {
            this._loaderStart = performance.now();
            document.documentElement.style.overflow = 'hidden';
        }
    }

    setupPageLoadBehavior() {
        if ('scrollRestoration' in history) {
            history.scrollRestoration = 'manual';
        }
        window.scrollTo(0, 0);
    }

    setupScrollProgress() {
        const progressBar = document.createElement('div');
        progressBar.className = 'scroll-progress';
        document.body.appendChild(progressBar);

        window.addEventListener('scroll', () => {
            const winScroll = document.body.scrollTop || document.documentElement.scrollTop;
            const height = document.documentElement.scrollHeight - document.documentElement.clientHeight;
            const scrolled = (winScroll / height) * 100;
            progressBar.style.width = scrolled + '%';
            
            const header = document.querySelector('header');
            if (winScroll > 50) {
                header.classList.add('scrolled');
            } else {
                header.classList.remove('scrolled');
            }
        });
    }

    setupIntersectionObserver() {
        const observerOptions = {
            root: null,
            rootMargin: `0px 0px ${this.revealMarginPx}px 0px`,
            threshold: 0.01
        };

        this.observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!this._revealDone) return;
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    
                    if (entry.target.classList.contains('stat-number')) {
                        this.animateCounter(entry.target);
                    }
                    this.observer.unobserve(entry.target);
                }
            });
        }, observerOptions);

        this.getRevealTargets().forEach((el, index) => {
            this.observer.observe(el);
        });
    }

    getRevealTargets() {
        return document.querySelectorAll(this.revealSelector);
    }

    isElementNearViewport(el) {
        const rect = el.getBoundingClientRect();
        return rect.top < window.innerHeight + this.revealMarginPx
            && rect.bottom >= -this.revealMarginPx;
    }

    setupMobileMenu() {
        const toggle = document.querySelector('.mobile-toggle');
        const menu = document.querySelector('.nav-menu');

        toggle?.addEventListener('click', () => {
            menu.classList.toggle('active');
            toggle.textContent = menu.classList.contains('active') ? '✕' : '☰';
        });

        document.querySelectorAll('.nav-menu a').forEach(link => {
            link.addEventListener('click', () => {
                menu.classList.remove('active');
                toggle.textContent = '☰';
            });
        });
    }

    setupModals() {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <button class="modal-close">×</button>
                <h2 class="modal-title"></h2>
                <p class="modal-description"></p>
            </div>
        `;
        document.body.appendChild(modal);

        const featureDetails = {
            '自動ログイン': 'Ku-LMSやku-portへの面倒なログイン作業を完全自動化。設定した認証情報で瞬時にアクセスできます。毎回IDとパスワードを入力する手間が省けるため、スムーズな学習開始が可能です。',
            '自動ログアウト無効化': '作業中の意図しないログアウトを防止。長時間の学習セッションも安心して続けられます。バックグラウンドで自動的にセッションを維持するため、途中で作業が中断されることがありません。',
            '課題リストアップ': '散らばった課題情報を一箇所に集約。期限順に整理され、メール通知で見逃しを防げます。複数の科目にまたがる課題を効率的に管理し、提出漏れのリスクを大幅に削減できます。',
            'Meetミュート参加': 'Google Meetに自動的にミュート状態で参加。うっかりマイクがオンになる心配がありません。プライバシーを保護しながら、安心してオンライン授業に参加できます。',
            '履修科目フィルター': '履修中の科目のみを表示する設定を記憶。毎回の絞り込み操作が不要になります。関係のない科目情報が表示されないため、必要な情報により素早くアクセスできます。',
            '授業時間表示': '現在時刻と次の授業までの時間をリアルタイム表示。スケジュール管理がより簡単に。授業の開始・終了時間を常に把握できるため、時間管理が大幅に改善されます。',
            'ダークモード': '目に優しいダークテーマでKu-LMSを表示。長時間の利用でも疲労を軽減します。夜間の学習や長時間のコンピューター作業でも目の負担を最小限に抑えることができます。',
            '自動出席': '指定時間に自動で出席処理とMeet参加。朝の授業も寝坊を心配する必要がありません。設定した時間の数分前に自動的に出席ボタンを押し、Meetに参加するため、確実に出席が記録されます。',
            '教材一括開封': '教材ページから詳細ページを開くことなく、選択した教材をワンクリックですべて開き、ステータスを参照済みにします。大量の教材を効率的に処理でき、学習の準備時間を大幅に短縮できます。'
        };

        document.addEventListener('click', (e) => {
            const featureCard = e.target.closest('.feature-card');
            if (featureCard) {
                const title = featureCard.querySelector('.feature-title').textContent;
                const description = featureDetails[title] || featureCard.querySelector('.feature-description').textContent;
                this.showModal(title, description);
            }
        });

        modal.querySelector('.modal-close').addEventListener('click', () => {
            modal.classList.remove('active');
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });
    }

    setupFloatingShapes() {
        const bgEffects = document.createElement('div');
        bgEffects.className = 'bg-effects';
        
        const floatingShapes = document.createElement('div');
        floatingShapes.className = 'floating-shapes';
        
        for (let i = 0; i < 4; i++) {
            const shape = document.createElement('div');
            shape.className = 'shape';
            floatingShapes.appendChild(shape);
        }
        
        bgEffects.appendChild(floatingShapes);
        document.body.appendChild(bgEffects);
    }

    setupSmoothScrolling() {
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function (e) {
                e.preventDefault();
                const href = this.getAttribute('href');
                if (href === '#') {
                    window.scrollTo({
                        top: 0,
                        behavior: 'smooth'
                    });
                } else {
                    const target = document.querySelector(href);
                    if (target) {
                        target.scrollIntoView({
                            behavior: 'smooth',
                            block: 'start'
                        });
                    }
                }
            });
        });
    }

    async loadData() {
        try {
            const downloads = await this.fetchDownloads();
            this.updateStats(downloads);
            await this.loadReleases();
        } catch (error) {
            console.error('データの読み込みに失敗しました:', error);
        } finally {
            this.finishLoader();
        }
    }

    async fetchDownloads() {
        try {
            const repos = ['SAYUTIM/KLPF', 'SAYUTIM/KALI'];
            let totalDownloads = 0;
            for (const repo of repos) {
                const response = await fetch(`https://api.github.com/repos/${repo}/releases`);
                if (!response.ok) continue;
                const releases = await response.json();
                for (const release of releases) {
                    for (const asset of release.assets) {
                        totalDownloads += asset.download_count;
                    }
                }
            }
            return totalDownloads;
        } catch (error) {
            console.error('ダウンロード数の取得に失敗しました:', error);
            return 0;
        }
    }

    async loadReleases() {
        const container = document.getElementById('releases-container');
        if (!container) return;
        container.innerHTML = '<div class="releases-loading"><div class="loading"></div><p>リリース情報を読み込み中...</p></div>';

        try {
            const response = await fetch('https://api.github.com/repos/SAYUTIM/KLPF/releases');
            if (!response.ok) throw new Error('リリース情報の取得に失敗しました');
            const releases = await response.json();
            const latestReleases = releases.slice(0, 3);
            container.innerHTML = '';

            if (latestReleases.length === 0) {
                container.innerHTML = '<div class="releases-error">利用可能なリリースはありません。</div>';
                return;
            }
            latestReleases.forEach((release, index) => {
                const releaseCard = this.createReleaseCard(release);
                container.appendChild(releaseCard);
                if (this.observer) {
                    this.observer.observe(releaseCard);
                }
            });
        } catch (error) {
            container.innerHTML = '<div class="releases-error">リリース情報の読み込みに失敗しました。後でもう一度お試しください。</div>';
            console.error(error);
        }
    }

    updateStats(downloads) {
        const statsElement = document.getElementById('totaldownload');
        if (statsElement) {
            statsElement.dataset.count = downloads || 0;
            if (this._revealDone) {
                this.animateCounter(statsElement);
            } else {
                this._deferredCounters = this._deferredCounters || [];
                if (!this._deferredCounters.includes(statsElement)) {
                    this._deferredCounters.push(statsElement);
                }
            }
        }
    }

    createReleaseCard(release) {
        const card = document.createElement('div');
        card.className = 'download-card fade-in';

        const publishedDate = new Date(release.published_at).toLocaleDateString('ja-JP', {
            year: 'numeric', month: 'long', day: 'numeric'
        });

        let changelogHtml = '<p>このリリースには説明がありません。</p>';
        if (release.body) {
            const lines = release.body.replace(/</g, '&lt;').replace(/>/g, '&gt;').split('\n');
            const htmlParts = [];
            let currentLiContent = '';

            const finalizeLi = () => {
                if (currentLiContent) {
                    htmlParts.push(`<li>${currentLiContent}</li>`);
                    currentLiContent = '';
                }
            };

            lines.forEach(line => {
                const trimmed = line.trim();
                const isIndented = (/^\s{2,}|^\u3000/).test(line) && trimmed !== '';
                const isListItem = /^[\s*・-]+\s*/.test(trimmed);

                if (isListItem) {
                    finalizeLi();
                    currentLiContent = trimmed.replace(/^[\s*・-]+\s*/, '');
                } else if (isIndented && currentLiContent) {
                    const subItemText = trimmed.replace(/^(→|-&gt;)\s*/, '<span class="changelog-arrow">→</span> ');
                    currentLiContent += `<span class="changelog-sub-item">${subItemText}</span>`;
                } else {
                    finalizeLi();
                    if (trimmed.startsWith('#')) {
                        htmlParts.push('<h4>' + trimmed.replace(/^#+\s*/, '') + '</h4>');
                    } else if (trimmed !== '') {
                        htmlParts.push('<p>' + trimmed + '</p>');
                    }
                }
            });

            finalizeLi();

            changelogHtml = htmlParts.join('')
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/(<li>.*?<\/li>)/gs, '<ul class="changelog-list">$1</ul>')
                .replace(/<\/ul>\s*<ul class="changelog-list">/g, '');
        }
        
        const asset = release.assets.length > 0 ? release.assets[0] : null;
        const downloadUrl = asset ? asset.browser_download_url : release.html_url;
        const assetInfo = asset ? `${(asset.size / 1024 / 1024).toFixed(2)} MB (.zip)` : 'ZIP';
        
        card.innerHTML = `
            <div class="download-header">
                <div class="download-version">${release.name || release.tag_name}</div>
                <div class="download-date">${publishedDate}</div>
            </div>
            
            <div class="changelog">
                <h4 class="changelog-title">このバージョンの変更点:</h4>
                <div class="changelog-body">${changelogHtml}</div>
            </div>

            <div class="download-footer">
                <span class="asset-info">${assetInfo}</span>
                <a href="${downloadUrl}" class="download-button" target="_blank" rel="noopener noreferrer">
                    ダウンロード
                    <span>📥</span>
                </a>
            </div>
        `;

        return card;
    }

    showModal(title, description) {
        const modal = document.querySelector('.modal');
        const modalTitle = modal.querySelector('.modal-title');
        const modalDescription = modal.querySelector('.modal-description');
        
        modalTitle.textContent = title;
        modalDescription.textContent = description;
        modal.classList.add('active');
    }

    animateCounter(element) {
        const target = parseInt(element.dataset.count) || 0;
        if(parseInt(element.textContent) === target) return;
        const increment = target / 50;
        let current = 0;

        const updateCounter = () => {
            current += increment;
            if (current < target) {
                element.textContent = Math.ceil(current).toLocaleString();
                requestAnimationFrame(updateCounter);
            } else {
                element.textContent = target.toLocaleString();
            }
        };
        updateCounter();
    }

    async finishLoader() {
        const MIN_MS = 1000;
        const elapsed = performance.now() - (this._loaderStart || performance.now());
        const wait = Math.max(0, MIN_MS - elapsed);
        await new Promise(r => setTimeout(r, wait));

        const revealVisibleElements = () => {
            this._revealDone = true;
            (this._deferredCounters || []).forEach(el => this.animateCounter(el));
            this._deferredCounters = [];
            
            this.getRevealTargets().forEach(el => {
                if (this.isElementNearViewport(el)) {
                    el.classList.add('visible');
                }
            });
        };

        if (this._loaderEl) {
            this._loaderEl.classList.add('done');
            setTimeout(() => {
                this._loaderEl.remove();
                document.documentElement.style.overflow = '';
                revealVisibleElements();
            }, 600);
        } else {
            revealVisibleElements();
        }
    }

    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new ModernKLPFSite();
});
