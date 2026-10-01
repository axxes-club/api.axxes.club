# Google Cloud production delivery

Production source branch: `deploy/gcp` in `axxes-club/api.axxes.club`. Pushes to this branch run the `GCP production` workflow. Main and other branches do not deploy. GitHub manual dispatch requires the workflow on the default branch; this configuration remains on `deploy/gcp`, so use production pushes until an approved integration makes manual dispatch available.

GitHub only checks out source and exchanges its OIDC identity for short-lived credentials. Google Cloud Build performs Linux image builds, configured unit tests/type checks, image publication, staged readiness checks and deployment. No service-account keys, PATs or Vercel deploy hooks are used. Actions are pinned to commit IDs.

Build identity `cb-api` is scoped to `api` Cloud Run service, its runtime account, isolated `ci-api` image repository and source bucket. No build secrets are needed for this runtime image; secrets remain mounted only by the existing runtime identity. Submit identity `gh-api` may submit/get builds, upload source and act as this build identity. Federation accepts only this immutable GitHub repository ID and `deploy/gcp` push/manual events.

Images are tagged with the full Git commit SHA and unique Google build ID and deployed by immutable digest. The release changes the image only and preserves runtime settings, secrets and IAM. It first stages a tagged revision with no traffic, probes its root for a 2xx/3xx response, then promotes it and probes the ordinary service URL. Redirect probes reject missing locations, insecure absolute URLs and local/private IP destinations. A failed post-deployment probe restores the previous revision. Existing traffic splits block automatic promotion for an explicit rollout decision. These root probes establish HTTP availability; authentication, payment, upload and database integration checks remain separate release evidence.

Checks in addition to Linux production image build: no unit test/typecheck script exists in this source; Linux image build and HTTP readiness run.

Build logs: https://console.cloud.google.com/cloud-build/builds;region=global?project=gravy-meta

BuildKit mounts the production dotenv only during Next compilation; it is excluded from COPY and removed from standalone output before final-image COPY. Every image is exported and all layers are inspected before publication. The gate rejects dotenv files (including files deleted by later layers) and matches private build-secret values without logging them; public NEXT_PUBLIC values are intentionally allowed. Test containers receive only a synthetic AUTH_SECRET and never production dotenv credentials.

Google Cloud Build uses the global build pool; Cloud Run, source buckets and image registries remain in us-west1. The regional build pool allowed only one highcpu8 job, so global capacity avoids long production queues. GitHub jobs allow60minutes and poll for55minutes; failures, cancellation signals or polling deadline cancel unfinished remote builds instead of leaving queued deployments detached. The submit identity includes build cancellation permission for this lifecycle.
