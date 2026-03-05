# 👋 Slap Simulator

A browser-based 3D ragdoll slap game.  
Upload a photo → the game detects the face and pastes it on a ragdoll dummy → drag to slap → watch it fly.

**Runs 100% in the browser — no install, no server, no build step.**

---

## 🎮 How to Play

1. Open the live link (see *Deploy* below).
2. Click **📷 UPLOAD A FACE** and pick any photo (JPG / PNG / WEBP).
3. face-api.js automatically detects and crops the face onto the ragdoll's head.
4. **Click + drag** (or swipe on mobile) across the screen to slap the character.
   - Longer, faster swipes = bigger force.
5. Watch the ragdoll fly and bounce off the floor and walls.
6. Your score is the **maximum distance** the character flew (in metres).
7. Hit **🔄 RESTART** to reset the pose, or **📷 NEW FACE** to upload a different photo.

### Score tiers

| Distance | Message |
|---|---|
| 0 m | LIGHT TAP 😴 |
| 2 m | NICE SLAP! 👋 |
| 5 m | SUPER COMBO! 🔥 |
| 10 m | CRITICAL SLAP! 💥 |
| 20 m | EMOTIONAL DAMAGE! 😭💢 |

---

## 🚀 Deploy to GitHub Pages

The repository includes a GitHub Actions workflow that publishes the game automatically.

### One-time setup (new repo)

1. Push the code to a GitHub repository.
2. Go to **Settings → Pages → Source** and choose **"GitHub Actions"**.
3. Push (or re-run the workflow) — the game will be live at:

```
https://<your-username>.github.io/<repo-name>/
```

The workflow file is at `.github/workflows/deploy.yml` and runs on every push to `main` / `master`.

### Run locally

No build tools required — just serve the files over HTTP:

```bash
# Python 3
python3 -m http.server 8080
# then open http://localhost:8080
```

Or use any static-file server (VS Code Live Server, npx serve, etc.).

---

## 🛠 Tech Stack

| Library | Version | Purpose |
|---|---|---|
| [Three.js](https://threejs.org/) | r128 | 3D rendering (scene, meshes, lights, shadows) |
| [Cannon.js](https://schteppe.github.io/cannon.js/) | 0.6.2 | Rigid-body physics & ragdoll joints |
| [face-api.js](https://github.com/justadudewhohacks/face-api.js) | 0.22.2 | In-browser face detection (TinyFaceDetector) |

All libraries are loaded from CDN — no `npm install` needed.

---

## 📁 Project Structure

```
face-fighter/
├── index.html          # Page shell: start screen, loading overlay, HUD
├── style.css           # Full-screen responsive styling
├── main.js             # All game logic (fully commented)
└── .github/
    └── workflows/
        └── deploy.yml  # GitHub Pages auto-deploy workflow
```

### `main.js` sections

| # | Section | What it does |
|---|---|---|
| 1 | Constants & state | Named constants, FSM states, global refs |
| 2 | Three.js scene | Renderer, camera, lights, room geometry |
| 3 | Cannon.js world | Gravity, floor & wall planes |
| 4 | Ragdoll | 10-part humanoid; STATIC pose → DYNAMIC on slap |
| 5 | Face detection | TinyFaceDetector → crop → circular mask → texture |
| 6 | Slap input | Mouse & touch drag → physics impulse |
| 7 | Score system | Distance tracking, combo messages |
| 8 | UI helpers | Screen switching, HUD updates |
| 9 | Animation loop | `requestAnimationFrame`, physics step, mesh sync |
| 10 | Bootstrap | Event wiring, entry point |

---

## ⚠️ Security note

The CDN `<script>` tags include `crossorigin="anonymous"` as a prerequisite for Subresource Integrity (SRI).  
For a production deployment, add `integrity="sha384-…"` hashes (generate them at [srihash.org](https://www.srihash.org/)) or host the libraries locally.
