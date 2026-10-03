# /// script
# requires-python = ">=3.10"
# dependencies = ["fonttools>=4.47"]
# ///
"""Cut static instances out of a variable font, for the engine.

Canvas2D (FontFace) and opentype.js draw a variable font only at its default instance, so every width
or weight a video uses becomes its own static file in public/fonts/.

  uv run scripts/font-instances.py <variable.ttf> --axis wght=400,700 [--axis wdth=75,100]
                                   [--name Inter] [--pattern "{name}-{wght}"] [--out public/fonts]

One file per combination of the values given (with two axes, every width at every weight). Axes left
out are pinned at the font's default (the script says which). --pattern names the files: {name}, and
each axis tag ({wght}, {wdth}, {opsz}...), optionally times a factor ({wdth*10}); the default is
"{name}-wght400" style. Then register the files in src/engine/type.ts (FONTS) and put the font's
license next to them (public/fonts/OFL-<Name>.txt for an OFL font).

The template's Archivo files were made this way (from Archivo[wdth,wght].ttf, Google Fonts):
  uv run scripts/font-instances.py "Archivo[wdth,wght].ttf" --axis wdth=62,75,87.5,100,112.5,125
      --axis wght=300,500,700,900 --pattern "Archivo-w{wdth*10}-{wght}"
"""
import argparse
import itertools
import re
import sys
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer


def fmt(v: float) -> str:
    """87.5 -> '87.5', 400.0 -> '400' (file names without trailing .0)."""
    return str(int(v)) if float(v).is_integer() else f"{v:g}"


def main() -> None:
    ap = argparse.ArgumentParser(description="Static instances of a variable font (see the docstring).")
    ap.add_argument("font", type=Path, help="the variable font (.ttf)")
    ap.add_argument("--axis", action="append", default=[], metavar="TAG=V1,V2", help="axis values, e.g. wght=400,700 (repeat per axis)")
    ap.add_argument("--name", help="family name in the file names (default: the font's file name up to '[' or '-')")
    ap.add_argument("--pattern", help='file name pattern without .ttf, e.g. "{name}-{wght}" or "Archivo-w{wdth*10}-{wght}"')
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "public" / "fonts", help="output folder (default: the project's public/fonts)")
    args = ap.parse_args()

    if not args.font.is_file():
        sys.exit(f"{args.font}: no such file")
    font = TTFont(args.font)
    if "fvar" not in font:
        sys.exit(f"{args.font} is not a variable font (no fvar table): it is static already, copy it to public/fonts/ as it is")
    axes = {a.axisTag: a for a in font["fvar"].axes}
    described = ", ".join(f"{t} {a.minValue:g}..{a.maxValue:g} (default {a.defaultValue:g})" for t, a in axes.items())
    if not args.axis:
        sys.exit(f"give the values to cut with --axis TAG=V1,V2; this font's axes: {described}")

    wanted: dict[str, list[float]] = {}
    for spec in args.axis:
        tag, _, vals = spec.partition("=")
        if tag not in axes:
            sys.exit(f"axis {tag!r} is not in this font; its axes: {described}")
        try:
            values = [float(v) for v in vals.split(",") if v.strip()]
        except ValueError:
            sys.exit(f"--axis {spec}: values must be numbers, e.g. {tag}=400,700")
        a = axes[tag]
        bad = [v for v in values if not a.minValue <= v <= a.maxValue]
        if not values or bad:
            sys.exit(f"--axis {spec}: values must lie in {a.minValue:g}..{a.maxValue:g}")
        wanted[tag] = values
    given = list(wanted)
    for tag, a in axes.items():
        if tag not in wanted:
            print(f"{tag}: not given, pinned at the default {a.defaultValue:g}")
            wanted[tag] = [a.defaultValue]

    name = args.name or re.split(r"[\[\-]", args.font.stem)[0]
    pattern = args.pattern or "{name}-" + "-".join(f"{t}{{{t}}}" for t in given)
    unknown = [m for m in re.findall(r"\{(\w+)", pattern) if m != "name" and m not in axes]
    if unknown:
        sys.exit(f"--pattern uses {', '.join(unknown)}: only {{name}} and the axis tags ({', '.join(axes)}) can appear")

    def file_name(loc: dict[str, float]) -> str:
        def sub(m: re.Match) -> str:
            key, factor = m.group(1), m.group(2)
            if key == "name":
                return name
            return fmt(loc[key] * float(factor) if factor else loc[key])
        return re.sub(r"\{(\w+)(?:\*([\d.]+))?\}", sub, pattern) + ".ttf"

    args.out.mkdir(parents=True, exist_ok=True)
    tags = list(wanted)
    n = 0
    for combo in itertools.product(*(wanted[t] for t in tags)):
        loc = dict(zip(tags, combo))
        inst = instancer.instantiateVariableFont(font, loc, inplace=False, updateFontNames=False)
        path = args.out / file_name(loc)
        inst.save(path)
        print(path)
        n += 1
    print(f"{n} static instance{'s' if n != 1 else ''} in {args.out}: register them in src/engine/type.ts (FONTS) and add the font's license there too")


if __name__ == "__main__":
    main()
