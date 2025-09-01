document.addEventListener('DOMContentLoaded', () => {

    const textWrapper = document.querySelector('.hero-content h1');
    textWrapper.innerHTML = textWrapper.textContent.replace(/\S/g, "<span class='letter'>$&</span>");

    const playIntroAnimation = (totalDownloads) => {
        const tl = anime.timeline({
            easing: 'easeOutExpo',
        });

        tl.add({
            targets: '.hero-content h1',
            opacity: [0, 1],
            translateY: [20, 0],
            duration: 800
        })
        .add({
            targets: '.hero-content h1 .letter',
            translateY: [-100, 0],
            opacity: [0, 1],
            duration: 1200,
            delay: anime.stagger(100)
        })
        .add({
            targets: '.hero-content .subtitle',
            opacity: [0, 1],
            translateY: [20, 0],
            duration: 800
        }, '-=1000')
        .add({
            targets: '#background-downloads-count',
            textContent: totalDownloads,
            round: 1,
            easing: 'easeOutQuad',
            duration: 2500,
            update: function(anim) {
                const el = document.getElementById('background-downloads-count');
                el.textContent = Math.round(anim.animations[0].currentValue).toLocaleString();
            }
        }, '-=800')
        .add({
            targets: '.hero .downloads-label',
            opacity: [0, 1],
            duration: 1000
        }, '-=500');
    };

    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                anime({
                    targets: entry.target,
                    translateY: [30, 0],
                    opacity: [0, 1],
                    duration: 1200,
                    easing: 'easeOutExpo',
                    delay: entry.target.dataset.delay || 0
                });
                observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.1
    });

    const animatedElements = document.querySelectorAll('h2, .feature-card, .install-step, .youtube-embed, .contact-button');
    animatedElements.forEach((el, i) => {
        if (el.classList.contains('feature-card')) {
            el.dataset.delay = i % 4 * 100;
        }
        observer.observe(el);
    });

    const fetchDownloadsCount = async () => {
        const repos = ['SAYUTIM/KLPF', 'SAYUTIM/KALI'];
        let totalDownloads = 0;
        try {
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
        } catch (error) {
            console.error("Error fetching download counts:", error);
            return 0;
        }
        return totalDownloads;
    };

    const populateDownloads = async () => {
        const container = document.getElementById('download-list');
        try {
            const response = await fetch('https://api.github.com/repos/SAYUTIM/KLPF/releases');
            if (!response.ok) throw new Error(`Failed to fetch releases: ${response.statusText}`);

            const releases = await response.json();
            container.innerHTML = '';

            if (releases.length === 0) {
                container.innerHTML = '<p>利用可能なリリースはありません。</p>';
                return;
            }

            const latestReleases = releases.slice(0, 3);
            latestReleases.forEach(release => {
                const card = document.createElement('div');
                card.className = 'release-card';
                const publishedDate = new Date(release.published_at).toLocaleDateString('ja-JP');

                let bodyHtml = '';
                const bodyRaw = (release.body || '').trim();

                if (bodyRaw) {
                    bodyHtml = bodyRaw
                        .split('\n')
                        .filter(line => line.trim() !== '')
                        .map(line => {
                            const trimmedLine = line.trim();
                            if (trimmedLine.startsWith('#')) return `<h3>${trimmedLine.replace(/#/g, '').trim()}</h3>`;
                            if (trimmedLine.startsWith('・') || trimmedLine.startsWith('-') || trimmedLine.startsWith('*')) return `<p class="release-list-item">${trimmedLine.substring(1).trim()}</p>`;
                            return `<p>${trimmedLine}</p>`;
                        })
                        .join('');
                } else {
                    bodyHtml = '<p>このリリースには説明がありません。</p>';
                }

                card.innerHTML = `
                    <div class="release-header">
                        <h3 class="release-version">${release.tag_name}</h3>
                        <span class="release-date">公開日: ${publishedDate}</span>
                    </div>
                    <div class="release-body">${bodyHtml}</div>
                    <div class="release-assets">
                        ${release.assets.map(asset => `<a href="${asset.browser_download_url}" class="asset-download-button">${asset.name}</a>`).join('')}
                    </div>
                `;
                container.appendChild(card);
            });

            const moreLinksContainer = document.createElement('div');
            moreLinksContainer.className = 'more-releases-container';
            moreLinksContainer.innerHTML = `
                <p>全てのリリース履歴はこちら</p>
                <a href="https://github.com/SAYUTIM/KLPF/releases" target="_blank" rel="noopener noreferrer" class="more-releases-link">KLPF Releases (GitHub)</a>
                <a href="https://github.com/SAYUTIM/KALI/releases" target="_blank" rel="noopener noreferrer" class="more-releases-link">KALI Releases (GitHub)</a>
            `;
            container.appendChild(moreLinksContainer);

            anime({
                targets: '#download .release-card, #download .more-releases-container',
                translateY: [30, 0],
                opacity: [0, 1],
                duration: 1200,
                easing: 'easeOutExpo',
                delay: anime.stagger(150)
            });

        } catch (error) {
            console.error("Error populating downloads section:", error);
            container.innerHTML = '<p>リリース情報の読み込みに失敗しました。後でもう一度お試しください。</p>';
        }
    };

    fetchDownloadsCount().then(total => {
        if (typeof total === 'number') {
            playIntroAnimation(total);
        } else {
            playIntroAnimation(0);
            document.getElementById('background-downloads-count').style.display = 'none';
        }
    });

    populateDownloads();

    const menuToggle = document.getElementById('menu-toggle');
    const navMenu = document.getElementById('nav-menu');
    menuToggle.addEventListener('click', () => {
        navMenu.classList.toggle('active');
    });

    document.querySelectorAll('#nav-menu a').forEach(link => {
        link.addEventListener('click', () => {
            if (navMenu.classList.contains('active')) {
                navMenu.classList.remove('active');
            }
        });
    });

    const featureDetails = {
        '自動ログイン': 'Ku-LMSやku-portのログインページにアクセスすると、設定画面で保存した統合認証IDとパスワードを使って自動的にログイン処理を実行します。毎回手入力する手間が省けます。',
        '自動ログアウト無効化': 'Ku-LMSは一定時間操作がないと自動的にログアウトされます。この機能を有効にすると、バックグラウンドで定期的に通信セッションを維持することで、意図しないログアウトを防ぎます。<br>ku-portについては作成を検討中です。',
        '課題リストアップ': 'Ku-LMSから未提出の課題や未実施のテスト情報を収集し、ホーム画面に一覧表示します。完了には15秒間ほど時間がかかります。設定によりメールで課題通知を受け取ることもできます。',
        'Meetミュート参加': 'オンライン授業で使用されるGoogle Meetに参加する際、意図せずマイクやカメラがONになる事故を防ぎます。参加と同時に自動で両方をミュート状態にします。',
        '履修中科目のみ表示': 'Ku-LMSの講義一覧の検索フィルターを記憶し、再読み込みしてもユーザーの設定が維持されます。<br>また、「自動」というチェックボックスが追加され、有効にすると現在のクォーターを自動で判別し、学期にあった科目のみを表示します。<br>授業時間中にはその授業のカードの枠が水色から赤色にハイライトされます。',
        '授業時間表示': 'Ku-LMSの画面右上に、現在の時刻と次の授業の開始または現在の授業の終了までのカウントダウンを表示します。<br>クリックすることで2-3限連続授業用に切り替わります。',
        'ダークモード': 'Ku-LMSの画面全体を、ダークテーマに変更します。',
        '自動出席': '指定したクォーター・曜日・時限の授業が始まる3分前に、自動で出席ボタンを押し、設定したGoogle Meetに参加します。設定を変更することで、「Meetに参加するだけ」あるいは「出席ボタンを押すだけ」の動作にカスタマイズすることも可能です。<br>自動ログイン、自動ログアウト無効化、Meetミュート参加の各機能と組み合わせて利用することを推奨します。'
    };

    const modal = document.getElementById('feature-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalDescription = document.getElementById('modal-description');
    const closeModalButton = document.getElementById('modal-close-button');
    const featureCards = document.querySelectorAll('.feature-card');

    const openModal = (title, description) => {
        modalTitle.textContent = title;
        modalDescription.innerHTML = description.replace(/\n/g, '<br>');
        modal.classList.add('visible');
        document.body.classList.add('modal-open');
    };

    const closeModal = () => {
        modal.classList.remove('visible');
        document.body.classList.remove('modal-open');
    };

    featureCards.forEach(card => {
        card.addEventListener('click', () => {
            const title = card.querySelector('h3').textContent;
            const description = featureDetails[title] || '詳細な説明は現在準備中です。';
            openModal(title, description);
        });
    });

    closeModalButton.addEventListener('click', closeModal);
    modal.addEventListener('click', (event) => {
        if (event.target === modal) {
            closeModal();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && modal.classList.contains('visible')) {
            closeModal();
        }
    });

    const handleHashLink = () => {
        const hash = window.location.hash;
        if (hash) {
            setTimeout(() => {
                const targetElement = document.querySelector(hash);
                if (targetElement) {
                    targetElement.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                }
            }, 500);
        }
    };

    populateDownloads().then(() => {
        handleHashLink();
    });

    window.addEventListener('load', handleHashLink);
});