# Connections: remote endpoints and hosted services

Components that live outside the platform's own code (an MCP server, a
plugin's backend, a catalog tool, an imported env's MCP server) say where they
are with one **endpoint**, from one of two sources:

```yaml
endpoint: { remote: { url: https://crm.example/mcp, bearer_env: CRM_TOKEN, headers: { x-team: a } } }   # somewhere else
endpoint: { hosted: { service: svc_notes_mcp_e6f792 } }                                                 # running on this server
```

A **remote** endpoint is a URL with its auth: a secret named in Settings,
sent as a bearer token, and/or fixed headers. A **hosted** endpoint names a
project uploaded to this server (or cloned from git), built and run in
Docker. At run time either one resolves to a URL to call, or to a command
that speaks MCP on stdio, and the component works the same way. The older
`url` and `command` fields keep working.

The **Connections** page lists hosted services and tests endpoints: for MCP it
lists the server's tools, for HTTP it calls the service (its health path, if
it declares one). In the inspector, a plugin's MCP/HTTP backend and a catalog
tool's connection have a **Where** field: on this machine (URL or command),
a remote endpoint (URL and bearer secret), or a hosted service picked from a
list of those that speak the right protocol, with a test button.

## Hosting a project

1. **Upload** a `.tar.gz` / `.zip` (up to 15 MB, 200 MB unpacked), or give an
   `https` git URL. Each upload is a new version; older ones stay.
2. **Describe how it runs**, in the project's `mas-host.yaml` or on the page:

   ```yaml
   name: Notes MCP
   start: python server.py              # run in /app
   expose: { kind: mcp-stdio }          # or { kind: mcp-http, port: 8000, path: /mcp } or { kind: http, port: 8000, health: /health }
   egress: []                           # hosts it needs; empty = no network
   env: { MODE: prod, API_KEY: { secret: GITHUB_TOKEN } }
   memory: 512m
   cpus: 1
   idle_minutes: 30                     # mcp-http / http: stopped after 30 idle minutes, restarted on next use (0 = never)
   ```

   `runtime` is inferred: a compose file (`compose.yaml`,
   `docker-compose.yml`) if the project has one; else its `Dockerfile`; else
   Python (`requirements.txt` / `pyproject.toml`, `pip install`) or Node
   (`package.json`, `npm ci`). `install` replaces the install step.
3. **Build.** The image is `mas-hosted-<service>:v<version>`; the build may use
   the network, to install dependencies.
4. **Use it**: `endpoint: { hosted: { service: <id> } }` on a plugin backend,
   a catalog tool or an env's MCP server.

| `expose.kind` | How it runs | How the platform reaches it |
| --- | --- | --- |
| `mcp-stdio` | a fresh container per connection (`docker run -i --rm`), gone when the connection closes | MCP over the container's stdin/stdout |
| `mcp-http` | one long-running container, started on first use (or Start) | `http://<container address>:<port><path>`, from this server only |
| `http` | the same | the same; plugin backends get `POST /tools/<name>` and `/hooks/<hook>` |
| `agent-stdio` | an agent program (the custom-stdio protocol): a fresh container per turn | as an agent's program: `harness: { runner: custom-stdio, endpoint: { hosted: { service } } }`. It reaches the platform's tools for that agent over MCP at the internal network's gateway (`$MAS_MCP_URL`), a listener that serves only `/mcp`, with the per-run token |

`examples/hosted/` has one of each: `notes-mcp` (an MCP server on stdio),
`word-count-http` (a plugin backend over HTTP) and `tool-lister-agent` (an
agent program that asks the platform for its tools over MCP), all without
dependencies.

`text-world-mcp` is a world of its own (places, things, people, what was said
where, a clock that moves with every action) as an MCP server over HTTP. A
world has to be shared by every agent and last between their calls, so it is
`mcp-http`: one long-running container, not one per connection. Each tool call
names who acts (`look`, `move`, `take`, `drop`, `say`, `wait`, `time`, `reset`).
Host it, then give an env `endpoint: { hosted: { service } }` and connect the
agents that live in it: a town for Generative Agents-style systems, a game
board, a simulated office.

Two agents in it, on flash-lite, reproduce Generative Agents' party in
miniature: Isabella resets the world, walks to the park at 08:10 and announces
her Valentine's party; Klaus, arriving at 08:32, hears it there (the park
keeps what was said), answers, walks to the cafe and offers to help. The env
is an imported one whose MCP endpoint is the hosted service:

```yaml
manifest:
  exposes: { mcp: { transport: http, auth: none, tools: [look, move, take, drop, say, wait, time, reset],
                    endpoint: { hosted: { service: svc_text_world_… } } } }
```

`town-mcp` grows the text world for Generative Agents' information
diffusion: six places, speech heard only where it is said, a clock that moves
only when the one running the simulation calls `advance` (`reset {driven: true}`),
and `report`, which counts who heard a keyword and who was at a place in a time
window. Host it under the name `town`: an endpoint can name a hosted service by
its name as well as its id, so the "Generative Agents (town)" template needs no
server-specific id.

