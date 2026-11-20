# bedrock-addon-helper

`bah` is a command line tool for Minecraft Bedrock Edition add-on projects. It creates and manages behavior and
resource packs, manages `@minecraft` script modules, builds `.mcpack`/`.mcaddon` files (bundling JavaScript or
TypeScript with esbuild), and runs local test servers in Docker that are updated on every build.

## Requirements

- Node.js 24 or newer
- npm (used to install script module types)
- Docker, for test servers
- Bedrock 1.26.50 or newer for test servers

## Installation

As a dev dependency of the project, run with `npx`:

```bash
npm install -D bedrock-addon-helper
npx bah --help
```

This pins the `bah` version per project. `bah` also works in npm scripts (`"scripts": { "watch": "bah watch" }`).

Globally:

```bash
npm install -g bedrock-addon-helper
bah --help
```

## Quick start

```bash
mkdir my-addon && cd my-addon
npm init -y
npm install -D bedrock-addon-helper
npx bah init
npx bah pack add resource my-rp
npx bah pack add behavior my-bp --scripts ts --depends-on my-rp
npx bah module add @minecraft/server
npx bah server create dev
npx bah server start dev
npx bah watch
```

With a global install, run `bah init my-addon && cd my-addon` instead of the first three lines and drop `npx`.
`bah init` keeps an existing `package.json` and takes the project name from it.

`bah watch` rebuilds on every change and reloads the server. Connect to the address printed by `bah server start`.

## Project layout

```
my-addon/
├── bah.json                  project config (packs)
├── package.json              npm dependencies (script module types, libraries)
├── tsconfig.json             created for TypeScript packs
├── packs/
│   ├── my-bp/                behavior pack sources (manifest.json, scripts/main.ts, ...)
│   └── my-rp/
├── build/                    build output (gitignored)
│   ├── packs/<pack>/         unpacked built packs
│   └── artifacts/            <project>-<pack>.mcpack, <project>.mcaddon
└── .bah/
    ├── servers.json          test server config (commit this)
    ├── servers.local.json    secrets and machine-specific settings (gitignored)
    └── servers/<name>/       server data: world, downloaded server (gitignored)
```

`bah` finds the project by searching for `bah.json` in the current directory and its parents. Set `BAH_PROJECT_ROOT`
to use a different directory.

## bah.json

```json
{
    "name": "my-addon",
    "packs": [
        {
            "name": "my-bp",
            "type": "behavior",
            "path": "packs/my-bp",
            "dependencies": ["my-rp"],
            "scripts": { "entry": "scripts/main.ts" }
        },
        { "name": "my-rp", "type": "resource", "path": "packs/my-rp", "bundle": false }
    ]
}
```

| Field                   | Description                                                                                                                                                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                  | Project name. Used for artifact, pack directory and container names. Letters, digits, `_`, `-`.                                                                                                                                                             |
| `packs[].name`          | Pack name, unique in the project.                                                                                                                                                                                                                           |
| `packs[].type`          | `behavior` or `resource`.                                                                                                                                                                                                                                   |
| `packs[].path`          | Pack directory relative to the project root. Not inside `build/`, `.bah/` or `node_modules/`.                                                                                                                                                               |
| `packs[].bundle`        | Include the pack in the `.mcaddon`. Default `true`.                                                                                                                                                                                                         |
| `packs[].dependencies`  | Other packs of the project this pack depends on. Written to the manifest with the dependency's current UUID and version on `link` and before every build. Dependencies on packs outside the project and module dependencies in the manifest are left alone. |
| `packs[].scripts.entry` | Script entry point (`.js` or `.ts`) relative to the pack directory. Behavior packs only.                                                                                                                                                                    |

## Commands

Every command has `--help`.

### init

```
bah init [directory] [-n <name>]
```

Creates `bah.json` without packs, a `package.json` if there is none, and `.gitignore` entries for `node_modules/`,
`build/`, `.bah/servers/` and `.bah/servers.local.json`. The name defaults to the `package.json` name (without scope)
or the directory name.

### pack

```
bah pack add <behavior|resource> <name> [options]
bah pack list
bah pack remove <name> [--delete-files]
bah pack link <pack> <dependency>
bah pack unlink <pack> <dependency>
```

`pack add` options:

- `--path <path>`: pack directory, default `packs/<name>`.
- `-d, --description <text>`
- `--min-engine-version <version>`: `latest` (default), `preview` or a version. Resolved through the Minecraft
  download API.
- `--scripts <js|ts>`: create `scripts/main.js` or `scripts/main.ts` and a script module in the manifest. `ts` also
  creates `tsconfig.json` if missing.
- `--depends-on <packs...>`
- `--no-bundle`

