# real-estate-simulator
不動産利回りシュミレータ

`index.html` をブラウザで開くだけで動きます。

## 3点セットが公開されたら

画面いちばん上の「売却基準価額から入札上限を出す」に、評価書の売却基準価額（万円）を入れます。
保証金（×20%）、買受可能価額（×80%）、単独担保／共同担保それぞれの入札上限、上限で落札したときの月次CFが出ます。
初期値を書き換える場合は、`index.html` 冒頭の `DEFAULT_CONFIG.auction.kijun` を変更します。

## 計算ロジックの検算

- ブラウザ：`index.html?selftest` を開くと、結果が画面の先頭に表示されます
- Node.js：`node tests/calc.test.js`
