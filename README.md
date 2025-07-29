# KLPF (Ku-LMS Plugin Framework)
**工学院大学での生活を少し怠惰にできる拡張機能。**
> CoursePowerからKu-LMSへの移行に伴い、従来の[KALI](https://github.com/SAYUTIM/KALI)はその多くの機能が利用できなくなりました。<br>
> KLPFは、新しいKu-LMSに対応するために開発された後継の拡張機能です。

# [ホームページ](https://sayutim.github.io/KLPF/)

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

### 余談

ユーザー名とパスワードを入力する際は、`chrome://password-manager/passwords/kogakuin.ac.jp`にアクセスすると**素早く統合認証ユーザー名とパスワードを取得**できます。


# 機能🎉

### 自動ログイン
　→[Ku-LMS](https://study.ns.kogakuin.ac.jp) もしくは [ku-port](https://ku-port.sc.kogakuin.ac.jp) を開くと自動でログインされます。**使用する場合は統合認証ユーザー名とパスワードを入力してください。**

### [β] 自動ログアウト無効化
　→[Ku-LMS](https://study.ns.kogakuin.ac.jp)で自動ログアウトされるのを無効化します。[Ku-LMS](https://study.ns.kogakuin.ac.jp)を開いて放置している場合のみ無効化できます。

### 課題リストアップ
　→未提出課題、未実施テストなどをまとめて[Ku-LMS](https://study.ns.kogakuin.ac.jp)ホーム画面に表示します。更新には10秒ほどかかります。

### Meetミュート参加
　→[Meet](https://meet.google.com/) を開くと自動でカメラとマイクをオフにして参加します。

### [β] テスト自動解答
　→記述式、選択式、プルダウン式テストに対応、AIによる自動解答や正誤判定も可能です。(現在のところ一般公開予定はありません)

### [β] 自動出席
　→クォーター、曜日、時間を選択し、Ku-LMSを開いておくと3分前に自動で出席ボタンを押しmeetに参加します。使用する際は自動ログアウト無効化機能もONにすることをオススメします。

### 履修中科目のみ表示
　→[Ku-LMS](https://study.ns.kogakuin.ac.jp)で講義絞り込み機能の設定を記憶して自動で適用します。自動で履修中科目のみ表示するチェックボックスが追加されます。

### 授業時間表示
　→[Ku-LMS](https://study.ns.kogakuin.ac.jp) で右上に現在時刻と、授業開始もしくは終了までの時間が表示されます。

### ダークモード
　→[Ku-LMS](https://study.ns.kogakuin.ac.jp)にダークモードのテーマを適用します。

## 更新方法
　前バージョンを削除してファイルを置き換えるか、上書き保存してください。

## バージョン管理について
　セマンティックバージョニングに基づいてバージョンアップを行っています。

## OSS License
　The source code is licensed MIT. The website content is licensed CC BY 4.0,see LICENSE.
