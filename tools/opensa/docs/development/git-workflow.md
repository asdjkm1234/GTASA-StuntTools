# Git workflow traps

Short file, one subject: the git states in this repo that look healthy and are not. Everything here has
cost real work at least once.

## A detached HEAD is invisible in `git status`

`git bisect` leaves you on a detached HEAD, and so does checking out a commit, a tag or a submodule
revision. That state is not an error and nothing about it looks wrong:

- `git status` reports a clean working tree;
- edits, `git add` and `git commit` all succeed and print a normal commit hash;
- the diff, the tests and the build behave exactly as they would on a branch.

The commits are simply not on any branch. Ending the bisect, checking out a branch, or letting `git gc`
run eventually strands them — and because the tree was clean the whole time, nothing warned about it.
**This has already happened here once: six commits were orphaned and only found because the branch tip
did not match what had been committed.**

### The check

After **any** bisect, tag checkout or "let me just look at that old commit", verify where HEAD points
before doing anything else:

```sh
git rev-parse HEAD
git rev-parse main          # or whichever branch you believe you are on
git symbolic-ref -q HEAD || echo "DETACHED HEAD — you are not on a branch"
```

`git status` alone is not the check — its first line does say `HEAD detached at …`, but it says it above
a clean-tree report that reads as "everything is fine", which is exactly why it gets skipped.

### If you already committed on a detached HEAD

Nothing is lost until garbage collection runs. Recover by naming the commits before leaving the state:

```sh
git branch rescue-<name>    # from the detached HEAD, names the tip so it cannot be collected
git bisect reset            # only after the branch exists
```

If you have already left it, `git reflog` still lists the abandoned tip — find it there and branch from
the hash.

## Bisecting this repo

`git bisect` is worth it here (the pak pipeline and the engine both have "it looked right three commits
ago" classes of bug), so the rule is not "avoid bisect" — it is "end every bisect with the HEAD check
above".
