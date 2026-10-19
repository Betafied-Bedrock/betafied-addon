<p align="center">
  <a href="https://betafied.net">
    <img src="https://betafied.net/images/betafied-logo-320.webp" alt="Betafied Logo" width="420" />
  </a>
</p>
<p align="center">
  <strong>A love letter to Minecraft Beta 1.7.3, rebuilt for Bedrock Edition.</strong>
</p>

<p align="center">
  <em>Back when the grass was green, the sky was blue, and Creepers were your worst nightmare.</em>
</p>

<p align="center">
  <a href="https://github.com/retrofit-studios/betafied/releases"><img src="https://img.shields.io/github/v/release/retrofit-studios/betafied?color=5c8a42&label=release&style=flat-square" alt="Latest Release"></a>
  <a href="https://betafied.net"><img src="https://img.shields.io/badge/website-betafied.net-2b7489?style=flat-square" alt="Website"></a>
  <a href="https://discord.gg/BxD7jKs2Rb"><img src="https://img.shields.io/badge/discord-join%20community-5865F2?logo=discord&logoColor=white&style=flat-square" alt="Discord"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square" alt="License: GNU AGPLv3"></a>
  <a href="https://github.com/retrofit-studios/betafied/actions"><img src="https://img.shields.io/badge/tests-555%20passed-brightgreen?style=flat-square" alt="Tests"></a>
  <a href="#install"><img src="https://img.shields.io/badge/bedrock-1.26.51+-green?style=flat-square" alt="Bedrock Edition 1.26.51+"></a>
</p>

<p align="center">
  <a href="#about">About</a> •
  <a href="#key-features">Key Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#architecture">Architecture</a> •
  <a href="CONTRIBUTING.md">Contributing</a> •
  <a href="https://betafied.net">Website</a> •
  <a href="https://discord.gg/BxD7jKs2Rb">Discord</a>
</p>

---

## About

**Betafied** is an authentic recreation of **Minecraft Beta 1.7.3** running inside modern **Bedrock Edition** (Script API 2.11.0-beta). 

It is a ground-up behavioral reconstruction of how Minecraft actually behaved in the summer of 2011: the instant-heal food system, the machine-gun bow, Beta terrain generation, pre-1.8 mob AI, classic physics, and the atmospheric void fog. 

Any modern items, blocks, and mobs are transparently removed keeping the experience pure and seamless!

Betafied is 100% open source under the **[GNU AGPLv3](LICENSE)**. Fork it, run your own server, and build something legendary with it.

---

## Key Features

<table>
  <tr>
    <td width="50%" valign="top">
      <h3><img src="assets/icons/sword.svg" width="24" height="24" alt="" /> Combat & Health</h3>
      <ul>
        <li><b>Instant Food Healing</b>: Consuming food immediately restores hearts; hunger bar and natural health regeneration are completely removed.</li>
        <li><b>Rapid-Fire Bow</b>: Classic machine-gun bow mechanics without charging time.</li>
        <li><b>Authentic Armor Formula</b>: Classic linear damage reduction that scales directly with armor durability.</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h3><img src="assets/icons/dog.svg" width="24" height="24" alt="" /> Classic Mobs & AI</h3>
      <ul>
        <li><b>Authentic Pre-1.8 Catalog</b>: Only Beta 1.7.3 creatures roam the world; modern species are culled automatically.</li>
        <li><b>Passive Mob Wandering</b>: Animals roam freely without breeding mechanics or artificial following.</li>
        <li><b>Nightmare Ambushes</b>: Monsters wake you violently if your bed is placed in an insufficiently lit room.</li>
        <li><b>Classic Equipment & Drops</b>: Zombie Pigmen carry golden swords; zombies drop feathers.</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3><img src="assets/icons/earth.svg" width="24" height="24" alt="" /> World Generation & Limits</h3>
      <ul>
        <li><b>Beta Biome Palette</b>: Grass, foliage and sky colours sampled from the era's own climate colormaps.</li>
        <li><b>Nether Scrubber</b>: Dynamically restores modern Nether chunk features back to authentic Beta terrain.</li>
        <li><b>Classic Build Limits</b>: 128-block height ceiling and uneven bedrock floor at Y=0.</li>
        <li><b>Dimension Enforcement</b>: Void fog simulation and Nether ice mechanics; The End is blocked.</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h3><img src="assets/icons/tools.svg" width="24" height="24" alt="" /> Period Mechanics</h3>
      <ul>
        <li><b>Furnace Minecarts</b>: Real coal fueling, locomotive puffing, and cart collision impulse physics.</li>
        <li><b>Boat Impacts</b>: Classic wooden boats shatter into wooden planks and sticks upon high-speed collisions.</li>
        <li><b>Instant Bonemeal</b>: Crops mature instantaneously with a single bone meal.</li>
        <li><b>Classic Multi-Blocks</b>: Proper 54-slot double chest assembly and classic fence connections.</li>
      </ul>
    </td>
  </tr>
</table>

### <img src="assets/icons/refresh.svg" width="24" height="24" alt="" /> Transparent Item & Block Normalization
When players pick up, mine, or encounter post-Beta items, blocks, or loot, Betafied's generator-driven normalization pipeline automatically converts them into their closest historical equivalents. Builders and staff can bypass conversion using privileged tags (`builder_exempt`).

