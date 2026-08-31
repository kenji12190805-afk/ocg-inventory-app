# 遊戯王OCGカード在庫管理アプリ

元ブリーフ: `C:\Users\user\Downloads\ocg-inventory-app-claude-code-brief.md.docx`

## やりたいこと

遊戯王OCGのカード情報を継続的に取得・更新しつつ、カード名を入力して自分の所有枚数(在庫)を
登録・管理できるAndroidアプリ。

## 全体構成

データ取得・更新の層と、ユーザーが触るアプリの層を分離する。アプリ内で毎回スクレイピングや
APIコールをするのではなく、事前に整形済みの軽量データセットをアプリ側が同期して使う。

### データ層(定期実行パイプライン)

- カードマスタ(名前・効果・ステータス): BabelCDBのdeltaリポジトリを定期pull。
  既存の遊戯王ルールエンジン(`C:\Users\user\yugioh-duel-engine`, ocgcore-wasm + BabelCDB +
  CardScripts)のパース/lookupロジックを参照・再利用する。
- 日本語名・効果文: yukisaba/EDOPro_japaneseの差分cdbをマージ。マージロジックは
  `C:\Users\user\AndroidStudioProjects\yuugiou`の`CardDatabase.kt`に実装済みのものを移植する。
- 収録弾・レアリティ: Yugipedia MediaWiki API(Set Card Listsページ、CC BY-SAライセンス)。
  公式DB(db.yugioh-card.com)は構造が変わりやすく利用規約もグレーなので使わない。
- 両方をマージして1つの軽量SQLiteデータセットとしてビルドする。更新頻度は週1程度。
- **実行環境: GitHub Actionsなどクラウドで定期実行**(決定済み)。ビルド済みデータセットを
  リポジトリ/Releases等に置き、アプリはそこから同期する。

### アプリ層(React + Capacitor、Android)

- 食費運用アプリ・宅建アプリと同じ構成(React + Capacitor)を踏襲。
- **ローカルDB: Capacitor SQLiteプラグイン**(決定済み)。
- 起動時などにデータ層の最新データセットを同期。
- カードマスタ+プリント情報+ユーザーの在庫データをローカルに保持し、オフラインでも
  検索・在庫登録ができる。
- コア機能フロー: カード名入力 → あいまい検索でカード特定 → 該当カードの収録弾+レアリティ
  一覧を提示 → 選んで在庫数を+1(数量の直接編集も可)
- 画面表示は**縦画面固定**(Android manifestで`screenOrientation="portrait"`)。

### カメラ在庫登録フロー(追加機能#4の詳細)

1. カメラでカードを撮影
2. 画像認識/OCRで既存カードデータと照合し、候補を上位5件程度提示
3. ユーザーが候補から正しいカードを選択
4. (候補選択後は通常のコア機能フローに合流) 該当カードの収録弾+レアリティ一覧を提示 →
   選択
5. 在庫登録: 対象print_idの`inventory`行がすでに存在すれば数量+1、なければ新規作成
   (`inventory`テーブルの`print_id`にUNIQUE制約を張ってあるので
   `INSERT ... ON CONFLICT(print_id) DO UPDATE SET quantity = quantity + 1`で自然に実現できる)

   ※ 同じイラストのカードは複数弾で再録されることがあるため、画像だけでは収録弾/レアリティ
   までは一意に特定できない想定。カメラはあくまで「カード名の候補出し」を担当し、
   収録弾/レアリティの選択はステップ4で既存のUIに乗せる。

## 追加機能(確定)

1. 日本語で検索できる
2. カードの効果で検索できる
3. カードの属性・種別・種類で検索できる
4. スマートフォンのカメラで在庫登録できる
5. デッキ登録＆不足カード算出: 手持ちデッキリストと在庫を突き合わせて不足枚数を算出
6. エクスポート/バックアップ: CSV書き出し、Google Driveへの手動バックアップ
7. 新弾同期の通知: データセットが更新されたら軽く通知
8. コレクション統計: 弾ごとの収集率、総枚数、レアリティ別内訳のダッシュボード
9. 保管場所メモ: ユーザーが編集可能なプルダウン(コンボボックス)でバインダー名等を記録

## 決定事項

- データ同期パイプラインの実行環境: **GitHub Actions等クラウド**
- ローカルDB: **Capacitor SQLiteプラグイン**
- 着手順: **データ層のスキーマ設計から**(→ [data-pipeline/SCHEMA.md](data-pipeline/SCHEMA.md))

## 未決定(アプリ層着手時に確認)

[data-pipeline/SCHEMA.md](data-pipeline/SCHEMA.md)の「未決定・要確認事項」を参照。
