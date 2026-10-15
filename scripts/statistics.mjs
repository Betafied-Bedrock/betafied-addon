#!/usr/bin/env node
/**
 * Publish the statistics card and the release post to Discord.
 *
 * Both are edited in place rather than re-posted, because a scheduled run that posts a fresh
 * message every hour is a channel nobody reads — and because the release post carries the standing
 * download total, which is only worth showing while it stays current. That refresh is why this
 * script owns the release post too, instead of the release workflow building it in shell: one
 * payload, one builder, and the figure beside the download button keeps moving.
 *
 *   npm run stats
 *   npm run stats -- --dry-run
 *   npm run stats -- --release 5.9        # what the release workflow runs
 *
 * Which Discord message is which, and the readings the deltas need, live on a `stats` branch and
 * never on the working branch. The webhook secrets, `CLOUDFLARE_API_TOKEN` and
 * `CLOUDFLARE_ZONE_ID` come from the environment (or `.env`, which the release tooling loads the
 * same way); page views are skipped, not zeroed, when the Cloudflare pair is absent.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./lib/env.mjs";
import {
  assetDownloadCounts,
  downloadDelta,
  historyWithReading,
  mergeAssetCounts,
  pageViewStats,
  releaseMessageToEdit,
  releasePostPayload,
  statisticsPayload,
  webhookMessageUrl,
  webhookPostUrl
} from "./lib/statistics.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Pinned for the same reason `release.mjs` pins it: this checkout carries remotes whose org names
// the project has moved on from, and GitHub resolves the old ones by redirect.
const REPO = process.env.GH_REPO ?? "relica-studios/betafied";
const STATE_BRANCH = "stats";
const STATE_FILE = "stats.json";
const WEBSITE_HOST = "betafied.net";
const PAGE_VIEW_WINDOW_DAYS = 30;

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const RELEASE_TAG = args.includes("--release") ? args[args.indexOf("--release") + 1] ?? null : null;
if (args.includes("--release") && !RELEASE_TAG) {
  console.error("statistics: --release needs a tag");
  process.exit(1);
}

/**
 * Page views as Cloudflare's edge saw them: the site ships no analytics beacon, so an HTML response
 * is the closest thing to a page load the platform can count. Bots and reloads are included and a
 * cached 304 revalidation carries no content type to match on, which makes this an approximation
 * of the page-view figure rather than a measurement of it.
 */
const PAGE_VIEW_QUERY = `query PageViews($zone: string, $host: string, $window: Time, $since: Time, $until: Time) {
  viewer {
    zones(filter: { zoneTag: $zone }) {
      total: httpRequestsAdaptiveGroups(limit: 1, filter: { datetime_geq: $window, datetime_lt: $until, clientRequestHTTPHost: $host, edgeResponseContentTypeName: "html", requestSource: "eyeball" }) { count }
      hourly: httpRequestsAdaptiveGroups(limit: 200, filter: { datetime_geq: $since, datetime_lt: $until, clientRequestHTTPHost: $host, edgeResponseContentTypeName: "html", requestSource: "eyeball" }) { count dimensions { datetimeHour } }
    }
  }
}`;

function fail(message) {
  console.error(`statistics: ${message}`);
  process.exit(1);
}

/**
 * `gh`, with its stderr captured rather than inherited: the calls that probe for state the first
 * run has not written yet are expected to 404, and a CLI error on the branch that gets swallowed
 * reads like a broken workflow in the log.
 */
function gh(ghArgs) {
  try {
    return execFileSync("gh", ghArgs, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GH_REPO: REPO },
      maxBuffer: 32 * 1024 * 1024
    });
  } catch (err) {
    throw new Error(`gh ${ghArgs.join(" ")}: ${String(err.stderr ?? "").trim() || err.message}`);
  }
}

/** Whether a `gh` failure means "nothing is there yet" rather than "this call was refused". */
function isMissing(err) {
  return /HTTP 404/.test(err.message);
}

/**
 * The state as it sits on the `stats` branch, with the blob sha needed to replace it.
 *
 * A missing branch or file is not an error: the first run has nothing to read and creates both.
 */
function readState() {
  try {
    const file = JSON.parse(gh(["api", `repos/${REPO}/contents/${STATE_FILE}?ref=${STATE_BRANCH}`]));
    return { state: JSON.parse(Buffer.from(file.content, "base64").toString("utf8")), sha: file.sha };
  } catch (err) {
    if (!isMissing(err)) throw err;
    return { state: {}, sha: null };
  }
}

/** Create the `stats` branch from the default branch's tip, so the first run has somewhere to write. */
function ensureStateBranch() {
  try {
    gh(["api", `repos/${REPO}/git/ref/heads/${STATE_BRANCH}`]);
    return;
  } catch (err) {
    if (!isMissing(err)) throw err;
    // Absent, which is the normal first-run case.
  }
  const head = gh(["api", `repos/${REPO}/commits/HEAD`, "--jq", ".sha"]).trim();
  gh(["api", "--method", "POST", `repos/${REPO}/git/refs`, "-f", `ref=refs/heads/${STATE_BRANCH}`, "-f", `sha=${head}`]);
  console.log(`statistics: created the ${STATE_BRANCH} branch for the accumulated readings`);
}

function writeState(state, sha) {
  ensureStateBranch();
  const ghArgs = [
    "api",
    "--method",
    "PUT",
    `repos/${REPO}/contents/${STATE_FILE}`,
    "-f",
    `message=chore(stats): readings for ${state.updatedAt}`,
    "-f",
    `content=${Buffer.from(`${JSON.stringify(state, null, 2)}\n`).toString("base64")}`,
    "-f",
    `branch=${STATE_BRANCH}`
  ];
  if (sha) ghArgs.push("-f", `sha=${sha}`);
  gh(ghArgs);
}

