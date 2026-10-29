import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("deploys: netlify.toml skips the build unless something the agent runs on changed", () => {
  const toml = readFileSync(new URL("../netlify.toml", import.meta.url), "utf8");
  const ignore = (toml.match(/^\s*ignore\s*=\s*"([^"]+)"/m) || [])[1] || "";
  assert.match(ignore, /git diff --quiet \$CACHED_COMMIT_REF \$COMMIT_REF/, "a build is skipped when nothing relevant changed");
  for (const dir of ["lib", "netlify", "package.json", "package-lock.json", "netlify.toml"]) assert.ok(ignore.split(" -- ")[1].split(/\s+/).includes(dir), `${dir} still triggers a deploy`);
  for (const never of ["test", "docs", "CLAUDE.md", "README.md", "wati-templates.json"]) assert.ok(!ignore.split(" -- ")[1].split(/\s+/).includes(never), `${never} must not trigger a deploy`);
});
