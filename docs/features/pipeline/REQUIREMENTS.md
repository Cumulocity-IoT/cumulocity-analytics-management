# CI pipeline integration: requirements and findings

**Status: planned. Checked against the repository on 2026-10-29.** None of the three phases has started: the repository has no compliance workflow, no SBOM generation, no Helm chart, and no build descriptor. The statements about external repositories (`c8y-component-base`, the UI team's `compliance.yml`, `microservice-deployer`, the CICD guides) come from the earlier research and were not checked again.

## Goal

Integrate this solution into the Cumulocity CI/CD pipeline:

- UI: `analytics-ui` (Angular, Cumulocity UI plugin)
- Microservice: `analytics-service` (Python)

## Background

The work follows this order:

1. **Compliance first.** Complete the compliance checks.
2. **Helm charts.** Before onboarding, build Helm charts that upload the microservice and the UI plugin to a tenant. Use [microservice-deployer](https://github.com/Cumulocity-IoT/microservice-deployer) as the starting point.
3. **Pipeline onboarding.** Contact the CICD team to onboard the component to the pipeline.

References:

- General instructions and reusable actions for all components: [c8y-component-base](https://github.com/Cumulocity-IoT/c8y-component-base)
- Compliance example from the UI team: [compliance.yml](https://github.com/Cumulocity-IoT/cumulocity-ui/blob/develop/.github/workflows/compliance.yml)

## Current state of this repo

- `.github/workflows/build-release.yml`: runs on `v*` tags and on manual dispatch. The UI job syncs `package.json` with the tag, then runs lint, unit tests, and the build (Node.js 22). The service job runs the `pytest` tests (Python 3.12) and `analytics-service/build.sh`. A release job attaches `c8y-pkg-analytics-extension-<version>.zip` and `analytics-ext-service.zip` to the GitHub release; tags with a suffix, such as `v2.8.0-rc.1`, become pre-releases. Tags are created by hand.
- `.github/workflows/check-push.yml`: runs on pushes to `main` and on pull requests. It checks spelling (`typos`), runs UI lint, naming rules, and tests, and runs the service tests.
- `.releaserc.json`: a semantic-release configuration. No workflow runs semantic-release, so it does not drive versioning today.
- `analytics-service/Dockerfile`: starts from `public.ecr.aws/apama/apama-builder`, pinned by digest, installs Python packages pinned in `requirements.txt`, and runs as the unprivileged `apama` user.
- Missing: compliance workflow, SBOM generation, Helm chart (`helm/` does not exist), build descriptor.

## Findings from the referenced repos

### Compliance (UI team's `compliance.yml`)

A reusable workflow (`workflow_call`) with inputs `version`, `repackage-apps` and `repackage-repository-connect`. It takes the secrets `C8Y_TPSAFE_API_KEY` and `C8Y_TPSAFE_RULES_APP_PRIVATE_KEY`, and the org variable `C8Y_TPSAFE_CONFIG`. It runs on custom runners (`runs-on=<run_id>-compliance`, `runner=default`).

Steps, using `Cumulocity-IoT/c8y-component-base/.github/actions/compliance/<action>@compliance-v3`:

1. `third-party-compliance-setup`: needs `component-name` and `build-id` (the version).
2. Download the SBOM artifacts `sbom-<version>-*` (CycloneDX JSON, produced by the build jobs).
3. `third-party-upload`: uploads the BOM files (`.tmp/*-sbom.json`).
4. `third-party-licensing-check`: use `dry-run` while developing, for example with the PR label `tp-request-skip`.
5. `third-party-release-sbom`: publishes the build.
   - `dry-run` is true on PRs.
   - `publish-cloud-release` is true only for Cloud/CD releases.
   - `idata-version: 0~Cloud` is for Cloud/CD releases only.
6. Create a `LICENSE` file from the third-party licenses URL text and upload it as an artifact.
7. Repackage the app zips (and repository-connect zips) with `LICENSE`, `SBOM.json` and the third-party licenses file, then re-upload them.

### Pipeline framework (`c8y-component-base` guides)

A team must integrate three points:

1. Build and publish artifacts, and update the build descriptor.
2. PostMerge test job.
3. Staging test job.

Preparatory tasks (CICD team):

1. Review the build descriptor with the CICD team.
2. Get Harbor credentials for images and charts (CD Jira ticket).
3. For ZIP/RPM artifacts:
   - Create an SSH user via a PR against `c8y_user_keys`.
   - Request the `staging-resources` folder structure (CD Jira ticket).
4. Create the `<GA>.x/PostMerge-<component>-Ready` branch and its branch protection.
5. Create two CI test jobs (GitHub Actions or Jenkins).

Release stage:

- Tag the source snapshot, build, then bump the version.
- Publish zips to `staging-resources.cumulocity.com` under `sag/{component}/{version}/`:
  - `kubernetes-images/{artifact}.zip` for microservices
  - `webapps/{artifact}.zip` for webapps
- Publish Docker images to `registry.stage.c8y.io/{component}/{artifact}:{version}`.
- Publish Helm charts to `https://registry.stage.c8y.io/chartrepo/{component}`.
- Update `products/{component}` in `c8y-iot-build-pipeline` (build descriptor) on the `Ready` branch.
- Versioning: `{GA}.{minor}.{patch}`, such as `10.20.0.0`.

Test stages:

- PostMerge: automatic, roughly every 4 hours. Black-box functional tests run against a provisioned test tenant.
- Staging: e2e, smoke and contract tests against the full staging platform.

### Deployer (`microservice-deployer`)

- A Docker image built on `@c8y/toolkit`. The repo has a `chart/` directory to use as the Helm starting point.
- It uploads microservices (`--microservices`), webapps (`--applications`) and UI plugins (`--ui-plugins`) to a tenant.
- Required arguments: `--hostname`, `--username`, `--password`, `--resource-base-url`.
- Useful options:
  - `--tag-ui-plugins` and `--rolling-tag-ui-plugins`
  - `--install-ui-plugins <plugin>:<app1,app2>`
  - `--ui-plugins-availability`
  - `--revert`
  - `--skipSubscription`
- One download source per run.
- Since v6, the plugin name comes from `cumulocity.json`, not the file name.

## Plan

### Phase 1: Compliance

1. Generate a CycloneDX SBOM for the UI (npm, `package-lock.json`) and for the microservice (pip, `requirements.txt`). Upload them as `sbom-<version>-*` artifacts. Add both steps to `build-release.yml`.
2. Add `compliance.yml`, modelled on the UI team's workflow, with `component-name` set for this solution.
3. Repackage the plugin zip and the microservice zip with `LICENSE`, `SBOM.json` and the third-party licenses file.
4. Verify org secrets, variables and runner access. Test with `dry-run`, then enable it.

### Phase 2: Helm chart

1. Start from the `chart/` directory of `microservice-deployer`.
2. Configure the chart to deploy the microservice zip and the UI plugin zip (tags, install to apps).
3. Publish the chart and images to Harbor.

### Phase 3: Pipeline onboarding

1. Write the build descriptor and review it with the CICD team.
2. Request Harbor access, `staging-resources` and SSH access (CD Jira).
3. Create the PostMerge `Ready` branch with branch protection.
4. Extend the release workflow: publish artifacts, images and chart, and update the build descriptor.
5. Add PostMerge and Staging test jobs.

## Open questions

1. One component or two? One compliance run and one chart for both?
2. Which GA version? Does `{GA}.{minor}.{patch}` replace the current semver tags (the latest is `v2.8.2`, and `package.json` is at `3.0.0`)?
3. Is the delivery target Kubernetes-hosted Cumulocity (staging-resources zips plus Helm), or only the deployer chart?
4. Is this repo the one to onboard? Are the org secrets, variables and custom runners available to it?
5. Is compliance needed for the Docker base image OS packages? Which base image does the Dockerfile use?
6. Where should the chart live: this repo (`helm/`) or a separate repo? Is a rollback (`--revert`) path needed?
7. Are there black-box functional or e2e tests for PostMerge and Staging?
8. Has the CICD team been contacted, and is there a CD Jira ticket?

## Answers (interactive Q&A)

| # | Question | Answer |
|---|----------|--------|
| 1 | One component or two? | One component: one compliance run, one chart, one build descriptor |
| 2 | Versioning | SAG `{GA}.{minor}.{patch}`. Release type is Cloud/CD (`0~Cloud`), so no fixed GA branch. Confirm the version prefix and the branch naming with the CICD team. |
| 3 | Delivery target | Not sure. Clarify with the CICD team; plan for both zips and the chart. |
| 4 | Org access and CICD contact | Both done |
| 5 | Base image OS packages in compliance | Yes. Include the microservice Docker image (`alpine-packages-from-docker-image`, or the equivalent for the actual base image). |
| 6 | Chart location | This repo, in `helm/` |
| 7 | Functional/e2e tests | None. Black-box tests for PostMerge and Staging must be created. |
| 8 | CICD team contacted | Yes |

Consequences:

- `publish-cloud-release: true` and `idata-version: 0~Cloud` apply in the compliance workflow.
- The compliance workflow needs an extra SBOM step for the Docker image packages.
- The Helm chart goes in `helm/`.
- Test authoring is a separate work item and the largest unknown.

## Still open

- Delivery target (K8s-hosted with staging-resources zips plus Helm, or the deployer chart only).
- Exact version prefix for Cloud/CD.
- The matching compliance option for the base image. The base image is `public.ecr.aws/apama/apama-builder`, pinned by digest. It installs `git` and `libcap` with `dnf`, `yum`, `apt-get`, or `apk`, whichever the image provides. Confirm which package manager the image uses before choosing between `alpine-packages-from-docker-image` and an equivalent action.

## Suggested first step

Build the SBOM and compliance workflow (Phase 1). No open question blocks it.
