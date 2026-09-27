"""Contract checks for the ComfyUI API workflows used by Kelvoy."""

import json
import unittest
from pathlib import Path


BRIDGE = Path(__file__).resolve().parents[2] / "comfyui-bridge"


class ImageToVideoWorkflowTest(unittest.TestCase):
    def test_api_workflow_uses_direct_vae_links(self):
        workflow = json.loads((BRIDGE / "2_0_Image2Video_MinimaxH3_api.json").read_text())

        self.assertFalse(
            {node["class_type"] for node in workflow.values()} & {"GetNode", "SetNode"}
        )
        self.assertEqual(workflow["74"]["inputs"]["vae"], ["84", 0])
        self.assertEqual(workflow["74"]["inputs"]["clip"], ["87", 0])
        self.assertEqual(workflow["49"]["inputs"]["model"], ["90", 0])
        self.assertEqual(workflow["90"]["inputs"]["model"], ["100", 0])
        self.assertNotIn("101", workflow)
        self.assertEqual(workflow["37"]["inputs"]["vae"], ["84", 0])
        self.assertEqual(workflow["38"]["inputs"]["vae"], ["88", 0])
        self.assertNotIn("Anything Everywhere", {node["class_type"] for node in workflow.values()})


if __name__ == "__main__":
    unittest.main()
