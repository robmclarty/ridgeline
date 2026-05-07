# Golden-file output snapshots

Recorded stdout/stderr for the five §7 representative flows. The test
suite is `src/__tests__/golden-output.test.ts`.

Normalization rules applied at capture and at assertion time (kept in
sync with the test's normalizer):

- Timestamps in `[YYYY-MM-DDTHH:MM:SS.sssZ]` form replaced by `[<TS>]`.
- Run-IDs in `<run-XXXXXXXX>` form replaced by `<RUN-ID>`.
- Build paths under `.ridgeline/builds/<name>/` replaced by
  `.ridgeline/builds/<BUILD>/`.
- ANSI cursor-position resets (`\r` and CSI K erase-line) collapsed to
  empty.
- ANSI SGR colour codes are NOT applied during capture (the test sets
  `NO_COLOR=1`); a stray code therefore fails the snapshot.

Files:

- `successful-build.stdout.txt` / `.stderr.txt`
- `sigint-mid-build.stdout.txt` / `.stderr.txt`
- `adversarial-retry-exhausted.stdout.txt` / `.stderr.txt`
- `budget-exceeded.stdout.txt` / `.stderr.txt`
- `schema-validation-failure.stdout.txt` / `.stderr.txt`

To regenerate (after intentionally changing visible output): set
`UPDATE_GOLDEN_OUTPUT=1` and run the suite once. Diff carefully and
commit only intentional changes.
