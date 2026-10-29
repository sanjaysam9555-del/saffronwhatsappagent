#!/bin/sh
# Once per clone: turns on the git hooks in .githooks/ (the working rules, enforced).
git config core.hooksPath .githooks && echo "hooks on"
