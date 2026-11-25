# Beezy interface languages

Choose **Profile and settings → Language**. Changes apply immediately and the selected language is remembered in that browser. English is the default, and Hungarian (**Magyar**) is the first additional language.

## Add a language

1. Copy [`web/src/locales/en.json`](../web/src/locales/en.json) to `web/src/locales/<language-tag>.json`. Use a BCP 47 tag such as `de` or `pt-BR`.
2. Set `name` to the language's own name, such as `Deutsch`. Translate the values in `messages`, keeping keys and `{placeholders}` unchanged.
3. Rebuild the web app. The menu discovers the file automatically; no registry or source-code change is needed. Missing entries use English.

For new interface text, add a key to `en.json` and use `useLocale().t(key, values)` in the component. Use `useLocale().language` with `Intl` for locale-aware formatting. Keep commands, paths, and stored message formats unchanged.

The first localization pass covers the profile menu, navigation labels, sign-in, composer and message status. Other screens and server-generated text remain in English until they are moved into the catalog. The language setting does not translate conversation content or change the agent's response language.
