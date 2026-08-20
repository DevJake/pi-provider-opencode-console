# Assets

This directory is checked in as **stubs only**. Drop the real binaries before publishing.

| File | Status | Purpose | Ship? |
| --- | --- | --- | --- |
| `cover.jpg` | `cover.jpg.stub` placeholder | 1280x720 README cover + Pi package gallery card | yes |
| `icon.png` | `icon.png.stub` placeholder | 128x128 GitHub social preview / package search thumbnail | no |

## Swap on your other machine

```sh
mv assets/cover.jpg.stub assets/cover.jpg  # then drop the real cover
mv assets/icon.png.stub assets/icon.png    # then drop the real icon
```

After the swap, `npm run check` will:

- Have `assets/cover.jpg` present (verified by `test/package.test.ts`).
- Still exclude `assets/icon.png` from the npm tarball.

## Specs

- `cover.jpg`: 1280x720 JPEG, ~70–150 kB, dark background, brand wordmark + short tagline.
- `icon.png`: 128x128 PNG, transparent background, brand mark only.

Poolside reference: https://github.com/grikomsn/pi-provider-poolside/tree/main/assets
