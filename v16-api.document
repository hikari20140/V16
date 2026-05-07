V16 API Document (CLI Document/Input Integration)

1) CLI to Runtime Injection
- input: `--input-json` or `--input-file` で渡された JSON オブジェクト
- document: HTML document 操作用の簡易オブジェクト
- v16doc: documentユーティリティAPI本体

2) CLI Options
- `node src/cli.js <script.js>`
- `--html <path>`: HTMLファイルを読み込み document/v16doc に注入
- `--input-json '{"key":1}'`: JSON文字列を input として注入
- `--input-file <path>`: JSONファイルを input として注入
- `--debug` / `-d`: stages/env/exports を表示

3) Script-side Globals
- `input`
  - 任意JSON値
- `document`
  - `document.getHTML()`
  - `document.setHTML(html)`
  - `document.textIncludes(text)`
  - `document.findByTag(tagName)`
- `v16doc`
  - `v16doc.bind(documentLike)`
  - `v16doc.getDocument()`
  - `v16doc.hasDocument()`
  - `v16doc.getHTML()`
  - `v16doc.setHTML(html)`
  - `v16doc.textIncludes(text)`
  - `v16doc.findByTag(tagName)`
  - `v16doc.replaceText(search, replace)`
  - `v16doc.appendHTML(fragment)`

4) Notes
- 本document APIはV16ランタイム上でHTMLを扱うための軽量実装です。
- ブラウザDOM完全互換ではなく、CLIで渡したHTML文字列操作を主用途とします。
