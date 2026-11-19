# Windows IP-KVM kvm-core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship phase-1 `kvm-core`: LAN-authenticated control page with WebRTC video, CH9329 HID, optional ATX, and local `grab_frame`/input APIs (AI deferred).

**Architecture:** Single Rust binary `kvm-core` with modules for capture→encode→WebRTC, CH9329 HID, ATX, session auth, and HTTP/WS APIs. Frame source is pluggable (`test-pattern` on all platforms; Windows capture behind `cfg(windows)` stub ready for MF). GPU hard-encode is a trait with software fallback first.

**Tech Stack:** Rust 2021, tokio, axum, tower-http, serde, tokio-serial, webrtc, openh264 (soft), argon2/sha2 for passwords, include static web UI.

## Global Constraints

- Phase 1 only: no ai-agent process, no cloud VLM, no OTG/ISO
- LAN simple username/password; single session OK
- WebRTC for human video; prefer GPU encode when available, else soft encode
- USB capture + CH9329 (+ optional LCUS); protocol must match existing JS tests byte-for-byte where sampled
- Repo: add `kvm-core/` workspace; keep existing static Chrome-KVM site
- Branch: `feat/windows-ip-kvm-core`
- Commits: use `GIT_AUTHOR_NAME=simple-jdbc GIT_AUTHOR_EMAIL=simple-jdbc@gmail.com` (and committer) — do not change git config

## File map

```
kvm-core/
  Cargo.toml                 # package
  src/
    main.rs                  # CLI + server start
    config.rs                # load/save JSON config
    auth.rs                  # password verify + session token
    state.rs                 # AppState
    api/
      mod.rs
      auth_routes.rs         # login/logout
      status.rs
      frame.rs               # grab_frame
      input.rs               # HID REST
      atx.rs
      ws_input.rs            # browser mouse/keyboard WS
      webrtc_signal.rs       # SDP offer/answer
    hid/
      mod.rs                 # HidService trait + serial impl + mock
      ch9329/
        mod.rs
        frame.rs             # checksum, build packets
        keyboard.rs
        mouse.rs
        protocol.rs
    atx/
      mod.rs                 # LCUS command + press
    media/
      mod.rs
      frame.rs               # RawFrame {width,height,rgba}
      source.rs              # FrameSource trait; TestPatternSource
      encode.rs              # Encoder trait; OpenH264Encoder
      pipeline.rs            # grab latest frame; feed webrtc track
      windows_capture.rs     # cfg(windows) stub
    web/                     # static UI
      index.html
      login.html
      app.js
      style.css
  tests/
    ch9329_protocol.rs
    atx_protocol.rs
    api_integration.rs
  config.example.json
  README.md
```

---

### Task 1: Scaffold + CH9329/ATX protocol crates

**Files:**
- Create: `kvm-core/Cargo.toml`, `kvm-core/src/lib.rs`, `kvm-core/src/hid/ch9329/*.rs`, `kvm-core/src/atx/mod.rs`, `kvm-core/tests/ch9329_protocol.rs`, `kvm-core/tests/atx_protocol.rs`

**Produces:**
- `ch9329::build_frame(addr, cmd, data) -> Vec<u8>`
- `ch9329::keyboard_press_packet(modifiers, keycodes: &[u8;6])`
- `ch9329::keyboard_release_packet()`
- `ch9329::absolute_mouse_packet(buttons, x, y, wheel)`
- `ch9329::relative_mouse_packet(buttons, dx, dy, wheel)`
- `ch9329::map_to_absolute(view_w, view_h, content_w, content_h, x, y) -> (u16, u16)` mapping to 0..4095
- `atx::command(channel, on) -> [u8;4]`

- [x] **Step 1:** Create `kvm-core` package with lib+bin skeleton
- [x] **Step 2:** Port frame checksum and packet builders; add tests matching `test/ch9329.test.js` hex samples (GET_INFO, key A, Shift+A, abs/rel mouse)
- [x] **Step 3:** Port ATX `A0 channel state sum` + duration constants; unit test
- [x] **Step 4:** `cargo test -p kvm-core --test ch9329_protocol --test atx_protocol`
- [x] **Step 5:** Commit

