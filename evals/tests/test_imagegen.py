# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx>=0.28,<1", "pillow>=11,<13"]
# ///
"""Image asset regressions, without network or paid calls: uv run evals/tests/test_imagegen.py."""
import base64
import hashlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import Mock, patch

import httpx
from PIL import Image

SCRIPT = Path(__file__).resolve().parents[2] / "skills/code-video/scripts/imagegen.py"
spec = importlib.util.spec_from_file_location("audara_imagegen", SCRIPT)
imagegen = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = imagegen
spec.loader.exec_module(imagegen)


class FixedDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        return cls(2026, 10, 4, 12, 0, 0, tzinfo=tz)


class ImageAssetsTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(prefix="audara-images-test-")
        self.addCleanup(tmp.cleanup)
        self.assets = Path(tmp.name)
        self.requests = []
        api = Mock(base="http://mock.invalid/v1")
        api.post.side_effect = self.respond
        for mock in (patch.object(imagegen, "Api", return_value=api),
                     patch.object(imagegen, "get_key", return_value="eval-fake-key"),
                     patch.object(imagegen, "note"),
                     patch.object(imagegen, "datetime", FixedDateTime)):
            mock.start()
            self.addCleanup(mock.stop)

    def respond(self, path, what, **kwargs):
        self.requests.append((path, kwargs))
        body = kwargs.get("json", kwargs.get("data"))
        data = []
        for k in range(int(body["n"])):
            buf = io.BytesIO()
            transparent = body["background"] == "transparent"
            mode = "RGBA" if transparent else "RGB"
            color = (len(self.requests) * 20, k * 20, 100) + ((0,) if transparent else ())
            with Image.new(mode, (32, 32), color) as im:
                im.save(buf, body["output_format"])
            data.append({"b64_json": base64.b64encode(buf.getvalue()).decode()})
        return httpx.Response(200, json={"data": data, "usage": {"output_tokens": 1000 * len(data)}})

    def generate(self, *extra, yes=True, name="hero"):
        args = ["generate", name, "--out", str(self.assets), "--prompt", "a painting", "--size", "1024x1024"]
        args += ["--yes"] if yes else []
        out = imagegen.Out()
        imagegen.cmd_generate(imagegen.build_parser().parse_args([*args, *extra]), out)
        return out

    def files(self):
        return {p.relative_to(self.assets): p.read_bytes() for p in self.assets.rglob("*") if p.is_file()}

    def assert_records(self, count):
        images = [p for p in self.assets.rglob("*") if p.suffix in (".png", ".webp")]
        self.assertEqual(len(images), count)
        self.assertEqual(len(list(self.assets.rglob("*.request.json"))), count)
        for p in images:
            rec = json.loads(imagegen.side(p).read_text(encoding="utf-8"))
            self.assertEqual(rec["output_format"], p.suffix[1:])
            self.assertEqual(rec["response"]["image_sha256"], hashlib.sha256(p.read_bytes()).hexdigest())
        n, cost = imagegen.spent_here(self.assets)
        self.assertEqual(n, count)
        self.assertAlmostEqual(cost, count * 0.03)

    def test_an_edit_of_the_image_it_writes_is_refused_before_anything_moves(self):
        self.generate(name="reference")
        self.generate("--transparent")
        self.generate("--takes", "2")
        hero, take1, reference = (str(self.assets / p) for p in ("hero.png", "takes/hero.take1.png", "reference.png"))
        before, calls = self.files(), len(self.requests)
        for args in (("--ref", hero), ("--ref", reference, "--mask", hero), ("--format", "webp", "--ref", hero),
                     ("--takes", "2", "--ref", take1)):
            with self.subTest(args=args):
                with self.assertRaises(imagegen.Fail) as error:
                    self.generate(*args, "--prompt", "the painting at night")
                self.assertEqual(error.exception.code, imagegen.USAGE)
                self.assertIn("its own name", str(error.exception))
                self.assertEqual(self.files(), before)
                self.assertEqual(len(self.requests), calls)

    def test_an_edit_under_its_own_name_runs_again_without_a_call(self):
        self.generate()
        edit = ("--ref", str(self.assets / "hero.png"), "--prompt", "the painting at night")
        self.generate(*edit, name="hero-night")
        path, request = self.requests[-1]
        self.assertEqual(path, "images/edits")
        self.assertEqual(request["files"][0][1][1], (self.assets / "hero.png").read_bytes())
        before = self.files()
        out = self.generate(*edit, name="hero-night")
        self.assertEqual(out.data["status"], "unchanged")
        self.assertEqual(len(self.requests), 2)
        self.assertEqual(self.files(), before)
        self.assert_records(2)

    def test_an_up_to_date_take_keeps_its_record_when_a_missing_one_is_made(self):
        self.generate("--takes", "2", "--format", "webp")
        # what the old format bug left: a PNG take beside the WebP one whose record overwrote the PNG's
        for take in (1, 2):
            with Image.new("RGB", (32, 32)) as im:
                im.save(self.assets / f"takes/hero.take{take}.png")
        self.generate("--takes", "3", "--format", "webp")
        self.assertEqual(len(self.requests), 2)
        for take in (1, 2):
            rec = json.loads((self.assets / f"takes/hero.take{take}.request.json").read_text(encoding="utf-8"))
            image = self.assets / f"takes/hero.take{take}.webp"
            self.assertEqual(rec["response"]["image_sha256"], hashlib.sha256(image.read_bytes()).hexdigest())
        out = self.generate("--takes", "3", "--format", "webp")
        self.assertEqual(out.data["status"], "unchanged")
        self.assertEqual(len(self.requests), 2)

    def test_take_format_changes_keep_all_records_even_in_the_same_second(self):
        for fmt in ("png", "webp", "png"):
            self.generate("--takes", "2", "--format", fmt)
        self.assert_records(6)
        before = self.files()
        out = self.generate("--takes", "2", "--format", "png")
        self.assertEqual(out.data["status"], "unchanged")
        self.assertEqual(len(self.requests), 3)
        self.assertEqual(self.files(), before)

    def test_format_change_without_confirmation_keeps_existing_assets(self):
        self.generate("--takes", "2")
        before = self.files()
        with self.assertRaises(imagegen.Fail) as error:
            self.generate("--takes", "2", "--format", "webp", yes=False)
        self.assertEqual(error.exception.code, imagegen.CONFIRM)
        self.assertEqual(self.files(), before)
        self.assertEqual(len(self.requests), 1)

    def test_batch_save_failures_preserve_all_takes_and_retry_without_paying(self):
        replace = imagegen.os.replace

        def locked(src, dst):
            if Path(dst).name in ("hero.take1.png", "hero.take2.png"):
                raise PermissionError("image temporarily locked")
            return replace(src, dst)

        with patch.object(imagegen.os, "replace", side_effect=locked):
            with self.assertRaises(imagegen.Fail) as error:
                self.generate("--takes", "3")
        self.assertEqual(error.exception.data["status"], "save_failed")
        self.assertAlmostEqual(error.exception.data["actual_usd"], 0.09)
        for take in (1, 2):
            self.assertTrue((self.assets / f"takes/hero.take{take}.rescued.png").is_file())
        self.assertTrue((self.assets / "takes/hero.take3.png").is_file())
        self.assert_records(3)
        out = self.generate("--takes", "3")
        self.assertEqual(out.data["status"], "unchanged")
        self.assertEqual(len(self.requests), 1)
        self.assertFalse(list(self.assets.rglob("*.rescued*")))
        for take in (1, 2, 3):
            self.assertTrue((self.assets / f"takes/hero.take{take}.png").is_file())
        self.assert_records(3)

    def test_an_unrecoverable_save_still_saves_the_remaining_paid_takes(self):
        replace, write = imagegen.os.replace, Path.write_bytes

        def locked(src, dst):
            if Path(dst).name == "hero.take1.png":
                raise PermissionError("image temporarily locked")
            return replace(src, dst)

        def no_rescue(path, data):
            if path.name == "hero.take1.rescued.png":
                raise PermissionError("rescue unavailable")
            return write(path, data)

        with patch.object(imagegen.os, "replace", side_effect=locked), patch.object(Path, "write_bytes", no_rescue):
            with self.assertRaises(imagegen.Fail) as error:
                self.generate("--takes", "3")
        self.assertIn("paid image could not be written", str(error.exception))
        for take in (2, 3):
            self.assertTrue((self.assets / f"takes/hero.take{take}.png").is_file())
        self.assertEqual(len(self.requests), 1)
        self.assert_records(2)


if __name__ == "__main__":
    unittest.main()
