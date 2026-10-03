import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "github_security", Path(__file__).resolve().parents[1] / "scripts/github-security.py"
)
security = importlib.util.module_from_spec(spec)
spec.loader.exec_module(security)


class FakeGitHub:
    def __init__(self, private=False, ready=False, admin=True):
        self.metadata = {
            "private": private, "permissions": {"admin": admin},
            "security_and_analysis": {
                name: {"status": "enabled" if ready else "disabled"}
                for name in ("secret_scanning", "secret_scanning_push_protection")
            },
        }
        self.reporting = ready
        self.calls = []

    def __call__(self, endpoint, method="GET", payload=None):
        self.calls.append((endpoint, method, copy.deepcopy(payload)))
        if endpoint.endswith("/private-vulnerability-reporting"):
            if method == "PUT":
                self.reporting = True
            return {"enabled": self.reporting}
        if method == "PATCH":
            self.metadata["security_and_analysis"].update(payload["security_and_analysis"])
        return copy.deepcopy(self.metadata)


class GitHubSecurityTests(unittest.TestCase):
    def test_private_apply_is_read_only_and_never_publishes(self):
        api = FakeGitHub(private=True)
        result = security.configure_security(apply=True, api=api)
        self.assertEqual(result["state"], "pending-publication")
        self.assertFalse(result["changed"])
        self.assertEqual(len(api.calls), 1)
        self.assertTrue(all(method == "GET" for _, method, _ in api.calls))

    def test_check_reports_incomplete_without_mutation(self):
        api = FakeGitHub()
        result = security.configure_security(api=api)
        self.assertFalse(result["ready"])
        self.assertFalse(result["changed"])
        self.assertTrue(all(method == "GET" for _, method, _ in api.calls))

    def test_apply_enables_only_requested_features_and_verifies(self):
        api = FakeGitHub()
        result = security.configure_security(apply=True, api=api)
        self.assertTrue(result["ready"])
        writes = [(method, payload) for _, method, payload in api.calls if method != "GET"]
        self.assertEqual(writes, [
            ("PATCH", {"security_and_analysis": {
                "secret_scanning": {"status": "enabled"},
                "secret_scanning_push_protection": {"status": "enabled"},
            }}), ("PUT", None),
        ])

    def test_already_ready_apply_is_idempotent(self):
        api = FakeGitHub(ready=True)
        result = security.configure_security(apply=True, api=api)
        self.assertTrue(result["ready"])
        self.assertFalse(result["changed"])
        self.assertTrue(all(method == "GET" for _, method, _ in api.calls))

    def test_no_admin_cannot_apply_and_missing_visibility_is_rejected(self):
        api = FakeGitHub(admin=False)
        with self.assertRaises(security.GitHubError):
            security.configure_security(apply=True, api=api)
        self.assertTrue(all(method == "GET" for _, method, _ in api.calls))
        with self.assertRaises(security.GitHubError):
            security.configure_security(api=lambda *_: {})


if __name__ == "__main__":
    unittest.main()
