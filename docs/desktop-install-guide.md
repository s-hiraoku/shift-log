# ShiftLog デスクトップアプリ インストールガイド

ShiftLog デスクトップアプリの導入・使い方・自動更新・アンインストールをまとめた簡易マニュアルです。対象は **macOS** と **Linux**。インストール後は**次回起動時に自動更新**されるため、以後の更新作業は不要です。

> 現在は**未署名の第一版（PoC）**です。OS のコード署名・公証を行っていないため、初回起動時に警告が出ます（[初回起動](#初回起動未署名のための警告回避)参照）。

---

## 1. 対応環境

| OS | 形式 | 備考 |
| --- | --- | --- |
| macOS (Apple Silicon / M1 以降) | `.dmg`（`aarch64`）| |
| macOS (Intel) | `.dmg`（`x86_64`）| |
| Linux | `.AppImage` / `.deb` | Ubuntu 22.04 以降で確認 |

---

## 2. ダウンロード

1. リポジトリの **Releases** ページを開く: `https://github.com/s-hiraoku/shift-log/releases`
2. 最新の `ShiftLog Desktop vX.Y.Z` を選ぶ
3. 自分の OS に合ったファイルを **Assets** からダウンロード
   - macOS (Apple Silicon): `ShiftLog_X.Y.Z_aarch64.dmg`
   - macOS (Intel): `ShiftLog_X.Y.Z_x64.dmg`
   - Linux: `ShiftLog_X.Y.Z_amd64.AppImage` または `ShiftLog_X.Y.Z_amd64.deb`

---

## 3. インストール

### macOS

1. ダウンロードした `.dmg` をダブルクリック
2. 表示された **ShiftLog** アイコンを **Applications（アプリケーション）** フォルダにドラッグ
3. `.dmg` を取り出す（アンマウント）

### Linux（AppImage）

```bash
chmod +x ShiftLog_*_amd64.AppImage
./ShiftLog_*_amd64.AppImage
```

> AppImage の実行には FUSE が必要です。未導入なら `sudo apt-get install -y libfuse2`。

### Linux（.deb / Ubuntu・Debian）

```bash
sudo apt-get install -y ./ShiftLog_*_amd64.deb
# 起動
shiftlog
```

---

## 4. 初回起動（未署名のための警告回避）

現在は未署名のため、初回のみ OS が警告します。次の手順で許可してください（2 回目以降は不要）。

### macOS

- アプリを **右クリック（Control＋クリック）→「開く」** を選び、ダイアログで再度 **「開く」**。
- それでも開けない場合はターミナルで隔離属性を外す:

  ```bash
  xattr -dr com.apple.quarantine /Applications/ShiftLog.app
  ```

### Linux

- 追加操作は基本不要です。AppImage が起動しない場合は上記 FUSE を確認してください。

---

## 5. 使い方（基本）

ShiftLog は **デフォルトオフ**。明示的に有効化しない限り何も収集しません。スクショ・画面録画・マイク・全文キーログは**恒久的に無効**です。

1. **有効化**: `設定` タブで「ShiftLog を有効化」と「Memories 組立を有効化」をオンにして `保存`
2. **一時停止**: `設定` の一時停止、またはメニューバー/コントロールセンター相当から
3. **許可リスト**: `許可リスト` タブでアプリ／サイト単位の除外・許可を設定（プライベートブラウズは永久除外）
4. **タイムライン**: `タイムライン` タブで十分ごとの記憶（Markdown）を閲覧、カードを開くと詳細
5. **履歴削除**: `設定` の履歴削除から「直近十分／一時間／一日／全部」を削除（イベントも記憶も消去）

> 生イベントは 48 時間で自動破棄され、残るのは人が読める Markdown 記憶だけです。

---

## 6. 自動更新の仕組み

- アプリは**起動のたびに更新を確認**し、新しいバージョンがあれば自動でダウンロード → **署名を検証** → インストール → 再起動します。
- 署名が一致しない配布物は拒否されるため、なりすまし更新は適用されません。
- ユーザ側の操作は不要です。手動での再インストールは、最初のインストール時のみ必要です。

---

## 7. アンインストール

### macOS

- `Applications` から **ShiftLog.app** をゴミ箱へ移動。
- 設定を完全に消す場合: `~/Library/Application Support/com.shiftlog.desktop` を削除。

### Linux

- AppImage: ダウンロードした `.AppImage` ファイルを削除。
- .deb: `sudo apt-get remove shiftlog`
- 設定を完全に消す場合: `~/.config/com.shiftlog.desktop` および `~/.local/share/com.shiftlog.desktop` を削除。

---

## 8. トラブルシューティング

| 症状 | 対処 |
| --- | --- |
| macOS で「開発元を検証できないため開けません」 | 右クリック →「開く」、または `xattr -dr com.apple.quarantine /Applications/ShiftLog.app` |
| Linux で AppImage が起動しない | `sudo apt-get install -y libfuse2` を実行 |
| 画面が真っ白（一部の仮想環境/GPU）| 環境変数 `WEBKIT_DISABLE_DMABUF_RENDERER=1` を付けて起動 |
| タイムラインが空 | `設定` で有効化し、収集が動いているか確認。生イベントは 48 時間で破棄されます |
| 自動更新が来ない | Releases に新しいバージョンと `latest.json` が公開されているか確認。ネットワーク/プロキシ設定も確認 |

---

## 9. 開発者・配布担当者向け

ビルド・署名鍵・リリース（`git tag desktop-v*` による自動配布）の手順は、リポジトリ README の「[デスクトップアプリ（Tauri v2 / macOS・Linux）](../README.md#デスクトップアプリtauri-v2--macoslinux)」を参照してください。
