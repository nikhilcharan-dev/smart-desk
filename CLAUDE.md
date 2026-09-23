# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Servera** is a cross-platform server management desktop application built with Tauri 2 + React 19, paired with a Next.js marketing website. The monorepo contains two sub-projects:

- **`servera-app/`** — Desktop app (Tauri + Vite + React)
- **`servera-web/`** — Marketing/download website (Next.js 16)

## Development Commands

### Desktop App (`servera-app/`)

```bash
cd servera-app
npm install                  # Install frontend dependencies
npm run dev                  # Start Vite dev server (port 3000)
npm run build                # Build frontend to dist/
npm run lint                 # ESLint check
npm run tauri dev            # Run full Tauri app (starts Vite + Rust backend)
npm run tauri build          # Build distributable (NSIS/DEB/AppImage)
```

Tauri dev auto-runs `npm run dev` before launching (configured in `tauri.conf.json` → `build.beforeDevCommand`).

### Rust Backend (`servera-app/src-tauri/`)

```bash
cd servera-app/src-tauri
cargo build                  # Build Rust backend only
cargo check                  # Type-check without building
cargo test                   # Run the Rust unit tests (NOT `cargo test --lib` — there is no lib target)
```

### Website (`servera-web/`)

```bash
cd servera-web
npm install
npm run dev                  # Next.js dev server
npm run build                # Production build
npm run start                # Start production server
npm run lint                 # Biome linting
npm run format               # Biome auto-format
```

## Architecture

### Desktop App — Two-Layer Architecture

**Frontend (React + Vite):**
- Entry: `servera-app/src/main.jsx` → `App.jsx`
- `App.jsx` has two states: unauthenticated (shows `ConnectionHub`/login) and connected (shows sidebar + active view)
- 17 feature views selected via sidebar navigation, defined in `constants.js` (plus Settings).
  All of them stay mounted once opened and are hidden with `display: none`, so any
  `setInterval` in a view keeps running unless it is gated — see `hooks/usePolling.js`
- Components in `servera-app/src/components/` — each is a self-contained feature panel (Dashboard, FileExplorer, SmartTerminal, ProcessManager, DockerManager, etc.)
- Global command palette triggered via Ctrl+K
- All Tauri backend calls use `invoke()` from `@tauri-apps/api/core`

**Backend (Rust + Tauri 2):**
- Entry: `servera-app/src-tauri/src/main.rs` — registers ~80 Tauri commands
- `ssh_client.rs` — SSH connection management and SFTP operations using the `ssh2` crate
- `ai_provider.rs` — Multi-provider AI integration (Ollama, OpenAI, Gemini, AWS Bedrock) with streaming support
- `ai_config.rs` — AI configuration persistence to `~/.servera/ai_config.json`
- `profile_manager.rs` — SSH profile storage to `~/.servera/profiles.json`
- `local_ops.rs` — Local file ZIP/extract operations
- `vault.rs` — Secrets Vault storage
- `known_hosts.rs` — Host-key TOFU verification, prompted through the UI before any credential is sent
- `wireguard/` — WireGuard gateway; `resolve_first_hop` rewrites the dial target for wg-mode profiles
- `ssh_config/`, `vscode_remote.rs`, `os_support/` — `~/.ssh/config` import, VS Code Remote launch, per-OS metric/package commands
- Credentials stored via OS keyring (`keyring` crate)

**Connections are per session id, not global.** `AppState` holds two maps keyed by session id:
`sessions` (interactive PTYs, `Arc<Mutex<Option<SshConnection>>>`) and `exec_conns` (a second
SSH connection per session used by every `exec_ssh_command`). Log streams and tunnels each open
their own connection on top. Things that follow from that and are easy to get wrong:
- Each PTY has a reader thread (`spawn_read_thread`) that also pings every 10s; each exec
  connection has `spawn_exec_keepalive_thread`. Both retire when their map entry is cleared.
- UI polling must never be the thing keeping a connection alive — the keepalive threads are.

**IPC Pattern:** React components call Rust functions via `invoke("command_name", { args })`. Rust functions are annotated with `#[tauri::command]` and registered in `main.rs` via `invoke_handler`.

### Website — Next.js App Router

- `servera-web/src/app/page.js` — Landing page with particle background (Three.js + GSAP)
- `servera-web/src/app/download/page.js` — Platform-aware download page
- `servera-web/src/app/feedback/page.js` — Feedback form
- API routes: `/api/downloads` and `/api/feedback` (Redis-backed via ioredis)
- `src/lib/redis.js` — Redis client singleton
- `src/lib/super_nova.js` — Three.js particle animation system

## Key Conventions

- **Frontend**: React 19 with hooks (no class components, no state management library). JSX files (not TSX).
- **Styling**: Single global CSS file (`index.css`) with CSS custom properties for theming. Dark theme with `--bg-*`, `--text-*`, `--accent-*` variables.
- **Rust async**: Uses `tokio` runtime. SSH session is stored in a global mutex (`lazy_static`-style pattern via `std::sync::Mutex`).
- **Linting**: ESLint for `servera-app`, Biome for `servera-web` — different tools, don't mix them.
- **Bundle targets**: Windows (NSIS), Linux (DEB + AppImage). macOS builds configured but no DMG target in current config.
- **App identifier**: `com.servera.smartdesk`
- **Tests**: the Rust backend has `#[cfg(test)]` unit tests — run them with `cargo test`
  from `servera-app/src-tauri` (17 as of Sept 2026, in `os_support`, `ssh_client` and
  `wireguard`). `cargo test --lib` fails: the crate is a binary, so the tests live in
  the `--bin servera` target. Neither npm project (`servera-app` frontend, `servera-web`)
  has a JS test framework configured — no vitest/jest/playwright in either `package.json`.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
