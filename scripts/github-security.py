"""Check/enable free GitHub public-repository security features; never publish."""
import argparse
import json
import re
import subprocess

DEFAULT_REPO = "AnhAnAsian/jev-codex-hermes"


class GitHubError(RuntimeError):
    pass


def github_api(endpoint, method="GET", payload=None):
    args = ["gh", "api", endpoint, "--method", method,
            "--header", "Accept: application/vnd.github+json"]
    if payload is not None:
        args.extend(["--input", "-"])
    try:
        result = subprocess.run(
            args, input=json.dumps(payload) if payload is not None else None,
            capture_output=True, text=True, timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise GitHubError("GitHub request unavailable; check gh login and network.") from None
    if result.returncode:
        # Do not print raw CLI errors, environment, account data or headers.
        raise GitHubError("GitHub request failed; check repository access and feature availability.")
    if not result.stdout.strip():
        return {}
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        raise GitHubError("GitHub returned an unexpected response.") from None


def configure_security(repo=DEFAULT_REPO, apply=False, api=github_api):
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
        raise ValueError("Use an owner/repository name.")
    endpoint = f"repos/{repo}"
    metadata = api(endpoint)
    if not isinstance(metadata, dict) or not isinstance(metadata.get("private"), bool):
        raise GitHubError("GitHub repository visibility could not be verified.")
    if metadata["private"]:
        return {
            "repository": repo, "private": True, "ready": False,
            "changed": False, "state": "pending-publication",
            "message": "No settings changed. Enable these features after an explicitly approved public release.",
        }
    permissions = metadata.get("permissions") or {}
    if apply and permissions.get("admin") is not True:
        raise GitHubError("Repository admin access is required to apply security settings.")
    analysis = metadata.get("security_and_analysis") or {}
    required = ("secret_scanning", "secret_scanning_push_protection")
    private_reporting = api(endpoint + "/private-vulnerability-reporting")
    changed = False
    if apply:
        pending = {name: {"status": "enabled"} for name in required
                   if (analysis.get(name) or {}).get("status") != "enabled"}
        if pending:
            # Only free public-repo protections: never visibility or advanced_security.
            api(endpoint, "PATCH", {"security_and_analysis": pending})
            changed = True
        if private_reporting.get("enabled") is not True:
            api(endpoint + "/private-vulnerability-reporting", "PUT")
            changed = True
        metadata = api(endpoint)
        if metadata.get("private") is not False:
            raise GitHubError("Visibility changed elsewhere; verify repository security manually.")
        analysis = metadata.get("security_and_analysis") or {}
        private_reporting = api(endpoint + "/private-vulnerability-reporting")
    checks = {name: (analysis.get(name) or {}).get("status") == "enabled"
              for name in required}
    checks["private_vulnerability_reporting"] = private_reporting.get("enabled") is True
    return {
        "repository": repo, "private": False, "ready": all(checks.values()),
        "changed": changed, "state": "verified" if all(checks.values()) else "incomplete",
        "checks": checks,
        "reporting_url": f"https://github.com/{repo}/security/advisories/new",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=DEFAULT_REPO)
    parser.add_argument("--apply", action="store_true",
                        help="Enable free protections only if the repo is already public.")
    args = parser.parse_args()
    try:
        result = configure_security(args.repo, args.apply)
    except (GitHubError, ValueError) as error:
        print(json.dumps({"ready": False, "error": str(error)}))
        return 1
    print(json.dumps(result, indent=2))
    return 0 if result["ready"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
