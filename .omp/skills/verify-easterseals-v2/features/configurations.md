# Configurations

A researcher creates a reusable configuration (name, time limit, money settings and inputs) on the Create Configuration form, and it appears as a card on the Configurations page with a Start Session button.

## Sub-features

- `config-open` opens the blank Create Configuration form with three default screen inputs (Left rewarded, Middle, Right).
- `config-save` stores the name and time limit and returns to the Configurations list.
- `config-listed` shows the new configuration as a card with `Start Session` and an edit link.

## How to get to it (user POV)

- Home → `New Configuration` button.
- Configurations (top nav) → `Create Configuration` button.
- Direct URL `/config/new`.

## Driving it with control.sh

Preconditions:

- Doctor is all `ok`.
- No configuration with the chosen name exists (names are not unique in the DB; the journey asserts exactly one).

- **Open form.** Choose `New Configuration` on Home. Run `$S drive configurations --name "Verify fixed 10s"`. Heading `Create Configuration` is shown (step `open-new-configuration`).
- **Fill settings.** Type into the field labelled `Configuration Name *` and set `Time Limit (seconds) *` to 10 (the `--time-limit` option). Step `fill-session-settings` screenshot shows both values.
- **Save.** Choose the `Create Configuration` button. The URL becomes `/configurations` and a card with heading `Verify fixed 10s` and a `Start Session` button appears (step `save-configuration`).
- **Stored row.** `NN-configuration-row.db.json` shows one `configurations` row with `timeLimit` 10, 3 inputs, `leftRewarded` 1, `isArchived` 0.

## Gotchas

- The page heading and the submit button are both named `Create Configuration`; select the heading by role `heading`, the submit by role `button`.
- The money fields are dollar inputs over cents; the stock money limit is $10000.00 (`1000000` cents), which is why session balances read `$x.xx / $10000.00`.
- The stored `config` is JSON text; read it with `json_extract`, not string matching.