---

### Task 2: Config, auth, app state, grab_frame + status API

**Files:**
- Create: `config.rs`, `auth.rs`, `state.rs`, `api/*`, `media/frame.rs`, `media/source.rs`, `config.example.json`

**Produces:**
- Config: `listen`, `username`, `password_hash` (or plaintext bootstrap hashed on first run), `video_source` (`test-pattern` | device id), `serial_port`, `baud`, `mouse_absolute`, `atx` optional
- `POST /api/login` → `{token}`; `Authorization: Bearer` or cookie
- `GET /api/status` → video/serial/encoder fields
- `GET /api/frame.jpg` → latest frame JPEG (auth required)

- [ ] **Step 1:** Implement config load + argon2 password verify
- [ ] **Step 2:** TestPatternSource generating moving RGBA frames; JPEG encode via `image` crate for grab_frame
- [ ] **Step 3:** Axum routes + integration test with oneshot
- [ ] **Step 4:** Commit

---

### Task 3: HID service + input/WS/ATX routes

**Files:**
- Create: `hid/mod.rs`, serial + mock backends, `api/input.rs`, `api/ws_input.rs`, `api/atx.rs`

**Produces:**
- `HidService`: keydown/keyup/release_all/type_text/mouse_move_abs/mouse_move_rel/click
- Mock records packets for tests; serial uses `tokio-serial` when `serial_port` set
- `WS /api/ws/input` JSON messages: `{type, ...}` for browser events
- `POST /api/atx/press` `{kind: short|long|reset}`

- [ ] **Step 1:** Mock HID + REST input tests
- [ ] **Step 2:** Serial backend (open port, write frames; ACK wait optional simplified with timeout)
- [ ] **Step 3:** WS input bridge
- [ ] **Step 4:** Commit

---

### Task 4: WebRTC pipeline + control UI

**Files:**
- Create: `media/encode.rs`, `media/pipeline.rs`, `api/webrtc_signal.rs`, `web/*`

**Produces:**
- Soft H264 (openh264) or VP8 path feeding `webrtc` RTCPeerConnection video track
- `POST /api/webrtc/offer` with SDP → answer SDP
- `login.html` + `index.html` control page: login, video via RTCPeerConnection, mouse/keyboard to WS, status bar, ATX buttons, AI panel hidden
- Absolute mouse: map element coords → API

- [ ] **Step 1:** Media pipeline: source → encode → webrtc track loop
- [ ] **Step 2:** Signaling routes
- [ ] **Step 3:** Static UI wired to APIs
- [ ] **Step 4:** Manual smoke: `cargo run` + browser localhost (test pattern)
- [ ] **Step 5:** Commit

---

### Task 5: Windows stubs, README, polish

**Files:**
- Create: `media/windows_capture.rs`, `kvm-core/README.md`
- Modify: root README pointer (short section) optional

**Produces:**
- `WindowsCaptureSource` stub returning clear error / placeholder until MF wired
- `EncoderPreference::PreferGpu` logs fallback to soft when GPU unavailable
- README: build, config, LAN firewall, hardware wiring, test-pattern mode

- [ ] **Step 1:** Stubs + encoder preference logging
- [ ] **Step 2:** README + example config
- [ ] **Step 3:** Full `cargo test` + `cargo build --release`
- [ ] **Step 4:** Commit

---

## Spec coverage check

| Spec item | Task |
|-----------|------|
| WebRTC + GPU prefer / soft fallback | 4, 5 |
| CH9329 + ATX | 1, 3 |
| LAN login | 2 |
| Control page UX | 4 |
| grab_frame + input API | 2, 3 |
| AI deferred / panel hidden | 4 |
| Repo `kvm-core/` coexist | 1 |
| Errors/degrade status | 2, 4 |

## Execution

User requested continuous implementation without confirmations → subagent-driven / inline execution without pausing for approach choice.
