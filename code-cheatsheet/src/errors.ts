import type { Lang } from './runners/types';

/** 出力の中のエラー文を見つけて、日本語で「意味」と「直し方」を返す(初心者向けの辞書) */
export interface Diagnosis {
  kind: 'error' | 'warning';
  /** 短い見出し */
  title: string;
  meaning: string;
  fix: string;
}
export type Verdict = 'ok' | 'warning' | 'error';
export interface Diagnosed {
  verdict: Verdict;
  items: Diagnosis[];
  /** エラーが出た行(1始まり)。エディタで光らせる */
  lines: number[];
  /** 画面とClaude用の1行まとめ */
  summary: string;
}

interface Rule {
  lang: Lang | '*';
  re: RegExp;
  kind?: 'error' | 'warning';
  title: (m: RegExpExecArray) => string;
  meaning: string;
  fix: string;
}
const rule = (lang: Rule['lang'], re: RegExp, title: Rule['title'] | string, meaning: string, fix: string, kind: Rule['kind'] = 'error'): Rule => ({
  lang,
  re,
  kind,
  title: typeof title === 'string' ? () => title : title,
  meaning,
  fix,
});

const RULES: Rule[] = [
  // ---------- どの言語でも ----------
  rule('*', /8秒たっても終わらなかった/, '終わらない(無限ループかも)', 'プログラムが8秒たっても終わらなかったので止めました。', 'while や for の「終わる条件」が、いつか成り立つか確認する。くりかえしの中で、条件に使う変数が変わっているかも見る。'),
  rule('*', /実行エンジンのエラー|準備に失敗/, '実行エンジンのエラー', 'コードのまちがいではなく、スマホの中の実行エンジンが止まりました。', 'もう一度実行してみる。直らなければ、アプリを開き直す。'),

  // ---------- Python ----------
  rule('python', /SyntaxError: unterminated string literal/, '文字列が閉じてない', '" や \' で始めた文字列が、同じ行で閉じていません。', '文字列の最後に " か \' を足す。'),
  rule('python', /SyntaxError: expected ':'/, '行末の : が足りない', 'if / for / while / def / class / else などの行の最後には : が必要です。', 'エラーの行の最後に : を足す。'),
  rule('python', /IndentationError: expected an indented block/, '字下げ(インデント)が足りない', ': で終わる行のあとは、中身を字下げ(スペース4つ)して書く必要があります。', '次の行の頭にスペースを4つ入れる。'),
  rule('python', /IndentationError: unindent does not match/, '字下げの深さがそろってない', '字下げを戻したときの深さが、上のどの行とも合っていません。', '同じブロックの行は、同じ数のスペースにそろえる。'),
  rule('python', /IndentationError: unexpected indent/, '余計な字下げ', 'ブロックの始まりでもないのに、字下げされている行があります。', 'その行の頭のスペースを消す。'),
  rule('python', /SyntaxError: '(\w+)' outside loop/, (m) => `${m[1]} がくりかえしの外にある`, 'break / continue は、for や while の中でしか使えません。', 'くりかえしの中に入れる。関数を終わらせたいなら return を使う。'),
  rule('python', /SyntaxError: '[(\[{]' was never closed/, 'かっこが閉じてない', '( [ { を開いたのに、閉じるかっこがありません。', '対応する ) ] } を足す。'),
  rule('python', /SyntaxError: invalid syntax/, '書き方がPythonのルールに合ってない', 'ここに書かれた文字の並びは、Python では意味を持ちません。他の言語の書き方(&& や ++ など)が混ざっていることが多いです。', 'エラーの行を見直す。「かつ」は and、「または」は or、「ではない」は not。'),
  rule('python', /NameError: name '(\w+)' is not defined/, (m) => `名前 ${m[1]} がない`, '使おうとした名前(変数・関数)が、まだ作られていないか、つづりが違います。', '大文字小文字も含めてつづりを確認する。使う前に、代入(=)や def で作っておく。'),
  rule('python', /TypeError: can only concatenate str/, '文字列と数値は + でつなげない', '文字列に数値を + でつなげようとしました。', 'str(数値) で文字列にするか、f文字列 f"…{数値}…" を使う。'),
  rule('python', /TypeError: .*missing (\d+) required positional argument/, '引数が足りない', '関数に渡した引数の数が、足りません。', '足りない引数を渡すか、関数側で初期値(def f(a, b=0))を決める。'),
  rule('python', /TypeError: .*takes (\d+) positional arguments? but (\d+) (?:was|were) given/, '引数が多い', '関数に渡した引数の数が、多すぎます。', '渡す数を減らす。クラスのメソッドなら、最初の引数に self を書く。'),
  rule('python', /TypeError: '(\w+)' object is not iterable/, (m) => `${m[1]} はくりかえせない`, 'for で順番に取り出せない値(数値など)を渡しました。', 'リストや range(5) のように、くりかえせるものを渡す。'),
  rule('python', /TypeError: '(.+)' not supported between instances of '(\w+)' and '(\w+)'/, (m) => `${m[2]} と ${m[3]} は比べられない`, '型のちがうもの(数値と文字列など)は、大小を比べられません。', 'int() や str() で型をそろえてから比べる。'),
  rule('python', /TypeError: unsupported operand type/, 'その組み合わせでは計算できない', '型のちがうもの(数値と文字列など)を計算しようとしました。', 'int() / float() / str() で型をそろえる。'),
  rule('python', /TypeError: '(\w+)' object is not callable/, (m) => `${m[1]} は関数じゃない`, '関数ではない値に ( ) をつけて呼び出そうとしました。', '同じ名前の変数が、関数を上書きしていないか確認する。'),
  rule('python', /ValueError: invalid literal for int\(\)/, '数字に変換できない文字', 'int() に、整数として読めない文字(abc や 4.2 など)を渡しました。', '数字だけの文字か確認する。小数なら float() を使う。'),
  rule('python', /IndexError: .*index out of range/, '番号がはみ出してる', 'リストの要素数より大きい番号を指定しました。番号は 0 から始まります。', '番号は 0〜(要素数-1)。len(リスト) で個数を確かめる。'),
  rule('python', /KeyError: (.+)/, (m) => `辞書にキー ${m[1]} がない`, '辞書にないキーで取り出そうとしました。', '辞書.get(キー, 代わりの値) を使うか、先に キー in 辞書 で確かめる。'),
  rule('python', /ZeroDivisionError/, '0で割った', '0で割り算はできません。', '割る数が0にならないか、先に if で確かめる。'),
  rule('python', /AttributeError: '(\w+)' object has no attribute '(\w+)'/, (m) => `${m[1]} に ${m[2]} はない`, 'その型の値には、そんなメソッド・属性がありません。つづりや、他の言語の書き方(push, add, size など)が混ざっているかも。', '正しい名前を調べる(リストの追加は append、長さは len(…))。None のときは、先に None でないか確認する。'),
  rule('python', /ModuleNotFoundError: No module named '(\w+)'/, (m) => `モジュール ${m[1]} がない`, 'このアプリのPythonには、標準ライブラリしか入っていません。', '標準ライブラリ(math, random, json, datetime など)だけで書く。'),
  rule('python', /RecursionError/, '再帰が深すぎる', '関数が自分を呼び続けて、深さの限界を超えました。', '「ここで終わる」という条件(基底条件)を入れる。'),
  rule('python', /EOFError/, '入力できない', 'input() で入力を待ちましたが、このアプリでは入力ができません。', '入力の代わりに、変数に値を直接入れて試す。'),

  // ---------- JavaScript ----------
  rule('javascript', /SyntaxError: missing \) after argument list/, ')が足りない', '関数呼び出しの ( に対応する ) がありません。または、引数の区切りの , が足りません。', 'エラーの行の ( と ) の数を数える。'),
  rule('javascript', /SyntaxError: Unexpected token '(.+?)'/, (m) => `「${m[1]}」が変な場所にある`, 'そこに書けない記号・文字があります。かっこの閉じ忘れや、他の言語の書き方が混ざっていることが多いです。', '直前の行から、( ) { } [ ] の閉じ忘れがないか見る。'),
  rule('javascript', /SyntaxError: Unexpected identifier/, '変な名前がある', '文の区切りや演算子がなく、名前が続けて書かれています。', '; や , 、&& や || が足りないところがないか見る。(and / or は使えない)'),
  rule('javascript', /SyntaxError: Invalid or unexpected token/, '使えない文字がある', '全角スペースや、文字列を閉じていない引用符があります。', '全角の記号や空白が混ざっていないか、" の閉じ忘れがないか確認する。'),
  rule('javascript', /SyntaxError: Unexpected end of input/, 'コードの途中で終わってる', '{ ( [ が閉じられないまま、コードが終わりました。', '{ } や ( ) の数を数えて、足りない閉じかっこを足す。'),
  rule('javascript', /SyntaxError: Identifier '(\w+)' has already been declared/, (m) => `${m[1]} を2回作ってる`, 'let / const で、同じ名前の変数を同じ場所で2回作りました。', '2回目は let を外して代入だけにするか、名前を変える。'),
  rule('javascript', /SyntaxError: Illegal (break|continue) statement/, (m) => `${m[1]} が使えない場所`, 'くりかえし(for / while)の外、または forEach の中で使われています。', 'for 文に書きかえる。forEach の中でとばすなら return。'),
  rule('javascript', /SyntaxError: Cannot use import statement/, 'import は使えない', 'このアプリは、1つのファイルだけで動かします。', 'import を使わずに書く。'),
  rule('javascript', /ReferenceError: (\w+) is not defined/, (m) => `名前 ${m[1]} がない`, '使おうとした名前(変数・関数)が、まだ作られていないか、つづりが違います。', 'つづり(大文字小文字も)を確認する。使う前に let / const / function で作っておく。'),
  rule('javascript', /TypeError: Assignment to constant variable/, 'const の変数は入れ直せない', 'const で作った変数に、あとから別の値を入れようとしました。', '変える値は let で作る。'),
  rule('javascript', /TypeError: (.+) is not a function/, (m) => `${m[1]} は関数じゃない`, 'そんな名前のメソッドはありません。他の言語の書き方が混ざっているかも。', '正しい名前を調べる(追加は push、含むは includes、前後の空白は trim)。'),
  rule('javascript', /TypeError: Cannot read propert(?:y|ies) of (undefined|null) \(reading '(.+?)'\)/, (m) => `${m[1]} の ${m[2]} は読めない`, '値がない(undefined / null)ものの中身を読もうとしました。', '先に値があるか確かめる。?. を使う(例: user?.name)。'),
  rule('javascript', /TypeError: .* is not iterable/, 'くりかえせない値', 'for...of や ... で、くりかえせない値(数値など)を渡しました。', '配列や文字列など、くりかえせるものを渡す。'),
  rule('javascript', /TypeError: Class constructor .* cannot be invoked without 'new'/, 'new をつけ忘れ', 'クラスは new をつけて呼びます。', 'new クラス名(…) と書く。'),
  rule('javascript', /RangeError: Maximum call stack size exceeded/, '再帰が深すぎる', '関数が自分を呼び続けて、深さの限界を超えました。', '「ここで終わる」という条件を入れる。'),

  // ---------- C(gcc と、スマホ内の picoc の両方) ----------
  rule('c', /expected ';' before|';' expected/, '; が足りない', '文の終わりの ; がありません。(エラーの行の1つ前の行が原因のことが多い)', 'エラーの行か、その1つ前の行の最後に ; を足す。'),
  rule('c', /'(\w+)' undeclared \(first use in this function\)|'(\w+)' is undefined/, (m) => `名前 ${m[1] ?? m[2]} がない`, '使おうとした変数・関数を、まだ宣言していないか、つづりが違います。', 'つづりを確認する。使う前に、型をつけて宣言する(int x;)。'),
  rule('c', /implicit declaration of function '(\w+)'/, (m) => `関数 ${m[1]} を知らない`, 'その関数の宣言が見つかりません。#include を書き忘れているかも。', 'printf は <stdio.h>、strlen は <string.h>、atoi は <stdlib.h> を #include する。', 'warning'),
  rule('c', /too few arguments to function|not enough arguments to/, '引数が足りない', '関数に渡した引数の数が、足りません。', '関数の定義と同じ数の引数を渡す。'),
  rule('c', /too many arguments to function/, '引数が多い', '関数に渡した引数の数が、多すぎます。', '関数の定義と同じ数の引数を渡す。'),
  rule('c', /redefinition of '(\w+)'/, (m) => `${m[1]} を2回作ってる`, '同じ名前の変数・関数を、同じ場所で2回作りました。', '2回目は型を外して代入だけにするか、名前を変える。'),
  rule('c', /request for member '(\w+)' in something not a structure or union|operator not expected here/, 'メンバーを使えないもの', 'struct ではないもの(配列や int)に . をつけました。C にはメソッドはありません。', '関数と配列の番号で書く。struct のメンバー名が合っているかも確認する。'),
  rule('c', /has no member named '(\w+)'|doesn't have a member called '(\w+)'/, (m) => `メンバー ${m[1] ?? m[2]} がない`, 'その struct に、そんな名前のメンバーはありません。', 'struct の定義と、つづりを合わせる。'),
  rule('c', /assignment to expression with array type/, '配列は = で入れ直せない', 'char の配列に、= で文字列を入れ直すことはできません。', 'strcpy(配列, "文字列") を使う(#include <string.h>)。'),
  rule('c', /invalid operands to binary|invalid operation/, 'その組み合わせでは計算できない', '型のちがうもの(% と小数など)で計算しようとしました。', '% は整数どうしだけ。型をそろえる。'),
  rule('c', /expected expression before/, '式があるはずの場所に別のものがある', 'そこには値や計算が書かれているはずです。', 'エラーの行の記号(, ; ) { })の並びを見直す。'),
  rule('c', /unknown type name '(\w+)'/, (m) => `${m[1]} という型はない`, '型として使われた名前が、未定義です。', 'つづりを確認する。struct は struct 名前 と書く。#include も確認する。'),
  rule('c', /break statement not within loop or switch/, 'break が使えない場所', 'break は、for / while / switch の中でしか使えません。', 'くりかえしや switch の中に入れる。'),
  rule('c', /fatal error: (.+): No such file or directory/, (m) => `${m[1]} が見つからない`, '#include したファイルがありません。', 'つづりを確認する(stdio.h, string.h, stdlib.h など)。'),
  rule('c', /undefined reference to/, '関数の中身が見つからない', '呼び出した関数の定義が、どこにもありません。', '関数を自分で書くか、正しい #include と名前に直す。'),
  rule('c', /format '%\w+' expects argument of type/, 'printf の % と値の型が合わない', '%d(整数) %s(文字列) %f(小数) と、渡した値の型が合っていません。実行すると落ちたり、変な値が出たりします。', '値の型に合わせて %d / %f / %s を直す。', 'warning'),
  rule('c', /suggest parentheses around assignment used as truth value/, '= と == のまちがいかも', 'if の条件に、比較(==)ではなく代入(=)が書かれています。', '比べたいなら == にする。', 'warning'),
  rule('c', /control reaches end of non-void function/, '戻り値を返してない', '値を返す関数なのに、最後に return がありません。', '最後に return 値; を足す。', 'warning'),
  rule('c', /unused variable|set but not used/, '使ってない変数がある', '作ったのに、使っていない変数があります。', '使うか、消す。', 'warning'),
  rule('c', /may fall through|fall through/, 'break がなくて次に続く', 'switch の case の最後に break がないので、次の case も実行されます。', '意図していなければ break; を足す。', 'warning'),
  rule('c', /infinite recursion/, '再帰が止まらない', '関数が自分を呼び続けるコードです。', '「ここで終わる」という条件を入れる。', 'warning'),
  rule('c', /Segmentation fault|out of memory/, 'メモリの変なところを触った', '使えないメモリ(NULL・配列の外・深すぎる再帰など)にアクセスして、OS がプログラムを止めました。', 'ポインタが NULL でないか、配列の番号が範囲内か、再帰の終わり条件があるか確認する。'),
  rule('c', /Floating point exception|divide by zero/, '0で割った', '整数を 0 で割ると、プログラムが止まります。', '割る数が 0 でないか、先に if で確かめる。'),

  // ---------- Kotlin ----------
  rule('kotlin', /unresolved reference[: ]+'?(\w+)'?/i, (m) => `名前 ${m[1]} がない`, '使おうとした名前(変数・関数・メソッド)が見つかりません。つづりや、他の言語の書き方が混ざっているかも。', 'つづり(大文字小文字も)を確認する。リストの長さは size、文字列の長さは length。'),
  rule('kotlin', /val cannot be reassigned/i, 'val は入れ直せない', 'val で作った変数に、あとから別の値を入れようとしました。', '変える値は var で作る。'),
  rule('kotlin', /type mismatch|initializer type mismatch|argument type mismatch/i, '型が合わない', '変数や引数の型と、入れようとした値の型が合っていません。', 'toInt() / toString() などで型をそろえる。null かもしれない型(Int?)は ?: で代わりの値を決める。'),
  rule('kotlin', /only safe \(\?\.\) or non-null asserted/i, 'null かもしれない値をそのまま使った', 'String? のように ? がついた型は null になりえるので、そのまま . で呼べません。', '?. で呼ぶ、?: で代わりの値を決める、または if で null でないことを確認する。'),
  rule('kotlin', /no value passed for parameter '(\w+)'/i, (m) => `引数 ${m[1]} が足りない`, '関数に渡した引数が足りません。', '足りない引数を渡すか、関数側で初期値(name: String = "x")を決める。'),
  rule('kotlin', /must be exhaustive/i, 'when のパターンが足りない', 'when を値として使うのに、すべての場合が書かれていません。', 'else -> … を足す。'),
  rule('kotlin', /must have both main and 'else' branches/i, 'else がない', 'if を値として使うのに、else がありません。', 'else { … } を足す。'),
  rule('kotlin', /only allowed inside a loop/i, 'break が使えない場所', 'break / continue は、for / while の中でしか使えません。', 'くりかえしの中に入れる。'),
  rule('kotlin', /NumberFormatException/, '数字に変換できない文字', 'toInt() に、整数として読めない文字を渡しました。', 'toIntOrNull() を使うと、失敗したとき null になって安全。'),
  rule('kotlin', /IndexOutOfBoundsException/, '番号がはみ出してる', 'リストの要素数より大きい番号を指定しました。番号は 0 から始まります。', '番号は 0〜(size - 1)。getOrNull(番号) だと安全。'),
  rule('kotlin', /NullPointerException/, 'null を使った', 'null の値を使おうとしました。', '?. や ?: を使う。'),
  rule('kotlin', /expecting|unexpected tokens/i, '書き方がKotlinのルールに合ってない', 'かっこや記号が足りないか、余計なものがあります。', '直前の行から、( ) { } の閉じ忘れがないか見る。'),
  rule('kotlin', /つながりませんでした/, 'ネットにつながらない', 'Kotlin の実行サーバーに届きませんでした。', 'ネット接続を確かめて、もう一度試す。オフラインでは Kotlin は実行できません。'),
];

