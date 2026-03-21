export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "MT5 Fleet Orchestrator API",
    version: "1.0.0",
    description:
      "Internal API for managing a fleet of Windows VPS instances running MetaTrader 5 trading accounts. " +
      "Provides VPS provisioning, account management, trade execution, and copy trading orchestration.\n\n" +
      "**Authentication:** All endpoints (except `/api/auth/login` and `/api/health`) require a valid `mt5_auth` cookie. " +
      "Obtain it by posting credentials to `/api/auth/login`.",
    contact: { name: "MT5 Fleet Team" },
  },
  servers: [
    {
      url: "https://just-stillness-production.up.railway.app",
      description: "Production (Railway)",
    },
    { url: "http://localhost:3000", description: "Local development" },
  ],
  tags: [
    { name: "Health", description: "Liveness and readiness probes" },
    { name: "Auth", description: "Authentication" },
    { name: "Dashboard", description: "Aggregated fleet overview" },
    { name: "VPS", description: "VPS instance management and provisioning" },
    { name: "Accounts", description: "MT5 trading account management" },
    { name: "Trading", description: "Execute trades on MT5 accounts" },
    { name: "Copier", description: "Copy trading session management" },
    { name: "Servers", description: "MetaQuotes broker server directory" },
  ],
  paths: {
    // ── Health ──
    "/api/health": {
      get: {
        tags: ["Health"],
        summary: "Health check",
        description: "Simple liveness probe. No authentication required.",
        responses: {
          "200": {
            description: "Service is healthy",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { status: { type: "string", example: "ok" } },
                },
              },
            },
          },
        },
      },
    },

    // ── Auth ──
    "/api/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Authenticate",
        description:
          "Validates the password against `AUTH_SECRET` env var. On success, sets an `mt5_auth` httpOnly cookie (30-day expiry).",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["password"],
                properties: {
                  password: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Login successful",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { ok: { type: "boolean", example: true } },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Error" },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },

    // ── Dashboard ──
    "/api/dashboard": {
      get: {
        tags: ["Dashboard"],
        summary: "Fleet overview",
        description:
          "Returns aggregated stats: total VPS, accounts, equity, P&L, active copier sessions, alerts (offline VPS / disconnected accounts), and recent copier logs.",
        responses: {
          "200": {
            description: "Dashboard data",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DashboardData" },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },

    // ── VPS ──
    "/api/vps": {
      get: {
        tags: ["VPS"],
        summary: "List all VPS instances",
        responses: {
          "200": {
            description: "VPS list",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Vps" },
                },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
      post: {
        tags: ["VPS"],
        summary: "Add a new VPS",
        description:
          "Registers a VPS in the database. If the VPS API is already reachable, syncs existing accounts and marks it ONLINE.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "ip", "password"],
                properties: {
                  name: { type: "string", example: "VPS1" },
                  ip: { type: "string", example: "167.86.102.187" },
                  password: { type: "string" },
                  vncIp: { type: "string" },
                  vncPort: { type: "integer" },
                  apiPort: {
                    type: "integer",
                    default: 8000,
                    description: "Port the FastAPI runs on",
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "VPS created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Vps" },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/vps/{id}": {
      get: {
        tags: ["VPS"],
        summary: "Get VPS details",
        parameters: [{ $ref: "#/components/parameters/VpsId" }],
        responses: {
          "200": {
            description: "VPS with accounts",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Vps" },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
      patch: {
        tags: ["VPS"],
        summary: "Update VPS fields",
        parameters: [{ $ref: "#/components/parameters/VpsId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                description: "Any subset of VPS fields",
                properties: {
                  name: { type: "string" },
                  ip: { type: "string" },
                  password: { type: "string" },
                  vncIp: { type: "string" },
                  vncPort: { type: "integer" },
                  apiPort: { type: "integer" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated VPS",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Vps" },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
      delete: {
        tags: ["VPS"],
        summary: "Delete a VPS",
        description:
          "Deletes the VPS and cascades to all accounts. Blocked if any accounts are in active copier sessions (409).",
        parameters: [{ $ref: "#/components/parameters/VpsId" }],
        responses: {
          "200": {
            description: "Deleted",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { success: { type: "boolean" } },
                },
              },
            },
          },
          "409": {
            description: "Accounts in active copier sessions",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string" },
                    details: {
                      type: "array",
                      items: { type: "string" },
                    },
                    sessions: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/vps/{id}/provision": {
      post: {
        tags: ["VPS"],
        summary: "Start VPS provisioning",
        description:
          "Spawns the `setup_vps.py` script to provision a fresh Windows VPS (VNC login, SSH install, API deploy). Returns immediately with a log ID for tracking progress.",
        parameters: [{ $ref: "#/components/parameters/VpsId" }],
        responses: {
          "200": {
            description: "Provisioning started",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { logId: { type: "string" } },
                },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/vps/{id}/progress": {
      get: {
        tags: ["VPS"],
        summary: "Stream provisioning logs (SSE)",
        description:
          "Server-Sent Events stream that polls the provision log every 2 seconds and emits new chunks. Closes when provisioning finishes.",
        parameters: [
          { $ref: "#/components/parameters/VpsId" },
          {
            name: "logId",
            in: "query",
            schema: { type: "string" },
            description:
              "Specific provision log ID. If omitted, uses the latest log for this VPS.",
          },
        ],
        responses: {
          "200": {
            description: "SSE stream",
            content: { "text/event-stream": {} },
          },
        },
      },
    },
    "/api/vps/{id}/progress/status": {
      get: {
        tags: ["VPS"],
        summary: "Get provision status snapshot",
        parameters: [{ $ref: "#/components/parameters/VpsId" }],
        responses: {
          "200": {
            description: "Provision status",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: {
                      type: "string",
                      enum: ["none", "RUNNING", "SUCCESS", "FAILED"],
                    },
                    logs: { type: "string" },
                    startedAt: { type: "string", format: "date-time" },
                    finishedAt: {
                      type: "string",
                      format: "date-time",
                      nullable: true,
                    },
                  },
                },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/vps/{id}/sync": {
      post: {
        tags: ["VPS"],
        summary: "Sync accounts from VPS",
        description:
          "Queries the VPS API for its registered accounts and upserts them into the database. Marks VPS as ONLINE.",
        parameters: [{ $ref: "#/components/parameters/VpsId" }],
        responses: {
          "200": {
            description: "Synced accounts",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    synced: { type: "integer" },
                    accounts: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Account" },
                    },
                  },
                },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/vps/{id}/stats": {
      get: {
        tags: ["VPS"],
        summary: "Get VPS system stats",
        description:
          "Proxies to the VPS system stats endpoint. Returns CPU, memory, disk, and MT5 process info.",
        parameters: [{ $ref: "#/components/parameters/VpsId" }],
        responses: {
          "200": {
            description: "System stats",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SystemStats" },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },

    // ── Accounts ──
    "/api/accounts": {
      get: {
        tags: ["Accounts"],
        summary: "List all accounts",
        description: "Returns all accounts across all VPS instances, with VPS name.",
        responses: {
          "200": {
            description: "Account list",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Account" },
                },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/accounts/{vpsId}": {
      get: {
        tags: ["Accounts"],
        summary: "List accounts for a VPS",
        parameters: [
          {
            name: "vpsId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Account list",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Account" },
                },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
      post: {
        tags: ["Accounts"],
        summary: "Add an MT5 account",
        description:
          "Starts an async account setup job: downloads MT5, installs, configures credentials, compiles the PythonBridge EA, and starts the terminal. Takes 2-4 minutes.",
        parameters: [
          {
            name: "vpsId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["login", "password", "server"],
                properties: {
                  login: { type: "string", example: "12345678" },
                  password: { type: "string" },
                  server: {
                    type: "string",
                    example: "ICMarketsSC-Demo",
                  },
                  broker: { type: "string" },
                  installer_url: {
                    type: "string",
                    description:
                      "MT5 installer download URL. Auto-detected from brokers.json if not provided.",
                  },
                  installer_path: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Setup job started",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    jobId: { type: "string" },
                    message: { type: "string" },
                  },
                },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/accounts/{vpsId}/setup-status": {
      get: {
        tags: ["Accounts"],
        summary: "Poll account setup progress",
        parameters: [
          {
            name: "vpsId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "jobId",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Setup status",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: {
                      type: "string",
                      enum: ["PENDING", "SUCCESS", "FAILED"],
                    },
                    steps: {
                      type: "array",
                      items: { type: "string" },
                    },
                    error: { type: "string", nullable: true },
                    login: { type: "string" },
                    server: { type: "string" },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/accounts/{vpsId}/{server}/{login}": {
      get: {
        tags: ["Accounts"],
        summary: "Get live account info",
        description:
          "Fetches real-time account info (balance, equity, leverage) from the MT5 terminal via the VPS bridge.",
        parameters: [
          {
            name: "vpsId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "server",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "login",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Account info",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AccountInfo" },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
      delete: {
        tags: ["Accounts"],
        summary: "Delete an account",
        description:
          "Stops the MT5 terminal, deletes account files on the VPS, and removes the account from the database. Blocked if the account is in an active copier session (409).",
        parameters: [
          {
            name: "vpsId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "server",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "login",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": { description: "Account deleted" },
          "409": {
            description: "Account in active copier session",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string" },
                    details: {
                      type: "array",
                      items: { type: "string" },
                    },
                    sessions: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },

    // ── Trading ──
    "/api/accounts/{vpsId}/{server}/{login}/buy": {
      post: {
        tags: ["Trading"],
        summary: "Place a BUY order",
        parameters: [
          {
            name: "vpsId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "server",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "login",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TradeRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Trade result from EA",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TradeResult" },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/accounts/{vpsId}/{server}/{login}/sell": {
      post: {
        tags: ["Trading"],
        summary: "Place a SELL order",
        parameters: [
          {
            name: "vpsId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "server",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "login",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TradeRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Trade result from EA",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TradeResult" },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/accounts/{vpsId}/{server}/{login}/close": {
      post: {
        tags: ["Trading"],
        summary: "Close positions by symbol",
        description:
          "Closes **all** open positions on the given symbol for this account.",
        parameters: [
          {
            name: "vpsId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "server",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "login",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["symbol"],
                properties: {
                  symbol: { type: "string", example: "EURUSD" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Close result from EA" },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/accounts/{vpsId}/{server}/{login}/positions": {
      get: {
        tags: ["Trading"],
        summary: "Get open positions",
        parameters: [
          {
            name: "vpsId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "server",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "login",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Open positions",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Position" },
                },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },

    // ── Copier ──
    "/api/copier/status": {
      get: {
        tags: ["Copier"],
        summary: "Get all copier session statuses",
        responses: {
          "200": {
            description: "Session list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    sessions: {
                      type: "array",
                      items: {
                        $ref: "#/components/schemas/CopierSessionStatus",
                      },
                    },
                  },
                },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/copier/start": {
      post: {
        tags: ["Copier"],
        summary: "Start a copy trading session",
        description:
          "Creates a new copy trading session that polls the source account every 2 seconds and mirrors trades to targets. " +
          "Volume multiplier is auto-calculated from balance ratio if not provided.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CopierStartRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Session started",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "OK" },
                    sessionId: { type: "string" },
                    message: { type: "string" },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/copier/stop": {
      post: {
        tags: ["Copier"],
        summary: "Stop a copier session",
        description:
          "Stops a running session. Without `force`, returns 409 if there are active copied positions. " +
          "With `force: true`, closes all copied positions on targets before stopping.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["sessionId"],
                properties: {
                  sessionId: { type: "string" },
                  force: {
                    type: "boolean",
                    default: false,
                    description:
                      "If true, close all copied positions on targets before stopping.",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Session stopped",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string" },
                    message: { type: "string" },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "409": {
            description: "Active trades — use force to close them",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string" },
                    activeCount: { type: "integer" },
                  },
                },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/copier/add-target": {
      post: {
        tags: ["Copier"],
        summary: "Hot-add a target to a running session",
        description:
          "Adds a new target account to an already-running copier session. " +
          "Existing source positions are immediately synced to the new target (except pre-existing ones).",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["sessionId", "vpsId", "server", "login"],
                properties: {
                  sessionId: { type: "string" },
                  vpsId: { type: "string" },
                  server: { type: "string" },
                  login: { type: "string" },
                  mode: {
                    type: "string",
                    enum: ["follow", "opposite"],
                    default: "opposite",
                  },
                  volumeMult: {
                    type: "number",
                    description:
                      "Volume multiplier. Auto-calculated from balance ratio if omitted.",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Target added",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string" },
                    added: { type: "string" },
                    syncedExisting: { type: "integer" },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/copier/remove-target": {
      post: {
        tags: ["Copier"],
        summary: "Remove a target from a session",
        description:
          "Removes a target account. Without `force`, returns 409 if the target has active copied positions.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["sessionId", "targetKey"],
                properties: {
                  sessionId: { type: "string" },
                  targetKey: {
                    type: "string",
                    description:
                      "Target identifier in format `vpsId|server|login`",
                    example: "clxyz123|ICMarketsSC-Demo|12345678",
                  },
                  force: { type: "boolean", default: false },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Target removed",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string" },
                    removed: { type: "string" },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "409": {
            description: "Active trades on target",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string" },
                    activeCount: { type: "integer" },
                  },
                },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/copier/retry": {
      post: {
        tags: ["Copier"],
        summary: "Retry failed copies on a target",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["sessionId", "targetKey"],
                properties: {
                  sessionId: { type: "string" },
                  targetKey: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Retried",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string" },
                    retried: { type: "integer" },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/copier/trades": {
      get: {
        tags: ["Copier"],
        summary: "Get live trade mirror tree",
        description:
          "Fetches live positions from source and all targets, correlates them by `copy_{ticket}` comment, and returns a trade tree showing which target positions mirror which source positions.",
        parameters: [
          {
            name: "sessionId",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Trade tree",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CopierTradeTree" },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/copier/logs": {
      get: {
        tags: ["Copier"],
        summary: "Get persisted copier logs",
        description:
          "Returns copier trade logs from the database with cursor-based pagination. Logs survive redeployments.",
        parameters: [
          {
            name: "sessionId",
            in: "query",
            schema: { type: "string" },
            description: "Filter by session ID",
          },
          {
            name: "targetKey",
            in: "query",
            schema: { type: "string" },
            description: "Filter by target key",
          },
          {
            name: "action",
            in: "query",
            schema: {
              type: "string",
              enum: [
                "START",
                "STOP",
                "NEW",
                "CLOSED",
                "COPIED",
                "PARTIAL",
                "FAIL",
                "ERROR",
                "WARN",
                "SKIP",
                "SNAPSHOT",
                "RESTORE",
                "ADD_TARGET",
                "REMOVE_TARGET",
              ],
            },
            description: "Filter by action type",
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 200, maximum: 1000 },
          },
          {
            name: "cursor",
            in: "query",
            schema: { type: "string" },
            description: "Pagination cursor (log ID from previous page)",
          },
        ],
        responses: {
          "200": {
            description: "Paginated logs",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    logs: {
                      type: "array",
                      items: { $ref: "#/components/schemas/CopierLog" },
                    },
                    nextCursor: {
                      type: "string",
                      nullable: true,
                      description: "Pass as `cursor` param for next page. Null when no more pages.",
                    },
                  },
                },
              },
            },
          },
          "500": { $ref: "#/components/responses/Error" },
        },
      },
    },

    // ── Servers ──
    "/api/servers/search": {
      get: {
        tags: ["Servers"],
        summary: "Search MetaQuotes broker servers",
        description:
          "Searches the MetaQuotes server directory (3000+ servers, cached 1 hour). Returns matching servers with installer URLs from `brokers.json`.",
        parameters: [
          {
            name: "q",
            in: "query",
            required: true,
            schema: { type: "string", minLength: 2 },
            description: "Search query (minimum 2 characters)",
          },
        ],
        responses: {
          "200": {
            description: "Search results",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    query: { type: "string" },
                    total: {
                      type: "integer",
                      description: "Total matches before truncation",
                    },
                    results: {
                      type: "array",
                      maxItems: 50,
                      items: {
                        type: "object",
                        properties: {
                          server: { type: "string" },
                          installer_url: {
                            type: "string",
                            description:
                              "MT5 installer URL. Empty string if not in brokers.json.",
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
        },
      },
    },
  },

  components: {
    parameters: {
      VpsId: {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string" },
        description: "VPS database ID (cuid)",
      },
    },
    responses: {
      Error: {
        description: "Error response",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                error: { type: "string" },
              },
            },
          },
        },
      },
    },
    schemas: {
      Vps: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          ip: { type: "string" },
          vncIp: { type: "string", nullable: true },
          vncPort: { type: "integer", nullable: true },
          password: { type: "string" },
          apiPort: { type: "integer" },
          status: {
            type: "string",
            enum: ["PENDING", "PROVISIONING", "ONLINE", "OFFLINE", "ERROR"],
          },
          lastSeen: { type: "string", format: "date-time", nullable: true },
          lastError: { type: "string", nullable: true },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          accountCount: { type: "integer" },
          accounts: {
            type: "array",
            items: { $ref: "#/components/schemas/Account" },
          },
        },
      },
      Account: {
        type: "object",
        properties: {
          id: { type: "string" },
          vpsId: { type: "string" },
          login: { type: "string" },
          server: { type: "string" },
          broker: { type: "string", nullable: true },
          balance: { type: "number" },
          equity: { type: "number" },
          freeMargin: { type: "number" },
          profit: { type: "number" },
          connected: { type: "boolean" },
          lastSynced: { type: "string", format: "date-time", nullable: true },
          createdAt: { type: "string", format: "date-time" },
          vpsName: {
            type: "string",
            description: "Included when listing all accounts",
          },
        },
      },
      AccountInfo: {
        type: "object",
        description: "Live account info from the MT5 terminal",
        properties: {
          login: { type: "string" },
          server: { type: "string" },
          balance: { type: "number" },
          equity: { type: "number" },
          profit: { type: "number" },
          freeMargin: { type: "number" },
          leverage: { type: "integer" },
          connected: { type: "boolean" },
          vpsName: { type: "string" },
        },
      },
      Position: {
        type: "object",
        properties: {
          ticket: { type: "string" },
          symbol: { type: "string", example: "EURUSD" },
          type: { type: "string", enum: ["BUY", "SELL"] },
          volume: { type: "number", example: 0.01 },
          openPrice: { type: "number" },
          profit: { type: "number" },
          sl: { type: "number" },
          tp: { type: "number" },
        },
      },
      TradeRequest: {
        type: "object",
        required: ["symbol", "volume"],
        properties: {
          symbol: { type: "string", example: "EURUSD" },
          volume: { type: "number", example: 0.01, minimum: 0.01 },
          sl: { type: "number", description: "Stop loss price" },
          tp: { type: "number", description: "Take profit price" },
          comment: { type: "string" },
        },
      },
      TradeResult: {
        type: "object",
        description:
          "Raw result from the PythonBridge EA. Shape varies but typically includes:",
        properties: {
          status: { type: "string", example: "OK" },
          order: { type: "string", description: "Position ticket number" },
          deal: { type: "string", description: "Deal number" },
          price: { type: "string" },
          volume: { type: "string" },
          message: {
            type: "string",
            description: "Error message if status is not OK",
          },
        },
      },
      SystemStats: {
        type: "object",
        properties: {
          cpuPercent: { type: "number", nullable: true },
          memoryPercent: { type: "number", nullable: true },
          memoryTotalMB: { type: "number", nullable: true },
          memoryUsedMB: { type: "number", nullable: true },
          memoryFreeMB: { type: "number", nullable: true },
          diskTotalGB: { type: "number", nullable: true },
          diskUsedGB: { type: "number", nullable: true },
          diskFreeGB: { type: "number", nullable: true },
          diskPercent: { type: "number", nullable: true },
          mt5Processes: { type: "integer", nullable: true },
          uptimeSeconds: { type: "number", nullable: true },
        },
      },
      DashboardData: {
        type: "object",
        properties: {
          totalVps: { type: "integer" },
          onlineVps: { type: "integer" },
          totalAccounts: { type: "integer" },
          totalEquity: { type: "number" },
          totalBalance: { type: "number" },
          totalProfit: { type: "number" },
          activeSessions: { type: "integer" },
          activeTrades: { type: "integer" },
          failedTrades: { type: "integer" },
          copierInfo: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                source: {
                  type: "object",
                  properties: {
                    vpsId: { type: "string" },
                    server: { type: "string" },
                    login: { type: "string" },
                  },
                },
                targetCount: { type: "integer" },
                sourcePositions: { type: "integer" },
                synced: { type: "integer" },
                failed: { type: "integer" },
              },
            },
          },
          recentLogs: {
            type: "array",
            items: { $ref: "#/components/schemas/CopierLog" },
          },
          alerts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: ["vps_offline", "account_disconnected"],
                },
                message: { type: "string" },
                vpsId: { type: "string" },
                vpsName: { type: "string" },
                login: { type: "string" },
                server: { type: "string" },
              },
            },
          },
          vps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                ip: { type: "string" },
                status: { type: "string" },
                accountCount: { type: "integer" },
                totalEquity: { type: "number" },
                totalProfit: { type: "number" },
              },
            },
          },
        },
      },
      CopierStartRequest: {
        type: "object",
        required: ["sourceVpsId", "sourceServer", "sourceLogin", "targets"],
        properties: {
          sourceVpsId: { type: "string" },
          sourceServer: { type: "string" },
          sourceLogin: { type: "string" },
          targets: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              required: ["vpsId", "server", "login"],
              properties: {
                vpsId: { type: "string" },
                server: { type: "string" },
                login: { type: "string" },
                mode: {
                  type: "string",
                  enum: ["follow", "opposite"],
                  default: "opposite",
                  description:
                    "`follow` = same direction, `opposite` = inverted direction (BUY->SELL)",
                },
                volumeMult: {
                  type: "number",
                  description:
                    "Volume multiplier. Auto-calculated as targetBalance/sourceBalance if omitted.",
                },
              },
            },
          },
        },
      },
      CopierSessionStatus: {
        type: "object",
        properties: {
          id: { type: "string" },
          running: { type: "boolean" },
          source: {
            type: "object",
            nullable: true,
            properties: {
              vpsId: { type: "string" },
              server: { type: "string" },
              login: { type: "string" },
            },
          },
          sourcePositions: { type: "integer" },
          targets: {
            type: "array",
            items: {
              type: "object",
              properties: {
                key: { type: "string" },
                vpsId: { type: "string" },
                server: { type: "string" },
                login: { type: "string" },
                mode: { type: "string" },
                volumeMult: { type: "number" },
                synced: { type: "integer" },
                failed: { type: "integer" },
                total: { type: "integer" },
                lastError: { type: "string", nullable: true },
                lastSyncedAt: { type: "number", nullable: true },
              },
            },
          },
          summary: {
            type: "object",
            properties: {
              synced: { type: "integer" },
              failed: { type: "integer" },
              total: { type: "integer" },
              targetCount: { type: "integer" },
            },
          },
          log: {
            type: "array",
            description: "Last 50 in-memory log entries",
            items: {
              type: "object",
              properties: {
                time: { type: "string" },
                action: { type: "string" },
                detail: { type: "string" },
              },
            },
          },
        },
      },
      CopierTradeTree: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          source: {
            type: "object",
            properties: {
              login: { type: "string" },
              server: { type: "string" },
              vpsId: { type: "string" },
            },
          },
          targets: {
            type: "array",
            items: {
              type: "object",
              properties: {
                key: { type: "string" },
                login: { type: "string" },
                server: { type: "string" },
                mode: { type: "string" },
                volumeMult: { type: "number" },
              },
            },
          },
          trades: {
            type: "array",
            items: {
              type: "object",
              properties: {
                ticket: { type: "string" },
                symbol: { type: "string" },
                type: { type: "string" },
                volume: { type: "string" },
                price: { type: "string" },
                profit: { type: "string" },
                targets: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      targetKey: { type: "string" },
                      login: { type: "string" },
                      server: { type: "string" },
                      mode: { type: "string" },
                      volumeMult: { type: "number" },
                      position: {
                        type: "object",
                        nullable: true,
                        properties: {
                          ticket: { type: "string" },
                          symbol: { type: "string" },
                          type: { type: "string" },
                          volume: { type: "string" },
                          price: { type: "string" },
                          profit: { type: "string" },
                        },
                      },
                      mirrorStatus: { type: "string" },
                      mirrorError: { type: "string" },
                    },
                  },
                },
              },
            },
          },
          totalSourcePositions: { type: "integer" },
          trackedPositions: { type: "integer" },
        },
      },
      CopierLog: {
        type: "object",
        properties: {
          id: { type: "string" },
          sessionId: { type: "string" },
          targetKey: { type: "string", nullable: true },
          action: {
            type: "string",
            enum: [
              "START",
              "STOP",
              "NEW",
              "CLOSED",
              "COPIED",
              "PARTIAL",
              "FAIL",
              "ERROR",
              "WARN",
              "SKIP",
              "SNAPSHOT",
              "RESTORE",
              "ADD_TARGET",
              "REMOVE_TARGET",
            ],
          },
          detail: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
    },
  },
};
