# KLPF (Ku-LMS Plugin Framework)
**工学院大学での生活を少し怠惰にできる拡張機能。**
> CoursePowerからKu-LMSへの移行に伴い、従来の[KALI](https://github.com/SAYUTIM/KALI)はその多くの機能が利用できなくなりました。<br>
> KLPFは、新しいKu-LMSに対応するために開発された後継の拡張機能です。

# [ホームページ](https://sayutim.github.io/KLPF/)

[プライバシーポリシー](https://sayutim.github.io/KLPF/privacypolicy/) / [利用規約](https://sayutim.github.io/KLPF/terms/)

このREADMEはリポジトリ内のソースコードを説明しています。配布ZIPは[リリースページ](https://github.com/SAYUTIM/KLPF/releases)から取得してください。未リリースの変更は配布ZIPに含まれていない場合があります。

## 導入方法
### 導入解説動画（画像クリックでYouTubeに飛びます）
[![導入解説動画](https://github.com/user-attachments/assets/2e8c6500-c3da-4e09-aded-d822223914c7)](https://www.youtube.com/watch?v=7dgIjZRtspg)

### 導入方法詳細

動画・画像の名称や画面は現在の版と異なる場合があります。KALIはKLPFの前身の拡張機能です。現在はKLPFのZIPを選んで導入してください。

1. [ここ](https://github.com/SAYUTIM/KLPF/releases)から最新版のKLPFの **ZIP ファイル**をダウンロードします。<br>![S__29761540](https://github.com/user-attachments/assets/bd6f8efe-7f80-451e-af78-fc70d32fcb20)

2. ダウンロードした ZIP ファイルをクリックした後に右クリックをして、任意の場所(おすすめはドキュメントフォルダー直下)に **展開** します。<br>![S__29761539](https://github.com/user-attachments/assets/3e3b8aa4-d7cb-41c7-9367-a61d96fd77f4)

3. **Chrome の拡張機能ページ**`chrome://extensions/`にアクセスし、右上の **「デベロッパーモード」** を有効にします。

4. **「パッケージ化されていない拡張機能を読み込む」** をクリックし、先ほど解凍したフォルダー内にある **KLPF フォルダー** を選択します。

5. 拡張機能「KLPF」が表示されたら、導入終了です。

## 設定の開き方

1. Chrome を開きます。

2. 任意の画面でツールバー以外の任意の場所を**右クリック**します。

3. **「[KLPF] 設定を開く」** をクリックしたら設定画面が開きます。<br>![S__29761541](https://github.com/user-attachments/assets/36d90e8f-6309-4a85-9678-812769d2696e)

Ku-LMSホームでは、右上の歯車メニューにある **「KLPF 設定」** から主要機能のON/OFFを変更できます。オプションページと設定が同期されます。同じメニューからテーマカラー、カスタム画像テーマ、ホームの表示編集、出席状況の手動更新、シラバス・掲示板のON/OFFも利用できます。取得に関する項目は利用条件を満たすと表示されます。

「すべての機能をOFF」を有効にすると、出席率・シラバス・掲示板も停止します。解除時には停止前の機能設定を復元します。

### 余談

Chromeに統合認証の情報を保存している場合は、パスワードマネージャーでユーザー名とパスワードを確認できます。TOTPを利用している場合は、設定画面から秘密鍵も登録できます。手順は[TOTP設定ガイド](https://sayutim.github.io/KLPF/totp/)を参照してください。

> [!WARNING]
> 自動ログイン用のユーザー名、パスワード、TOTP秘密鍵は、Chromeのローカルストレージに暗号化されずに保存されます。詳細は[プライバシーポリシー](https://sayutim.github.io/KLPF/privacypolicy/)を確認してください。


# 機能🎉

### 自動ログイン
　→[Ku-LMS](https://study.ns.kogakuin.ac.jp) もしくは [ku-port](https://ku-port.sc.kogakuin.ac.jp) を開くと自動でログインされます。**使用する場合は統合認証ユーザー名とパスワードを入力してください。** TOTP秘密鍵を登録すると、ワンタイムパスワードの入力にも対応します。

同じ認証段階への自動送信が10秒以内に3回あり、再び認証画面へ戻った場合は4回目の送信を停止します。遅い再送ループも防ぐため、10分以内の6回目も停止します。回数は拡張機能内に保存され、認証ページの再読み込みやService Workerの再起動ではリセットされません。停止した場合は認証情報を確認し、自動ログインをOFF→ONにして再試行できます。手動ログインは引き続き利用できます。

### 自動ログアウト無効
　→[Ku-LMS](https://study.ns.kogakuin.ac.jp)で自動ログアウトされるのを無効化します。[Ku-LMS](https://study.ns.kogakuin.ac.jp)を開いて放置している場合のみ無効化できます。

### 課題リストアップ
　→未提出課題、未実施テストなどをまとめて[Ku-LMS](https://study.ns.kogakuin.ac.jp)ホーム画面に表示します。Webhook を設定すると通知機能も利用できます。

### Meetミュート参加
　→[Meet](https://meet.google.com/) を開くと自動でカメラとマイクをオフにして参加します。

### [β] 自動出席
　→クォーター、曜日、時限とMeet URLを設定し、Ku-LMSホームを開いておくと授業開始3分前に自動でMeetへ参加します。出席ボタンの自動押下は設定で切り替えます。Meetミュート参加・自動ログアウト無効もONにすることをおすすめします。

### ホーム出席表示
　→[Ku-LMS](https://study.ns.kogakuin.ac.jp)ホーム画面で、出席ボタンが存在する授業カードに出席バッジを表示します。

### 出席率表示

**デフォルトではOFFです。** 初めてONにするときに、Ku-Portへのバックグラウンドアクセスに関する確認画面を表示します。

今年度の取得可能な1Q〜4Qの出席率と最終カードタッチ日を集め、授業カードへ表示します。過年度の表示中は取得・表示を行いません。取得はブラウザ起動後の初回ホーム表示時に要求し、保存済み情報を利用する場合があります。ホームの歯車メニューにある「出席状況🔄️」からも更新できます。手動更新には30秒間のクールダウンがあります。

### シラバス表示

**デフォルトではONです。** 利用条件を満たすと、今年度の日〜土曜日の授業カードの教員名付近に三本線のボタンを表示します。「その他」や過年度の授業には表示しません。

ボタンを押した科目のシラバスを取得し、ポップアップで表示します。取得中は進捗バーと残り時間の目安を表示し、閉じる操作で取得を中止できます。科目名、曜日・時限、教員名の順に照合し、対象を特定できない場合は取得を停止します。

取得結果は30日間、最大80件保存します。「シラバス照会」の隣に最終取得日時を秒まで表示し、更新ボタンで再取得できます。**必ずKu-Portのシラバスも確認してください。**

### 掲示板表示

**デフォルトではONです。** 利用条件を満たすと、ホームの「お知らせ」「Topics」の隣に「掲示板」を表示します。Ku-Portの全表示から上位5件を取得し、件名を押すと本文をポップアップで確認できます。

取得に成功した後は、同じブラウザ起動中の再取得を省略します。次回のブラウザ起動時は前回のキャッシュを表示したまま、見出しの隣に「更新中」を出して更新します。

### 出席率・シラバス・掲示板の共通条件

- 自動ログインをONにし、統合認証のユーザー名とパスワードを設定してください。TOTP入力を求められる場合は秘密鍵の設定も必要です。
- 認証情報が空の初回導入時は、これらの取得や取得用ウィンドウの作成を行いません。
- 自動ログインをOFFにすると、3機能の設定もOFFになります。再び自動ログインをONにした後は、利用する機能を個別にONにしてください。
- 自動ログインOFF・認証情報未設定・一括OFF・ログイン再送の停止中は、3機能の表示と取得を停止します。シラバス・掲示板のメニュー項目も非表示になります。
- 機能のON/OFFはオプションページとKu-LMS内のKLPF設定で同期します。シラバス・掲示板はホームの歯車メニューからも切り替えられます。
- 取得時は拡張機能専用の最小化ウィンドウで認証し、フォーム情報を得た後にウィンドウを閉じて直接通信します。
- 通常のKu-Portタブが開いていると取得を開始しません。途中で開かれた場合も中断し、拡張機能が作成した取得用画面を閉じます。通常のタブを取得に利用しません。
- 複数の取得要求は **出席率 → 掲示板 → シラバス** の優先順位で待機・実行します。同順位は受付順です。実行中の取得への割り込みは行いません。

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

### ホームの表示編集・課題カレンダー

ホームの歯車メニューにある「ホームの表示を編集」から、左カラムの並び替えや表示切り替え、課題の非表示・復元を操作できます。課題の期限をカレンダーで確認でき、予定が4件以上の日は「・+残り件数」で表示します。

### テーマカラー変更
　→Ku-LMS上の要素を選択して、文字色・背景色・枠線色を個別に変更できます。授業カードの出席状況欄、最終カードタッチ、出席率、更新状態もそれぞれ選択できます。期限間近の課題の日付は警告色を維持します。

### カスタム画像テーマ
　→好きな画像をKu-LMSの背景に設定し、明るさ、ぼかし、透過度などを調整できます。授業メニューやホーム左カラムへ透過度を適用する設定にも対応します。

## 開発者向け構成

### 全体の階層

主要なファイルを抜粋しています。共通部品の詳細は各フォルダの説明と開発資料を参照してください。

```text
KLPF/
├─ manifest.json
├─ background.js
├─ background/
│  ├─ modules/
│  │  ├─ auth-access.js
│  │  ├─ kuport-runtime.js
│  │  ├─ kuport-form.js
│  │  └─ priority-queue.js
│  └─ kuport/
│     ├─ syllabus.js
│     ├─ syllabus-matching.js
│     └─ bulletin.js
├─ scripts.config.js
├─ features/
│  ├─ modules/
│  │  └─ kuport-access.js
│  ├─ pageWorld/
│  ├─ AutoLogin.js
│  ├─ attend.js
│  ├─ homeAttendance.js
│  ├─ attendanceRate.js
│  ├─ syllabus.js
│  ├─ syllabusSessionBridge.js
│  ├─ bulletinBoard.js
│  ├─ bulletinSessionBridge.js
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
│  ├─ kuportParser.html
│  └─ kuportParser.js
├─ setting/
│  ├─ main.js
│  ├─ options.html
│  ├─ options.css
│  └─ modules/
│     ├─ backup.js
│     ├─ backup-format.js
│     ├─ settings.js
│     ├─ ui.js
│     └─ updatecheck.js
├─ gas/
├─ icon/
├─ docs/
│  ├─ privacypolicy/
│  ├─ terms/
│  ├─ totp/
│  └─ development/
├─ templates/
├─ vendor/
├─ tests/
├─ tools/
│  └─ check-syntax.js
├─ .github/workflows/check.yml
├─ .stylelintrc.json
├─ .htmlvalidate.json
├─ eslint.config.js
├─ package.json
├─ package-lock.json
└─ README.md
```

### 主要ファイルの役割

#### `manifest.json`
拡張機能の入口です。権限、バックグラウンドスクリプト、オプションページ、`web_accessible_resources` を定義します。  
`features/pageWorld/` 配下のような page world 用スクリプトをページへ注入するときも、ここで公開設定が必要です。

#### `background.js`
Manifest V3 Service Worker のエントリーポイントです。初回設定、右クリックメニュー、GAS送信、Ku-portへの一時ログイン画面、出席情報のバックグラウンド取得、競合時の中断をChromeイベントへ接続します。シラバス・掲示板の通信は`background/kuport/`、共通の画面・解析管理は`background/modules/kuport-runtime.js`へ分離しています。

取得ジョブの期限は`background/modules/kuport-job-timeouts.js`で監視します。認証待ちも含めた開始時刻を保存し、Service Workerの起動時に監視を復元します。Chromeアラームの利用に必要な`alarms`権限を宣言しています。

動的content script登録、出席取得状態、更新通知、外部URL検証は`background/modules/`へ分離されています。登録内容が変わっていない場合は不要な解除・再登録を行いません。

#### `background/modules/` と `background/kuport/`

- `modules/auth-access.js`
  認証設定と一括OFF状態を確認し、自動ログインの送信履歴・停止状態を管理します。
- `modules/kuport-runtime.js`
  取得用ウィンドウの所有確認、通常のKu-Portタブとの競合検知、offscreenへの解析依頼を共通化します。
- `modules/kuport-form.js`
  JSFフォームの送信内容を組み立て、直接通信に必要な情報を扱います。
- `modules/priority-queue.js`
  優先順位と受付順に従って、取得処理を直列化します。
- `kuport/syllabus.js`, `kuport/syllabus-matching.js`
  時間割とシラバスの直接通信、対象科目の照合を担当します。
- `kuport/bulletin.js`
  掲示板の全表示への切り替えと、上位5件の本文取得を担当します。

#### `scripts.config.js`
機能一覧の定義ファイルです。  
各機能について

- `storageKey`
- 読み込む JS
- どの URL に注入するか
- デフォルトで ON か
- オプション画面のどのパネルに対応するか

をまとめています。`CONTENT_SCRIPTS_CONFIG`は動的注入の定義、`FEATURE_SETTINGS_CONFIG`は静的注入のシラバス・掲示板を含む設定用の一覧です。オプションページとKu-LMS内設定、一括OFFで同じ保存キーと既定値を共有します。

静的注入のスクリプトは`manifest.json`の`content_scripts`に記載します。共有モジュールを先に読み込み、画面側で有効状態を判定します。

### `features/` フォルダ

Ku-LMS / Ku-Port / Meet上で動くcontent scriptです。動的注入は`scripts.config.js`、静的注入は`manifest.json`で定義します。シラバス・掲示板は表示と通信を分け、画面側からruntimeメッセージで取得を依頼します。

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
  所有確認済みのKu-Port取得用タブで認証フォームや出席表を読み、Ku-LMSでは今年度の授業カードへ出席情報と更新状態を表示します。年度内の各クォーターの直接通信は`background.js`が担当します。
- `syllabus.js`
  今年度の授業カードのボタン、進捗・本文ポップアップ、30日キャッシュ、再取得を管理します。
- `bulletinBoard.js`
  ホームの掲示板欄と本文ポップアップ、キャッシュ表示と更新状態を管理します。
- `syllabusSessionBridge.js`, `bulletinSessionBridge.js`
  拡張機能が所有する認証用タブからフォーム情報を受け渡します。通常のKu-Portタブは利用しません。
- `homeDashboard.js`
  ホーム左カラムの並び替え・表示切り替え、非表示にした課題の復元、課題カレンダーの表示と編集UIを管理します。課題データは`homework.js`が生成したDOMを再利用します。
- `lmsInlineSettings.js`
  KU-LMS内のKLPF設定パネル、テーマカラー変更、ホーム編集、出席状況の手動更新、シラバス・掲示板の切り替えメニューを管理します。再評価時も同じUIを再利用し、重複挿入を防ぎます。
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
- `form-utils.js`
  フォーム項目の直列化とaction URL解決をまとめた共通処理。ホーム出席表示とOffscreen Documentで、従来の戻り値形式を維持して再利用します。
- `totp.js`
  自動ログインで使うTOTP生成処理。
- `kuport-access.js`
  バックグラウンドから認証情報を含まない利用可否を取得し、3機能の表示と設定UIへ通知します。
- `version-utils.js`
  リリースタグを含むバージョン文字列を解析・比較します。

新しい機能を書くときに、複数ファイルで同じ DOM 待機や定数が必要ならここへ寄せます。

### `features/pageWorld/` フォルダ

ページ自身の JavaScript と同じ world で動かす補助スクリプトです。  
content script からは直接触れないページ関数を呼ぶときに使います。

現状は次があります。

- `logoutBlock.js`
  自動ログアウト無効機能から注入し、LMSのページ関数でセッションタイマーの延長を補助します。
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
- `modules/backup-format.js`
  バックアップ形式の検証と、復元する設定値の選別。
- `modules/updatecheck.js`
  更新確認。

機能のON/OFFを`chrome.storage.sync`、認証情報を`chrome.storage.local`へ保存します。動的注入の登録は`background.js`が反映し、静的注入の機能は画面側でも変更を監視します。シラバス・掲示板のスイッチはKu-LMS内設定と同期します。

出席率表示を初めてONにするときは、オプションページとKu-LMS内設定のどちらから操作しても同じ確認画面が表示されます。OKを押すまで機能は有効になりません。

### `offscreen/` フォルダ

Ku-Portから取得したHTML・JSF部分応答をDOMとして解析するOffscreen Documentです。`kuportParser.html`が共通モジュールと`kuportParser.js`を読み込み、フォーム、出席表、シラバスの項目、掲示板の一覧・本文を解析して結果を返します。認証や通信はここでは行いません。出席表の解析には`features/modules/attendance-utils.js`を再利用します。

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
- `development/`
  Ku-Port取得の構成、整理内容、コメント方針など、OSSの保守向け資料。

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

1. Chromeが`manifest.json`を読み、静的なcontent scriptとService Workerを用意する
2. `background.js`が保存設定と`scripts.config.js`を参照し、有効な動的content scriptを登録する
3. 対象URLを開くと、静的・動的の各スクリプトが注入される
4. 各機能が設定・認証条件・一括OFF状態を確認し、表示や操作を行う
5. Ku-Port取得はruntimeメッセージで依頼し、待機キュー、専用認証画面、直接通信、offscreen解析を経て保存・通知する

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
  ユーザー名、パスワード、TOTP秘密鍵、出席情報、シラバス・掲示板のキャッシュ、課題データ、一括OFFと復元用の設定など端末内に保存する情報
- `chrome.storage.session`
  3機能の取得ジョブ、ブラウザ起動中の取得済み状態、手動更新の待ち時間、自動ログインの送信履歴・停止状態など。ページの再読み込みやService Workerの再起動をまたいで保持する状態
- `sessionStorage`
  `homeAttendance.js` のようなページ内だけで十分な短時間キャッシュ
- ページ側 `localStorage`
  `attend.js` の一時状態管理など、特定機能がページ上で使う一時データ

## どこから読めばいいか

- 機能追加の入口を知りたい  
  → `scripts.config.js`
- 機能の登録や初期化の流れを知りたい  
  → `background.js` と `background/modules/`
- 設定画面を触りたい  
  → `setting/options.html` と `setting/modules/settings.js`
- Ku-LMSホームのUIを見たい
  → `features/homework.js`, `features/homeDashboard.js`, `features/lmsInlineSettings.js`
- Ku-Port取得と認証条件を変更したい
  → `background/kuport/`, `background/modules/kuport-runtime.js`, `background/modules/auth-access.js`, [Ku-Port取得の構成](docs/development/kuport.md)
- page world が絡む実装を見たい  
  → `features/homeAttendance.js` と `features/pageWorld/homeAttendance.js`

## OSS向け 新機能追加テンプレート

### 最短手順

1. `templates/feature/contentScript.template.js` を `features/YourFeature.js` にコピー
2. `scripts.config.js` の「新機能追加テンプレート」コメントをコピーして有効化
3. `id`, `storageKey`, `TodoFeature.js`, `matches`, `optionsPanelId` を自分の機能名に置換
4. `features/YourFeature.js` の TODO を埋める
5. 設定画面が必要なら `setting/options.html` と `setting/modules/settings.js` に項目を追加
6. page worldが必要なら`templates/feature/pageWorld.template.js`を`features/pageWorld/YourFeature.js`へコピーし、`manifest.json`の`web_accessible_resources`に追加

この手順は動的注入の機能向けです。静的注入を使う場合は、manifestへの登録と`FEATURE_SETTINGS_CONFIG`への設定定義の追加、注入済み画面でのON/OFF変更の監視を組み合わせます。

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

## 開発時の検証

Node.jsのActive LTSとnpmを用意し、リポジトリ直下で次を実行します。

```powershell
npm ci
npm run check
```

`npm run check`は、first-party JavaScriptの構文検査、ESLint、CSS検査、HTML構造検査、Node標準テストを順に実行します。`vendor/`、画像、ローカルのブラウザ操作データは検査対象外です。pushとPull RequestではGitHub Actionsでも同じ検査を実行します。

既存テストには、manifestと設定ファイルの参照整合性、動的scriptのIDと保存キー、TOTP既知ベクトル、出席表・フォーム・シラバスの解析、URL許可、バックアップschemaVersion 1、content scriptの差分登録、取得キュー、シラバスUIの確認が含まれます。検査の実行結果と実サイトの動作確認は分けて扱ってください。

### 実サービスの手動回帰確認

認証情報や大学サービスへの接続が必要な機能はCIから実行しません。リリース前にテスト用アカウントまたは自身の環境で、次を確認してください。

1. 拡張機能をパッケージ化せず読み込み、Service Workerに起動時エラーがない。
2. 設定画面で各機能のON/OFF、並び順、バックアップのエクスポート・再インポートが維持される。
3. Ku-LMSで課題、科目絞り込み、出席バッジ、出席率、シラバス、掲示板、テーマ、ホーム編集が重複表示されない。
4. 出席率・シラバスは今年度のみ表示・取得し、シラバスの「その他」カードにはボタンが出ない。
5. Ku-Port取得の成功・取消・既存タブ・途中で開かれた外部タブ・同時要求・元のLMSタブ終了を確認する。
6. シラバスの30日キャッシュ・日時・再取得と、掲示板の同一起動中のキャッシュ利用・次回起動時の更新を確認する。
7. 認証情報が空、自動ログインOFF、一括OFF、ログイン再送停止中に取得しない。設定の同期・復元も確認する。
8. 認証ページの再読み込みでも再送上限が保持され、手動ログインできる。Ku-Portの枠外クリックも確認する。
9. Google Meetのミュート参加、自動出席、教材一括開封を個別に確認する。
10. GASセットアップとWebhook通知をテストデータで確認し、実際の認証情報をIssueやログへ残さない。

## 更新方法

1. 新しい配布ZIPを展開し、現在Chromeで読み込んでいるKLPFフォルダーのファイルを置き換えます。
2. `chrome://extensions/`でKLPFの再読み込みボタンを押します。
3. 開いているKu-LMS・Ku-Portのページも再読み込みします。

同じ拡張機能の読み込み先を更新すれば、設定を引き継いで利用できます。保存済み設定はオプションページからバックアップできます。

## バージョン管理について
　セマンティックバージョニングに基づいてバージョンアップを行っています。

## OSS License

ソースコードは[MITライセンス](LICENSE)、WebサイトのコンテンツはCC BY 4.0です。

## 開発資料

[Ku-Port取得の構成と安全条件](docs/development/kuport.md)を参照してください。
