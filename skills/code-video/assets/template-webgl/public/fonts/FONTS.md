# Fonts

These fonts are **not** covered by audara-studio's MIT License. Each keeps its own license, and the
full text sits in this folder. Keep the license files next to the fonts: Vite copies `public/` as is,
so they also ship with every build.

Videos, stills and other documents made with these fonts are not bound by the OFL and need no credit.
The Hershey license asks for its acknowledgements to travel with the font data, meaning the SVG files.
Distributing the font files themselves, for example in a project repository or a built site, does
require their license files.

| File | Family, version | License | License file | Source | Notes |
|---|---|---|---|---|---|
| `Archivo-w{620,750,875,1000,1125,1250}-{300,500,700,900}.ttf` (24 files) | Archivo 2.001 (Omnibus-Type, designer Hector Gatti) | OFL-1.1, no Reserved Font Name | `OFL-Archivo.txt` | `Archivo[wdth,wght].ttf` from https://github.com/google/fonts/tree/main/ofl/archivo (upstream https://github.com/Omnibus-Type/Archivo) | Static instances (Modified Versions), see "Changes". `w` = width × 10, then weight. "Archivo is a trademark of Omnibus-Type." |
| `ArchivoItalic-w{750,1000}-{400,800}.ttf` (4 files) | Archivo 2.001 Italic | OFL-1.1, no Reserved Font Name | `OFL-Archivo.txt` | `Archivo-Italic[wdth,wght].ttf`, same folder | Static instances, see "Changes" |
| `Cormorant-{400,600}.ttf` | Cormorant Garamond 4.001 (Christian Thalmann, Catharsis Fonts) | OFL-1.1, no Reserved Font Name | `OFL-CormorantGaramond.txt` | `CormorantGaramond[wght].ttf` from https://github.com/google/fonts/tree/main/ofl/cormorantgaramond (upstream https://github.com/CatharsisFonts/Cormorant) | Static instances, see "Changes". The file names say Cormorant, but the family is Cormorant Garamond. |
| `CormorantItalic-{400,600}.ttf` | Cormorant Garamond 4.001 Italic | OFL-1.1, no Reserved Font Name | `OFL-CormorantGaramond.txt` | `CormorantGaramond-Italic[wght].ttf`, same folder | Static instances, see "Changes" |
| `IBMPlexMono-{Light,Regular,Medium,SemiBold,Bold,Italic}.ttf` | IBM Plex Mono 2.3 (IBM, Bold Monday) | OFL-1.1, Reserved Font Name "Plex" | `OFL-IBMPlexMono.txt` | https://github.com/google/fonts/tree/main/ofl/ibmplexmono (upstream https://github.com/IBM/plex) | Unmodified, byte-identical to Google Fonts. A subset, conversion or other change must not be called "Plex". "IBM Plex(r) is a trademark of IBM Corp, registered in many jurisdictions worldwide." |
| `stroke/EMSAllure.svg` | EMS Allure, derived from Allura | OFL-1.1 (parent's Reserved Font Name "Allura", not used) | `stroke/OFL-EMSAllure.txt` | https://gitlab.com/oskay/svg-fonts/-/tree/master/fonts/EMS | Unmodified, 2019 revision (see "Stroke fonts") |
| `stroke/EMSFelix.svg` | EMS Felix, derived from Felipa | OFL-1.1 (parent's Reserved Font Name "Felipa", not used) | `stroke/OFL-EMSFelix.txt` | same | Unmodified, 2019 revision |
| `stroke/EMSOsmotron.svg` | EMS Osmotron, derived from Orbitron | OFL-1.1 (parent's Reserved Font Name "Orbitron", not used) | `stroke/OFL-EMSOsmotron.txt` | same | Unmodified, 2019 revision |
| `stroke/EMSReadability.svg` | EMS Readability, derived from Source Sans Pro Light | OFL-1.1 (parent's Reserved Font Name "Source", not used) | `stroke/OFL-EMSReadability.txt` | same | Unmodified, 2019 revision |
| `stroke/EMSTech.svg` | EMS Tech, derived from Architects Daughter | OFL-1.1, no Reserved Font Name | `stroke/OFL-EMSTech.txt` | same | Unmodified, 2019 revision |
| `stroke/HersheySans1.svg`, `stroke/HersheyScript1.svg`, `stroke/HersheySerifMed.svg` | Hershey Sans 1-stroke, Hershey Script 1-stroke, Hershey Serif medium | Hershey Fonts license: the acknowledgements must travel with the font data, and the data may not be converted to the U.S. NTIS format | `stroke/LICENSE-Hershey.txt` (also embedded in each file) | https://gitlab.com/oskay/svg-fonts/-/tree/master/fonts/Hershey | Unmodified, 2019 revision |

## Changes from the original versions

- **Archivo and Cormorant Garamond.** The static instances were generated from the Google Fonts
  variable fonts by pdoom-video's `analysis/make_fonts.py`, with fontTools 4.66.1
  `varLib.instancer.instantiateVariableFont(font, location, updateFontNames=False)`. Locations:
  - Archivo: `wdth` 62, 75, 87.5, 100, 112.5 and 125, each at `wght` 300, 500, 700 and 900.
  - Archivo Italic: `wdth` 75 and 100, each at `wght` 400 and 800.
  - Cormorant Garamond and its italic: `wght` 400 and 600.

  The outlines, metrics and OS/2 weight and width classes are those of each location. The name table
  was not updated, so the names inside the files are stale:
  - every upright Archivo file calls itself "Archivo SemiBold" (PostScript name `Archivo-SemiBold`);
  - every italic one calls itself "Archivo SemiBold Italic";
  - every Cormorant file calls itself "Cormorant Garamond Light" or "Cormorant Garamond Light Italic".

  The engine never reads these names, because it registers each file under its own `FontFace`
  family. Installed on a computer, though, the files would clash with each other and with the real
  Archivo SemiBold and Cormorant Garamond Light. The copyright, trademark and license records (name
  IDs 0, 7, 13 and 14) are unchanged.
- **IBM Plex Mono and the stroke fonts:** unmodified.

## Stroke fonts

The EMS and Hershey SVG fonts were first published in Evil Mad Scientist's svg-fonts repository,
commit `a317f1d6` (2019-06-19, https://gitlab.com/oskay/svg-fonts/-/commit/a317f1d6a61bd2e7c7d29ec317ea3a00054686f4).
These copies came by way of the npm package `hersheytext` 2.0.0, whose MIT license covers only its
code. Later upstream revisions add about 30 glyphs per font (187 to 216 in most files) under the same
embedded licenses. The
commits are "Add new characters" (2020), "Danish language support: Æ, æ" (2020) and "Update font set
with Ć, ć, Ð, đ, Č, č, Š, š, Ž, ž" (2023).

Upstream ships the EMS fonts with an OFL.txt whose copyright lines are blank placeholders. The
`OFL-EMS*.txt` files fill them in with the notices of each original font, as published in
https://github.com/google/fonts when the EMS fonts were made. They also keep each original font's
Reserved Font Name and trademark declarations, which the OFL requires a derivative to carry.

## Adding a font

1. Pick a font whose license allows redistribution, usually the OFL. On Google Fonts its license file
   is at `https://github.com/google/fonts/tree/main/ofl/<family>/OFL.txt`.
2. Copy that file here as `OFL-<Family>.txt` and add a row to the table above.
3. Read its first lines. "with Reserved Font Name ..." means you may ship the files unchanged, but
   anything you derive from them must not use that name. That includes a static instance of a
   variable font, a subset, and most format conversions (OFL-FAQ 2.2 explains the WOFF/WOFF2
   exception). When you generate such files, give them a new family name in every name record that
   identifies the font: IDs 1, 4, 6 and 16, plus 3, 21 and 25 where present.
4. Keep any trademark notice (name ID 7) and the copyright line (name ID 0).
