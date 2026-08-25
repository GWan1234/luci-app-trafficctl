#!/bin/bash
# Tests the release-notes generator in .github/workflows/auto-release.yml.
#
# format_section() is EXTRACTED FROM THE WORKFLOW and executed verbatim against
# a throwaway git repository built here, so the commits it formats are real
# commits reached through the same `git log` the workflow runs. Keeping a copy
# of the awk program in this file is what let the scope bug ship: the program
# was correct as written and only broke in how the regex reached awk.
#
# Runs the section under EVERY awk on the box (gawk, mawk, busybox awk, the
# default /usr/bin/awk). The bug this guards against was invisible on mawk and
# BSD awk and only appeared on gawk, which is what the GitHub runners use — a
# single-interpreter test would have reported success.

PASS=0
FAIL=0

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WF="$REPO_ROOT/.github/workflows/auto-release.yml"

if [ ! -f "$WF" ]; then
    echo "FAIL: cannot find auto-release.yml at $WF"
    exit 1
fi

# The closing brace is matched at the function's own indentation. A looser
# "first line that is just a brace" would stop inside the awk program, whose
# blocks close at deeper indents, and silently yield a truncated function.
FUNC_INDENT=$(sed -n 's/^\( *\)format_section() {.*/\1/p' "$WF" | head -1)
# `close` is an awk built-in, so the variable cannot be named that.
FUNC_SRC=$(awk -v endre="^${FUNC_INDENT}}\$" \
    '/^ *format_section\(\) \{/ { f = 1 }
     f { print }
     (f == 1) && ($0 ~ endre) { exit }' "$WF")

if [ -z "$FUNC_SRC" ] ||
    ! printf '%s\n' "$FUNC_SRC" | grep -q 'git log' ||
    ! printf '%s\n' "$FUNC_SRC" | grep -qF 'printed >= 6'; then
    echo "FAIL: could not extract a complete format_section() from $WF."
    echo "Expected the git log pipeline and the body-line printf. Got:"
    printf '%s\n' "$FUNC_SRC"
    exit 1
fi

# Discover the awk implementations available, so a missing one is reported
# rather than silently reducing coverage.
AWKS=""
for cand in gawk mawk awk; do
    command -v "$cand" >/dev/null 2>&1 && AWKS="$AWKS $cand"
done
if command -v busybox >/dev/null 2>&1 && busybox awk 'BEGIN{}' 2>/dev/null; then
    AWKS="$AWKS busybox-awk"
fi

echo "awk implementations under test:$AWKS"
for a in $AWKS; do
    case "$a" in
        busybox-awk) printf '  %-12s %s\n' "busybox" "$(busybox awk --help 2>&1 | head -1)" ;;
        *) printf '  %-12s %s\n' "$a" "$($a --version 2>&1 | head -1 || $a -W version 2>&1 | head -1)" ;;
    esac
done
if ! printf '%s' "$AWKS" | grep -q gawk; then
    echo
    echo "WARNING: gawk is NOT installed here, and gawk is the only awk that"
    echo "exhibited the escape-sequence bug this file exists to catch. These"
    echo "results do NOT prove the fix; CI runs on gawk and is authoritative."
fi
echo

# ── Build a real repository with the commit shapes that matter ──────────────
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

(
    cd "$TMP" || exit 1
    git init -q .
    git config user.email t@example.com
    git config user.name Test
    git config commit.gpgsign false
    git commit -q --allow-empty -m "chore: baseline"
    git tag v0.0.1

    git commit -q --allow-empty -m "fix(shaper): allocate classids"
    git commit -q --allow-empty -m "fix(fw): match comments in full"
    git commit -q --allow-empty -m "fix: unscoped fix"
    git commit -q --allow-empty -m "feat(ui): add a graph"
    git commit -q --allow-empty -m "feat: plain feature"
    git commit -q --allow-empty -m "perf(metrics): cache the list"
    git commit -q --allow-empty -m "refactor(fw): split helpers"
    git commit -q --allow-empty -m "ci: pin the action"
    git commit -q --allow-empty -m "docs: not released"
    # Must NOT be picked up as fixes — "fix" is a prefix of both.
    git commit -q --allow-empty -m "fixup: not a fix commit"
    git commit -q --allow-empty -m "fixes: also not a fix commit"
    # The type must be matched at the START of the subject only: a subject that
    # merely contains "fix:" later on is a different commit, not a bug fix.
    git commit -q --allow-empty -m "chore: revert the fix: rollback of a thing"
    # Body handling: lead paragraph is kept, trailers dropped. The trailer sits
    # directly against the lead paragraph so the trailer rule is what has to
    # drop it — with a blank line first, the end-of-paragraph rule would stop
    # output regardless and the trailer rule would never be exercised.
    git commit -q --allow-empty -m "fix(rpcd): constrain the log path

The path was unvalidated.
Second line of the lead paragraph.
Co-Authored-By: Someone <s@example.com>
Signed-off-by: Someone <s@example.com>

A later paragraph that must not appear."
) || { echo "FAIL: could not build the fixture repository"; exit 1; }

