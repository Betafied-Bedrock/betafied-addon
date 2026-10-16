import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
} from "../../scripts/lib/statistics.mjs";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-10-15T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

describe("Release download counts", () => {
  const releases = [
    { tag_name: "5.9", assets: [{ name: "Betafied_5.9.mcaddon", download_count: 3 }] },
    {
      tag_name: "5.8",
      assets: [
        { name: "Betafied_5.8.mcaddon", download_count: 44 },
        { name: "Betafied_5.8.mctemplate", download_count: 40 },
        { name: undefined, download_count: 5 }
      ]
    }
  ];

  it("keys every asset by the release that carries it", () => {
    assert.deepEqual(assetDownloadCounts(releases), {
      "5.9/Betafied_5.9.mcaddon": 3,
      "5.8/Betafied_5.8.mcaddon": 44,
      "5.8/Betafied_5.8.mctemplate": 40
    });
  });

  it("merges readings without losing an asset or lowering the all-time total", () => {
    const previous = { "5.8/Betafied_5.8.mctemplate": 40, "5.8/Betafied_5.8.mcaddon": 44 };
    const pruned = assetDownloadCounts([releases[0]]);

    const { counts, total } = mergeAssetCounts(previous, pruned);
    assert.equal(counts["5.8/Betafied_5.8.mctemplate"], 40, "a deleted asset keeps its downloads");
    assert.equal(total, 87, "an all-time total must never fall backwards, so it keeps all three assets");

    const stale = mergeAssetCounts({ "5.9/a.mcaddon": 12 }, { "5.9/a.mcaddon": 4 });
    assert.equal(stale.counts["5.9/a.mcaddon"], 12, "a lower reading never overwrites a higher one");

    const joined = mergeAssetCounts({ "5.9/a.mcaddon": 12 }, { "5.9/b.mcaddon": 5 });
    assert.equal(joined.total, 17, "a new asset joins the all-time total rather than replacing it");
  });
});

describe("The past-24-hours download delta", () => {
  const reading = (hoursAgo: number, total: number) => ({ at: NOW - hoursAgo * HOUR, total });

  it("measures against the newest reading at or before the cutoff, and reports nothing before one exists", () => {
    const history = [reading(30, 5000), reading(25, 5900), reading(5, 6180), reading(0, 6215)];

    assert.equal(downloadDelta(history, 6215, NOW), 315, "the 25-hour reading is the basis, not the 0-hour one");
    assert.equal(downloadDelta([reading(3, 6180), reading(1, 6200)], 6215, NOW), null);
    assert.equal(downloadDelta([], 6215, NOW), null);
    assert.equal(downloadDelta([reading(24, 6215)], 6215, NOW), 0, "an unchanged total is a reading of zero");
  });

  it("forgets readings older than the keep window, so a paused workflow reports nothing", () => {
    const history = historyWithReading(
      [reading(60, 4000), reading(48, 5000)],
      { at: NOW, total: 6215 },
      NOW
    );

    assert.deepEqual(history.map((entry: any) => entry.total), [6215]);
    assert.equal(downloadDelta(history, 6215, NOW), null, "a week-old reading is not a 24-hour window");
  });

  it("appends the new reading in order", () => {
    const history = historyWithReading(
      [reading(30, 5000), reading(2, 6200)],
      { at: NOW, total: 6215 },
      NOW
    );

    assert.deepEqual(history.map((entry: any) => entry.total), [5000, 6200, 6215]);
  });
});

describe("Cloudflare page views", () => {
  const response = (hourly: Array<[string, number]>, total: number) => ({
    data: {
      viewer: {
        zones: [
          {
            total: [{ count: total }],
            hourly: hourly.map(([datetimeHour, count]) => ({ count, dimensions: { datetimeHour } }))
          }
        ]
      }
    }
  });

  it("sums the requested window and only the buckets inside the last day", () => {
    const stats = pageViewStats(
      response(
        [
          ["2026-10-14T11:00:00Z", 500],
          ["2026-10-14T12:00:00Z", 7],
          ["2026-10-15T11:00:00Z", 3]
        ],
        12_480
      ),
      NOW
    );

    assert.deepEqual(stats, { total: 12_480, delta: 10, windowDays: 30 });
  });

  it("distinguishes a zone with no data from a window that simply had no requests", () => {
    assert.equal(pageViewStats({ data: { viewer: { zones: [] } } }, NOW), null);
    assert.equal(pageViewStats({ errors: [{ message: "nope" }] }, NOW), null);

    assert.deepEqual(pageViewStats(response([["2026-10-13T06:00:00Z", 20]], 900), NOW), {
      total: 900,
      delta: 0,
      windowDays: 30
    });
  });
});

