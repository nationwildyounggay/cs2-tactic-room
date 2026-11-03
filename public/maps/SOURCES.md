# Third-party Counter-Strike 2 radar assets

## Provenance and freshness

Downloaded on **2026-11-03** from [MurkyYT/cs2-map-icons](https://github.com/MurkyYT/cs2-map-icons), a public community mirror that describes its workflow as automatically extracting CS2 map radars and overview data from the official game depot whenever Valve updates it. These are actual third-party radar textures, not application-authored illustrations or fabricated map layouts.

Observed upstream HEAD: [`c29c14dabcdce583ad122128aa14cc59185ae1eb`](https://github.com/MurkyYT/cs2-map-icons/commit/c29c14dabcdce583ad122128aa14cc59185ae1eb). The upstream [depot manifest marker](https://github.com/MurkyYT/cs2-map-icons/blob/c29c14dabcdce583ad122128aa14cc59185ae1eb/static/manifest.txt) at retrieval was `3690356453703667427`.

These were the current assets supplied by that actively maintained CS2 mirror when retrieved. No independent installation of the game was available to certify that the mirror exactly matches every subsequent Valve patch. They are CS2-source assets, not an intentional CS:GO fallback.

## Local files and original download URLs

All three images are **1024 × 1024 RGBA PNG**, preserved byte-for-byte: no crop, resize, rotation, mirroring, or recoloring. Each contains transparency and subdued radar geometry; render against a contrasting background. Images contain orange bombsite outlines and green spawn outlines, but do not include callout text.

| Map | Local asset | Original download URL | Size |
| --- | --- | --- | --- |
| Mirage | [de_mirage.png](./de_mirage.png) | [Valve radar via community mirror](https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/radars/de_mirage_radar_psd.png) | 111,393 bytes |
| Inferno | [de_inferno.png](./de_inferno.png) | [Valve radar via community mirror](https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/radars/de_inferno_radar_psd.png) | 109,883 bytes |
| Dust II | [de_dust2.png](./de_dust2.png) | [Valve radar via community mirror](https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/radars/de_dust2_radar_psd.png) | 153,557 bytes |

To obtain revision-pinned source URLs, replace `main` in each download URL with the upstream commit above. The application should load the checked-in local paths `/maps/de_mirage.png`, `/maps/de_inferno.png`, and `/maps/de_dust2.png`; there is **no runtime network dependency**.

### SHA-256

```text
5de1cc16362e538dc5f4561a24661cb1fb1c15c77ec289e32b44c0fc07bfb85b  de_mirage.png
e4929829f8475d2edcb44ee3537ffad094dc8008b4d6f5aa81e66e77ddb077ba  de_inferno.png
3be20317d1383da6f390a5bb245cabb65857ef08b1e2c5b82b5938a8cb3167bb  de_dust2.png
```

## Coordinate orientation and overlay alignment

Use the **entire square image**, not a cropped play-area bounding box. Image/canvas coordinates have `(0,0)` at the top-left; X increases to the right and Y increases downward. A `viewBox="0 0 1000 1000"` overlay can scale the complete PNG uniformly to that square without any additional rotation.

- **Mirage:** B is upper-left; A is lower-center/right; T spawn is at the right edge; CT spawn is lower-left.
- **Inferno:** B is upper-center; A is lower-right; T spawn is left/lower-left; CT spawn is upper-right.
- **Dust II:** B is upper-left; A is upper-right; T spawn is near the bottom; CT spawn is upper-center.

Approximate visual anchor coordinates in a **0–1000 square** (not pixel-perfect positions, gameplay navigation, or grenade lineups):

| Map | A site | B site | T spawn | CT spawn | Mid |
| --- | --- | --- | --- | --- | --- |
| Mirage | (545, 763) | (230, 282) | (880, 360) | (288, 698) | (560, 455) |
| Inferno | (812, 680) | (485, 220) | (100, 668) | (893, 352) | (540, 785) |
| Dust II | (796, 168) | (207, 127) | (390, 895) | (605, 207) | (478, 455) |

The mirror also supplies the original Valve overview metadata:

| Map | Overview source | pos_x | pos_y | scale | rotate field |
| --- | --- | ---: | ---: | ---: | --- |
| Mirage | [de_mirage.txt](https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/data/radar_info/de_mirage.txt) | -3230 | 1713 | 5.0 | 0 |
| Inferno | [de_inferno.txt](https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/data/radar_info/de_inferno.txt) | -2087 | 3870 | 4.9 | not supplied |
| Dust II | [de_dust2.txt](https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/data/radar_info/de_dust2.txt) | -2476 | 3239 | 4.4 | 1 |

For unrotated radar image coordinates, the usual world-to-radar mapping is `radar_x = (world_x - pos_x) / scale`, `radar_y = (pos_y - world_y) / scale` on the 1024-unit radar reference; multiply both by `1000 / 1024` for a 1000-unit overlay. Thus world +X points right and world +Y points up. The overview `rotate` field is metadata for in-game radar presentation; **do not rotate the downloaded Dust II PNG merely because it contains `rotate=1`**. Its A/B/spawn outlines already have the orientation described above. Validate world-coordinate overlays against known demo positions before treating them as exact; altitude-dependent overlapping passages are not resolved by a single 2D image.

## Attribution and restrictions

**Counter-Strike 2, its map artwork, radar images, and overview data are property of Valve Corporation.** The [upstream README license section](https://github.com/MurkyYT/cs2-map-icons#license) explicitly identifies Valve as the owner and says the repository only provides automated access to publicly available resources.

The mirror does **not** state that Valve artwork is MIT, public domain, CC0, or otherwise freely relicensed. A software license on this application's own code does not apply to these images. Preserve this notice and credit Valve Corporation and the community extraction source. Public download availability is not a blanket redistribution or commercial-use grant; review Valve's applicable terms and obtain any needed permission before public/commercial redistribution. This project is not endorsed by or affiliated with Valve.

Suggested UI credit: “CS2 radar artwork © Valve Corporation. Asset mirror: MurkyYT/cs2-map-icons.”
