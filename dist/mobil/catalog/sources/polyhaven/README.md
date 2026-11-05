# Poly Haven – hand-tool 3D models (CC0)

- **Source:** https://polyhaven.com (asset pages listed below), downloaded through the public API
  `https://api.polyhaven.com/files/<asset>` → glTF "1k" variant (geometry only; textures were not downloaded).
- **Downloaded:** 2026-11-03
- **License:** CC0 1.0 Universal (public domain dedication) – see `LICENSE.txt`. Attribution is not required but
  is given here and in each catalogue item's `source` field.
- **Version:** Poly Haven assets are not versioned by commit; the `files_hash` reported by
  `https://api.polyhaven.com/info/<asset>` on the download date is recorded below.

## Files

`models/<asset>.gltf` is the unmodified glTF 2.0 JSON. `models/<asset>.bin.gz` is the unmodified binary buffer,
gzip-compressed to keep the repository small (`gzip -d` restores the original `<asset>.bin`, which the `.gltf`
references). MD5 of the uncompressed `.bin` files matches the checksum published by the Poly Haven API:

```
b1d05a421b7e7194fd80187075923a67  adjustable_wrench.bin
3091a90fc9d13c3faf92abfa6a815070  combination_wrench.bin
0eac8ed75a04d4e522ec8364152ba212  cross_pein_hammer.bin
edac44fb7f70ffa37e77fe4c033d9e2b  fish_knife.bin
69b4ed86011a6b42627a3ee947dd55e1  flathead_screwdriver.bin
8bd5390cfa607c765015987b4ca08560  hatchet.bin
b1e09002fb178a078489b2964c853c4e  measuring_tape_01.bin
1c6c1974d94fc2656055d3d7830dd9fb  pipe_wrench.bin
4e7ed7bcaa7b0444ab15ce25742adeb3  pliers.bin
021dc261c222c50e5e07963d0cb7fa7a  ratchet_wrench.bin
8ea09ab792ac4cda5d72c064d10b4b02  rusted_hacksaw.bin
ba3d5de3c16eab528409ded264fa52e8  screwdriver.bin
933a66ae1ae77bd47d03dd1000dff33e  screwdrivers_02.bin
c4b9947dd250ea36f21a6ee20db1a2c3  tongue_groove_pliers.bin
1c6495d23cf3d120897a1655f93750e5  wooden_hammer_01.bin
```

## Assets and authors

| Asset | Name | Author(s) | Published | files_hash | URL |
|---|---|---|---|---|---|
| `combination_wrench` | Combination Wrench | BKS | 2026-07-03 | `66f73753979a` | https://polyhaven.com/a/combination_wrench |
| `adjustable_wrench` | Adjustable Wrench | Mateusz Sadek | 2026-06-30 | `bab4c5d35fe7` | https://polyhaven.com/a/adjustable_wrench |
| `pipe_wrench` | Pipe Wrench | Will Evarts | 2023-08-25 | `0fed71461221` | https://polyhaven.com/a/pipe_wrench |
| `ratchet_wrench` | Ratchet Wrench | John Hutcheson | 2022-12-09 | `db0eaed0940d` | https://polyhaven.com/a/ratchet_wrench |
| `pliers` | Pliers | PierreB3D | 2026-06-20 | `ec99d46cafef` | https://polyhaven.com/a/pliers |
| `tongue_groove_pliers` | Tongue & Groove Pliers | BKS | 2026-07-03 | `925a1957e74b` | https://polyhaven.com/a/tongue_groove_pliers |
| `screwdriver` | Screwdriver | PierreB3D | 2026-06-20 | `667f439fbe86` | https://polyhaven.com/a/screwdriver |
| `flathead_screwdriver` | Flathead Screwdriver | Dylan Detwiller | 2023-02-15 | `a14b91cd2546` | https://polyhaven.com/a/flathead_screwdriver |
| `screwdrivers_02` | Screwdrivers 02 | BKS | 2026-07-03 | `76d1024374cb` | https://polyhaven.com/a/screwdrivers_02 |
| `wooden_hammer_01` | Wooden Hammer 01 | James Ray Cock | 2022-07-15 | `c22831042768` | https://polyhaven.com/a/wooden_hammer_01 |
| `cross_pein_hammer` | Cross Pein Hammer | Tics | 2026-03-20 | `a92f2d9be69d` | https://polyhaven.com/a/cross_pein_hammer |
| `rusted_hacksaw` | Rusted Hacksaw | Dabou Master | 2026-07-03 | `6dc86476881d` | https://polyhaven.com/a/rusted_hacksaw |
| `hatchet` | Hatchet | James Ray Cock, Ulan Cabanilla | 2023-11-25 | `ec44e3d885af` | https://polyhaven.com/a/hatchet |
| `fish_knife` | Fish Knife | Mateusz Sadek | 2026-06-09 | `951440e825e2` | https://polyhaven.com/a/fish_knife |
| `measuring_tape_01` | Measuring Tape 01 | Kuutti Siitonen | 2021-10-15 | `750ca1a82e79` | https://polyhaven.com/a/measuring_tape_01 |

## Conversion to `../../imported.js`

glTF units are metres (converted to mm, node transforms applied). Each mesh was laid flat along its
minimum-thickness direction, projected to a top view, and the outer silhouette was taken as the union of
all projected triangles (Clipper); interior holes (e.g. the hacksaw frame) are filled because the pocket is
a single cut. The long axis was aligned with X and the outline simplified with Douglas–Peucker
(tolerance 0.1 mm, ≤ 600 points). Suggested depth = model thickness + 2 mm, rounded up to 0.5 mm, capped at 40 mm.

Special cases:
- `screwdrivers_02` contains two screwdrivers; each scene node became its own item.
- `fish_knife` is modelled open; only the handle node is used, as the outline of the knife when folded.
- `measuring_tape_01` has its blade pulled out; a 4 mm morphological opening removes the thin blade so
  the outline is the closed case.

These are real-world-scale visualisation models of real tools, not engineering measurements, so catalogue
items are marked `accuracy:'typical'`. Note: Poly Haven's site terms (not the asset licence) restrict
scraping; only these 15 assets were fetched once via the documented public API.
