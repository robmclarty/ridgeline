# Domain Gap Checklist — Mobile Applications

Before searching, evaluate the spec against these common gaps. Focus your research on areas where the spec is silent or vague.

## Offline Behavior

- Sync strategy specified (optimistic, queue-based, CRDT)?
- Conflict resolution rules for concurrent edits?
- Local storage limits and eviction policy?
- Offline UI states and user messaging?

## Push Notifications

- Notification triggers and payload structure defined?
- Permission request timing and fallback behavior?
- Deep linking targets for notification taps?
- Silent push and background refresh strategy?

## Platform Differences

- iOS and Android specific behaviors documented?
- Minimum OS version targets specified?
- Platform-specific UI conventions followed (Material, HIG)?
- Hardware fragmentation and screen size handling?

## App Store

- App Store and Play Store guideline compliance reviewed?
- App metadata, screenshots, and descriptions prepared?
- In-app purchase and subscription rules addressed?
- Review process timeline and rejection risk areas identified?

## Battery & Performance

- Background task limits and wake lock usage defined?
- Memory budget and low-memory handling?
- Network request batching and data transfer optimization?
- App launch time targets specified?

## Navigation

- Navigation pattern chosen (tab bar, drawer, stack)?
- Gesture support and back button behavior documented?
- Deep link routing and universal link handling?
- Navigation state preservation on backgrounding?

## Accessibility

- VoiceOver and TalkBack support requirements?
- Dynamic type and font scaling behavior?
- Color contrast ratios and touch target sizes?
- Reduced motion and haptic feedback preferences?

## Device Features

- Camera, location, and biometric usage documented?
- Permission request flows and denial handling?
- Sensor usage (accelerometer, gyroscope) specified?
- File sharing and system integration points?
