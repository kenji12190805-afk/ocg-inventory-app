// 「1行を日本語にする」の自動テスト(src/explain.ts)
import { explainLine, explainCode } from '../src/explain.ts';

const cases = [
  // [言語, 行, 期待する文(部分一致), ...]
  ['python', 'print("Hello")', '「"Hello"」 を画面に出す'],
  ['python', 'print()', '空の行'],
  ['python', 'for i in range(1, 6):', '「i」 を 1 から 5 までくりかえす'],
  ['python', 'for i in range(5):', '0 から 4 までくりかえす'],
  ['python', 'for i in range(1, n):', 'n の1つ手前'],
  ['python', 'for x in nums:', '「nums」 の中身を1つずつ 「x」 に入れて'],
  ['python', 'for i, x in enumerate(nums, start=1):', '番号つきで1つずつ取り出す(番号: i、中身: x)'],
  ['python', 'for k, v in ages.items():', 'キーと値を1組ずつ'],
  ['python', 'while n < 100:', '「n < 100」 の間、くりかえす'],
  ['python', 'if score >= 80:', 'もし 「score >= 80」 なら'],
  ['python', 'elif score >= 60:', 'そうでなくて、「score >= 60」 なら'],
  ['python', 'else:', 'どれにも当てはまらなければ'],
  ['python', 'def add(a, b):', '関数 「add」 を作る(受け取る値: a, b)'],
  ['python', 'def hello():', '受け取る値なし'],
  ['python', 'class Person:', 'クラス 「Person」'],
  ['python', 'return a + b', '「a + b」 を結果として返して'],
  ['python', 'x = len(nums)', '「nums」 の長さ'],
  ['python', 'n = int("42")', '「"42"」 を整数にしたもの'],
  ['python', 'nums = [1, 2, 3]', 'リスト 「1, 2, 3」'],
  ['python', 'nums.append(4)', '「nums」 の後ろに 「4」 を足す'],
  ['python', 'total += i', '「total」 に 「i」 を足す'],
  ['python', 'total -= 1', '「total」 から 「1」 を引く'],
  ['python', 'import math', '「math」 の部品を使えるようにする'],
  ['python', 'try:', 'エラーが起きるかもしれない'],
  ['python', 'except ValueError:', 'ValueError のエラーが起きたら'],
  ['python', 'break', 'くりかえしを、ここで終わらせる'],
  ['python', '# コメント', null],
  ['python', '', null],
  ['python', 'name = "ケンジ"', '「"ケンジ"」 を入れる'],
  ['python', 'greet("ケンジ")', '関数 「greet」 を呼ぶ'],
  ['python', 'result = sorted(nums)', '「sorted(nums)」 を入れる'],

  ['javascript', 'console.log("Hello");', '「"Hello"」 を画面に出す'],
  ['javascript', 'const name = "ケンジ";', '(あとで入れ直せない)'],
  ['javascript', 'let count = 0;', '「count」 に 「0」 を入れる'],
  ['javascript', 'for (let i = 1; i <= 5; i++) {', '「i」 を 1 から 5 までくりかえす'],
  ['javascript', 'for (let i = 0; i < 5; i++) {', '0 から 4 までくりかえす'],
  ['javascript', 'for (const x of nums) {', '「nums」 の中身を1つずつ'],
  ['javascript', 'if (x > 0) {', 'もし 「x > 0」 なら'],
  ['javascript', '} else if (x === 0) {', 'そうでなくて、「x === 0」 なら'],
  ['javascript', '} else {', 'どれにも当てはまらなければ'],
  ['javascript', 'function add(a, b) {', '関数 「add」 を作る(受け取る値: a, b)'],
  ['javascript', 'const add = (a, b) => a + b;', '関数 「add」 を作る'],
  ['javascript', 'nums.push(4);', '「nums」 の後ろに 「4」 を足す'],
  ['javascript', 'return a + b;', '「a + b」 を結果として返して'],
  ['javascript', 'i++;', '「i」 を 1 増やす'],
  ['javascript', 'switch (day) {', '「day」 の値で分ける'],
  ['javascript', 'case 1:', '「1」 のとき'],
  ['javascript', '}', null],
  ['javascript', 'const len = nums.length;', '「nums」 の長さ'],

  ['c', '#include <stdio.h>', '「stdio.h」 の部品を使えるようにする(printf'],
  ['c', 'int main(void) {', 'プログラムの入口'],
  ['c', 'printf("%d\\n", x);', '画面に出す'],
  ['c', 'int age = 30;', '整数の変数 「age」 を作る。最初の値は 「30」'],
  ['c', 'double price = 19.8;', '小数の変数'],
  ['c', 'int scores[3] = {80, 65, 90};', '整数の配列 「scores」 を作る(大きさ 3)'],
  ['c', 'char name[32] = "Kenji";', '1文字の配列'],
  ['c', 'int *p = &n;', '「ポインタ」'],
  ['c', 'for (int i = 0; i < 5; i++) {', '0 から 4 までくりかえす'],
  ['c', 'while (n < 100) {', '「n < 100」 の間、くりかえす'],
  ['c', 'return 0;', 'プログラムを正常に終わる'],
  ['c', 'int add(int a, int b) {', '関数 「add」 を作る(受け取る値: int a, int b。返す型: int)'],
  ['c', 'strcpy(s, "abc");', 'strcpy'],
  ['c', 'struct Person {', '構造体 「Person」'],
  ['c', 'x++;', '「x」 を 1 増やす'],

  ['kotlin', 'fun main() {', 'プログラムの入口'],
  ['kotlin', 'println("Hello")', '「"Hello"」 を画面に出す'],
  ['kotlin', 'val name = "ケンジ"', '(あとで入れ直せない)'],
  ['kotlin', 'var age = 30', '「age」 に 「30」 を入れる'],
  ['kotlin', 'for (i in 1..5) {', '「i」 を 1 から 5 までくりかえす'],
  ['kotlin', 'for (i in 0 until 5) {', '0 から 4 までくりかえす'],
  ['kotlin', 'for (x in nums) {', '「nums」 の中身を1つずつ'],
  ['kotlin', 'if (score >= 80) {', 'もし 「score >= 80」 なら'],
  ['kotlin', 'fun add(a: Int, b: Int): Int {', '関数 「add」 を作る(受け取る値: a: Int, b: Int。返す型: Int)'],
  ['kotlin', 'when (day) {', '「day」 の値で分ける'],
  ['kotlin', '1 -> println("月")', '「1」 のとき: 「"月"」 を画面に出す'],
  ['kotlin', 'else -> println("その他")', 'どれでもないとき'],
  ['kotlin', 'nums.add(4)', '「nums」 の後ろに 「4」 を足す'],
  ['kotlin', 'val f = { x: Int -> x * 2 }', '「f」 に'],
  ['kotlin', 'class Person(val name: String, val age: Int) {', 'クラス 「Person」'],
];

let bad = 0;
for (const [lang, line, want] of cases) {
  const got = explainLine(lang, line);
  const ok = want === null ? got === null : typeof got === 'string' && got.includes(want);
  if (!ok) {
    bad++;
    console.error(`NG ${lang}: ${JSON.stringify(line)}\n  want: ${JSON.stringify(want)}\n  got : ${JSON.stringify(got)}`);
  }
}

// 複数行
const multi = explainCode('python', 'for i in range(3):\n    print(i)\n\n# メモ');
if (multi.length !== 4 || multi[2] !== null || multi[3] !== null || !multi[0] || !multi[1]) {
  bad++;
  console.error('NG 複数行', JSON.stringify(multi));
}

console.log(`explain: ${cases.length + 1} cases`);
if (bad) {
  console.error(`${bad} 件の問題があります`);
  process.exit(1);
}
console.log('test-explain: all good');
