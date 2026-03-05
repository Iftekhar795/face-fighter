# 👋 Slap Simulator

A browser-based 3D ragdoll slap game.  
Upload a photo → the game detects the face and pastes it on a ragdoll dummy → drag to slap → watch it fly.

**Runs 100% in the browser — no install, no server, no build step.**

---

## 🏁 Getting Started

There are three ways to get the game running, from quickest to most hands-on:

### Option 1 — Play it live (GitHub Pages)

If GitHub Pages is already enabled for this repo, just open the link below in any browser:

```
https://Iftekhar795.github.io/face-fighter/
```

> **First time?** Enable GitHub Pages in your own fork:  
> **Settings → Pages → Source → "GitHub Actions"**  
> The included workflow (`.github/workflows/deploy.yml`) will publish the game automatically on every push to `main`.

### Option 2 — Run locally with one command

No installation required. Open a terminal inside the cloned folder and run:

```bash
# Clone (skip if you already have it)
git clone https://github.com/Iftekhar795/face-fighter.git
cd face-fighter

# Serve with Python 3 (built into macOS / Linux / most Windows installs)
python3 -m http.server 8080
```

Then open **http://localhost:8080** in your browser.

> **Windows without Python?** Use [Node.js](https://nodejs.org) instead:
> ```bash
> npx serve .
> ```
> and open the URL it prints.

### Option 3 — VS Code Live Server (recommended for development)

1. Install the [Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) extension.
2. Open the `face-fighter` folder in VS Code.
3. Right-click `index.html` → **Open with Live Server**.
4. The game opens in your default browser with auto-reload on save.

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

### One-time setup

1. Push the code to a GitHub repository.
2. Go to **Settings → Pages → Source** and choose **"GitHub Actions"**.
3. Push (or re-run the workflow from the **Actions** tab) — the game will be live at:

```
https://<your-username>.github.io/<repo-name>/
```

The workflow file is at `.github/workflows/deploy.yml` and runs on every push to `main` / `master`.

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