## Compose projects

An application env (an app, its database, its MCP server…) is hosted as its
compose project. `expose.service` names the service the platform reaches:

```yaml
expose: { kind: http, service: api, port: 8000, health: /health }
```

The compose file is rewritten before it runs (`server/hosting/compose.ts`),
and the build log says what changed:

| | |
| --- | --- |
| Refused, with the reason | `privileged`; `network_mode` / `pid` / `ipc` of the host; `cap_add`; `devices`; mounts outside the project folder or of the Docker socket; `security_opt` that loosens confinement; external volumes |
| Removed | `ports` (nothing is published), `container_name`, `restart`, the project's own networks, `extra_hosts`, `dns` |
| Added | one internal network for the whole project, with a subnet of its own from `10.213.0.0/16` (its services reach each other by name, this server reaches the entry service, nothing reaches out); `no-new-privileges`; a memory limit; 256 processes |

Stop keeps the project's volumes (its data); delete removes them, its images
and its network. A compose project's network is created by the platform
(internal, its own subnet), so it can declare egress hosts like any service:
every service gets `HTTP(S)_PROXY` as `${MAS_EGRESS_PROXY}`, filled in from
the environment of `docker compose` (the URL with the project's credentials is
never written into the file), and the proxy listens on the project's gateway.
Checked (2026-11-18): a compose service declaring `example.com` got 200 there,
403 for `api.github.com`, and no route without the proxy. `examples/hosted/two-services-compose` is a small one: an api that
asks a backend service by name. Checked end to end (2026-11-18): rewritten
(ports, container_name and restart removed), built, started on its own
subnet; the api reached the backend by name; no published port, no route
out; a privileged project with a mount of `/etc` was refused with both
reasons.

## Isolation

| | |
| --- | --- |
| Network | None (`--network none`, or an `--internal` Docker network for services with a port: the server reaches them, they reach nothing). A service that lists `egress` hosts stays on the internal network and gets `HTTP(S)_PROXY` pointing at the platform's **egress proxy**, with credentials of its own: it reaches those hosts (`api.github.com`, `*.example.com`, `host:8443`; ports 443/80 unless named) and nothing else, never a private or loopback address. A program that ignores the proxy settings reaches nothing at all |
| Ports | Never published. HTTP services are reached at their address on the internal network, by this server only |
| Privileges | Unprivileged user (uid 10001 in generated images), `--cap-drop ALL`, `no-new-privileges` |
| Limits | `--memory` (512m by default), `--cpus` (1), `--pids-limit 256` |
| Secrets | Passed as environment variables when a container starts, by name (`-e NAME`), so they never appear on a command line, in the image, or on disk with the service |
| Uploads | Refused when a member has an absolute path, `..`, or is a link; size-capped |

A hosted endpoint needs no `MAS_ALLOW_LOCAL_EXEC`: nothing runs on the host
itself. (`MAS_ALLOW_LOCAL_EXEC` still gates the older `command:` fields,
which do.)

A hosted agent program checked end to end (2026-11-18), on a separate
server instance: it ran in its own container, reached the platform's MCP at
the gateway, listed its one tool (`fetch`) and replied; the gateway answered
404 to every path but `/mcp`, even with the user token, and refused an
unknown run token.

Egress checked against real Docker (2026-11-18), a service declaring
`example.com`: `https://example.com` through the proxy → 200;
`https://api.github.com` → 403, logged as not declared; a direct connection
without the proxy → no route.

Checked end to end (2026-11-18): both examples uploaded, built and tested;
the HTTP service ran as uid 10001 at an internal address, with no published
port and no route to the internet; an agent used both (`add_note`,
`list_notes` over MCP stdio, `count_words` over HTTP) in one run.

## API

| Call | What it does |
| --- | --- |
| `GET /api/hosted` | Services, each with its state (running, address) |
| `POST /api/hosted` `{ name, archive_base64 + filename \| git, manifest? }` | Host a new project |
| `POST /api/hosted/:id/versions` `{ archive_base64 + filename \| git }` | A new version of its code |
| `PUT /api/hosted/:id/config` `{ start?, expose?, egress?, env?, memory?, cpus? }` | How it runs; kept across versions |
| `POST /api/hosted/:id/build` | Build the current version (returns the log) |
| `POST /api/hosted/:id/start` · `/stop` · `GET /logs` · `DELETE` | Lifecycle of an `mcp-http` / `http` service; delete removes its versions and images |
| `POST /api/connections/test` `{ endpoint, kind: mcp \| http }` | Try any endpoint, hosted or remote |

## Next

- **Moving the remaining host-run paths onto hosting**: env `start`
  commands (with Compose, above), leaving `MAS_ALLOW_LOCAL_EXEC` as a
  developer escape hatch. (MCP servers, plugin backends, tools and agent
  programs can already be hosted.)
