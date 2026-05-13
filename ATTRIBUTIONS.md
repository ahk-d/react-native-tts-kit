# Attributions

`react-native-speechkit` ships and depends on the following components.

---

## Model weights — Supertonic-3 (BigScience OpenRAIL-M)

- **Original source:** https://huggingface.co/Supertone/supertonic-3
  - Pinned upstream commit: `724fb5abbf5502583fb520898d45929e62f02c0b` (2026-04-29 release)
- **Mirror used by this package:** https://huggingface.co/ahk-d/supertonic-3
  - Pinned mirror commit: `5024985bc861c2ae97ef9038dc2fc56f410e95be`
  - Byte-identical copy of the upstream weights, hosted as a redistribution
    safeguard (OpenRAIL-M Section III §4 explicitly permits redistribution).
  - The package downloads from the mirror first; if it's unreachable, falls
    back to the upstream Supertone repo at the pinned upstream commit.
- **Copyright:** © 2025 Supertone Inc.
- **License:** [BigScience OpenRAIL-M](./licenses/OpenRAIL-M.txt) (full text shipped under `licenses/`)

### What you can do
- Use the weights in commercial apps, no royalty.
- Redistribute, fine-tune, derive new models.
- Modify `.onnx` files (mark them as modified per Section III §4(c)).

### What you cannot do (Attachment A — Use Restrictions)
You may not use the model, or any model derived from it, to:
1. Violate any law.
2. Exploit or harm minors.
3. Generate or spread verifiably false information intended to harm.
4. Generate or spread personal identifiable information to harm someone.
5. Generate AI content without **clearly disclosing that it is AI-generated**.
6. Defame, disparage, or harass.
7. **Impersonate someone (e.g. deepfakes) without their consent.**
8. Make fully-automated decisions affecting a person's legal rights.
9. Discriminate or harm groups based on protected characteristics.
10. Exploit vulnerable populations.
11. Provide medical advice / interpret medical results.
12. Use for law-enforcement, immigration, or asylum prediction.

### What you must do when distributing this package or apps built with it
Per OpenRAIL-M Section III §4:
- (a) Bind your end users to the same use restrictions in your ToS or license.
- (b) Ship a copy of the OpenRAIL-M license with the model (we do — see `licenses/`).
- (c) Mark any modified model files. (We don't modify the `.onnx` files.)
- (d) Preserve Supertone's copyright and attribution notices. (We do.)

> **Practical guidance for apps shipping this package:** add a line to your ToS / "About" screen along the lines of:
> *"This app uses Supertone's Supertonic-3 model under the BigScience OpenRAIL-M License. Your use of this app's voice features is subject to the OpenRAIL-M Use Restrictions, which prohibit impersonation without consent, generation of misleading content, and other harmful uses."*

---

## Source-code reference — Supertone/supertonic GitHub

We **do not vendor** Supertone's code. Our iOS Swift inference and Android
Kotlin port ([`ios/Supertonic/`](./ios/Supertonic/), [`android/.../supertonic/`](./android/src/main/java/expo/modules/speechkit/supertonic/))
were written from scratch using the upstream Python and Swift references as a
specification:

- **Source:** https://github.com/supertone-inc/supertonic
- **Copyright:** © 2025 Supertone Inc.
- **License:** [MIT](https://github.com/supertone-inc/supertonic/blob/main/LICENSE)

The MIT license on the upstream code does not impose redistribution
obligations on our independent port; we credit Supertone here for
transparency and because the code is closely modeled on theirs.

---

## Runtime dependencies

| Package | Source | License |
|---|---|---|
| ONNX Runtime (iOS / Android) | https://github.com/microsoft/onnxruntime | MIT |
| Expo Modules Core | https://github.com/expo/expo | MIT |
| `expo-speech` (optional system engine) | https://github.com/expo/expo/tree/main/packages/expo-speech | MIT |
| `expo-asset`, `expo-constants`, `expo-dev-client` | https://github.com/expo/expo | MIT |

---

## This package

- **Code license:** MIT — see [`LICENSE`](./LICENSE)
- **Copyright:** © 2026 ahk-d

The MIT license on this repository covers only the code in `src/`, `ios/`,
`android/`, `example/`, and `benchmarks/`. The Supertonic-3 model weights
downloaded at runtime remain under the OpenRAIL-M license described above.
