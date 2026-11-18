# TV mode and the phone companion controller

ORBITAL MIND can present itself on a television and be controlled from a phone.
The TV **renders the live Three.js scene itself**, at its own resolution and aspect ratio.
Nothing is screen-mirrored or video-streamed: the phone only sends small control
messages and, if you allow it, a display-only copy of your ideas.

## How to use it (Arabic UI labels in quotes)

1. **On the TV** (Mi TV Stick / Android TV browser, or any large screen): open
   `https://atalqahs.github.io/mined-plan/?tv=present` (bookmark it), or in the app press
   "وضع التلفاز" → "عرض على التلفاز". Fullscreen is requested automatically where the browser allows it.
2. A **"ربط الهاتف"** card shows a QR code and a 10-character **"رمز الاقتران"** (pairing code),
   valid for 5 minutes and replaced automatically.
3. **On the iPhone**, either
   - scan the QR code with the Camera app and open the link in Safari, **or**
   - open ORBITAL MIND where your ideas live, press "وضع التلفاز" → "التحكم بالتلفاز" and type the code.
   > If you added ORBITAL MIND to your Home Screen, iOS gives that app its own storage, separate
   > from Safari. Enter the code from inside the Home-Screen app so that the phone shares the
   > ideas you actually use.
4. The TV asks **"جهاز يطلب التحكم بهذا التلفاز"**. Choose "سماح بالتحكم". The phone then asks whether
   to show your ideas on the TV ("عرض أفكاري") or only control what the TV shows ("تحكم فقط").
5. Control the TV from the phone: drag on the pad to orbit, pinch (or the buttons) to zoom,
   pick an idea, Focus Mode (direct/extended), "إظهار الأفكار الرئيسية فقط", toolbar visibility,
   reset view, "إنهاء الاتصال", "إنهاء العرض على التلفاز". "تعديل أفكاري" returns to the full app
   while staying connected; edits appear on the TV immediately.

### The presentation itself

- All application chrome is hidden; only the brain, the ideas, their links and the atmosphere remain.
- The toolbar is revealed/hidden by **double-tapping / double-clicking empty space** (never an idea,
  never after a drag), by the phone, or by the TV remote: **OK/Enter/Menu** shows it, **Back** shows it
  (a second Back with the toolbar visible leaves TV mode), the D-pad orbits, **+/−, Page/Channel keys**
  zoom. With the toolbar shown, left/right move between its buttons.
- Camera composition uses a dedicated 16:9 profile; labels are enlarged for viewing distance.
- If the TV has no phone connected, it shows its own local ideas ("متابعة بدون هاتف").

## Architecture

```
presentation/tv/            TvModeChooser · TvPresentation · TvToolbar · PairingCard · ApprovalPrompt
                            ControllerApp · TouchPad · useTvSession · useControllerSession · useTvRemoteKeys
application/remote/         pairing.ts (codes, hashed peer id, HMAC proof, sequence guard)
                            protocol.ts (typed messages + validation of everything received)
                            graphShare.ts (display-only projection, byte-bounded parts, receiver + validation)
                            tvSession.ts · controllerSession.ts (framework-free state machines)
                            diagnostics.ts (privacy-safe event log) · types.ts (RemoteTransport port)
infrastructure/remote/      peerTransport.ts — WebRTC DataChannel via PeerJS (raw framing)
presentation/tv/            lifecycle.ts (page lifecycle / stall / WebGL-loss logging) · wakeLock.ts
```

- The domain layer is untouched. The remote module depends only on `domain/entities` types.
- The TV reuses the normal scene (`SceneContainer`) inside a second `AppProvider`
  whose container is **ephemeral (in-memory)** when showing a phone's graph. No graph logic is duplicated.
- Phone commands map to existing UI actions (`select`, `enterFocus`, `setPrimaryOnly`…) and a small
  imperative camera API (`sceneRuntime.camera.rotate/zoom/reset`).
- `PeerTransport` and the TV/controller screens are lazy chunks (≈ 27 KB gzipped for PeerJS);
  the desktop bundle is unaffected.

### Signaling (why there is no backend to deploy)

GitHub Pages is static, so the two devices need a rendezvous service to exchange WebRTC
connection offers. ORBITAL MIND uses the **free public PeerJS signaling server** (`0.peerjs.com`).
It only brokers the connection; afterwards all data flows **directly between the devices** over a
DTLS-encrypted WebRTC DataChannel. Nothing about your ideas passes through or is stored on it.

Optional: for full independence from the public server, run your own PeerServer
(`npx peerjs --port 9000`, the npm `peer` package, on any Node host with HTTPS) and build with:

```bash
VITE_SIGNALING_HOST=signal.example.com VITE_SIGNALING_PORT=443 VITE_SIGNALING_PATH=/ npm run build
```

(add these as repository variables / workflow `env` for GitHub Pages builds). A Cloudflare Worker
is not needed with this design.

## Security model

