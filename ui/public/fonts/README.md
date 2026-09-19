# Public Sans, vendored

Served from here rather than from Google Fonts, because this application binds to localhost and
may run with no network at all -- a stylesheet that reaches out to a third party on every load
would make the interface depend on something the rest of the app deliberately does not.

| | |
|---|---|
| Font | Public Sans v21, by the U.S. Web Design System |
| Files | `public-sans-latin.woff2`, `public-sans-latin-ext.woff2` |
| Kind | **Variable**, `wght` axis 100-900 -- one file per subset covers every weight |
| Licence | SIL Open Font License 1.1, full text in `OFL.txt` |
| Source | `https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700` |

The Vietnamese subset Google also serves is deliberately not vendored: this interface displays
European place names and the contract's English labels.

**To update**, fetch that CSS with a browser user agent, take the `latin` and `latin-ext` woff2
URLs, and replace both files. The `@font-face` rules and their `unicode-range` values live in
`src/styles.css`.
