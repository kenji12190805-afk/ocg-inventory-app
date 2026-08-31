# データ層スキーマ設計

対象: [schema.sql](schema.sql)（パイプラインがビルドし、アプリが同期する読み取り専用データセット）、
[app-local-schema.sql](app-local-schema.sql)（アプリが端末上で持つユーザーデータ）。

## 設計方針

- BabelCDBの`datas`/`texts`テーブルの構造とビット表現をそのまま踏襲する。
  `yugioh-duel-engine/play.mjs`の`loadCards()`と`AndroidStudioProjects/yuugiou`の
  `CardDatabase.kt`（`ocg/CardDatabase.kt:44-84`）で同じデコード処理が実装済みなので、
  `card_type`/`race`/`attribute`のビット定数（ocgcore-wasmのOcgType/OcgRace/OcgAttribute）を
  このアプリでも再定義せず流用できる。
- 日本語名・効果文のマージも既存実装を踏襲する。`CardDatabase.kt`の
  `buildMergedJapaneseDb()`（同ファイル149-170行目）が、yukisaba/EDOPro_japaneseの
  差分cdb（ファイル名に埋め込まれた日付順）を`INSERT OR REPLACE INTO texts`で
  古い順から適用する方式をすでに実装・検証済み。データパイプラインでもこのマージ
  ロジックをそのまま移植する（アプリ起動時ではなく、パイプライン側で1回だけ実行し、
  結果を同期データセットに含める）。
- 属性・種別・種類での検索（追加機能#3）は、BabelCDB本体の`attribute`/`race`/`card_type`
  カラムだけで実現できる。Yugipediaへの依存は不要。
- 効果文検索（追加機能#2）は`texts.desc`カラムが情報源。既存の`play.mjs`は
  チェーン確認プロンプト用にstr1-16しか読んでおらず`desc`は未使用だが、
  `CardDatabase.kt`のマージは`SELECT *`なので`desc`もすでにマージ対象に入っている。
- 日本語検索（追加機能#1）はFTS5ではなく、かな正規化した列＋`LIKE`で実現する方針。
  収録カード数は1〜2万件程度でスマホのローカルSQLiteなら全件LIKE検索でも十分速く、
  FTS5のtrigramトークナイザ（SQLite 3.34+）がCapacitor SQLiteプラグインの
  バンドルSQLiteバージョンやAndroidの端末側SQLiteで確実に使えるかは未検証。
  シンプルさと確実な動作を優先し、`name_ja_normalized`/`desc_ja_normalized`
  （ひらがな→カタカナ変換＋小文字化）を持たせて、検索クエリ側も同じ正規化を
  かけてから`LIKE '%...%'`する。
- 収録弾・レアリティ（`card_prints`）はYugipediaのSet Card Lists（MediaWiki API）が
  情報源。BabelCDBの`setcode`はアーキタイプタグであり収録弾情報ではないため
  （ブリーフで既出）、完全に別テーブルにしている。

## 未決定・要確認事項（アプリ層着手時に決める）

1. **同期データセットとユーザーデータの結合方法**: `card_prints.id`/`cards.id`への
   参照を`inventory`/`deck_cards`から張っているが、実際にCapacitor SQLiteで
   1ファイルのDBにまとめるか、同期データセットをRO DBとして`ATTACH`するかは未決定。
   後者なら週次同期のたびにDBファイルを丸ごと差し替えられるので楽だが、
   Capacitor SQLiteプラグインでのATTACH運用の可否を実装時に確認する必要がある。
2. **配布形態**: パイプラインの成果物をビルド済みSQLiteファイルとしてそのまま
   配布する案（`CardDatabase.kt`が今やっているのと同じ形）を想定しているが、
   ブリーフ記載の「SQLiteかJSON」のうちSQLite側で進めてよいか。JSON配布だと
   端末側でCREATE TABLE+INSERTする手間が増えるだけでメリットが薄いため、
   SQLite直配布を推奨。
3. **FTS5 trigramの実機検証**: 上記の通りLIKE方式を採用する前提だが、件数が
   増えた場合の体感速度は一度実機で確認したい。
