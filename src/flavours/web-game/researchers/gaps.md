# Domain Gap Checklist — Browser Game Development

Before searching, evaluate the spec against these common gaps. Focus your research on areas where the spec is silent or vague.

## Visual Design

- Sprite sheet and texture atlas format (PNG, WebP) specified?
- Canvas resolution and device pixel ratio (DPR) handling documented?
- Animation states enumerated (idle, walk, jump, attack, death)?
- Color palette and art style constraints documented?
- Parallax layers and depth ordering defined?

## Audio

- Sound effects mapped to game states and player actions?
- Music mood, looping behavior, and transition rules specified?
- Audio format and compression targets (OGG, MP3, bitrate)?
- Volume mixing levels and audio channel priorities?
- Web Audio API autoplay policy handling specified?
- Audio sprite or individual file strategy documented?

## Game Feel

- Input latency targets defined for player actions?
- Screen shake, hit pause, and juice effects specified?
- Camera behavior documented (follow, lerp, bounds, zoom)?
- Input methods specified (keyboard, mouse, touch, gamepad via Gamepad API)?

## Performance

- Frame budget per system (rendering, physics, AI)?
- WebGL draw call budget and batching strategy?
- Bundle size budget and asset loading strategy?
- Target frame rate and minimum hardware spec?
- requestAnimationFrame vs fixed timestep approach documented?

## Player Experience

- Onboarding and tutorial flow designed?
- Difficulty curve and progression pacing documented?
- Save/load system requirements (auto-save, slots, localStorage/IndexedDB persistence)?
- Accessibility options specified (remapping, colorblind modes, subtitles)?

## Physics & Collision

- Collision layers and interaction matrix defined?
- Physics step rate and interpolation method specified?
- Edge cases addressed (tunneling, stacking, slopes)?
- Gravity, friction, and movement constants documented?

## UI & HUD

- Health bars, score displays, and status indicators designed?
- Menu flow and screen transitions specified?
- Responsive layout for different resolutions and aspect ratios?
- Inventory, dialogue, and shop UI requirements documented?

## Browser Compatibility

- Target browsers and minimum versions specified?
- WebGL, WebGL2, or WebGPU feature requirements documented?
- Fallback for WebGL context loss defined?
- Tab backgrounding behavior (document.hidden) handling specified?
- CORS policy for asset loading addressed?
- Mobile viewport and orientation handling documented?

## Multiplayer & Networking

- Netcode model specified (client-server, P2P, rollback)?
- Lag compensation and prediction strategy documented?
- State synchronization and conflict resolution defined?
- Matchmaking, lobbies, and session management requirements?
- WebSocket vs WebRTC approach documented?
- Browser connection limits considered?
