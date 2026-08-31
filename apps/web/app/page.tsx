export default function HomePage() {
  return (
    <div className="stack">
      <section className="card">
        <h1>ShiftLog</h1>
        <p>
          PC とスマホの操作を<strong>許可制</strong>で観察し、十分ごとの窓にまとめてクラウドへ送り、
          Markdown の記憶とタイムラインにする。クラウドエージェントが続きを読むための作業記憶レイヤー。
        </p>
        <p className="muted">
          OpenAI Computer History の互換実装（第一版は観察と記憶のみ。Computer Use は入れない）。
        </p>
      </section>

      <section className="card">
        <h2>第一版の約束</h2>
        <ul>
          <li>
            <span className="badge off">デフォルトオフ</span> Memories 相当がオンでないと動かない
          </li>
          <li>スクショ・画面録画・マイク・システム音声は取らない</li>
          <li>生イベントは四十八時間で破棄。残すのは人が読める Markdown 記憶だけ</li>
          <li>エージェントは承認なしで操作しない。「続きやって」はコンテキスト返却のみ</li>
        </ul>
      </section>
    </div>
  );
}
