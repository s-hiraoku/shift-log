# ウィンドウタイトルに作業内容を出す

ShiftLog のデスクトップコレクタは、前面ウィンドウのタイトルをそのまま `front_window_summary.summary` に入れます。十分記憶の Focus span は、その `summary` を使います。コレクタはカレントディレクトリや実行コマンドを推測しません。

Ghostty のタイトルがユーザ名だけのとき、shift-log のセットアップをしていても記憶には「ghostty にいた」以外が残りません。ターミナルまたはエディタで長く作業するときは、このページの設定を入れてください。

## 設定前後の記憶を比べる

次の Focus span は、十分記憶本文の実形式です。アプリ名のあとの文字列が `front_window_summary.summary` です。

設定前（Ghostty のタイトルがユーザ名だけのとき）:

```markdown
## Focus span

- 06:39-06:40 ghostty — hiraoku.shinichi
- 06:41-06:42 ghostty — hiraoku.shinichi
```

この 10 分で実際にやっていたのは `~/src/shift-log` でのセットアップです。記憶にはユーザ名しかありません。

Ghostty の `title` 機能を有効にしたあと（プロンプト待ちは cwd、実行中はコマンド）:

```markdown
## Focus span

- 06:39-06:40 ghostty — ~/src/shift-log
- 06:41-06:42 ghostty — pnpm install
```

zsh または bash のフックを入れたあと（アイドル時は `cwd (git branch)`、実行中はコマンド）:

```markdown
## Focus span

- 06:39-06:40 ghostty — ~/src/shift-log (main) — pnpm install
- 06:41-06:42 ghostty — ~/src/shift-log (main)
```

検索とエージェントの「続きやって」は、この `summary` を読みます。cwd とコマンドが入ると、同じ十分窓でも作業内容が残ります。

## Ghostty のシェル統合を有効にする

1. `~/.config/ghostty/config` を開きます。
2. 固定タイトルを消します。`title = ...` があると、シェルが送るタイトル変更を Ghostty が無視します。
3. 次を書きます。

```ini
shell-integration = detect
shell-integration-features = title
```

4. Ghostty を再起動します。
5. タイトルバーを見ます。プロンプト待ちならカレントディレクトリ、コマンド実行中ならそのコマンドが出ます。

macOS 付属の `/bin/bash` は自動注入しません。そのシェルを使うときは、`~/.bashrc` の先頭に次を置きます。

```bash
if [ -n "${GHOSTTY_RESOURCES_DIR}" ]; then
	builtin source "${GHOSTTY_RESOURCES_DIR}/shell-integration/bash/ghostty.bash"
fi
```

Ghostty の `title` 機能は、プロンプト時に短縮した cwd、実行中にコマンドを出します。git ブランチまで出したいときは、次節の zsh または bash フックを使い、Ghostty 側は上書きしないようにします。

```ini
shell-integration = detect
shell-integration-features = no-title
```

## zsh でタイトルを設定する

`~/.zshrc` に次を追加します。Oh My Zsh を使っているときは、先に `DISABLE_AUTO_TITLE=true` を置きます。

```zsh
DISABLE_AUTO_TITLE=true

shiftlog_git_branch() {
	git rev-parse --is-inside-work-tree >/dev/null 2>&1 || return
	git branch --show-current 2>/dev/null
}

shiftlog_title() {
	local cwd="${PWD/#$HOME/~}"
	local branch=""
	local name
	name="$(shiftlog_git_branch)"
	[[ -n "$name" ]] && branch=" ($name)"
	printf '\e]0;%s%s\a' "$cwd" "$branch"
}

shiftlog_preexec() {
	local cwd="${PWD/#$HOME/~}"
	printf '\e]0;%s — %s\a' "$cwd" "$1"
}

autoload -Uz add-zsh-hook
add-zsh-hook precmd shiftlog_title
add-zsh-hook preexec shiftlog_preexec
```

新しいシェルを開きます。プロンプト待ちのタイトルは `~/src/shift-log (main)` です。`pnpm install` を実行中のタイトルは `~/src/shift-log (main) — pnpm install` です。git 外のディレクトリではブランチ括弧は付きません。

## bash でタイトルを設定する

`~/.bashrc` に次を追加します。

```bash
shiftlog_git_branch() {
	git rev-parse --is-inside-work-tree >/dev/null 2>&1 || return
	git branch --show-current 2>/dev/null
}

shiftlog_title() {
	local cwd="${PWD/#$HOME/~}"
	local branch=""
	local name
	name="$(shiftlog_git_branch)"
	[ -n "$name" ] && branch=" ($name)"
	printf '\e]0;%s%s\a' "$cwd" "$branch"
}

shiftlog_preexec() {
	[ "$BASH_COMMAND" = "$PROMPT_COMMAND" ] && return
	local cwd="${PWD/#$HOME/~}"
	printf '\e]0;%s — %s\a' "$cwd" "$BASH_COMMAND"
}

PROMPT_COMMAND="shiftlog_title${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
trap 'shiftlog_preexec' DEBUG
```

新しいシェルを開いて、zsh と同じタイトルになることを確認します。

## iTerm2 でタイトルを出す

1. **Settings → Profiles → General → Title** を開きます。
2. **Job** と **PWD** をオンにします。
3. **Applications in terminal may change the title** をオンにします。オフだと、zsh または bash の `printf '\e]0;...\a'` がウィンドウタイトルに届きません。
4. 新しいセッションを開いて、タイトルバーに cwd とジョブが出ることを確認します。

## Terminal.app でタイトルを出す

1. **Settings → Profiles → Window → Title** を開きます。
2. **Working Directory** と **Active Process Name** をオンにします。
3. 上の zsh または bash フックを入れているときは、タイトルバーが OSC 0 の文字列に変わることを確認します。

## WezTerm でタイトルを出す

WezTerm は OSC 0 と OSC 2 を既定で受け取ります。上の zsh または bash フックを入れれば、追加設定なしでタイトルが変わります。

`format-window-title` を自前で書いているときは、`tab.active_pane.title` を残します。残さないとシェルのタイトルが消えます。

```lua
local wezterm = require("wezterm")

wezterm.on("format-window-title", function(tab, pane, tabs, panes, config)
	return tab.active_pane.title
end)
```

## VS Code と Cursor でタイトルを出す

1. コマンドパレットで **Preferences: Open User Settings (JSON)** を実行します。Cursor も同じコマンドです。
2. 次を書きます。

```json
{
	"window.title": "${rootName} — ${activeEditorShort}"
}
```

3. タイトルバーを見ます。ワークスペース名と、開いているファイルの短い名前が出ます。例は `shift-log — collector.ts` です。

## 次の十分記憶で確認する

1. コレクタを動かします。`pnpm --filter @shift-log/desktop collect`
2. 設定したアプリを前面にします。
3. コレクタのログに `observed app=... title=...` が出ます。`title=` に cwd とコマンド、またはワークスペースとファイル名が入っていることを確認します。
4. 次の十分窓が上がったあと、その記憶の Focus span を開きます。`summary` はログの `title=` と同じ文字列です。
