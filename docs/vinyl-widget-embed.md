# Vinyl Now-Playing Widget (OBS / Dashboard)

Embeddable **VinylHero** second-screen for OBS Browser Source, home dashboards, or a dedicated pop-out window.

## URLs

| URL | Use |
|-----|-----|
| `/?widget=vinyl` | Default embed (dark, minimal chrome) |
| `/?widget=vinyl&size=tv&theme=transparent` | Large transparent overlay |
| `/?embed=vinyl&chrome=0` | Alias embed route |
| `/now-playing-widget` | Same widget (path alias) |

### Query parameters

| Param | Values | Default |
|-------|--------|---------|
| `size` | `compact`, `home`, `tv`, `full` | `home` |
| `theme` | `dark`, `light`, `transparent` | `dark` |
| `chrome` | `0` / `false` = hide shell chrome | chromeless |

Example for OBS Browser Source (1920×1080):

```
http://localhost:5173/?widget=vinyl&size=tv&theme=transparent&chrome=0
```

Replace host/port with your Sandbox dev server or built static host.

## How sync works

The main app publishes playback state over `BroadcastChannel` (`sandbox-vinyl-widget`). The widget page subscribes and updates title, artist, artwork, play state, and progress.

**Requirements:**

- Widget and main app must be **same origin** (same host + port).
- Keep the main Sandbox tab/window open (or run the desktop/Tauri app) while the widget is visible.

## OBS setup

1. Add **Browser Source**.
2. Paste the widget URL (see above).
3. Set width/height (e.g. 600×600 for vinyl-only, 1280×720 for full layout).
4. Enable **Refresh browser when scene becomes active** if needed.
5. Start playback in Sandbox — vinyl should spin and metadata update within ~1s.

## Pop-out window

From a browser console on the main app (same machine):

```js
window.open('/?widget=vinyl&size=home&chrome=0', 'sandbox-vinyl', 'width=480,height=640');
```

## Custom iframe (static host)

```html
<iframe
  src="https://your-sandbox-host/?widget=vinyl&size=compact&theme=dark&chrome=0"
  width="320"
  height="400"
  style="border:0;background:transparent"
  allow="autoplay"
></iframe>
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Widget shows “Nothing playing” | Open main Sandbox on same origin and play a track |
| No artwork | Artwork uses same proxy rules as main app; LAN-only mode may block remote art |
| Vinyl not spinning | `playing` is false until main player state is Playing |

## Related

- Record player addons / vinyl visual settings: **Settings → Display → Vinyl**
- Cinema cast (full-screen mirror): `?cast=1`
