// One build identity for every capture pipeline (design review v3 §3.7): the
// design audit and the e2e matrix load the same extension directory and stamp
// their reports with the same commit, so the atlas can state it once for both.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

/** The extension to load: FLUXCATCH_EXTENSION_DIR (a packaged copy), else the source tree. */
export function extensionDir(root) {
  return process.env.FLUXCATCH_EXTENSION_DIR ? path.resolve(process.env.FLUXCATCH_EXTENSION_DIR) : path.join(root, "extension");
}

/** The source commit as a report states it: the short hash of HEAD, "uncommitted"
 *  while the worktree carries changes, "not-a-git-repository" outside git. */
export function sourceCommit(root) {
  const probe = spawnSync("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  if (probe.error) throw new Error(`git is required to identify the build: ${probe.error.message}`);
  if (probe.status !== 0) {
    const details = `${probe.stderr || ""}${probe.stdout || ""}`.trim();
    if (probe.status === 128 && !fs.existsSync(path.join(root, ".git"))) return "not-a-git-repository";
    throw new Error(`failed to identify the git worktree: ${details || `exit ${probe.status}`}`);
  }
  const status = spawnSync("git", ["-C", root, "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" });
  if (status.error) throw new Error(`failed to read the worktree status: ${status.error.message}`);
  if (status.status !== 0) throw new Error(`failed to read the worktree status: ${(status.stderr || "").trim() || `exit ${status.status}`}`);
  if (status.stdout.trim()) return "uncommitted";
  const revision = spawnSync("git", ["-C", root, "rev-parse", "--short=12", "HEAD"], { encoding: "utf8" });
  if (revision.error) throw new Error(`failed to identify the commit: ${revision.error.message}`);
  const commit = revision.stdout.trim();
  if (revision.status !== 0 || !/^[a-f0-9]{12}$/i.test(commit)) {
    throw new Error(`failed to identify the commit: ${(revision.stderr || "").trim() || commit || `exit ${revision.status}`}`);
  }
  return commit;
}

/** What a report states about the build it captured. */
export function buildIdentity(root) {
  const dir = extensionDir(root);
  return { commit: sourceCommit(root), extensionDir: path.relative(root, dir) || ".", packaged: Boolean(process.env.FLUXCATCH_EXTENSION_DIR) };
}
