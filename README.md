# Mapspro

A lightweight MapLibre-based map app with place search, geolocation, routing, and shareable map views.

## Notes

- The app is now split into separate HTML, CSS, and JavaScript files.
- The map style is read from a local `config.js` file when present.
- `config.js` is ignored by git so the live MapTiler URL does not need to sit inside the tracked app source.
- Keep real secrets out of committed files. For a browser-only app, true secrecy still requires a backend or a domain-restricted key.
