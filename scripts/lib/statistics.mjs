/**
 * The derivations behind the Discord statistics message, kept pure and I/O-free like
 * `version.mjs`: the numbers are the deliverable, and a total that quietly falls backwards or a
 * "past 24 hours" figure with no day of history behind it are the failures this module exists to
 * make impossible. `scripts/statistics.mjs` only does the talking.
 */

const HOUR_MS = 3_600_000;

/** How long a reading stays in the history that the 24-hour delta is measured against. */
export const KEEP_HOURS = 30;

/** A history long enough for the delta and short enough that the state file stays small. */
export const MAX_READINGS = 72;

/** The website's own theme colour, so the card matches the site it reports on. */
const COLOR = 0x52bd56;

/**
 * The release post's artwork, referenced by URL.
 *
 * Uploading the files with the message renders them in the message body, outside the embeds, so
 * these point at the copies the channel already hosts. The signature Discord puts on a CDN link
 * expires about a day after it is minted, which is harmless for a message Discord renders itself —
 * it refreshes attachment URLs in the client — and fatal for anything outside Discord, so these are
 * for an embed and not for a mirror of the artwork. The file behind them lives in the message it
 * was uploaded with: deleting that takes the image with it.
 */
export const RELEASE_BANNER_URL =
  "https://media.discordapp.net/attachments/1558734093167099976/1558734483539365939/Release.png?ex=6ad1ca1c&is=6ad0789c&hm=15ab4c07c6ee6213e71554d331887898580c5568f255dc16bef8847f43d36017&=&format=webp&quality=lossless";
export const RELEASE_DIVIDER_URL =
  "https://media.discordapp.net/attachments/1558734093167099976/1558734724627832872/RELICA_DIVIDER.png?ex=6ad1ca56&is=6ad078d6&hm=2ad60e5903ece830b9405b181d1b53dd4b11af3fc0ae13ef400abf6650ca439c&=&format=webp&quality=lossless";

/**
 * Where a release post sends readers. The files a release ships are named differently from release
 * to release and the site's downloads page always lists the current ones, so the post links that one
 * stable destination instead of the assets of a single release.
 */
export const DOWNLOADS_URL = "https://betafied.net/downloads/";

/**
 * The copy the release channel posts under every release. It is branding, not release notes: the
 * notes live in the release body and on the changelog page, and repeating them here buried the
 * one line a reader comes for.
 */
const RELEASE_BLURB = [
  "> Betafied is a complete recreation of Minecraft Java Edition Beta 1.7.3 built for Minecraft Bedrock. It removes sprinting and hunger bars, bringing back classic terrain generation, original lighting, and authentic block placement.",
  "",
  "> Core mechanics match the 2011 experience: the food system is redone with instant eat-to-heal mechanics, armor and tool durability match Beta 1.7.3, and mob AI is tweaked to restore original behaviors.",
  "",
  "*Available free for Windows, Android, and iOS, with full support for dedicated multiplayer servers.*"
].join("\n");

/** `<tag>/<asset name>` -> downloads, from the GitHub releases payload. */
export function assetDownloadCounts(releases) {
  const counts = {};
  for (const release of releases ?? []) {
    if (!release?.tag_name) continue;
    for (const asset of release.assets ?? []) {
      if (!asset?.name) continue;
      counts[`${release.tag_name}/${asset.name}`] = Number(asset.download_count) || 0;
    }
  }
  return counts;
}

/**
 * The all-time counts and their total, merged with what previous runs saw.
 *
 * The releases API reports an asset only while it exists, and the release tooling deletes the
 * previous `.mctemplate` on every release — so summing what is currently published makes the
 * all-time total drop by hundreds the moment a release ships. Keeping the highest count seen per
 * asset is what makes the figure monotonic, and with it the 24-hour delta meaningful.
 */
export function mergeAssetCounts(previous = {}, current = {}) {
  const counts = { ...previous };
  for (const [key, value] of Object.entries(current)) {
    counts[key] = Math.max(Number(previous[key]) || 0, Number(value) || 0);
  }

  let total = 0;
  for (const value of Object.values(counts)) total += Number(value) || 0;
  return { counts, total };
}

/** The history with a new reading, still ordered, pruned of what the delta can no longer use. */
export function historyWithReading(history, reading, nowMs, options = {}) {
  const keepHours = options.keepHours ?? KEEP_HOURS;
  const max = options.max ?? MAX_READINGS;
  const cutoff = nowMs - keepHours * HOUR_MS;

  const kept = [...(history ?? []), reading]
    .filter((entry) => entry && Number.isFinite(entry.at) && entry.at >= cutoff && entry.at <= nowMs)
    .sort((left, right) => left.at - right.at);

  return kept.length > max ? kept.slice(-max) : kept;
}

/**
 * Downloads since `windowHours` before `nowMs`, or null when no reading reaches back that far.
 *
 * The basis is the newest reading at or before the cutoff rather than the nearest one on either
 * side: a reading from 20 hours ago would report a window it did not measure. The keep window in
 * `historyWithReading` is what bounds how stale a basis can be, and a run that has been paused
 * for days therefore reports nothing instead of relabelling a week as a day.
 */
