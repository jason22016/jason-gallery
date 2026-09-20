# Website themes

Jason Gallery supports light, dark and system preferences across its public pages,
photo viewer and admin. This is an intentional local extension of Afilmory's
dark-only DESIGN.md. The upstream reference remains unchanged.

The dark palette retains the pre-existing macOS/Afilmory text, fill, material,
background, status, accent and opacity values. The homepage retains its original
dark background and text colors; the admin retains its existing dark green palette.
The independent light palette uses a neutral `#f7f8fa` background, graphite text,
soft translucent panels and a restrained blue accent. Photo overlays keep their
existing white text, while viewer surface controls adapt to the selected theme.

`src/styles/theme-palette.css` owns public semantic colors. An inherited, registered
`--theme-light` percentage interpolates their dark and light endpoints over 800 ms,
including gradient stops and glass materials. Existing gesture, layout and opacity
animations are not overridden. The histogram redraws through the transition and
photo accents are contrast-clamped against the selected background.

The full map and metadata MiniMap also follow the selected theme. Their light
basemap uses gray-white land, muted blue water, pale green parks and graphite
labels. `gallery/map/map-style.ts` derives only the light paint colors from the
pinned `MapLibreStyle.json`; the original dark style, zoom stops, data sources,
sprites, layer visibility and attribution are preserved. `map-theme.ts` updates
paint properties in place with an 800 ms transition, preserving the map camera,
selected photo, markers and loaded tiles. It handles a theme selected before the
map style finishes loading, and removes its observers when the map unmounts.
Reduced motion disables the map transition too. MapLibre's monochrome icons
follow the same light/dark interpolation as the surrounding controls.
Accent-filled filter buttons use white foregrounds in light mode for contrast;
their original dark foreground and background remain unchanged.
See [MapLibre paint properties](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/#setpaintproperty)
and [transitions](https://maplibre.org/maplibre-style-spec/transition/).

The moon button displays 🌕 in light mode and 🌑 in dark mode. Its transitions are
🌑🌒🌓🌔🌕 and 🌕🌖🌗🌘🌑. The adjacent menu offers 🌓 system, 🌕 light and 🌑 dark.
The button lives on the page and in the admin; the photo viewer inherits the theme
without adding another theme control to its toolbar.
Static `/photos/<public-id>/` share pages also inherit the pre-paint preference and
system fallback, but omit the interactive control so their zero-hydration, no
external JavaScript release contract remains intact.
Manual choices persist under `jason-gallery:theme` in localStorage and synchronize
across same-origin tabs. System changes animate only while system mode is selected.
Storage restrictions leave switching usable for the current page. A pre-paint
bootstrap applies saved preferences before rendering. Without JavaScript, CSS
follows the system and hides the inactive public theme control.

`prefers-reduced-motion: reduce` disables both color and moon animations.
The frontend and admin share the implementation; preferences are stored separately
when those applications are hosted on different origins.

Verification: `tests/website/theme.test.ts` covers intermediate color/phase frames,
dark-palette equivalence, persistence, system changes, cross-tab synchronization,
mobile layouts, the native viewer, reduced motion and storage/JavaScript fallbacks.
`tests/website/map-theme.test.ts` also reads actual WebGL frame colors, checks
camera/selection/canvas preservation, live MiniMap updates, loading races and
mobile attribution. `map-info.test.ts` verifies complete dark-style equivalence.
