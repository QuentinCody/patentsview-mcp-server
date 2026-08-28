#!/usr/bin/env node
// interlinked-tdd: exempt
//
// Behaviour gates for the two-tier EPO server.
//
// These are not string-matching smoke checks: each case exercises the real function and
// fails if the behaviour regresses. The live section talks to the real keyless upstream
// (https://data.epo.org/linked-data/query) and asserts a real bound value, so it cannot be
// satisfied by an empty or synthesized response. Run offline-only with SKIP_LIVE=1.

import {
	assertEpoOpsCredentials,
	epoOpsFetch,
	hasEpoOpsCredentials,
	missingEpoOpsCredentials,
} from "../src/lib/http.ts";
import { lodSparql } from "../src/lib/lod.ts";
import {
	buildApplicantSearchQuery,
	buildLodQuery,
	buildPublicationQuery,
	buildTitleSearchQuery,
	clampLodLimit,
	escapeSparqlLiteral,
	normalizeAuthority,
	normalizePublicationNumber,
	resolveLodRoute,
} from "../src/lib/lod-queries.ts";

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const BLUE = "\x1b[34m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

let passed = 0;
let failed = 0;

function ok(condition, name, detail) {
	if (condition) {
		console.log(`${GREEN}OK${RESET} ${name}`);
		passed++;
	} else {
		console.log(`${RED}FAIL${RESET} ${name}`);
		if (detail !== undefined) console.log(`  ${detail}`);
		failed++;
	}
}

async function throwsWith(fn, predicate, name) {
	try {
		await fn();
	} catch (error) {
		ok(predicate(error), name, `threw: ${error?.message}`);
		return;
	}
	ok(false, name, "did NOT throw");
}

console.log(`${BLUE}EPO patent server — behaviour regression${RESET}`);

// ---------------------------------------------------------------------------
// 1. Missing-credential path: detected BEFORE the token fetch, never swallowed.
// ---------------------------------------------------------------------------

ok(
	JSON.stringify(missingEpoOpsCredentials({})) ===
		JSON.stringify(["EPO_OPS_KEY", "EPO_OPS_SECRET"]),
	"missingEpoOpsCredentials names both env vars when neither is set",
);
ok(
	JSON.stringify(missingEpoOpsCredentials({ EPO_OPS_KEY: "k", EPO_OPS_SECRET: "   " })) ===
		JSON.stringify(["EPO_OPS_SECRET"]),
	"a blank secret counts as missing, not as present",
);
ok(
	hasEpoOpsCredentials({ EPO_OPS_KEY: "k", EPO_OPS_SECRET: "s" }) === true &&
		hasEpoOpsCredentials(undefined) === false,
	"hasEpoOpsCredentials is true only when both secrets are non-blank",
);

await throwsWith(
	() => assertEpoOpsCredentials({ EPO_OPS_KEY: "", EPO_OPS_SECRET: "" }),
	(error) =>
		error.code === "MISSING_CREDENTIALS" &&
		error.message.includes("EPO_OPS_KEY") &&
		error.message.includes("EPO_OPS_SECRET") &&
		error.message.includes("https://developers.epo.org/user/register") &&
		error.message.includes("wrangler secret put") &&
		error.message.includes("/lod/") &&
		Array.isArray(error.data?.setup_commands) &&
		error.data.setup_commands.length === 2,
	"assertEpoOpsCredentials throws a structured error naming both vars, the registration URL, the wrangler commands and the keyless tier",
);

// The gate that matters: no credentials must fail BEFORE any network call, and must fail
// as an error. A resolved value here would mean an OPS call silently succeeded with nothing.
{
	const realFetch = globalThis.fetch;
	let calls = 0;
	globalThis.fetch = async (...args) => {
		calls++;
		return realFetch(...args);
	};
	let rejected = false;
	try {
		await epoOpsFetch("/published-data/publication/epodoc/EP1000000/biblio", {
			EPO_OPS_KEY: "",
			EPO_OPS_SECRET: "",
		});
	} catch (error) {
		rejected = error?.code === "MISSING_CREDENTIALS";
	} finally {
		globalThis.fetch = realFetch;
	}
	ok(rejected, "epoOpsFetch without credentials rejects (it is never downgraded to a result)");
	ok(calls === 0, "epoOpsFetch without credentials makes ZERO network calls", `calls=${calls}`);
}

// ---------------------------------------------------------------------------
// 2. SPARQL literal safety — a caller-supplied value cannot escape the query.
// ---------------------------------------------------------------------------

ok(escapeSparqlLiteral('a"b') === 'a\\"b', "escapeSparqlLiteral escapes a double quote");
ok(escapeSparqlLiteral("a\\b") === "a\\\\b", "escapeSparqlLiteral escapes a backslash");
await throwsWith(
	() => escapeSparqlLiteral("a\u0007b"),
	(error) => error.message.includes("control character"),
	"escapeSparqlLiteral rejects control characters",
);

await throwsWith(
	() => normalizePublicationNumber('1000000" } UNION { ?x ?y ?z '),
	(error) => error.message.includes("Invalid publication number"),
	"a publication number carrying a SPARQL breakout is rejected",
);
await throwsWith(
	() => normalizeAuthority("EP> ?s ?p ?o"),
	(error) => error.message.includes("Invalid authority"),
	"an authority carrying an IRI breakout is rejected",
);
ok(normalizeAuthority("ep") === "EP", "authority codes are uppercased");

