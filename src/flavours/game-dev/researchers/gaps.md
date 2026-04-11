# Domain Gap Checklist — Game Development

Before searching, evaluate the spec against these common gaps. Focus your research on areas where the spec is silent or vague.

## Visual Design

- Sprite resolution and texture atlas size specified?
- Animation states enumerated (idle, walk, jump, attack, death)?
- Color palette and art style constraints documented?
- Parallax layers and depth ordering defined?

## Audio

- Sound effects mapped to game states and player actions?
- Music mood, looping behavior, and transition rules specified?
- Audio format and compression targets (OGG, WAV, bitrate)?
- Volume mixing levels and audio channel priorities?

## Game Feel

- Input latency targets defined for player actions?
- Screen shake, hit pause, and juice effects specified?
- Camera behavior documented (follow, lerp, bounds, zoom)?
- Controller and input device support listed?

## Performance

- Frame budget per system (rendering, physics, AI)?
- Draw call and batching targets specified?
- Memory budget per platform?
- Target frame rate and minimum hardware spec?

## Player Experience

- Onboarding and tutorial flow designed?
- Difficulty curve and progression pacing documented?
- Save/load system requirements (auto-save, slots, cloud sync)?
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

## Multiplayer & Networking

- Netcode model specified (client-server, P2P, rollback)?
- Lag compensation and prediction strategy documented?
- State synchronization and conflict resolution defined?
- Matchmaking, lobbies, and session management requirements?
