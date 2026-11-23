# コード辞典 (code-cheatsheet)

Python / JavaScript / C / Kotlin の「やりたいこと辞典」。

- やりたいこと(「くりかえし」「配列に追加」など)や言語名で検索できる
- 4言語の例文を並べて見られる
- **例文をスマホの中でそのまま実行**して、結果を見られる
- **わざとエラーになる例**も用意してあって、エラー文と原因がわかる
- PWA なので、ホーム画面に追加すれば**圏外でも動く**

## どこで何が動くか

| 言語 | 実行する場所 | オフライン |
|---|---|---|
| Python | ブラウザ内(Pyodide / Python 3.14) | ◎ |
| JavaScript | ブラウザ内(Web Worker) | ◎ |
| C | ブラウザ内(picoc: 小さなCインタプリタ) | ○ ※エラーの文言は gcc と違う |
| Kotlin | 公式 Kotlin Playground の API に送って実行 | △ ネット必須。オフラインは記録済みの結果だけ |

- 無限ループは 8 秒で強制終了する(Worker を捨てる)。
- 例文の「記録された結果」は **本物の処理系**(Pyodide / Node.js / gcc)で実際に実行したもの。Kotlin だけは手書きの目安(下の注意を参照)。

## 使い方

```bash
cd code-cheatsheet
npm install        # Pyodide を public/pyodide にコピーする(prepare)
npm run dev        # 開発サーバー
npm run build      # dist/ に本番ビルド(型チェック込み)
npm run preview    # ビルド結果をローカルで確認
```

`dist/` を HTTPS の静的ホスティング(GitHub Pages / Netlify / Cloudflare Pages など)に置けば、スマホから開ける。
初回アクセス時に約 15MB をキャッシュして、以降はオフラインで動く(Python のエンジンが大部分)。

## 例文の追加・修正

例文は `content/NN-名前.txt` の1ファイル=1トピック。`=== セクション名` で区切る。

```
=== meta
{"id":"hello","category":"基本","title":"…","summary":"…","keywords":["…"],"notes":{"python":"…"},"why":{"python":"…"}}
=== python           ← 正しい例
=== python.bug       ← エラーになる例(why に理由を書く)
=== javascript / javascript.bug
=== c / c.bug
=== kotlin / kotlin.bug / kotlin.out / kotlin.bug.out   ← Kotlin だけ出力を手書き
```

直したら、次の2つを実行して、コミットに含める。

```bash
npm run record   # Python/JS/C の例文を本物の処理系で実行して content/recorded.json を更新
                 # (正しい例がエラー/警告を出したら失敗する)
npm run verify   # アプリ内のC(picoc)の結果が gcc と一致するか確認 → content/picoc.json
```

`record` には gcc が必要(`apt install gcc` など)。Python は npm の Pyodide、JS は Node.js で実行する。

## 構成

```
content/            例文(1トピック1ファイル)と、実行結果の記録(recorded.json / picoc.json)
src/main.ts         画面(検索・詳細・実行ボタン)
src/search.ts       検索(かな/カナ/全角半角のゆれ、類義語、言語名での絞り込み)
src/editor.ts       コードエディタ(CodeMirror 6)
src/runners/        実行(Web Worker)。Kotlin は kotlin.ts
src/shared/         アプリと記録スクリプトで共通の実行コード(同じ処理で動かすため)
scripts/            record.mjs / verify.mjs / copy-pyodide.mjs
vite.config.ts      PWA 設定と picoc-js の小さなパッチ(終了コールバックを足す)
```

## 注意(正直なところ)

- **Kotlin の「記録された結果」は、Kotlin コンパイラで検証できていない手書きの目安。** エラーの行・桁や文言は、Kotlin のバージョンでずれることがある。画面にもそう書いてある。「ネットで実行」の結果が本物。
- **Kotlin の「ネットで実行」**は第三者の API(`api.kotlinlang.org`)を使う。API の仕様変更や制限で止まることがある。そのとき画面にはエラーが出るだけで、他の機能には影響しない。
- C は picoc(簡易インタプリタ)なので、gcc でエラーになるコードが動いてしまうことや、その逆がある。エラーの例では、画面に本物の gcc の結果も並べて出す。
- `picoc-js` は 2022 年以降更新されていない小さなパッケージ(MIT)。`vite.config.ts` でビルド時に1か所だけパッチしている。

## Android アプリ(APK)

Capacitor で Web 版を包んだ Android アプリ。全部アプリの中に入るので、初回起動から圏外で動く(Kotlin の「ネットで実行」だけはネット必須)。

- GitHub Actions(`.github/workflows/code-cheatsheet-apk.yml`)が、プッシュのたびに APK をビルドして、リリース `code-dict-latest` に `code-dict.apk` を置く。
- スマホのブラウザでそのリリースから `code-dict.apk` をダウンロードして開くとインストールできる(「提供元不明のアプリ」の許可が必要)。
- デバッグ署名の APK。ビルドのたびに署名鍵が変わるので、更新するときは、先に古いアプリを削除してからインストールする。

手元でビルドするなら(Android SDK と Java 21 が必要):

```bash
npm run android:sync                  # Web版をアプリ用にビルドして android/ に取り込む
cd android && ./gradlew assembleDebug # android/app/build/outputs/apk/debug/app-debug.apk
```
