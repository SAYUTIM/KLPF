# KLPF (Ku-LMS Plugin Framework)
**工学院大学での生活を少し怠惰にできる拡張機能。**
> CoursePowerからKu-LMSへの移行に伴い、従来の[KALI](https://github.com/SAYUTIM/KALI)はその多くの機能が利用できなくなりました。<br>
> KLPFは、新しいKu-LMSに対応するために開発された後継の拡張機能です。

# [ホームページ](https://sayutim.github.io/KLPF/)

[プライバシーポリシー](https://sayutim.github.io/KLPF/privacypolicy/) / [利用規約](https://sayutim.github.io/KLPF/terms/)

## 導入方法
### 導入解説動画（画像クリックでYouTubeに飛びます）
[![導入解説動画](https://github.com/user-attachments/assets/2e8c6500-c3da-4e09-aded-d822223914c7)](https://www.youtube.com/watch?v=7dgIjZRtspg)

### 導入方法詳細（※ KALIはKLPFの旧名称です。文中のKALIはKLPFを指します。）
1. [ここ](https://github.com/SAYUTIM/KLPF/releases)から最新版のKLPFの **ZIP ファイル**をダウンロードします。<br>![S__29761540](https://github.com/user-attachments/assets/bd6f8efe-7f80-451e-af78-fc70d32fcb20)

2. ダウンロードした ZIP ファイルをクリックした後に右クリックをして、任意の場所(おすすめはドキュメントフォルダー直下)に **展開** します。<br>![S__29761539](https://github.com/user-attachments/assets/3e3b8aa4-d7cb-41c7-9367-a61d96fd77f4)

3. **Chrome の拡張機能ページ**`chrome://extensions/`にアクセスし、右上の **「デベロッパーモード」** を有効にします。

4. **「パッケージ化されていない拡張機能を読み込む」** をクリックし、先ほど解凍したフォルダー内にある **KLPF フォルダー** を選択します。

5. 拡張機能「KLPF」が表示されたら、導入終了です。

## 設定の開き方

1. Chrome を開きます。

2. 任意の画面でツールバー以外の任意の場所を**右クリック**します。

3. **「[KLPF] 設定を開く」** をクリックしたら設定画面が開きます。<br>![S__29761541](https://github.com/user-attachments/assets/36d90e8f-6309-4a85-9678-812769d2696e)

Ku-LMSホームでは、右上のユーザーメニューにある **「KLPF 設定」** から主要機能のON/OFFを変更できます。同じメニューからテーマカラー、カスタム画像テーマ、出席状況の手動更新も利用できます。

### 余談

ユーザー名とパスワードを入力する際は、`chrome://password-manager/passwords/kogakuin.ac.jp`にアクセスすると**素早く統合認証ユーザー名とパスワードを取得**できます。TOTPを利用している場合は、設定画面からTOTP秘密鍵も登録できます。

> [!WARNING]
> 自動ログイン用のユーザー名、パスワード、TOTP秘密鍵は、Chromeのローカルストレージに暗号化されずに保存されます。詳細は[プライバシーポリシー](https://sayutim.github.io/KLPF/privacypolicy/)を確認してください。


# 機能🎉

### 自動ログイン
　→[Ku-LMS](https://study.ns.kogakuin.ac.jp) もしくは [ku-port](https://ku-port.sc.kogakuin.ac.jp) を開くと自動でログインされます。**使用する場合は統合認証ユーザー名とパスワードを入力してください。** TOTP秘密鍵を登録すると、ワンタイムパスワードの入力にも対応します。

### 自動ログアウト無効
　→[Ku-LMS](https://study.ns.kogakuin.ac.jp)で自動ログアウトされるのを無効化します。[Ku-LMS](https://study.ns.kogakuin.ac.jp)を開いて放置している場合のみ無効化できます。

### 課題リストアップ
　→未提出課題、未実施テストなどをまとめて[Ku-LMS](https://study.ns.kogakuin.ac.jp)ホーム画面に表示します。Webhook を設定すると通知機能も利用できます。

### Meetミュート参加
　→[Meet](https://meet.google.com/) を開くと自動でカメラとマイクをオフにして参加します。

### [β] 自動出席
　→クォーター、曜日、時間を選択し、Ku-LMSを開いておくと3分前に自動で出席ボタンを押しmeetに参加します。使用する際は自動ログアウト無効化機能もONにすることをオススメします。

### ホーム出席表示
　→[Ku-LMS](https://study.ns.kogakuin.ac.jp)ホーム画面で、出席ボタンが存在する授業カードに出席バッジを表示します。

### 出席率表示
　→**デフォルトではOFFです。** 初めてONにするときに、Ku-portへのバックグラウンドアクセスに関する確認画面を表示します。同意後は、ブラウザの起動後に初めてKu-LMSホームを開いたとき、最小化した一時ウィンドウでKu-portの認証を行い、出席率と最終カードタッチ日を取得して授業カードへ表示します。表示中の情報がキャッシュ・更新中・最新のどれかも確認できます。ホームの設定メニューにある「出席状況🔄️」から30秒間隔で手動更新でき、Ku-portが開いている場合や取得途中に開かれた場合は競合を避けるため処理を中断します。

### 教材一括開封
　→教材ページで教材リンクの隣に一括開封ボタンを追加します。リンク先の教材をまとめて開き、参照済みにできます。

### 履修中科目のみ表示
　→[Ku-LMS](https://study.ns.kogakuin.ac.jp)で講義絞り込み機能の設定を記憶して自動で適用します。自動で履修中科目のみ表示するチェックボックスが追加されます。

### KP枠外簡易閉
　→[ku-port](https://ku-port.sc.kogakuin.ac.jp) の掲示板やシラバスなどのポップアップで、枠外クリックを閉じるボタンと同じ挙動にします。

### 授業時間表示
　→[Ku-LMS](https://study.ns.kogakuin.ac.jp) で右上に現在時刻と、授業開始もしくは終了までの時間が表示されます。

### [β] ダークモード
　→[Ku-LMS](https://study.ns.kogakuin.ac.jp)にダークモードのテーマを適用します。

### テーマカラー変更
　→Ku-LMS上の要素を選択して、文字色・背景色・枠線色を個別に変更できます。授業カードの出席状況欄、最終カードタッチ、出席率、更新状態もそれぞれ選択できます。期限間近の課題の日付は警告色を維持します。

### カスタム画像テーマ
　→好きな画像をKu-LMSの背景に設定し、明るさ、ぼかし、透過度などを調整できます。授業メニューやホーム左カラムへ透過度を適用する設定にも対応します。

## 開発者向け構成

### 全体の階層

```text
KLPF/
├─ manifest.json
├─ background.js
├─ scripts.config.js
├─ features/
│  ├─ modules/
│  ├─ pageWorld/
│  ├─ AutoLogin.js
│  ├─ attend.js
│  ├─ homeAttendance.js
│  ├─ attendanceRate.js
│  ├─ homeDashboard.js
│  ├─ homework.js
│  ├─ lmsInlineSettings.js
│  ├─ customImageTheme.js
│  ├─ kuportDialogClose.js
│  ├─ kyozaiopen.js
│  ├─ LMSlogoutblock.js
│  ├─ meet.js
│  ├─ subject.js
│  └─ time.js
├─ offscreen/
│  ├─ attendanceParser.html
│  └─ attendanceParser.js
├─ setting/
│  ├─ main.js
│  ├─ options.html
│  ├─ options.css
│  └─ modules/
│     ├─ backup.js
│     ├─ settings.js
│     ├─ ui.js
│     └─ updatecheck.js
├─ gas/
├─ icon/
├─ docs/
│  ├─ privacypolicy/
│  ├─ terms/
│  └─ totp/
└─ README.md
```

### 主要ファイルの役割

#### `manifest.json`
拡張機能の入口です。権限、バックグラウンドスクリプト、オプションページ、`web_accessible_resources` を定義します。  
`features/pageWorld/` 配下のような page world 用スクリプトをページへ注入するときも、ここで公開設定が必要です。

#### `background.js`
拡張機能全体の制御役です。`scripts.config.js` を読み、各機能の有効/無効に応じて content script を動的登録します。  
初回インストール時のデフォルト設定保存、右クリックメニュー、GAS送信、設定変更時の再登録に加え、Ku-portへの一時ログイン画面、出席情報のバックグラウンド取得、競合時の中断処理もここが担当します。

#### `scripts.config.js`
機能一覧の定義ファイルです。  
各機能について

- `storageKey`
- 読み込む JS
- どの URL に注入するか
- デフォルトで ON か
- オプション画面のどのパネルに対応するか

をまとめています。新機能を追加するときは、まずここに登録するのが入口です。

### `features/` フォルダ

Ku-LMS / ku-port / Meet 上で動く実装本体です。基本的には「1機能1ファイル」で、`scripts.config.js` から動的に注入されます。

主なファイルは次のとおりです。

- `AutoLogin.js`
  自動ログイン処理。
- `LMSlogoutblock.js`
  Ku-LMS のセッション切れ対策。
- `homework.js`
  ホーム画面の課題集約表示と Webhook 連携。
- `subject.js`
  ホーム画面の講義フィルタ保存と自動適用。
- `homeAttendance.js`
  ホーム画面の出席判定、出席バッジ表示、出席ポップアップ起動の content script 側本体。
- `attendanceRate.js`
  KU-PORT上では出席表を監視してローカルキャッシュへ保存し、KU-LMS上では授業カードとの照合と、キャッシュ・更新中・最新の表示状態を管理します。
- `homeDashboard.js`
  ホーム左カラムの並び替え・表示切り替え、非表示にした課題の復元、課題カレンダーの表示と編集UIを管理します。課題データは`homework.js`が生成したDOMを再利用します。
- `lmsInlineSettings.js`
  KU-LMS内のKLPF設定パネル、テーマカラー変更、ホーム編集や出席状況の手動更新メニューを管理します。再評価時も同じUIを再利用し、重複挿入を防ぎます。
- `customImageTheme.js`
  カスタム背景画像と透過・ぼかし・明るさなどの表示設定を管理。
- `attend.js`
  β機能の自動出席。
- `meet.js`
  Meet 参加前のミュート制御。
- `kyozaiopen.js`
  教材一括開封。
- `kuportDialogClose.js`
  ku-port のポップアップを枠外クリックで閉じやすくする機能。
- `time.js`
  授業時間表示。
- `darkmode.js`
  ダークモード。

### `features/modules/` フォルダ

複数機能で使う共通部品です。

- `constants.js`
  LMS URL、ストレージキー、時間割定義などの共通定数。
- `dom-utils.js`
  `waitForElement`、`safeQuerySelector` などの DOM ユーティリティ。
- `attendance-utils.js`
  科目名の正規化、出席率、最終カードタッチ日の解析をまとめた共通処理。KU-PORTのcontent scriptとOffscreen Documentの両方から同じ実装を読み込みます。
- `totp.js`
  自動ログインで使う TOTP 関連処理。

新しい機能を書くときに、複数ファイルで同じ DOM 待機や定数が必要ならここへ寄せます。

### `features/pageWorld/` フォルダ

ページ自身の JavaScript と同じ world で動かす補助スクリプトです。  
content script からは直接触れないページ関数を呼ぶときに使います。

現状は次があります。

- `homeAttendance.js`
  `features/homeAttendance.js` から渡されたイベントを受けて、LMS ページ側の `dispIframe()` や `Postprocess` に合わせて出席ポップアップを開閉します。

つまり、

- `features/homeAttendance.js` = 拡張側の UI / 通信
- `features/pageWorld/homeAttendance.js` = LMS ページ関数との橋渡し

という分担です。

### `setting/` フォルダ

オプション画面です。

- `options.html`
  設定画面の構造。
- `options.css`
  設定画面のスタイル。
- `main.js`
  設定画面の起動入口。
- `modules/settings.js`
  設定の読み書き、デフォルト値反映、トグル状態管理。
- `modules/ui.js`
  並び替えや表示更新など UI 制御。
- `modules/backup.js`
  設定のインポート / エクスポート。
- `modules/updatecheck.js`
  更新確認。

機能の ON/OFF や資格情報の保存はここから `chrome.storage.sync` / `chrome.storage.local` に書かれ、`background.js` がそれを読んで各 script 登録に反映します。

出席率表示を初めてONにするときは、オプションページとKu-LMS内設定のどちらから操作しても同じ確認画面が表示されます。OKを押すまで機能は有効になりません。

### `offscreen/` フォルダ

KU-PORTから取得したHTMLをDOMとして解析するためのOffscreen Documentです。Service Workerでは`DOMParser`を利用できないため必要で、出席フォーム、JSFの遷移情報、出席率および最終カードタッチ日を解析して、結果だけを`background.js`へ返します。出席表自体の解析規則は`features/modules/attendance-utils.js`を再利用します。

### `gas/` フォルダ

Google Apps Script 連携用です。  
主に課題通知やセットアップ補助で使います。

### `docs/` フォルダ

GitHub Pages / 紹介サイトです。拡張本体ではなく、配布ページやドキュメント側のコードが入っています。

- `privacypolicy/`
  プライバシーポリシー。`/privacypolicy/`で公開されます。
- `terms/`
  利用規約。`/terms/`で公開されます。
- `totp/`
  TOTP秘密鍵の設定ガイド。

### `icon/` フォルダ

拡張機能アイコンです。`manifest.json` から参照されます。

### `templates/` フォルダ

OSS コントリビュータ向けの追加テンプレートです。  
「新しい機能を最短で追加する」ことだけに絞った雛形を置いています。

- `templates/feature/contentScript.template.js`
  content script の最小テンプレート。
- `templates/feature/pageWorld.template.js`
  page world が必要な場合のテンプレート。
- `templates/feature/scripts.config.template.txt`
  `scripts.config.js` に貼る登録雛形。

## 仕組みの流れ

### 基本フロー

1. Chrome が `manifest.json` を読む
2. `background.js` が起動する
3. `background.js` が `scripts.config.js` を見て、有効な content script を登録する
4. 対象 URL を開くと `features/` 配下のスクリプトが注入される
5. 必要に応じて `chrome.storage.sync/local` を読み、各機能が動く

### 例: ホーム出席表示

1. `scripts.config.js` で `homeAttendance.js` が Ku-LMS ホームに登録される
2. `features/homeAttendance.js` がホームカードを集める
3. `linkKougi` を順に叩いて、出席ボタンが存在する授業だけバッジを付ける
4. バッジ押下時は page world 側の `features/pageWorld/homeAttendance.js` に event を送る
5. page world 側が `dispIframe('#iframeCosa')` 相当を実行して、出席ポップアップを開く

### ストレージの使い分け

- `chrome.storage.sync`
  機能のON/OFF、出席率表示への同意、表示設定などChromeプロファイル間で同期する設定
- `chrome.storage.local`
  ユーザー名、パスワード、TOTP秘密鍵、出席情報、課題データなど端末内に保存する情報とキャッシュ
- `chrome.storage.session`
  出席情報取得ジョブ、ブラウザ起動中の取得済み状態、手動更新の待ち時間などブラウザセッション中だけ必要な状態
- `sessionStorage`
  `homeAttendance.js` のようなページ内だけで十分な短時間キャッシュ
- ページ側 `localStorage`
  `attend.js` の一時状態管理など、特定機能がページ上で使う一時データ

## どこから読めばいいか

- 機能追加の入口を知りたい  
  → `scripts.config.js`
- 機能の登録や初期化の流れを知りたい  
  → `background.js`
- 設定画面を触りたい  
  → `setting/options.html` と `setting/modules/settings.js`
- Ku-LMS ホーム系の実装を見たい  
  → `features/homework.js`, `features/subject.js`, `features/homeAttendance.js`
- page world が絡む実装を見たい  
  → `features/homeAttendance.js` と `features/pageWorld/homeAttendance.js`

## OSS向け 新機能追加テンプレート

### 最短手順

1. `templates/feature/contentScript.template.js` を `features/YourFeature.js` にコピー
2. `scripts.config.js` の「新機能追加テンプレート」コメントをコピーして有効化
3. `id`, `storageKey`, `TodoFeature.js`, `matches`, `optionsPanelId` を自分の機能名に置換
4. `features/YourFeature.js` の TODO を埋める
5. 設定画面が必要なら `setting/options.html` と `setting/modules/settings.js` に項目を追加
6. page world が必要なら `templates/feature/pageWorld.template.js` を `features/pageWorld/YourFeature.js` にコピーし、`manifest.json` の `web_accessible_resources` に追加

### 追加パターンの目安

- 普通の DOM 改変だけで完結する
  → `contentScript.template.js` だけで十分
- ページの関数を直接呼びたい
  例: `dispIframe()`, `closeIframe()`, ページのグローバル変数
  → `pageWorld.template.js` も使う
- 設定 UI を増やしたい
  → `setting/options.html` と `setting/modules/settings.js` を合わせて編集する

### `scripts.config.js` の登録テンプレート

`scripts.config.js` には、配列末尾にそのまま使えるコメントテンプレートを入れてあります。  
コメントアウトを外して名前を置き換えれば登録できます。

```js
{
    id: 'TodoFeatureScript',
    storageKey: 'todoFeature',
    js: [MODULES.CONSTANTS, MODULES.DOM_UTILS, `${PATHS.FEATURES}TodoFeature.js`],
    matches: [URLS.KOGAKUIN_LMS],
    runAt: 'document_end',
    enabledByDefault: false,
    optionsPanelId: 'todo-feature-options',
},
```

### 新機能を追加するときの命名ルール

- `id`
  `Background` から見た script の一意名。`TodoFeatureScript` のように `Script` を付けると分かりやすいです。
- `storageKey`
  機能 ON/OFF を保存するキー。`todoFeature` のように lowerCamelCase を使います。
- `optionsPanelId`
  オプション画面の対応パネル ID。`todo-feature-options` のように kebab-case を使います。
- `features/` 配下のファイル名
  `TodoFeature.js` のように機能名ベースで揃えると追いやすいです。

### 最小実装の考え方

最初から複雑にしない方が保守しやすいです。基本は次の順番で追加します。

1. `features/YourFeature.js` を 1 本作る
2. `scripts.config.js` に登録する
3. 動作確認する
4. 必要なら設定 UI を足す
5. 必要なら `features/modules/` や `features/pageWorld/` に分離する

つまり、最初は「コメントアウトを戻す」「名前を置換する」「JS の中身を書く」の 3 ステップで始められる状態にしています。

## 更新方法
　前バージョンを削除してファイルを置き換えるか、上書き保存してください。

## バージョン管理について
　セマンティックバージョニングに基づいてバージョンアップを行っています。

## OSS License
　The source code is licensed MIT. The website content is licensed CC BY 4.0,see LICENSE.
