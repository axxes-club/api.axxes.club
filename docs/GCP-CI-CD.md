# Google Cloud production delivery

Production source branch: `deploy/gcp` in `axxes-club/api.axxes.club`. Pushes to this branch run the `GCP production` workflow. Main and other branches do not deploy. Manual runs must select `deploy/gcp`.

GitHub only checks out source and exchanges its OIDC identity for short-lived credentials. Google Cloud Build performs Linux compilation, configured unit tests/type checks, image publication, staged readiness checks and deployment. No service-account keys, PATs or Vercel deploy hooks are used. Actions are pinned to commit IDs.

Build identity `cb-api` is scoped to `api` Cloud Run service, its runtime account, isolated `ci-api` image repository and source bucket. It reads only api-env from Secret Manager. Submit identity `gh-api` may submit/get builds, upload source and act as this build identity. Federation accepts only this immutable GitHub repository ID and `deploy/gcp` push/manual events.

Images are tagged with the full Git commit SHA and unique Google build ID and deployed by immutable digest. The release changes the image only and preserves runtime settings, secrets and IAM. It first stages a tagged revision with no traffic, probes its root for a 2xx/3xx response, then promotes it and probes the ordinary service URL. A failed post-deployment probe restores the previous revision. Existing traffic splits block automatic promotion for an explicit rollout decision. These root probes establish HTTP availability; authentication, payment, upload and database integration checks remain separate release evidence.

Checks in addition to Linux production compilation: no unit test/typecheck script exists in this source; compilation and HTTP readiness run.

Build logs: https://console.cloud.google.com/cloud-build/builds;region=us-west1?project=gravy-meta
