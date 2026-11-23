// Pyodide に渡す実行ラッパー。ブラウザのWorkerとNodeの記録スクリプトで共通。
// コードを "main.py" として実行し、エラー時はラッパー自身の行を除いたトレースバックを標準エラーに出す。
export const PY_WRAPPER = `
import sys, traceback, linecache

def __run_user_code(src):
    linecache.cache["main.py"] = (len(src), None, src.splitlines(True), "main.py")
    try:
        code = compile(src, "main.py", "exec")
    except BaseException as e:
        traceback.print_exception(type(e), e, None)
        return False
    try:
        exec(code, {"__name__": "__main__"})
        return True
    except SystemExit:
        return True
    except BaseException as e:
        tb = e.__traceback__.tb_next if e.__traceback__ else None
        traceback.print_exception(type(e), e, tb)
        return False
`;

/**
 * @param {any} pyodide ロード済みの Pyodide
 * @param {string} code
 * @returns {{out: string, error: string}}
 */
export function runPython(pyodide, code) {
  let out = '';
  let err = '';
  pyodide.setStdout({ batched: (s) => (out += s + '\n') });
  pyodide.setStderr({ batched: (s) => (err += s + '\n') });
  pyodide.globals.get('__run_user_code')(code);
  return { out: out.replace(/\n$/, ''), error: err.replace(/\n$/, '') };
}