/** エラーが出た行番号を、出力の文章から取り出す */
export function extractLines(lang: Lang, text: string, extra: number[] = []): number[] {
  const out = new Set<number>(extra);
  const add = (re: RegExp) => {
    for (const m of text.matchAll(re)) out.add(Number(m[1]));
  };
  if (lang === 'python') add(/File "main\.py", line (\d+)/g);
  else if (lang === 'c') add(/main\.c:(\d+):\d+: (?:error|warning)|main\.c:(\d+):\d+ /g);
  else if (lang === 'kotlin') add(/main\.kt:(\d+):\d+/g);
  // c は2つ目のグループ(picoc形式)も拾う
  if (lang === 'c') for (const m of text.matchAll(/main\.c:(\d+):\d+ /g)) out.add(Number(m[1]));
  out.delete(NaN as unknown as number);
  return [...out].filter((n) => n > 0).sort((a, b) => a - b);
}

const lastLine = (text: string) => text.split('\n').map((s) => s.trim()).filter(Boolean).pop() ?? '';

export function diagnose(lang: Lang, text: string, failed: boolean, extraLines: number[] = []): Diagnosed {
  const items: Diagnosis[] = [];
  const seen = new Set<string>();
  for (const r of RULES) {
    if (r.lang !== '*' && r.lang !== lang) continue;
    const m = r.re.exec(text);
    if (!m) continue;
    const title = r.title(m);
    if (seen.has(title)) continue;
    seen.add(title);
    items.push({ kind: r.kind ?? 'error', title, meaning: r.meaning, fix: r.fix });
  }
  // 実際に止まったエラーを先に、警告を後ろに
  items.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'error' ? -1 : 1));
  const shown = items.slice(0, 3);
  let lines = extractLines(lang, text, extraLines);
  // C の「; が足りない」は、報告された行の1つ前の行が本当の原因になる
  if (lang === 'c' && items.some((i) => i.title === '; が足りない')) lines = [...new Set([...lines, ...lines.map((n) => n - 1)])].filter((n) => n > 0).sort((a, b) => a - b);
  const hasWarning = items.some((i) => i.kind === 'warning');
  const verdict: Verdict = failed ? 'error' : hasWarning ? 'warning' : 'ok';
  if (failed && !shown.some((i) => i.kind === 'error')) {
    shown.unshift({
      kind: 'error',
      title: 'まだ辞書にないエラー',
      meaning: `最後の行がヒントです: ${lastLine(text).slice(0, 120)}`,
      fix: 'エラーの行を見直す。わからなければ、下の「Claudeに送る」でコードと結果を送ると早い。',
    });
  }
  const head = shown.find((i) => i.kind === (failed ? 'error' : 'warning'));
  const where = lines.length ? `(${lines.slice(0, 3).join(', ')}行目)` : '';
  const summary = verdict === 'ok' ? 'エラーなし' : `${head?.title ?? ''}${where}`;
  return { verdict, items: shown, lines, summary };
}
