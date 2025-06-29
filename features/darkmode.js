(function () {
if (document.readyState === 'loading') {
document.addEventListener('DOMContentLoaded', applyDarkMode);
} else {
applyDarkMode();
}

function applyDarkMode() {
const style = document.createElement('style');
style.textContent = `

body, html {
	background-color: #121212 !important;
	color: #e0e0e0 !important;
}

/* ヘッダー全体の背景とテキスト色 */
.lms-header-inner {
	background-color: #2a2a2a;
	color: #f0f0f0;
}

.lms-header-title a img,
.lms-footer-logo img {
	filter: brightness(0) invert(1);
	/* ロゴ画像を白に */
}

.lms-user-name {
	color: #f0f0f0;
}

.lms-header-text a {
	color: #f0f0f0;
}

/* ハンバーガーメニュー */
.lms-header-menu,
.lms-sp-gnav,
.lms-menu-column {
	background-color: #2a2a2a;
	color: #f0f0f0;
}

/* 各アイコン・テキスト領域 */
.lms-header-icon-text,
.lms-user-action ul li,
.lms-language,
.lms-select-list-settei,
.lms-user-menu,
.lms-logout-button,
.lms-gear-mark {
	color: #f0f0f0;
}

.userAction ul li a {
	color: #f0f0f0 !important;
}

/* ドロップダウンメニューの背景と境界 */
.selectList,
.selectListSettei,
.lms-select-list-settei,
.lms-sp-gnav-sub {
	background-color: #333;
	border: 1px solid #555;
}

.selectList li a,
.selectListSettei li a,
.lms-sp-gnav-sub li a {
	color: #f0f0f0;
}

/* ホバー時 */
.selectList li:hover,
.selectListSettei li:hover,
.lms-sp-gnav-sub li:hover {
	background-color: #444;
}

/* ハンバーガーオーバーレイ */
#hamburger-menu-overlay {
	background-color: rgba(0, 0, 0, 0.6);
}

/* フッター */
.lms-sp-footer {
	background-color: #1e1e1e;
	color: #ccc;
}

/* 最終ログイン表示 */
.last_login_date {
	background-color: #2a2a2a;
	color: #ccc;
}

/* カード全体の背景とテキスト色 */
.lms-card {
	background-color: #2b2b2b;
	color: #f0f0f0;
}

/* コース情報エリア */
.courseCardInfo,
.lms-cardcontents,
.lms-cardname,
.lms-cardrole,
.lms-carduser {
	color: #f0f0f0;
}

/* 前期などの term 表示 */
.term {
	color: #cccccc;
}

/* カード内のリンク */
.lms-cardname a {
	color: #80c0ff;
}

.courseCardInfo {
	background-color: rgb(85, 85, 85);
}

.lms-breadcrumb {
	background-color: #121212;
}

.lms-category-title h3 {
	color: #f0f0f0 !important;
}

.lms-search-condition, .lms-space-between {
	background-color: #121212 !important;
}

.lms-search-condition-title, .lms-search-condition-detail {
	color: #cccccc;
	!important;
}

.courseSearchRules {
	background-color: #1e1e1e;
	/* 背景色 */
	color: #f0f0f0;
	/* テキスト色 */
}

.lms-form-table th {
	background-color: #2c2c2c;
	/* ヘッダー背景 */
	color: #f0f0f0;
	/* ヘッダーテキスト色 */
}

.lms-form-table td {
	background-color: #2a2a2a;
	/* セル背景 */
	color: #f0f0f0;
	/* セルテキスト色 */
}

.lms-select,
.lms-input {
	background-color: #1e1e1e;
	color: #f0f0f0;
	border: 1px solid #555;
}

.lms-select-wrapper i.fj-icon {
	color: #f0f0f0;
}

.lms-checkbox-show label,
.lms-form-checkbox-label {
	color: #f0f0f0;
}

.lms-checkbox input[type="checkbox"]+label span.fj-icon {
	border-color: #aaa;
}

.lms-checkbox input[type="checkbox"]:checked+label span.fj-icon {
	background-color: rgb(27, 27, 27);
	/* チェック済み時の色 */
}

.lms-select-wrapper .lms-select {
	background-color: #1e1e1e;
	color: #f0f0f0;
}

/* カードにホバーしたときの背景変化（任意） */
.lms-card:hover {
	background-color: #3a3a3a;
}

.lms-search-advanced, .lms-footer-contents {
	background-color: #121212 !important;
}

.lms-news-container,
.lms-news-block,
.lms-news-contents,
.lms-menu-column,
.homeProfHeader,
.homeProfContents,
.lms-study,
.last_login_date,
#homework {
	background-color: #1e1e1e !important;
	color: #e0e0e0 !important;
	border-color: #333 !important;
}

.lms-news-title {
	background-color: #2c2c2c !important;
	color: #ffffff !important;
	font-weight: bold;
	padding: 8px;
	border-radius: 4px;
}

.lms-news-title a,
.lms-news-subO a,
.homeProfNameLink,
.lms-home-prof-detail,
.last_login_date a,
.lms-study a {
	color: #80cbc4 !important;
	text-decoration: underline;
}

.lms-news-subO,
.homeworkItem {
	list-style: none;
	padding: 6px 0;
	border-bottom: 1px solid #333 !important;
}

.homeProfName {
	font-weight: bold;
	color: #ffffff !important;
}

.homeworkItem div {
	color: #e0e0e0 !important;
}

.homeworkItem div[style*="color: red"] {
	color: #ff8a80 !important;
}

.homeworkItem div[style*="color: #666"] {
	color: #888888 !important;
}

img {
	filter: brightness(0.8) contrast(1.2);
}

.lms-last-login-label {
	color: #bbbbbb !important;
}

a:hover {
	color: #4dd0e1 !important;
}

#cs_centerVox2 {
	background-color: #141414 !important;
}

input.lms-basic-button.changeProcessed {
	background-color: #333333 !important;
	/* 背景をダークに */
	box-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
	/* 立体感を少し追加 */
	transition: background-color 0.3s, color 0.3s;
}

input.lms-basic-button.changeProcessed:hover {
	background-color: #444444;
	/* ホバー時に少し明るく */
	cursor: pointer;
}

html body .lms-side-menu {
	background-color: #1e1e1e !important;
}

div#cs_rightVox {
	background-color: #1b1b1b !important;
}

.allOpenText {
	color: #8d8d8d !important;
}

.lms-menu-column ul li a {
	color: #007EB4 !important;
}

.lms-menu-column li.lms-menu-current>a, .lms-menu-column li.current>a {
	background-color: #333333 !important;
}

span.orangeblock {
	background-color: #452f23;
}

span.grayblock {
	background-color: #2f2f2f;
}

div.box01 {
	background-color: #1b1b1b;
}

.lms-row5 .lms-textarea {
	background-color: #1b1b1b;
	color: #ffffff;
}

.lms-float-table th, .lms-usual-table th {
	background: #292929;
}

.lms-usual-table td, .lms-float-table td {
	color: #00efef;
}

p.box01 {
	background-color: #2b2b2b;
}

table.cs_table5 th {
	background-color: #2c2c2c;
}

.centerLabel {
	background-color: #1b1b1b;
}

.lms-category-subtitle {
	background-color: #2f2f2f;
}

.lms-category-subtitle>h3 {
	color: #ffffff;
}

.lms-float-table th, .lms-usual-table th {
	color: #ffffff;
}

`;
document.head.appendChild(style);
}
})();