# Run one section with one awk implementation, from inside the fixture repo.
run_section() {
    local impl="$1" type_regex="$2" shim="$TMP/shim"
    mkdir -p "$shim"
    case "$impl" in
        busybox-awk) printf '#!/bin/sh\nexec busybox awk "$@"\n' > "$shim/awk" ;;
        *) printf '#!/bin/sh\nexec %s "$@"\n' "$(command -v "$impl")" > "$shim/awk" ;;
    esac
    chmod +x "$shim/awk"
    (
        cd "$TMP" || exit 1
        PATH="$shim:$PATH"
        # shellcheck disable=SC2034  # both are read by the eval'd function
        RANGE="v0.0.1..HEAD"
        # shellcheck disable=SC2034
        REPO="owner/repo"
        eval "$FUNC_SRC"
        format_section "$type_regex" 2>/dev/null
    )
}

assert_contains() {
    local desc="$1" needle="$2" haystack="$3"
    if printf '%s' "$haystack" | grep -qF -- "$needle"; then
        PASS=$((PASS + 1))
    else
        FAIL=$((FAIL + 1))
        printf "FAIL: %s\n  expected to find: '%s'\n  in:\n%s\n\n" "$desc" "$needle" "$haystack"
    fi
}

assert_not_contains() {
    local desc="$1" needle="$2" haystack="$3"
    if printf '%s' "$haystack" | grep -qF -- "$needle"; then
        FAIL=$((FAIL + 1))
        printf "FAIL: %s\n  did NOT expect: '%s'\n  in:\n%s\n\n" "$desc" "$needle" "$haystack"
    else
        PASS=$((PASS + 1))
    fi
}

assert_count() {
    local desc="$1" expected="$2" haystack="$3" actual
    actual=$(printf '%s' "$haystack" | grep -c '^- ')
    if [ "$expected" = "$actual" ]; then
        PASS=$((PASS + 1))
    else
        FAIL=$((FAIL + 1))
        printf "FAIL: %s\n  expected %s bullets, got %s\n  in:\n%s\n\n" "$desc" "$expected" "$actual" "$haystack"
    fi
}

for impl in $AWKS; do
    echo "── $impl ──"

    FIXES=$(run_section "$impl" "fix")

    # Would have failed before: the scope group became mandatory-literal, so
    # every scoped fix vanished from the section.
    assert_contains "$impl: scoped fix(shaper) appears" "allocate classids" "$FIXES"
    assert_contains "$impl: scoped fix(fw) appears" "match comments in full" "$FIXES"
    assert_contains "$impl: scoped fix(rpcd) appears" "constrain the log path" "$FIXES"
    assert_contains "$impl: unscoped fix appears" "unscoped fix" "$FIXES"

    # The scope must be stripped, not left in the bullet text.
    assert_not_contains "$impl: scope prefix stripped from the bullet" "fix(shaper):" "$FIXES"
    assert_not_contains "$impl: bare type prefix stripped" "- fix:" "$FIXES"

    # Would have failed before: with `(` literal-and-optional, "fixup:" and
    # "fixes:" satisfied the pattern and were reported as bug fixes.
    assert_not_contains "$impl: fixup: is not a fix" "not a fix commit" "$FIXES"
    assert_not_contains "$impl: fixes: is not a fix" "also not a fix commit" "$FIXES"

    # Other types must not leak into the fix section.
    assert_not_contains "$impl: feat does not leak into fixes" "add a graph" "$FIXES"
    assert_not_contains "$impl: docs does not leak into fixes" "not released" "$FIXES"
    # Would have failed before: an unanchored type match would pull in a chore
    # whose subject merely contains "fix:" further along.
    assert_not_contains "$impl: type matched only at subject start" "rollback of a thing" "$FIXES"
    assert_count "$impl: fix section has exactly 4 bullets" 4 "$FIXES"

    FEATS=$(run_section "$impl" "feat")
    assert_contains "$impl: scoped feat(ui) appears" "add a graph" "$FEATS"
    assert_contains "$impl: unscoped feat appears" "plain feature" "$FEATS"
    assert_count "$impl: feat section has exactly 2 bullets" 2 "$FEATS"

    PERF=$(run_section "$impl" "perf")
    assert_contains "$impl: scoped perf(metrics) appears" "cache the list" "$PERF"
    assert_count "$impl: perf section has exactly 1 bullet" 1 "$PERF"

    # The Other section is an alternation, so it exercises the scope group
    # sitting after a group rather than after a literal type name.
    OTHER=$(run_section "$impl" "(refactor|ci)")
    assert_contains "$impl: scoped refactor(fw) appears in Other" "split helpers" "$OTHER"
    assert_contains "$impl: unscoped ci appears in Other" "pin the action" "$OTHER"
    assert_count "$impl: other section has exactly 2 bullets" 2 "$OTHER"

    # Body handling.
    assert_contains "$impl: lead paragraph is included" "The path was unvalidated." "$FIXES"
    assert_contains "$impl: full lead paragraph is included" "Second line of the lead paragraph." "$FIXES"
    assert_not_contains "$impl: later paragraphs are dropped" "A later paragraph" "$FIXES"
    assert_not_contains "$impl: Co-Authored-By trailer dropped" "Co-Authored-By" "$FIXES"
    assert_not_contains "$impl: Signed-off-by trailer dropped" "Signed-off-by" "$FIXES"

    # Commit links.
    assert_contains "$impl: bullets link to the commit" "https://github.com/owner/repo/commit/" "$FIXES"
done

printf "\n%d passed, %d failed\n" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