| Threat | Mitigation |
|---|---|
| Someone guesses the code | 31¹⁰ ≈ 8·10¹⁴ codes; 5-minute expiry; rotation after 5 failed proofs; **owner approval required anyway** |
| Signaling server learns the code | It only sees `omtv-` + SHA-256(code) (truncated); the code itself never leaves the two devices |
| Replay of a captured proof | Proof = HMAC-SHA256(code, TV nonce ‖ phone peer id); a fresh nonce per connection, bound to that connection |
| Replay / reorder of commands | Every command carries a strictly increasing sequence number; the TV drops anything else |
| Commands before consent | Ignored until the TV owner presses "سماح بالتحكم" |
| A second device barging in | The TV answers `busy` while a device is pending or connected |
| Crafted links redirecting to a rogue signaling server | `?signal=` is honoured only when the app runs on `localhost` (tests) |
| Malformed / hostile messages | Every inbound message and the shared graph are validated (types, sizes, ranges) |
| The QR code leaking data | It contains only the URL with the code in the `#fragment` (never sent to any server), removed from the address bar after reading |

Transport encryption is WebRTC's mandatory DTLS. The pairing code is the shared secret.

## Privacy

- The phone shares **only after explicit consent**, and only titles, structure, positions, colours,
  status and category. **Never notes, deadlines, reminders or timestamps.**
- The TV keeps the phone's graph **in memory only** (an in-memory repository); it is never written
  to the TV's IndexedDB, and it is discarded on disconnect, on "إنهاء العرض", or when the page closes.
- The phone's data stays authoritative: the TV never sends graph data back.
- The phone receives from the TV only a list of titles of what the TV displays (for the idea picker).
- No account, no cloud database, no permanent sync.

## Link protocol (v2)

All frames are JSON strings sent with PeerJS `raw` serialization. The sender measures every frame in
**UTF-8 bytes** and refuses anything above 16,000 bytes, below PeerJS's and SCTP's limits.

| Concern | Mechanism |
|---|---|
| Graph transfer | `graph-begin {parts, nodes, edges}` → `graph-part {i, nodes[], edges[]}` (each frame ≤ 6 KiB UTF-8, packed by byte size) → per-part `graph-ack` → `graph-done {nodes, edges}` once the TV has **validated the whole graph and applied it to the display** (or `graph-error`) |
| Pacing / backpressure | At most 4 unacknowledged parts in flight; sending pauses while the DataChannel buffer holds more than 256 KB; the transfer fails with a timeout if no ack arrives for 15 s |
| Bounded queues | The TV accepts one transfer at a time with announced totals (≤ 5,000 nodes, 20,000 links, 2,000 parts); a newer transfer supersedes an unfinished one |
| Failure isolation | A failed transfer reports an error on the phone (with "إعادة المحاولة") and **never ends the control session** |
| Liveness | The TV pings every 4 s, and the phone answers. Either side treats 25 s of silence as a lost link |
| Recovery | After approval the TV issues a **one-time resume token**. If the link drops unexpectedly, the TV keeps the session and its temporary graph for a 90 s grace period. The phone reconnects with **the pairing code's HMAC proof plus the token**; nobody else is admitted meanwhile. The token is replaced on every resume and stored only in the tab's `sessionStorage`. When the grace period ends, temporary data is cleared and a fresh code is issued. Sharing resumes only if the user had already consented in this session |
| Explicit endings | `bye` (the phone disconnects or the page truly unloads), `ended` (the TV disconnects or exits): data is cleared at once, with no grace period |

## Incident: phone disconnects (iPhone + Mi TV Stick, protocol v1)

**Bug 2: "عرض أفكاري" disconnected immediately, and ideas never appeared.** The v1 sender cut the graph
JSON into 16,000-**character** chunks and wrapped each one in a JSON message. A 69-idea Arabic graph is
about 17 KB in UTF-8 (Arabic letters take 2 bytes each), and the escaping of JSON-inside-JSON inflated it further. The first
frame was 17,567 bytes. PeerJS's `json` serializer **refuses** messages of 16,300 bytes or more: it
emits an `error` (`message-too-big`) instead of sending. v1 treated any DataConnection `error` as a
closed channel, so the phone showed "disconnected" while the TV never received anything.
*Fix:* raw framing with byte-measured frames, byte-packed 6 KiB parts, acknowledgements, and
`shown` only after `graph-done`. `error` is no longer treated as `close`.

**Bug 1: control-only sessions dropped after about a minute.** Contributing causes found:
1. v1 destroyed the whole peer on *any* `peer` error, including losing the signaling WebSocket
   (`Lost connection to server`, e.g. a missed server heartbeat or a Wi-Fi hiccup). The signaling
   server is only needed to *set up* a connection, but losing it tore down the working
   peer-to-peer channel. *Fix:* only DataConnection `close` ends a channel, and signaling
   reconnects in the background with backoff.
