import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "src-tauri/tauri.conf.json"


class NsisDataChoiceTests(unittest.TestCase):
    def test_silent_delete_flag_is_connected_without_hardcoded_data_path(self):
        config = json.loads(CONFIG.read_text(encoding="utf-8"))
        relative_hook = config["bundle"]["windows"]["nsis"]["installerHooks"]
        hook_path = CONFIG.parent / relative_hook
        hook = hook_path.read_text(encoding="utf-8")

        self.assertIn("NSIS_HOOK_PREUNINSTALL", hook)
        self.assertIn("NSIS_HOOK_POSTUNINSTALL", hook)
        self.assertIn('"/DELETEAPPDATA"', hook)
        self.assertIn("StrCpy $DeleteAppDataCheckboxState 1", hook)
        self.assertIn("selected-ai-provider.${BUNDLEID}.provider", hook)
        self.assertIn("selected-stt-provider.${BUNDLEID}.provider", hook)
        self.assertIn("$UpdateMode <> 1", hook)
        self.assertNotIn("com.aditajpatil.veil", hook)
        self.assertNotIn("RmDir", hook)


if __name__ == "__main__":
    unittest.main()
