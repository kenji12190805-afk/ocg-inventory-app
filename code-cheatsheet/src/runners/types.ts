export type Lang = 'python' | 'javascript' | 'c' | 'kotlin';

export interface RunResult {
  /** 画面に出す文字(標準出力 + エラー) */
  text: string;
  /** エラーで終わったか */
  failed: boolean;
  /** 実行にかかった時間(ミリ秒) */
  ms: number;
}
