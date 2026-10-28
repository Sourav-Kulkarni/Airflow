# Airflow Studio

A browser-based, simplified 2D (top-down) air flow simulator for apartments. Draw rooms with walls, windows and doorways of any width, set the wind direction, place standing fans, ACs and ceiling fans, watch particles and air-speed / temperature overlays, and let the optimizer suggest the best fan placement.

No build step, no dependencies: open `index.html` in a browser, or use the hosted GitHub Pages version.

- `sim.js` – stable-fluids solver, temperature model, fan-placement optimizer
- `app.js` – editor, rendering, UI
- Shortcuts: `V` select, `W` wall, `R` room, `I` window, `D` doorway, `F` fan, `A` AC, `C` ceiling fan, `Z` comfort zone, `Del` delete, `Q`/`E` rotate, `Ctrl+Z` undo, `P` pause
