`ordinary.heic` is a locally generated synthetic 96×64 solid-color test image, not a user or upstream photograph. Source: `jpeg('#426fa4')` in `scripts/photos/fixtures.ts`; encoded on macOS with:

```
sips -s format heic .cache/viewer-fixtures/ordinary.jpg --out tests/viewer/fixtures/ordinary.heic
```

Keeping the 488-byte HEVC fixture lets Linux CI run the actual `heic-to` decoder without requiring a HEVC encoder. TIFF fixtures are regenerated with Sharp by `tests/viewer/prepare.ts`.
