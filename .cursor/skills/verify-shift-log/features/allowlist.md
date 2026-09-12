# App and site allowlist

The allowlist page sets per-app and per-site exclude/include lists. Private browsing is permanently excluded and is not a control on this page.

## Sub-features

- `allowlist-app-mode` switches apps between `Exclude listed（除外以外を許可）` and `Include only（明示したアプリのみ）`.
- `allowlist-app-exclude` persists one app name per line in `除外アプリ（1行1件）`.
- `allowlist-site-mode` switches sites between `Exclude listed` and `Include only`.
- `allowlist-site-exclude` persists hostnames in `除外サイト`.
- `allowlist-save` shows `許可リストを保存しました` and reloads the same values.

## How to get to it (user POV)

- Choose nav `許可リスト` (`/permissions`).
- Change a mode select or a textarea, then `保存`.

## Driving it with the ShiftLog helpers

Preconditions:

- Doctor reports healthy isolated origins.
- Page has left the `読み込み中…` state (heading `許可リスト` visible).

- **Open page.** Run `node helpers/browser.mjs goto /permissions`. Wait for `許可リスト`. Default modes are `Exclude listed（除外以外を許可）` for apps and `Exclude listed` for sites. Textareas start empty on a fresh instance.
- **Exclude an app.** The helper has no dedicated select/textarea command. Use `eval --js` to set the labeled controls, then click save:

```text
node helpers/browser.mjs eval --js '
(() => {
  const labels = [...document.querySelectorAll("label")];
  const find = (t) => labels.find((l) => (l.innerText || "").includes(t));
  const set = (label, value) => {
    const field = label.querySelector("textarea, select");
    const proto = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value");
    proto.set.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  };
  set(find("除外アプリ（1行1件）"), "Slack");
  set(find("除外サイト"), "mail.example.test");
  return "filled";
})()
'
node helpers/browser.mjs click --text "保存"
node helpers/browser.mjs wait --text "許可リストを保存しました"
```

- **Confirm persistence.** Run `curl -sS -H "Authorization: Bearer $SHIFTLOG_API_TOKEN" "$SHIFTLOG_API_ORIGIN/v1/permissions"`. `apps.exclude` is `["Slack"]`, `sites.exclude` is `["mail.example.test"]`, both modes remain `exclude_listed`.
- **Reload.** Run `goto /permissions` again. The app-exclude textarea shows `Slack` and the site-exclude textarea shows `mail.example.test`.
- **Include-only mode.** Change `アプリモード` to `Include only（明示したアプリのみ）` via the same `eval` on the `アプリモード` `<select>` (`value` `include_only`), put `Code` in `許可のみアプリ（include_only 時）`, save, and confirm `apps.mode === "include_only"` and `apps.include_only === ["Code"]`.
- **Proof.** Screenshot of the saved form, the permissions JSON, and a reload snapshot that still shows `Slack`. Feature id `allowlist`.

## Gotchas

- Labels are the only stable names. The textareas and selects have no `name` or `aria-label`.
- `splitLines` trims and drops blank lines. A trailing newline does not create an empty entry.
- Saving the allowlist PUTs the full permissions object. It must not clear `enabled` / `memories_enabled` if those were already on.
- There is no client-side validation that an include-only list is non-empty. An empty include-only list is a legal saved state; collectors would match nothing. Assert the JSON you wrote.
- Private browsing is not listed here. Do not invent a checkbox for it.
