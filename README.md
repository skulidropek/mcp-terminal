# MCP Terminal Server

A simple server implementing the Model Context Protocol for terminal command execution.

## Features

*   Execute shell commands from language models or other clients.
*   Background execution support for long-running commands.
*   Command output truncation when exceeding buffer limits.
*   Security configuration to control command execution.

## Architecture Overview

This server provides a simple interface for executing shell commands via the MCP Protocol.

```
┌─────────────┐    MCP Protocol    ┌───────────────────┐        ┌─────────────┐
│ LLM / Agent ├───────────────────►│ MCP Terminal Svr  ├────────► Local Shell │
└─────────────┘     via stdio      └───────────────────┘   exec  └─────────────┘
```

The server is meant to be run as a child process of an LLM agent or orchestrator. It communicates via the MCP Protocol over stdio. This implementation is particularly useful for scenarios where LLM agents need to interact with the local system.

## Command Auto-Approval Configuration

The server can be configured to automatically approve certain commands.

## Prerequisites

*   Node.js (v18+)
*   npm
*   Docker (optional, for containerized deployment)
*   Docker Compose (optional)

## Setup and Running

**1. Clone the repository (if applicable)**

```bash
# git clone <repository_url>
# cd mcp-terminal
```

**2. Install dependencies**

```bash
npm install
```

**3. Build TypeScript**

```bash
npm run build
```

**4. Run the server**

```bash
npm start
# or
node dist/server.js
```

The server will start listening for MCP requests on stdin and sending responses/logs to stdout/stderr.

**Running with Auto-Approval Configuration:**

```bash
node dist/server.js --file autorun.json
```

See the [Configuration](#configuration) section for details on the format.

**Running with Docker Compose:**

```bash
docker compose up --build -d # Run in detached mode
# Interact with the running container:
docker compose exec -it mcp-terminal /bin/sh # Example: opens a shell
# Or send MCP requests via docker compose run (needs careful input piping)
```
*Note: Interacting with a stdio service via Docker Compose requires careful handling of input/output streams.* You might pipe MCP JSON requests directly or use a client designed for MCP stdio communication.

## Configuration

The server can be configured to automatically approve or deny certain commands based on patterns.

Configuration is loaded from a JSON file specified with the `--file` command-line argument:

```bash
node dist/server.js --file autorun.json
```

### Configuration Format

```json
{
  "autorun_mode": {
    "enabled": true,
    "allowlist": ["ls", "echo", "cat"],
    "denylist": ["rm", "git commit", "git push"],
    "allow_all_other_commands": false
  }
}
```

- `enabled`: Enables/disables the security feature
- `allowlist`: Array of command substrings that will be automatically allowed
- `denylist`: Array of command substrings that will never be allowed (overrides allowlist)
- `allow_all_other_commands`: If true, all commands not in the denylist will be allowed

### Security Logic

1. If `enabled` is `false`, only check against the denylist 
2. If `enabled` is `true` and `allow_all_other_commands` is `true`, only commands in the denylist are rejected
3. Otherwise, check if the command contains any substring in the `denylist` - if so, reject it
4. Check if the command contains any substring in the `allowlist` - if so, allow it
5. Use `allow_all_other_commands` setting as the default

## Usage (MCP Interaction)

Interaction with this server happens via the Model Context Protocol over stdio.
A client application (like an AI agent orchestrator) would typically manage this.

1.  **Start the server:** Run `npm start` or use Docker.
2.  **Send MCP Requests (as JSON lines) to server's stdin:**

    *   **List Tools:**
        ```json
        {"jsonrpc":"2.0","id":1,"method":"tools/list"}
        ```

    *   **Call `run_terminal_cmd` (Example):**
        ```json
        {"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"mcp_run_terminal_cmd","id":"call_123","arguments":{"command":"echo Hello MCP","explanation":"Simple echo command","is_background":false}}}
        ```

3.  **Receive MCP Responses (as JSON lines) from server's stdout:**

    *   **List Tools Response:** (Contains `mcp_run_terminal_cmd` definition)
    *   **Call Tool Response (Success):**
        ```json
        {"jsonrpc":"2.0","id":2,"result":{"toolCallId":"call_123","content":[{"type":"text","text":"{\"stdout\":\"Hello MCP\\n\",\"stderr\":\"\",\"exitCode\":0}"}]}}
        ```
    *   **Call Tool Response (Error):** 
        ```json
        {"jsonrpc":"2.0","id":3,"result":{"toolCallId":"call_abc","content":[{"type":"text","text":"{\"error\":true,\"code\":\"security_violation\",\"message\":\"Command is denied by security rules\",\"details\":{\"command\":\"rm -rf /\"}}"}],"isError":true}}
        ```

4.  **Server Logs:** Diagnostic information is sent to stderr.

## Testing

(Autotests removed as per request. Manual testing via MCP client is needed.)

```bash
# npm test # (Currently no tests defined)
```

## Linting

```bash
npm run lint       # Check for lint errors
npm run lint:fix # Attempt to automatically fix lint errors
```
