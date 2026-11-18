# IronPulse — Progressive Web App Workout Tracker

A mobile-first Progressive Web App (PWA) **Workout Tracker** built with **React (Vite) + TypeScript + Tailwind CSS**, **Zustand**, **Recharts**, and **Firebase (Google Auth & Cloud Firestore with Offline IndexedDB Persistence)**.

Designed to replace a multi-tab Google Sheet workflow with a clean **Google Material 3** gym-floor interface, dual UUID + human-readable slug architecture, dynamic set boxes with per-set weight overrides, ghost text history, programmable circuit/rest timers, multi-week program automation, legacy Google Sheet CSV reconciliation, and 1-click AI JSON code block import.

---

## Key Features

1. **Dual-ID Firestore Architecture (`wt_*` Namespaced Collections)**:
   - `wt_exercises`: Global canonical exercise dictionary (`exerciseUuid` + `slug`) for unified cross-workout analytics and ghost history.
   - `wt_presets`: Immutable `presetUuid` primary keys + human-readable `slug` (`wkt_abc_double`, `wkt_cip_ruck`) + many-to-many `programIds`.
   - `wt_programs`: Multi-week rotating schedule templates supporting flexible `1..N` multi-workout days (`Primary`, `Secondary`, `Core`, `Mobility`, `Finisher`) and progressive `weekProgressionNotes`.
   - `wt_schedule`: Date-keyed (`YYYY-MM-DD`) daily schedule items with coach notes and status tracking.
   - `wt_logs`: Session-chained workout logs sharing `sessionGroupUuid` while saving each workout under its own `logUuid` and sequential `ID-XXXX` (`displayId`).
     - Supports **Per-Set Weight Overrides (`weightOverride?: number`)** for pyramiding or drop sets with exact per-set tonnage calculation.
     - Supports **Distance Units (`distanceUnit: "mi" | "km"`, defaulting to `"mi"`)** and auto-calculated `paceSecPerUnit` (`MM:SS /mi` or `MM:SS /km`).

2. **On the Gym Floor (`Log` View)**:
   - Date steppers (`<` Today `>`) + date picker.
   - **Load Programmed**, **Swap / Override / Ad-Hoc** searchable preset drawer, and **Chain Another Workout**.
   - **Dynamic Set Boxes** (`[ 15 ] [ 15 ] [ 15 ] [ + ] [ - ]`) with muted **Ghost Text** pre-fill from the most recent completed session, 1-tap `Fill Ghost` confirmation, inline `@kg` per-set weight override popovers, and compact `RIR` input.
   - **Exercise History Popup** showing the last 10 completed performances.
   - **Sticky Live Timer Bar** with 1-tap Rest countdowns, auto-rest on set completion, and a **Programmable Circuit / EMOM Timer** (`Rounds × Work × Rest`, supporting `0s` rest EMOMs, Web Audio beeps, vibration, and Screen Wake Lock).

3. **Schedule & Programming (`Plan` View)**:
   - **Upcoming Agenda**: View, reorder, edit progression notes, or launch workouts directly.
   - **Programming Auto-Fill Engine**: Build rotating multi-week templates and auto-fill the calendar between a Start Date and End Date (`Update Matching Slots`, `Replace All`, or `Skip Existing`).

4. **History & Progress (`History` View)**:
   - Toggle between **Full Workouts / Chained Sessions** and **Individual Exercise Analytics**.
   - KPI summary cards and **Recharts** visualizations for Tonnage, Est. 1RM, Top Set Weight, and Cardio Distance/Pace/HR.

5. **Settings, Legacy Google Sheet Importer & AI JSON Drawer (`Settings` View)**:
   - Full CRUD Preset Library Manager.
   - **Legacy Google Sheet CSV Importer** with **Interactive ID Reconciliation** to align and merge historical workout and exercise names into canonical UUIDs.
   - **AI Code Block Import / Export Drawer** with visual diff preview and a 1-tap **"Copy AI Schema & Current IDs"** button for Gemini Skills.

---

## Local Development & Deployment

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build production bundle
npm run build
```

### Firebase Configuration
1. Copy `.env.example` to `.env.local` and fill in your `VITE_FIREBASE_*` keys, **or** paste your Firebase Web Config JSON directly inside the app under **Settings → Firebase Sync & Prefs**.
2. Deploy Firestore indexes and security rules:
   ```bash
   firebase deploy --only firestore:indexes,firestore:rules
   ```
3. Push to `main` to trigger `.github/workflows/deploy.yml` for automated **GitHub Pages** deployment.
