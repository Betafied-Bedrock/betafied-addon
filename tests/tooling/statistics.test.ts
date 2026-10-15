import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assetDownloadCounts,
  downloadDelta,
  historyWithReading,
  mergeAssetCounts,
  pageViewStats,
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

  it("keeps an asset's last known count after a release deletes it", () => {
    const previous = { "5.8/Betafied_5.8.mctemplate": 40, "5.8/Betafied_5.8.mcaddon": 44 };
    const pruned = assetDownloadCounts([releases[0]]);

    const { counts, total } = mergeAssetCounts(previous, pruned);

    assert.equal(counts["5.8/Betafied_5.8.mctemplate"], 40, "the deleted template keeps its downloads");
    assert.equal(total, 87, "an all-time total must never fall backwards, so it keeps all three assets");
  });

  it("keeps the highest count it has seen for an asset", () => {
    const { counts } = mergeAssetCounts({ "5.9/a.mcaddon": 12 }, { "5.9/a.mcaddon": 4 });
    assert.equal(counts["5.9/a.mcaddon"], 12);
  });

  it("totals every asset it has ever seen, including brand new ones", () => {
    const { counts, total } = mergeAssetCounts({ "5.9/a.mcaddon": 12 }, { "5.9/b.mcaddon": 5 });
    assert.deepEqual(counts, { "5.9/a.mcaddon": 12, "5.9/b.mcaddon": 5 });
    assert.equal(total, 17);
  });
});

describe("The past-24-hours download delta", () => {
  const reading = (hoursAgo: number, total: number) => ({ at: NOW - hoursAgo * HOUR, total });

  it("measures against the newest reading at or before the 24-hour cutoff", () => {
    const history = [reading(30, 5000), reading(25, 5900), reading(5, 6180), reading(0, 6215)];

    assert.equal(downloadDelta(history, 6215, NOW), 315, "the 25-hour reading is the basis, not the 0-hour one");
  });

  it("reports nothing at all until a reading a day old exists", () => {
    assert.equal(downloadDelta([reading(3, 6180), reading(1, 6200)], 6215, NOW), null);
    assert.equal(downloadDelta([], 6215, NOW), null);
  });

  it("bases a delta of zero on an unchanged total rather than reporting nothing", () => {
    assert.equal(downloadDelta([reading(24, 6215)], 6215, NOW), 0);
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

  it("appends the new reading in order and stays bounded", () => {
    const history = historyWithReading(
      [reading(30, 5000), reading(2, 6200)],
      { at: NOW, total: 6215 },
      NOW
    );

    assert.deepEqual(history.map((entry: any) => entry.total), [5000, 6200, 6215]);
    assert.deepEqual(
      historyWithReading([], { at: NOW, total: 1 }, NOW, { max: 2 }).length,
      1
    );

    const many = Array.from({ length: 50 }, (_, index) => reading(index, index));
    assert.equal(historyWithReading(many, { at: NOW, total: 99 }, NOW, { max: 10 }).length, 10);
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

  it("returns null rather than zero when the zone has no data", () => {
    assert.equal(pageViewStats({ data: { viewer: { zones: [] } } }, NOW), null);
    assert.equal(pageViewStats({ data: { viewer: { zones: [{ hourly: [] }] } } }, NOW), null);
    assert.equal(pageViewStats({ errors: [{ message: "nope" }] }, NOW), null);
    assert.equal(pageViewStats(null, NOW), null);
  });

  it("counts a window with no recent requests as zero, which is a real reading", () => {
    const stats = pageViewStats(response([["2026-10-13T06:00:00Z", 20]], 900), NOW);
    assert.deepEqual(stats, { total: 900, delta: 0, windowDays: 30 });
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

  it("records that a window is still collecting rather than printing a made-up figure", () => {
    const embed = statisticsPayload({ ...stats, downloads: { total: 6215, delta: null } }).embeds[0];
    assert.ok(embed.fields[0].value.includes("**6,215** all time"));
    assert.ok(!embed.fields[0].value.includes("NaN"));
    assert.ok(embed.fields[0].value.includes("collecting"));
  });

  it("says page views are untracked instead of showing them as zero", () => {
    const embed = statisticsPayload({ ...stats, pageViews: null }).embeds[0];
    assert.ok(embed.fields[1].value.includes("Not tracked yet"));
    assert.ok(!embed.fields[1].value.includes("0"));
  });

});

describe("The release post", () => {
  const release = { tag: "5.9", downloads: 1470 };
  const buttons = (payload: any) => payload.components[0].components;

  it("offers one download button pointing at the site's downloads page", () => {
    const row = buttons(releasePostPayload(release));

    assert.equal(row.length, 1, "the post links one destination, not the files of one release");
    assert.equal(row[0].type, 2);
    assert.equal(row[0].label, "Download 5.9");
    assert.equal(row[0].url, "https://betafied.net/downloads/");
    assert.equal(row[0].style, 5, "a link button, the only kind a webhook can carry");
  });

  it("names the release it announces", () => {
    assert.ok(releasePostPayload(release).embeds[1].description.startsWith("## Betafied 5.9"));
    assert.ok(
      buttons(releasePostPayload({ ...release, tag: "5.10.1" }))[0].label.includes("5.10.1"),
      "the button carries the version of the post it is on"
    );
  });

  it("keeps the branding copy and carries the live total", () => {
    const embed = releasePostPayload(release).embeds[1];

    assert.ok(embed.description.includes("## Betafied"));
    assert.ok(embed.description.includes("> Betafied is a complete recreation of Minecraft Java Edition Beta 1.7.3"));
    assert.ok(embed.description.includes("*Available free for Windows, Android, and iOS"));
    assert.equal(embed.fields[0].name, "Downloads");
    assert.equal(embed.fields[0].value, "**1,470** all time");
    assert.equal(embed.title, undefined, "the channel's post carries no embed title");
    assert.equal(embed.footer, undefined);
    const images = releasePostPayload(release).embeds.map((embed: any) => embed.image.url);
    assert.deepEqual(
      images.map((url: string) => url.match(/\/([^/?]+)\?/)?.[1]),
      ["Release.png", "RELICA_DIVIDER.png"],
      "the channel's artwork is referenced by URL, without uploading files with the message"
    );
    for (const url of images) {
      assert.match(url, /^https:\/\//, "a URL rather than an attachment:// reference");
    }
  });

});

describe("Webhook endpoints", () => {
  const url = "https://discord.com/api/webhooks/123/abc";

  it("posts to the webhook itself, asking for the message back and the components honoured", () => {
    assert.equal(webhookPostUrl(url), `${url}?wait=true&with_components=true`);
    assert.equal(webhookPostUrl(`${url}?thread_id=9`), `${url}?thread_id=9&wait=true&with_components=true`);
  });

  it("edits the message this webhook posted earlier, asking for the components honoured", () => {
    assert.equal(webhookMessageUrl(url, "456"), `${url}/messages/456?with_components=true`);
    assert.equal(webhookMessageUrl(`${url}/`, "456"), `${url}/messages/456?with_components=true`);
    assert.equal(webhookMessageUrl(`${url}?wait=true`, "456"), `${url}/messages/456?with_components=true`);
  });
});