---

## Quick Start

### For Players

<details open>
<summary><b>Option A: Join the Official Server (No Download Required)</b></summary>
<br>

Connect directly to the dedicated multiplayer server. Both behavior and resource packs are downloaded and synced automatically when you connect:

- **Server Address**: `betafied.net`
- **Port**: Default Bedrock Port (`19132`)
- **Website**: [betafied.net](https://betafied.net)

</details>

<details>
<summary><b>Option B: Install Singleplayer / Custom Server (.mcaddon)</b></summary>
<br>

1. Download the latest `.mcaddon` bundle from [GitHub Releases](https://github.com/retrofit-studios/betafied/releases).
2. Open the downloaded file with Minecraft Bedrock (the game will automatically import both the Behavior Pack and Resource Pack).
3. In your world settings:
   - Activate the **Betafied Behavior Pack**.
   - Activate the **Betafied Resource Pack**.
4. Play! Requires Minecraft Bedrock **1.26.51** or newer.

</details>

---

### For Developers

Betafied requires **Node.js 24+** and the **[Regolith](https://bedrock-oss.github.io/regolith/)** compiler toolchain.

```bash
# 1. Clone repository
git clone https://github.com/retrofit-studios/betafied.git
cd betafied

# 2. Install dependencies & Regolith filters
npm install
npm run install-filters

# 3. Build packs
npm run build

# 4. Run the quality gate (typecheck, lint, and 550+ automated tests)
npm run check

# Or run individual verification steps:
npm test           # offline test suite
npm run typecheck  # TypeScript check
npm run lint       # ESLint scripts check
```

Want to contribute? Check out our step-by-step **[Contributor Guide (CONTRIBUTING.md)](CONTRIBUTING.md)** for local Bedrock environment setup, coding patterns, and guidelines.

---

## Architecture

Betafied is structured into modular subsystems under `packs/BP/scripts/`. TypeScript source files are transpiled to QuickJS-compatible JavaScript through Regolith.

<details>
<summary><b>Explore Subsystem Directory Layout</b></summary>
<br>

| Subsystem | Location | Description |
| --- | --- | --- |
| **Core** | `packs/BP/scripts/core/` | Event bus dispatching, priority management, tick loop scheduler, and error boundaries. |
| **Player** | `packs/BP/scripts/player/` | Instant food consumption, health restoration, off-hand stripping, and join banners. |
| **Combat** | `packs/BP/scripts/combat/` | Rapid-fire bow logic and the linear armor damage reduction formula. |
| **Interactions** | `packs/BP/scripts/interactions/` | Furnace minecarts, boat collisions, instant bonemeal, block placement rules, and double chests. |
| **World** | `packs/BP/scripts/world/` | 128-block height ceiling, dimension boundary enforcement, Nether scrubber, and void fog. |
| **Mobs** | `packs/BP/scripts/mobs/` | Mob spawning allowlists, post-Beta entity cleaner, animal wandering AI, and nightmare ambushes. |

</details>

---

## Community & Support

- <img src="assets/icons/globe.svg" width="24" height="24" alt="" /> **Website**: [betafied.net](https://betafied.net)
- <img src="assets/icons/message.svg" width="24" height="24" alt="" /> **Discord**: [Join the Betafied Community](https://discord.gg/BxD7jKs2Rb) — chat with players, report bugs, share builds, and follow development.
- <img src="assets/icons/bug.svg" width="24" height="24" alt="" /> **Bug Tracker**: [GitHub Issues](https://github.com/retrofit-studios/betafied/issues) — report parity discrepancies or engine issues.
- <img src="assets/icons/book-open.svg" width="24" height="24" alt="" /> **Contributor Guide**: [CONTRIBUTING.md](CONTRIBUTING.md)

---

## Credits & History

- **Origins**: Betafied originated from **cen0b**'s early Bedrock add-on.
- **Evolution**: Expanded in 2025 by **xzelleiv**, **Arxance**, **uptightsuperlabs**, and contributors across the Bedrock add-on scene.
- **Version 4.0 Rewrite**: The entire gameplay engine was rebuilt from the ground up on modern Bedrock Script APIs, establishing the current modular architecture.
- **Icons**: The section icons come from **[pixelarticons](https://pixelarticons.com)** by Gerrit Halfmann, used under the MIT licence.

---

## A Note on AI Development

Betafied is a hobby project run by a few people, and like almost every modern codebase it uses agentic coding tools somewhere in the pipeline. Nobody is paid for this work and nothing is sold, so there is nothing to be gained from passing machine output off as hand-written; the aim is to let players who normally can't play Beta 1.7.3 play it in Bedrock.

Agents draft code and tests and run code-health scans that surface technical debt. Every commit is authored and reviewed by hand, agents never commit or push on their own, and nothing merges unless the full quality gate (`npm run check`) is green.

---

## License

Distributed under the **[GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE)**.

You are free to run, study, modify, and redistribute this software. If you run a modified version on a network or server, you must provide access to the corresponding source code under the AGPLv3.

*Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.*
