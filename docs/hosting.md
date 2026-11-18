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
it declares one).

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
   ```

   `runtime` is inferred: the project's `Dockerfile` if it has one; else
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

`examples/hosted/` has one of each: `notes-mcp` (an MCP server on stdio, no
dependencies) and `word-count-http` (a plugin backend over HTTP).

## Isolation

| | |
| --- | --- |
| Network | None (`--network none`, or an `--internal` Docker network for services with a port: the server reaches them, they reach nothing). A service that lists `egress` hosts gets outbound access. **The hosts are declared, not yet filtered**: any listed host means general outbound access |
| Ports | Never published. HTTP services are reached at their address on the internal network, by this server only |
| Privileges | Unprivileged user (uid 10001 in generated images), `--cap-drop ALL`, `no-new-privileges` |
| Limits | `--memory` (512m by default), `--cpus` (1), `--pids-limit 256` |
| Secrets | Passed as environment variables when a container starts, by name (`-e NAME`), so they never appear on a command line, in the image, or on disk with the service |
| Uploads | Refused when a member has an absolute path, `..`, or is a link; size-capped |

A hosted endpoint needs no `MAS_ALLOW_LOCAL_EXEC`: nothing runs on the host
itself. (`MAS_ALLOW_LOCAL_EXEC` still gates the older `command:` fields,
which do.)

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

- **Egress filtering**: an outbound proxy so that `egress` lists are enforced
  host by host, instead of granting general outbound access.
- **Compose projects**: whole application envs (`mas-env/1` `runtime.compose`)
  hosted the same way, instead of `lifecycle.start` on the host.
- **Moving the host-run paths onto hosting**: stdio MCP `command:`, custom
  agent programs and env `start` commands as hosted services, leaving
  `MAS_ALLOW_LOCAL_EXEC` as a developer escape hatch.
- **Endpoint pickers in the inspector**, so components choose a connection
  from a list instead of an id in YAML; idle stop for long-running services.
