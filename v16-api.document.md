V16 API Document (CLI Document/Input Integration)

1) CLI to Runtime Injection
- input: `--input-json` or `--input-file` で渡された JSON オブジェクト
- document: HTML document 操作用の簡易オブジェクト
- v16doc: documentユーティリティAPI本体
- air: AirDOM(JSON) 操作用の簡易オブジェクト
- v16air: airユーティリティAPI本体

2) CLI Options
- `node src/cli.js <script.js>`
- `--html <path>`: HTMLファイルを読み込み document/v16doc に注入
- `--input-json '{"key":1}'`: JSON文字列を input として注入
- `--input-file <path>`: JSONファイルを input として注入
- `--air-json <path>`: airdom.json 形式を読み込み air/v16air に注入
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
- `air`
  - `air.hasAir()`
  - `air.getVersion()`
  - `air.getRootIndex()`
  - `air.getNode(index)`
  - `air.getByTag(tagName)`
  - `air.getById(id)`
  - `air.childrenOf(index)`
  - `air.parentOf(index)`
  - `air.setId(index, id)`
  - `air.addClass(index, className)`
  - `air.removeClass(index, className)`
  - `air.hasClass(index, className)`
  - `air.renameTag(index, tag)`
  - `air.toJSON()`
  - `air.serialize()`
- `v16air`
  - `v16air.bind(airDomLike)`
  - `v16air.hasAir()`
  - `v16air.getVersion()`
  - `v16air.getRootIndex()`
  - `v16air.getNode(index)`
  - `v16air.getByTag(tagName)`
  - `v16air.getById(id)`
  - `v16air.childrenOf(index)`
  - `v16air.parentOf(index)`
  - `v16air.setId(index, id)`
  - `v16air.addClass(index, className)`
  - `v16air.removeClass(index, className)`
  - `v16air.hasClass(index, className)`
  - `v16air.renameTag(index, tag)`
  - `v16air.toJSON()`
  - `v16air.serialize()`

4) Notes
- 本document APIはV16ランタイム上でHTMLを扱うための軽量実装です。
- ブラウザDOM完全互換ではなく、CLIで渡したHTML文字列操作を主用途とします。
- 本air APIは `airdom.json` 形式を対象にしたサブセット実装です。