New packs get a `format_version` 2 manifest with new UUIDs. If the directory already contains a `manifest.json`, the
pack is registered without changing its files, and the script entry is taken from the manifest.

`pack remove` refuses while other packs depend on the pack and keeps the files unless `--delete-files` is given.

### module

```
bah module add <module> [version] [-p <pack>] [--beta] [--game-version <version>] [--no-install]
bah module remove <module> [-p <pack>] [--no-install]
bah module update [module] [version] [--beta] [--game-version <version>] [--no-install]
bah module list
```

- Engine modules (`@minecraft/server`, `-ui`, `-gametest`, `-net`, `-admin`, `-editor`, `debug-utilities`, ...) are
  added to the pack manifest and to `devDependencies` (types only). They are not bundled.
- Library modules (`@minecraft/math`, `@minecraft/vanilla-data`) are added to `dependencies` and bundled into the
  packs that import them. They are not listed in manifests, and `--pack` doesn't apply.
- `--pack` is required for engine modules when the project has more than one behavior pack.
- One npm version per module is used for the whole project. Adding a module that another pack uses reuses its
  version; a different version is refused. Use `module update` to change it for all packs.
- `module remove` removes the module from `package.json` once no pack uses it.
- `npm install` runs after changes unless `--no-install` is given.
- `module list` also reports manifests that disagree with `package.json`, modules no pack uses, and beta modules for
  different game versions.

Versions:

- Without a version, the release tagged `latest` on npm is used. Modules without a current stable release fall back
  to their beta.
- `version` can be a stable version or prefix (`2.11.0`, `2.11`, `2`), a beta API version (`2.12.0-beta`) or an exact
  npm version.
- npm versions map to manifest versions: `2.11.0` → `2.11.0`, `2.12.0-beta.1.26.66-stable` → `2.12.0-beta`,
  `2.13.0-beta.1.26.70-preview.26` → `2.13.0-beta`. Release candidates and internal builds are refused.
- Beta APIs only work on the game version they were published for. Betas are chosen for a game version:
  `--game-version latest` (current release), `preview` (current preview) or a release like `1.26.60`. Without
  `--game-version`, `module add` uses the game version of the project's existing betas, or `latest`; `module update`
  uses `latest`. If there is no beta for the exact version, the newest beta for an older game version of the same
  channel is used.
- `module update` keeps beta modules on beta; `--beta` switches stable modules to beta.

### build

```
bah build [-d] [-t] [-p <packs...>] [-o <file>] [-s <servers...>] [--no-deploy]
```

For each pack: syncs pack dependencies in the source manifest, copies the pack to `build/packs/<pack>/` (without the
script source directory, dotfiles and OS clutter), bundles the scripts into one ES module at the entry path with a
`.js` extension (target ES2022, engine modules kept external), writes the manifest, and zips it into
`build/artifacts/<project>-<pack>.mcpack`. Bundled packs go into `build/artifacts/<project>.mcaddon`. Archives are
reproducible.

Then the packs are deployed to the test servers (see below).

- `-d, --debug`: no minification, inline source maps.
- `-t, --typecheck`: run `tsc --noEmit` first if a built pack uses TypeScript. Needs `typescript` installed in the
  project.
- `-p, --pack <names...>`: build only these packs; no `.mcaddon` is written.
- `-o, --output <file>`: `.mcaddon` path. Only for full builds.
- `-s, --server <names...>`: deploy only to these servers.
- `--no-deploy`: don't deploy.

### watch

```
bah watch [-d] [-t] [-s <servers...>] [--no-deploy]
```

Builds and deploys, then again whenever a pack directory, `bah.json`, `package.json` or `package-lock.json` changes
(300 ms after the last change). Builds don't overlap; changes during a build trigger one more build. Changes to
`bah.json` reload the project. Errors are printed and watching continues. Stop with Ctrl+C.

### server

```
bah server create <name> [--game-version <version>] [--port <port>] [--experiment <names...>]
                         [--reload <command|restart|none>] [--reload-command <command>]
bah server list
bah server start [names...]
bah server stop [names...]
bah server restart [names...]
bah server remove <name> [--purge]
bah server attach <name>
bah server logs <name> [-f] [-n <lines>]
bah server command <name> <command...>
```

- `start`, `stop` and `restart` act on all servers when no names are given.
- `remove` stops and removes the container and the config; `--purge` also deletes `.bah/servers/<name>/`.
- `attach` connects to the server console (type commands, Ctrl+C to detach). If the server stops, it waits and
  attaches again when it is back.
- `command` sends a console command, e.g. `bah server command dev reload`.

## Test servers

Servers run in the `itzg/minecraft-bedrock-server` Docker image (x86 emulation with box64 on ARM) through the
`docker` command, so the active Docker context is used. The container is named `bah-<project>-<server>-<id>` and
mounts `.bah/servers/<name>/` as `/data`. Containers are kept after stopping so `logs` keeps working.