describe("Discord payloads", () => {
  const stats = {
    updatedAt: iso(NOW),
    downloads: { total: 6215, delta: 137 },
    pageViews: { total: 12_480, delta: 320, windowDays: 30 }
  };

  it("shows all four figures in the statistics message", () => {
    const embed = statisticsPayload(stats).embeds[0];

    assert.equal(embed.fields[0].name, "Downloads");
    assert.ok(embed.fields[0].value.includes("**6,215** all time"));
    assert.ok(embed.fields[0].value.includes("**+137** past 24 hours"));
    assert.equal(embed.fields[1].name, "Website page views");
    assert.ok(embed.fields[1].value.includes("**12,480** the last 30 days"));
    assert.ok(embed.fields[1].value.includes("**+320** past 24 hours"));
    assert.equal(embed.timestamp, iso(NOW));
  });

  it("says what it does not know rather than printing a made-up figure", () => {
    const collecting = statisticsPayload({ ...stats, downloads: { total: 6215, delta: null } }).embeds[0];
    assert.ok(collecting.fields[0].value.includes("**6,215** all time"));
    assert.ok(collecting.fields[0].value.includes("collecting"));
    assert.ok(!collecting.fields[0].value.includes("NaN"));

    const untracked = statisticsPayload({ ...stats, pageViews: null }).embeds[0];
    assert.ok(untracked.fields[1].value.includes("Not tracked yet"));
    assert.ok(!untracked.fields[1].value.includes("0"), "no page views is not zero page views");
  });
});

describe("The release post", () => {
  const release = { tag: "5.9", downloads: 1470 };
  const buttons = (payload: any) => payload.components[0].components;

  it("announces the release behind one download button pointing at the site's downloads page", () => {
    const payload = releasePostPayload(release);
    const row = buttons(payload);

    assert.equal(row.length, 1, "the post links one destination, not the files of one release");
    assert.equal(row[0].url, "https://betafied.net/downloads/");
    assert.equal(row[0].style, 5, "a link button, the only kind a webhook can carry");
    assert.ok(payload.embeds[1].description.startsWith("## Betafied 5.9"));
    assert.ok(
      buttons(releasePostPayload({ ...release, tag: "5.10.1" }))[0].label.includes("5.10.1"),
      "the button carries the version of the post it is on"
    );
  });

  it("carries the live total and references the artwork by URL", () => {
    const payload = releasePostPayload(release);
    const embed = payload.embeds[1];

    assert.equal(embed.fields[0].name, "Downloads");
    assert.equal(embed.fields[0].value, "**1,470** all time");
    assert.deepEqual(
      payload.embeds.map((each: any) => each.image.url.match(/\/([^/?]+)\?/)?.[1]),
      ["Release.png", "RELICA_DIVIDER.png"],
      "the channel's artwork is referenced by URL, without uploading files with the message"
    );
  });
});

describe("Which message the release post lives in", () => {
  it("edits the mod's recorded post, and has nothing to edit on the first run", () => {
    const state = { release: { id: "1560259613851389983", tag: "5.9" } };

    assert.equal(
      releaseMessageToEdit(state),
      "1560259613851389983",
      "the release channel keeps one post per mod, so a new version updates it instead of adding a second"
    );
    assert.equal(releaseMessageToEdit({}), null, "which is what makes the first post get published");
    assert.equal(releaseMessageToEdit(undefined), null);
  });
});

describe("Webhook endpoints", () => {
  const url = "https://discord.com/api/webhooks/123/abc";

  it("normalises the stored URL into the post and edit endpoints Discord needs", () => {
    assert.equal(webhookPostUrl(url), `${url}?wait=true&with_components=true`);
    assert.equal(webhookPostUrl(`${url}?thread_id=9`), `${url}?thread_id=9&wait=true&with_components=true`);
    assert.equal(webhookMessageUrl(url, "456"), `${url}/messages/456?with_components=true`);
    assert.equal(webhookMessageUrl(`${url}?wait=true`, "456"), `${url}/messages/456?with_components=true`);
  });
});
