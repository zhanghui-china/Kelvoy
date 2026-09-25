import json
import unittest
from pathlib import Path

from spike.m0.comfyui_smoke import prepare_image, prepare_video


BRIDGE = Path(__file__).resolve().parents[2] / "comfyui-bridge"


class SmokeWorkflowTest(unittest.TestCase):
    def test_dual_reference_image_uses_portrait_and_fixed_seed(self):
        template = json.loads((BRIDGE / "1_2_DualRef2IMG_QwenImage2_1_api.json").read_text())
        result = prepare_image(template, "persona.png", "landmark.jpg", "traveler at landmark", 42)

        self.assertEqual(result["489"]["inputs"]["image"], "persona.png")
        self.assertEqual(result["491"]["inputs"]["image"], "landmark.jpg")
        self.assertEqual(result["469"]["inputs"]["prompt"], "traveler at landmark")
        self.assertEqual(result["493"]["inputs"]["aspect_ratio"], "9:16 (Portrait Widescreen)")
        self.assertEqual(result["474"]["inputs"]["seed"], 42)
        self.assertEqual(result["474"]["inputs"]["control_after_generate"], "fixed")
        self.assertEqual(template["493"]["inputs"]["aspect_ratio"], "3:4 (Portrait Standard)")

    def test_video_uses_first_frame_and_five_seconds(self):
        template = json.loads((BRIDGE / "2_0_Image2Video_MinimaxH3_api.json").read_text())
        result = prepare_video(template, "keyframe.png", "walk toward camera", 5, 42, 480)

        self.assertEqual(result["7"]["inputs"]["image"], "keyframe.png")
        self.assertEqual(result["74"]["inputs"]["prompt"], "walk toward camera")
        self.assertEqual(result["71"]["inputs"]["value"], 5)
        self.assertEqual(result["9"]["inputs"]["scale_to_length"], 480)
        self.assertEqual(result["49"]["inputs"]["seed"], 42)


if __name__ == "__main__":
    unittest.main()