export function downloadDelta(history, total, nowMs, windowHours = 24) {
  const cutoff = nowMs - windowHours * HOUR_MS;

  let basis = null;
  for (const entry of history ?? []) {
    if (!entry || !Number.isFinite(entry.at) || entry.at > cutoff) continue;
    if (basis === null || entry.at > basis.at) basis = entry;
  }
  if (basis === null) return null;

  return (Number(total) || 0) - (Number(basis.total) || 0);
}

/**
 * `{ total, delta, windowDays }` out of a Cloudflare GraphQL response, or null when the zone has
 * no data to report — an absent token, a revoked one and an empty window all read as "unknown"
 * rather than as a page view count of zero.
 *
 * The totals come from a query with no dimensions; the delta is summed from hourly buckets, and a
 * bucket carries the hour it starts, so the partial hour at the cutoff is left out.
 */
export function pageViewStats(response, nowMs, options = {}) {
  const windowDays = options.windowDays ?? 30;
  const zone = response?.data?.viewer?.zones?.[0];
  const total = zone?.total?.[0];
  if (!zone || !total) return null;

  const cutoff = nowMs - 24 * HOUR_MS;
  let delta = 0;
  for (const bucket of zone.hourly ?? []) {
    const at = Date.parse(bucket?.dimensions?.datetimeHour ?? "");
    if (!Number.isFinite(at) || at < cutoff) continue;
    delta += Number(bucket.count) || 0;
  }

  return { total: Number(total.count) || 0, delta, windowDays };
}

/** `6215` -> `6,215`. */
function formatCount(value) {
  return (Number(value) || 0).toLocaleString("en-US");
}

function deltaLine(delta, within = "past 24 hours") {
  if (delta === null || delta === undefined) {
    return `*${within.charAt(0).toUpperCase()}${within.slice(1)}: still collecting*`;
  }
  return `**+${formatCount(delta)}** ${within}`;
}

/**
 * The message a channel keeps: four figures, one card, edited in place rather than re-posted.
 */
export function statisticsPayload(stats) {
  const downloads = stats.downloads ?? { total: 0, delta: null };
  const pageViews = stats.pageViews;

  const embed = {
    title: "Betafied Statistics",
    color: COLOR,
    fields: [
      {
        name: "Downloads",
        value: `**${formatCount(downloads.total)}** all time\n${deltaLine(downloads.delta)}`,
        inline: true
      },
      {
        name: "Website page views",
        value: pageViews
          ? `**${formatCount(pageViews.total)}** the last ${pageViews.windowDays ?? 30} days\n${deltaLine(pageViews.delta)}`
          : "*Not tracked yet*",
        inline: true
      }
    ],
    footer: { text: "Updated" }
  };

  const updated = Date.parse(stats.updatedAt);
  if (Number.isFinite(updated)) embed.timestamp = new Date(updated).toISOString();

  return { embeds: [embed] };
}

/**
 * The message a mod's release post lives in: the one the state records, on every run.
 *
 * The release channel keeps one post per mod, so a release that announces a version newer than the
 * recorded one still edits that post — its heading and button carry the newest version, and the
 * total beside the button is what the hourly refresh keeps current. Only having nothing to edit, on
 * the first run or after a post Discord no longer has, is what makes a run publish a new one.
 */
export function releaseMessageToEdit(messages) {
  return messages?.release?.id ?? null;
}

/**
 * The release post: the branding copy headed by the version, one download button labelled with it,
 * and the standing download total.
 *
 * The total is what makes this payload shared rather than the release workflow's own: the same
 * message is refreshed by the hourly statistics run so the figure beside the button stays live, and
 * two builders would drift the moment either changed.
 *
 * The button has to be a link button, which Discord always renders in the secondary style: a
 * coloured button carries a `custom_id` and sends an interaction the receiving app must answer, and
 * a webhook has nowhere to answer it.
 *
 * Neither `username` nor `avatar_url` is set, so the post renders with the name and icon configured
 * on the webhook itself instead of a GitHub identity.
 */
export function releasePostPayload({ tag, downloads = 0 }) {
  return {
    embeds: [
      { color: null, image: { url: RELEASE_BANNER_URL } },
      {
        description: `## Betafied ${tag}\n${RELEASE_BLURB}`,
        color: null,
        fields: [{ name: "Downloads", value: `**${formatCount(downloads)}** all time`, inline: false }],
        image: { url: RELEASE_DIVIDER_URL }
      }
    ],
    components: [{ type: 1, components: [{ type: 2, style: 5, label: `Download ${tag}`, url: DOWNLOADS_URL }] }]
  };
}

/**
 * Posting asks for the message back, so the id to edit later comes from the same call.
 *
 * `with_components=true` is not decoration: without it Discord answers 200 and drops the components
 * from the request, so a release post arrives with no download button and nothing reports a failure.
 */
export function webhookPostUrl(webhookUrl) {
  const url = String(webhookUrl).replace(/\/+$/, "");
  return url.includes("?") ? `${url}&wait=true&with_components=true` : `${url}?wait=true&with_components=true`;
}

/**
 * A webhook may only edit the messages it posted itself, and the flag is required here too: an edit
 * without it leaves whatever components the message already carries in place, so a changed button
 * silently never lands.
 */
export function webhookMessageUrl(webhookUrl, messageId) {
  return `${String(webhookUrl).split("?")[0].replace(/\/+$/, "")}/messages/${messageId}?with_components=true`;
}