2. Any transient drop was final: an iPhone that auto-locks or switches apps suspends the page,
   and WebRTC dies with it. *Fix:* heartbeat, automatic resume with a token inside the grace period
   (no second approval prompt), immediate resume when the page becomes visible again, and the
   Screen Wake Lock API while connected (iOS 16.4+ in Safari; Home Screen apps from iOS 18.4).

**Diagnostics.** Both devices keep an in-memory log of up to 500 events. It records signaling open/lost/reconnect, ICE and
connection states, DataChannel open (with the SCTP `maxMessageSize`), close (with a reason), refused and
failed sends, heartbeat silence, resume attempts, transfer progress, visibility, pagehide/pageshow,
freeze/resume, online/offline, main-thread stalls over 2.5 s, and WebGL context loss.
The sanitizer accepts only event names, numbers, booleans and short lowercase enum strings, and drops
anything resembling an id or token. **Titles, notes, pairing codes and peer ids cannot be logged.**
Export it with "سجل التشخيص" → "تنزيل السجل" on the phone, or "تنزيل السجل" in the TV toolbar.

## What was verified, and how

| Verified | Method |
|---|---|
| Pairing, approval, rejection, busy, expiry, brute-force rotation, replay protection, sharing, cleanup | Unit tests with real WebCrypto and an in-memory transport that enforces the PeerJS 16,300-byte limit |
| Incident regressions: the realistic 69-idea / 18-link Arabic graph (the old first frame was 17,567 bytes) is shared in byte-bounded parts; `shown` only after validation; TV rejection and stall timeout report errors without ending control; edit re-share; resume without re-approval; a stranger with the code is refused during the grace period; grace expiry clears data; silent-link detection; paged index; diagnostics sanitizer | 15 unit tests (`tests/unit/remote.test.ts`) |
| Over **real WebRTC**: sharing the Arabic graph renders 69 ideas, 61 hierarchy links and 18 cross-links with the status "shown"; killing the signaling server mid-session keeps the link; a forced WebRTC drop resumes automatically with no second approval and the graph intact; control-only use for 75 s with commands every 7.5 s has no drop | `tests/e2e/tv-regressions.spec.ts`. Bugs 1 and 2 **failed these tests before the fix** |
| Full flows over **real WebRTC DataChannels** (code entry, QR link, consent, orbit, zoom, select, focus levels, primary-only, toolbar, live edit sync, disconnect cleanup, control-only, exit TV from the phone, rejection, wrong code) | Playwright: two isolated browser contexts (separate storage, like two devices) + a local PeerJS server |
| **Production path**: live GitHub Pages site + public `0.peerjs.com` signaling | Scripted run: code shown after 5.3 s; request reached the TV 6.7 s after opening the QR link; the TV rendered 31 shared ideas (TV database: 0); primary-only → 6; disconnect → cleared, new code |
| 16:9 composition at 1920×1080 and 2560×1440; phone portrait 390×844 and landscape 844×390 | Simulated viewports (Playwright) |

**Not verified (no hardware available here):** a real iPhone, a real Mi TV Stick, and two devices
on a real home network. All tests ran in Chromium on one Linux machine. In particular, these still
need checking on the devices: iOS Safari suspending WebRTC when the screen locks (resume should
succeed within 90 s of unlocking), Wake Lock behaviour on the user's iOS version, and the TV
browser's WebRTC and WebGL stability over long sessions.

## Limitations

- **Network:** WebRTC normally connects devices on the same Wi-Fi directly. Across different
  networks it may need a TURN relay, which is not configured (it requires credentials). If pairing
  times out, put both devices on the same Wi-Fi.
- **TV browsers:** Android TV has no built-in Chrome. Browsers such as TV Bro (Android System
  WebView) generally support WebGL, WebRTC and WebCrypto, but this varies. Fullscreen may be
  unavailable; the app then uses the full viewport (it never stretches the image). If WebGL fails,
  the scene shows a clear message; if WebRTC is missing, the pairing card says so.
- **Performance on the Mi TV Stick is unmeasured.** Its GPU is modest; the TV profile adapts
  resolution (1.5→0.6 DPR) and can fall back to the lighter material. See `docs/PERFORMANCE.md`.
- The public PeerJS server is a free community service without an uptime guarantee. Self-host
  (above) if you need reliability.
- One controller at a time. The TV's own data isn't editable from the TV.
- **iPhone:** a locked screen or a backgrounded browser suspends the page and its WebRTC link.
  The session survives for 90 s and resumes when the page is visible again; after that, pair again.
  Keep the controller in the foreground, or use the Wake Lock (automatic where supported). A Home
  Screen (PWA) install has **separate storage** from Safari, so its ideas differ from the ones you see in Safari.
- **Android TV sticks:** the TV keeps the screen awake through Wake Lock where the browser supports it.
  Some TV browsers lack it, so disable the screensaver if the TV sleeps during a session. On WebGL context
  loss (low memory) the event is logged.
