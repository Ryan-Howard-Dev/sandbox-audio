# Record player community visual packs

This folder holds the **community catalog manifest** for optional record-player visual packs.

## Official presets

Built-in looks (Classic Void, Neon Trip, Vinyl Warmth, TV Hypnosis) ship inside the app under **Settings → Vinyl → Official presets**. They are not listed here.

## Publishing a community pack

1. Create a JSON manifest with fields: `id`, `name`, `author`, `description`, `version`, optional `preview`, `visualPreset`, `cssVars`, `vinylClass`, `deviceHints`.
2. Host the JSON at a public HTTPS URL.
3. Users install via **Settings → Vinyl → Community packs → paste URL** or import from clipboard.

To list packs in the in-app catalog, open a pull request adding an entry to `manifest.json`:

```json
{
  "id": "your-pack-id",
  "name": "Your Pack Name",
  "author": "Your Name",
  "description": "Short description.",
  "version": "1.0.0",
  "downloadUrl": "https://example.com/your-pack.json"
}
```

Reserved ids (`classic-void`, `neon-trip`, `vinyl-warmth`, `tv-hypnosis`) are official Sandbox presets and cannot be used for community packs.
