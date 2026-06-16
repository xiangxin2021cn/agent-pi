# Agent π

![Agent π brand logo](docs/assets/agent-pi-logo.png)

Agent π is a Windows-first desktop agent application adapted for the Agent Pi workspace, model, output, and release flow.

## Brand

Agent π uses the green-blue `Always π AI Studio` identity shown above. The desktop app icon, in-app header marks, viewer logo, bundled branding resources, and Windows installer icon are all generated from `Logo (F).png` so the installed app and GitHub release page present one consistent brand.

## Download

Windows releases are published from this repository:

<https://github.com/xiangxin2021cn/agent-pi/releases/latest>

The Windows installer asset is named `Agent-Pi-x64.exe`.

## Release Channel

The Electron auto-updater is configured to read update metadata from GitHub Releases for:

`xiangxin2021cn/agent-pi`

Each Windows release should include:

- `Agent-Pi-x64.exe`
- `Agent-Pi-x64.exe.blockmap`
- `latest.yml`

## Current Agent Pi Changes

- Project-grouped conversation navigation so work folders and their sessions are easier to scan.
- Collapsible sub-agent/session display for branch-heavy workflows.
- Visible session information sidebar with progress, model, working directory, formal outputs, session files, and sources.
- Formal output directory support with file source markers and promotion from process material to final output.
- Controlled model switching and vision fallback behavior.
- Agent π branding, icon, app identity, and GitHub-based update channel.

## Development

Install dependencies:

```bash
bun install
```

Run type checks:

```bash
bun run typecheck:electron
bun run typecheck:shared
```

Build the Windows installer:

```bash
bun run electron:dist:win
```

The generated installer is written to:

`apps/electron/release/Agent-Pi-x64.exe`

## License

Apache-2.0. See [LICENSE](LICENSE).