/** Every published asset's download count, by release. */
function releaseAssetCounts() {
  const releases = JSON.parse(gh(["api", "--paginate", "--slurp", `repos/${REPO}/releases?per_page=100`])).flat();
  return assetDownloadCounts(releases);
}

async function fetchPageViews(env, nowMs) {
  const token = env.CLOUDFLARE_API_TOKEN;
  const zone = env.CLOUDFLARE_ZONE_ID;
  if (!token || !zone) return null;

  const iso = (ms) => new Date(ms).toISOString();
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      query: PAGE_VIEW_QUERY,
      variables: {
        zone,
        host: WEBSITE_HOST,
        window: iso(nowMs - PAGE_VIEW_WINDOW_DAYS * 24 * 3_600_000),
        since: iso(nowMs - 26 * 3_600_000),
        until: iso(nowMs)
      }
    })
  });

  const body = await response.json().catch(() => null);
  if (!response.ok || body?.errors?.length) {
    console.warn(`statistics: Cloudflare page views unavailable: ${body?.errors?.[0]?.message ?? response.status}`);
    return null;
  }
  return pageViewStats(body, nowMs, { windowDays: PAGE_VIEW_WINDOW_DAYS });
}

/**
 * Every message here is a JSON body: the artwork is referenced by URL, so nothing is uploaded and
 * there is no multipart path to keep in step with it.
 */
const bodyFor = (payload) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });

/**
 * Edit the message this webhook posted last time, or post one when there is none or it is gone.
 * Returns the id to remember.
 */
async function publish(webhookUrl, messageId, payload, label) {
  if (!webhookUrl) throw new Error(`${label}: no webhook secret is configured`);

  if (messageId) {
    // The message's attachments are declared empty because a post published by an earlier version of
    // this script still carries the artwork as uploads, and an edit that omits the field leaves them
    // listed — rendering the images in the message body beside the embed rather than inside it.
    const edited = await fetch(webhookMessageUrl(webhookUrl, messageId), {
      method: "PATCH",
      ...bodyFor({ ...payload, attachments: [] })
    });
    if (edited.ok) {
      console.log(`statistics: updated the ${label} message ${messageId}`);
      return messageId;
    }
    // A deleted message is the one failure worth recovering from by hand: repost rather than exit.
    if (edited.status !== 404) {
      throw new Error(`${label}: editing message ${messageId} failed with ${edited.status} ${await edited.text()}`);
    }
    console.warn(`statistics: the ${label} message ${messageId} is gone; posting a new one`);
  }

  const posted = await fetch(webhookPostUrl(webhookUrl), { method: "POST", ...bodyFor(payload) });
  if (!posted.ok) {
    throw new Error(`${label}: posting failed with ${posted.status} ${await posted.text()}`);
  }
  const message = await posted.json();
  console.log(`statistics: posted the ${label} message ${message.id}`);
  return message.id;
}

async function main() {
  const env = loadEnv(ROOT);

  const now = Date.now();
  const { state, sha } = readState();
  const messages = { ...state.messages };

  const { counts, total } = mergeAssetCounts(state.downloads?.assetCounts ?? {}, releaseAssetCounts());
  const history = historyWithReading(state.downloads?.history ?? [], { at: now, total }, now);
  const stats = {
    updatedAt: new Date(now).toISOString(),
    downloads: { total, delta: downloadDelta(history, total, now) },
    pageViews: await fetchPageViews(env, now)
  };

  // The release channel keeps one post per mod, so a new tag relabels the message the state
  // records rather than adding a second one, and the hourly run refreshes that same message.
  const releaseTag = RELEASE_TAG ?? messages.release?.tag ?? null;
  const release = releaseTag ? { tag: releaseTag, payload: releasePostPayload({ tag: releaseTag, downloads: total }) } : null;
  const releaseMessageId = releaseMessageToEdit(messages);

  if (DRY_RUN) {
    console.log(`statistics: dry run, ${total} downloads, page views ${stats.pageViews ? "read" : "unavailable"}`);
    console.log(
      JSON.stringify({ statistics: RELEASE_TAG ? null : statisticsPayload(stats), release: release?.payload ?? null }, null, 2)
    );
    return;
  }

  const failures = [];
  if (!RELEASE_TAG) {
    try {
      messages.statistics = await publish(
        env.STATISTICS_WEBHOOK,
        messages.statistics,
        statisticsPayload(stats),
        "statistics"
      );
    } catch (err) {
      failures.push(err.message);
    }
  }
  if (release) {
    try {
      messages.release = {
        id: await publish(env.RELEASE_WEBHOOK, releaseMessageId, release.payload, `release post (${release.tag})`),
        tag: release.tag
      };
    } catch (err) {
      failures.push(err.message);
    }
  }

  // The readings are written even when Discord refused a message: they are real data, and losing the
  // message ids would mean posting a second post over the one that is already there.
  writeState({ version: 1, updatedAt: stats.updatedAt, downloads: { assetCounts: counts, history }, messages }, sha);
  console.log(
    `statistics: ${total} downloads, 24h ${stats.downloads.delta ?? "unmeasured"}${release ? `, release post ${release.tag}` : ""}`
  );

  if (failures.length > 0) fail(failures.join("; "));
}

main().catch((err) => fail(err.message));