### .bah/servers.json

```json
{
    "servers": {
        "dev": {
            "id": "cd60997bdbb9",
            "version": "latest",
            "port": 19132,
            "udpPorts": { "start": 19133, "end": 19136 },
            "experiments": [],
            "allowedModules": [],
            "variables": {},
            "properties": {},
            "reload": { "mode": "command", "command": "reload" }
        }
    }
}
```

| Field            | Description                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | Random ID, part of the container name.                                                                                                            |
| `version`        | `latest`, `preview` or an exact version such as `1.26.66` or `1.26.70.26`. Resolved on every start.                                               |
| `port`           | TCP port for connection signaling (`server-port`).                                                                                                |
| `udpPorts`       | UDP port range for game traffic (`server-udp-ports`).                                                                                             |
| `experiments`    | level.dat experiment toggles, e.g. `gametest`. `beta-apis` is accepted as an alias for `gametest`.                                                |
| `allowedModules` | Extra script modules for `config/default/permissions.json` (optional).                                                                            |
| `variables`      | Written to `config/default/variables.json`.                                                                                                       |
| `properties`     | `server.properties` values. `server-port`, `server-portv6`, `server-udp-ports` and `server-public-ip` are managed by `bah` and can't be set here. |
| `reload`         | After a deploy: `{"mode": "command", "command": "..."}`, `{"mode": "restart"}` or `{"mode": "none"}`.                                             |

### .bah/servers.local.json

```json
{
    "advertiseHost": "192.168.1.20",
    "servers": {
        "dev": { "secrets": { "apiKey": "..." }, "advertiseHost": "10.0.0.5" }
    }
}
```

- `advertiseHost`: address sent to clients (`server-public-ip`). Default: the machine's LAN IPv4 address. Can be set
  globally and per server.
- `secrets`: written to `config/default/secrets.json`.

### Networking

Bedrock 1.26.50+ uses NetherNet: an HTTP signaling handshake on the TCP port, then UDP for game traffic. Both are
published with the same port numbers on the host. Readiness is checked with `GET http://127.0.0.1:<port>/v1/join`.

New servers get the first free block of ports starting at 19132 (blocks of 10): the TCP port, followed by the UDP
ports. Versions before 1.26.70 can't share one UDP port between players and get 4 UDP ports; 1.26.70 and newer get
one. `start` fails with a clear error if the ports are in use.

### What start does

1. Resolves the version, checks it is at least 1.26.50 and that the UDP range is large enough.
2. Writes `server.properties` (managed values, then `properties`, over these defaults: `allow-list=false`,
   `allow-cheats=true`, `default-player-permission-level=operator`, `texturepack-required=true`,
   `content-log-console-output-enabled=true`), the script config files, and `keys/server_identity_key.pem` (generated
   once, so clients don't have to trust the server again after each restart).
3. On the first start, runs the server once to create the world (and download the server), then stops it.
4. Installs the latest build.
5. Sets the experiments in `worlds/world/level.dat`. `gametest` (Beta APIs) is enabled automatically when a pack
   uses a beta module.
6. Starts the server and waits until `/v1/join` answers (3 minutes, 6 on the first start).

### Deploying

`build` and `watch` copy the built packs to `development_behavior_packs/<project>-<pack>/` and
`development_resource_packs/<project>-<pack>/` of every server (running or not), and register them in
`worlds/world/world_behavior_packs.json` and `world_resource_packs.json`. Packs that were removed from the project are
uninstalled; packs added to the world by other means are kept.

Running servers then get their reload command, or are restarted with `reload` mode `restart`. A reload command only
reloads scripts and functions, so servers are restarted when packs were added, removed or changed version.

## Environment variables

| Variable              | Description                                             |
| --------------------- | ------------------------------------------------------- |
| `BAH_PROJECT_ROOT`    | Project directory, instead of searching for `bah.json`. |
| `npm_config_registry` | npm registry used to look up module versions.           |

## Development

```bash
npm install
npm run dev -- --help   # run the CLI from source
npm test                # unit tests (node:test)
npm run lint            # Biome lint and format check
npm run typecheck
npm run build           # compile to dist/
BAH_DOCKER_TESTS=1 node --test src/server/docker-cli.integration.test.ts
```

Sources are TypeScript limited to erasable syntax, so Node runs them without a build step. Relative imports use the
`.ts` extension; `tsc` rewrites them on build. Tests live next to the code as `*.test.ts`. Every stored file
(`bah.json`, `servers.json`, `servers.local.json`, manifests, `package.json`) has a zod schema in the source, which
the TypeScript types are derived from.

## License

MIT