{
	const query = buildApplicantSearchQuery({ name: 'Acme " . } # co', match: "exact" });
	ok(
		query.includes('"Acme \\" . } # co"'),
		"an applicant name containing a quote is escaped inside the literal",
		query.split("\n").find((line) => line.includes("Acme")),
	);
	ok(
		!/vcard:fn "Acme " \. \} #/.test(query),
		"the escaped applicant name does not terminate the literal early",
	);
}

ok(clampLodLimit(99999, 25, 200) === 200, "clampLodLimit clamps to the maximum");
ok(clampLodLimit("not-a-number", 25, 200) === 25, "clampLodLimit falls back on a bad value");
ok(clampLodLimit(-4, 25, 200) === 1, "clampLodLimit floors at 1");

await throwsWith(
	() => buildTitleSearchQuery({ text: "ab" }),
	(error) => error.message.includes("3 characters"),
	"a 2-character title search is refused rather than scanning the whole graph",
);

// ---------------------------------------------------------------------------
// 3. Tier routing — /lod/* is keyless, everything else goes to credentialed OPS.
// ---------------------------------------------------------------------------

ok(
	resolveLodRoute("/published-data/publication/epodoc/EP1000000/biblio") === null,
	"an OPS path is NOT routed to the keyless tier",
);
ok(
	resolveLodRoute("/lod/publication/EP/1000000") === "/publication/EP/1000000",
	"an /lod path is routed to the keyless tier",
);

{
	const query = buildLodQuery("/publication/EP/1000000", {});
	ok(
		query.includes('patent:publicationNumber "1000000"') &&
			query.includes("id/st3/EP"),
		"the publication route binds both the number and the authority",
	);
}
ok(
	buildLodQuery("/publication/EP/1000000/citations", {}).includes("citesPatentPublication"),
	"the citations route queries the citation predicate",
);
ok(
	buildLodQuery("/publication/EP/1000000/application", {}).includes("patent:application"),
	"the application route queries the application link",
);
await throwsWith(
	() => buildLodQuery("/query", {}),
	(error) => error.message.includes("SPARQL SELECT"),
	"/lod/query without a query param is refused",
);
await throwsWith(
	() => buildLodQuery("/not-a-route", {}),
	(error) => error.message.includes("Unknown EPO Linked Open Data route"),
	"an unknown /lod route names the routes that do exist",
);

for (const route of [
	"/publication/EP/1000000/citations",
	"/publication/EP/1000000/application",
	"/search/title",
	"/search/applicant",
]) {
	const params = route.includes("title")
		? { text: "graphene" }
		: route.includes("applicant")
			? { name: "Novartis AG" }
			: {};
	ok(
		/LIMIT \d+$/.test(buildLodQuery(route, params).trim()),
		`every curated query is bounded by a LIMIT (${route})`,
	);
}

// ---------------------------------------------------------------------------
// 4. LIVE — the keyless upstream really answers, and its coverage gap is real.
// ---------------------------------------------------------------------------

if (process.env.SKIP_LIVE === "1") {
	console.log(`${YELLOW}SKIP${RESET} live EPO Linked Open Data checks (SKIP_LIVE=1)`);
} else {
	const EP_TITLE = "Apparatus for manufacturing green bricks for the brick manufacturing industry";

	const ep = await lodSparql(buildPublicationQuery({ authority: "EP", number: "1000000" }));
	const epRows = ep.results.bindings;
	ok(epRows.length > 0, "live: EP1000000 returns rows from data.epo.org with no credential");
	ok(
		epRows.some((row) => row.property?.value === "title" && row.value?.value === EP_TITLE),
		"live: EP1000000 carries its real English title",
		`titles seen: ${epRows
			.filter((row) => row.property?.value === "title")
			.map((row) => row.value?.value)
			.join(" | ")}`,
	);
	ok(
		epRows.some((row) => row.property?.value === "abstract") &&
			epRows.some((row) => row.property?.value === "applicant"),
		"live: an EP record carries an abstract and an applicant",
	);

	const us = await lodSparql(buildPublicationQuery({ authority: "US", number: "5507996" }));
	const usProperties = new Set(us.results.bindings.map((row) => row.property?.value));
	ok(us.results.bindings.length > 0, "live: a US publication node exists in EPO LOD");
	ok(
		!usProperties.has("title") && !usProperties.has("abstract"),
		"live: the documented gap is real — a US node has NO title and NO abstract",
		`US properties: ${[...usProperties].join(", ")}`,
	);

	await throwsWith(
		() => lodSparql("SELECT ?s WHERE { ?s ?p"),
		(error) => error.status === 400,
		"live: a rejected SPARQL query throws, it is never returned as an empty result set",
	);
}

console.log(`\n${BLUE}Results${RESET}  passed=${passed} failed=${failed}`);
if (failed > 0) {
	console.log(`${RED}Regression tests failed.${RESET}`);
	process.exit(1);
}
console.log(`${GREEN}All EPO patent server regression tests passed.${RESET}`);
