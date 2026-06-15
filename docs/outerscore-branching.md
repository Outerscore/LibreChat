# Branching & release strategy (Outerscore LibreChat fork)

How branches map to environments, and how to pull updates from the original LibreChat project.

## The key fact

This repo (`Outerscore/LibreChat`) is a **fork** of `danny-avila/LibreChat`. Its **`main`
branch is the fork itself** — i.e. essentially upstream LibreChat. Our product (the Outerscore
integration) is **not** on `main`; it lives on the product branches below.

Because of that, **`main` is an upstream-tracking branch, not a deploy branch.** We never
develop on it and never deploy it.

## Remotes

| Remote | Repo | Purpose |
|---|---|---|
| `origin` | `github.com/Outerscore/LibreChat` | our fork (where all our branches live) |
| `upstream` | `github.com/danny-avila/LibreChat` | the original project (source of LibreChat updates) |

One-time:
```bash
git remote add upstream https://github.com/danny-avila/LibreChat.git
```

## Branches

| Branch | Role | Deploys to | Notes |
|---|---|---|---|
| `main` | **upstream line** — mirrors LibreChat | — (never) | only receives `upstream`; keep our product code **off** it |
| `dev` | integration / test | **test** (auto) | features land here first |
| `staging` | pre-production | staging | add when a staging env exists |
| `master` | **production** | prod (gated) | only promoted, tested code |

## The flow

```
danny-avila/LibreChat ──(upstream)──►  main         (LibreChat updates land here, nothing else)
                                         │  merge main → dev (absorb upstream into the product)
                                         ▼
                      feature/* ──►     dev   ──►   staging   ──►   master
                                       (test)      (staging)      (PRODUCTION)
```

- **Everyday work:** branch off `dev`, open a PR into `dev`. Merging to `dev` auto-deploys test.
- **Releasing:** promote with PRs `dev → staging → master`. Merging to `master` deploys prod (gated).
- **LibreChat updates:** they go to `main`, then get merged **into `dev`** (never straight to `master`).

`git diff main dev` always shows exactly our fork's customizations.

## Environment / CI mapping

| Branch | Environment | Workflow | Trigger | Approval gate |
|---|---|---|---|---|
| `dev` | test | `deploy-test.yml` (exists) | push to `dev` (+ manual) | none — unattended |
| `staging` | staging | *(future)* | push to `staging` | optional |
| `master` | production | `deploy-prod.yml` *(future)* | push to `master` | **required reviewers** |

The prod pipeline mirrors test but uses its own `production` GitHub Environment with **separate
secrets** (prod domain, freshly generated `JWT`/`CREDS`/keys, prod Anthropic key, prod
`OUTERSCORE_TOKEN_KEY_URL`) and a **required-reviewer gate** so a human approves before prod
changes go live. See `docs/outerscore-test-deploy.md` for the test pipeline this is modelled on.

## Pulling LibreChat (upstream) updates

> **Do not use GitHub's "Sync fork" button.** It's meant for un-customized forks; on a fork as
> diverged as ours it makes a mess and targets the wrong branch. Pull manually:

```bash
git fetch upstream
git switch main
git merge upstream/main        # update main to the latest LibreChat (resolve conflicts if any)
git push origin main

git switch dev
git switch -c chore/sync-upstream
git merge main                 # bring the upstream changes into the product line
# resolve conflicts, push, open a PR into `dev`
```
The PR auto-deploys to test; verify there, then promote `dev → staging → master`. Upstream code
therefore reaches production only after the same review + test as any other change.

## One-time setup

Create the product branches from the branch that actually has the product
(`claude/adoring-hopper-odMVC` = `main` + the Outerscore integration):
```bash
git switch claude/adoring-hopper-odMVC
git switch -c dev    && git push -u origin dev
git switch -c staging && git push -u origin staging   # optional now
git switch -c master && git push -u origin master
# main stays as-is (the upstream line); add the upstream remote (see above)
```

### GitHub settings checklist
- **Default branch → `dev`.** Day-to-day PRs then target `dev`, the "Run workflow" button appears,
  and the repo homepage shows the current product. (Do **not** set it to `main` — features would
  default to merging into the upstream line.)
- **Branch protection** on `master` (required PR review, no direct pushes) and on `dev`. Protecting
  `master` also blocks an accidental "Sync fork" from ever reaching production.
- **Environments:** `test` with **no** required reviewers (so merges to `dev` deploy unattended);
  `production` **with** required reviewers (so merges to `master` wait for approval).
- Keep deploy/infra files (`deploy-test.yml`, `docker-compose.test.yml`, `librechat.test.yaml`, …)
  on the **product branches only** — not on `main` — so upstream merges don't conflict with our CI.

## FAQ / gotchas

- **"Why doesn't `main` have our code?"** By design — `main` mirrors LibreChat upstream. Our code
  lives on `dev`/`staging`/`master`.
- **"We have both `main` and `master`?"** Yes, with distinct roles: `main` = upstream mirror,
  `master` = our production. They are not interchangeable.
- **Never** deploy from `main`, develop on `main`, or merge a feature into `main`.
- **Never** merge `upstream` directly into `master` — always via `main → dev` first.
