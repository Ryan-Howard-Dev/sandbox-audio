# Federated taste profiles

Sandbox Music shares **taste profile recipes** — not audio files. Recipes encode genre weights, artist seeds, sonic preferences, and station mix rules so friends or LAN peers can import scoring context into Sonic Locker or smart playlists.

## Manifest format (`SignedTasteManifest`)

File extension: `.sandbox-taste.json`  
MIME: `application/vnd.sandbox.taste+json`

```json
{
  "kind": "sandbox-taste-recipe",
  "payload": {
    "version": 1,
    "stationName": "Late-night jazz drift",
    "createdAt": 1718236800000,
    "seeds": {
      "artistNames": ["Miles Davis", "Bill Evans"],
      "genres": ["jazz", "cool jazz"]
    },
    "weights": {
      "genreAffinity": { "jazz": 4.2 },
      "artistAffinity": { "Miles Davis": 6.1 }
    },
    "sonicPrefs": {
      "targetBpm": 92,
      "targetEnergy": 0.35,
      "targetSpectralCentroid": 0.42
    },
    "stationMix": {
      "kind": "sonic-locker",
      "seedArtist": "Miles Davis",
      "scoringHints": {
        "preferSessionMatch": true,
        "preferSonicSimilarity": true
      },
      "smartRules": { "schemaVersion": 1, "conditions": [] }
    },
    "issuer": {
      "displayName": "Alex",
      "deviceId": "device-…",
      "fingerprint": "ed25519:…",
      "keyId": "a1b2c3d4e5f6g7h8"
    }
  },
  "contentHash": "<sha256 of canonical payload>",
  "signature": "<Ed25519 base64>",
  "publicKeySpki": "<SPKI base64>",
  "signerKeyId": "a1b2c3d4e5f6g7h8"
}
```

### Signing

- Each device generates an **Ed25519** keypair stored locally (`src/tasteSigning.ts`).
- Payload bytes are **canonical JSON** (recursively sorted object keys).
- `contentHash` = SHA-256(canonical UTF-8).
- Optional **user signing key** (Settings → future field) adds a second signature binding for personal passphrases.
- Tauri desktop installs may attach `issuer.fingerprint` from `fetch_identity`.

### Verification on import

1. Recompute canonical JSON and `contentHash`.
2. Verify Ed25519 signature with embedded `publicKeySpki`.
3. UI shows **“Shared by …”** when valid (`issuer.displayName`, fingerprint prefix, or `keyId`).

Invalid signatures still allow import with an untrusted warning (merge is local-only; no remote code execution).

## Client modules

| Module | Role |
|--------|------|
| `src/tasteManifest.ts` | Build, sign, parse, apply recipes |
| `src/tasteSigning.ts` | Ed25519 key management |
| `src/tasteProfile.ts` | `mergeTasteRecipeWeights()` |
| `src/sonicLockerRadio.ts` | Applies active recipe seed for scoring |
| `src/components/TasteRecipePanel.tsx` | Export / import UI |

## Share transports (MVP)

1. **Copy JSON / download** `.sandbox-taste.json`
2. **URL hash** — `#taste=<base64url(manifest)>` for clipboard-friendly deep links (no server)
3. **LAN Sandbox Server** — `POST /api/taste/share` stores manifest; `GET /api/taste/:id` retrieves by 16-char content hash id

Air-gap friendly: (1) and (2) need no WAN. (3) is LAN-only by default (`localhost:3001` or configured tier34 URL).

## ActivityPub federation (deferred)

Full ActivityPub (Outbox/Inbox, `Like`/`Announce` activities for recipes) is **not** implemented in this MVP. Planned hook:

```
Actor: https://<host>/users/<deviceId>
Object: TasteRecipe (Link to GET /api/taste/:id or embedded signed JSON-LD)
```

Future work:

- `POST /api/activitypub/outbox` — queue `Create` activity for a taste share
- `GET /api/activitypub/users/:id/inbox` — receive remote recipes (LAN or federated)
- Map `TasteRecipe` → existing `SignedTasteManifest` for verify/apply path

Until then, use LAN share endpoints or signed URL fragments.

## Apply behavior

| Mode | Effect |
|------|--------|
| **Merge recipe** | Blend `weights` into local taste profile; set active Sonic Locker recipe |
| **New smart station** | Above + create smart playlist from `stationMix.smartRules` |

Sonic Locker reads `sandbox_active_sonic_recipe_v1` for seed artist and sonic hints.

## Out of scope

- Sharing audio blobs or locker files
- DRM / streaming catalog sync
- Funkwhale-style full federation

## Pop!_OS smoke test

```bash
cd ~/Downloads/sovereign-music-console
npm install
npm run dev:all
```

1. Open `http://localhost:3002` → Settings → Vault → **Federated taste recipes**.
2. **Export recipe** → **Copy JSON** → paste in second browser profile → **Merge recipe** → confirm “Shared by …”.
3. Sonic Locker station → **Export recipe** → **Apply** → refresh picks (seed artist bias).
4. With tier34 running: **LAN share** → copy id URL → **Fetch LAN id** on another device on same LAN.

```bash
curl -s http://localhost:3001/health | jq '.features | index("taste-share-lan")'
# expect a number (feature listed)
```
