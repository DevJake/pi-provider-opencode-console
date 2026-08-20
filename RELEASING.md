# Releasing

Releases are managed by Changesets and `.github/workflows/release.yml`.

## One-time npm setup

If `pi-provider-opencode-console` does not exist on npm yet, an owner must bootstrap `0.1.0` once from a trusted local checkout with `npm publish --access public`. A trusted publisher is configured from an existing package's npm settings.

Then configure the package's npm trusted publisher with:

- Organization or user: `grikomsn`
- Repository: `pi-provider-opencode-console`
- Workflow filename: `release.yml`
- Environment: leave blank
- Allowed action: `npm publish`

No long-lived `NPM_TOKEN` is used by GitHub Actions. The release job runs on a GitHub-hosted runner, receives `id-token: write`, uses npm 11.5.1 or newer, and publishes with provenance.

## Release flow

1. Add a changeset to each user-visible pull request with `npm run changeset`.
2. Changesets maintains a `chore: version package` pull request against `main`.
3. Merge that pull request.
4. The release workflow validates the package and runs `npm publish --access public --provenance` through npm trusted publishing.
5. The workflow creates the matching `v<version>` GitHub release.

After the bootstrap publish and trusted-publisher setup, run the release workflow once to create the matching `v0.1.0` GitHub release. Subsequent releases should go through the Changesets version pull request.
