/**
 * Worker secrets, declared here rather than in worker-configuration.d.ts.
 *
 * `npm run cf-typegen` regenerates worker-configuration.d.ts from wrangler.jsonc on every
 * type-check, and secrets are (correctly) not in wrangler.jsonc — so an edit there is
 * overwritten. This ambient declaration merges into the generated `Cloudflare.Env` and
 * survives regeneration.
 *
 * Both are OPTIONAL because the server is designed to run without them: the keyless
 * EPO Linked Open Data tier (`/lod/*`) answers with no credential, and every OPS path
 * fails with an actionable MISSING_CREDENTIALS error instead of a silent empty result.
 * Set them with:
 *   cd servers/patentsview-mcp-server && npx wrangler secret put EPO_OPS_KEY
 *   cd servers/patentsview-mcp-server && npx wrangler secret put EPO_OPS_SECRET
 * Register the free developer app at https://developers.epo.org/user/register.
 */
declare namespace Cloudflare {
	interface Env {
		/** EPO OPS OAuth2 Consumer Key. */
		EPO_OPS_KEY?: string;
		/** EPO OPS OAuth2 Consumer Secret. */
		EPO_OPS_SECRET?: string;
	}
}
