To generate proper PWA icons, create PNGs at the following sizes and place them in this folder:

- icon-192.png  (192x192)
- icon-256.png  (256x256)
- icon-384.png  (384x384)
- icon-512.png  (512x512)
- maskable-icon-512.png (512x512, maskable safe zone)

Recommended tooling:

- use ImageMagick: `convert source.svg -resize 512x512 icon-512.png` then downscale for other sizes
- or use `pwabuilder` or `realfavicongenerator.net` to produce a full set

For maskable icons, follow Android maskable icon guidelines: ensure crucial artwork sits within a centered safe region.